import { fetchAllOrders } from "./fetchOrders.js";
import { resolveSymbolToMint, getUsdPrice } from "../xstocksClient.js";
import { getUsdToRate } from "../fxRate.js";
import { reserveBuyOrder } from "./reserveBuyOrder.js";
import { SUPPORTED_CURRENCIES } from "../constants.js";
/**
 * prepare_stock_offramp -- THE core off-ramp action: "sell my AAPLx for
 * naira into my bank account." This is a thin wrapper around
 * reserve_buy_order: it resolves a ticker symbol to its mint, finds the
 * best open BUY order for that mint+currency (highest price_per_token —
 * best for the seller), and hands off to reserveBuyOrder for the actual
 * QR/transaction-request generation. Same underlying escrow mechanism as
 * everything else here — this tool exists so the chat conversation can
 * start from "AAPL" instead of requiring the caller to already know a
 * specific order's PDA address.
 */
export async function prepareStockOfframp(args) {
    const currency = args.currency.toUpperCase();
    if (!SUPPORTED_CURRENCIES.includes(currency)) {
        throw new Error(`Unsupported currency "${args.currency}". Supported: ${SUPPORTED_CURRENCIES.join(", ")}`);
    }
    // Unlike the reference-price check further down, this lookup is NOT
    // optional -- prepareStockOfframp can't find a matching order without a
    // resolved mint. But a transient failure here (network blip, live xStocks
    // API error, etc.) shouldn't surface as an opaque "Failed" tool call with
    // no message; catch it and return the same found:false shape as a genuine
    // "no ticker match" so the chat/card can show the caller something
    // actionable and a retry is obviously safe (nothing on-chain has happened
    // yet at this point).
    let resolved;
    try {
        resolved = await resolveSymbolToMint(args.symbol);
    }
    catch (err) {
        console.warn("[prepareStockOfframp] resolveSymbolToMint failed:", err);
        return {
            found: false,
            message: `Couldn't look up "${args.symbol}" against the xStocks asset list right now (${err instanceof Error ? err.message : String(err)}). This is usually transient -- try again in a moment.`,
        };
    }
    if (!resolved) {
        return {
            found: false,
            message: `Couldn't find an xStocks ticker matching "${args.symbol}".`,
        };
    }
    const orders = await fetchAllOrders();
    const candidates = orders.filter((o) => o.orderType === "buy" && o.mint === resolved.mint && o.currency === currency && o.amount > 0 && o.reservationsUsed < o.reservationsMax);
    if (candidates.length === 0) {
        return {
            found: false,
            message: `No open liquidity to sell ${resolved.symbol} for ${currency} right now. Try a different currency, or check back shortly.`,
        };
    }
    const best = candidates.reduce((a, b) => (b.pricePerToken > a.pricePerToken ? b : a));
    if (args.amount > best.amount) {
        return {
            found: false,
            message: `The best available order only has ${best.amount} ${resolved.symbol} available -- reduce the amount or split across multiple orders.`,
        };
    }
    // Sanity comparison against a live reference price -- purely informational,
    // does not block the reservation. Lets the card/chat flag if the on-chain
    // LP quote has drifted noticeably from the live market (e.g. the keeper
    // service is lagging or offline).
    let priceDivergencePct;
    try {
        const usdPrice = await getUsdPrice(resolved.symbol);
        const fxRate = await getUsdToRate(currency);
        const referencePrice = usdPrice * fxRate;
        priceDivergencePct = referencePrice > 0 ? ((best.pricePerToken - referencePrice) / referencePrice) * 100 : undefined;
    }
    catch (err) {
        // Non-fatal -- the reservation can still proceed without this check.
        console.warn("[prepareStockOfframp] Reference price check failed:", err);
    }
    const reservation = await reserveBuyOrder({
        orderAddress: best.orderAddress,
        amount: args.amount,
        payoutDetails: args.payoutDetails,
    });
    return {
        found: true,
        ...reservation,
        symbol: resolved.symbol,
        mint: resolved.mint,
        priceDivergencePct: priceDivergencePct !== undefined ? Math.round(priceDivergencePct * 100) / 100 : undefined,
    };
}
