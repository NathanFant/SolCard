#!/usr/bin/env python3
"""Bump the version in package.json per SolCard's versioning scheme.

Usage:
    python3 scripts/bump_version.py proud   # dev → main (big feature)
    python3 scripts/bump_version.py small   # fix/* → main (patch/hotfix)

Version format: year.proud_patch.small_patch
- year        : calendar year; auto-detected, resets both patches when it
                changes (e.g. 2026 → 2027 gives 2027.1.0)
- proud_patch : bumped when dev is merged into main (major feature drop)
- small_patch : bumped when a fix/hotfix is merged directly into main

The new version string is printed to stdout so callers can capture it.
"""

import json
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PACKAGE_JSON = ROOT / "package.json"


def bump(bump_type: str) -> str:
    current_year = datetime.now().year

    pkg = json.loads(PACKAGE_JSON.read_text())
    raw: str = pkg["version"]
    parts = raw.split(".")
    if len(parts) != 3:
        print(f"Unexpected version format: {raw!r}", file=sys.stderr)
        sys.exit(1)

    v_year, proud, small = int(parts[0]), int(parts[1]), int(parts[2])

    if current_year != v_year:
        # New year — reset both components and start fresh
        new_version = f"{current_year}.1.0"
    elif bump_type == "proud":
        new_version = f"{v_year}.{proud + 1}.0"
    else:
        new_version = f"{v_year}.{proud}.{small + 1}"

    pkg["version"] = new_version
    PACKAGE_JSON.write_text(json.dumps(pkg, indent=2) + "\n")
    return new_version


def main() -> None:
    if len(sys.argv) != 2 or sys.argv[1] not in ("proud", "small"):
        print("Usage: bump_version.py <proud|small>", file=sys.stderr)
        sys.exit(1)

    print(bump(sys.argv[1]))


if __name__ == "__main__":
    main()
