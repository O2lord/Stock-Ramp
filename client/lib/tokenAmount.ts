// client/lib/tokenAmount.ts
// Single source of truth for the UI-tokens <-> base-units conversion.
//
// WHY THIS EXISTS: every `amount` the program stores or takes as an argument
// (StockRampOrder.amount, ReservedAmount.amount, instant_reserve's `amount`,
// stock_ramp_withdraw's `withdraw_amount`, cancel_or_reduce's `new_amount`)
// is in the mint's BASE UNITS — the same units the SPL transfers move. See
// create_sell_order.rs, which passes `amount` straight into
// `transfer_tokens`, and instant_reserve.rs, which does
// `stock_ramp_order.amount.checked_sub(amount)` right after a
// `transfer_checked` of that same `amount`.
//
// The client used to mix the two: CreateBuyDialog sent whole tokens
// (`new BN(values.amount)`) while InstantReserveDialog sent base units
// (`amount * 10 ** decimals`). Reserving 0.1 of a token (100_000 base units)
// against an order created for "1 token" (stored as 1) made that
// checked_sub underflow — surfacing as AnchorError 6017 ArithmeticOverflow
// *after* the tokens had already been transferred into escrow in the same
// instruction. trust_vault avoids this by scaling inside its
// `useTrustExpress` mutations (see createBuyOrder / instantReserve there);
// stock-ramp's `useStockRampProgram` is a thin pass-through instead, so the
// scaling lives here and is applied at every call site.
//
// RULE OF THUMB: anything entered by a human or rendered to one is a UI
// amount; anything crossing into `useStockRampProgram` or read off an
// account is base units. Convert at that boundary, never in between.

import { BN } from "@coral-xyz/anchor";
import type { Connection, PublicKey } from "@solana/web3.js";

/** Decimals never change for a mint, so a process-lifetime cache is safe. */
const decimalsCache = new Map<string, number>();

/**
 * Reads a mint's `decimals` without needing to know which token program owns
 * it. Byte 44 is `decimals` in the 82-byte mint layout, and Token-2022 keeps
 * that base layout intact (extensions are appended after it) — so this works
 * for both, unlike `getMint(connection, mint, undefined, TOKEN_PROGRAM_ID)`,
 * which throws TokenInvalidAccountOwnerError on a Token-2022 mint.
 */
export async function fetchMintDecimals(
  connection: Connection,
  mint: PublicKey
): Promise<number> {
  const key = mint.toBase58();
  const cached = decimalsCache.get(key);
  if (cached !== undefined) return cached;

  const info = await connection.getAccountInfo(mint);
  if (!info) throw new Error(`Mint account not found: ${key}`);
  if (info.data.length < 45) throw new Error(`Not a mint account: ${key}`);

  const decimals = info.data[44];
  decimalsCache.set(key, decimals);
  return decimals;
}

/** Whole tokens (what the user types) -> base units (what the program wants). */
export function toBaseUnits(uiAmount: number, decimals: number): BN {
  // BN truncates floats, so round to an integer count of base units first.
  return new BN(Math.round(uiAmount * 10 ** decimals));
}

/**
 * Base units (what an account stores) -> whole tokens (what we render).
 * Accepts `string` in addition to BN/number/bigint because Postgres
 * bigint/numeric columns (e.g. receipts.token_amount, receipts.fee_amount
 * — see app/receipts/[id]/page.tsx) come back as strings over JSON: Supabase
 * serializes them that way to avoid silent precision loss on large values.
 */
export function toUiAmount(
  raw: BN | number | bigint | string | null | undefined,
  decimals: number
): number {
  if (raw === null || raw === undefined || raw === "") return 0;
  const asNumber = typeof raw === "number" ? raw : Number(raw.toString());
  return asNumber / 10 ** decimals;
}

/**
 * Display helper: base units -> a human-readable string. Caps the fraction at
 * the mint's own precision so a 6-decimal token never renders 0.10000000001.
 */
export function formatTokenAmount(
  raw: BN | number | bigint | string | null | undefined,
  decimals: number
): string {
  return toUiAmount(raw, decimals).toLocaleString(undefined, {
    maximumFractionDigits: Math.min(decimals, 9),
  });
}
