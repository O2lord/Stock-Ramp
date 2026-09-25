import { getProgram } from "../program.js";
import { PublicKey } from "@solana/web3.js";
import { findReceipt } from "./receipt.js";

/**
 * wait_for_payment — bounded server-side poll (~40s, every 4s), NOT a
 * proactive push.
 *
 * SAFETY-CRITICAL: never assert success from on-chain state alone. A
 * reservation disappearing from `reserved_amounts` is necessary but NOT
 * sufficient — submit_vote.rs removes it identically on both the success
 * and rejection paths. Only a matching `receipts` row (findReceipt) is a
 * real success signal, since that row is only ever written after the
 * off-chain payout processor verified the transfer.
 */
export async function waitForPayment(args: {
  orderAddress: string;
  stockRampOrderAddress: string;
  takerWallet: string;
  sinceUnixSeconds: number;
}) {
  const program = getProgram();
  const pubkey = new PublicKey(args.orderAddress);
  const deadline = Date.now() + 40_000;

  while (Date.now() < deadline) {
    const acc = await (program.account as any).stockRampOrder.fetch(pubkey);
    const stillPending = acc.reservedAmounts.some(
      (r: any) => r.taker.toString() === args.takerWallet && Number(r.timestamp) >= args.sinceUnixSeconds
    );

    if (!stillPending) {
      const receipt = await findReceipt({
        stockRampOrderAddress: args.stockRampOrderAddress,
        takerAddress: args.takerWallet,
      });

      if (receipt) {
        return { outcome: "success" as const, receipt };
      }

      return {
        outcome: "unknown" as const,
        message:
          "The reservation is no longer active but I can't confirm whether it succeeded or was rejected/refunded from here. Please check your dashboard or bank app before treating this as paid.",
      };
    }

    await new Promise((r) => setTimeout(r, 4000));
  }

  return {
    outcome: "pending" as const,
    message: "Still pending after 40s -- ask again in a moment, the reservation is still active.",
  };
}
