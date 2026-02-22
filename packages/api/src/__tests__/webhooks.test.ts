import { beforeEach, describe, expect, it } from "bun:test";
import { _resetForTesting } from "../lib/escrow.js";
import webhooks from "../routes/webhooks.js";
import type { JitFundingRequest, JitFundingResponse } from "../types/index.js";

const SECRET = process.env.MARQETA_WEBHOOK_SECRET || "";

/**
 * Helper to compute a valid HMAC-SHA256 signature for a given payload.
 */
async function computeSignature(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature_bytes = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload)
  );

  return Array.from(new Uint8Array(signature_bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function makeRequest(
  body: JitFundingRequest,
  signature?: string
): Request {
  const bodyStr = JSON.stringify(body);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (signature) {
    headers["x-marqeta-signature"] = signature;
  }

  return new Request("http://localhost/jit-funding", {
    method: "POST",
    headers,
    body: bodyStr,
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
  it("rejects requests without a signature header", async () => {
    const { status, body } = await readResponse(
      await webhooks.request(makeRequest(basePayload))
    );
    expect(status).toBe(401);
    expect((body as Record<string, unknown>).error).toBe("Unauthorized");
  });

  it("rejects requests with an invalid signature", async () => {
    const invalidSignature = "0".repeat(64);
    const { status, body } = await readResponse(
      await webhooks.request(makeRequest(basePayload, invalidSignature))
    );
    expect(status).toBe(401);
    expect((body as Record<string, unknown>).error).toBe("Unauthorized");
  });

  it("approves a transaction within escrow balance with valid signature", async () => {
    const bodyStr = JSON.stringify(basePayload);
    const signature = await computeSignature(bodyStr);

    const { status, text } = await readResponse(
      await webhooks.request(makeRequest(basePayload, signature))
    );
    expect(
      status,
      `expected 200 for $${basePayload.amount} charge; body: ${text}`
    ).toBe(200);
  });

  it("returns the transaction token in the response with valid signature", async () => {
    const bodyStr = JSON.stringify(basePayload);
    const signature = await computeSignature(bodyStr);

    const { text, body } = await readResponse(
      await webhooks.request(makeRequest(basePayload, signature))
    );
    const jit = (body as JitFundingResponse).jit_funding;
    expect(
      jit.token,
      `expected token "txn_test_001", got "${jit.token}"; body: ${text}`
    ).toBe("txn_test_001");
  });

  it("echoes back the authorized amount with valid signature", async () => {
    const bodyStr = JSON.stringify(basePayload);
    const signature = await computeSignature(bodyStr);

    const { text, body } = await readResponse(
      await webhooks.request(makeRequest(basePayload, signature))
    );
    const jit = (body as JitFundingResponse).jit_funding;
    expect(
      jit.amount,
      `expected amount ${basePayload.amount}, got ${jit.amount}; body: ${text}`
    ).toBe(49.99);
  });

  it("response shape matches snapshot with valid signature", async () => {
    const bodyStr = JSON.stringify(basePayload);
    const signature = await computeSignature(bodyStr);

    const { body } = await readResponse(
      await webhooks.request(makeRequest(basePayload, signature))
    );
    expect(body).toMatchSnapshot();
  });

  it("declines a transaction that exceeds escrow balance with valid signature", async () => {
    const payload = { ...basePayload, amount: 999_999 };
    const bodyStr = JSON.stringify(payload);
    const signature = await computeSignature(bodyStr);

    const { status, text } = await readResponse(
      await webhooks.request(makeRequest(payload, signature))
    );
    expect(
      status,
      `expected 402 for $999,999 charge against $10,000 escrow; body: ${text}`
    ).toBe(402);
  });

  it("sequential approvals reduce the escrow correctly with valid signatures", async () => {
    const payload1 = { ...basePayload, amount: 100 };
    const bodyStr1 = JSON.stringify(payload1);
    const sig1 = await computeSignature(bodyStr1);

    const payload2 = { ...basePayload, amount: 200 };
    const bodyStr2 = JSON.stringify(payload2);
    const sig2 = await computeSignature(bodyStr2);

    const payload3 = { ...basePayload, amount: 9_700 };
    const bodyStr3 = JSON.stringify(payload3);
    const sig3 = await computeSignature(bodyStr3);

    const payload4 = { ...basePayload, amount: 0.01 };
    const bodyStr4 = JSON.stringify(payload4);
    const sig4 = await computeSignature(bodyStr4);

    await webhooks.request(makeRequest(payload1, sig1));
    await webhooks.request(makeRequest(payload2, sig2));

    // 100 + 200 + 9_700 = 10_000 — fully drains the escrow
    const { status: s1, text: t1 } = await readResponse(
      await webhooks.request(makeRequest(payload3, sig3))
    );
    expect(
      s1,
      `third charge ($9,700) should be approved (100+200+9700=$10,000); body: ${t1}`
    ).toBe(200);

    // escrow is now $0 — any further charge should be declined
    const { status: s2, text: t2 } = await readResponse(
      await webhooks.request(makeRequest(payload4, sig4))
    );
    expect(
      s2,
      `charge after escrow fully drained should be declined; body: ${t2}`
    ).toBe(402);
  });
});
