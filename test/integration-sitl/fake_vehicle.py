#!/usr/bin/env python3
"""M1-gate live smoke: a pymavlink "fake vehicle" TCP server (stand-in for SITL).

Full ArduPilot SITL is not installed in this environment, so pymavlink plays the
vehicle. Because pymavlink is an INDEPENDENT MAVLink implementation, driving our
codec from its live byte stream doubly validates the codec/registry/vehicle path
against a reference encoder (spec plan/05 §5.3 SITL harness intent; WBS T1.13).

Behaviour:
  * Binds a TCP server (mavutil 'tcpin:HOST:PORT'); with --port 0 (default) the
    OS assigns an ephemeral port. The bound port is printed as 'PORT <n>' so the
    test harness can wire the bridge to it.
  * MAVLink2 wire format (MAVLINK20=1).
  * Emits a COPTER HEARTBEAT (QUADROTOR / ARDUPILOTMEGA, armed, custom_mode=3 =>
    AUTO) plus ATTITUDE, GPS_RAW_INT (3D fix, ~12 sats) and GLOBAL_POSITION_INT
    (a known lat/lon/alt) at a few Hz. Sends are silently dropped by pymavlink
    until a TCP client (the bridge) connects and is accepted.
  * Answers the COMMAND microservice (M2 gate): when it receives a COMMAND_LONG
    or COMMAND_INT (e.g. 400 MAV_CMD_COMPONENT_ARM_DISARM, 176 DO_SET_MODE) it
    replies with a COMMAND_ACK for that command id with MAV_RESULT_ACCEPTED (0).
    Reads and writes happen on the SAME accepted tcpin socket, so a single
    connection both streams telemetry and round-trips commands.
  * Answers the PARAMETER microservice (M3 gate): holds a small in-memory set of
    ~16 parameters (names <=16 chars, a mix of MAV_PARAM_TYPE_* types, indices
    0..N-1, param_count=N) and replies to:
      - PARAM_REQUEST_LIST -> stream every PARAM_VALUE. To exercise the GCS-side
        ParamClient's missing-index recovery, exactly ONE index is dropped from
        the FIRST list burst only; later bursts stream the full set.
      - PARAM_REQUEST_READ (by param_index, or by param_id) -> reply with that
        single PARAM_VALUE (this is how the client recovers the dropped index).
      - PARAM_SET (param_id, param_value, param_type) -> update the in-memory
        value and ECHO PARAM_VALUE with the new value (set->confirm round-trip).
  * Answers the MISSION microservice (M4 gate): implements the MAVLink
    MISSION_* item-transfer protocol with SEPARATE stored item lists per
    MAV_MISSION_TYPE (mission=0, fence=1, rally=2). Items are kept VERBATIM
    (int lat/lon in x/y, frame, command, current, autocontinue, all four
    params and z) so a download read-back is byte-faithful to what was
    uploaded. It handles:
      - MISSION_COUNT(count, type) -> begin receive; reply
        MISSION_REQUEST_INT(seq=0, type) (or MISSION_ACK ACCEPTED if count==0).
      - MISSION_ITEM_INT(seq, ..., type) -> store; reply
        MISSION_REQUEST_INT(seq+1, type) until the set is complete, then commit
        the list and reply MISSION_ACK(type, MAV_MISSION_ACCEPTED).
      - MISSION_REQUEST_LIST(type) -> reply MISSION_COUNT(len, type).
      - MISSION_REQUEST_INT(seq, type) (and legacy MISSION_REQUEST) -> reply the
        stored MISSION_ITEM_INT(seq, type).
      - MISSION_CLEAR_ALL(type) -> clear that list; reply MISSION_ACK ACCEPTED.
"""
import argparse
import os
import sys
import time

# Force the MAVLink2 wire protocol BEFORE importing mavutil so every *_send()
# encodes v2 frames (24-bit msgids, truncation/zero-fill) — exercising the
# heavier decode path in our streaming codec.
os.environ["MAVLINK20"] = "1"

from pymavlink import mavutil  # noqa: E402

# A known fixed location (ArduPilot's default CMAC test site near Canberra). The
# test asserts the decoded GLOBAL_POSITION_INT lat/lon matches these values.
LAT_DEG = -35.3632621
LON_DEG = 149.1652374
AMSL_M = 584.0
REL_ALT_M = 12.5


