// discord-bot/services/korapayService.ts
//
// Korapay payment processor service.
// Mirrors paystackService.ts interface — same return shapes,
// same static factory pattern, same error handling.
//
// Korapay auth: Bearer {secretKey} on ALL requests. No HMAC, no RSA.
// Amount unit: plain NGN (NOT kobo). 1 NGN = 1 NGN.
// Minimum payout: ₦1,000 NGN.
//
// Endpoints:
//   Base       → https://api.korapay.com/merchant
//   Banks      → GET  /api/v1/misc/banks?countryCode=NG
//   Resolve    → POST /api/v1/misc/banks/resolve
//   Payout     → POST /api/v1/transactions/disburse
//   Pay status → GET  /api/v1/transactions/disburse/verify/:reference
//   Balance    → GET  /api/v1/balances

import axios, { AxiosError } from 'axios';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface KorapayCredentials {
  secretKey: string; // sk_test_... or sk_live_...
}

export interface KorapayPayoutDetails {
  account_number: string;
  bank_code: string;
  account_name?: string;
  narration?: string;
  email?: string;
}

export interface KorapayPayoutResponse {
  success: boolean;
  reference: string;
  status?: string;
  amount?: number;
  fee?: number;
  error?: string;
}

export interface KorapayTransferStatusResponse {
  verified: boolean;
  status?: string;       // processing | success | failed
  amount?: number;       // in NGN
  currency?: string;
  reference?: string;
  failureReason?: string;
  error?: string;
}

export interface KorapayPaymentLinkResponse {
  success: boolean;
  checkoutUrl?: string;
  reference: string;
  error?: string;
}

export interface KorapayVerifyPaymentResponse {
  verified: boolean;
  amount?: number;
  currency?: string;
  status?: string;
  transactionId?: string;
  error?: string;
}

export interface KorapayCredentialValidationResult {
  valid: boolean;
  balance?: number;
  currency?: string;
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// KorapayService
// ─────────────────────────────────────────────────────────────────────────────

const KORA_BASE = 'https://api.korapay.com/merchant';

class KorapayService {
  private secretKey: string;

  constructor(secretKey: string) {
    if (!secretKey) throw new Error('KorapayService requires a secretKey.');
    if (!secretKey.startsWith('sk_test_') && !secretKey.startsWith('sk_live_')) {
      throw new Error('Invalid Korapay secret key format. Must start with sk_test_ or sk_live_');
    }
    this.secretKey = secretKey;
  }

  private headers() {
    return {
      Authorization: `Bearer ${this.secretKey}`,
      'Content-Type': 'application/json',
    };
  }

