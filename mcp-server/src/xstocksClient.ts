/**
 * Thin client for the xStocks public API (Backed Finance). Same client the
 * keeper service uses (keeper/src/xstocksClient.ts) — duplicated here
 * rather than shared as a package, since this MCP server and the keeper
 * are separately deployed services. If this drifts, keep both in sync
 * manually (or extract to a shared npm package later).
 *
 * Docs: https://docs.xstocks.fi/apis/openapi
 */

const XSTOCKS_API_BASE = process.env.XSTOCKS_API_BASE || "https://api.xstocks.fi/api/v2";

/**
 * Devnet stand-in mints. xStocks is a mainnet-only, custody-backed RWA
 * product (Backed Finance) with no devnet deployment (see
 * client/lib/constant.ts's XSTOCKS_MINTS comment) -- so on devnet, every
 * order's mint is a throwaway SPL address the live xStocks API will NEVER
 * recognize, and resolveMintToSymbol's API lookup always misses, falling
 * back to a truncated mint address (e.g. "AApL…KjE9H") instead of a real
 * symbol. This map is the mint->symbol inverse of client/lib/constant.ts's
 * XSTOCKS_MINTS, checked BEFORE the live API so the hub's rates list and
 * Stock dropdown show "AAPLx" / "AMZNx" / etc. on devnet. Keep in sync
 * manually if XSTOCKS_MINTS changes -- same caveat as this file's header
 * comment about the keeper's duplicated client.
 */
const DEVNET_MINT_SYMBOLS: Record<string, string> = {
  AApLxE2BHqAowPKpZ72Euqxnf8umVRdK79Rsh2xKjE9H: "AAPLx",
  AMxz5EtXWThjVBXvcQ24aFg75H41KYqC71Q29wgpA8Kc: "AMZNx",
  MTxTuSschyv88CCCCB17RDGc4L6H33u2y23GwCbPyfY: "METAx",
  Nx1kifUWHU6kLM42tPU7NJTFBGEADTwRbwrfpm1141W: "NVDAx",
  TxLGAssFm6Rmk494RBKfDwjW7jpY2JzaYSuTMPdqeXD: "TSLAx",
};

export interface XStocksAssetDeployment {
  network: string; // confirmed against a real response: "Solana" (capitalized)
  address?: string;
  contractAddress?: string;
  tokenAddress?: string;
  mintAddress?: string;
  [key: string]: unknown;
}

export interface XStocksAsset {
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
  const res = await fetch(`${XSTOCKS_API_BASE}${path}`, { headers: { "Content-Type": "application/json" } });
  if (!res.ok) {
    throw new Error(`xStocks API ${path} returned ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

let assetCache: XStocksAsset[] | null = null;
let assetCacheAt = 0;
const ASSET_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour — deployments rarely change

async function listAllAssets(): Promise<XStocksAsset[]> {
  const now = Date.now();
  if (assetCache && now - assetCacheAt < ASSET_CACHE_TTL_MS) return assetCache;

  const all: XStocksAsset[] = [];
  let page = 0;
  // pageSize=100 confirmed working against a live response (2026-09-25).
  // Kept in sync with keeper/src/xstocksClient.ts's listAllAssets() — do
  // not raise this without re-verifying against a live call first.
  for (;;) {
    const resp = await xstocksGet<XStocksAssetListResponse>(`/public/assets?page=${page}&pageSize=100`);
    all.push(...resp.nodes);
    if (!resp.page.hasNextPage) break;
    page += 1;
  }
  assetCache = all;
  assetCacheAt = now;
  return all;
}

/**
 * Confirmed against a live response: Solana deployments carry the mint in
 * `address`. The other field-name candidates below are kept only as a
 * defensive fallback for a future response shape change. Same caveat as
 * keeper/src/xstocksClient.ts — keep both accessors in sync.
 */
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

export async function getUsdPrice(symbol: string): Promise<number> {
  const resp = await xstocksGet<{ quote: number }>(`/public/assets/${encodeURIComponent(symbol)}/price-data`);
  return resp.quote;
}

/** Resolves a ticker like "AAPLx" (or bare "AAPL") to its Solana mint address. */
export async function resolveSymbolToMint(symbolInput: string): Promise<{ symbol: string; mint: string } | null> {
  const assets = await listAllAssets();
  const wanted = symbolInput.toLowerCase().replace(/x$/, ""); // allow "AAPL" or "AAPLx"

  const match = assets.find((a) => {
    const sym = a.symbol.toLowerCase().replace(/x$/, "");
    return sym === wanted;
  });
  if (!match) return null;

  const mint = extractSolanaMint(match);
  if (!mint) return null;

  return { symbol: match.symbol, mint };
}

/** Reverse lookup, used by the keeper's price-refresh pass — kept here too
 * for parity/tools that resolve a mint back to a display symbol. Checks
 * the devnet stand-in map FIRST (see DEVNET_MINT_SYMBOLS above) since the
 * live API can never match a devnet mint; falls back to the live API for
 * real mainnet deployments. */
export async function resolveMintToSymbol(mintAddress: string): Promise<string | null> {
  const devnetSymbol = DEVNET_MINT_SYMBOLS[mintAddress];
  if (devnetSymbol) return devnetSymbol;

  const assets = await listAllAssets();
  for (const asset of assets) {
    const mint = extractSolanaMint(asset);
    if (mint === mintAddress) return asset.symbol;
  }
  return null;
}
