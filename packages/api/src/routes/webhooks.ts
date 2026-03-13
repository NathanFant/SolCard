import { Hono } from "hono";
import { authorizeTransaction } from "../lib/escrow.js";
import type { JitFundingRequest, JitFundingResponse } from "../types/index.js";

const webhooks = new Hono();

/**
 * Marqeta JIT (Just-In-Time) funding webhook.
 *
 * Marqeta calls this endpoint when a card is swiped. Must respond within ~5s.
 *
 * Authorization flow:
 *   1. Validate HMAC-SHA256 signature (TODO: re-add marqetaSignatureVerify middleware)
 *   2. Call authorizeTransaction() — checks sol_balance_usd - pending_sol_usd >= amount
 *      and soft-locks SOL (pending_sol_usd += locked_sol_usd)
 *   3. If approved: respond 200, enqueue Jupiter swap job (TODO: BullMQ)
 *   4. If declined due to insufficient SOL: respond 402
 *   5. If price cache is stale: respond 503
 *
 * Decline reasons:
 *   402 — user does not have sufficient SOL to cover the transaction
 *   503 — Pyth price cache is stale; cannot safely authorize (RPC outage)
 */
webhooks.post("/jit-funding", async (c) => {
  const body = await c.req.json<JitFundingRequest>();

  // Validate amount — must be a finite positive number.
  // Rejects: negative amounts, zero, NaN, Infinity, and non-numeric types.
  if (typeof body.amount !== "number" || !Number.isFinite(body.amount) || body.amount <= 0) {
    return c.json({ error: "Invalid amount" }, 400);
  }

  let result;
  try {
    result = await authorizeTransaction(
      body.card_token,
      body.amount,
      body.transaction_token
    );
  } catch (err) {
    // getPrice() throws when the cache is stale — cannot authorize safely
    console.error("[jit-funding] price cache unavailable:", err);
    return c.json({ error: "Price feed unavailable" }, 503);
  }

  if (!result.approved) {
    return c.json({ error: "Insufficient funds" }, 402);
  }

  // TODO: enqueue BullMQ swap job with:
  //   { card_token, transaction_token, amount, locked_sol_usd: result.locked_sol_usd }
  // The swap worker calls settleTransaction() on completion.

  const response: JitFundingResponse = {
    jit_funding: {
      token: body.transaction_token,
      method: "pgfs.authorization",
      amount: body.amount,
    },
  };

  return c.json(response, 200);
});

export default webhooks;
