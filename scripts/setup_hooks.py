#!/usr/bin/env python3
"""
Install local git hooks for the SolCard repo.

Run once after cloning:
    python3 scripts/setup_hooks.py
"""

import stat
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
HOOKS_DIR = REPO_ROOT / ".git" / "hooks"

# Thin wrapper: delegates the CI gate to ci/pre-commit.sh, then runs
# housekeeping steps (license year, README) and stages their output so
# the updated files are included in the commit automatically.
PRE_COMMIT_HOOK = """\
#!/bin/sh
ROOT="$(git rev-parse --show-toplevel)"
export PATH="$HOME/.bun/bin:$PATH"
"$ROOT/ci/pre-commit.sh" || exit 1
python3 "$ROOT/scripts/update_license_year.py"
python3 "$ROOT/scripts/update_readme.py"
python3 "$ROOT/scripts/update_changelog.py"
git add "$ROOT/LICENSE" "$ROOT/README.md" "$ROOT/CHANGELOG.md"
"""


def install_hook(name: str, content: str) -> None:
    hook_path = HOOKS_DIR / name
    hook_path.write_text(content)
    hook_path.chmod(
        hook_path.stat().st_mode
        | stat.S_IEXEC
        | stat.S_IXGRP
        | stat.S_IXOTH
    )
    print(f"  installed {hook_path.relative_to(REPO_ROOT)}")


def main() -> None:
    if not HOOKS_DIR.exists():
        print("ERROR: .git/hooks not found — run from the repo root.")
        raise SystemExit(1)

    print("Installing git hooks...")
    install_hook("pre-commit", PRE_COMMIT_HOOK)
    print("Done.")


if __name__ == "__main__":
    main()
