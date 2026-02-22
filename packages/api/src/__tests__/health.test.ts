import { describe, expect, it } from "bun:test";
import health from "../routes/health.js";

describe("GET /health", () => {
  it("returns 200", async () => {
    const res = await health.request("/");
    expect(res.status).toBe(200);
  });

  it("returns status ok", async () => {
    const res = await health.request("/");
    const body = await res.json() as unknown as { status: string; timestamp: string };
    expect(body.status).toBe("ok");
  });

  it("returns a valid ISO timestamp", async () => {
    const res = await health.request("/");
    const body = await res.json() as unknown as { status: string; timestamp: string };
    expect(new Date(body.timestamp).toString()).not.toBe("Invalid Date");
  });
});
