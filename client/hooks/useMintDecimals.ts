// client/hooks/useMintDecimals.ts
// React-query wrapper around `fetchMintDecimals` (lib/tokenAmount.ts) so any
// component that has to convert between UI tokens and base units can get the
// mint's decimals without each one hand-rolling a getMint call (and without
// each one having to know whether the mint is classic SPL or Token-2022).
//
// Returns `undefined` until resolved — callers should treat that as "don't
// render or submit an amount yet" rather than defaulting to 0 decimals,
// which would silently send an unscaled amount to the program.

"use client";

import { useQuery } from "@tanstack/react-query";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";

import { fetchMintDecimals } from "@/lib/tokenAmount";

export function mintDecimalsQueryKey(mint?: string) {
  return ["mint-decimals", mint ?? null] as const;
}

export function useMintDecimals(mint?: PublicKey | string | null): number | undefined {
  const { connection } = useConnection();
  const mintStr = typeof mint === "string" ? mint : mint?.toBase58();

  const { data } = useQuery({
    queryKey: mintDecimalsQueryKey(mintStr),
    queryFn: () => fetchMintDecimals(connection, new PublicKey(mintStr!)),
    enabled: !!mintStr,
    // Decimals are immutable for a given mint.
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
  });

  return data;
}
