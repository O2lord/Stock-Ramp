// client/lib/validatorAuth.ts
// Shared auth check for the platform API routes the validator bots call
// (elect-executor, initiate-buy-payout, payout-status, verify-transfer,
// verify-payment, generate-sell-receipt, heartbeat).
//
// Two allow-lists are checked, in order:
//  1. VALIDATOR_API_KEYS (comma-separated, plaintext) — the original 5
//     manually-provisioned keys from validator-bot/.env's
//     VALIDATOR_API_KEY1..5. Kept as-is for backward compatibility; these
//     were never issued through an API and have no Supabase row.
//  2. The `validators` table (supabase/migrations/0005_validators.sql) —
//     keys issued by POST /api/admin/register-validator for any validator
//     registered after that route existed. Only a SHA-256 hash is stored,
//     so the presented key is hashed before the lookup; a match requires
//     `is_active = true` (register-validator revokes on removal).
//
// This is what actually closes the "6th validator has no way to get a
// working key" gap — the API route mints the key, and this function is
// what makes that key work against the bot-facing routes.

import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { supabaseAdmin } from "@/lib/supabase/client";

function allowedKeys(): string[] {
  return (process.env.VALIDATOR_API_KEYS ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

// Looks up the wallet_pubkey behind a registered-validator key, or null if
// the key doesn't match any active row. Kept separate from the plain
// boolean check below so callers that need the identity (e.g.
// verify-payment's audit log) and callers that only need a yes/no
// (everything else) can both use it without duplicating the query.
async function findRegisteredValidatorPubkey(key: string): Promise<string | null> {
  const hash = createHash("sha256").update(key).digest("hex");
  const { data, error } = await supabaseAdmin
    .from("validators")
    .select("wallet_pubkey")
    .eq("api_key_hash", hash)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    console.error("validators lookup failed during auth check:", error);
    return null;
  }
  return data?.wallet_pubkey ?? null;
}

type ValidatorAuthResult =
  | { error: null; validatorPubkey: string | null }
  | { error: NextResponse; validatorPubkey?: undefined };

/**
 * Same authorization logic as checkValidatorAuth, but also resolves which
 * validator made the call so callers can attribute the request (e.g. an
 * audit-log insert). `validatorPubkey` is null for legacy
 * VALIDATOR_API_KEYS-allow-listed keys, since those predate the
 * `validators` table and aren't tied to a wallet row.
 */
export async function checkValidatorAuthWithIdentity(
  request: NextRequest
): Promise<ValidatorAuthResult> {
  const key = request.headers.get("x-validator-key");
  const allowed = allowedKeys();

  if (!key) {
    return { error: NextResponse.json({ error: "Invalid or missing x-validator-key" }, { status: 401 }) };
  }

  // Fast path: static env-var allow-list, no DB round trip. No wallet
  // identity available for these.
  if (allowed.includes(key)) {
    return { error: null, validatorPubkey: null };
  }

  // Fallback: check against validators registered via the admin API.
  const pubkey = await findRegisteredValidatorPubkey(key);
  if (pubkey) {
    return { error: null, validatorPubkey: pubkey };
  }

  if (allowed.length === 0) {
    console.error("VALIDATOR_API_KEYS is not configured and no matching registered validator key — rejecting.");
  }

  return { error: NextResponse.json({ error: "Invalid or missing x-validator-key" }, { status: 401 }) };
}

/** Returns null if authorized, or a 401/500 NextResponse to return immediately if not. */
export async function checkValidatorAuth(request: NextRequest): Promise<NextResponse | null> {
  const result = await checkValidatorAuthWithIdentity(request);
  return result.error;
}
