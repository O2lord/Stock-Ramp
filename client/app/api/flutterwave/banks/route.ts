// GET /api/flutterwave/banks?country=NG
//
// Public, unauthenticated — called from the browser by a taker filling in
// InstantReserveDialog.tsx, before any reservation exists (there's no
// validator-key session at this point). Returns the bank list for a given
// country so the payout-details form can offer a proper bank picker instead
// of a free-text field.
//
// Uses the platform's own Flutterwave key (GRIM_FLUTTERWAVE_SECRET) rather
// than any maker's stored credential — this is a read-only lookup that
// never touches money, so it doesn't need to be tied to whichever LP the
// taker happens to be reserving against. Mirrors trust_vault's identical
// route (client/app/api/flutterwave/banks/route.ts there).
import { NextRequest, NextResponse } from "next/server";

const PLATFORM_FLW_KEY = process.env.GRIM_FLUTTERWAVE_SECRET || process.env.flutterwave;

interface FlutterwaveBank {
  id: number;
  code: string;
  name: string;
}

export async function GET(request: NextRequest) {
  const country = request.nextUrl.searchParams.get("country");

  if (!country) {
    return NextResponse.json({ error: "country is required" }, { status: 400 });
  }

  if (!PLATFORM_FLW_KEY) {
    return NextResponse.json(
      { error: "Platform Flutterwave key not configured (GRIM_FLUTTERWAVE_SECRET)" },
      { status: 500 }
    );
  }

  try {
    const res = await fetch(`https://api.flutterwave.com/v3/banks/${encodeURIComponent(country)}`, {
      headers: { Authorization: `Bearer ${PLATFORM_FLW_KEY}` },
    });
    const data = await res.json();

    if (data.status !== "success") {
      return NextResponse.json({ error: data.message ?? "Failed to fetch banks" }, { status: 502 });
    }

    const banks: FlutterwaveBank[] = (data.data ?? []).map(
      (b: { id: number; code: string; name: string }) => ({
        id: b.id,
        code: b.code,
        name: b.name,
      })
    );

    return NextResponse.json({ banks });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Network error fetching banks" },
      { status: 502 }
    );
  }
}
