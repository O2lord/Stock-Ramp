// client/schemas/buyOrderSchema.ts
// Form validation for `CreateBuyDialog.tsx`, mirroring the on-chain
// constraints in `create_buy_order.rs` / `utils.rs::validate_order_fields` /
// `utils.rs::parse_currency` exactly, so invalid input is caught client-side
// before a transaction is even built (not just relying on the program to
// reject it after a round-trip + fee).
//
// `paymentInstructions` is no longer collected in the UI (removed from
// CreateBuyDialog.tsx — makers manage payout details via their saved
// payment-processor credential instead, see CredentialPicker). It's kept
// here as an optional field defaulting to "" purely so the submitted shape
// still matches `validate_order_fields`, which only caps its length
// on-chain and never requires it to be non-empty.

import { z } from "zod";

export const buyOrderSchema = z.object({
  /** xStocks mint the LP wants to buy. */
  mint: z
    .string()
    .min(32, "Enter a valid mint address")
    .max(44, "Enter a valid mint address"),

  /** Whole-token amount the LP wants to buy — must be > 0 (validate_order_fields). */
  amount: z.coerce
    .number({ invalid_type_error: "Enter an amount" })
    .positive("Amount must be greater than 0"),

  /** Fiat price per whole token, in the order's `currency` — must be > 0. */
  pricePerToken: z.coerce
    .number({ invalid_type_error: "Enter a price" })
    .positive("Price must be greater than 0"),

  /**
   * Exactly 3 ASCII bytes (parse_currency requires `bytes.len() == 3`),
   * e.g. "NGN", "USD", "KES". Uppercased before validation so "ngn" passes.
   */
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

  /**
   * References a credential registered with the flutterwave-credentials-bot
   * (see discord-bot/lib/flutterwave-credentials-bot.ts) — required
   * (`!credential_id.is_empty()`), max 64 bytes on-chain.
   */
  flutterwaveCredentialId: z
    .string()
    .trim()
    .min(1, "Select a payment credential")
    .max(64, "Credential id must be 64 characters or fewer"),
});

export type BuyOrderFormValues = z.infer<typeof buyOrderSchema>;
