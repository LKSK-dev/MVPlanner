#!/usr/bin/env python3
"""MAVLink reference-vector generator (task T1.3 / validation harness V1).

This is the codec's INDEPENDENT validation oracle. It MUST NOT depend on the
project's own (TypeScript) codec in any way: pymavlink is the sole ground truth.
The committed JSON it produces under ``test/vectors/`` is what the T1.1 codec
conformance runner checks against. This script only *emits* those vectors and
self-checks them against pymavlink; it never imports project code.

Ground truth: pymavlink 2.4.49 (vendored in ``./.venv``; do NOT pip install).
  * ``pymavlink.dialects.v10`` -> MAVLink v1 framing (magic 0xFE)
  * ``pymavlink.dialects.v20`` -> MAVLink v2 framing (magic 0xFD)

Exact bytes are obtained by building a ``MAVLink`` object over an ``io.BytesIO``
with fixed ``srcSystem``/``srcComponent``/``seq`` and calling
``<msg>_encode(...).pack(mav)``. For signed v2 vectors we set a FIXED
``signing.secret_key`` / ``signing.link_id`` / ``signing.timestamp`` and
``signing.sign_outgoing = True`` so the output is deterministic, and we record
those parameters in the vector.

Run:  ./.venv/bin/python scripts/gen-vectors.py
"""

from __future__ import annotations

import io
import json
import os
import sys
from typing import Any

from pymavlink.dialects.v10 import common as v1_common
from pymavlink.dialects.v10 import ardupilotmega as v1_apm
from pymavlink.dialects.v20 import common as v2_common
from pymavlink.dialects.v20 import ardupilotmega as v2_apm
from pymavlink.mavutil import x25crc

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.normpath(os.path.join(HERE, "..", "test", "vectors"))

# (version, dialect) -> generated module. v10 modules emit v1 frames; v20 emit v2.
MODULES = {
    (1, "common"): v1_common,
    (1, "ardupilotmega"): v1_apm,
    (2, "common"): v2_common,
    (2, "ardupilotmega"): v2_apm,
}

# Deterministic signing parameters (used only for `signed` v2 vectors).
SIGNING_KEY = bytes(range(32))  # 000102...1f
SIGNING_KEY_HEX = SIGNING_KEY.hex()
SIGNING_LINK_ID = 1
SIGNING_TIMESTAMP = 1_234_567  # fixed 48-bit timestamp -> deterministic signature

# Integer boundary constants used by the cases below.
U8_MAX = 0xFF
I8_MIN, I8_MAX = -0x80, 0x7F
U16_MAX = 0xFFFF
I16_MIN, I16_MAX = -0x8000, 0x7FFF
U32_MAX = 0xFFFFFFFF
I32_MIN, I32_MAX = -0x80000000, 0x7FFFFFFF
U64_MAX = 0xFFFFFFFFFFFFFFFF
I64_MIN = -0x8000000000000000


# --- case table ------------------------------------------------------------
#
# Each case describes ONE logical message. The generator expands every case
# into a v1 and a v2 (unsigned) vector, and—when ``sign`` is set—an additional
# v2 signed vector. ``fields`` are passed verbatim as keyword args to pymavlink's
# ``<name>_encode``. ``sysid``/``compid``/``seq`` are fixed per case so output is
# byte-for-byte reproducible.
#
# Coverage notes (asserted in build()):
#   * GPS_RAW_INT + MEMINFO carry v2 EXTENSION fields (truncated when zero on v2).
#   * GPS_STATUS carries numeric ARRAY fields (uint8[20]).
#   * STATUSTEXT + PARAM_VALUE carry char[] fields (full-length and short).
#   * boundary cases exercise min/max/negative/zero ints and 64-bit values.

