// client/lib/paymentProcessors/payout.ts
// Server-side outbound-transfer + inbound-payment-verification helpers,
// one function per operation, dispatched across all 4 processors.
//
// Mirrors the corresponding methods on discord-bot/services/
// {flutterwaveService,korapayService,paystackService,opayServices}.ts
// (same endpoints, same request/response shapes) — reimplemented here with
// plain fetch instead of axios, same reasoning as verify.ts: client/ is a
// separate package from discord-bot/ with no workspace linking, so the two
// can't share code directly. If those services' logic changes, mirror the
// change here too.
//
// Used by the platform API routes the validator bots depend on:
// /api/initiate-buy-payout, /api/bot/payout-status, /api/verify-transfer
// (buy-side, outbound), and /api/verify-payment (sell-side, inbound).

import type { Processor, ProcessorFields } from "./config";

export interface PayoutBankDetails {
  account_number: string;
  bank_code?: string;
  account_bank?: string;
  account_name?: string;
  beneficiary_name?: string;
  narration?: string;
}

export interface InitiatePayoutResult {
  success: boolean;
  /** Processor-specific handle used later to poll status (transfer id / reference / transfer_code / orderNo). */
  transferReference?: string;
  error?: string;
}

export interface PayoutStatusResult {
  verified: boolean;
  status?: string;
  amount?: number;
  currency?: string;
  error?: string;
}

export interface InboundVerifyResult {
  verified: boolean;
  status?: string;
  amount?: number;
  currency?: string;
  error?: string;
}

function toKobo(amount: number): number {
  return Math.round(amount * 100);
}
function fromKobo(kobo: number): number {
  return kobo / 100;
}

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

async function computeOpaySignature(payload: Record<string, unknown>, secretKey: string): Promise<string> {
  const crypto = await import("crypto");
  const body = JSON.stringify(sortObjectKeys(payload));
  return crypto.createHmac("sha512", secretKey).update(body).digest("hex");
}

const OPAY_CASHIER_BASE =
  process.env.OPAY_ENV === "production"
    ? "https://cashierapi.opaycheckout.com"
    : "https://sandboxapi.opaycheckout.com";
const OPAY_TRANSFER_BASE =
  process.env.OPAY_ENV === "production"
    ? "https://cashierapi.opayweb.com"
    : "https://sandboxapi.opaycheckout.com";

