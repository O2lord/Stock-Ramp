// POST /api/admin/register-validator
// Off-chain sync step for validator registration — closes the gap noted in
// the Trust Vault comparison: StockRamp's on-chain register_validator
// (programs/stock-ramp/src/instructions/admin.rs) writes the new
// validator's pubkey into GlobalState, but nothing previously issued that
// validator's bot an x-validator-key it could actually use. Mirrors Trust
// Vault's two-phase flow: on-chain program is the source of truth for WHO
// counts as a validator, this route (+ the new `validators` table) is a
// synced off-chain mirror that hands out an API key for validator-bot auth.
//
// Called by ValidatorManagement.tsx right after the on-chain
// register_validator transaction confirms. Trusts nothing from the request
// body on its own — independently re-verifies both the transaction and the
// on-chain authority before minting a key.
import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { randomBytes, createHash } from "crypto";
import { supabaseAdmin } from "@/lib/supabase/client";
import { fetchGlobalState, isValidatorInRoster, getGlobalStateConnection } from "@/lib/globalState";
import { verifyTxSignedBy } from "@/lib/verifyTxSigner";

interface RequestBody {
  adminPubkey: string;
  validatorPubkey: string;
  label?: string;
  txSignature: string;
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as RequestBody | null;

  if (!body?.adminPubkey || !body?.validatorPubkey || !body?.txSignature) {
    return NextResponse.json(
      { error: "adminPubkey, validatorPubkey, and txSignature are required" },
      { status: 400 }
    );
  }

  let validatorPk: PublicKey;
  try {
    validatorPk = new PublicKey(body.validatorPubkey);
  } catch {
    return NextResponse.json({ error: "Invalid validatorPubkey" }, { status: 400 });
  }

  // 1. Confirm the claimed admin actually signed this exact transaction —
  // doesn't trust adminPubkey from the body on its own.
  const connection = getGlobalStateConnection();
  const signerCheck = await verifyTxSignedBy(connection, body.txSignature, body.adminPubkey);
  if (!signerCheck.ok) {
    return NextResponse.json({ error: signerCheck.error }, { status: 400 });
  }

  // 2. Independently read on-chain GlobalState and confirm adminPubkey is
  // really the program's authority — not just a signer of *some*
  // transaction.
  let globalState;
  try {
    globalState = await fetchGlobalState();
  } catch (err) {
    return NextResponse.json(
      { error: `Could not read GlobalState: ${err instanceof Error ? err.message : "unknown error"}` },
      { status: 500 }
    );
  }
  if (globalState.authority.toBase58() !== body.adminPubkey) {
    return NextResponse.json({ error: "adminPubkey is not the GlobalState authority" }, { status: 403 });
  }

  // 3. Confirm the validator was actually written into the on-chain roster
  // by that transaction — an admin key that's valid but pointed at the
  // wrong tx (or a tx that didn't land the way the client claims) shouldn't
  // be able to mint a key for a validator that was never really registered.
  if (!isValidatorInRoster(globalState, validatorPk)) {
    return NextResponse.json(
      { error: "validatorPubkey is not present in GlobalState.validators — on-chain registration not confirmed" },
      { status: 400 }
    );
  }

  // 4. Generate a random API key, store only its hash (mirrors
  // VALIDATOR_API_KEYS' existing "vk_..." format so both auth paths in
  // lib/validatorAuth.ts recognize the same key shape).
  const apiKey = `vk_${randomBytes(32).toString("hex")}`;
  const apiKeyHash = createHash("sha256").update(apiKey).digest("hex");

  const { error } = await supabaseAdmin.from("validators").upsert({
    wallet_pubkey: validatorPk.toBase58(),
    label: body.label ?? null,
    api_key_hash: apiKeyHash,
    is_active: true,
    registered_tx_signature: body.txSignature,
    removed_tx_signature: null,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    console.error("register-validator upsert failed:", error);
    return NextResponse.json({ error: "Failed to store validator record" }, { status: 500 });
  }

  // Plaintext key is returned exactly once — the UI should show it in a
  // one-time reveal and never re-fetch it (only the hash is persisted).
  return NextResponse.json({
    apiKey,
    walletPubkey: validatorPk.toBase58(),
    label: body.label ?? null,
  });
}
