import { PublicKey } from "@solana/web3.js";
import { getProgram } from "../program.js";
import { decodeCurrency, decodeEscrowType, decodeReservationStatus, toDisplayAmount } from "../helpers.js";
import { getDecimalsForMint } from "./tokenRegistry.js";
/**
 * get_order_status -- one RPC call, full order state including embedded
 * reservations. ValidatorVote is deliberately NOT fetched here — separate
 * PDA keyed off keccak256(payout_reference), out of scope for these
 * general-info tools.
 */
export async function getOrderStatus(args) {
    const program = getProgram();
    const pubkey = new PublicKey(args.orderAddress);
    const acc = await program.account.stockRampOrder.fetch(pubkey);
    const mint = acc.mint.toString();
    const decimals = await getDecimalsForMint(mint);
    return {
        orderAddress: args.orderAddress,
        orderType: decodeEscrowType(acc.escrowType),
        maker: acc.maker.toString(),
        mint,
        currency: decodeCurrency(acc.currency),
        availableAmount: toDisplayAmount(acc.amount, decimals),
        pricePerToken: Number(acc.pricePerToken),
        reservations: acc.reservedAmounts.map((r) => ({
            taker: r.taker.toString(),
            amount: toDisplayAmount(r.amount, decimals),
            fiatAmount: Number(r.fiatAmount),
            status: decodeReservationStatus(r.status),
            timestamp: new Date(Number(r.timestamp) * 1000).toISOString(),
            paymentMode: r.paymentMode === 0 ? "payment_link" : "direct_transfer",
        })),
    };
}
