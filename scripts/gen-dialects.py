#!/usr/bin/env python3
"""Generate compact MVPlanner MAVLink dialect tables (T1.2, spec plan/03 §3.1).

Emits one compact JSON file per dialect to
``src/mavlink/dialects/generated/<dialect>.json`` matching the FROZEN
``DialectTable`` contract in ``src/contracts/mavlink.ts``:

    DialectTable  = { name, messages: {id: MessageMeta}, enums: {name: EnumEntryMeta[]} }
    MessageMeta   = { id, name, crcExtra, fields: FieldMeta[], extensionIndex? }
    FieldMeta     = { name, type, arrayLen?, enum?, units? }
    EnumEntryMeta = { value, name, description?, params? }

Source of truth is the already-merged pymavlink v2.0 dialect module
(``pymavlink.dialects.v20.<dialect>``), which exposes ``mavlink_map`` (the full
merged message set, including the common/standard/minimal include chain) and
``enums``. Fields are emitted in MAVLink **wire order** (pymavlink's
``ordered_fieldnames``). The v2 extension boundary (``extensionIndex``) is not
exposed on the compiled classes, so it is derived from the dialect XML include
closure via ``pymavlink.generator.mavparse.MAVXML`` (parsed as wire protocol
2.0, which retains extension fields). MAV_CMD param labels likewise come from the
XML closure.

Run with the project venv::

    ./.venv/bin/python scripts/gen-dialects.py                 # common + ardupilotmega
    ./.venv/bin/python scripts/gen-dialects.py cubepilot       # add more, no code changes

Dialects are parameterizable: any name resolvable as both
``pymavlink.dialects.v20.<name>`` and ``message_definitions/v1.0/<name>.xml``
works (e.g. ``development``, ``cubepilot``, ``uAvionix``).
"""

from __future__ import annotations

import importlib
import json
import os
import sys
import warnings

# pymavlink emits a DeprecationWarning when touching ``.name`` on message
# classes; we deliberately use ``.msgname`` and silence the noise.
warnings.filterwarnings("ignore")

import pymavlink  # noqa: E402
from pymavlink.generator import mavparse  # noqa: E402

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(REPO_ROOT, "src", "mavlink", "dialects", "generated")
XML_DIR = os.path.join(
    os.path.dirname(pymavlink.__file__), "message_definitions", "v1.0"
)

# Default dialects to ship (spec plan/03 §3.1). ardupilotmega's mavlink_map is the
# superset (it includes the common/standard/minimal chain); common is the lighter
# default. More dialects can be added on the command line without code changes.
DEFAULT_DIALECTS = ["common", "ardupilotmega"]


def _parse_xml_closure(dialect: str):
    """Parse a dialect XML and (recursively) its includes as wire protocol 2.0.

    Returns ``(ext_start, cmd_param_labels)``:
      - ``ext_start``: ``{message_name: extensions_start}`` for messages that
        actually have v2 extension fields. ``extensions_start`` is the count of
        base (non-extension) fields; because base fields always occupy the first
        N slots in wire order, this equals the wire-order index at which
        extension fields begin (i.e. ``extensionIndex``).
      - ``cmd_param_labels``: ``{(enum_name, value): [label, ...]}`` short param
        labels for command-style enum entries (MAV_CMD), positionally indexed.
    """
    ext_start: dict[str, int] = {}
    cmd_param_labels: dict[tuple[str, int], list[str]] = {}
    seen: set[str] = set()

    def visit(filename: str) -> None:
        path = os.path.join(XML_DIR, filename)
        real = os.path.realpath(path)
        if real in seen:
            return
        seen.add(real)
        if not os.path.exists(path):
            raise SystemExit(f"missing dialect XML include: {filename}")
        xml = mavparse.MAVXML(path, wire_protocol_version=mavparse.PROTOCOL_2_0)
        for m in xml.message:
            if m.extensions_start is not None and m.extensions_start < len(m.fields):
                ext_start[m.name] = m.extensions_start
        for en in xml.enum:
            for entry in en.entry:
                if not entry.param:
                    continue
                # Build a positional label list (param index is 1-based).
                max_idx = max(int(p.index) for p in entry.param)
                labels = [""] * max_idx
                for p in entry.param:
                    labels[int(p.index) - 1] = (p.label or "").strip()
                cmd_param_labels[(en.name, int(entry.value))] = labels
        for inc in xml.include:
            visit(inc)

    visit(f"{dialect}.xml")
    return ext_start, cmd_param_labels


