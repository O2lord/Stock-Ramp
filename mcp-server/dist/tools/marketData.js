import { fetchAllOrders } from "./fetchOrders.js";
import { normalizeMintFilter, getDecimalsForMint } from "./tokenRegistry.js";
/** Tokens currently traded — derived live from open orders, not a fixed list. */
export async function listKnownTokens() {
    const orders = await fetchAllOrders();
    const distinctMints = [...new Set(orders.map((o) => o.mint))];
    return Promise.all(distinctMints.map(async (mint) => ({
        mint,
        decimals: await getDecimalsForMint(mint),
    })));
}
/**
 * get_market_rates -- best available BUY-order rate per token/currency.
 * `token` expects a mint ADDRESS. Use get_xstock_price or list_open_orders
 * to resolve a symbol like "AAPLx" to its mint first.
 */
export async function getMarketRates(args) {
    const orders = await fetchAllOrders();
    const mint = normalizeMintFilter(args.token);
    const candidates = orders.filter((o) => {
        if (o.orderType !== "buy")
            return false;
        if (o.amount <= 0)
            return false;
        if (o.reservationsUsed >= o.reservationsMax)
            return false;
        if (args.currency && o.currency !== args.currency.toUpperCase())
            return false;
        if (mint && o.mint !== mint)
            return false;
        return true;
    });
    if (candidates.length === 0) {
        return { found: false, message: "No matching liquidity found for that token/currency pair." };
    }
    const best = candidates.reduce((a, b) => (b.pricePerToken > a.pricePerToken ? b : a));
    return {
        found: true,
        tokenMint: best.mint,
        currency: best.currency,
        pricePerToken: best.pricePerToken,
        bestLpOrderAddress: best.orderAddressTruncated,
        bestLpOrderAddressFull: best.orderAddress,
    };
}
export async function listOpenOrders(args) {
    const orders = await fetchAllOrders();
    const mint = normalizeMintFilter(args.token);
    const filtered = orders.filter((o) => {
        if (args.orderType && o.orderType !== args.orderType)
            return false;
        if (args.currency && o.currency !== args.currency.toUpperCase())
            return false;
        if (mint && o.mint !== mint)
            return false;
        return o.amount > 0;
    });
    return filtered.map((o) => ({
        orderAddress: o.orderAddress,
        orderAddressDisplay: o.orderAddressTruncated,
        orderType: o.orderType,
        tokenMint: o.mint,
        currency: o.currency,
        pricePerToken: o.pricePerToken,
        availableAmount: o.amount,
        reservationSlotsUsed: o.reservationsUsed,
        reservationSlotsMax: o.reservationsMax,
    }));
}
