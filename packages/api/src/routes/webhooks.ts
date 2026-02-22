import { Hono } from "hono";
import { debitEscrow } from "../lib/escrow.js";
import type { JitFundingRequest, JitFundingResponse } from "../types/index.js";

const webhooks = new Hono();

/**
 * Marqeta JIT (Just-In-Time) funding webhook.
 *
 * Marqeta calls this endpoint when a card is swiped. We must respond
 * within ~5 seconds to approve or deny the transaction.
 *
 * Flow:
 *   1. Validate the webhook signature (TODO: implement HMAC check)
 *   2. Check escrow balance
 *   3. Debit escrow if sufficient funds
 *   4. Respond to approve, triggering a background crypto-to-fiat swap
 */
webhooks.post("/jit-funding", async (c) => {
  const body = await c.req.json<JitFundingRequest>();

  // TODO: validate Marqeta webhook signature header
  const approved = await debitEscrow(body.amount, body.transaction_token);

  if (!approved) {
    return c.json({ error: "Insufficient escrow balance" }, 402);
  }

  // TODO: enqueue background job to convert SOL -> USD and replenish escrow

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