CASES: list[dict[str, Any]] = [
    # --- HEARTBEAT (common) ---
    {
        "label": "heartbeat-gcs",
        "dialect": "common",
        "name": "HEARTBEAT",
        "sysid": 255,
        "compid": 0,
        "seq": 0,
        "sign": True,
        "fields": {
            "type": 6,  # MAV_TYPE_GCS
            "autopilot": 8,  # MAV_AUTOPILOT_INVALID
            "base_mode": 0,
            "custom_mode": 0,
            "system_status": 4,  # MAV_STATE_ACTIVE
        },
    },
    {
        "label": "heartbeat-max",
        "dialect": "common",
        "name": "HEARTBEAT",
        "sysid": 1,
        "compid": 1,
        "seq": 42,
        "sign": True,
        "fields": {
            "type": U8_MAX,
            "autopilot": U8_MAX,
            "base_mode": U8_MAX,
            "custom_mode": U32_MAX,
            "system_status": U8_MAX,
        },
    },
    # --- SYS_STATUS (common): wide bitmasks, signed current, boundary ints ---
    {
        "label": "sys-status",
        "dialect": "common",
        "name": "SYS_STATUS",
        "sysid": 1,
        "compid": 1,
        "seq": 7,
        "sign": True,
        "fields": {
            "onboard_control_sensors_present": U32_MAX,
            "onboard_control_sensors_enabled": 0,
            "onboard_control_sensors_health": 0x12345678,
            "load": 1000,
            "voltage_battery": 12600,
            "current_battery": -1,  # int16 "unknown"
            "battery_remaining": -1,  # int8 "unknown"
            "drop_rate_comm": 0,
            "errors_comm": 0,
            "errors_count1": U16_MAX,
            "errors_count2": 0,
            "errors_count3": 0,
            "errors_count4": 0,
        },
    },
    # --- GPS_RAW_INT (common): EXTENSION fields, negative degE7, uint64 time ---
    {
        "label": "gps-raw-int-ext",
        "dialect": "common",
        "name": "GPS_RAW_INT",
        "sysid": 1,
        "compid": 1,
        "seq": 11,
        "sign": True,
        "fields": {
            "time_usec": 1_700_000_000_000_000,
            "fix_type": 3,
            "lat": -353632610,
            "lon": 1491652300,
            "alt": 584090,
            "eph": 120,
            "epv": 200,
            "vel": 0,
            "cog": 0,
            "satellites_visible": 10,
            # extension fields (present + non-zero -> not truncated on v2):
            "alt_ellipsoid": 580000,
            "h_acc": 1500,
            "v_acc": 3000,
            "vel_acc": 250,
            "hdg_acc": 0,
            "yaw": 9000,
        },
    },
    # --- GPS_STATUS (common): numeric uint8[20] ARRAY fields ---
    {
        "label": "gps-status-arrays",
        "dialect": "common",
        "name": "GPS_STATUS",
        "sysid": 1,
        "compid": 1,
        "seq": 12,
        "sign": False,
        "fields": {
            "satellites_visible": 20,
            "satellite_prn": list(range(1, 21)),
            "satellite_used": [1, 0] * 10,
            "satellite_elevation": [i * 4 for i in range(20)],
            "satellite_azimuth": [i * 12 for i in range(20)],
            "satellite_snr": [i + 30 for i in range(20)],
        },
    },
    # --- ATTITUDE (common): floats incl. negative/zero ---
    {
        "label": "attitude",
        "dialect": "common",
        "name": "ATTITUDE",
        "sysid": 1,
        "compid": 1,
        "seq": 30,
        "sign": False,
        "fields": {
            "time_boot_ms": 123456,
            "roll": -0.5235988,
            "pitch": 0.0,
            "yaw": 3.1415927,
            "rollspeed": 0.01,
            "pitchspeed": -0.02,
            "yawspeed": 0.0,
        },
    },
    # --- GLOBAL_POSITION_INT (common): negative degE7/alt + boundary ints ---
    {
        "label": "global-position-int",
        "dialect": "common",
        "name": "GLOBAL_POSITION_INT",
        "sysid": 1,
        "compid": 1,
        "seq": 33,
        "sign": False,
        "fields": {
            "time_boot_ms": 987654,
            "lat": I32_MIN,
            "lon": I32_MAX,
            "alt": -100000,
            "relative_alt": 50000,
            "vx": -1234,
            "vy": 1234,
            "vz": 0,
            "hdg": 35999,
        },
    },
    # --- COMMAND_LONG (common): float params, uint16 command ---
    {
        "label": "command-long-takeoff",
        "dialect": "common",
        "name": "COMMAND_LONG",
        "sysid": 1,
        "compid": 1,
        "seq": 76,
        "sign": True,
        "fields": {
            "target_system": 1,
            "target_component": 1,
            "command": 22,  # MAV_CMD_NAV_TAKEOFF
            "confirmation": 0,
            "param1": 0.0,
            "param2": 0.0,
            "param3": 0.0,
            "param4": float("nan"),
            "param5": 0.0,
            "param6": 0.0,
            "param7": 10.0,
        },
    },
    # --- COMMAND_INT (common): int32 x/y boundary ---
    {
        "label": "command-int-reposition",
        "dialect": "common",
        "name": "COMMAND_INT",
        "sysid": 1,
        "compid": 1,
        "seq": 75,
        "sign": False,
        "fields": {
            "target_system": 1,
            "target_component": 1,
            "frame": 6,  # MAV_FRAME_GLOBAL_RELATIVE_ALT_INT
            "command": 192,  # MAV_CMD_DO_REPOSITION
            "current": 0,
            "autocontinue": 0,
            "param1": -1.0,
            "param2": 0.0,
            "param3": 0.0,
            "param4": float("nan"),
            "x": I32_MIN,
            "y": I32_MAX,
            "z": 30.5,
        },
    },
    # --- PARAM_VALUE (common): char[16] full-length id ---
    {
        "label": "param-value-full-id",
        "dialect": "common",
        "name": "PARAM_VALUE",
        "sysid": 1,
        "compid": 1,
        "seq": 22,
        "sign": True,
        "fields": {
            "param_id": b"ABCDEFGHIJKLMNOP",  # exactly 16 chars (no terminator)
            "param_value": 1100.0,
            "param_type": 9,  # MAV_PARAM_TYPE_REAL32
            "param_count": U16_MAX,
            "param_index": 0,
        },
    },
    # --- PARAM_VALUE (common): short id ---
    {
        "label": "param-value-short-id",
        "dialect": "common",
        "name": "PARAM_VALUE",
        "sysid": 1,
        "compid": 1,
        "seq": 23,
        "sign": False,
        "fields": {
            "param_id": b"RC1_MIN",
            "param_value": 1100.0,
            "param_type": 9,
            "param_count": 500,
            "param_index": 12,
        },
    },
    # --- STATUSTEXT (common): char[50] short ---
    {
        "label": "statustext-short",
        "dialect": "common",
        "name": "STATUSTEXT",
        "sysid": 1,
        "compid": 1,
        "seq": 50,
        "sign": False,
        "fields": {
            "severity": 6,  # MAV_SEVERITY_INFO
            "text": b"Hello",
        },
    },
    # --- STATUSTEXT (common): char[50] full-length ---
    {
        "label": "statustext-full",
        "dialect": "common",
        "name": "STATUSTEXT",
        "sysid": 1,
        "compid": 1,
        "seq": 51,
        "sign": True,
        "fields": {
            "severity": 2,  # MAV_SEVERITY_CRITICAL
            "text": b"0123456789ABCDEFGHIJ0123456789ABCDEFGHIJ0123456789",  # 50 chars
        },
    },
    # --- MISSION_ITEM_INT (common) ---
    {
        "label": "mission-item-int",
        "dialect": "common",
        "name": "MISSION_ITEM_INT",
        "sysid": 1,
        "compid": 1,
        "seq": 73,
        "sign": False,
        "fields": {
            "target_system": 1,
            "target_component": 1,
            "seq": 3,
            "frame": 3,  # MAV_FRAME_GLOBAL_RELATIVE_ALT
            "command": 16,  # MAV_CMD_NAV_WAYPOINT
            "current": 0,
            "autocontinue": 1,
            "param1": 0.0,
            "param2": 5.0,
            "param3": 0.0,
            "param4": float("nan"),
            "x": -353632610,
            "y": 1491652300,
            "z": 100.0,
            "mission_type": 0,
        },
    },
    # --- ardupilotmega WIND (non-extension dialect-specific) ---
    {
        "label": "apm-wind",
        "dialect": "ardupilotmega",
        "name": "WIND",
        "sysid": 1,
        "compid": 1,
        "seq": 168,
        "sign": False,
        "fields": {
            "direction": -123.4,
            "speed": 5.6,
            "speed_z": -0.3,
        },
    },
    # --- ardupilotmega MEMINFO: EXTENSION field (freemem32) ---
    {
        "label": "apm-meminfo-ext",
        "dialect": "ardupilotmega",
        "name": "MEMINFO",
        "sysid": 1,
        "compid": 1,
        "seq": 152,
        "sign": False,
        "fields": {
            "brkval": 12345,
            "freemem": U16_MAX,
            "freemem32": 4000000,  # extension field -> present on v2 when non-zero
        },
    },
]

