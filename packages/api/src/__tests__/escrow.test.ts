import { beforeEach, describe, expect, it } from "bun:test";
import {
  _resetForTesting,
  authorizeTransaction,
  settleTransaction,
  getUserAccount,
} from "../lib/escrow.js";
import { _setPriceForTesting } from "../lib/price.js";

const MOCK_PRICE = { price: 150, confidence: 0.5, fetchedAt: Date.now() };

beforeEach(() => {
  _resetForTesting();
  _setPriceForTesting({ ...MOCK_PRICE, fetchedAt: Date.now() });
});

// ---------------------------------------------------------------------------
// authorizeTransaction
// ---------------------------------------------------------------------------

describe("authorizeTransaction", () => {
  it("approves a transaction within the user's SOL balance", async () => {
    const result = await authorizeTransaction("card_abc", 49.99, "txn_001");
    expect(result.approved).toBe(true);
    expect(result.locked_sol_usd).toBeGreaterThan(49.99); // haircut applied
  });

  it("sets pending_sol_usd after authorization", async () => {
    await authorizeTransaction("card_abc", 100, "txn_002");
    const user = await getUserAccount("card_abc");
    expect(user!.pending_sol_usd).toBeGreaterThan(100);
  });

  it("reduces available balance for subsequent transactions", async () => {
    // Drain nearly all available SOL ($10,000 account)
    await authorizeTransaction("card_abc", 9_000, "txn_003");
    // $1,000 remaining — $500 should still be approvable
    const result = await authorizeTransaction("card_abc", 500, "txn_004");
    expect(result.approved).toBe(true);
  });

  it("declines when pending locks consume available balance", async () => {
    // Lock $9,700 — haircut makes it $9,897.96, leaving ~$102 available
    await authorizeTransaction("card_abc", 9_700, "txn_005");
    // $500 requires $510 with haircut — exceeds the ~$102 remaining
    const result = await authorizeTransaction("card_abc", 500, "txn_006");
    expect(result.approved).toBe(false);
    expect(result.locked_sol_usd).toBe(0);
  });

  it("declines for an unknown card token", async () => {
    const result = await authorizeTransaction("card_unknown", 10, "txn_007");
    expect(result.approved).toBe(false);
  });

  it("declines when the amount exceeds the user's total SOL balance", async () => {
    // card_low has only $50 sol_balance_usd
    const result = await authorizeTransaction("card_low", 100, "txn_008");
    expect(result.approved).toBe(false);
  });

  it("approves up to the full available balance", async () => {
    // card_low has $50 — a $48 transaction should be approvable
    // ($48 / (1 - 0.02) = $48.98, which is < $50)
    const result = await authorizeTransaction("card_low", 48, "txn_009");
    expect(result.approved).toBe(true);
  });

  it("does not mutate balance on a declined transaction", async () => {
    const before = await getUserAccount("card_low");
    await authorizeTransaction("card_low", 999, "txn_010");
    const after = await getUserAccount("card_low");
    expect(after!.pending_sol_usd).toBe(before!.pending_sol_usd);
    expect(after!.sol_balance_usd).toBe(before!.sol_balance_usd);
  });

  it("uses a higher haircut when Pyth confidence is wide", async () => {
    // Wide confidence interval (±$15 on a $150 price = 1000 bps = 10%)
    _setPriceForTesting({ price: 150, confidence: 15, fetchedAt: Date.now() });
    const result = await authorizeTransaction("card_abc", 100, "txn_011");
    expect(result.approved).toBe(true);
    // locked should be ~$100 / (1 - 0.10) = $111.11
    expect(result.locked_sol_usd).toBeCloseTo(111.11, 1);
  });
});

// ---------------------------------------------------------------------------
// settleTransaction
// ---------------------------------------------------------------------------

describe("settleTransaction", () => {
  it("clears the pending lock on settlement", async () => {
    const { locked_sol_usd } = await authorizeTransaction("card_abc", 100, "txn_012");
    await settleTransaction("card_abc", locked_sol_usd, 100, "txn_012");
    const user = await getUserAccount("card_abc");
    expect(user!.pending_sol_usd).toBe(0);
  });

  it("reduces sol_balance_usd by the actual swap cost", async () => {
    const { locked_sol_usd } = await authorizeTransaction("card_abc", 100, "txn_013");
    await settleTransaction("card_abc", locked_sol_usd, 101.50, "txn_013");
    const after = await getUserAccount("card_abc");
    // Started at $10,000 (mock initial), settled $101.50 actual cost
    expect(after!.sol_balance_usd).toBeCloseTo(10_000 - 101.50, 2);
  });

  it("frees pending balance so a subsequent transaction can be authorized", async () => {
    // card_low has $50 — lock $48 worth
    const { locked_sol_usd } = await authorizeTransaction("card_low", 48, "txn_014");
    // Settle, freeing the lock
    await settleTransaction("card_low", locked_sol_usd, 48, "txn_014");
    // Should now be able to authorize again (remaining balance ~$2 is low
    // but a small transaction should pass)
    const result = await authorizeTransaction("card_low", 1, "txn_015");
    expect(result.approved).toBe(true);
  });
});
