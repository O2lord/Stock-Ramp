// POST /api/initiate-buy-payout
// Called ONLY by the elected EXECUTOR validator (see /api/bot/elect-executor)
// for a BUY-order reservation. Fetches the LP's (order maker's) saved
// payment-processor credential and actually sends the fiat to the taker's
// bank account, recording the resulting transfer_reference in `bot_payouts`
// so /api/bot/payout-status and /api/verify-transfer can pick it up.
//
// Idempotency is critical here — this moves real money. If a retry comes in
// after a transfer_reference is already recorded, we return the existing
// reference instead of firing a second transfer.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/client";
import { checkValidatorAuth } from "@/lib/validatorAuth";
import { PROCESSORS, CREDENTIAL_TABLE, type Processor } from "@/lib/paymentProcessors/config";
import { decryptRowFields, type CredentialRow } from "@/lib/paymentProcessors/db";
import { initiateProcessorPayout, type PayoutBankDetails } from "@/lib/paymentProcessors/payout";

interface RequestBody {
  payout_reference: string;
  stock_ramp_order_pda: string;
  taker: string;
  maker: string;
  fiat_amount: number;
  token_amount: string;
  currency: string;
  payout_details: string; // JSON string: { account_number, bank_code, ... }
}

export async function POST(request: NextRequest) {
  const authError = await checkValidatorAuth(request);
  if (authError) return authError;

  const body = (await request.json().catch(() => null)) as RequestBody | null;
  if (
    !body?.payout_reference ||
    !body?.stock_ramp_order_pda ||
    !body?.maker ||
    !body?.payout_details ||
    typeof body.fiat_amount !== "number" ||
    !body?.currency
  ) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Already handled? Return the existing outcome instead of paying again.
  const { data: existing } = await supabaseAdmin
    .from("bot_payouts")
    .select("status, transfer_reference, error_message")
    .eq("payout_reference", body.payout_reference)
    .maybeSingle();

  if (existing?.transfer_reference) {
    return NextResponse.json({
      success: true,
      transfer_reference: existing.transfer_reference,
      idempotent: true,
    });
  }
  if (existing?.status === "failed_to_initiate") {
    return NextResponse.json({
      success: false,
      error: existing.error_message ?? "Payout previously failed to initiate",
      idempotent: true,
    });
  }

  let payoutDetails: PayoutBankDetails;
  try {
    payoutDetails = JSON.parse(body.payout_details);
    if (!payoutDetails.account_number) throw new Error("Missing account_number");
  } catch (err) {
    const message = `Invalid payout_details: ${err instanceof Error ? err.message : "parse error"}`;
    await markFailed(body.payout_reference, body.stock_ramp_order_pda, message);
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }

  // The maker (LP) is the buy order's owner — find their first active
  // credential across all processors, same lookup order
  // mcp-server/src/tools/credentialCheck.ts uses for the pre-flight check.
  const found = await findActiveBuyerCredential(body.maker);
  if (!found) {
    const message = `No active payment credential found for maker ${body.maker}`;
    await markFailed(body.payout_reference, body.stock_ramp_order_pda, message);
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }

  const fields = decryptRowFields(found.row);
  const result = await initiateProcessorPayout(
    found.processor,
    fields,
    payoutDetails,
    body.fiat_amount,
    body.currency,
    body.payout_reference
  );

  if (!result.success || !result.transferReference) {
    const message = result.error ?? "Payout initiation failed";
    await markFailed(body.payout_reference, body.stock_ramp_order_pda, message);
    return NextResponse.json({ success: false, error: message });
  }

  const { error: upsertError } = await supabaseAdmin.from("bot_payouts").upsert({
    payout_reference: body.payout_reference,
    stock_ramp_order_pda: body.stock_ramp_order_pda,
    status: "transfer_initiated",
    processor: found.processor,
    credential_id: found.row.id,
    transfer_reference: result.transferReference,
    updated_at: new Date().toISOString(),
  });

  if (upsertError) {
    console.error("Failed to record transfer_reference:", upsertError);
    // The transfer already went out — surface success anyway so the bots
    // don't fast-fail a trade whose money actually moved. payout-status
    // polling will just have to catch up once the row is fixed.
  }

  return NextResponse.json({ success: true, transfer_reference: result.transferReference });
}

async function markFailed(payoutReference: string, stockRampOrderPda: string, message: string): Promise<void> {
  const { error } = await supabaseAdmin.from("bot_payouts").upsert({
    payout_reference: payoutReference,
    stock_ramp_order_pda: stockRampOrderPda,
    status: "failed_to_initiate",
    error_message: message,
    updated_at: new Date().toISOString(),
  });
  if (error) console.error("Failed to record failed_to_initiate:", error);
}

async function findActiveBuyerCredential(
  walletAddress: string
): Promise<{ processor: Processor; row: CredentialRow } | null> {
  for (const processor of PROCESSORS) {
    const { data } = await supabaseAdmin
      .from(CREDENTIAL_TABLE.buyer)
      .select("*")
      .eq("wallet_address", walletAddress)
      .eq("processor", processor)
      .eq("is_active", true)
      .order("last_verified", { ascending: false })
      .limit(1)
      .maybeSingle<CredentialRow>();

    if (data) return { processor, row: data };
  }
  return null;
}
