// POST /api/payment-processors/{processor}/seller-credentials/store
// Write — requires a wallet signature over a fresh, timestamped auth message.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/client";
import { verifySignature, validateMessage } from "@/lib/solana-auth";
import { isProcessor, CREDENTIAL_TABLE, validateFieldsPresent, type ProcessorFields } from "@/lib/paymentProcessors/config";
import { verifyProcessorCredentials } from "@/lib/paymentProcessors/verify";
import { encryptFieldsForRow, PUBLIC_COLUMNS } from "@/lib/paymentProcessors/db";

export async function POST(request: NextRequest, { params }: { params: { processor: string } }) {
  if (!isProcessor(params.processor)) {
    return NextResponse.json({ error: "Unknown processor" }, { status: 400 });
  }

  const body = await request.json();
  const { walletAddress, signature, message, label, ...rawFields } = body as {
    walletAddress: string;
    signature: string;
    message: string;
    label?: string;
  } & ProcessorFields;

  if (!walletAddress || !signature || !message) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const messageCheck = validateMessage(message, "store_credentials");
  if (!messageCheck.valid) {
    return NextResponse.json({ error: messageCheck.error }, { status: 400 });
  }

  const isValidSig = await verifySignature(walletAddress, signature, message);
  if (!isValidSig) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const fields: ProcessorFields = rawFields;
  const presence = validateFieldsPresent(params.processor, fields);
  if (!presence.valid) {
    return NextResponse.json({ error: `${presence.missing} is required` }, { status: 400 });
  }

  const verification = await verifyProcessorCredentials(params.processor, fields);
  if (!verification.valid) {
    return NextResponse.json(
      { error: verification.error ?? "Invalid credentials — could not verify against the processor's API" },
      { status: 400 }
    );
  }

  const { data, error } = await supabaseAdmin
    .from(CREDENTIAL_TABLE.seller)
    .insert({
      wallet_address: walletAddress,
      processor: params.processor,
      label: label ?? null,
      is_active: true,
      last_verified: new Date().toISOString(),
      ...encryptFieldsForRow(fields),
    })
    .select(PUBLIC_COLUMNS)
    .single();

  if (error) {
    console.error("Error storing seller credentials:", error);
    return NextResponse.json({ error: "Failed to store credentials" }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    credential: data,
    balance: verification.balance,
    currency: verification.currency,
  });
}
