# Contributing to SolCard

## Development Setup

**Prerequisites:** [Bun](https://bun.sh) >= 1.3, Python >= 3.11, Git

```bash
git clone git@github.com:NathanFant/SolCard.git
cd SolCard
bun install
python3 scripts/setup_hooks.py   # installs pre-commit hook
cp .env.example .env             # fill in your credentials
```

The pre-commit hook runs the full test suite and type check before every
commit. A failing commit is aborted — fix the issue and try again.

---

## Branching Strategy

```
main ──────────────────────────────────────────── production (protected)
  ↑ PRs manually reviewed and merged here only
  │    fix/* merged here (small_patch bump)
  │    dev   merged here (proud_patch bump)  ← always manual, always syncs back to dev
  │
  └── dev ──────────────────────────────────────── integration (permanent, never deleted)
            ↑ feat/* merged here
            ↑ main synced back here after every merge to main
```

### Rules

| Rule | Reason |
|------|--------|
| Never push directly to `main` or `dev` | All changes go through PRs |
| `dev` is permanent — never delete it | It is the single source of truth for in-progress work |
| `main` must never be ahead of `dev` | After every merge into `main`, open a sync PR (`main` → `dev`) |
| `dev` → `main` merges are always manual | A human reviews and merges the PR; nothing triggers it automatically |

### Branch types

| Prefix | Target | Use for |
|--------|--------|---------|
| `feat/*` | `dev` | New features, improvements |
| `fix/*` | `main` | Hotfixes needed in production immediately |
| `chore/*` | `dev` or `main` | Tooling, config, docs |

After **any** PR merges into `main` (whether from `dev` or `fix/*`), the
CD workflow automatically syncs `main` back into `dev` and bumps the
version. This keeps `dev` perpetually ahead of `main`.

---

## Versioning — `year.proud_patch.small_patch`

| Component | Meaning | Bumped when |
|-----------|---------|-------------|
| `year` | Calendar year | Automatically on the first merge of the new year; resets both patches |
| `proud_patch` | Major feature release | A PR from `dev` is merged into `main` |
| `small_patch` | Patch / hotfix | A `fix/*` or `chore/*` PR is merged into `main` |

The CD workflow ([.github/workflows/cd.yml](.github/workflows/cd.yml))
handles all version bumping and tagging automatically the moment a PR
lands in `main`. You never edit the version field in `package.json` by
hand.

### Manual bump (if needed locally)

```bash
python3 scripts/bump_version.py proud   # dev → main release
python3 scripts/bump_version.py small   # hotfix → main release
```

### GitHub Actions permissions

After bumping the version, the CD workflow commits directly to `main`
and syncs the result into `dev`. For this to work, branch protection on
`main` must allow the Actions bot to bypass the push restriction:

> **Settings → Branches → main → Allow specified actors to bypass
> required pull requests** → add `github-actions[bot]`

---

## Pull Request Checklist

- [ ] Branch name follows the convention above
- [ ] Target branch is correct (`dev` for features, `main` for hotfixes)
- [ ] `bun test` passes locally (pre-commit hook enforces this)
- [ ] `bun run lint` passes locally (pre-commit hook enforces this)
- [ ] Snapshot files updated if the JIT response shape changed (`bun test --update-snapshots`)
- [ ] PR description explains _why_, not just _what_
- [ ] After merging a `fix/*` into `main`, verify the CD workflow synced `main` → `dev`

---

## Running Tests

```bash
bun test                        # all packages
bun test packages/api           # API only
bun test --update-snapshots     # refresh snapshots after intentional changes
bun run lint                    # type check all packages
```

Tests live in `src/__tests__/` inside each package and follow the
`*.test.ts` / `*.test.tsx` naming convention.

---

## Code Style

- **TypeScript** everywhere (strict mode via `tsconfig.base.json`)
- **Bun** as the runtime and test runner — no Node-isms
- **Hono** for HTTP routing; keep route handlers thin
- **Python** for scripts only; PEP 8, max line length 79
- No `console.log` left in committed code — use structured logging