async function opaySignedPost(baseUrl: string, path: string, payload: Record<string, unknown>, fields: ProcessorFields) {
  const signature = await computeOpaySignature(payload, fields.secretKey!);
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${signature}`,
      MerchantId: fields.merchantId!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  return res.json();
}

// ─────────────────────────────────────────────────────────────────────────
// Initiate outbound transfer (buy-order payout: platform → taker's bank)
// ─────────────────────────────────────────────────────────────────────────

export async function initiateProcessorPayout(
  processor: Processor,
  fields: ProcessorFields,
  payoutDetails: PayoutBankDetails,
  amount: number,
  currency: string,
  reference: string
): Promise<InitiatePayoutResult> {
  const bankCode = payoutDetails.bank_code ?? payoutDetails.account_bank;
  const beneficiaryName = payoutDetails.beneficiary_name ?? payoutDetails.account_name;

  try {
    if (processor === "flutterwave") {
      const res = await fetch("https://api.flutterwave.com/v3/transfers", {
        method: "POST",
        headers: { Authorization: `Bearer ${fields.secretKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          account_bank: bankCode,
          account_number: payoutDetails.account_number,
          amount,
          narration: payoutDetails.narration ?? `Stock Ramp payout ${reference}`,
          currency,
          reference,
          debit_currency: currency,
          beneficiary_name: beneficiaryName,
        }),
      });
      const data = await res.json();
      if (data.status === "success" && data.data?.id) {
        return { success: true, transferReference: String(data.data.id) };
      }
      return { success: false, error: data.message ?? "Flutterwave transfer failed" };
    }

    if (processor === "korapay") {
      const res = await fetch("https://api.korapay.com/merchant/api/v1/transactions/disburse", {
        method: "POST",
        headers: { Authorization: `Bearer ${fields.secretKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          reference,
          destination: {
            type: "bank_account",
            amount,
            currency,
            narration: payoutDetails.narration ?? `Stock Ramp payout ${reference}`,
            bank_account: { bank: bankCode, account: payoutDetails.account_number },
            customer: { name: beneficiaryName ?? "Stock Ramp User", email: "payout@stockramp.io" },
          },
        }),
      });
      const data = await res.json();
      if (data.status && data.data) {
        return { success: true, transferReference: data.data.reference ?? reference };
      }
      return { success: false, error: data.message ?? "Korapay transfer failed" };
    }

    if (processor === "paystack") {
      const recipientRes = await fetch("https://api.paystack.co/transferrecipient", {
        method: "POST",
        headers: { Authorization: `Bearer ${fields.secretKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "nuban",
          name: beneficiaryName ?? "Stock Ramp User",
          account_number: payoutDetails.account_number,
          bank_code: bankCode,
          currency,
        }),
      });
      const recipientData = await recipientRes.json();
      if (!recipientData.status || !recipientData.data?.recipient_code) {
        return { success: false, error: recipientData.message ?? "Failed to create Paystack transfer recipient" };
      }

      const res = await fetch("https://api.paystack.co/transfer", {
        method: "POST",
        headers: { Authorization: `Bearer ${fields.secretKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "balance",
          amount: toKobo(amount),
          recipient: recipientData.data.recipient_code,
          reason: payoutDetails.narration ?? `Stock Ramp payout ${reference}`,
          reference,
          currency,
        }),
      });
      const data = await res.json();
      if (data.status && data.data) {
        return { success: true, transferReference: data.data.reference ?? reference };
      }
      return { success: false, error: data.message ?? "Paystack transfer initiation failed" };
    }

    if (processor === "opay") {
      const payload: Record<string, unknown> = {
        country: "NG",
        amount: String(toKobo(amount)),
        currency,
        reference,
        reason: payoutDetails.narration ?? `Stock Ramp payout ${reference}`,
        receiver: {
          bankAccountNumber: payoutDetails.account_number,
          bankCode,
          name: beneficiaryName ?? "",
        },
      };
      const data = await opaySignedPost(OPAY_TRANSFER_BASE, "/api/v3/transfer/toBank", payload, fields);
      if (data.code === "00000" && data.data) {
        return { success: true, transferReference: data.data.reference ?? reference };
      }
      return { success: false, error: data.message ?? "OPay transfer initiation failed" };
    }

    return { success: false, error: `Unsupported processor: ${processor}` };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Network error during payout initiation" };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Check outbound transfer status (buy-order payout)
// ─────────────────────────────────────────────────────────────────────────

export async function checkProcessorPayoutStatus(
  processor: Processor,
  fields: ProcessorFields,
  transferReference: string
): Promise<PayoutStatusResult> {
  try {
    if (processor === "flutterwave") {
      const res = await fetch(`https://api.flutterwave.com/v3/transfers/${transferReference}`, {
        headers: { Authorization: `Bearer ${fields.secretKey}` },
      });
      const data = await res.json();
      const status: string | undefined = data?.data?.status;
      if (!status) return { verified: false, status: "not_found", error: data?.message };
      const upper = status.toUpperCase();
      if (upper === "FAILED") return { verified: false, status };
      // PENDING counts as verified: Flutterwave test-mode transfers debit the
      // merchant balance immediately but the status field often never
      // transitions past PENDING (there's no real bank rail to trigger the
      // move to SUCCESSFUL, and sandbox webhooks aren't reliable either).
      // Mirrors trust_vault v3's checkFlutterwaveTransferStatus, which hit
      // this exact issue: `transferData.status === 'SUCCESSFUL' || transferData.status === 'PENDING'`.
      return {
        verified: upper === "SUCCESSFUL" || upper === "PENDING",
        status,
        amount: data.data.amount,
        currency: data.data.currency,
      };
    }

    if (processor === "korapay") {
      const res = await fetch(
        `https://api.korapay.com/merchant/api/v1/transactions/disburse/verify/${encodeURIComponent(transferReference)}`,
        { headers: { Authorization: `Bearer ${fields.secretKey}` } }
      );
      const data = await res.json();
      if (!data.status || !data.data) return { verified: false, status: "not_found", error: data.message };
      return {
        verified: data.data.status === "success",
        status: data.data.status,
        amount: parseFloat(data.data.amount),
        currency: data.data.currency,
      };
    }

    if (processor === "paystack") {
      const res = await fetch(`https://api.paystack.co/transfer/verify/${encodeURIComponent(transferReference)}`, {
        headers: { Authorization: `Bearer ${fields.secretKey}` },
      });
      const data = await res.json();
      if (!data.status || !data.data) return { verified: false, status: "not_found", error: data.message };
      const status: string = data.data.status;
      if (status === "failed" || status === "reversed") return { verified: false, status };
      return { verified: status === "success", status, amount: fromKobo(data.data.amount), currency: data.data.currency };
    }

    if (processor === "opay") {
      const data = await opaySignedPost(
        OPAY_TRANSFER_BASE,
        "/api/v3/transfer/status/toBank",
        { country: "NG", reference: transferReference },
        fields
      );
      if (data.code !== "00000" || !data.data) return { verified: false, status: "not_found", error: data.message };
      const status: string = data.data.status;
      if (status === "FAIL") return { verified: false, status };
      return { verified: status === "SUCCESS", status, amount: fromKobo(Number(data.data.amount)), currency: data.data.currency };
    }

    return { verified: false, error: `Unsupported processor: ${processor}` };
  } catch (err) {
    return { verified: false, status: "api_error", error: err instanceof Error ? err.message : "Network error" };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Verify inbound payment (sell-order: buyer's payment into the seller's
// payment link / direct transfer)
// ─────────────────────────────────────────────────────────────────────────

export async function verifyProcessorInboundPayment(
  processor: Processor,
  fields: ProcessorFields,
  reference: string
): Promise<InboundVerifyResult> {
  try {
    if (processor === "flutterwave") {
      const res = await fetch(
        `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`,
        { headers: { Authorization: `Bearer ${fields.secretKey}` } }
      );
      const data = await res.json();
      if (data.status === "success" && data.data?.status === "successful") {
        return { verified: true, status: data.data.status, amount: data.data.amount, currency: data.data.currency };
      }
      return { verified: false, status: data?.data?.status };
    }

    if (processor === "korapay") {
      const res = await fetch(`https://api.korapay.com/merchant/api/v1/charges/${encodeURIComponent(reference)}`, {
        headers: { Authorization: `Bearer ${fields.secretKey}` },
      });
      const data = await res.json();
      if (!data.status || !data.data) return { verified: false, error: data.message };
      return { verified: data.data.status === "success", status: data.data.status, amount: data.data.amount, currency: data.data.currency };
    }

    if (processor === "paystack") {
      const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
        headers: { Authorization: `Bearer ${fields.secretKey}` },
      });
      const data = await res.json();
      if (!data.status || !data.data) return { verified: false, error: data.message };
      return { verified: data.data.status === "success", status: data.data.status, amount: fromKobo(data.data.amount), currency: data.data.currency };
    }

    if (processor === "opay") {
      const data = await opaySignedPost(OPAY_CASHIER_BASE, "/api/v1/international/cashier/status", { country: "NG", reference }, fields);
      if (data.code !== "00000" || !data.data) return { verified: false, status: "not_found", error: data.message };
      return {
        verified: data.data.status === "SUCCESS",
        status: data.data.status,
        amount: fromKobo(data.data.amount.total),
        currency: data.data.amount.currency,
      };
    }

    return { verified: false, error: `Unsupported processor: ${processor}` };
  } catch (err) {
    return { verified: false, status: "api_error", error: err instanceof Error ? err.message : "Network error" };
  }
}
