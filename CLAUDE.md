# SolCard — Claude Code Instructions

## Project Overview

SolCard is a crypto-to-fiat payment engine built on Solana. A physical debit card (issued via Marqeta) triggers a JIT (Just-In-Time) funding authorization webhook; the backend settles against a fiat escrow pool and enqueues a background SOL→USD swap to replenish liquidity. The stack is a Bun-native TypeScript monorepo.

---

## Repository Layout

```
solcard/
├── packages/
│   ├── api/          # Hono HTTP server (port 3001)
│   │   └── src/
│   │       ├── lib/
│   │       │   ├── escrow.ts          # In-memory escrow ledger (TODO: Postgres double-entry)
│   │       │   └── solana.ts          # @solana/web3.js RPC helpers — balance, stake accounts
│   │       ├── middleware/
│   │       │   ├── logger.ts          # Request logging middleware
│   │       │   └── marqetaSignatureVerify.ts  # HMAC-SHA256 webhook auth
│   │       ├── routes/
│   │       │   ├── health.ts          # GET /health
│   │       │   ├── wallet.ts          # GET /wallet/:address
│   │       │   └── webhooks.ts        # POST /webhooks/jit-funding (Marqeta JIT)
│   │       └── types/index.ts         # Shared TypeScript interfaces
│   └── web/          # React + Vite + Tailwind frontend (port 5173)
├── scripts/
│   ├── bump_version.py       # Semver bumper used by CD pipeline
│   ├── setup_hooks.py        # Installs git pre-commit hook — run once after clone
│   └── update_license_year.py
├── .github/workflows/w
│   ├── ci.yml        # Runs `bun test` + `bun run lint` on every push/PR
│   └── cd.yml        # Version bump, CHANGELOG stamp, tag, dev sync — fires on merge to main
├── bunfig.toml       # Injects MARQETA_WEBHOOK_SECRET for test runs
└── tsconfig.base.json
```

---

## Runtime & Toolchain

- **Runtime**: Bun (`~/.bun/bin/bun`). Bun is NOT on `$PATH` by default — run `source ~/.zshrc` first, or use the full path.
- **Package manager**: `bun install --frozen-lockfile` (lockfile-pinned; never `npm install`).
- **Type checking**: `bun run lint` (delegates to `tsc --noEmit`).
- **Test runner**: `bun test` from the repo root — picks up all `*.test.ts` files across packages.
- **Dev server**: `bun run --hot src/index.ts` (hot-reloads on file change, no bundler round-trip).

---

## Running Things

```bash
# Install deps
bun install --frozen-lockfile

# Run all tests
bun test

# Type check (no emit)
bun run lint

# Start API dev server
cd packages/api && bun run dev

# Start web dev server
cd packages/web && bun run dev
```

---

## Git Workflow

- **Branch model**: `main` is the stable release branch. Active development lands on `dev` via feature branches (`feat/`, `fix/`, `chore/`).
- **Never push directly to `main`**. Always open a PR — CI must be green before merging.
- **PR flow**: feature branch → `dev` → PR to `main`. The CD pipeline fires automatically on merge to `main`.
- **Commit style**: conventional commits (`feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`). Keep subject lines under 72 chars.
- **`[skip ci]`**: used only by the CD bot for automated bookkeeping commits (version bump, changelog stamp, dev sync). Never use it on human commits.

### CD Pipeline (on merge to `main`)

1. Determines bump type: `dev→main` = `proud` bump (minor), `fix→main` = `small` bump (patch).
2. Bumps version in `package.json` via `scripts/bump_version.py`.
3. Stamps `CHANGELOG.md` — replaces `[Unreleased]` with the new version tag + ISO date.
4. Commits, creates annotated git tag, pushes with `--follow-tags`.
5. Merges `main` back into `dev` (no-ff) to keep the two branches in sync.

---

## Architecture & Domain Concepts

### JIT Funding Flow

1. Cardholder swipes. Marqeta sends a `POST /webhooks/jit-funding` webhook with a `JitFundingRequest` (transaction token, card token, amount in USD, merchant MCC).
2. `marqetaSignatureVerify` middleware validates the `X-Marqeta-Signature` HMAC-SHA256 header against `MARQETA_WEBHOOK_SECRET`. Rejects with `401` on failure.
3. `debitEscrow()` checks and atomically decrements the fiat escrow pool. Returns `false` (→ `402 Payment Required`) if underfunded.
4. On approval, a background worker (TODO: not yet implemented) enqueues a SOL→USD swap via Jupiter DEX aggregator to replenish the escrow.
5. Response must round-trip within ~5 seconds or Marqeta auto-declines.

### Escrow Ledger (`packages/api/src/lib/escrow.ts`)

Currently an in-memory mock (`mockEscrowBalance`). Production target is a **Postgres double-entry ledger** where every debit and credit is an immutable `EscrowLedgerEntry`. The `_resetForTesting()` export is test-only — never call it in application code.

### Solana Integration (`packages/api/src/lib/solana.ts`)

- Uses `@solana/web3.js` with a `Connection` at `confirmed` commitment.
- `getSolBalance()` — fetches native SOL lamports and converts to SOL (÷ `LAMPORTS_PER_SOL`).
- `getStakeAccounts()` — filters `Stake11111111111111111111111111111111111111112` program accounts by delegator pubkey via `memcmp` at offset 44.
- RPC URL defaults to `https://api.mainnet-beta.solana.com`; override with `SOLANA_RPC_URL`.
- SOL/USD price is hardcoded at $150 (stub). Production: Pyth Network on-chain feed (see below).

### SOL/USD Pricing Model

