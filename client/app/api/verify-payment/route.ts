// GET /api/verify-payment?payout_reference=...&stock_ramp_order_pda=...&order_type=sell
// Polled by ALL validators for SELL-order reservations — confirms the
// buyer's inbound payment to the seller actually landed. Unlike the buy
// side, there's no bot_payouts row to key off of: the seller's credential
// id lives directly on the on-chain StockRampOrder account
// (flutterwaveCredentialId), so this route fetches that account itself
// rather than depending on any DB write from the discord bot.
//
// Every check is recorded in validator_verifications
// (supabase/migrations/0006_validator_verifications.sql), mirroring Trust
// Vault's equivalent route — a fire-and-forget insert so a logging hiccup
// never blocks the response the validator bot is waiting on.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/client";
import { checkValidatorAuthWithIdentity } from "@/lib/validatorAuth";
import { fetchStockRampOrder } from "@/lib/stockRampOrder";
import { CREDENTIAL_TABLE, isProcessor } from "@/lib/paymentProcessors/config";
import { decryptRowFields, type CredentialRow } from "@/lib/paymentProcessors/db";
import { verifyProcessorInboundPayment } from "@/lib/paymentProcessors/payout";

export async function GET(request: NextRequest) {
  const auth = await checkValidatorAuthWithIdentity(request);
  if (auth.error) return auth.error;

  const sp = request.nextUrl.searchParams;
  const payoutReference = sp.get("payout_reference");
  const stockRampOrderPda = sp.get("stock_ramp_order_pda");

  if (!payoutReference || !stockRampOrderPda) {
    return NextResponse.json(
      { verified: false, error: "payout_reference and stock_ramp_order_pda are required" },
      { status: 400 }
    );
  }

  let order;
  try {
    order = await fetchStockRampOrder(stockRampOrderPda);
  } catch (err) {
    return NextResponse.json({
      verified: false,
      error: `Could not fetch StockRampOrder account: ${err instanceof Error ? err.message : "unknown error"}`,
    });
  }

  if (!order.flutterwaveCredentialId) {
    return NextResponse.json({ verified: false, error: "Sell order has no linked payment credential" });
  }

  // The reservation's own recorded payout_reference is the source of truth
  // — cheap sanity check that the caller's reference matches an actual
  // reservation on this order before we spend a processor API call on it.
  const matchesReservation = order.reservedAmounts.some((r) => r.payoutReference === payoutReference);
  if (!matchesReservation) {
    return NextResponse.json({ verified: false, error: "No matching reservation for this payout_reference" });
  }

  // The credential id is processor-agnostic (just a row id) — check both
  // credential tables since sell-side settlement could theoretically be
  // linked from either, though seller_flutterwave_accounts is the expected
  // table for a sell order's maker.
  let credRow: CredentialRow | null = null;
  let processor: string | null = null;

  for (const table of [CREDENTIAL_TABLE.seller, CREDENTIAL_TABLE.buyer]) {
    const { data } = await supabaseAdmin
      .from(table)
      .select("*")
      .eq("id", order.flutterwaveCredentialId)
      .maybeSingle<CredentialRow>();
    if (data) {
      credRow = data;
      processor = data.processor;
      break;
    }
  }

  if (!credRow || !processor || !isProcessor(processor)) {
    return NextResponse.json({ verified: false, error: "Linked payment credential not found" });
  }

  const fields = decryptRowFields(credRow);
  const result = await verifyProcessorInboundPayment(processor, fields, payoutReference);

  // Audit log — fire-and-forget, same as Trust Vault's verify-payment
  // route. This route only ever handles sell-order reservations (see file
  // comment), so order_type is always 'sell' here even though the query
  // string carries it for parity with the bot-facing URL shape.
  supabaseAdmin
    .from("validator_verifications")
    .insert({
      validator_pubkey: auth.validatorPubkey,
      payout_reference: payoutReference,
      stock_ramp_order_pda: stockRampOrderPda,
      order_type: "sell",
      verified: result.verified,
      amount: result.amount ?? null,
      currency: result.currency ?? null,
    })
    .then(({ error }) => {
      if (error) console.warn("⚠️ Failed to log validator verification:", error.message);
    });

  return NextResponse.json(result);
}
