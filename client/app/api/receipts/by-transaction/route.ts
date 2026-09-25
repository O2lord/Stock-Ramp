// GET /api/receipts/by-transaction?stockRampOrder=...&takerAddress=...&since=...
// Polled by InstantReserveDialog after a reservation lands on-chain, while it
// waits for the elected validator's consensus vote to execute and the payout
// to actually clear. That vote is what triggers /api/bot/generate-sell-receipt
// (see that route) to insert a row into `receipts`, keyed by the stock-ramp
// order's PDA — the column is still named `trust_express_address` since the
// `receipts` table (and this lookup) is shared with trust_vault's schema.
//
// Mirrors trust_vault's client/app/api/receipts/by-transaction/route.ts
// almost exactly; the only rename is the query param, to match what
// InstantReserveDialog actually has on hand (a StockRampOrder PDA, not a
// "trust express address").
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const stockRampOrder = searchParams.get("stockRampOrder");
    const takerAddress = searchParams.get("takerAddress");
    const sinceTimestamp = searchParams.get("since");

    if (!stockRampOrder) {
      return NextResponse.json(
        { error: "stockRampOrder is required" },
        { status: 400 }
      );
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Base query — always filter by the order PDA. Column name is a legacy
    // holdover from trust_vault's schema (see file header).
    let query = supabase
      .from("receipts")
      .select("*")
      .eq("trust_express_address", stockRampOrder)
      .order("created_at", { ascending: false })
      .limit(1);

    if (takerAddress) {
      query = query.eq("taker_address", takerAddress);
    }

    // gte, not gt — avoids missing a receipt created at the exact same
    // millisecond as `since`. Re-normalise through Date so Supabase's
    // timestamptz comparison works regardless of whether the client sent
    // an ISO string with or without milliseconds.
    if (sinceTimestamp) {
      const normalised = new Date(sinceTimestamp).toISOString();
      query = query.gte("created_at", normalised);
    }

    const { data: receipt, error } = await query.maybeSingle();

    if (error) {
      console.error("[Receipt API] Database error:", error);
      return NextResponse.json(
        { error: "Database error", details: error.message },
        { status: 500 }
      );
    }

    if (!receipt) {
      // No receipt yet — 200 with found:false so the poller just keeps going.
      return NextResponse.json({ found: false }, { status: 200 });
    }

    console.log("[Receipt API] Found receipt:", receipt.id, "for", stockRampOrder);
    return NextResponse.json(receipt, { status: 200 });
  } catch (error) {
    console.error("[Receipt API] Error fetching receipt:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
