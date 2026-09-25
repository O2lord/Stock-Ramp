/**
 * USD -> fiat FX rate lookup, used to convert xStocks' USD quote into the
 * currency each StockRampOrder is denominated in (e.g. NGN).
 *
 * Using open.er-api.com: free, no API key, updates roughly daily. Fine for
 * a hackathon demo; swap for a paid/faster feed (e.g. a bank FX API) before
 * relying on this for real LP capital, since a stale FX rate is a real
 * mispricing risk on top of stock-price staleness.
 */

const FX_API_BASE = process.env.FX_API_BASE || "https://open.er-api.com/v6/latest/USD";

interface FxRateResponse {
  result: string;
  rates: Record<string, number>;
}

let cachedRates: Record<string, number> | null = null;
let cachedAt = 0;
const FX_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour — matches the API's own update cadence

export async function getUsdToRate(currencyCode: string): Promise<number> {
  const now = Date.now();
  if (!cachedRates || now - cachedAt > FX_CACHE_TTL_MS) {
    const res = await fetch(FX_API_BASE);
    if (!res.ok) {
      throw new Error(`FX rate API returned ${res.status}`);
    }
    const data = (await res.json()) as FxRateResponse;
    if (data.result !== "success") {
      throw new Error(`FX rate API result: ${data.result}`);
    }
    cachedRates = data.rates;
    cachedAt = now;
  }

  const rate = cachedRates[currencyCode.toUpperCase()];
  if (!rate) {
    throw new Error(`No FX rate found for currency ${currencyCode}`);
  }
  return rate;
}
