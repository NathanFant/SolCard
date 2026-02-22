# Changelog

All notable changes to SolCard are documented here.
Entries are short — one line per logical change.

## [Unreleased]

## [2026.3.0] - 2026-02-22

- Update `CONTRIBUTING.md` to revise branching/workflow documentation
- Update `ci/pre-commit.sh` to simplify pre-commit gate script

## [2026.2.0] - 2026-02-22

- Add `scripts/update_changelog.py` to auto-generate changelog entries via Claude API
- Add CD workflow step to auto-update `CHANGELOG.md` on every commit
- Update `scripts/setup_hooks.py` to support changelog automation hook
- Add CD workflow step to auto-update `README.md` via Claude API on every commit

## [2026.1.2] - 2026-02-22

- Add `dev` branch as permanent integration branch
- Add `main` branch as production-only branch
- Add `year.proud_patch.small_patch` versioning scheme
- Add `scripts/bump_version.py` for manual version bumping
- Add CD workflow to auto-bump version and tag on merge to `main`
- Add CD workflow step to sync `main` back into `dev` after every release
- Add `CONTRIBUTING.md` with branching strategy, versioning, and PR checklist
- Update CI workflow to also gate PRs targeting `dev`

## [2026.1.1] - 2026-02-22

- Add Bun monorepo with `packages/api` (Hono) and `packages/web` (React + Vite + Tailwind)
- Add Marqeta JIT funding webhook stub (`POST /webhooks/jit-funding`)
- Add in-memory escrow ledger with debit, credit, and balance operations
- Add Solana RPC integration for wallet balance and stake account queries
- Add pre-commit hook that runs `bun test` and `bun run lint` before every commit
- Add GitHub Actions CI pipeline (test + type check on every push and PR)
- Add descriptive test failure messages with balance context and snapshot for JIT response shape
- Add `scripts/setup_hooks.py` to install git hooks after clone
- Add `scripts/update_license_year.py` to auto-update LICENSE year on commit
- Add `ci/pre-commit.sh` as standalone CI gate script
- Add `docs/architecture.md` and `docs/card-flow.md`
