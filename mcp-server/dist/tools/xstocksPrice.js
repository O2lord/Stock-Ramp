import { getUsdPrice, resolveSymbolToMint } from "../xstocksClient.js";
import { getUsdToRate } from "../fxRate.js";
import { SUPPORTED_CURRENCIES } from "../constants.js";
/**
 * get_xstock_price -- resolves a stock ticker (e.g. "AAPL" or "AAPLx") to
 * its Solana mint address and current reference price, optionally
 * converted to a target fiat currency. This is the first step of the
 * off-ramp conversation: "what's AAPL worth in naira right now" before
 * "sell 3 shares" (prepare_stock_offramp).
 *
 * The returned price is a REFERENCE price from xStocks' own oracle/quote
 * feed -- it is NOT necessarily the exact rate any specific LP is quoting
 * on-chain (LP orders are refreshed periodically by a separate keeper
 * service, see /keeper/README.md, and can lag this live quote by up to a
 * poll interval). prepare_stock_offramp surfaces both numbers together so
 * a caller can see if they diverge meaningfully.
 */
export async function getXStockPrice(args) {
    const resolved = await resolveSymbolToMint(args.symbol);
    if (!resolved) {
        return {
            found: false,
            message: `Couldn't find an xStocks ticker matching "${args.symbol}".`,
        };
    }
    const usdPrice = await getUsdPrice(resolved.symbol);
    let convertedPrice;
    let currency;
    if (args.currency) {
        const upper = args.currency.toUpperCase();
        if (!SUPPORTED_CURRENCIES.includes(upper)) {
            throw new Error(`Unsupported currency "${args.currency}". Supported: ${SUPPORTED_CURRENCIES.join(", ")}`);
        }
        const fxRate = await getUsdToRate(upper);
        convertedPrice = Math.round(usdPrice * fxRate * 100) / 100;
        currency = upper;
    }
    return {
        found: true,
        symbol: resolved.symbol,
        mint: resolved.mint,
        usdPrice,
        currency,
        convertedPrice,
        note: "This is a live reference price from xStocks' own quote feed, not necessarily the exact " +
            "rate an on-chain LP order is quoting right now -- LP order prices are refreshed " +
            "periodically, not continuously. prepare_stock_offramp shows both together.",
    };
}
