import { getProgram } from "../program.js";
import { decodeCurrency, decodeEscrowType, toDisplayAmount, truncatePda } from "../helpers.js";
import { getDecimalsForMint } from "./tokenRegistry.js";
/**
 * Fetches every StockRampOrder account and decodes it into display-ready
 * shape. `amount` on-chain is NEVER total deposited — for BUY orders it's
 * committed minus active reservations, for SELL orders it's what remains
 * in escrow (same field-meaning as Trust Vault's TrustExpress).
 *
 * escrow_type decoded via STOCK_RAMP_SELL/STOCK_RAMP_BUY constants
 * (helpers.ts) — a plain u8, not an IDL enum.
 */
export async function fetchAllOrders() {
    const program = getProgram();
    // Anchor account namespace name must match the IDL's account name for
    // StockRampOrder — adjust `.stockRampOrder` below if your IDL casing differs.
    const accounts = await program.account.stockRampOrder.all();
    return Promise.all(accounts.map(async (entry) => {
        const acc = entry.account;
        const mint = acc.mint.toString();
        const decimals = await getDecimalsForMint(mint);
        return {
            orderAddress: entry.publicKey.toString(),
            orderAddressTruncated: truncatePda(entry.publicKey.toString()),
            orderType: decodeEscrowType(acc.escrowType),
            maker: acc.maker.toString(),
            mint,
            currency: decodeCurrency(acc.currency),
            amount: toDisplayAmount(acc.amount, decimals),
            pricePerToken: Number(acc.pricePerToken),
            reservationsUsed: acc.reservedAmounts.length,
            reservationsMax: 10,
        };
    }));
}
