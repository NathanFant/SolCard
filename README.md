# SolCard

A crypto-to-fiat payment engine built on Solana. Manages a non-custodial wallet with staked SOL, and bridges the gap between crypto holdings and real-world spending through a physical debit card. When a card is swiped, the system authorizes the transaction against an escrow pool, then converts the user's crypto to local currency to settle the balance.

## How It Works

1. User holds SOL in their non-custodial wallet (staked for APY while idle)
2. Card issuer (Marqeta) holds a fiat escrow buffer
3. Card swipe → JIT funding webhook → escrow debit → approval in <500ms
4. Background job converts SOL → USDC → fiat, replenishing escrow

See [docs/card-flow.md](docs/card-flow.md) for the full sequence diagram and [docs/architecture.md](docs/architecture.md) for the system design.

## Stack

| Package       | Tech                               |
| ------------- | ---------------------------------- |
| Runtime       | [Bun](https://bun.sh)              |
| API           | [Hono](https://hono.dev)           |
| Frontend      | React + Vite + Tailwind CSS        |
| Blockchain    | Solana (`@solana/web3.js`)         |
| DEX           | Jupiter Aggregator                 |
| Card Issuing  | Marqeta (planned)                  |

## Project Structure

```
solcard/
├── packages/
│   ├── api/          # Hono backend (port 3001)
│   │   └── src/
│   │       ├── index.ts
│   │       ├── routes/       # health, wallet, webhooks
│   │       ├── lib/          # solana.ts, escrow.ts
│   │       ├── middleware/   # logger
│   │       └── types/
│   └── web/          # React dashboard (port 5173)
│       └── src/
│           ├── App.tsx
│           ├── components/
│           ├── pages/
│           ├── hooks/
│           └── lib/
├── scripts/          # Python utilities
├── docs/             # Architecture and flow docs
├── .env.example
└── tsconfig.base.json
```

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) >= 1.0
- Python >= 3.10 (for scripts)

### Setup

```bash
# Clone and install
git clone git@github.com:NathanFant/SolCard.git
cd solcard

# Install git hooks (auto-updates LICENSE year on commit)
python3 scripts/setup_hooks.py

# Copy env and fill in values
cp .env.example .env

# Install all workspace dependencies
bun install
```

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

### API Endpoints

| Method | Path                          | Description                     |
| ------ | ----------------------------- | ------------------------------- |
| GET    | `/health`                     | Health check                    |
| GET    | `/wallet/:address`            | Wallet balance (SOL + staked)   |
| POST   | `/webhooks/jit-funding`       | Marqeta JIT funding webhook     |

## License

Copyright TerraByte LLC — see [LICENSE](LICENSE) for details.