# Decode-only cases: messages with trailing-zero fields. On v2 pymavlink trims
# the trailing zeros, so the emitted payload is SHORTER than the full message.
# We record the FULL field set (including the zeroed trailing fields); a decoder
# MUST zero-fill the trimmed bytes to reproduce it. These exercise the receive
# side only (re-encoding would minimally re-truncate to the same bytes).
DECODE_ONLY_CASES: list[dict[str, Any]] = [
    {
        "label": "decode-gps-raw-int-truncated-ext",
        "dialect": "common",
        "name": "GPS_RAW_INT",
        "sysid": 1,
        "compid": 1,
        "seq": 24,
        "fields": {
            "time_usec": 123456,
            "fix_type": 3,
            "lat": -353632610,
            "lon": 1491652300,
            "alt": 584090,
            "eph": 120,
            "epv": 200,
            "vel": 0,
            "cog": 0,
            "satellites_visible": 10,
            # all extension fields zero -> trimmed on the wire, zero-filled on rx:
            "alt_ellipsoid": 0,
            "h_acc": 0,
            "v_acc": 0,
            "vel_acc": 0,
            "hdg_acc": 0,
            "yaw": 0,
        },
    },
    {
        "label": "decode-sys-status-truncated",
        "dialect": "common",
        "name": "SYS_STATUS",
        "sysid": 1,
        "compid": 1,
        "seq": 1,
        "fields": {
            "onboard_control_sensors_present": 0x0F,
            "onboard_control_sensors_enabled": 0x0F,
            "onboard_control_sensors_health": 0x0F,
            "load": 250,
            "voltage_battery": 12000,
            "current_battery": 0,
            "battery_remaining": 0,
            "drop_rate_comm": 0,
            "errors_comm": 0,
            "errors_count1": 0,
            "errors_count2": 0,
            "errors_count3": 0,
            "errors_count4": 0,
        },
    },
    {
        "label": "decode-heartbeat-truncated",
        "dialect": "common",
        "name": "HEARTBEAT",
        "sysid": 7,
        "compid": 1,
        "seq": 9,
        "fields": {
            "type": 2,  # MAV_TYPE_QUADROTOR
            "autopilot": 3,  # MAV_AUTOPILOT_ARDUPILOTMEGA
            "base_mode": 0,
            "custom_mode": 0,
            "system_status": 0,
        },
    },
]


