import { fetchAllOrders } from "./fetchOrders.js";
import { resolveMintToSymbol } from "../xstocksClient.js";
/** open_stock_ramp's data source. Grouped by currency + asset (mint) --
 * NEVER by currency alone. Two different stocks priced in the same fiat
 * are two different markets; showing one stock's sell order next to a
 * DIFFERENT stock's buy order as a "spread" is exactly the bug this
 * grouping fixes (was: group by currency only, in the previous version). */
export async function getHubRates() {
    const orders = await fetchAllOrders();
    const byKey = new Map();
    for (const o of orders) {
        if (o.amount <= 0 || o.reservationsUsed >= o.reservationsMax)
            continue;
        const key = `${o.currency}|${o.mint}`;
        const entry = byKey.get(key) ?? {
            currency: o.currency,
            mint: o.mint,
            bestSellOrderRate: null,
            sellOrdersOnline: 0,
            bestBuyOrderRate: null,
            buyOrdersOnline: 0,
        };
        if (o.orderType === "sell") {
            entry.sellOrdersOnline += 1;
            entry.bestSellOrderRate = entry.bestSellOrderRate === null ? o.pricePerToken : Math.min(entry.bestSellOrderRate, o.pricePerToken);
        }
        else {
            entry.buyOrdersOnline += 1;
            entry.bestBuyOrderRate = entry.bestBuyOrderRate === null ? o.pricePerToken : Math.max(entry.bestBuyOrderRate, o.pricePerToken);
        }
        byKey.set(key, entry);
    }
    const rows = Array.from(byKey.values()).sort((a, b) => a.currency.localeCompare(b.currency) || a.mint.localeCompare(b.mint));
    return Promise.all(rows.map(async (r) => ({
        ...r,
        symbol: (await resolveMintToSymbol(r.mint).catch(() => null)) ?? `${r.mint.slice(0, 4)}…${r.mint.slice(-4)}`,
    })));
}
/** Best single order for a currency+ASSET+side -- used by the hub's
 * Buy/Sell forms to resolve an orderAddress once the person picks a
 * currency, a specific stock, and an amount. Lowest price for a sell
 * order (cheapest for the buyer), highest price for a buy order (richest
 * for the seller) -- but always scoped to the one mint the person picked,
 * never cross-asset. */
export async function findBestOrder(args) {
    const orders = await fetchAllOrders();
    const candidates = orders.filter((o) => o.orderType === args.orderType &&
        o.currency === args.currency.toUpperCase() &&
        o.mint === args.mint &&
        o.amount > 0 &&
        o.reservationsUsed < o.reservationsMax);
    if (candidates.length === 0)
        return { found: false };
    const best = args.orderType === "sell"
        ? candidates.reduce((a, b) => (b.pricePerToken < a.pricePerToken ? b : a))
        : candidates.reduce((a, b) => (b.pricePerToken > a.pricePerToken ? b : a));
    return {
        found: true,
        orderAddress: best.orderAddress,
        pricePerToken: best.pricePerToken,
        availableAmount: best.amount,
        currency: best.currency,
        mint: best.mint,
    };
}
