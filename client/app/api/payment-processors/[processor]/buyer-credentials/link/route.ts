// POST /api/payment-processors/{processor}/buyer-credentials/link
//
// Links a saved buyer credential to a just-created on-chain buy order, for
// off-chain lookups only (merchant settings, support tooling, analytics).
// NOT required for on-chain correctness: create_buy_order already stores
// flutterwave_credential_id directly on the StockRampOrder account (see
// supabase/migrations/0001_payment_processor_credentials.sql's comment and
// 0007_order_credential_links.sql). Callers should treat a failure here as
// non-fatal — the order is already live on-chain regardless of whether this
// write succeeds.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/client";
import { verifySignature, validateMessage } from "@/lib/solana-auth";
import { isProcessor, CREDENTIAL_TABLE, ORDER_LINK_TABLE } from "@/lib/paymentProcessors/config";

export async function POST(request: NextRequest, { params }: { params: { processor: string } }) {
  if (!isProcessor(params.processor)) {
    return NextResponse.json({ error: "Unknown processor" }, { status: 400 });
  }

  const body = await request.json();
  const { stockRampOrder, credentialId, walletAddress, signature, message } = body as {
    stockRampOrder: string;
    credentialId: string;
    walletAddress: string;
    signature: string;
    message: string;
  };

  if (!stockRampOrder || !credentialId || !walletAddress) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  if (!signature || !message) {
    return NextResponse.json({ error: "Missing authentication credentials" }, { status: 401 });
  }

  const messageCheck = validateMessage(message, "link_buy_order_credential");
  if (!messageCheck.valid) {
    return NextResponse.json({ error: messageCheck.error }, { status: 400 });
  }

  const isValidSig = await verifySignature(walletAddress, signature, message);
  if (!isValidSig) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // Only let a wallet link a credential it actually owns and that's active.
  const { data: credential, error: credError } = await supabaseAdmin
    .from(CREDENTIAL_TABLE.buyer)
    .select("id, is_active")
    .eq("id", credentialId)
    .eq("wallet_address", walletAddress)
    .eq("processor", params.processor)
    .single();

  if (credError || !credential) {
    return NextResponse.json({ error: "Credential not found for this wallet" }, { status: 404 });
  }
  if (!credential.is_active) {
    return NextResponse.json({ error: "Cannot link an inactive credential" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from(ORDER_LINK_TABLE.buyer)
    .upsert(
      {
        stock_ramp_order: stockRampOrder,
        credential_id: credentialId,
        processor: params.processor,
        wallet_address: walletAddress,
      },
      { onConflict: "stock_ramp_order" }
    )
    .select()
    .single();

  if (error) {
    console.error("Error linking buyer credential to order:", error);
    return NextResponse.json(
      { error: "Failed to link credential", details: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, data });
}
