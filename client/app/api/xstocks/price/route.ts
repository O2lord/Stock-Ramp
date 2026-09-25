// client/app/api/xstocks/price/route.ts
// Server-side proxy for xStocks USD prices + fiat conversion.
//
// The client already has a browser-safe path to the same data
// (hooks/useXStockPrices.ts + lib/priceKeeper.ts hit api.xstocks.fi and
// open.er-api.com directly) — this route exists as the server-side
// equivalent for callers that shouldn't/can't do that themselves: the
// upcoming keeper-triggered server actions, any future webhook that needs a
// price at request time, or simply to avoid every browser tab hitting a
// third-party rate limit directly. Logic mirrors lib/priceKeeper.ts's
// getReferencePrice() exactly so the two never disagree.
//
// GET /api/xstocks/price?symbol=AAPLx&currency=NGN
//   -> { symbol, usdQuote, currency, referencePrice }
// GET /api/xstocks/price?symbols=AAPLx,TSLAx&currency=NGN
//   -> { currency, prices: { AAPLx: { usdQuote, referencePrice }, ... }, errors?: { <symbol>: string } }
// currency is optional — omit it to get just the raw USD quote(s).
//
// Each symbol is resolved independently (Promise.allSettled, not
// Promise.all): if api.xstocks.fi doesn't recognize one symbol, is
// temporarily rate-limiting, or a single request times out, that symbol is
// just omitted from `prices` (and reported in `errors`) rather than failing
// the whole batch — GlobalStatsTicker.tsx's price track would otherwise go
// completely blank ("No live prices available") over one bad symbol out of
// several. Same for the FX rate lookup: if it fails, USD quotes still come
// back with `referencePrice: null` instead of failing everything.

import { NextRequest, NextResponse } from "next/server";

const XSTOCKS_API_BASE = process.env.XSTOCKS_API_BASE || "https://api.xstocks.fi/api/v2";
const FX_API_BASE = process.env.FX_API_BASE || "https://open.er-api.com/v6/latest/USD";
const FETCH_TIMEOUT_MS = 8_000;

interface FxRateResponse {
  result: string;
  rates: Record<string, number>;
}

// Module-scope cache — persists across requests within the same server
// instance/lambda lifetime. Mirrors lib/priceKeeper.ts's 1hr TTL.
let cachedRates: Record<string, number> | null = null;
let cachedAt = 0;
const FX_CACHE_TTL_MS = 60 * 60 * 1000;

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Returns null (rather than throwing) if the FX rate can't be resolved — callers fall back to `referencePrice: null`. */
async function getUsdToRate(currencyCode: string): Promise<number | null> {
  try {
    const now = Date.now();
    if (!cachedRates || now - cachedAt > FX_CACHE_TTL_MS) {
      const res = await fetchWithTimeout(FX_API_BASE, FETCH_TIMEOUT_MS);
      if (!res.ok) throw new Error(`FX rate API returned ${res.status}`);
      const data = (await res.json()) as FxRateResponse;
      if (data.result !== "success") throw new Error(`FX rate API result: ${data.result}`);
      cachedRates = data.rates;
      cachedAt = now;
    }
    const rate = cachedRates[currencyCode.toUpperCase()];
    return rate ?? null;
  } catch (error) {
    console.error("[xstocks/price] FX rate lookup failed:", error);
    return null;
  }
}

async function getUsdPrice(symbol: string): Promise<number> {
  const res = await fetchWithTimeout(
    `${XSTOCKS_API_BASE}/public/assets/${encodeURIComponent(symbol)}/price-data`,
    FETCH_TIMEOUT_MS
  );
  if (!res.ok) throw new Error(`xStocks API returned ${res.status} for symbol ${symbol}`);
  const data = (await res.json()) as { quote: number };
  if (typeof data.quote !== "number") throw new Error(`xStocks API returned no quote for symbol ${symbol}`);
  return data.quote;
}

function withCors(res: NextResponse): NextResponse {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return res;
}

export async function OPTIONS() {
  return withCors(new NextResponse(null, { status: 200 }));
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const symbol = searchParams.get("symbol");
    const symbolsParam = searchParams.get("symbols");
    const currency = searchParams.get("currency");

    const symbols = symbolsParam
      ? symbolsParam.split(",").map((s) => s.trim()).filter(Boolean)
      : symbol
      ? [symbol]
      : [];

    if (symbols.length === 0) {
      return withCors(
        NextResponse.json({ error: "Provide a 'symbol' or 'symbols' query parameter" }, { status: 400 })
      );
    }

    const fxRate = currency ? await getUsdToRate(currency) : null;

    const settled = await Promise.allSettled(
      symbols.map(async (sym) => {
        const usdQuote = await getUsdPrice(sym);
        return [
          sym,
          {
            usdQuote,
            referencePrice: fxRate != null ? Math.round(usdQuote * fxRate) : null,
          },
        ] as const;
      })
    );

    const prices: Record<string, { usdQuote: number; referencePrice: number | null }> = {};
    const errors: Record<string, string> = {};

    settled.forEach((result, i) => {
      const sym = symbols[i];
      if (result.status === "fulfilled") {
        prices[result.value[0]] = result.value[1];
      } else {
        const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
        errors[sym] = message;
        console.error(`[xstocks/price] Failed to fetch ${sym}:`, message);
      }
    });

    // Single-symbol shorthand (via ?symbol=) returns a flat object; the
    // ?symbols= batch form returns a { prices: {...} } map.
    if (symbol && !symbolsParam) {
      const data = prices[symbol];
      if (!data) {
        return withCors(
          NextResponse.json({ error: errors[symbol] ?? `Failed to fetch price for ${symbol}` }, { status: 502 })
        );
      }
      return withCors(
        NextResponse.json({
          symbol,
          usdQuote: data.usdQuote,
          currency: currency ?? null,
          referencePrice: data.referencePrice,
        })
      );
    }

    return withCors(
      NextResponse.json({
        currency: currency ?? null,
        prices,
        ...(Object.keys(errors).length > 0 ? { errors } : {}),
      })
    );
  } catch (error) {
    console.error("[xstocks/price] GET error:", error);
    return withCors(
      NextResponse.json(
        { error: error instanceof Error ? error.message : "Failed to fetch price" },
        { status: 502 }
      )
    );
  }
}