def field_type_map(msg_class: Any) -> dict[str, str]:
    """name -> declared field type (e.g. 'uint64_t', 'char', 'int32_t')."""
    return dict(zip(msg_class.fieldnames, msg_class.fieldtypes))


def jsonify_fields(msg_class: Any, fields: dict[str, Any]) -> dict[str, Any]:
    """Convert encoder input into JSON-safe, lossless field values.

    Convention (documented in test/vectors/README.md):
      * 64-bit ints (uint64_t/int64_t) -> decimal STRING (preserve precision)
      * char[] -> STRING (the textual content, no trailing NULs)
      * numeric arrays -> JSON array of numbers
      * NaN/Inf floats -> the strings "NaN" / "Infinity" / "-Infinity"
      * everything else -> JSON number
    """
    types = field_type_map(msg_class)
    out: dict[str, Any] = {}
    for name, value in fields.items():
        ftype = types[name]
        if isinstance(value, bytes):
            out[name] = value.decode("ascii", "replace").rstrip("\x00")
        elif isinstance(value, list):
            out[name] = [_jsonify_scalar(v) for v in value]
        elif ftype in ("uint64_t", "int64_t"):
            out[name] = str(int(value))
        else:
            out[name] = _jsonify_scalar(value)
    return out


def _jsonify_scalar(value: Any) -> Any:
    if isinstance(value, float):
        if value != value:  # NaN
            return "NaN"
        if value == float("inf"):
            return "Infinity"
        if value == float("-inf"):
            return "-Infinity"
    return value


