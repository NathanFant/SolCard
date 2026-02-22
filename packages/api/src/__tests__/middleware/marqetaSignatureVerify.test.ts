import { beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { marqetaSignatureVerify } from "../../middleware/marqetaSignatureVerify.js";

const SECRET = "test_webhook_secret_key";

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

/**
 * Helper to make a request with optional signature header.
 */
function makeRequest(
  body: string,
  signature?: string
): Request {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (signature) {
    headers["x-marqeta-signature"] = signature;
  }

  return new Request("http://localhost/test", {
    method: "POST",
    headers,
    body,
  });
}

/**
 * Helper to read the full response.
 */
async function readResponse(
  res: Response
): Promise<{ status: number; body: unknown }> {
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

describe("marqetaSignatureVerify middleware", () => {
  it("allows requests with a valid signature", async () => {
    const payload = JSON.stringify({ transaction_token: "txn_001", amount: 50 });
    const signature = await computeSignature(payload);

    const app = new Hono();
    app.post(
      "/test",
      marqetaSignatureVerify({ secret: SECRET }),
      (c) => c.json({ status: "ok" })
    );

    const res = await app.request(makeRequest(payload, signature));
    const { status, body } = await readResponse(res);

    expect(status).toBe(200);
    expect((body as Record<string, unknown>).status).toBe("ok");
  });

  it("rejects requests with an invalid signature", async () => {
    const payload = JSON.stringify({ transaction_token: "txn_002", amount: 75 });
    const invalidSignature = "0".repeat(64); // 64 hex chars = 32 bytes

    const app = new Hono();
    app.post(
      "/test",
      marqetaSignatureVerify({ secret: SECRET }),
      (c) => c.json({ status: "ok" })
    );

    const res = await app.request(makeRequest(payload, invalidSignature));
    const { status, body } = await readResponse(res);

    expect(status).toBe(401);
    expect((body as Record<string, unknown>).error).toBe("Unauthorized");
  });

  it("rejects requests with a missing signature header", async () => {
    const payload = JSON.stringify({ transaction_token: "txn_003", amount: 100 });

    const app = new Hono();
    app.post(
      "/test",
      marqetaSignatureVerify({ secret: SECRET }),
      (c) => c.json({ status: "ok" })
    );

    const res = await app.request(makeRequest(payload)); // no signature
    const { status, body } = await readResponse(res);

    expect(status).toBe(401);
    expect((body as Record<string, unknown>).error).toBe("Unauthorized");
  });

  it("rejects requests with an empty body", async () => {
    const payload = "";
    const signature = await computeSignature(payload);

    const app = new Hono();
    app.post(
      "/test",
      marqetaSignatureVerify({ secret: SECRET }),
      (c) => c.json({ status: "ok" })
    );

    const res = await app.request(makeRequest(payload, signature));
    const { status, body } = await readResponse(res);

    expect(status).toBe(401);
    expect((body as Record<string, unknown>).error).toBe("Unauthorized");
  });

  it("performs timing-safe comparison", async () => {
    const payload = JSON.stringify({ transaction_token: "txn_004", amount: 25 });
    const validSignature = await computeSignature(payload);

    const app = new Hono();
    let comparisonUsed = false;

    app.post(
      "/test",
      marqetaSignatureVerify({ secret: SECRET }),
      (c) => {
        comparisonUsed = true;
        return c.json({ status: "ok" });
      }
    );

    // Request with valid signature should succeed
    const res = await app.request(makeRequest(payload, validSignature));
    const { status } = await readResponse(res);

    expect(status).toBe(200);
    expect(comparisonUsed).toBe(true);
  });

  it("rejects requests with mismatched signature length", async () => {
    const payload = JSON.stringify({ transaction_token: "txn_005", amount: 60 });
    const tooShortSignature = "aa"; // 2 hex chars = 1 byte, way too short

    const app = new Hono();
    app.post(
      "/test",
      marqetaSignatureVerify({ secret: SECRET }),
      (c) => c.json({ status: "ok" })
    );

    const res = await app.request(makeRequest(payload, tooShortSignature));
    const { status, body } = await readResponse(res);

    expect(status).toBe(401);
    expect((body as Record<string, unknown>).error).toBe("Unauthorized");
  });

  it("handles case-insensitive header names", async () => {
    const payload = JSON.stringify({ transaction_token: "txn_006", amount: 40 });
    const signature = await computeSignature(payload);

    const app = new Hono();
    app.post(
      "/test",
      marqetaSignatureVerify({ secret: SECRET }),
      (c) => c.json({ status: "ok" })
    );

    // Hono normalizes header names to lowercase
    const req = new Request("http://localhost/test", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Marqeta-Signature": signature, // uppercase variant
      },
      body: payload,
    });

    const res = await app.request(req);
    const { status } = await readResponse(res);

    expect(status).toBe(200);
  });

  it("rejects requests where signature is invalid hex", async () => {
    const payload = JSON.stringify({ transaction_token: "txn_007", amount: 55 });
    const invalidHex = "ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ"; // not hex

    const app = new Hono();
    app.post(
      "/test",
      marqetaSignatureVerify({ secret: SECRET }),
      (c) => c.json({ status: "ok" })
    );

    const res = await app.request(makeRequest(payload, invalidHex));
    const { status, body } = await readResponse(res);

    expect(status).toBe(401);
    expect((body as Record<string, unknown>).error).toBe("Unauthorized");
  });

  it("allows the downstream handler to still parse the body", async () => {
    const payload = JSON.stringify({
      transaction_token: "txn_008",
      card_token: "card_xyz",
      amount: 85,
    });
    const signature = await computeSignature(payload);

    const app = new Hono();
    app.post(
      "/test",
      marqetaSignatureVerify({ secret: SECRET }),
      async (c) => {
        const body = await c.req.json();
        return c.json({ received: body });
      }
    );

    const res = await app.request(makeRequest(payload, signature));
    const { status, body } = await readResponse(res);

    expect(status).toBe(200);
    expect((body as Record<string, unknown>).received).toEqual({
      transaction_token: "txn_008",
      card_token: "card_xyz",
      amount: 85,
    });
  });

  it("rejects requests with a different secret", async () => {
    const payload = JSON.stringify({ transaction_token: "txn_009", amount: 90 });
    const wrongSecret = "different_secret";
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(wrongSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const signature_bytes = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(payload)
    );

    const signature = Array.from(new Uint8Array(signature_bytes))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const app = new Hono();
    app.post(
      "/test",
      marqetaSignatureVerify({ secret: SECRET }), // using different secret
      (c) => c.json({ status: "ok" })
    );

    const res = await app.request(makeRequest(payload, signature));
    const { status, body } = await readResponse(res);

    expect(status).toBe(401);
    expect((body as Record<string, unknown>).error).toBe("Unauthorized");
  });

  it("handles large payloads correctly", async () => {
    const largePayload = JSON.stringify({
      transaction_token: "txn_large",
      amount: 999,
      data: "x".repeat(10000),
    });
    const signature = await computeSignature(largePayload);

    const app = new Hono();
    app.post(
      "/test",
      marqetaSignatureVerify({ secret: SECRET }),
      (c) => c.json({ status: "ok" })
    );

    const res = await app.request(makeRequest(largePayload, signature));
    const { status } = await readResponse(res);

    expect(status).toBe(200);
  });
});
