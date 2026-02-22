#!/bin/sh
# CI gate run before every commit: tests + type check.
# Exit non-zero to abort the commit.
ROOT="$(git rev-parse --show-toplevel)"
export PATH="$HOME/.bun/bin:$PATH"

# 1. Tests
printf "\033[1mRunning tests...\033[0m\n"
bun test --cwd "$ROOT"
if [ $? -ne 0 ]; then
  printf "\033[31mTests failed - commit aborted.\033[0m\n"
  exit 1
fi
printf "\033[32mAll tests passed.\033[0m\n"

# 2. Type check
printf "\033[1mType checking...\033[0m\n"
bun run --cwd "$ROOT" lint
if [ $? -ne 0 ]; then
  printf "\033[31mType check failed - commit aborted.\033[0m\n"
  exit 1
fi
printf "\033[32mType check passed.\033[0m\n"