def encode_frame(
    version: int,
    dialect: str,
    name: str,
    sysid: int,
    compid: int,
    seq: int,
    fields: dict[str, Any],
    signed: bool,
) -> bytes:
    """Encode one frame via pymavlink and return its exact bytes."""
    mod = MODULES[(version, dialect)]
    mav = mod.MAVLink(io.BytesIO(), srcSystem=sysid, srcComponent=compid)
    mav.seq = seq
    if signed:
        mav.signing.secret_key = SIGNING_KEY
        mav.signing.link_id = SIGNING_LINK_ID
        mav.signing.timestamp = SIGNING_TIMESTAMP
        mav.signing.sign_outgoing = True
    encode_fn = getattr(mav, name.lower() + "_encode")
    msg = encode_fn(**fields)
    return bytes(msg.pack(mav))


def msg_class_for(dialect: str, name: str, version: int = 2) -> Any:
    mod = MODULES[(version, dialect)]
    for cls in mod.mavlink_map.values():
        if cls.msgname == name:
            return cls
    raise KeyError(f"unknown message {name} in dialect {dialect} (v{version})")


def fields_for_version(
    dialect: str, name: str, version: int, fields: dict[str, Any]
) -> dict[str, Any]:
    """v1 frames do not carry v2 extension fields; drop any the v1 message
    definition does not declare so the v1 vector reflects what a v1 peer sees."""
    if version == 2:
        return fields
    allowed = set(msg_class_for(dialect, name, 1).fieldnames)
    return {k: v for k, v in fields.items() if k in allowed}


def make_record(case: dict[str, Any], version: int, signed: bool) -> dict[str, Any]:
    cls = msg_class_for(case["dialect"], case["name"], version)
    fields = fields_for_version(case["dialect"], case["name"], version, case["fields"])
    frame = encode_frame(
        version,
        case["dialect"],
        case["name"],
        case["sysid"],
        case["compid"],
        case["seq"],
        fields,
        signed,
    )
    rec: dict[str, Any] = {
        "label": case["label"],
        "dialect": case["dialect"],
        "msgName": case["name"],
        "msgId": cls.id,
        "crcExtra": cls.crc_extra,
        "version": version,
        "signed": signed,
        "sysid": case["sysid"],
        "compid": case["compid"],
        "seq": case["seq"],
        "fields": jsonify_fields(cls, fields),
        "expectedHex": frame.hex(),
    }
    if signed:
        rec["signing"] = {
            "keyHex": SIGNING_KEY_HEX,
            "linkId": SIGNING_LINK_ID,
            "timestamp": SIGNING_TIMESTAMP,
        }
    return rec


