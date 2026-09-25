import { PublicKey } from "@solana/web3.js";

// UNLIKE Trust Vault's PROGRAM_ID (hardcoded — that program is deployed and
// immutable), StockRamp's deployment isn't final yet as of this build, so
// this is sourced from env rather than hardcoded to avoid baking in a
// throwaway localnet/devnet address. Set STOCK_RAMP_PROGRAM_ID once you
// have your real devnet/mainnet deployment.
if (!process.env.STOCK_RAMP_PROGRAM_ID) {
  throw new Error(
    "STOCK_RAMP_PROGRAM_ID is not set. Set it to your deployed program's " +
      "address (from `anchor keys list` after `anchor keys sync`)."
  );
}
export const PROGRAM_ID = new PublicKey(process.env.STOCK_RAMP_PROGRAM_ID);

// was TRUST_EXPRESS_SEED = "trust-express"
export const STOCK_RAMP_ORDER_SEED = "stock-ramp-order";

// Token identity (mint -> decimals) is derived live from on-chain data, not
// hardcoded here — see src/tools/tokenRegistry.ts. Same reasoning as Trust
// Vault: a static list drifts from whatever network/deployment is actually
// live and caused a real bug there (devnet orders vs mainnet mint list).

// Same processors as Trust Vault (this reuses those integrations) — kept
// as config since there's no on-chain representation of "which fiat
// currencies / payment processors this product supports" the way there is
// for order data.
export const SUPPORTED_CURRENCIES = [
  "NGN",
  "GHS",
  "KES",
  "ZAR",
  "UGX",
  "TZS",
  "XOF",
  "XAF",
  "MAD",
  "EGP",
] as const;

// OPay intentionally excluded — same reason as Trust Vault (bans crypto).
export const SUPPORTED_PROCESSORS = ["Flutterwave", "Paystack", "Korapay"] as const;

// Fee split is NOT stored on-chain as a config value — it's hardcoded in
// the Rust program's split_fee() (submit_vote.rs): 20% platform / 60%
// maker(LP) / 20% validator pool. Surfaced here as documented protocol
// behavior for get_fee_structure to report alongside the live on-chain
// fee_percentage (basis points), not as something read from an account.
export const FEE_SPLIT = {
  platformPct: 20,
  makerPct: 60,
  validatorPoolPct: 20,
} as const;
