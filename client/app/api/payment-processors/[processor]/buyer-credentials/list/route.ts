// GET /api/payment-processors/{processor}/buyer-credentials/list?walletAddress=...
// Read-only — no signature required.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/client";
import { isProcessor, CREDENTIAL_TABLE, PROCESSOR_FIELDS } from "@/lib/paymentProcessors/config";
import { PUBLIC_COLUMNS } from "@/lib/paymentProcessors/db";

export async function GET(request: NextRequest, { params }: { params: { processor: string } }) {
  if (!isProcessor(params.processor)) {
    return NextResponse.json({ error: "Unknown processor" }, { status: 400 });
  }

  const walletAddress = request.nextUrl.searchParams.get("walletAddress");
  if (!walletAddress) {
    return NextResponse.json({ error: "walletAddress is required" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from(CREDENTIAL_TABLE.buyer)
    .select(PUBLIC_COLUMNS)
    .eq("wallet_address", walletAddress)
    .eq("processor", params.processor)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error listing buyer credentials:", error);
    return NextResponse.json({ error: "Failed to list credentials" }, { status: 500 });
  }

  return NextResponse.json({
    credentials: data ?? [],
    fields: PROCESSOR_FIELDS[params.processor],
  });
}
