import type { MiddlewareHandler } from "hono";

/**
 * Marqeta webhook signature verification middleware.
 *
 * Validates HMAC-SHA256 signatures on incoming Marqeta JIT funding requests.
 * Marqeta sends the signature in the X-Marqeta-Signature header as a hex-encoded string.
 *
 * Flow:
 *   1. Extract the signature from X-Marqeta-Signature header
 *   2. Clone the request body to compute HMAC
 *   3. Compute HMAC-SHA256 of raw body using the shared secret
 *   4. Perform timing-safe comparison
 *   5. Pass to next middleware if valid; return 401 if invalid
 */

const SIGNATURE_HEADER = "x-marqeta-signature";

export interface SignatureVerifyOptions {
  secret: string;
}

export function marqetaSignatureVerify(
  options: SignatureVerifyOptions
): MiddlewareHandler {
  const { secret } = options;

  return async (c, next) => {
    const signature = c.req.header(SIGNATURE_HEADER);

    // Missing signature header
    if (!signature) {
      console.warn(
        `[marqeta-verify] Missing ${SIGNATURE_HEADER} header; source: ${c.req.header("x-forwarded-for") || c.req.header("host") || "unknown"}`
      );
      return c.json({ error: "Unauthorized" }, 401);
    }

    // Clone the request to read the raw body without consuming it
    const clonedReq = c.req.raw.clone();
    let bodyBuffer: ArrayBuffer;

    try {
      bodyBuffer = await clonedReq.arrayBuffer();
    } catch (err) {
      console.warn(
        `[marqeta-verify] Failed to read request body; source: ${c.req.header("x-forwarded-for") || c.req.header("host") || "unknown"}`,
        err
      );
      return c.json({ error: "Unauthorized" }, 401);
    }

    // Empty body is invalid
    if (bodyBuffer.byteLength === 0) {
      console.warn(
        `[marqeta-verify] Empty request body; source: ${c.req.header("x-forwarded-for") || c.req.header("host") || "unknown"}`
      );
      return c.json({ error: "Unauthorized" }, 401);
    }

    // Compute HMAC-SHA256
    let computed: string;
    try {
      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );

      const signature_bytes = await crypto.subtle.sign("HMAC", key, bodyBuffer);
      computed = Array.from(new Uint8Array(signature_bytes))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    } catch (err) {
      console.error("[marqeta-verify] Failed to compute HMAC", err);
      return c.json({ error: "Unauthorized" }, 401);
    }

    // Timing-safe comparison
    const expectedBuf = Buffer.from(computed, "hex");
    const receivedBuf = Buffer.from(signature, "hex");

    let isValid = false;
    try {
      // crypto.timingSafeEqual throws if lengths differ; we check first
      if (expectedBuf.length === receivedBuf.length) {
        isValid = Buffer.from(expectedBuf).equals(receivedBuf);
      }
    } catch {
      // Lengths differ or comparison failed
      isValid = false;
    }

    if (!isValid) {
      console.warn(
        `[marqeta-verify] Signature mismatch; source: ${c.req.header("x-forwarded-for") || c.req.header("host") || "unknown"}; timestamp: ${new Date().toISOString()}`
      );
      return c.json({ error: "Unauthorized" }, 401);
    }

    // Signature is valid; proceed to next middleware
    await next();
  };
}
