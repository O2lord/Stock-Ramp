// client/hooks/useXStocksTokenList.ts
// Builds the token picker list for CreateBuyDialog / CreateSellOrderDialog's
// mint selector — mirrors trust_vault's CreateBuyDialog.tsx `fetchTokens()`
// effect (allowed mints -> on-chain ATA balance lookup, falling back to
// zero balance when there's no wallet or no account yet), but sourced from
// our static `XSTOCKS_MINTS` map (lib/constant.ts) instead of a
// `NEXT_PUBLIC_ALLOWED_MINTS` env var, since that map is already the
// definitive list of devnet stand-ins for this project.

"use client";

import { useEffect, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { XSTOCKS_MINTS } from "@/lib/constant";
import type { TokenInfo } from "@/components/ui/select";

/**
 * { symbol, mint, balance } for every entry in XSTOCKS_MINTS. Balances are
 * resolved from the connected wallet's associated token account for each
 * mint — 0 when no wallet is connected, or when the wallet simply doesn't
 * hold that token yet (both are valid states, not errors).
 */
export function useXStocksTokenList(owner: PublicKey | null | undefined): TokenInfo[] {
  const { connection } = useConnection();
  const [balances, setBalances] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;

    if (!owner) {
      setBalances({});
      return;
    }

    (async () => {
      const entries = await Promise.all(
        Object.values(XSTOCKS_MINTS).map(async (mint) => {
          try {
            const ataAddress = getAssociatedTokenAddressSync(
              new PublicKey(mint),
              owner,
              true,
              TOKEN_PROGRAM_ID
            );
            const info = await connection.getParsedAccountInfo(ataAddress);
            const parsed =
              info.value && "parsed" in info.value.data ? info.value.data.parsed : null;
            const balance = parsed?.info?.tokenAmount?.uiAmount ?? 0;
            return [mint, balance] as const;
          } catch {
            // No account for this mint yet (or an RPC hiccup) — treat as 0,
            // same as trust_vault's fetchTokens() fallback.
            return [mint, 0] as const;
          }
        })
      );
      if (!cancelled) setBalances(Object.fromEntries(entries));
    })();

    return () => {
      cancelled = true;
    };
  }, [owner, connection]);

  return Object.entries(XSTOCKS_MINTS).map(([symbol, mint]) => ({
    mint,
    symbol,
    balance: balances[mint] ?? 0,
  }));
}
