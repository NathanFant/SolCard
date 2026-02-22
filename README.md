# SolCard

A crypto-to-fiat payment engine built on Solana. Manages a non-custodial wallet with staked SOL, and bridges the gap between crypto holdings and real-world spending through a physical debit card. When a card is swiped, the system authorizes the transaction against an escrow pool, then converts the user's crypto to local currency to settle the balance.

## How It Works

1. User holds SOL in their non-custodial wallet (staked for APY while idle)
2. Card issuer (Marqeta) holds a fiat escrow buffer
3. Card swipe → JIT funding webhook → escrow debit → approval in <500ms
4. Background job converts SOL → USDC → fiat, replenishing escrow (planned)

See [docs/card-flow.md](docs/card-flow.md) for the full sequence diagram and [docs/architecture.md](docs/architecture.md) for the system design.

## Stack

| Layer | Technology | Notes |
| --- | --- | --- |
| Runtime | [Bun](https://bun.sh) >= 1.3 | Fast startup, native TS, built-in test runner |
| API | [Hono](https://hono.dev) | Lightweight, first-class Bun support |
| Frontend | React + Vite + Tailwind CSS | Wallet dashboard |
| Blockchain | `@solana/web3.js` | SOL balance + stake account queries |
| DEX Swaps | Jupiter Aggregator API | SOL → USDC conversion (planned) |
| Card Issuing | Marqeta | JIT funding webhook receiver; full integration planned |
| Database | PostgreSQL | Escrow ledger (planned; in-memory stub currently) |
| Queue | Redis + BullMQ | Background swap jobs (planned) |
| KYC/AML | Persona or Jumio | Identity verification (planned) |

## Project Structure

```
solcard/
├── packages/
│   ├── api/                    # Hono backend (port 3001)
│   │   └── src/
│   │       ├── index.ts        # App entry point, CORS, routing
│   │       ├── routes/
│   │       │   ├── health.ts   # GET /health
│   │       │   ├── wallet.ts   # GET /wallet/:address
│   │       │   └── webhooks.ts # POST /webhooks/jit-funding
│   │       ├── lib/
│   │       │   ├── solana.ts   # RPC connection, balance + stake queries
│   │       │   └── escrow.ts   # In-memory escrow ledger (stub)
│   │       ├── middleware/
│   │       │   ├── logger.ts   # Request logging
│   │       │   └── marqetaSignatureVerify.ts # HMAC signature validation
│   │       ├── types/
│   │       │   └── index.ts    # Shared TypeScript interfaces
│   │       └── __tests__/      # Bun test suite
│   └── web/                    # React dashboard (port 5173)
│       └── src/
│           ├── App.tsx
│           ├── main.tsx
│           ├── styles/
│           │   └── globals.css
│           └── __tests__/
├── scripts/
│   ├── setup_hooks.py          # Installs git pre-commit hook
│   ├── bump_version.py         # Manual version bump utility
│   ├── update_changelog.py     # Changelog tooling
│   ├── update_license_year.py  # Auto-updates LICENSE year on commit
│   └── update_readme.py        # README tooling
├── docs/
│   ├── architecture.md         # System design overview
│   └── card-flow.md            # End-to-end card swipe sequence diagram
├── ci/
│   └── pre-commit.sh           # Pre-commit hook script
├── .github/
│   └── workflows/
│       ├── ci.yml              # Test + lint on every push
│       └── cd.yml              # Version bump, tagging, dev sync on merge to main
├── .env.example
├── tsconfig.base.json
├── CONTRIBUTING.md
├── CHANGELOG.md
└── package.json
```

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) >= 1.3
- Python >= 3.11 (for scripts)
- Git

### Setup

```bash
# Clone and install
git clone git@github.com:NathanFant/SolCard.git
cd SolCard

# Install all workspace dependencies
bun install

# Install git hooks (runs a type check before every commit; auto-updates LICENSE year)
python3 scripts/setup_hooks.py

# Copy env and fill in values
cp .env.example .env
```

### Environment Variables

See `.env.example` for the full list. Key variables:

| Variable | Description | Required |
| --- | --- | --- |
| `SOLANA_RPC_URL` | Solana RPC endpoint (defaults to `https://api.mainnet-beta.solana.com`) | No |
| `CORS_ORIGIN` | Allowed origin for the API (defaults to `http://localhost:5173`) | No |
| `PORT` | API port (defaults to `3001`) | No |
| `MARQETA_WEBHOOK_SECRET` | HMAC-SHA256 secret for verifying Marqeta webhook signatures | **Yes** |

### Development

```bash
# Run both API and web in parallel
bun run dev

# Or run individually
bun run dev --filter @solcard/api
bun run dev --filter @solcard/web
```

- API: http://localhost:3001
- Web: http://localhost:5173

### Testing

```bash
# Run all tests
bun test

# Run API tests only
bun test packages/api

# Refresh snapshots after intentional response shape changes
bun test --update-snapshots

# Type-check all packages
bun run lint
```

Tests live in `src/__tests__/` inside each package and follow the `*.test.ts` / `*.test.tsx` naming convention. The pre-commit hook runs a type check before every commit — a failing type check aborts the commit. The full test suite runs in GitHub Actions CI on every push.

## API Endpoints

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/health` | Health check — returns `{ status, timestamp }` |
| `GET` | `/wallet/:address` | SOL balance, staked SOL, and USD value for a wallet address |
| `POST` | `/webhooks/jit-funding` | Marqeta JIT funding webhook — authorizes card swipes against escrow |

### `GET /health`

Returns the current API status and server timestamp.

**Response**

```json
{
  "status": "ok",
  "timestamp": "2026-01-15T12:00:00.000Z"
}
```

### `GET /wallet/:address`

Queries the Solana RPC for native SOL balance and active stake account balances. USD value is calculated using a hardcoded SOL/USD price (`$150`); fetching a live price from the Jupiter price API is planned.

**Response**

```json
{
  "address": "...",
  "sol_balance": 12.5,
  "staked_sol": 10.0,
  "usd_value": 3375.0
}
```

### `POST /webhooks/jit-funding`

Called by Marqeta when a card is swiped. Must respond within ~5 seconds. Debits the in-memory escrow if sufficient funds exist and returns the approved amount.

All requests to this endpoint **must include a valid `X-Marqeta-Signature` header** containing an HMAC-SHA256 signature of the request body, computed using the `MARQETA_WEBHOOK_SECRET`. Requests without a valid signature receive a `401 Unauthorized` response and the transaction is not processed.

**Request headers**

| Header | Description |
| --- | --- |
| `X-Marqeta-Signature` | HMAC-SHA256 signature of the request body as a hex-encoded string (required) |

**Request body**

```json
{
  "transaction_token": "txn_abc123",
  "card_token": "card_xyz",
  "amount": 42.00,
  "currency_code": "USD",
  "merchant": {
    "name": "Coffee Shop",
    "city": "Austin",
    "country": "US",
    "mcc": "5812"
  }
}
```

**Responses**

| Status | Meaning |
| --- | --- |
| `200` | Approved — escrow debited, response body contains `jit_funding` object |
| `401` | Unauthorized — signature validation failed or header missing |
| `402` | Declined — insufficient escrow balance |

**200 response body**

```json
{
  "jit_funding": {
    "token": "txn_abc123",
    "method": "pgfs.authorization",
    "amount": 42.00
  }
}
```

## Escrow (Current State)

The escrow module (`packages/api/src/lib/escrow.ts`) is an in-memory stub with a fixed starting balance of `$10,000 USD`. It exposes four operations:

| Function | Description |
| --- | --- |
| `getEscrowBalance()` | Returns the current balance in USD |
| `debitEscrow(amount, reference)` | Debits the escrow; returns `false` if insufficient funds |
| `creditEscrow(amount, reference)` | Credits the escrow (used by replenishment jobs — planned) |
| `_resetForTesting()` | Resets balance to initial state; only called from tests |

A PostgreSQL-backed double-entry ledger is planned to replace this in production.

## Security

### Marqeta Webhook Signature Validation

All Marqeta webhook requests are verified using HMAC-SHA256 signatures. The API server:

1. **Requires `MARQETA_WEBHOOK_SECRET`** at startup — the server will refuse to start if this environment variable is not set.
2. **Validates every incoming Marqeta webhook** — the `X-Marqeta-Signature` header is extracted and compared against a timing-safe HMAC-SHA256 hash of the raw request body.
3. **Rejects unsigned or forged requests immediately** — returns `401 Unauthorized` without processing the transaction, preventing unauthorized escrow debits.
4. **Logs all validation failures** — includes source IP and timestamp for audit and security monitoring.

The signature validation middleware is applied exclusively to `POST /webhooks/jit-funding` and does not affect other API endpoints.

### Non-Custodial Design

SolCard never holds user private keys. All wallet operations and crypto-to-fiat swaps are initiated by users and signed client-side. The API only orchestrates the flow and maintains the escrow ledger.

## CI/CD

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `ci.yml` | Every push / PR | Runs `bun test` and `bun run lint` |
| `cd.yml` | Merge to `main` | Bumps version, creates git tag, syncs `main` → `dev` |

Versioning follows a `year.proud_patch.small_patch` scheme managed automatically by the CD workflow. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full branching strategy and versioning rules.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for:

- Development setup
- Branching strategy (`feat/*` → `dev`, `fix/*` → `main`)
- Versioning scheme and how CD handles it
- Pull request checklist
- Code style guidelines

## License

Copyright TerraByte LLC — see [LICENSE](LICENSE) for details.
