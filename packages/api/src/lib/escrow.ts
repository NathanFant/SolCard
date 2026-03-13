/**
 * Off-chain authorization ledger.
 *
 * Implements optimistic SOL-backed authorization (Option B):
 *
 *   1. User swipes card for $X.
 *   2. Check: sol_balance_usd - pending_sol_usd >= X
 *      NO  → decline 402 — user genuinely doesn't have enough SOL.
 *      YES → approve immediately, soft-lock SOL (pending_sol_usd += locked_sol_usd).
 *   3. Enqueue Jupiter swap: sell locked_sol_usd worth of SOL → fiat.
 *   4. Swap settles → settleTransaction() clears the lock and reduces sol_balance_usd.
 *
 * The soft-lock (pending_sol_usd) prevents the same SOL from being committed
 * to two simultaneous card swipes before either swap executes. It is the only
 * mechanism preventing double-spend in the authorization layer.
 *
 * The locked amount includes a volatility haircut so that the reserved SOL
 * covers the swap even if the SOL/USD price drops between authorization and
 * swap execution. The haircut uses the Pyth confidence interval when available,
 * with a hard floor of LOCK_HAIRCUT_BPS.
 *
 * TODO: replace in-memory mock with Postgres double-entry ledger.
 *       Each authorizeTransaction and settleTransaction becomes a serializable
 *       transaction with an immutable EscrowLedgerEntry audit row.
 */

import { getPrice, LOCK_HAIRCUT_BPS } from "./price.js";
import type { UserAccount, AuthorizationResult } from "../types/index.js";

export interface EscrowLedgerEntry {
  type: "debit" | "credit";
  amount_usd: number;
  currency: string;
  reference: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Mock user accounts — seeded with test data.
// In production these rows live in Postgres, keyed by card_token.
// sol_balance_usd is refreshed periodically by a background job that reads
// the user's on-chain SOL balance and multiplies by the current Pyth price.
// ---------------------------------------------------------------------------

const MOCK_USERS: Map<string, UserAccount> = new Map([
  ["card_abc",  { card_token: "card_abc",  sol_balance_usd: 10_000, pending_sol_usd: 0 }],
  ["card_high", { card_token: "card_high", sol_balance_usd: 50_000, pending_sol_usd: 0 }],
  ["card_low",  { card_token: "card_low",  sol_balance_usd: 50,     pending_sol_usd: 0 }],
]);

function cloneUsers(): Map<string, UserAccount> {
  return new Map(
    Array.from(MOCK_USERS.entries()).map(([k, v]) => [k, { ...v }])
  );
}

// Live state — mutated by authorizeTransaction / settleTransaction.
let users: Map<string, UserAccount> = cloneUsers();

/** Reset all accounts to initial state — only for use in tests. */
export function _resetForTesting(): void {
  users = cloneUsers();
}

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

/**
 * Authorizes a card transaction against the user's SOL balance.
 *
 * The locked amount is computed conservatively:
 *
 *   effective_haircut = max(LOCK_HAIRCUT_BPS, confidence_bps)
 *   locked_sol_usd    = amount / (1 - effective_haircut / 10_000)
 *
 * This means we reserve slightly more SOL than the transaction amount.
 * The excess covers:
 *   - Price drop between authorization and swap execution
 *   - Jupiter swap slippage
 *   - Network fees
 *
 * If the price cache is stale (RPC outage), getPrice() throws and the
 * transaction is declined — we never authorize against an unknown price.
 */
export async function authorizeTransaction(
  card_token: string,
  amount: number,
  transaction_token: string
): Promise<AuthorizationResult> {
  const user = users.get(card_token);

  if (!user) {
    // Unknown card — no account on file. In production: look up in Postgres.
    return { approved: false, locked_sol_usd: 0 };
  }

  // getPrice() throws if the cache is stale — propagate to webhook handler
  // which returns 503. Better to decline than to authorize at a wrong price.
  const { price, confidence } = getPrice();

  // Volatility haircut: use Pyth confidence interval expressed in bps,
  // floored at LOCK_HAIRCUT_BPS (2%) to always reserve a meaningful buffer.
  const confidence_bps = Math.round((confidence / price) * 10_000);
  const haircut_bps = Math.max(LOCK_HAIRCUT_BPS, confidence_bps);

  // Lock more SOL than the transaction value to hedge against price movement.
  // Example: $42 transaction at 2% haircut → lock $42.86 worth of SOL.
  const locked_sol_usd = amount / (1 - haircut_bps / 10_000);

  const available = user.sol_balance_usd - user.pending_sol_usd;

  if (available < locked_sol_usd) {
    return { approved: false, locked_sol_usd: 0 };
  }

  // Commit the soft-lock atomically.
  // In Postgres this is a single UPDATE with WHERE available >= locked_sol_usd,
  // preventing a TOCTOU race between two concurrent swipes on the same card.
  user.pending_sol_usd += locked_sol_usd;

  console.log(
    `[escrow] authorized $${amount} (ref: ${transaction_token}) — ` +
    `locked $${locked_sol_usd.toFixed(2)} SOL (haircut: ${haircut_bps}bps) — ` +
    `available: $${(available - locked_sol_usd).toFixed(2)}`
  );

  return { approved: true, locked_sol_usd };
}

// ---------------------------------------------------------------------------
// Settlement (called by the swap worker after Jupiter confirms)
// ---------------------------------------------------------------------------

/**
 * Settles a previously authorized transaction after the Jupiter swap completes.
 *
 * Clears the pending soft-lock and reduces sol_balance_usd by the actual
 * USD cost of the swap (which may differ slightly from locked_sol_usd due
 * to price movement during swap execution).
 *
 * Called by the BullMQ swap worker — not the JIT webhook handler.
 * TODO: wire up to the real swap worker once BullMQ is implemented.
 */
export async function settleTransaction(
  card_token: string,
  locked_sol_usd: number,
  actual_swap_cost_usd: number,
  transaction_token: string
): Promise<void> {
  const user = users.get(card_token);
  if (!user) return;

  user.pending_sol_usd = Math.max(0, user.pending_sol_usd - locked_sol_usd);
  user.sol_balance_usd = Math.max(0, user.sol_balance_usd - actual_swap_cost_usd);

  console.log(
    `[escrow] settled $${actual_swap_cost_usd.toFixed(2)} (ref: ${transaction_token}) — ` +
    `sol_balance: $${user.sol_balance_usd.toFixed(2)}, pending: $${user.pending_sol_usd.toFixed(2)}`
  );
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

export async function getUserAccount(card_token: string): Promise<UserAccount | undefined> {
  return users.get(card_token);
}
