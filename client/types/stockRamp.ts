// client/types/stockRamp.ts
// Mirrors trust_vault's `types/trustVault.ts`. The real shapes are already
// derived from the IDL via `IdlAccounts<StockRamp>` in
// `hooks/useStockRampProgram.ts` (see GlobalState, StockRampOrderAccount,
// ValidatorEarningsAccount, ValidatorVoteAccount there) — this file re-exports
// those plus the status/mode/escrow-type enums from `lib/constant.ts` so
// components/schemas can import everything stock-ramp-related from one place.

import type { BN } from "@coral-xyz/anchor";
import type { PublicKey } from "@solana/web3.js";
import type {
  GlobalState,
  StockRampOrderAccount,
  ValidatorEarningsAccount,
  ValidatorVoteAccount,
} from "../hooks/useStockRampProgram";
import {
  RESERVATION_STATUS,
  PAYMENT_MODE,
  ESCROW_TYPE,
} from "../lib/constant";

export type {
  GlobalState,
  StockRampOrderAccount,
  ValidatorEarningsAccount,
  ValidatorVoteAccount,
};

export { RESERVATION_STATUS, PAYMENT_MODE, ESCROW_TYPE };

/**
 * A single entry in `StockRampOrder.reservedAmounts` — mirrors
 * `state/reservation.rs`'s `ReservedAmount`. Anchor's TS client deserializes
 * struct fields to camelCase, hence the field names below (not the Rust
 * snake_case).
 */
export interface ReservedAmount {
  taker: PublicKey;
  amount: BN;
  fiatAmount: BN;
  timestamp: BN;
  sellerInstructions: string | null;
  status: ReservationStatus;
  disputeReason: string | null;
  disputeId: string | null;
  payoutDetails: string | null;
  payoutReference: string | null;
  paymentMode: PaymentMode;
  paymentLink: string | null;
  transactionReference: string | null;
}

export type ReservationStatus =
  (typeof RESERVATION_STATUS)[keyof typeof RESERVATION_STATUS];
export type PaymentMode = (typeof PAYMENT_MODE)[keyof typeof PAYMENT_MODE];
export type EscrowType = (typeof ESCROW_TYPE)[keyof typeof ESCROW_TYPE];

/** Reverse lookups — for rendering a human label from a raw status/mode byte. */
export const RESERVATION_STATUS_LABEL: Record<ReservationStatus, string> = {
  [RESERVATION_STATUS.PENDING]: "Pending",
  [RESERVATION_STATUS.PAYMENT_SENT]: "Payment sent",
  [RESERVATION_STATUS.COMPLETED]: "Completed",
  [RESERVATION_STATUS.CANCELLED]: "Cancelled",
  [RESERVATION_STATUS.DISPUTED]: "Disputed",
};

export const PAYMENT_MODE_LABEL: Record<PaymentMode, string> = {
  [PAYMENT_MODE.LINK]: "Payment link",
  [PAYMENT_MODE.DIRECT]: "Direct transfer",
};

export const ESCROW_TYPE_LABEL: Record<EscrowType, string> = {
  [ESCROW_TYPE.SELL]: "Sell order",
  [ESCROW_TYPE.BUY]: "Buy order",
};

/** A StockRampOrder account paired with its PDA — the shape `.all()` returns
 *  and the shape most list/grid components will want to render from. */
export interface StockRampOrderWithPda {
  publicKey: PublicKey;
  account: StockRampOrderAccount;
}

/** Convenience: is this order a buy order (LP is offering fiat for tokens)? */
export function isBuyOrder(account: Pick<StockRampOrderAccount, "escrowType">): boolean {
  return account.escrowType === ESCROW_TYPE.BUY;
}

/** Convenience: is this order a sell order (LP is offering tokens for fiat)? */
export function isSellOrder(account: Pick<StockRampOrderAccount, "escrowType">): boolean {
  return account.escrowType === ESCROW_TYPE.SELL;
}

/** Decodes the on-chain `[u8; 3]` currency code (e.g. [78,71,78]) to "NGN". */
export function decodeCurrency(currency: number[] | Uint8Array): string {
  return Buffer.from(currency).toString("utf-8");
}
