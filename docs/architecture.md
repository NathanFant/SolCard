# Architecture

## Overview

SolCard is a monorepo with two primary packages and a Python scripts layer.

```
solcard/
├── packages/
│   ├── api/      # Hono backend — transaction engine, webhooks, Solana integration
│   └── web/      # React + Vite + Tailwind — wallet dashboard
├── scripts/      # Python utilities (hooks, tooling)
└── docs/         # Architecture and flow documentation
```

## Stack

| Layer        | Technology                              | Reason                                                       |
| ------------ | --------------------------------------- | ------------------------------------------------------------ |
| Runtime      | Bun                                     | Fast startup, native TS, built-in bundler                    |
| API Server   | Hono                                    | Lightweight, first-class Bun support, edge-compatible        |
| Frontend     | React + Vite                            | Industry standard, fast HMR, excellent ecosystem             |
| Styling      | Tailwind CSS                            | Utility-first, no runtime cost, consistent design tokens     |
| Blockchain   | @solana/web3.js                         | Official Solana JS SDK, TS-first, actively maintained        |
| DEX Swaps    | Jupiter Aggregator API                  | Best SOL-to-stablecoin rates, minimal slippage               |
| Card Issuing | Marqeta (planned)                       | JIT funding model aligns with escrow-first architecture      |
| Database     | PostgreSQL (planned)                    | Double-entry ledger for escrow, audit trails                 |
| Queue        | Redis + BullMQ (planned)                | Background crypto conversion jobs, retry logic               |
| KYC/AML      | Persona or Jumio (planned)              | Identity verification requirement for card issuance          |

## Services

### `@solcard/api` (port 3001)

Stateless HTTP API. Handles:
- Marqeta JIT funding webhooks (card swipe authorization)
- Wallet balance queries via Solana RPC
- Escrow accounting (stub → Postgres ledger)
- Background swap job enqueuing (planned)

### `@solcard/web` (port 5173)

Wallet dashboard. Handles:
- Wallet connection (planned: Phantom, Solflare via Wallet Adapter)
- Balance display (SOL + staked SOL)
- Transaction history
- Card management UI

## Key Design Decisions

### JIT Funding First
The card processing model is "approve first, convert later." Escrow holds a fiat buffer so card swipes respond in <500ms. A background job then executes the SOL→USDC→fiat swap and replenishes the escrow.

### Non-Custodial Wallet
Users hold their own private keys. The API never has access to private keys. Swaps are signed client-side and submitted on-chain.

### Staking Yield
User SOL is staked via native stake accounts to earn APY while idle. Before a swap, the required amount is unstaked (subject to epoch cooldown) or sourced from liquid staking tokens (e.g., mSOL, jitoSOL).
