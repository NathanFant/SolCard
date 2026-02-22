import {
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
  type ParsedAccountData,
} from "@solana/web3.js";

const RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";

export const connection = new Connection(RPC_URL, "confirmed");

export async function getSolBalance(address: string): Promise<number> {
  const pubkey = new PublicKey(address);
  const lamports = await connection.getBalance(pubkey);
  return lamports / LAMPORTS_PER_SOL;
}

export async function getStakeAccounts(address: string): Promise<number> {
  const pubkey = new PublicKey(address);
  const stakeAccounts = await connection.getParsedProgramAccounts(
    new PublicKey("Stake11111111111111111111111111111111111111112"),
    {
      filters: [
        { dataSize: 200 },
        {
          memcmp: {
            offset: 44,
            bytes: pubkey.toBase58(),
          },
        },
      ],
    }
  );

  let totalStaked = 0;
  for (const account of stakeAccounts) {
    const data = account.account.data as ParsedAccountData;
    const lamports = data.parsed?.info?.stake?.delegation?.stake ?? 0;
    totalStaked += Number(lamports) / LAMPORTS_PER_SOL;
  }

  return totalStaked;
}
