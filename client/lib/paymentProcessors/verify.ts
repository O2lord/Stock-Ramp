// client/lib/paymentProcessors/verify.ts
// Server-side "is this a real, working credential" check per processor.
// Logic mirrors discord-bot/services/{flutterwaveService,korapayService,
// opayServices,paystackService}.ts's own `validateCredentials` static
// methods exactly — same endpoints, same success codes — reimplemented here
// with plain fetch instead of axios so the client/ package doesn't need to
// depend on discord-bot/'s package (separate package.json, separate
// node_modules; there's no monorepo workspace linking the two). If those
// services' validation logic changes, mirror the change here too.

import crypto from "crypto";
import type { Processor, ProcessorFields } from "./config";

export interface VerifyResult {
  valid: boolean;
  balance?: number;
  currency?: string;
  error?: string;
}

// ── Flutterwave ── GET /v3/balances, Bearer secretKey ──────────────────────
async function verifyFlutterwave(fields: ProcessorFields): Promise<VerifyResult> {
  const secretKey = fields.secretKey?.trim();
  if (!secretKey?.startsWith("FLWSECK-") && !secretKey?.startsWith("FLWSECK_TEST-")) {
    return { valid: false, error: "Invalid Flutterwave secret key format" };
  }

  try {
    const res = await fetch("https://api.flutterwave.com/v3/balances", {
      headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
    });
    if (!res.ok) {
      return { valid: false, error: res.status === 401 ? "Invalid or expired credentials" : "Flutterwave API error" };
    }
    const data = await res.json();
    if (data.status === "success") {
      const first = Array.isArray(data.data) && data.data.length > 0 ? data.data[0] : null;
      return { valid: true, balance: first?.available_balance, currency: first?.currency };
    }
    return { valid: false, error: "Invalid API response" };
  } catch {
    return { valid: false, error: "Network error or Flutterwave unavailable" };
  }
}

// ── Korapay ── GET /merchant/api/v1/balances, Bearer secretKey ─────────────
// Mirrors discord-bot/services/korapayService.ts's static validateCredentials
// exactly: same base URL, same endpoint, same NGN available_balance field.
async function verifyKorapay(fields: ProcessorFields): Promise<VerifyResult> {
  const secretKey = fields.secretKey?.trim();
  if (!secretKey?.startsWith("sk_test_") && !secretKey?.startsWith("sk_live_")) {
    return { valid: false, error: "Invalid Korapay secret key format. Must start with sk_test_ or sk_live_" };
  }

  try {
    const res = await fetch("https://api.korapay.com/merchant/api/v1/balances", {
      headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
    });
    const data = await res.json();
    if (!res.ok) {
      return {
        valid: false,
        error: res.status === 401 ? "Invalid or expired Korapay secret key" : data?.message ?? "Korapay API error",
      };
    }
    if (data.status) {
      const ngnBalance = data.data?.["NGN"]?.available_balance;
      return { valid: true, balance: ngnBalance, currency: ngnBalance !== undefined ? "NGN" : undefined };
    }
    return { valid: false, error: "Invalid API response" };
  } catch {
    return { valid: false, error: "Network error or Korapay unavailable" };
  }
}

// ── Paystack ── GET /balance, Bearer secretKey ──────────────────────────────
async function verifyPaystack(fields: ProcessorFields): Promise<VerifyResult> {
  const secretKey = fields.secretKey?.trim();
  if (!secretKey?.startsWith("sk_test_") && !secretKey?.startsWith("sk_live_")) {
    return { valid: false, error: "Invalid Paystack secret key format. Must start with sk_test_ or sk_live_" };
  }

  try {
    const res = await fetch("https://api.paystack.co/balance", {
      headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
    });
    const data = await res.json();
    if (!res.ok) {
      return { valid: false, error: res.status === 401 ? "Invalid or expired Paystack secret key" : data?.message ?? "Paystack API error" };
    }
    if (data.status) {
      const ngn = (data.data ?? []).find((b: { currency: string }) => b.currency === "NGN");
      return { valid: true, balance: ngn ? ngn.balance / 100 : undefined, currency: ngn ? "NGN" : undefined };
    }
    return { valid: false, error: "Invalid API response" };
  } catch {
    return { valid: false, error: "Network error or Paystack unavailable" };
  }
}

// ── OPay ── signed POST to cashier/status with a dummy reference ───────────
// OPay has no plain balance endpoint; a 00000 (found) or 02006 (not found —
// expected, since the reference is fake) response means auth succeeded.
function sortObjectKeys(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.keys(obj)
    .sort()
    .reduce((sorted, key) => {
      const val = obj[key];
      sorted[key] =
        val !== null && typeof val === "object" && !Array.isArray(val)
          ? sortObjectKeys(val as Record<string, unknown>)
          : val;
      return sorted;
    }, {} as Record<string, unknown>);
}

function computeOpaySignature(payload: Record<string, unknown>, secretKey: string): string {
  const body = JSON.stringify(sortObjectKeys(payload));
  return crypto.createHmac("sha512", secretKey).update(body).digest("hex");
}

const OPAY_CASHIER_BASE =
  process.env.OPAY_ENV === "production"
    ? "https://cashierapi.opaycheckout.com"
    : "https://sandboxapi.opaycheckout.com";

async function verifyOpay(fields: ProcessorFields): Promise<VerifyResult> {
  const publicKey = fields.publicKey?.trim();
  const secretKey = fields.secretKey?.trim();
  const merchantId = fields.merchantId?.trim();

  if (!publicKey?.startsWith("OPAYPUB") || !secretKey?.startsWith("OPAYPRV") || !merchantId) {
    return { valid: false, error: "Invalid credential format — public key, secret key, and merchant ID are all required" };
  }

  try {
    const payload = { country: "NG", reference: `stockramp_validate_${Date.now()}` };
    const signature = computeOpaySignature(payload, secretKey);

    const res = await fetch(`${OPAY_CASHIER_BASE}/api/v1/international/cashier/status`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${signature}`,
        MerchantId: merchantId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (data.code === "00000" || data.code === "02006") {
      return { valid: true };
    }
    if (data.code === "02000") {
      return { valid: false, error: "Authentication failed — check your keys and merchant ID" };
    }
    // Any other code still means the request reached OPay authenticated.
    return { valid: true };
  } catch {
    return { valid: false, error: "Network error or OPay unavailable" };
  }
}

export async function verifyProcessorCredentials(
  processor: Processor,
  fields: ProcessorFields
): Promise<VerifyResult> {
  switch (processor) {
    case "flutterwave":
      return verifyFlutterwave(fields);
    case "korapay":
      return verifyKorapay(fields);
    case "paystack":
      return verifyPaystack(fields);
    case "opay":
      return verifyOpay(fields);
  }
}
