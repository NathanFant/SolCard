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

PRE_COMMIT_HOOK = """\
#!/bin/sh
ROOT="$(git rev-parse --show-toplevel)"
export PATH="$HOME/.bun/bin:$PATH"

# 1. Run tests (blocks commit on failure)
printf "\\033[1mRunning tests...\\033[0m\\n"
bun test --cwd "$ROOT"
if [ $? -ne 0 ]; then
  printf "\\033[31mTests failed - commit aborted.\\033[0m\\n"
  exit 1
fi
printf "\\033[32mAll tests passed.\\033[0m\\n"

# 2. Type check (blocks commit on failure)
printf "\\033[1mType checking...\\033[0m\\n"
bun --cwd "$ROOT" run lint
if [ $? -ne 0 ]; then
  printf "\\033[31mType check failed - commit aborted.\\033[0m\\n"
  exit 1
fi
printf "\\033[32mType check passed.\\033[0m\\n"

# 3. Auto-update copyright year in LICENSE
python3 "$ROOT/scripts/update_license_year.py"
"""


def install_hook(name: str, content: str) -> None:
    hook_path = HOOKS_DIR / name
    hook_path.write_text(content)
    hook_path.chmod(
        hook_path.stat().st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH
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
