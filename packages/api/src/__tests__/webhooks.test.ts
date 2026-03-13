import { beforeEach, describe, expect, it } from "bun:test";
import { _resetForTesting } from "../lib/escrow.js";
import { _setPriceForTesting } from "../lib/price.js";
import webhooks from "../routes/webhooks.js";
import type { JitFundingRequest, JitFundingResponse } from "../types/index.js";

const MOCK_PRICE = { price: 150, confidence: 0.5, fetchedAt: Date.now() };

function makeRequest(body: JitFundingRequest): Request {
  return makeRawRequest(body);
}

/** Send an arbitrary payload — used for invalid-input tests that bypass the TS type. */
function makeRawRequest(body: unknown): Request {
  return new Request("http://localhost/jit-funding", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function readResponse(
  res: Response
): Promise<{ status: number; text: string; body: unknown }> {
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, text, body };
}

// card_abc has $10,000 sol_balance_usd in the mock
const basePayload: JitFundingRequest = {
  transaction_token: "txn_test_001",
  card_token: "card_abc",
  amount: 49.99,
  currency_code: "USD",
  merchant: {
    name: "Coffee Shop",
    city: "Austin",
    country: "US",
    mcc: "5812",
  },
};

beforeEach(() => {
  _resetForTesting();
  _setPriceForTesting({ ...MOCK_PRICE, fetchedAt: Date.now() });
});

describe("POST /jit-funding", () => {
  it("approves a transaction within escrow balance", async () => {
    const { status, text } = await readResponse(
      await webhooks.request(makeRequest(basePayload))
    );
    expect(
      status,
      `expected 200 for $${basePayload.amount} charge; body: ${text}`
    ).toBe(200);
  });

  it("returns the transaction token in the response", async () => {
    const { text, body } = await readResponse(
      await webhooks.request(makeRequest(basePayload))
    );
    const jit = (body as JitFundingResponse).jit_funding;
    expect(
      jit.token,
      `expected token "txn_test_001", got "${jit.token}"; body: ${text}`
    ).toBe("txn_test_001");
  });

  it("echoes back the authorized amount", async () => {
    const { text, body } = await readResponse(
      await webhooks.request(makeRequest(basePayload))
    );
    const jit = (body as JitFundingResponse).jit_funding;
    expect(
      jit.amount,
      `expected amount ${basePayload.amount}, got ${jit.amount}; body: ${text}`
    ).toBe(49.99);
  });

  it("response shape matches snapshot", async () => {
    const { body } = await readResponse(
      await webhooks.request(makeRequest(basePayload))
    );
    expect(body).toMatchSnapshot();
  });

  it("declines when the user has insufficient SOL", async () => {
    // card_low has only $50 sol_balance_usd
    const { status, text } = await readResponse(
      await webhooks.request(makeRequest({ ...basePayload, card_token: "card_low", amount: 999 }))
    );
    expect(
      status,
      `expected 402 for $999 charge against $50 SOL balance; body: ${text}`
    ).toBe(402);
  });

  it("declines an unknown card token", async () => {
    const { status } = await readResponse(
      await webhooks.request(makeRequest({ ...basePayload, card_token: "card_unknown" }))
    );
    expect(status).toBe(402);
  });

  it("sequential approvals reduce available SOL correctly", async () => {
    // card_abc has $10,000 — spend it down in three swipes
    await webhooks.request(makeRequest({ ...basePayload, amount: 100, transaction_token: "t1" }));
    await webhooks.request(makeRequest({ ...basePayload, amount: 200, transaction_token: "t2" }));

    // Third charge pushes pending close to the $10,000 limit
    const { status: s1, text: t1 } = await readResponse(
      await webhooks.request(makeRequest({ ...basePayload, amount: 9_500, transaction_token: "t3" }))
    );
    expect(s1, `third charge should be approved; body: ${t1}`).toBe(200);

    // Remaining available SOL is now very small — a large charge should be declined
    const { status: s2, text: t2 } = await readResponse(
      await webhooks.request(makeRequest({ ...basePayload, amount: 500, transaction_token: "t4" }))
    );
    expect(s2, `charge after SOL near-fully committed should be declined; body: ${t2}`).toBe(402);
  });

  // ---------------------------------------------------------------------------
  // Amount validation
  // ---------------------------------------------------------------------------

  it("rejects a negative amount with 400", async () => {
    const { status, body } = await readResponse(
      await webhooks.request(makeRawRequest({ ...basePayload, amount: -10 }))
    );
    expect(status).toBe(400);
    expect((body as Record<string, unknown>).error).toBe("Invalid amount");
  });

  it("rejects a zero amount with 400", async () => {
    const { status, body } = await readResponse(
      await webhooks.request(makeRawRequest({ ...basePayload, amount: 0 }))
    );
    expect(status).toBe(400);
    expect((body as Record<string, unknown>).error).toBe("Invalid amount");
  });

  it("rejects a string amount with 400", async () => {
    const { status, body } = await readResponse(
      await webhooks.request(makeRawRequest({ ...basePayload, amount: "42" }))
    );
    expect(status).toBe(400);
    expect((body as Record<string, unknown>).error).toBe("Invalid amount");
  });

  it("rejects NaN amount with 400", async () => {
    const { status, body } = await readResponse(
      // JSON.stringify(NaN) produces "null", so send the raw string manually
      await webhooks.request(new Request("http://localhost/jit-funding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...basePayload, amount: null }),
      }))
    );
    expect(status).toBe(400);
    expect((body as Record<string, unknown>).error).toBe("Invalid amount");
  });

  it("rejects Infinity amount with 400", async () => {
    // JSON.stringify(Infinity) produces "null"
    const { status, body } = await readResponse(
      await webhooks.request(makeRawRequest({ ...basePayload, amount: null }))
    );
    expect(status).toBe(400);
    expect((body as Record<string, unknown>).error).toBe("Invalid amount");
  });

  it("returns 503 when the price cache is stale", async () => {
    _setPriceForTesting({ price: 150, confidence: 0.5, fetchedAt: Date.now() - 120_000 });
    const { status } = await readResponse(
      await webhooks.request(makeRequest(basePayload))
    );
    expect(status).toBe(503);
  });
});
