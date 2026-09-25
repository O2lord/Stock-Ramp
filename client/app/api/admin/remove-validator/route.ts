// POST /api/admin/remove-validator
// Off-chain mirror of the on-chain remove_validator step — deactivates the
// Supabase `validators` row and revokes the stored API key hash so the
// removed validator's bot can no longer authenticate via
// lib/validatorAuth.ts, even though its VALIDATOR_API_KEY1..5 env var still
// has the old value sitting in its .env until an operator updates it.
//
// Called by ValidatorManagement.tsx right after the on-chain
// remove_validator transaction confirms. Same trust model as
// register-validator: never trusts adminPubkey from the body on its own.
import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { supabaseAdmin } from "@/lib/supabase/client";
import { fetchGlobalState, isValidatorInRoster, getGlobalStateConnection } from "@/lib/globalState";
import { verifyTxSignedBy } from "@/lib/verifyTxSigner";

interface RequestBody {
  adminPubkey: string;
  validatorPubkey: string;
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

  const connection = getGlobalStateConnection();
  const signerCheck = await verifyTxSignedBy(connection, body.txSignature, body.adminPubkey);
  if (!signerCheck.ok) {
    return NextResponse.json({ error: signerCheck.error }, { status: 400 });
  }

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

  // Mirrors register-validator's roster check in reverse: confirm the
  // on-chain slot was actually cleared before revoking the key. If it's
  // still present, remove_validator either didn't land or this is the
  // wrong tx signature — don't revoke a still-active validator's key.
  if (isValidatorInRoster(globalState, validatorPk)) {
    return NextResponse.json(
      { error: "validatorPubkey is still present in GlobalState.validators — on-chain removal not confirmed" },
      { status: 400 }
    );
  }

  const { error } = await supabaseAdmin
    .from("validators")
    .update({
      is_active: false,
      api_key_hash: null,
      removed_tx_signature: body.txSignature,
      updated_at: new Date().toISOString(),
    })
    .eq("wallet_pubkey", validatorPk.toBase58());

  if (error) {
    console.error("remove-validator update failed:", error);
    return NextResponse.json({ error: "Failed to deactivate validator record" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
