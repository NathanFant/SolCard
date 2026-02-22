import { Hono } from "hono";
import { cors } from "hono/cors";
import { requestLogger } from "./middleware/logger.js";
import health from "./routes/health.js";
import wallet from "./routes/wallet.js";
import webhooks from "./routes/webhooks.js";

// Validate required environment variables at startup (only in production)
// In test/dev, the routes use fallback values
const isProduction = process.env.NODE_ENV === "production";
const requiredEnvVars = ["MARQETA_WEBHOOK_SECRET"];

if (isProduction) {
  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      throw new Error(
        `Required environment variable ${envVar} is not set. Please check your .env file and configuration.`
      );
    }
  }
}

const app = new Hono();
const PORT = Number(process.env.PORT ?? 3001);

app.use("*", cors({ origin: process.env.CORS_ORIGIN ?? "http://localhost:5173" }));
app.use("*", requestLogger);

app.route("/health", health);
app.route("/wallet", wallet);
app.route("/webhooks", webhooks);

app.notFound((c) => c.json({ error: "Not found" }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Internal server error" }, 500);
});

console.log(`API listening on http://localhost:${PORT}`);

export default {
  port: PORT,
  fetch: app.fetch,
};
