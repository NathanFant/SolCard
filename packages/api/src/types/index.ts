export interface JitFundingRequest {
  transaction_token: string;
  card_token: string;
  amount: number;
  currency_code: string;
  merchant: {
    name: string;
    city: string;
    country: string;
    mcc: string;
  };
}

export interface JitFundingResponse {
  jit_funding: {
    token: string;
    method: "pgfs.authorization" | "pgfs.balanceinquiry";
    amount: number;
  };
}

export interface WalletBalance {
  address: string;
  sol_balance: number;
  staked_sol: number;
  usd_value: number;
}

export interface ConversionQuote {
  input_token: string;
  output_token: string;
  input_amount: number;
  output_amount: number;
  rate: number;
  slippage_bps: number;
  route_plan: string[];
}

export interface EscrowAccount {
  id: string;
  balance_usd: number;
  currency: string;
  updated_at: string;
}

/**
 * Per-user account state tracked in the off-chain authorization ledger.
 * sol_balance_usd and pending_sol_usd are denominated in USD at the
 * Pyth price at the time of the last update.
 *
 * available_sol_usd (derived) = sol_balance_usd - pending_sol_usd
 *
 * In production this lives in Postgres; here it is an in-memory mock.
 */
export interface UserAccount {
  card_token: string;
  /** USD value of the user's total SOL holdings at last known price */
  sol_balance_usd: number;
  /**
   * USD value of SOL soft-locked for in-flight swaps that have been
   * authorized but not yet settled. Incremented on authorization,
   * decremented on swap settlement.
   */
  pending_sol_usd: number;
}

/** Returned by authorizeTransaction — carries the lock amount needed for settlement */
export interface AuthorizationResult {
  approved: boolean;
  /**
   * USD value of SOL locked against this transaction.
   * Includes the volatility haircut so the reserved SOL covers the swap
   * even if price drops slightly before execution.
   * Zero when approved is false.
   */
  locked_sol_usd: number;
}
