// client/hooks/useTokenMetadata.ts
// Was missing entirely — `components/ui/select.tsx`'s custom `TokenSelect`
// imports this but it wasn't part of STOCKRAMP_FRONTEND_PLAN.md's file
// mapping, so it looks like `select.tsx` was copied from trust_vault without
// its dependency ever being ported alongside it.
//
// Implementation choice flagged, not assumed as final: this pulls from
// Jupiter's public token list (https://token.jup.ag/all) purely because it's
// a zero-dependency, no-API-key way to resolve {symbol, logoURI} for an
// arbitrary SPL mint without adding a new package. It is NOT xStocks-aware —
// it's a generic SPL token list, so xStocks mints may or may not resolve
// depending on whether Jupiter has indexed them. Once `XSTOCKS_MINTS` in
// `lib/constant.ts` is filled in, it'd likely be better to resolve xStocks
// symbols/logos from that fixed list directly instead of a network call.

"use client";

import { useEffect, useState } from "react";

export interface TokenMetadata {
  address: string;
  symbol?: string;
  name?: string;
  logoURI?: string;
  decimals?: number;
}

export interface UseTokenMetadataResult {
  metadata: TokenMetadata | undefined;
  isLoading: boolean;
  error: Error | null;
}

const JUPITER_TOKEN_LIST_URL = "https://token.jup.ag/all";

let tokenListPromise: Promise<Map<string, TokenMetadata>> | null = null;

function loadTokenList(): Promise<Map<string, TokenMetadata>> {
  if (!tokenListPromise) {
    tokenListPromise = fetch(JUPITER_TOKEN_LIST_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`Token list fetch failed: ${res.status}`);
        return res.json();
      })
      .then((tokens: Array<Record<string, unknown>>) => {
        const map = new Map<string, TokenMetadata>();
        for (const t of tokens) {
          const address = t.address as string | undefined;
          if (!address) continue;
          map.set(address, {
            address,
            symbol: t.symbol as string | undefined,
            name: t.name as string | undefined,
            logoURI: t.logoURI as string | undefined,
            decimals: t.decimals as number | undefined,
          });
        }
        return map;
      })
      .catch((err) => {
        // Allow a later call to retry instead of caching a permanent failure.
        tokenListPromise = null;
        throw err;
      });
  }
  return tokenListPromise;
}

/**
 * Resolves display metadata (symbol, logo) for a given SPL mint address.
 * Returns `{ metadata: undefined }` while loading or if the mint isn't found.
 */
export function useTokenMetadata(mint: string): UseTokenMetadataResult {
  const [metadata, setMetadata] = useState<TokenMetadata | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!mint) {
      setMetadata(undefined);
      setError(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    loadTokenList()
      .then((map) => {
        if (cancelled) return;
        setMetadata(map.get(mint));
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [mint]);

  return { metadata, isLoading, error };
}
