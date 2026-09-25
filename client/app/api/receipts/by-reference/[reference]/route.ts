// GET /api/receipts/by-reference/[reference]
// Looks up a settlement receipt by its payout_reference — used by
// app/payment-success/[payoutReference]/page.tsx to resolve the reference
// embedded in the payment redirect URL (see discord-bot/bot.ts's
// generatePaymentLink, which builds `redirect_url` as
// `${NEXT_PUBLIC_APP_URL}/payment-success/${reference}`) into the receipt's
// actual DB id, since the receipt row is only inserted once a validator
// votes (see /api/bot/generate-sell-receipt and
// discord-bot/bot.ts::upsertSettlementReceipt) — it may not exist yet the
// instant the buyer lands on this page.
//
// Ported from trust_vault's client/app/api/receipts/by-reference/[reference]/route.ts.
// Same `receipts` table/schema as this repo's other receipt routes (see
// /api/receipts/by-transaction's header on the shared-schema column names).
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ reference: string }> }
) {
  try {
    const { reference } = await params;

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: receipt, error } = await supabase
      .from("receipts")
      .select("*")
      .eq("payout_reference", reference)
      .single();

    if (error || !receipt) {
      return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
    }

    return NextResponse.json(receipt);
  } catch (error) {
    console.error("[Receipt by-reference API] Error fetching receipt:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