def _build_message(cls, ext_start: dict[str, int]) -> dict:
    """Build a MessageMeta dict from a compiled pymavlink message class.

    pymavlink mixes two field orderings, so every per-field attribute MUST be
    looked up BY NAME from the list that actually carries it:
      - ``fieldtypes`` aligns with ``fieldnames`` (XML DECLARATION order).
      - ``array_lengths`` aligns with ``ordered_fieldnames`` (MAVLink WIRE order).
    Indexing ``array_lengths`` with a declaration-order index silently shifts
    array lengths onto the wrong fields (e.g. PARAM_VALUE: ``param_id`` is the
    ``char[16]`` but a positional bug attributed it to ``param_count``).
    """
    name = cls.msgname
    decl_names: list[str] = list(cls.fieldnames)
    # type: keyed by DECLARATION-order names (fieldtypes aligns with fieldnames).
    type_by_name: dict[str, str] = dict(zip(cls.fieldnames, cls.fieldtypes))
    # arrayLen: keyed by WIRE-order names (array_lengths aligns with
    # ordered_fieldnames). 0 => scalar (emit no arrayLen).
    arraylen_by_name: dict[str, int] = dict(
        zip(cls.ordered_fieldnames, cls.array_lengths)
    )
    enums_by_name: dict[str, str] = dict(cls.fieldenums_by_name)
    units_by_name: dict[str, str] = dict(cls.fieldunits_by_name)

    fields: list[dict] = []
    for fname in cls.ordered_fieldnames:  # MAVLink WIRE order
        field: dict = {"name": fname, "type": type_by_name[fname]}
        if arraylen_by_name[fname] > 0:
            field["arrayLen"] = arraylen_by_name[fname]
        enum = enums_by_name.get(fname)
        if enum:
            field["enum"] = enum
        units = units_by_name.get(fname)
        if units:
            field["units"] = units
        fields.append(field)

    msg: dict = {
        "id": int(cls.id),
        "name": name,
        "crcExtra": int(cls.crc_extra),
        "fields": fields,
    }

    ext_idx = ext_start.get(name)
    if ext_idx is not None:
        # Sanity-check: the trailing wire fields must be exactly the declared
        # extension fields (extensions are never reordered in MAVLink v2).
        decl_ext = set(decl_names[ext_idx:])
        wire_ext = set(cls.ordered_fieldnames[ext_idx:])
        if decl_ext != wire_ext:
            raise SystemExit(
                f"extension boundary mismatch for {name}: "
                f"decl={sorted(decl_ext)} wire={sorted(wire_ext)}"
            )
        msg["extensionIndex"] = ext_idx

    return msg


