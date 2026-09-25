// In-memory intent store keyed by the Solana Pay `reference` pubkey.
// IMPORTANT: intentionally NOT persistent — a process restart between QR
// generation and wallet scan loses the intent (404s on POST). Fine for a
// hackathon build; move to Redis/Postgres with a TTL for anything longer-lived.

export type PendingIntent =
  | {
      kind: "create_buy_order";
      buyer: string; // base58 pubkey — the wallet that will sign
      seed: string; // stringified u64
      mint: string;
      amountRaw: string; // stringified u64, raw token units
      pricePerToken: string; // stringified u64, raw fiat units
      currency: string;
      paymentInstructions: string;
      credentialId: string | null;
    }
  | {
      kind: "create_sell_order";
      seller: string;
      seed: string;
      mint: string;
      amountRaw: string; // the deposit amount — moves real tokens at creation
      pricePerToken: string;
      currency: string;
      paymentInstructions: string;
      credentialId: string;
    }
  | {
      kind: "reserve_sell_order";
      stockRampOrder: string; // was trustExpress
      maker: string;
      // No `buyer` field — the wallet identifies itself at scan time via
      // POST /pay/:reference's req.body.account.
      amountRaw: string;
      payoutReference: string;
    };

const intents = new Map<string, PendingIntent>();
const TTL_MS = 5 * 60 * 1000;

export function storeIntent(reference: string, intent: PendingIntent) {
  intents.set(reference, intent);
  setTimeout(() => intents.delete(reference), TTL_MS).unref();
}

export function getIntent(reference: string): PendingIntent | undefined {
  return intents.get(reference);
}
