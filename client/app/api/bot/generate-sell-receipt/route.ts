// POST /api/bot/generate-sell-receipt
// Called by each validator right after it casts a YES vote on a SELL-order
// reservation (see validator-bot/val_bot.ts) — creates a preliminary
// "pending" receipt row so a receipt id/URL exists early. The discord bot's
// on-chain ValidatorVoteExecutedEvent listener (bot.ts's
// upsertSettlementReceipt) later flips this same row to "success"/"failed"
// once consensus actually executes on-chain — both paths converge safely
// because `receipts.payout_reference` is unique.
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { supabaseAdmin } from "@/lib/supabase/client";
import { checkValidatorAuth } from "@/lib/validatorAuth";

interface RequestBody {
  payout_reference: string;
  stock_ramp_order_pda: string;
  taker: string;
  maker: string;
  token_amount: string;
  fiat_amount: string;
  currency: string;
  transaction_signature: string;
  mint_address: string | null;
}

export async function POST(request: NextRequest) {
  const authError = await checkValidatorAuth(request);
  if (authError) return authError;

  const body = (await request.json().catch(() => null)) as RequestBody | null;
  if (
    !body?.payout_reference ||
    !body?.stock_ramp_order_pda ||
    !body?.taker ||
    !body?.maker ||
    !body?.token_amount ||
    !body?.fiat_amount ||
    !body?.currency ||
    !body?.transaction_signature
  ) {
    return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 });
  }

  const { data: existing } = await supabaseAdmin
    .from("receipts")
    .select("id")
    .eq("payout_reference", body.payout_reference)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ success: true, receipt_id: existing.id, idempotent: true });
  }

  const receiptId = randomUUID();
  const { error } = await supabaseAdmin.from("receipts").insert({
    id: receiptId,
    payout_reference: body.payout_reference,
    transaction_signature: body.transaction_signature,
    trust_express_address: body.stock_ramp_order_pda,
    taker_address: body.taker,
    maker_address: body.maker,
    token_amount: body.token_amount,
    fiat_amount: body.fiat_amount,
    currency: body.currency,
    payout_method: "validator_consensus",
    status: "pending",
    mint_address: body.mint_address,
    created_at: new Date().toISOString(),
  });

  if (error) {
    // Unique violation means another validator's request beat us here —
    // treat as idempotent success rather than an error.
    if (error.code === "23505") {
      const { data: winner } = await supabaseAdmin
        .from("receipts")
        .select("id")
        .eq("payout_reference", body.payout_reference)
        .maybeSingle();
      return NextResponse.json({ success: true, receipt_id: winner?.id ?? receiptId, idempotent: true });
    }
    console.error("generate-sell-receipt insert failed:", error);
    return NextResponse.json({ success: false, error: "Failed to create receipt" }, { status: 500 });
  }

  return NextResponse.json({ success: true, receipt_id: receiptId, idempotent: false });
}
