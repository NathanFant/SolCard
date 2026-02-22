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

/** Read the full response text and parse it, so both are available for
 *  diagnostic messages without consuming the body twice. */
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

  it("declines a transaction that exceeds escrow balance", async () => {
    const { status, text } = await readResponse(
      await webhooks.request(makeRequest({ ...basePayload, amount: 999_999 }))
    );
    expect(
      status,
      `expected 402 for $999,999 charge against $10,000 escrow; body: ${text}`
    ).toBe(402);
  });

  it("sequential approvals reduce the escrow correctly", async () => {
    await webhooks.request(makeRequest({ ...basePayload, amount: 100 }));
    await webhooks.request(makeRequest({ ...basePayload, amount: 200 }));

    // 100 + 200 + 9_700 = 10_000 — fully drains the escrow
    const { status: s1, text: t1 } = await readResponse(
      await webhooks.request(makeRequest({ ...basePayload, amount: 9_700 }))
    );
    expect(
      s1,
      `third charge ($9,700) should be approved (100+200+9700=$10,000); body: ${t1}`
    ).toBe(200);

    // escrow is now $0 — any further charge should be declined
    const { status: s2, text: t2 } = await readResponse(
      await webhooks.request(makeRequest({ ...basePayload, amount: 0.01 }))
    );
    expect(
      s2,
      `charge after escrow fully drained should be declined; body: ${t2}`
    ).toBe(402);
  });
});
