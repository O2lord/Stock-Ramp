// GET /api/verify-transfer?payout_reference=...&stock_ramp_order_pda=...
// Polled by ALL validators (buy-side) once a transfer_reference exists in
// `bot_payouts` (recorded by /api/initiate-buy-payout). Checks the actual
// outbound-transfer status with whichever processor sent it.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/client";
import { checkValidatorAuth } from "@/lib/validatorAuth";
import { CREDENTIAL_TABLE, isProcessor } from "@/lib/paymentProcessors/config";
import { decryptRowFields, type CredentialRow } from "@/lib/paymentProcessors/db";
import { checkProcessorPayoutStatus } from "@/lib/paymentProcessors/payout";

export async function GET(request: NextRequest) {
  const authError = await checkValidatorAuth(request);
  if (authError) return authError;

  const payoutReference = request.nextUrl.searchParams.get("payout_reference");
  if (!payoutReference) {
    return NextResponse.json({ error: "payout_reference is required" }, { status: 400 });
  }

  const { data: payout, error } = await supabaseAdmin
    .from("bot_payouts")
    .select("status, processor, credential_id, transfer_reference, error_message")
    .eq("payout_reference", payoutReference)
    .maybeSingle();

  if (error) {
    console.error("verify-transfer lookup failed:", error);
    return NextResponse.json({ verified: false, error: "Failed to look up payout" }, { status: 500 });
  }

  if (!payout) {
    return NextResponse.json({ verified: false, status: "not_found" });
  }

  if (payout.status === "failed_to_initiate") {
    return NextResponse.json({
      verified: false,
      status: "FAILED",
      error: payout.error_message ?? "Payout failed to initiate",
    });
  }

  if (!payout.transfer_reference || !payout.processor || !payout.credential_id) {
    return NextResponse.json({ verified: false, status: "PENDING" });
  }

  if (!isProcessor(payout.processor)) {
    return NextResponse.json({ verified: false, error: `Unknown processor: ${payout.processor}` }, { status: 500 });
  }

  const { data: credRow, error: credError } = await supabaseAdmin
    .from(CREDENTIAL_TABLE.buyer)
    .select("*")
    .eq("id", payout.credential_id)
    .single<CredentialRow>();

  if (credError || !credRow) {
    return NextResponse.json({ verified: false, error: "Payout credential not found" }, { status: 500 });
  }

  const fields = decryptRowFields(credRow);
  const result = await checkProcessorPayoutStatus(payout.processor, fields, payout.transfer_reference);

  return NextResponse.json(result);
}