def main() -> int:
    ap = argparse.ArgumentParser(description="pymavlink fake vehicle (TCP server)")
    ap.add_argument(
        "--port",
        type=int,
        default=0,
        help="TCP port to bind (0 => OS-assigned ephemeral; default 0)",
    )
    ap.add_argument("--host", default="127.0.0.1", help="bind address (default 127.0.0.1)")
    args = ap.parse_args()

    # mavutil 'tcpin' creates a listening socket and accepts a single client
    # lazily on first recv(). Binding port 0 yields an ephemeral port we read
    # back from the listen socket.
    conn = mavutil.mavlink_connection(
        "tcpin:%s:%d" % (args.host, args.port),
        source_system=1,
        source_component=1,
    )
    bound_port = conn.listen.getsockname()[1]
    print("PORT %d" % bound_port, flush=True)

    mav = conn.mav
    QUAD = mavutil.mavlink.MAV_TYPE_QUADROTOR
    ARDU = mavutil.mavlink.MAV_AUTOPILOT_ARDUPILOTMEGA
    ARMED = mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED
    CUSTOM_ENABLED = mavutil.mavlink.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED
    base_mode = ARMED | CUSTOM_ENABLED
    custom_mode = 3  # ArduCopter AUTO
    state_active = mavutil.mavlink.MAV_STATE_ACTIVE

    # --- PARAMETER microservice state (M3 gate) -----------------------------
    # An in-memory parameter set: (name<=16 chars, value, MAV_PARAM_TYPE). The
    # wire `param_value` is always a float (ArduPilot semantics); integer params
    # are the value cast to float. Values are chosen float32-exact so the GCS
    # decodes them back without quantisation surprises.
    PT = mavutil.mavlink
    param_defs = [
        ("ATC_RAT_RLL_P", 0.135, PT.MAV_PARAM_TYPE_REAL32),
        ("ATC_RAT_PIT_P", 0.135, PT.MAV_PARAM_TYPE_REAL32),
        ("ATC_RAT_YAW_P", 0.180, PT.MAV_PARAM_TYPE_REAL32),
        ("PSC_POSXY_P", 1.0, PT.MAV_PARAM_TYPE_REAL32),
        ("WPNAV_SPEED", 500.0, PT.MAV_PARAM_TYPE_REAL32),
        ("WPNAV_RADIUS", 200.0, PT.MAV_PARAM_TYPE_REAL32),
        ("RTL_ALT", 1500.0, PT.MAV_PARAM_TYPE_INT32),
        ("FENCE_ENABLE", 0.0, PT.MAV_PARAM_TYPE_INT8),
        ("FENCE_ALT_MAX", 100.0, PT.MAV_PARAM_TYPE_REAL32),
        ("BATT_CAPACITY", 5000.0, PT.MAV_PARAM_TYPE_INT32),
        ("ARMING_CHECK", 1.0, PT.MAV_PARAM_TYPE_INT32),
        ("SERIAL1_BAUD", 57.0, PT.MAV_PARAM_TYPE_INT16),
        ("INS_GYRO_FILTER", 20.0, PT.MAV_PARAM_TYPE_INT16),
        ("GPS_TYPE", 1.0, PT.MAV_PARAM_TYPE_INT8),
        ("COMPASS_USE", 1.0, PT.MAV_PARAM_TYPE_INT8),
        ("AHRS_EKF_TYPE", 3.0, PT.MAV_PARAM_TYPE_INT8),
    ]
    param_names = [name for (name, _v, _t) in param_defs]
    param_count = len(param_defs)
    # name -> [value, type]; mutated by PARAM_SET.
    param_state = {name: [float(v), t] for (name, v, t) in param_defs}
    # Drop exactly one index from the FIRST PARAM_REQUEST_LIST burst only, so the
    # client must recover it via a targeted PARAM_REQUEST_READ.
    DROP_INDEX = 7
    list_burst_count = [0]

    def param_id_to_str(pid) -> str:
        """Normalise an inbound param_id (bytes or NUL-padded str) to a string."""
        if isinstance(pid, (bytes, bytearray)):
            pid = bytes(pid).decode("ascii", "ignore")
        return str(pid).split("\x00")[0].rstrip()

    def send_param_index(idx: int) -> None:
        """Emit a single PARAM_VALUE for the parameter at `idx`."""
        name = param_names[idx]
        value, ptype = param_state[name]
        mav.param_value_send(
            name.encode("ascii"), float(value), ptype, param_count, idx
        )

    # --- MISSION microservice state (M4 gate) -------------------------------
    # SEPARATE stored item lists per MAV_MISSION_TYPE, each a seq->fields dict;
    # items are kept verbatim so a read-back is byte-faithful. `mission_rx`
    # holds the in-progress GCS->vehicle upload (count + accumulated items).
    MT_MISSION = PT.MAV_MISSION_TYPE_MISSION  # 0
    MT_FENCE = PT.MAV_MISSION_TYPE_FENCE  # 1
    MT_RALLY = PT.MAV_MISSION_TYPE_RALLY  # 2
    mission_lists = {MT_MISSION: {}, MT_FENCE: {}, MT_RALLY: {}}
    mission_rx = {MT_MISSION: None, MT_FENCE: None, MT_RALLY: None}
    mission_accepted = PT.MAV_MISSION_ACCEPTED

    def mission_type_of(m) -> int:
        """Read the inbound message's mission_type (extension), defaulting to 0."""
        mt = getattr(m, "mission_type", 0)
        return 0 if mt is None else int(mt)

    def store_item(m) -> dict:
        """Capture a MISSION_ITEM_INT's fields verbatim for faithful read-back."""
        return {
            "seq": int(m.seq),
            "frame": int(m.frame),
            "command": int(m.command),
            "current": int(m.current),
            "autocontinue": int(m.autocontinue),
            "param1": float(m.param1),
            "param2": float(m.param2),
            "param3": float(m.param3),
            "param4": float(m.param4),
            "x": int(m.x),
            "y": int(m.y),
            "z": float(m.z),
        }

    lat_i = int(round(LAT_DEG * 1e7))
    lon_i = int(round(LON_DEG * 1e7))
    amsl_mm = int(round(AMSL_M * 1000))
    rel_mm = int(round(REL_ALT_M * 1000))

    accepted = mavutil.mavlink.MAV_RESULT_ACCEPTED

    boot = time.time()
    last_telemetry = 0.0
    while True:
        # Drive the lazy TCP accept and drain ALL pending inbound messages
        # (non-blocking). Each COMMAND_LONG / COMMAND_INT is acknowledged with a
        # COMMAND_ACK(result=ACCEPTED) on the same socket so the GCS-side
        # CommandClient's retry-until-ack loop resolves.
        try:
            while True:
                msg = conn.recv_match(blocking=False)
                if msg is None:
                    break
                mtype = msg.get_type()
                if mtype in ("COMMAND_LONG", "COMMAND_INT"):
                    mav.command_ack_send(msg.command, accepted)
                elif mtype == "PARAM_REQUEST_LIST":
                    # Stream the whole set, dropping ONE index on the first burst
                    # only to force the client's missing-index PARAM_REQUEST_READ.
                    list_burst_count[0] += 1
                    drop = DROP_INDEX if list_burst_count[0] == 1 else -1
                    for idx in range(param_count):
                        if idx == drop:
                            continue
                        send_param_index(idx)
                elif mtype == "PARAM_REQUEST_READ":
                    # Recover a single parameter, by index when >=0 else by id.
                    idx = getattr(msg, "param_index", -1)
                    if idx is not None and idx >= 0:
                        if 0 <= idx < param_count:
                            send_param_index(idx)
                    else:
                        name = param_id_to_str(getattr(msg, "param_id", ""))
                        if name in param_names:
                            send_param_index(param_names.index(name))
                elif mtype == "PARAM_SET":
                    # Update the in-memory value and echo PARAM_VALUE back.
                    name = param_id_to_str(getattr(msg, "param_id", ""))
                    if name in param_state:
                        param_state[name][0] = float(msg.param_value)
                        send_param_index(param_names.index(name))
                elif mtype == "MISSION_COUNT":
                    # GCS begins an upload of `count` items for this type.
                    mt = mission_type_of(msg)
                    sys_id = msg.get_srcSystem()
                    comp_id = msg.get_srcComponent()
                    count = int(msg.count)
                    if count <= 0:
                        mission_lists[mt] = {}
                        mission_rx[mt] = None
                        mav.mission_ack_send(
                            sys_id, comp_id, mission_accepted, mission_type=mt
                        )
                    else:
                        mission_rx[mt] = {"count": count, "items": {}}
                        mav.mission_request_int_send(
                            sys_id, comp_id, 0, mission_type=mt
                        )
                elif mtype == "MISSION_ITEM_INT":
                    # An uploaded item: store it verbatim and pull the next one
                    # (or commit the list + ACK when the set is complete).
                    mt = mission_type_of(msg)
                    sys_id = msg.get_srcSystem()
                    comp_id = msg.get_srcComponent()
                    rx = mission_rx.get(mt)
                    if rx is not None:
                        seq = int(msg.seq)
                        rx["items"][seq] = store_item(msg)
                        if seq + 1 < rx["count"]:
                            mav.mission_request_int_send(
                                sys_id, comp_id, seq + 1, mission_type=mt
                            )
                        else:
                            mission_lists[mt] = dict(rx["items"])
                            mission_rx[mt] = None
                            mav.mission_ack_send(
                                sys_id, comp_id, mission_accepted, mission_type=mt
                            )
                elif mtype == "MISSION_REQUEST_LIST":
                    # GCS begins a download: reply with the stored item count.
                    mt = mission_type_of(msg)
                    sys_id = msg.get_srcSystem()
                    comp_id = msg.get_srcComponent()
                    items = mission_lists.get(mt, {})
                    mav.mission_count_send(
                        sys_id, comp_id, len(items), mission_type=mt
                    )
                elif mtype in ("MISSION_REQUEST_INT", "MISSION_REQUEST"):
                    # GCS pulls a single stored item by seq (download).
                    mt = mission_type_of(msg)
                    sys_id = msg.get_srcSystem()
                    comp_id = msg.get_srcComponent()
                    it = mission_lists.get(mt, {}).get(int(msg.seq))
                    if it is not None:
                        mav.mission_item_int_send(
                            sys_id,
                            comp_id,
                            it["seq"],
                            it["frame"],
                            it["command"],
                            it["current"],
                            it["autocontinue"],
                            it["param1"],
                            it["param2"],
                            it["param3"],
                            it["param4"],
                            it["x"],
                            it["y"],
                            it["z"],
                            mission_type=mt,
                        )
                elif mtype == "MISSION_CLEAR_ALL":
                    # Wipe one type's list and ACK.
                    mt = mission_type_of(msg)
                    sys_id = msg.get_srcSystem()
                    comp_id = msg.get_srcComponent()
                    mission_lists[mt] = {}
                    mission_rx[mt] = None
                    mav.mission_ack_send(
                        sys_id, comp_id, mission_accepted, mission_type=mt
                    )
        except Exception:
            pass

        now = time.time()
        # Stream telemetry at ~4 Hz, but service inbound far more often (the
        # short sleep below) so the multi-step MISSION handshake completes
        # briskly rather than at one round-trip per telemetry tick.
        if now - last_telemetry >= 0.25:
            last_telemetry = now
            t_ms = int((now - boot) * 1000) & 0xFFFFFFFF
            t_us = int(now * 1e6)
            try:
                mav.heartbeat_send(QUAD, ARDU, base_mode, custom_mode, state_active)
                mav.attitude_send(t_ms, 0.01, -0.02, 1.57, 0.0, 0.0, 0.0)
                # GPS_RAW_INT: 3D fix, eph/epv in cm, ~12 sats.
                mav.gps_raw_int_send(t_us, 3, lat_i, lon_i, amsl_mm, 121, 169, 0, 0, 12)
                # GLOBAL_POSITION_INT: known lat/lon, AMSL + relative alt, zero vel.
                mav.global_position_int_send(
                    t_ms, lat_i, lon_i, amsl_mm, rel_mm, 0, 0, 0, 0
                )
            except Exception:
                # Client not connected / transient socket error: keep looping.
                pass

        time.sleep(0.02)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(0)
