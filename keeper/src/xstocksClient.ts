/**
 * Thin client for the xStocks public API (run by Backed Finance).
 * Docs: https://docs.xstocks.fi/apis/openapi
 *
 * All endpoints used here are public / unauthenticated.
 */

const XSTOCKS_API_BASE = process.env.XSTOCKS_API_BASE || "https://api.xstocks.fi/api/v2";

export interface XStocksAssetDeployment {
  network: string; // confirmed against a real response: "Solana" (capitalized)
  // Confirmed against a real /public/assets response: Solana deployments
  // use `address` for the mint. The other candidates below are kept as a
  // defensive fallback only, in case a future response shape varies.
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

export interface XStocksAssetListResponse {
  nodes: XStocksAsset[];
  page: { currentPage: number; hasNextPage: boolean };
}

async function xstocksGet<T>(path: string): Promise<T> {
  const res = await fetch(`${XSTOCKS_API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    throw new Error(`xStocks API ${path} returned ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

/** GET /public/assets — paginated; fetches all pages. */
export async function listAllAssets(): Promise<XStocksAsset[]> {
  const all: XStocksAsset[] = [];
  let page = 0;
  // pageSize=100 confirmed working against a live response (2026-09-25).
  // Kept in sync with mcp-server/src/xstocksClient.ts's listAllAssets() —
  // do not raise this without re-verifying against a live call first.
  for (;;) {
    const resp = await xstocksGet<XStocksAssetListResponse>(
      `/public/assets?page=${page}&pageSize=100`
    );
    all.push(...resp.nodes);
    if (!resp.page.hasNextPage) break;
    page += 1;
  }
  return all;
}

/** GET /public/assets/{symbol}/price-data — returns { quote: <USD price> } */
export async function getUsdPrice(symbol: string): Promise<number> {
  const resp = await xstocksGet<{ quote: number }>(
    `/public/assets/${encodeURIComponent(symbol)}/price-data`
  );
  return resp.quote;
}

/**
 * Pulls the Solana mint address out of an asset's deployments array.
 * Confirmed against a live response: Solana deployments carry the mint in
 * `address`. The other field-name candidates are kept only as a defensive
 * fallback for a future response shape change, and still log a warning on
 * first mismatch so a real shape change is caught immediately.
 */
export function extractSolanaMint(asset: XStocksAsset): string | null {
  const solanaDeployment = asset.deployments.find(
    (d) => typeof d.network === "string" && d.network.toLowerCase() === "solana"
  );
  if (!solanaDeployment) return null;

  const candidate =
    solanaDeployment.address ||
    solanaDeployment.contractAddress ||
    solanaDeployment.tokenAddress ||
    solanaDeployment.mintAddress;

  if (!candidate) {
    console.warn(
      `[xstocks] Could not find a mint field on Solana deployment for ${asset.symbol}. ` +
        `Raw object (update extractSolanaMint() to match):`,
      JSON.stringify(solanaDeployment)
    );
    return null;
  }
  return candidate;
}

/**
 * Devnet SPL stand-ins for xStocks symbols — xStocks itself is a
 * mainnet-only, custody-backed RWA product with no devnet deployment, so
 * these throwaway mints will never show up in `listAllAssets()`'s live
 * asset list (that API only ever knows about real mainnet mints — see
 * `extractSolanaMint()`'s docstring above).
 *
 * Mirrors `client/lib/constant.ts`'s `XSTOCKS_MINTS` — keep the two in
 * sync when new stand-ins are minted. Kept as a separate copy here rather
 * than imported because this package's `tsconfig.json` (`rootDir: ".."`,
 * `include: ["src/**\/*.ts", "../target/types/**\/*.ts"]`) doesn't reach into
 * `client/`'s Next.js project — same reasoning
 * `client/hooks/useXStockPrices.ts` gives for duplicating the xStocks fetch
 * logic instead of importing this file from the client.
 */
const STATIC_XSTOCKS_MINTS: Record<string, string> = {
  AAPLx: "AApLxE2BHqAowPKpZ72Euqxnf8umVRdK79Rsh2xKjE9H",
  AMZNx: "AMxz5EtXWThjVBXvcQ24aFg75H41KYqC71Q29wgpA8Kc",
  METAx: "MTxTuSschyv88CCCCB17RDGc4L6H33u2y23GwCbPyfY",
  NVIDIAx: "Nx1kifUWHU6kLM42tPU7NJTFBGEADTwRbwrfpm1141W",
  TSLAx: "TxLGAssFm6Rmk494RBKfDwjW7jpY2JzaYSuTMPdqeXD",
};

/**
 * Builds a { mintAddress: symbol } map, checking the static devnet
 * stand-ins first and only falling back to the live xStocks asset list for
 * mints that aren't in that static map (i.e. mints that might actually be
 * real mainnet xStocks deployments).
 *
 * The live API call is best-effort: if it fails (e.g. no network access
 * while iterating purely against devnet stand-ins), the static entries
 * above are still returned rather than the whole map build failing.
 *
 * Cache this in the caller (see priceKeeper.ts) — assets/deployments
 * change rarely, no need to hit this every poll cycle.
 */
export async function buildMintToSymbolMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  // Static devnet stand-ins first, so they always resolve regardless of
  // what the live API knows about.
  for (const [symbol, mint] of Object.entries(STATIC_XSTOCKS_MINTS)) {
    map.set(mint, symbol);
  }

  // Then layer in real xStocks mints from the live API, for any mint not
  // already covered above.
  try {
    const assets = await listAllAssets();
    for (const asset of assets) {
      const mint = extractSolanaMint(asset);
      if (mint && !map.has(mint)) map.set(mint, asset.symbol);
    }
  } catch (err) {
    console.warn(
      "[xstocks] Failed to fetch live asset list — continuing with static devnet stand-ins only:",
      err
    );
  }

  return map;
}
