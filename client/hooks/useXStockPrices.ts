// client/hooks/useXStockPrices.ts
// Client-side USD price feed for xStocks symbols, mirroring
// `keeper/src/xstocksClient.ts`'s public API calls (browser-safe: no keypair,
// read-only GET requests against api.xstocks.fi).
//
// NOTE: this intentionally duplicates keeper/src/xstocksClient.ts's fetch
// logic rather than importing it — that file lives outside `client/`'s
// TS project (separate package/tsconfig, and it's Node-oriented: no
// "use client" boundary).

"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { XSTOCKS_MINTS } from "@/lib/constant";

const XSTOCKS_API_BASE =
  process.env.NEXT_PUBLIC_XSTOCKS_API_BASE || "https://api.xstocks.fi/api/v2";

interface XStocksAssetDeployment {
  network: string;
  address?: string;
  contractAddress?: string;
  tokenAddress?: string;
  mintAddress?: string;
  [key: string]: unknown;
}

interface XStocksAsset {
  id: string;
  name: string;
  symbol: string;
  isin: string;
  isTradingHalted: boolean;
  deployments: XStocksAssetDeployment[];
}

interface XStocksAssetListResponse {
  nodes: XStocksAsset[];
  page: { currentPage: number; hasNextPage: boolean };
}

