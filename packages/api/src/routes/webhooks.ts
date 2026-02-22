import { Hono } from "hono";
import { marqetaSignatureVerify } from "../middleware/marqetaSignatureVerify.js";
import { debitEscrow } from "../lib/escrow.js";
import type { JitFundingRequest, JitFundingResponse } from "../types/index.js";

const webhooks = new Hono();

// Get the webhook secret from environment (validated at server startup in index.ts)
const marqetaSecret = process.env.MARQETA_WEBHOOK_SECRET || "";

// Apply signature verification middleware only to the JIT funding route
webhooks.post(
  "/jit-funding",
  marqetaSignatureVerify({ secret: marqetaSecret }),
  async (c) => {
    const body = await c.req.json<JitFundingRequest>();

    // Signature has already been validated by middleware
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
  }
);

export default webhooks;
