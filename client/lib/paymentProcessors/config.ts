// client/lib/paymentProcessors/config.ts
// Shared processor metadata used by both the API routes (field validation,
// which columns to encrypt) and the settings UI (which inputs to render).

export const PROCESSORS = ["flutterwave", "korapay", "opay", "paystack"] as const;
export type Processor = (typeof PROCESSORS)[number];

export type CredentialSide = "buyer" | "seller";

export function isProcessor(value: string): value is Processor {
  return (PROCESSORS as readonly string[]).includes(value);
}

export interface ProcessorFieldDef {
  /** Key used in the store request body and in ProcessorFields below. */
  key: "secretKey" | "publicKey" | "merchantId";
  label: string;
  placeholder: string;
  /** Rendered as a password-style input with a reveal toggle. */
  secret: boolean;
}

export const PROCESSOR_LABELS: Record<Processor, string> = {
  flutterwave: "Flutterwave",
  korapay: "Korapay",
  opay: "OPay",
  paystack: "Paystack",
};

export const PROCESSOR_FIELDS: Record<Processor, ProcessorFieldDef[]> = {
  flutterwave: [
    { key: "secretKey", label: "Secret Key", placeholder: "FLWSECK-... or FLWSECK_TEST-...", secret: true },
  ],
  // Mirrors discord-bot/lib/korapay-credentials-bot.ts: single secretKey,
  // stored under the shared tables with processor='korapay' — no public key
  // or merchant ID, unlike OPay.
  korapay: [
    { key: "secretKey", label: "Secret Key", placeholder: "sk_test_... or sk_live_...", secret: true },
  ],
  opay: [
    { key: "publicKey", label: "Public Key", placeholder: "OPAYPUB...", secret: false },
    { key: "secretKey", label: "Secret Key", placeholder: "OPAYPRV...", secret: true },
    { key: "merchantId", label: "Merchant ID", placeholder: "e.g. 256619092316009", secret: false },
  ],
  paystack: [
    { key: "secretKey", label: "Secret Key", placeholder: "sk_test_... or sk_live_...", secret: true },
  ],
};

export interface ProcessorFields {
  secretKey?: string;
  publicKey?: string;
  merchantId?: string;
}

/** Table names — kept as-is to match discord-bot's already-written readers. */
export const CREDENTIAL_TABLE: Record<CredentialSide, string> = {
  buyer: "buyer_flutterwave_credentials",
  seller: "seller_flutterwave_accounts",
};

/**
 * Order <-> credential link tables (see
 * supabase/migrations/0007_order_credential_links.sql). Purely an off-chain
 * lookup index — create_buy_order / create_sell_order already store the
 * credential id directly on the on-chain StockRampOrder account, so a
 * failure to write here must never be treated as the order itself failing.
 */
export const ORDER_LINK_TABLE: Record<CredentialSide, string> = {
  buyer: "buy_order_credentials",
  seller: "sell_order_credentials",
};

export function validateFieldsPresent(
  processor: Processor,
  fields: ProcessorFields
): { valid: boolean; missing?: string } {
  for (const def of PROCESSOR_FIELDS[processor]) {
    const value = fields[def.key];
    if (!value || !value.trim()) {
      return { valid: false, missing: def.label };
    }
  }
  return { valid: true };
}
