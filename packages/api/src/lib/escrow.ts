/**
 * Escrow accounting helpers.
 *
 * The escrow pool is a fiat reserve maintained by the card issuer.
 * When a card swipe is approved, funds are debited from escrow.
 * After a successful crypto-to-fiat conversion, the escrow is replenished.
 *
 * In production this would be backed by a Postgres ledger with
 * double-entry bookkeeping. This module is a placeholder for that layer.
 */

export interface EscrowLedgerEntry {
  type: "debit" | "credit";
  amount_usd: number;
  currency: string;
  reference: string;
  timestamp: string;
}

// TODO: replace with Postgres-backed ledger
const INITIAL_BALANCE = 10_000.0;
const mockEscrowBalance = { usd: INITIAL_BALANCE };

/** Reset to initial state — only for use in tests. */
export function _resetForTesting(): void {
  mockEscrowBalance.usd = INITIAL_BALANCE;
}

export async function getEscrowBalance(): Promise<number> {
  return mockEscrowBalance.usd;
}

export async function debitEscrow(
  amount: number,
  reference: string
): Promise<boolean> {
  if (mockEscrowBalance.usd < amount) return false;
  mockEscrowBalance.usd -= amount;
  console.log(`[escrow] debit $${amount} (ref: ${reference}) — balance: $${mockEscrowBalance.usd}`);
  return true;
}

export async function creditEscrow(
  amount: number,
  reference: string
): Promise<void> {
  mockEscrowBalance.usd += amount;
  console.log(`[escrow] credit $${amount} (ref: ${reference}) — balance: $${mockEscrowBalance.usd}`);
}
