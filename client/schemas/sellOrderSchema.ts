// client/schemas/sellOrderSchema.ts
// Form validation for `CreateSellOrderDialog.tsx`. Same field constraints as
// buyOrderSchema.ts — `create_sell_order.rs` shares `validate_order_fields`
// and `parse_currency` with `create_buy_order.rs` — but kept as a separate
// schema (not a re-export) since sell orders additionally require the seller
// to actually hold the tokens being deposited, which the form/UI layer
// checks against the connected wallet's ATA balance rather than zod alone.
//
// `paymentInstructions` is no longer collected in the UI (removed from
// CreateSellOrderDialog.tsx). Kept here as an optional field defaulting to
// "" purely so the submitted shape still matches `validate_order_fields`,
// which only caps its length on-chain and never requires it to be non-empty.

import { z } from "zod";

export const sellOrderSchema = z.object({
  /** xStocks mint being deposited/sold. */
  mint: z
    .string()
    .min(32, "Enter a valid mint address")
    .max(44, "Enter a valid mint address"),

  /** Whole-token amount to deposit into escrow — must be > 0. */
  amount: z.coerce
    .number({ invalid_type_error: "Enter an amount" })
    .positive("Amount must be greater than 0"),

  /** Fiat price per whole token the seller wants, in `currency`. */
  pricePerToken: z.coerce
    .number({ invalid_type_error: "Enter a price" })
    .positive("Price must be greater than 0"),

  /** Exactly 3 ASCII bytes, e.g. "NGN". */
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .length(3, "Currency must be a 3-letter code, e.g. NGN"),

  /**
   * No longer collected via the UI — max 100 bytes on-chain if ever set,
   * but not required (only `credential_id` is required on-chain).
   */
  paymentInstructions: z
    .string()
    .trim()
    .max(100, "Payment instructions must be 100 characters or fewer")
    .optional()
    .default(""),

  /** Required, max 64 bytes on-chain. */
  flutterwaveCredentialId: z
    .string()
    .trim()
    .min(1, "Select a payment credential")
    .max(64, "Credential id must be 64 characters or fewer"),
});

export type SellOrderFormValues = z.infer<typeof sellOrderSchema>;
