import { beforeEach, describe, expect, it } from "bun:test";
import { _resetForTesting } from "../lib/escrow.js";
import webhooks from "../routes/webhooks.js";
import type { JitFundingRequest, JitFundingResponse } from "../types/index.js";

function makeRequest(body: JitFundingRequest): Request {
  return new Request("http://localhost/jit-funding", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const basePayload: JitFundingRequest = {
  transaction_token: "txn_test_001",
  card_token: "card_abc",
  amount: 49.99,
  currency_code: "USD",
  merchant: { name: "Coffee Shop", city: "Austin", country: "US", mcc: "5812" },
};

beforeEach(() => {
  _resetForTesting();
});

describe("POST /jit-funding", () => {
  it("approves a transaction within escrow balance", async () => {
    const res = await webhooks.request(makeRequest(basePayload));
    expect(res.status).toBe(200);
  });

  it("returns the transaction token in the response", async () => {
    const res = await webhooks.request(makeRequest(basePayload));
    const body = await res.json() as unknown as JitFundingResponse;
    expect(body.jit_funding.token).toBe("txn_test_001");
  });

  it("echoes back the authorized amount", async () => {
    const res = await webhooks.request(makeRequest(basePayload));
    const body = await res.json() as unknown as JitFundingResponse;
    expect(body.jit_funding.amount).toBe(49.99);
  });

  it("declines a transaction that exceeds escrow balance", async () => {
    const res = await webhooks.request(
      makeRequest({ ...basePayload, amount: 999_999 })
    );
    expect(res.status).toBe(402);
  });

  it("sequential approvals reduce the escrow correctly", async () => {
    await webhooks.request(makeRequest({ ...basePayload, amount: 100 }));
    await webhooks.request(makeRequest({ ...basePayload, amount: 200 }));
    // 100 + 200 + 9_700 = 10_000 — fully drains the escrow
    const res = await webhooks.request(makeRequest({ ...basePayload, amount: 9_700 }));
    expect(res.status).toBe(200);
    // escrow is now zero — any further charge should be declined
    const declined = await webhooks.request(makeRequest({ ...basePayload, amount: 0.01 }));
    expect(declined.status).toBe(402);
  });
});
