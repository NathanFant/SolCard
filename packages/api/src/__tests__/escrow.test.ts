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
    expect(await getEscrowBalance()).toBe(10_000);
  });
});

describe("debitEscrow", () => {
  it("returns true and reduces balance for a valid amount", async () => {
    const approved = await debitEscrow(250, "txn_001");
    expect(approved).toBe(true);
    expect(await getEscrowBalance()).toBe(9_750);
  });

  it("returns false and does not change balance when amount exceeds funds", async () => {
    const approved = await debitEscrow(99_999, "txn_002");
    expect(approved).toBe(false);
    expect(await getEscrowBalance()).toBe(10_000);
  });

  it("allows debiting the exact remaining balance", async () => {
    const approved = await debitEscrow(10_000, "txn_003");
    expect(approved).toBe(true);
    expect(await getEscrowBalance()).toBe(0);
  });

  it("rejects when balance is zero", async () => {
    await debitEscrow(10_000, "drain");
    const approved = await debitEscrow(1, "txn_004");
    expect(approved).toBe(false);
  });
});

describe("creditEscrow", () => {
  it("increases the balance", async () => {
    await creditEscrow(500, "settlement_001");
    expect(await getEscrowBalance()).toBe(10_500);
  });

  it("can replenish after a debit", async () => {
    await debitEscrow(1_000, "txn_005");
    await creditEscrow(1_000, "settlement_002");
    expect(await getEscrowBalance()).toBe(10_000);
  });
});
