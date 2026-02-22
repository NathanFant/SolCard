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
