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

/**
 * Convert a hex string to a Uint8Array.
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Timing-safe comparison of two byte arrays.
 * Returns true only if both arrays are the same length and all bytes match.
 */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }

  return result === 0;
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

    // Parse received signature from hex string
    let receivedBytes: Uint8Array;
    try {
      receivedBytes = hexToBytes(signature);
    } catch {
      console.warn(
        `[marqeta-verify] Signature mismatch; source: ${c.req.header("x-forwarded-for") || c.req.header("host") || "unknown"}; timestamp: ${new Date().toISOString()}`
      );
      return c.json({ error: "Unauthorized" }, 401);
    }

    // Parse computed signature from hex string
    const expectedBytes = hexToBytes(computed);

    // Timing-safe comparison
    const isValid = timingSafeEqual(expectedBytes, receivedBytes);

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