def make_decode_only_record(case: dict[str, Any]) -> dict[str, Any]:
    """A v2 frame whose payload was truncated; full field set recorded."""
    cls = msg_class_for(case["dialect"], case["name"])
    frame = encode_frame(
        2,
        case["dialect"],
        case["name"],
        case["sysid"],
        case["compid"],
        case["seq"],
        case["fields"],
        False,
    )
    full_len = cls.unpacker.size
    payload_len = frame[1]
    return {
        "label": case["label"],
        "dialect": case["dialect"],
        "msgName": case["name"],
        "msgId": cls.id,
        "crcExtra": cls.crc_extra,
        "version": 2,
        "signed": False,
        "decodeOnly": True,
        "truncatedPayloadLen": payload_len,
        "fullPayloadLen": full_len,
        "note": "v2 payload truncated; decoder must zero-fill to the full field set",
        "sysid": case["sysid"],
        "compid": case["compid"],
        "seq": case["seq"],
        "fields": jsonify_fields(cls, case["fields"]),
        "expectedHex": frame.hex(),
    }


# --- self-check: independently re-verify every emitted frame ---------------


def crc_extra_for(dialect: str, name: str) -> int:
    return msg_class_for(dialect, name).crc_extra


def self_check(rec: dict[str, Any]) -> None:
    """Re-derive CRC + framing from raw bytes (independent of the encoder path)
    and parse the frame back with pymavlink to confirm it is well-formed."""
    raw = bytes.fromhex(rec["expectedHex"])
    version = rec["version"]
    signed = rec["signed"]
    magic = raw[0]
    expected_magic = 0xFE if version == 1 else 0xFD
    assert magic == expected_magic, f"{rec['label']}: bad magic {magic:#x}"
    payload_len = raw[1]

    if version == 1:
        assert len(raw) == 8 + payload_len, f"{rec['label']}: v1 length mismatch"
        body = raw[1 : 6 + payload_len]  # len..end-of-payload (excl. magic + crc)
        crc_lo, crc_hi = raw[6 + payload_len], raw[7 + payload_len]
    else:
        sig = 13 if signed else 0
        assert len(raw) == 12 + payload_len + sig, f"{rec['label']}: v2 length mismatch"
        incompat = raw[2]
        assert bool(incompat & 0x01) == signed, f"{rec['label']}: signed flag mismatch"
        body = raw[1 : 10 + payload_len]
        crc_lo, crc_hi = raw[10 + payload_len], raw[11 + payload_len]

    crc = x25crc(body)
    crc.accumulate(bytes([crc_extra_for(rec["dialect"], rec["msgName"])]))
    got = crc_lo | (crc_hi << 8)
    assert crc.crc == got, f"{rec['label']}: CRC mismatch {crc.crc:#x} != {got:#x}"

    # Parse the frame back with pymavlink and confirm the message identity.
    mod = MODULES[(version, rec["dialect"])]
    parser = mod.MAVLink(io.BytesIO())
    parser.robust_parsing = True
    if signed:
        parser.signing.secret_key = SIGNING_KEY
        parser.signing.link_id = rec["signing"]["linkId"]
    msgs = parser.parse_buffer(raw) or []
    decoded = [m for m in msgs if m.get_type() != "BAD_DATA"]
    assert decoded, f"{rec['label']}: frame did not parse back"
    assert decoded[0].get_msgId() == rec["msgId"], f"{rec['label']}: parsed wrong msgId"


def write_json(path: str, payload: Any) -> int:
    text = json.dumps(payload, separators=(",", ":"), sort_keys=False)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)
        fh.write("\n")
    return len(text) + 1