async function xstocksGet<T>(path: string): Promise<T> {
  const res = await fetch(`${XSTOCKS_API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    throw new Error(`xStocks API ${path} returned ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function listAllAssets(): Promise<XStocksAsset[]> {
  const all: XStocksAsset[] = [];
  let page = 0;
  for (;;) {
    const resp = await xstocksGet<XStocksAssetListResponse>(
      `/public/assets?page=${page}&pageSize=200`
    );
    all.push(...resp.nodes);
    if (!resp.page.hasNextPage) break;
    page += 1;
  }
  return all;
}

async function getUsdPrice(symbol: string): Promise<number> {
  const resp = await xstocksGet<{ quote: number }>(
    `/public/assets/${encodeURIComponent(symbol)}/price-data`
  );
  return resp.quote;
}

function extractSolanaMint(asset: XStocksAsset): string | null {
  const solanaDeployment = asset.deployments.find(
    (d) => typeof d.network === "string" && d.network.toLowerCase() === "solana"
  );
  if (!solanaDeployment) return null;
  return (
    solanaDeployment.address ||
    solanaDeployment.contractAddress ||
    solanaDeployment.tokenAddress ||
    solanaDeployment.mintAddress ||
    null
  );
}

/**
 * Reverse (mint -> symbol) lookup over the static `XSTOCKS_MINTS` map (see
 * lib/constant.ts) — the devnet stand-ins minted for this project. These
 * will never appear in the live mainnet asset list below, so this map is
 * always checked first.
 */
const STATIC_MINT_TO_SYMBOL: Record<string, string> = Object.fromEntries(
  Object.entries(XSTOCKS_MINTS).map(([symbol, mint]) => [mint, symbol])
);

/** Resolves a mint address to its xStocks symbol via the static stand-in map only. */
export function mintToXStockSymbol(mint: string | null | undefined): string | undefined {
  if (!mint) return undefined;
  return STATIC_MINT_TO_SYMBOL[mint];
}

/** Full xStocks asset list (symbol, name, mint deployments). Cached 1hr. */
export function useXStockAssets() {
  return useQuery({
    queryKey: ["xstocks", "assets"],
    queryFn: listAllAssets,
    staleTime: 60 * 60 * 1000,
  });
}

/**
 * Live USD quote for a single symbol (e.g. "AAPLx"), fetched directly from
 * the browser against api.xstocks.fi. Kept around for callers that
 * specifically want that direct path, but prefer `useOrderUsdQuote` below
 * for anything user-facing — this hits a third-party API straight from the
 * browser, so it silently never resolves if that API doesn't allow
 * cross-origin requests from wherever this app is hosted.
 */
export function useXStockPrice(symbol: string | null | undefined) {
  return useQuery({
    queryKey: ["xstocks", "price", symbol],
    queryFn: () => getUsdPrice(symbol as string),
    enabled: !!symbol,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

/**
 * Live USD quotes for several symbols at once, fetched directly from the
 * browser — same caveat as `useXStockPrice` above. Prefer
 * `useXStockPricesProxied` below for anything user-facing.
 */
export function useXStockPrices(symbols: string[]) {
  const key = [...symbols].sort().join(",");
  return useQuery({
    queryKey: ["xstocks", "prices", key],
    queryFn: async () => {
      const entries = await Promise.all(
        symbols.map(async (symbol) => [symbol, await getUsdPrice(symbol)] as const)
      );
      return Object.fromEntries(entries) as Record<string, number>;
    },
    enabled: symbols.length > 0,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

/**
 * Resolves a single mint's xStocks symbol. Checks the static `XSTOCKS_MINTS`
 * stand-in map first (see lib/constant.ts — same map BuyOrderGrid/
 * SellOrderGrid already read directly), and only falls back to the live
 * xStocks asset list for mints that aren't in that static map, i.e. mints
 * that might actually be real mainnet xStocks deployments. Shared by every
 * Maker/TakerCardContainer so mint -> symbol resolution isn't copy-pasted
 * per container.
 */
export function useMintSymbol(mint: string | null | undefined): string | undefined {
  const staticSymbol = mintToXStockSymbol(mint);
  const { data: assets } = useXStockAssets();

  return useMemo(() => {
    if (!mint) return undefined;
    if (staticSymbol) return staticSymbol;
    if (!assets) return undefined;
    for (const asset of assets) {
      if (extractSolanaMint(asset) === mint) return asset.symbol;
    }
    return undefined;
  }, [mint, staticSymbol, assets]);
}

interface UsdQuote {
  symbol: string;
  usdQuote: number;
}

/**
 * Raw live USD price for a mint, resolved via the static `XSTOCKS_MINTS`
 * stand-in map, fetched through the server-side `/api/xstocks/price` proxy
 * (same route `useOrderQuote` below uses, just without a `currency` param).
 *
 * Prefer this over `useXStockPrice` above for anything user-facing:
 * `useXStockPrice` fetches api.xstocks.fi directly from the browser, which
 * depends on that API allowing cross-origin requests from wherever this app
 * is hosted — if it doesn't, that query just never resolves and a "Stock
 * price" field silently stays blank. Routing through our own API route
 * sidesteps that entirely, the same way `useOrderQuote` already does for
 * the currency-converted price.
 *
 * Used by CreateBuyDialog / CreateSellOrderDialog to populate the "Stock
 * price (USD)" field the moment a token is selected, before any currency
 * has been entered.
 */
export function useOrderUsdQuote(mint: string | null | undefined) {
  const symbol = mintToXStockSymbol(mint);

  return useQuery<UsdQuote>({
    queryKey: ["xstocks", "usd-quote", symbol],
    queryFn: async () => {
      const res = await fetch(`/api/xstocks/price?symbol=${encodeURIComponent(symbol as string)}`);
      if (!res.ok) {
        throw new Error(`USD quote request failed: ${res.status}`);
      }
      const data = (await res.json()) as { usdQuote: number };
      return { symbol: symbol as string, usdQuote: data.usdQuote };
    },
    enabled: !!symbol,
    staleTime: 10_000,
    refetchInterval: 30_000,
    retry: 1,
  });
}

/**
 * Same idea as `useOrderUsdQuote`, batched for several symbols at once —
 * used by StockTicker.tsx's rolling price bar. Goes through
 * `/api/xstocks/price?symbols=...`'s batch form for the same
 * browser-can't-reliably-reach-api.xstocks.fi-directly reason.
 */
export function useXStockPricesProxied(symbols: string[]) {
  const key = [...symbols].sort().join(",");

  return useQuery<Record<string, number>>({
    queryKey: ["xstocks", "prices-proxied", key],
    queryFn: async () => {
      const res = await fetch(`/api/xstocks/price?symbols=${encodeURIComponent(symbols.join(","))}`);
      if (!res.ok) {
        throw new Error(`Prices request failed: ${res.status}`);
      }
      const data = (await res.json()) as {
        prices: Record<string, { usdQuote: number; referencePrice: number | null }>;
      };
      return Object.fromEntries(Object.entries(data.prices).map(([sym, v]) => [sym, v.usdQuote]));
    },
    enabled: symbols.length > 0,
    staleTime: 10_000,
    refetchInterval: 15_000,
    retry: 1,
  });
}

interface OrderQuote {
  symbol: string;
  usdQuote: number;
  referencePrice: number;
}

/**
 * Live reference price for a mint (resolved to its xStocks symbol via the
 * static `XSTOCKS_MINTS` stand-in map) in a given fiat currency, fetched
 * through the server-side `/api/xstocks/price` proxy so the browser isn't
 * hitting api.xstocks.fi / the FX API directly for this. `referencePrice`
 * is computed the exact same way `keeper/src/priceKeeper.ts` computes the
 * on-chain `price_per_token` it later writes (usd quote x fx rate,
 * rounded), so a price suggested here won't disagree with what the keeper
 * pushes shortly after order creation.
 *
 * Used by CreateBuyDialog / CreateSellOrderDialog to suggest a starting
 * `price_per_token` instead of leaving it purely up to whatever the maker
 * types in by hand.
 */
export function useOrderQuote(
  mint: string | null | undefined,
  currency: string | null | undefined
) {
  const symbol = mintToXStockSymbol(mint);
  const normalizedCurrency = currency?.trim().toUpperCase();
  const enabled = !!symbol && !!normalizedCurrency && normalizedCurrency.length === 3;

  return useQuery<OrderQuote>({
    queryKey: ["xstocks", "order-quote", symbol, normalizedCurrency],
    queryFn: async () => {
      const res = await fetch(
        `/api/xstocks/price?symbol=${encodeURIComponent(symbol as string)}&currency=${encodeURIComponent(
          normalizedCurrency as string
        )}`
      );
      if (!res.ok) {
        throw new Error(`Quote request failed: ${res.status}`);
      }
      const data = (await res.json()) as { usdQuote: number; referencePrice: number | null };
      if (data.referencePrice == null) {
        throw new Error("No reference price returned for this currency");
      }
      return { symbol: symbol as string, usdQuote: data.usdQuote, referencePrice: data.referencePrice };
    },
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
  });
}
