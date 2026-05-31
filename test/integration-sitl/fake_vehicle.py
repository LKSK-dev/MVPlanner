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

    lat_i = int(round(LAT_DEG * 1e7))
    lon_i = int(round(LON_DEG * 1e7))
    amsl_mm = int(round(AMSL_M * 1000))
    rel_mm = int(round(REL_ALT_M * 1000))

    accepted = mavutil.mavlink.MAV_RESULT_ACCEPTED

    boot = time.time()
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
        except Exception:
            pass

        now = time.time()
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

        time.sleep(0.25)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(0)
