// client/lib/priceKeeper.ts
// Client-side (read-only, browser-safe) wrapper around the xStocks price
// feed, for display purposes — e.g. showing a "live" reference price next to
// an LP's `pricePerToken` so users can judge whether an order is fairly
// priced. This is distinct from `keeper/src/priceKeeper.ts`, which actually
// *writes* `update_price` transactions on-chain and requires a keypair —
// that keeper process is server-side only and never runs in the browser.
//
// Built on the same public xStocks + FX endpoints `hooks/useXStockPrices.ts`
// polls, so the two stay visually consistent.

const XSTOCKS_API_BASE =
  process.env.NEXT_PUBLIC_XSTOCKS_API_BASE || "https://api.xstocks.fi/api/v2";
const FX_API_BASE =
  process.env.NEXT_PUBLIC_FX_API_BASE || "https://open.er-api.com/v6/latest/USD";

interface FxRateResponse {
  result: string;
  rates: Record<string, number>;
}

let cachedRates: Record<string, number> | null = null;
let cachedAt = 0;
const FX_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour, mirrors keeper/src/fxRate.ts

async function getUsdToRate(currencyCode: string): Promise<number> {
  const now = Date.now();
  if (!cachedRates || now - cachedAt > FX_CACHE_TTL_MS) {
    const res = await fetch(FX_API_BASE);
    if (!res.ok) throw new Error(`FX rate API returned ${res.status}`);
    const data = (await res.json()) as FxRateResponse;
    if (data.result !== "success") throw new Error(`FX rate API result: ${data.result}`);
    cachedRates = data.rates;
    cachedAt = now;
  }
  const rate = cachedRates[currencyCode.toUpperCase()];
  if (!rate) throw new Error(`No FX rate found for currency ${currencyCode}`);
  return rate;
}

async function getUsdPrice(symbol: string): Promise<number> {
  const res = await fetch(
    `${XSTOCKS_API_BASE}/public/assets/${encodeURIComponent(symbol)}/price-data`
  );
  if (!res.ok) throw new Error(`xStocks API returned ${res.status}`);
  const data = (await res.json()) as { quote: number };
  return data.quote;
}

/**
 * Live reference price for a symbol, converted to the given fiat currency and
 * rounded to whole units — same conversion `keeper/src/priceKeeper.ts` uses
 * on-chain, so this is what an order's `pricePerToken` *should* roughly equal
 * right now.
 */
export async function getReferencePrice(symbol: string, currency: string): Promise<number> {
  const [usdQuote, fxRate] = await Promise.all([getUsdPrice(symbol), getUsdToRate(currency)]);
  return Math.round(usdQuote * fxRate);
}

/**
 * Percentage difference between an order's stored price and the live
 * reference price. Positive = order is priced above market; negative = below.
 * Useful for a "X% above/below market" badge on order cards.
 */
export function priceDeviationPct(orderPrice: number, referencePrice: number): number {
  if (referencePrice === 0) return 0;
  return ((orderPrice - referencePrice) / referencePrice) * 100;
}
