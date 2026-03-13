/**
 * SOL/USD rolling price cache.
 *
 * Fetches the Pyth Network on-chain SOL/USD feed once per second via a
 * background setInterval, regardless of transaction volume. Every JIT
 * authorization reads the cached price synchronously — zero async work
 * on the hot path.
 *
 * TODO: replace fetchPythPrice() stub with a real getAccountInfo call
 * against the Pyth SOL/USD feed pubkey using the shared RPC connection.
 *
 * Pyth feed pubkey (mainnet): H6ARHf6YXhGYeQfUzQNGFQt5S2g6MtZirkiDgx3TNPwF
 */

export interface PriceData {
  /** Mid-market SOL/USD price */
  price: number;
  /**
   * Pyth confidence interval in USD.
   * Represents ±1σ uncertainty across contributing market makers.
   * Used to compute the volatility premium in the spread formula:
   *   volatility_premium_bps = (confidence / price) × 10_000
   */
  confidence: number;
  /** Unix timestamp (ms) of the last successful fetch */
  fetchedAt: number;
}

/**
 * How old the cached price can be before a transaction is hard-declined.
 * A stale cache indicates a broken refresher or RPC outage — pricing
 * against stale data risks funding swaps that can't break even.
 */
const STALE_THRESHOLD_MS = 60_000;

/** Refresh interval — 1 fetch/second ≈ 86,400 getAccountInfo calls/day */
const REFRESH_INTERVAL_MS = 1_000;

/**
 * Conservative haircut applied to the price when computing the SOL soft-lock.
 * Ensures the reserved SOL covers the transaction even if price drops slightly
 * between authorization and swap execution.
 * Value derived from Pyth confidence interval at runtime; this is the floor.
 */
export const LOCK_HAIRCUT_BPS = 200; // 2% floor

let cache: PriceData = {
  price: 0,
  confidence: 0,
  fetchedAt: 0,
};

/**
 * Fetch the current SOL/USD price from Pyth.
 * TODO: replace with real Pyth getAccountInfo + parsePriceData call.
 */
async function fetchPythPrice(): Promise<PriceData> {
  // Stub — hardcoded until Pyth RPC integration is implemented.
  // In production: read the Pyth SOL/USD feed account, parse the price
  // and confidence fields from the PriceFeed account data.
  return {
    price: 150,
    confidence: 0.5, // ±$0.50 — realistic for a liquid market
    fetchedAt: Date.now(),
  };
}

async function refresh(): Promise<void> {
  try {
    cache = await fetchPythPrice();
  } catch {
    // Keep the existing cache on failure — staleness check will catch it
    // if the outage persists past STALE_THRESHOLD_MS.
  }
}

// Kick off the background refresher immediately on module load.
// The first fetch runs synchronously so the cache is warm before any
// request can arrive. Subsequent fetches run every REFRESH_INTERVAL_MS.
refresh();
const _interval = setInterval(refresh, REFRESH_INTERVAL_MS);

// Prevent the interval from keeping the process alive in test environments.
if (typeof _interval.unref === "function") {
  _interval.unref();
}

/**
 * Returns the current cached SOL/USD price.
 * Throws if the cache is stale (refresher broken or RPC outage).
 */
export function getPrice(): PriceData {
  if (cache.fetchedAt === 0) {
    throw new Error("[price] Cache not yet initialized");
  }
  if (Date.now() - cache.fetchedAt > STALE_THRESHOLD_MS) {
    throw new Error(
      `[price] Cache stale — last fetch ${Date.now() - cache.fetchedAt}ms ago (threshold: ${STALE_THRESHOLD_MS}ms)`
    );
  }
  return cache;
}

/** Override the cache — only for use in tests. */
export function _setPriceForTesting(data: PriceData): void {
  cache = data;
}
