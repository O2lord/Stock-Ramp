// DELETE /api/payment-processors/{processor}/buyer-credentials/delete
//   ?credentialId=...&walletAddress=...&signature=...&message=...
// Write — requires a wallet signature.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/client";
import { verifySignature, validateMessage } from "@/lib/solana-auth";
import { isProcessor, CREDENTIAL_TABLE } from "@/lib/paymentProcessors/config";

export async function DELETE(request: NextRequest, { params }: { params: { processor: string } }) {
  if (!isProcessor(params.processor)) {
    return NextResponse.json({ error: "Unknown processor" }, { status: 400 });
  }

  const sp = request.nextUrl.searchParams;
  const credentialId = sp.get("credentialId");
  const walletAddress = sp.get("walletAddress");
  const signature = sp.get("signature");
  const message = sp.get("message");

  if (!credentialId || !walletAddress || !signature || !message) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const messageCheck = validateMessage(message, "delete_credential");
  if (!messageCheck.valid) {
    return NextResponse.json({ error: messageCheck.error }, { status: 400 });
  }

  const isValidSig = await verifySignature(walletAddress, signature, message);
  if (!isValidSig) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const { error } = await supabaseAdmin
    .from(CREDENTIAL_TABLE.buyer)
    .delete()
    .eq("id", credentialId)
    .eq("wallet_address", walletAddress)
    .eq("processor", params.processor);

  if (error) {
    console.error("Error deleting buyer credential:", error);
    return NextResponse.json({ error: "Failed to delete credential" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