def build() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)

    v1_records: list[dict[str, Any]] = []
    v2_records: list[dict[str, Any]] = []
    signed_records: list[dict[str, Any]] = []

    for case in CASES:
        v1_records.append(make_record(case, 1, False))
        v2_records.append(make_record(case, 2, False))
        if case.get("sign"):
            signed_records.append(make_record(case, 2, True))

    for case in DECODE_ONLY_CASES:
        v2_records.append(make_decode_only_record(case))

    all_records = v1_records + v2_records + signed_records

    # --- coverage assertions (fail loudly if the representative set regresses) ---
    names = {r["msgName"] for r in all_records}
    required = {
        "HEARTBEAT",
        "SYS_STATUS",
        "GPS_RAW_INT",
        "ATTITUDE",
        "GLOBAL_POSITION_INT",
        "COMMAND_LONG",
        "COMMAND_INT",
        "PARAM_VALUE",
        "STATUSTEXT",
        "MISSION_ITEM_INT",
    }
    missing = required - names
    assert not missing, f"missing required messages: {sorted(missing)}"
    assert "GPS_STATUS" in names, "missing numeric-array message"
    assert {"GPS_RAW_INT", "MEMINFO"} & names, "missing v2-extension message"
    assert any(r.get("decodeOnly") for r in v2_records), "missing decode-only vectors"
    assert signed_records, "missing signed vectors"

    # --- self-check every record against pymavlink (oracle integrity) ---
    for rec in all_records:
        self_check(rec)

    # --- write files ---
    sizes: dict[str, int] = {}
    sizes["vectors-v1.json"] = write_json(
        os.path.join(OUT_DIR, "vectors-v1.json"), v1_records
    )
    sizes["vectors-v2.json"] = write_json(
        os.path.join(OUT_DIR, "vectors-v2.json"), v2_records
    )
    sizes["vectors-signed.json"] = write_json(
        os.path.join(OUT_DIR, "vectors-signed.json"), signed_records
    )

    manifest = {
        "generator": "scripts/gen-vectors.py",
        "source": "pymavlink",
        "pymavlinkVersion": __import__("pymavlink").__version__,
        "dialects": ["common", "ardupilotmega"],
        "signing": {
            "keyHex": SIGNING_KEY_HEX,
            "linkId": SIGNING_LINK_ID,
            "timestamp": SIGNING_TIMESTAMP,
        },
        "recordSchema": [
            "label",
            "dialect",
            "msgName",
            "msgId",
            "crcExtra",
            "version",
            "signed",
            "sysid",
            "compid",
            "seq",
            "fields",
            "expectedHex",
            "signing?",
            "decodeOnly?",
        ],
        "files": [
            {"name": "vectors-v1.json", "count": len(v1_records)},
            {"name": "vectors-v2.json", "count": len(v2_records)},
            {"name": "vectors-signed.json", "count": len(signed_records)},
        ],
        "counts": {
            "v1": len(v1_records),
            "v2Unsigned": len([r for r in v2_records if not r["signed"]]),
            "v2Signed": len(signed_records),
            "decodeOnly": len([r for r in v2_records if r.get("decodeOnly")]),
            "total": len(all_records),
        },
        "coverage": {
            "extensionMessages": sorted(
                n for n in ("GPS_RAW_INT", "MEMINFO") if n in names
            ),
            "arrayMessages": ["GPS_STATUS"],
            "charArrayMessages": ["PARAM_VALUE", "STATUSTEXT"],
        },
    }
    sizes["manifest.json"] = write_json(
        os.path.join(OUT_DIR, "manifest.json"), manifest
    )

    total_bytes = sum(sizes.values())
    print("Reference vectors written to", OUT_DIR)
    for fname, size in sizes.items():
        print(f"  {fname:22s} {size:7d} bytes")
    print(f"  {'TOTAL':22s} {total_bytes:7d} bytes")
    print("Counts:", json.dumps(manifest["counts"]))
    print("Self-check: OK ({} frames re-verified against pymavlink)".format(len(all_records)))


if __name__ == "__main__":
    try:
        build()
    except AssertionError as exc:
        print("VECTOR GENERATION FAILED:", exc, file=sys.stderr)
        sys.exit(1)
