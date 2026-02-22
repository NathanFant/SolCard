import { describe, expect, it } from "bun:test";
import health from "../routes/health.js";

describe("GET /health", () => {
  it("returns 200", async () => {
    const res = await health.request("/");
    const body = await res.text();
    expect(
      res.status,
      `expected HTTP 200, got ${res.status}; body: ${body}`
    ).toBe(200);
  });

  it("returns status ok", async () => {
    const res = await health.request("/");
    const body = await res.json() as unknown as {
      status: string;
      timestamp: string;
    };
    expect(
      body.status,
      `expected status "ok", got "${body.status}"; full body: ${JSON.stringify(body)}`
    ).toBe("ok");
  });

  it("returns a valid ISO timestamp", async () => {
    const res = await health.request("/");
    const body = await res.json() as unknown as {
      status: string;
      timestamp: string;
    };
    const parsed = new Date(body.timestamp);
    expect(
      parsed.toString(),
      `timestamp "${body.timestamp}" is not a valid ISO date`
    ).not.toBe("Invalid Date");
  });
});
