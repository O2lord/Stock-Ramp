// GET /api/bot/payout-status?payout_reference=...
// Polled by ALL validators (executor and verifiers alike) while waiting for
// the elected executor to record a transfer_reference in `bot_payouts` (see
// /api/initiate-buy-payout). Read-only, cheap — just reflects DB state.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/client";
import { checkValidatorAuth } from "@/lib/validatorAuth";

export async function GET(request: NextRequest) {
  const authError = await checkValidatorAuth(request);
  if (authError) return authError;

  const payoutReference = request.nextUrl.searchParams.get("payout_reference");
  if (!payoutReference) {
    return NextResponse.json({ error: "payout_reference is required" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("bot_payouts")
    .select("status, transfer_reference")
    .eq("payout_reference", payoutReference)
    .maybeSingle();

  if (error) {
    console.error("payout-status query failed:", error);
    return NextResponse.json({ error: "Failed to look up payout status" }, { status: 500 });
  }

  if (!data) {
    // No executor has been elected / recorded anything yet — still pending.
    return NextResponse.json({ status: "electing", transfer_reference: null });
  }

  return NextResponse.json({ status: data.status, transfer_reference: data.transfer_reference ?? null });
}
