#!/bin/sh
# Pre-commit gate: type check only.
# Tests run exclusively in GitHub Actions CI, not locally on commit.
# Exit non-zero to abort the commit.
ROOT="$(git rev-parse --show-toplevel)"
export PATH="$HOME/.bun/bin:$PATH"

printf "\033[1mType checking...\033[0m\n"
bun run --cwd "$ROOT" lint
if [ $? -ne 0 ]; then
  printf "\033[31mType check failed - commit aborted.\033[0m\n"
  exit 1
fi
printf "\033[32mType check passed.\033[0m\n"
