#!/usr/bin/env python3
"""Build-time gate: every production-served Python engine id must be one the
pinned private engine can SERVE. Run after the engine is cloned/checked-out in
the build (railpack), so a registry/engine mismatch fails the BUILD instead of
503-ing live players.

Asserts:
- every `python-v2-*` id in PROD_PLAYABLE_ENGINE_IDS is present in the worker,
- every variant default Python engine id (DMX/DXQ) is present in the worker.

Usage (paths default to the dev sibling layout):
  python3 scripts/check_engine_serveable.py [registry.ts] [live_move_worker.py]
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent  # mistboard repo root
DEFAULT_REGISTRY = HERE / "apps/server/src/engines/registry.ts"
DEFAULT_WORKER = HERE.parent / "mistboard-engine/scripts/live_move_worker.py"

PYTHON_ENGINE_ID = re.compile(r"""['"](python-(?:v2|dmx|fdx)-[\w.\-]+)['"]""")
# NB: tolerate a TS type annotation on the const (`: EngineId`) — without the
# optional `(?::\s*\w+)?` this silently matches nothing and the whole gate no-ops.
VARIANT_DEFAULT = re.compile(
    r"""DARK_(?:MINI_XIANGQI|XIANGQI)_DEFAULT_ENGINE_ID\s*(?::\s*\w+\s*)?=\s*['"]([^'"]+)['"]"""
)


def _block(text: str, start_pat: str, open_ch: str, close_ch: str) -> str:
    """Return the substring from the declaration's opening bracket to its match."""
    m = re.search(start_pat, text)
    if not m:
        return ""
    i = text.index(open_ch, m.end() - 1)
    depth = 0
    for j in range(i, len(text)):
        if text[j] == open_ch:
            depth += 1
        elif text[j] == close_ch:
            depth -= 1
            if depth == 0:
                return text[i : j + 1]
    return text[i:]


def offered_ids(registry_path: Path) -> set[str]:
    text = registry_path.read_text()
    # `new Set<EngineId>([...])` — the optional `<...>` generic must be tolerated
    # or the block regex fails and no chess ids are enforced (silent gate no-op).
    block = _block(
        text, r"PROD_PLAYABLE_ENGINE_IDS\s*=\s*new\s+Set\s*(?:<[^>]*>)?\s*\(\s*\[", "[", "]"
    )
    # The PROD_PLAYABLE block carries rollback notes that mention old ids in
    # comments; strip line comments so only actual string entries are enforced.
    active_playable = re.sub(r"//.*", "", block)
    return set(PYTHON_ENGINE_ID.findall(active_playable)) | set(VARIANT_DEFAULT.findall(text))


def served_ids(worker_path: Path) -> set[str]:
    # The private worker owns several dispatch tables (V2_LIVE_ENGINES for chess,
    # xiangqi profiles for DXQ). A whole-file scan
    # intentionally catches each registered id without coupling this public gate
    # to private table names.
    return set(PYTHON_ENGINE_ID.findall(worker_path.read_text()))


def main() -> int:
    registry = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_REGISTRY
    worker = Path(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_WORKER
    if not registry.exists() or not worker.exists():
        print(f"check_engine_serveable: missing input ({registry} / {worker})", file=sys.stderr)
        return 2
    offered = offered_ids(registry)
    served = served_ids(worker)
    if not offered:
        print("check_engine_serveable: no production Python engine ids found (nothing to check)")
        return 0
    missing = sorted(offered - served)
    if missing:
        print(
            "ENGINE-SERVEABILITY GATE FAILED: the public registry can route Python\n"
            f"engine id(s) the pinned private engine does NOT serve: {missing}\n"
            f"  required: {sorted(offered)}\n"
            f"  served:   {sorted(served)}\n"
            "Fix: bump engine.ref to an engine commit that registers these ids, or\n"
            "remove them from the production-facing registry/defaults.",
            file=sys.stderr,
        )
        return 1
    print(f"engine-serveability OK: required ids {sorted(offered)} all served by the pinned engine")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
