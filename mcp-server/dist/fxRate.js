/**
 * USD -> fiat FX rate lookup. Same source and caching as the keeper
 * service (keeper/src/fxRate.ts) — duplicated here for the same reason as
 * xstocksClient.ts (separate deployments, not a shared package).
 */
const FX_API_BASE = process.env.FX_API_BASE || "https://open.er-api.com/v6/latest/USD";
let cachedRates = null;
let cachedAt = 0;
const FX_CACHE_TTL_MS = 60 * 60 * 1000;
export async function getUsdToRate(currencyCode) {
    const now = Date.now();
    if (!cachedRates || now - cachedAt > FX_CACHE_TTL_MS) {
        const res = await fetch(FX_API_BASE);
        if (!res.ok)
            throw new Error(`FX rate API returned ${res.status}`);
        const data = (await res.json());
        if (data.result !== "success")
            throw new Error(`FX rate API result: ${data.result}`);
        cachedRates = data.rates;
        cachedAt = now;
    }
    const rate = cachedRates[currencyCode.toUpperCase()];
    if (!rate)
        throw new Error(`No FX rate found for currency ${currencyCode}`);
    return rate;
}
