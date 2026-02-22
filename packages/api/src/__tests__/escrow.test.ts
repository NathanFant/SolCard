import { beforeEach, describe, expect, it } from "bun:test";
import {
  _resetForTesting,
  creditEscrow,
  debitEscrow,
  getEscrowBalance,
} from "../lib/escrow.js";

beforeEach(() => {
  _resetForTesting();
});

describe("getEscrowBalance", () => {
  it("returns the initial balance", async () => {
    const balance = await getEscrowBalance();
    expect(balance, `initial balance should be $10,000 (got $${balance})`).toBe(
      10_000
    );
  });
});

describe("debitEscrow", () => {
  it("returns true and reduces balance for a valid amount", async () => {
    const before = await getEscrowBalance();
    const approved = await debitEscrow(250, "txn_001");
    const after = await getEscrowBalance();
    expect(
      approved,
      `debit($250): expected approval — escrow was $${before}`
    ).toBe(true);
    expect(
      after,
      `balance after debit($250) from $${before}: expected $9,750, got $${after}`
    ).toBe(9_750);
  });

  it("returns false and does not change balance when amount exceeds funds", async () => {
    const before = await getEscrowBalance();
    const approved = await debitEscrow(99_999, "txn_002");
    const after = await getEscrowBalance();
    expect(
      approved,
      `debit($99,999) against $${before}: expected rejection (insufficient funds)`
    ).toBe(false);
    expect(
      after,
      `balance should be unchanged after rejected debit — was $${before}, now $${after}`
    ).toBe(10_000);
  });

  it("allows debiting the exact remaining balance", async () => {
    const before = await getEscrowBalance();
    const approved = await debitEscrow(10_000, "txn_003");
    const after = await getEscrowBalance();
    expect(
      approved,
      `debit($10,000) equal to full balance $${before}: expected approval`
    ).toBe(true);
    expect(
      after,
      `balance should be $0 after full escrow debit (was $${before}, now $${after})`
    ).toBe(0);
  });

  it("rejects when balance is zero", async () => {
    await debitEscrow(10_000, "drain");
    const before = await getEscrowBalance();
    const approved = await debitEscrow(1, "txn_004");
    expect(
      approved,
      `debit($1) against empty escrow ($${before}): expected rejection`
    ).toBe(false);
  });
});

describe("creditEscrow", () => {
  it("increases the balance", async () => {
    const before = await getEscrowBalance();
    await creditEscrow(500, "settlement_001");
    const after = await getEscrowBalance();
    expect(
      after,
      `balance after credit($500) to $${before}: expected $10,500, got $${after}`
    ).toBe(10_500);
  });

  it("can replenish after a debit", async () => {
    await debitEscrow(1_000, "txn_005");
    const afterDebit = await getEscrowBalance();
    await creditEscrow(1_000, "settlement_002");
    const after = await getEscrowBalance();
    expect(
      after,
      `balance after credit($1,000) to $${afterDebit}: expected $10,000, got $${after}`
    ).toBe(10_000);
  });
});
