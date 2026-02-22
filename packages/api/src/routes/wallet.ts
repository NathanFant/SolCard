import { Hono } from "hono";
import { getSolBalance, getStakeAccounts } from "../lib/solana.js";
import type { WalletBalance } from "../types/index.js";

const wallet = new Hono();

wallet.get("/:address", async (c) => {
  const address = c.req.param("address");

  const [sol, staked] = await Promise.all([
    getSolBalance(address),
    getStakeAccounts(address),
  ]);

  // TODO: fetch real SOL/USD price from Jupiter price API
  const solUsdPrice = 150;
  const usd_value = (sol + staked) * solUsdPrice;

  const balance: WalletBalance = {
    address,
    sol_balance: sol,
    staked_sol: staked,
    usd_value,
  };

  return c.json(balance);
});

export default wallet;
