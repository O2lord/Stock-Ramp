/** currency: [u8; 3] on-chain -> "NGN" */
export function decodeCurrency(bytes: number[] | Uint8Array): string {
  return Buffer.from(bytes).toString("utf-8");
}

/**
 * escrow_type is a plain `u8` on the StockRampOrder account, not an Anchor
 * enum — confirmed against state/stock_ramp_order.rs:
 *
 *   pub const STOCK_RAMP_SELL: u8 = 0;
 *   pub const STOCK_RAMP_BUY: u8 = 1;
 */
const ESCROW_TYPE: Record<number, "sell" | "buy"> = { 0: "sell", 1: "buy" };

export function decodeEscrowType(escrowType: number): "sell" | "buy" {
  const val = ESCROW_TYPE[escrowType];
  if (!val) {
    throw new Error(
      `Unexpected escrow_type value ${escrowType} — expected 0 (sell) or 1 (buy) ` +
        `per STOCK_RAMP_SELL/STOCK_RAMP_BUY in state/stock_ramp_order.rs.`
    );
  }
  return val;
}

/**
 * ReservedAmount.status is a plain `u8` — confirmed directly against
 * constants.rs and submit_vote.rs's handling:
 *
 *   0 -- STATUS_PENDING (set at reservation creation)
 *   1 -- STATUS_PAYMENT_SENT (reserved for future use; not currently set
 *        by any instruction in this build)
 *   2 -- STATUS_COMPLETED (set on validator-vote success)
 *   3 -- STATUS_CANCELLED (set by finalize_expired_vote's refund path)
 *   4 -- STATUS_DISPUTED (reserved for future dispute-resolution flow;
 *        not currently set by any instruction in this build)
 *
 * Unlike Trust Vault's helpers.ts (which had to guess at an unconfirmed
 * mapping and warned that success/rejection are indistinguishable once a
 * reservation is removed), StockRamp's program removes the reservation
 * from `reserved_amounts` on BOTH outcomes too (see submit_vote.rs) — so
 * the same caveat applies here: don't treat "reservation disappeared" as
 * proof of success. wait_for_payment/get_receipt (the receipts-table
 * check) remain the real success oracle, not this status field alone.
 */
const RESERVATION_STATUS: Record<number, string> = {
  0: "pending",
  1: "payment_sent",
  2: "completed",
  3: "cancelled",
  4: "disputed",
};

export function decodeReservationStatus(status: number): { code: number; label: string } {
  const label = RESERVATION_STATUS[status];
  if (!label) {
    return { code: status, label: `unmapped_status_${status}` };
  }
  return { code: status, label };
}

export function toDisplayAmount(rawAmount: bigint | number, decimals: number): number {
  const raw = typeof rawAmount === "bigint" ? rawAmount : BigInt(rawAmount);
  return Number(raw) / 10 ** decimals;
}

/** Truncated PDA display format: "EWkT…jQr7" */
export function truncatePda(pda: string): string {
  if (pda.length <= 10) return pda;
  return `${pda.slice(0, 4)}…${pda.slice(-4)}`;
}
