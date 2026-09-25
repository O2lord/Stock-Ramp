// POST /api/bot/heartbeat
// Called unconditionally by validator-bot/val_bot.ts every 60s (and once on
// startup) as a liveness signal. Least critical of the 7 missing routes per
// Fix.md, but referenced unconditionally, so a missing route spams warnings
// on every validator's console forever. Upserts into the same `bot_status`
// table the discord bot uses (bot.ts's startStatusUpdates), keyed by a
// prefix of the calling validator's API key so each of the 5 validators
// gets its own row instead of clobbering one shared row.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/client";
import { checkValidatorAuth } from "@/lib/validatorAuth";

export async function POST(request: NextRequest) {
  const authError = await checkValidatorAuth(request);
  if (authError) return authError;

  const key = request.headers.get("x-validator-key") ?? "unknown";
  const botId = `validator-${key.slice(-8)}`;

  const { error } = await supabaseAdmin.from("bot_status").upsert({
    bot_id: botId,
    last_seen: new Date().toISOString(),
    is_active: true,
  });

  if (error) {
    console.error("heartbeat upsert failed:", error);
    return NextResponse.json({ ok: false, error: "Failed to record heartbeat" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