SOL/USD price is sourced from the **Pyth Network** on-chain SOL/USD feed via `getAccountInfo` on the Pyth feed pubkey — same RPC connection as wallet queries, no extra HTTP dependency. Pyth aggregates from 90+ institutional market makers and returns both a mid-market price and a **confidence interval**.

#### Rolling Cache (architectural decision)

Price must be available before each JIT transaction but must not be fetched per-transaction (adds 50-150ms latency on the hot path) or lazily on first demand (cold-cache spike under burst load). The decided pattern is a **background interval that refreshes every second unconditionally**, regardless of transaction volume:

```ts
setInterval(refreshPythPrice, 1_000)   // always warm, ~86k getAccountInfo calls/day
// every JIT transaction reads cachedPrice synchronously — zero async work on hot path
```

~86,400 `getAccountInfo` calls/day is negligible on any paid RPC tier (Helius, QuickNode, Triton).

#### Spread Formula

```
effective_rate     = pyth_price × (1 - spread_bps / 10_000)
spread_bps         = base_bps + volatility_premium_bps
base_bps           ≈ 30–50   (covers Jupiter swap slippage + gas)
volatility_premium = (pyth_confidence / pyth_price) × 10_000
```

Spread widens dynamically when Pyth's confidence interval is wide, pricing real-time volatility risk into each transaction's margin. If `cachedPrice.fetchedAt` exceeds a hard staleness threshold (e.g. 60 seconds — indicating a broken refresher or RPC outage), decline the transaction rather than authorize against stale data.

### Swap Pipeline (TODO)

Planned: Jupiter V6 quote API (`/quote` + `/swap`) to atomically swap SOL → USDC → fiat. The `ConversionQuote` type in `types/index.ts` models the intended quote response including `slippage_bps` and `route_plan`.

---

## Key Interfaces (`packages/api/src/types/index.ts`)

| Interface | Purpose |
|---|---|
| `JitFundingRequest` | Inbound Marqeta webhook payload |
| `JitFundingResponse` | Approval response — must include `pgfs.authorization` method |
| `WalletBalance` | SOL + staked SOL + USD value for a given pubkey |
| `ConversionQuote` | Jupiter swap quote (slippage in bps, route plan) |
| `EscrowAccount` | Escrow pool state snapshot |

---

## Environment Variables

| Variable | Required in prod | Purpose |
|---|---|---|
| `MARQETA_WEBHOOK_SECRET` | Yes — throws on startup if missing | HMAC-SHA256 shared secret for webhook signature verification |
| `MARQETA_BASE_URL` | Yes | Marqeta REST API base URL |
| `MARQETA_APPLICATION_TOKEN` | Yes | Marqeta application credential |
| `MARQETA_ADMIN_ACCESS_TOKEN` | Yes | Marqeta admin credential |
| `SOLANA_RPC_URL` | No | Defaults to mainnet-beta public RPC |
| `SOLANA_NETWORK` | No | `mainnet-beta` / `devnet` / `testnet` |
| `JUPITER_API_URL` | No | Defaults to `https://quote-api.jup.ag/v6` |
| `CORS_ORIGIN` | No | Defaults to `http://localhost:5173` |
| `PORT` | No | API port — defaults to `3001` |

Copy `.env.example` to `.env` and fill in secrets. Never commit `.env`.

---

## Testing

- All tests live under `packages/api/src/__tests__/`.
- `bun test` from repo root runs the full suite — currently 18+ tests across escrow, health, JIT webhook, and signature middleware.
- `bunfig.toml` injects `MARQETA_WEBHOOK_SECRET=test_webhook_secret_for_ci` for the test environment. Tests that compute HMAC signatures must use the same secret.
- Snapshot files are committed (`__snapshots__/`). If a snapshot changes intentionally, update it with `bun test --update-snapshots`.
- **Tests do not run in the pre-commit hook** — they run only in CI. The hook runs type check only.
- CI (`ci.yml`) gates every push/PR: `bun test` must pass and `bun run lint` must exit clean before merging.

---

## Code Style & Conventions

- **TypeScript strict mode** — no `any`, no implicit returns on async handlers.
- **ESM throughout** — all imports use `.js` extensions (even for `.ts` source files), per Bun/Node16 resolution.
- **No `console.log` in committed code** — use structured logging or wire into `requestLogger` middleware.
- **No hardcoded secrets or fallback secrets in application code** — secrets must come from env vars; throw at startup if missing.
- **Timing-safe comparisons for all cryptographic equality checks** — XOR-compare byte arrays; never use `===` on HMAC digests.
- **Middleware is composable** — register per-route, not globally, unless it applies to every endpoint (e.g., CORS, logger).
- **No `_resetForTesting()` in app code** — test-only exports are prefixed with `_` and must never be imported outside `__tests__/`.

---

## Open TODOs (tracked in GitHub Issues)

- Replace in-memory escrow mock with Postgres double-entry ledger.
- Implement Jupiter DEX swap worker to replenish escrow post-authorization.
- Implement Pyth Network SOL/USD rolling cache (1s background refresh) + dynamic spread formula to replace hardcoded $150 stub.
- Structured logging (replace `console.*` with a proper logger).
- Rate limiting and replay-attack protection on the JIT funding webhook.
- **Escrow reservation model**: determine per-user fiat reserve ratio. Starting point: $50 USD floor (covers the large majority of transactions which are expected to be sub-$50), scaling to a higher fiat reserve as account SOL holdings and spend history grow. Recalibrate periodically based on 30-day rolling average daily spend and swap settlement latency. See architecture notes on two-layer ledger.
