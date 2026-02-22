# Card Swipe Flow

This document describes the end-to-end flow when a user swipes their SolCard at a merchant.

## Sequence Diagram

```
User          Merchant POS    Marqeta         SolCard API      Solana
 │                │               │                │               │
 │  swipe card    │               │                │               │
 │───────────────>│               │                │               │
 │                │  auth request │                │               │
 │                │──────────────>│                │               │
 │                │               │  POST /webhooks/jit-funding     │
 │                │               │───────────────>│               │
 │                │               │                │ check escrow  │
 │                │               │                │───────┐       │
 │                │               │                │<──────┘       │
 │                │               │  200 approved  │               │
 │                │               │<───────────────│               │
 │                │  approved     │                │               │
 │                │<──────────────│                │               │
 │   card works   │               │                │               │
 │<───────────────│               │                │               │
 │                │               │                │               │
 │                │               │      [background: replenish escrow]
 │                │               │                │               │
 │                │               │                │ get SOL price │
 │                │               │                │──────────────>│
 │                │               │                │<──────────────│
 │                │               │                │ Jupiter swap  │
 │                │               │                │  SOL → USDC  │
 │                │               │                │──────────────>│
 │                │               │                │<──────────────│
 │                │               │                │ credit escrow │
 │                │               │                │───────┐       │
 │                │               │                │<──────┘       │
```

## Steps in Detail

### 1. Card Swipe (< 5s SLA)

1. User swipes card at merchant terminal.
2. Merchant POS sends authorization request to the card network (Visa/Mastercard).
3. Card network routes to Marqeta.
4. Marqeta fires `POST /webhooks/jit-funding` to SolCard API.

### 2. JIT Authorization

5. SolCard API checks the escrow balance.
6. If sufficient: debit escrow for the transaction amount.
7. Return HTTP 200 with the approved amount to Marqeta.
8. Marqeta approves the transaction. Card swipe completes.

### 3. Background Escrow Replenishment

9. SolCard API enqueues a conversion job.
10. Worker fetches current SOL/USD price from Jupiter.
11. Worker calculates how much SOL to sell to cover the transaction.
12. Worker submits a Jupiter swap transaction (SOL → USDC).
13. USDC is converted to fiat via an offramp partner (e.g., Circle).
14. Fiat is credited back to the escrow pool.

## Error Scenarios

| Scenario                  | Behavior                                               |
| ------------------------- | ------------------------------------------------------ |
| Escrow insufficient       | Return 402, Marqeta declines the transaction           |
| Swap fails (slippage)     | Retry with higher slippage tolerance, alert ops team   |
| Solana RPC timeout        | Retry with backup RPC, escrow stays debited until job completes |
| Webhook timeout (>5s)     | Marqeta auto-declines; escrow not debited (idempotency) |

## Compliance Notes

- KYC verification required before card issuance (Persona/Jumio)
- All transactions logged for AML reporting
- FinCEN MSB registration required for fiat conversion at scale
- PCI DSS handled by Marqeta (SolCard never touches raw card numbers)
