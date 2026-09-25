// GET /api/receipts/[id]
// Fetches a single settlement receipt by id, for the standalone
// /receipts/[id] page (linked from InstantReserveDialog once a receipt
// shows up). Mirrors trust_vault's client/app/api/receipts/[id]/route.ts,
// using the shared supabaseAdmin helper instead of constructing a fresh
// Supabase client per-request.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/client";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const { data: receipt, error } = await supabaseAdmin
      .from("receipts")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !receipt) {
      return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
    }

    return NextResponse.json(receipt);
  } catch (error) {
    console.error("Error fetching receipt:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
