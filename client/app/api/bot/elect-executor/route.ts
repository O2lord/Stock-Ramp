// POST /api/bot/elect-executor
// Called by ALL validators (5x, racing) for every BUY-order reservation.
// The server does the race, not the bots: `bot_payouts.payout_reference`
// is the primary key, so the first successful INSERT wins EXECUTOR and
// every conflicting INSERT becomes VERIFIER. See Fix.md and
// supabase/migrations/0004_bot_payout_state.sql for the full reasoning.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/client";
import { checkValidatorAuth } from "@/lib/validatorAuth";

export async function POST(request: NextRequest) {
  const authError = await checkValidatorAuth(request);
  if (authError) return authError;

  const body = await request.json().catch(() => null);
  const payoutReference: string | undefined = body?.payout_reference;
  const stockRampOrderPda: string | undefined = body?.stock_ramp_order_pda;

  if (!payoutReference || !stockRampOrderPda) {
    return NextResponse.json(
      { error: "payout_reference and stock_ramp_order_pda are required" },
      { status: 400 }
    );
  }

  const { error } = await supabaseAdmin.from("bot_payouts").insert({
    payout_reference: payoutReference,
    stock_ramp_order_pda: stockRampOrderPda,
    status: "electing",
  });

  if (!error) {
    // This validator's INSERT won the race.
    return NextResponse.json({ role: "executor" });
  }

  // Unique-violation on payout_reference means another validator already
  // won — this one is a verifier. Any other error is a real DB problem.
  if (error.code === "23505") {
    return NextResponse.json({ role: "verifier" });
  }

  console.error("elect-executor insert failed:", error);
  return NextResponse.json({ error: "Failed to elect executor" }, { status: 500 });
}