def _self_check(module, messages: dict[str, dict]) -> None:
    """Assert every emitted field's arrayLen matches pymavlink's authority.

    pymavlink's ``array_lengths`` is the authoritative per-field array length,
    aligned with ``ordered_fieldnames`` (WIRE order). For each generated message
    we re-derive the wire-order ``{name: length}`` map directly from the
    compiled class and assert that:
      - every emitted array field has the exact same arrayLen, and
      - every scalar field (length 0) emits NO arrayLen.
    Any mismatch fails generation (non-zero exit) so the declaration-vs-wire
    ordering bug can never silently ship again.
    """
    errors: list[str] = []
    for key, msg in messages.items():
        cls = module.mavlink_map[int(key)]
        authority: dict[str, int] = dict(
            zip(cls.ordered_fieldnames, cls.array_lengths)
        )
        emitted_order = [f["name"] for f in msg["fields"]]
        if emitted_order != list(cls.ordered_fieldnames):
            errors.append(
                f"{msg['name']}: field order {emitted_order} != wire order "
                f"{list(cls.ordered_fieldnames)}"
            )
        for field in msg["fields"]:
            want = int(authority[field["name"]])
            got = field.get("arrayLen")
            if want > 0:
                if got != want:
                    errors.append(
                        f"{msg['name']}.{field['name']}: arrayLen {got!r} "
                        f"!= authoritative {want}"
                    )
            elif got is not None:
                errors.append(
                    f"{msg['name']}.{field['name']}: scalar field must have no "
                    f"arrayLen, got {got!r}"
                )
    if errors:
        joined = "\n  ".join(errors)
        raise SystemExit(
            f"SELF-CHECK FAILED ({len(errors)} arrayLen mismatch(es)):\n  {joined}"
        )


def _build_enums(module, cmd_param_labels: dict[tuple[str, int], list[str]]) -> dict:
    """Build the enums map (EnumEntryMeta[] per enum name)."""
    out: dict[str, list[dict]] = {}
    for enum_name, entries in module.enums.items():
        items: list[dict] = []
        for value in sorted(entries.keys()):
            entry = entries[value]
            ename = entry.name
            # Drop the synthetic ``*_ENUM_END`` sentinel markers.
            if ename.endswith("_ENUM_END"):
                continue
            item: dict = {"value": int(value), "name": ename}
            desc = (entry.description or "").strip()
            if desc:
                item["description"] = desc
            labels = cmd_param_labels.get((enum_name, int(value)))
            if labels is None and entry.param:
                # Fallback: derive from the compiled module's param descriptions.
                max_idx = max(int(k) for k in entry.param.keys())
                labels = [""] * max_idx
                for k, v in entry.param.items():
                    labels[int(k) - 1] = (v or "").strip()
            if labels:
                item["params"] = labels
            items.append(item)
        if items:
            out[enum_name] = items
    return out


def generate(dialect: str) -> tuple[str, int, int, int]:
    """Generate one dialect JSON file. Returns (path, n_messages, n_enums, bytes)."""
    try:
        module = importlib.import_module(f"pymavlink.dialects.v20.{dialect}")
    except ImportError as exc:  # pragma: no cover - operator error path
        raise SystemExit(f"unknown dialect '{dialect}': {exc}")

    ext_start, cmd_param_labels = _parse_xml_closure(dialect)

    messages: dict[str, dict] = {}
    for msgid in sorted(module.mavlink_map.keys()):
        cls = module.mavlink_map[msgid]
        messages[str(int(msgid))] = _build_message(cls, ext_start)

    _self_check(module, messages)

    enums = _build_enums(module, cmd_param_labels)

    table = {"name": dialect, "messages": messages, "enums": enums}

    os.makedirs(OUT_DIR, exist_ok=True)
    out_path = os.path.join(OUT_DIR, f"{dialect}.json")
    # Compact: no pretty-print whitespace (size budget, spec plan/08 §8.1).
    text = json.dumps(table, separators=(",", ":"), ensure_ascii=False)
    with open(out_path, "w", encoding="utf-8") as fh:
        fh.write(text)
    return out_path, len(messages), len(enums), len(text.encode("utf-8"))


def main(argv: list[str]) -> int:
    dialects = argv[1:] or DEFAULT_DIALECTS
    for dialect in dialects:
        path, n_msg, n_enum, n_bytes = generate(dialect)
        rel = os.path.relpath(path, REPO_ROOT)
        print(f"{dialect:16s} -> {rel}  ({n_msg} msgs, {n_enum} enums, {n_bytes} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
