import { PublicKey } from "@solana/web3.js";
import { getMint, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { getConnection } from "../program.js";

/**
 * Decimals and owning token program are fetched live per-mint and cached
 * in-process, rather than hardcoded — same reasoning as Trust Vault: a
 * static list drifts from whatever network the server actually points at.
 * Extra-relevant here since xStocks mints are Token-2022, not legacy SPL —
 * exactly the kind of thing a hardcoded "assume legacy Token" table gets
 * wrong.
 *
 * No symbol concept here either (no "AAPLx" label) — that mapping lives in
 * xstocksClient.ts (buildMintToSymbolMap), which is a distinct concern
 * (external API data, not on-chain mint data).
 */

interface MintInfo {
  decimals: number;
  programId: PublicKey;
}

const mintInfoCache = new Map<string, MintInfo>();

async function resolveMintInfo(mint: string): Promise<MintInfo> {
  const cached = mintInfoCache.get(mint);
  if (cached !== undefined) return cached;

  const connection = getConnection();
  const mintPubkey = new PublicKey(mint);

  const accountInfo = await connection.getAccountInfo(mintPubkey);
  if (!accountInfo) {
    throw new Error(
      `Mint account ${mint} not found on-chain via ${connection.rpcEndpoint}. ` +
        `Check SOLANA_RPC_URL is pointed at the same network this order was created on.`
    );
  }

  const owner = accountInfo.owner;
  let programId: PublicKey;
  if (owner.equals(TOKEN_PROGRAM_ID)) {
    programId = TOKEN_PROGRAM_ID;
  } else if (owner.equals(TOKEN_2022_PROGRAM_ID)) {
    programId = TOKEN_2022_PROGRAM_ID;
  } else {
    throw new Error(
      `Mint ${mint} is owned by program ${owner.toString()}, which is neither ` +
        `the legacy Token program nor Token-2022. Not a recognized token mint.`
    );
  }

  const mintInfo = await getMint(connection, mintPubkey, "confirmed", programId);
  const result: MintInfo = { decimals: mintInfo.decimals, programId };
  mintInfoCache.set(mint, result);
  return result;
}

export async function getDecimalsForMint(mint: string): Promise<number> {
  return (await resolveMintInfo(mint)).decimals;
}

export async function getTokenProgramForMint(mint: string): Promise<PublicKey> {
  return (await resolveMintInfo(mint)).programId;
}

export function normalizeMintFilter(token?: string): string | undefined {
  if (!token) return undefined;
  try {
    new PublicKey(token);
    return token;
  } catch {
    throw new Error(
      `"${token}" is not a valid mint address. Pass the token's actual mint ` +
        `address (or resolve one via get_xstock_price) — use list_open_orders ` +
        `with no token filter to see which mints currently have open orders.`
    );
  }
}
