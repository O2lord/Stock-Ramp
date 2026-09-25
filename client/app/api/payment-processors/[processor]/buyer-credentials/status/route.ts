// GET /api/payment-processors/{processor}/buyer-credentials/status
//   ?credentialId=...&walletAddress=...
// Read — re-verifies a saved credential live against the processor's API and
// refreshes is_active/last_verified. No signature required (matches
// trust_vault's own reference implementation): the credentialId is an
// unguessable random uuid, so it functions like a bearer token here — this
// endpoint reveals liveness/balance, never the decrypted secret itself.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/client";
import { isProcessor, CREDENTIAL_TABLE } from "@/lib/paymentProcessors/config";
import { decryptRowFields, type CredentialRow } from "@/lib/paymentProcessors/db";
import { verifyProcessorCredentials } from "@/lib/paymentProcessors/verify";

export async function GET(request: NextRequest, { params }: { params: { processor: string } }) {
  if (!isProcessor(params.processor)) {
    return NextResponse.json({ error: "Unknown processor" }, { status: 400 });
  }

  const sp = request.nextUrl.searchParams;
  const credentialId = sp.get("credentialId");
  const walletAddress = sp.get("walletAddress");
  if (!credentialId || !walletAddress) {
    return NextResponse.json({ error: "credentialId and walletAddress are required" }, { status: 400 });
  }

  const { data: row, error } = await supabaseAdmin
    .from(CREDENTIAL_TABLE.buyer)
    .select("*")
    .eq("id", credentialId)
    .eq("wallet_address", walletAddress)
    .eq("processor", params.processor)
    .single<CredentialRow>();

  if (error || !row) {
    return NextResponse.json({ error: "Credential not found" }, { status: 404 });
  }

  const fields = decryptRowFields(row);
  const result = await verifyProcessorCredentials(params.processor, fields);

  await supabaseAdmin
    .from(CREDENTIAL_TABLE.buyer)
    .update({ is_active: result.valid, last_verified: new Date().toISOString() })
    .eq("id", credentialId);

  return NextResponse.json(result);
}
