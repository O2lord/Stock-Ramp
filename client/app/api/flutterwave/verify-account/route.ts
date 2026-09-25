// POST /api/flutterwave/verify-account
//
// Public, unauthenticated — resolves a { account_number, account_bank } pair
// to the account holder's name via Flutterwave's /accounts/resolve, so
// InstantReserveDialog.tsx can confirm a taker's payout details are real
// before they ever get baked into an on-chain reservation.
//
// Uses the platform's own Flutterwave key, same reasoning as
// app/api/flutterwave/banks/route.ts — this is a read-only account-name
// lookup, not a transfer, so it doesn't need the maker's stored credential.
// Mirrors trust_vault's identical route.
import { NextRequest, NextResponse } from "next/server";

const PLATFORM_FLW_KEY = process.env.GRIM_FLUTTERWAVE_SECRET || process.env.flutterwave;

interface RequestBody {
  account_number?: string;
  account_bank?: string;
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as RequestBody | null;

  if (!body?.account_number || !body?.account_bank) {
    return NextResponse.json(
      { success: false, error: "account_number and account_bank are required" },
      { status: 400 }
    );
  }

  if (!PLATFORM_FLW_KEY) {
    return NextResponse.json(
      { success: false, error: "Platform Flutterwave key not configured (GRIM_FLUTTERWAVE_SECRET)" },
      { status: 500 }
    );
  }

  try {
    const res = await fetch("https://api.flutterwave.com/v3/accounts/resolve", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PLATFORM_FLW_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        account_number: body.account_number.trim(),
        account_bank: body.account_bank.trim(),
      }),
    });
    const data = await res.json();

    if (data.status === "success" && data.data?.account_name) {
      return NextResponse.json({
        success: true,
        account_name: data.data.account_name,
        is_test_mode: PLATFORM_FLW_KEY.includes("_TEST-"),
      });
    }

    return NextResponse.json({ success: false, error: data.message ?? "Could not verify account" });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Network error verifying account" },
      { status: 502 }
    );
  }
}