  // ── Validate credentials ────────────────────────────────────────────────────

static async validateCredentials(
  credentials: KorapayCredentials
): Promise<KorapayCredentialValidationResult> {
  try {
    if (
      !credentials.secretKey?.startsWith('sk_test_') &&
      !credentials.secretKey?.startsWith('sk_live_')
    ) {
      return { valid: false, error: 'Invalid Korapay secret key format. Must start with sk_test_ or sk_live_' };
    }

    const response = await axios.get<{
      status: boolean;
      message: string;
      data?: Record<string, { pending_balance: number; available_balance: number }>;
    }>(`${KORA_BASE}/api/v1/balances`, {
      headers: {
        Authorization: `Bearer ${credentials.secretKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 10_000,
    });

    if (response.data.status) {
      const ngnBalance = response.data.data?.['NGN']?.available_balance;
      return {
        valid: true,
        balance: ngnBalance,
        currency: ngnBalance !== undefined ? 'NGN' : undefined,
      };
    }

    return { valid: false, error: 'Invalid API response' };
  } catch (err) {
    const axiosErr = err as AxiosError<{ message?: string }>;
    if (axiosErr.response?.status === 401) {
      return { valid: false, error: 'Invalid or expired Korapay secret key' };
    }
    return {
      valid: false,
      error: axiosErr.response?.data?.message ?? 'Network error or Korapay unavailable',
    };
  }
}

  // ── Initiate outbound bank transfer (buy order payout) ──────────────────────

  async initiateTransfer(
    payoutDetails: KorapayPayoutDetails,
    amount: number,    // plain NGN — NOT kobo
    currency: string,
    reference: string
  ): Promise<KorapayPayoutResponse> {
    try {
      const response = await axios.post<{
        status: boolean;
        message: string;
        data?: {
          amount: string;
          fee: string;
          currency: string;
          status: string;
          reference: string;
          message: string;
        };
      }>(
        `${KORA_BASE}/api/v1/transactions/disburse`,
        {
          reference,
          destination: {
            type: 'bank_account',
            amount,
            currency,
            narration: payoutDetails.narration ?? `TrustExpress payout ${reference}`,
            bank_account: {
              bank:    payoutDetails.bank_code,
              account: payoutDetails.account_number,
            },
            customer: {
              name:  payoutDetails.account_name ?? 'TrustExpress User',
              email: payoutDetails.email ?? 'payout@trustexpress.io',
            },
          },
        },
        { headers: this.headers(), timeout: 15_000 }
      );

      if (response.data.status && response.data.data) {
        return {
          success: true,
          reference: response.data.data.reference ?? reference,
          status: response.data.data.status,
          amount: parseFloat(response.data.data.amount),
          fee: parseFloat(response.data.data.fee),
        };
      }

      return {
        success: false,
        reference,
        error: response.data.message ?? 'Korapay transfer failed',
      };
    } catch (err) {
      const axiosErr = err as AxiosError<{ message?: string }>;
      if (axiosErr.response?.status === 401) {
        return { success: false, reference, error: 'Invalid or expired Korapay credentials.' };
      }
      return {
        success: false,
        reference,
        error: axiosErr.response?.data?.message ?? axiosErr.message,
      };
    }
  }

  // ── Check outbound transfer status ──────────────────────────────────────────

  async getTransferStatus(reference: string): Promise<KorapayTransferStatusResponse> {
    try {
      const response = await axios.get<{
        status: boolean;
        message: string;
        data?: {
          reference: string;
          amount: number;
          currency: string;
          status: string;
          narration?: string;
          failure_reason?: string;
        };
      }>(`${KORA_BASE}/api/v1/transactions/disburse/verify/${encodeURIComponent(reference)}`, {
        headers: this.headers(),
        timeout: 10_000,
      });

      if (!response.data.status || !response.data.data) {
        return { verified: false, status: 'not_found', error: response.data.message };
      }

      const tx = response.data.data;
      return {
        verified: tx.status === 'success',
        status: tx.status,
        amount: tx.amount,
        currency: tx.currency,
        reference: tx.reference,
        failureReason: tx.failure_reason,
      };
    } catch (err) {
      const axiosErr = err as AxiosError;
      return { verified: false, status: 'api_error', error: axiosErr.message };
    }
  }

  // ── Create inbound payment link (sell order) ────────────────────────────────

  async createPaymentLink(params: {
    amount: number;
    currency: string;
    reference: string;
    redirectUrl: string;
    buyerEmail?: string;
    buyerName?: string;
    description?: string;
  }): Promise<KorapayPaymentLinkResponse> {
    try {
      const response = await axios.post<{
        status: boolean;
        message: string;
        data?: { checkout_url: string; reference: string };
      }>(
        `${KORA_BASE}/api/v1/charges/initialize`,
        {
          amount: params.amount,
          currency: params.currency,
          reference: params.reference,
          redirect_url: params.redirectUrl,
          customer: {
            email: params.buyerEmail ?? 'buyer@trustexpress.io',
            name:  params.buyerName ?? 'TrustExpress User',
          },
          narration: params.description ?? `TrustExpress order ${params.reference}`,
        },
        { headers: this.headers(), timeout: 15_000 }
      );

      if (response.data.status && response.data.data?.checkout_url) {
        return {
          success: true,
          checkoutUrl: response.data.data.checkout_url,
          reference: params.reference,
        };
      }

      return { success: false, reference: params.reference, error: response.data.message };
    } catch (err) {
      const axiosErr = err as AxiosError<{ message?: string }>;
      return {
        success: false,
        reference: params.reference,
        error: axiosErr.response?.data?.message ?? axiosErr.message,
      };
    }
  }

  // ── Verify inbound payment (sell order) ─────────────────────────────────────

  async verifyInboundPayment(reference: string): Promise<KorapayVerifyPaymentResponse> {
    try {
      const response = await axios.get<{
        status: boolean;
        message: string;
        data?: {
          reference: string;
          status: string;
          amount: number;
          currency: string;
          transaction_reference?: string;
        };
      }>(`${KORA_BASE}/api/v1/charges/${encodeURIComponent(reference)}`, {
        headers: this.headers(),
        timeout: 10_000,
      });

      if (!response.data.status || !response.data.data) {
        return { verified: false, error: response.data.message };
      }

      const tx = response.data.data;
      return {
        verified: tx.status === 'success',
        status: tx.status,
        amount: tx.amount,
        currency: tx.currency,
        transactionId: tx.transaction_reference,
      };
    } catch (err) {
      const axiosErr = err as AxiosError;
      return { verified: false, status: 'api_error', error: axiosErr.message };
    }
  }

  // ── Static factory ──────────────────────────────────────────────────────────

  static createInstance(credentials: KorapayCredentials): KorapayService {
    return new KorapayService(credentials.secretKey);
  }

  static async initiateTransfer(
    payoutDetails: KorapayPayoutDetails,
    amount: number,
    currency: string,
    reference: string,
    credentials: KorapayCredentials
  ): Promise<KorapayPayoutResponse> {
    const service = new KorapayService(credentials.secretKey);
    return service.initiateTransfer(payoutDetails, amount, currency, reference);
  }

  static async verifyPayment(
    reference: string,
    credentials: KorapayCredentials
  ): Promise<KorapayVerifyPaymentResponse> {
    const service = new KorapayService(credentials.secretKey);
    return service.verifyInboundPayment(reference);
  }
}

export default KorapayService;