// POST /api/payment-processors/{processor}/verify
// "Test connection" — validates raw (not-yet-saved) credentials against the
// real processor API. Shared by both buyer and seller managers since the
// same account keys work whichever side you're saving them for.
import { NextRequest, NextResponse } from "next/server";
import { isProcessor, validateFieldsPresent, type ProcessorFields } from "@/lib/paymentProcessors/config";
import { verifyProcessorCredentials } from "@/lib/paymentProcessors/verify";

export async function POST(request: NextRequest, { params }: { params: { processor: string } }) {
  if (!isProcessor(params.processor)) {
    return NextResponse.json({ error: "Unknown processor" }, { status: 400 });
  }

  const fields = (await request.json()) as ProcessorFields;
  const presence = validateFieldsPresent(params.processor, fields);
  if (!presence.valid) {
    return NextResponse.json({ valid: false, error: `${presence.missing} is required` }, { status: 400 });
  }

  const result = await verifyProcessorCredentials(params.processor, fields);
  return NextResponse.json(result);
}
