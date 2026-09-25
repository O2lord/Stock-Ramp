// discord-bot/services/paystackService.ts
//
// Paystack payment processor service.
// Mirrors flutterwaveService.ts / opayServices.ts interface.
//
// Paystack auth model:
//   • ALL requests → Authorization: Bearer {secretKey}
//   • Single secret key — no public key, no merchant ID, no HMAC
//   • Nigeria only for transfers (currency: NGN)
//
// Endpoints used:
//   Base → https://api.paystack.co
//   Transfers → POST /transfer  (initiate payout)
//   Transfer status → GET /transfer/verify/:reference
//   Payment link → POST /transaction/initialize  (sell order inbound)
//   Verify payment → GET /transaction/verify/:reference
//   Banks → GET /bank?currency=NGN
//   Resolve account → GET /bank/resolve
//   Balance → GET /balance
//
// Amount unit: kobo (NGN smallest unit). 1 NGN = 100 kobo.
// This service always converts FROM human-readable NGN TO kobo internally.
// Transfer recipients must be created before initiating a transfer — this service
// handles recipient creation automatically in initiateTransfer().

import axios, { AxiosError } from 'axios';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface PaystackCredentials {
  secretKey: string; // sk_test_... or sk_live_...
}

export interface PaystackPayoutDetails {
  account_number: string;
  bank_code: string;
  account_name?: string;
  narration?: string;
}

export interface PaystackPayoutResponse {
  success: boolean;
  reference: string;
  transferCode?: string;
  status?: string;
  error?: string;
}

export interface PaystackTransferStatusResponse {
  verified: boolean;
  status?: string;       // pending | success | failed | reversed
  transferCode?: string;
  amount?: number;       // in NGN
  currency?: string;
  reference?: string;
  failureReason?: string;
  error?: string;
}

export interface PaystackPaymentLinkResponse {
  success: boolean;
  authorizationUrl?: string;
  accessCode?: string;
  reference: string;
  error?: string;
}

export interface PaystackVerifyPaymentResponse {
  verified: boolean;
  amount?: number;       // in NGN
  currency?: string;
  status?: string;       // success | failed | abandoned
  transactionId?: number;
  error?: string;
}

export interface PaystackCredentialValidationResult {
  valid: boolean;
  balance?: number;
  currency?: string;
  businessName?: string;
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Amount helpers
// ─────────────────────────────────────────────────────────────────────────────

function toKobo(ngnAmount: number): number {
  return Math.round(ngnAmount * 100);
}

function fromKobo(kobo: number): number {
  return kobo / 100;
}

// ─────────────────────────────────────────────────────────────────────────────
// Base URL
// ─────────────────────────────────────────────────────────────────────────────

const PAYSTACK_BASE = 'https://api.paystack.co';

// ─────────────────────────────────────────────────────────────────────────────
// PaystackService
// ─────────────────────────────────────────────────────────────────────────────

class PaystackService {
  private secretKey: string;

  constructor(secretKey: string) {
    if (!secretKey) {
      throw new Error('PaystackService requires a secretKey.');
    }
    if (!secretKey.startsWith('sk_test_') && !secretKey.startsWith('sk_live_')) {
      throw new Error('Invalid Paystack secret key format. Must start with sk_test_ or sk_live_');
    }
    this.secretKey = secretKey;
  }

  // ── Auth headers ────────────────────────────────────────────────────────────

  private headers() {
    return {
      Authorization: `Bearer ${this.secretKey}`,
      'Content-Type': 'application/json',
    };
  }

  // ── Validate credentials ────────────────────────────────────────────────────
  // Uses GET /balance — returns 200 with business balance if key is valid.

  static async validateCredentials(
    credentials: PaystackCredentials
  ): Promise<PaystackCredentialValidationResult> {
    try {
      if (!credentials.secretKey?.startsWith('sk_test_') && !credentials.secretKey?.startsWith('sk_live_')) {
        return { valid: false, error: 'Invalid Paystack secret key format. Must start with sk_test_ or sk_live_' };
      }

      const response = await axios.get<{
        status: boolean;
        message: string;
        data: Array<{ currency: string; balance: number }>;
      }>(`${PAYSTACK_BASE}/balance`, {
        headers: {
          Authorization: `Bearer ${credentials.secretKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 10_000,
      });

      if (response.data.status) {
        const ngn = response.data.data?.find(b => b.currency === 'NGN');
        return {
          valid: true,
          balance: ngn ? fromKobo(ngn.balance) : undefined,
          currency: ngn ? 'NGN' : undefined,
        };
      }

      return { valid: false, error: 'Invalid API response' };
    } catch (err) {
      const axiosErr = err as AxiosError<{ message?: string }>;
      if (axiosErr.response?.status === 401) {
        return { valid: false, error: 'Invalid or expired Paystack secret key' };
      }
      return { valid: false, error: axiosErr.response?.data?.message ?? 'Network error or Paystack unavailable' };
    }
  }

  // ── Create inbound payment link (sell order) ────────────────────────────────
  // POST /transaction/initialize
  // Returns an authorization_url the buyer is redirected to.

  async createPaymentLink(params: {
    amount: number;          // in NGN
    currency: string;
    reference: string;
    returnUrl: string;
    callbackUrl?: string;
    buyerEmail?: string;
    buyerName?: string;
    description?: string;
    trustExpressAddress?: string;
  }): Promise<PaystackPaymentLinkResponse> {
    try {
      const response = await axios.post<{
        status: boolean;
        message: string;
        data?: { authorization_url: string; access_code: string; reference: string };
      }>(
        `${PAYSTACK_BASE}/transaction/initialize`,
        {
          amount: toKobo(params.amount),
          currency: params.currency,
          email: params.buyerEmail ?? 'buyer@trustexpress.io',
          reference: params.reference,
          callback_url: params.returnUrl,
          metadata: {
            custom_fields: [
              { display_name: 'Trust Express', variable_name: 'trust_express_address', value: params.trustExpressAddress ?? '' },
              { display_name: 'Description', variable_name: 'description', value: params.description ?? `TrustExpress order ${params.reference}` },
            ],
          },
        },
        { headers: this.headers(), timeout: 15_000 }
      );

      if (response.data.status && response.data.data?.authorization_url) {
        return {
          success: true,
          authorizationUrl: response.data.data.authorization_url,
          accessCode: response.data.data.access_code,
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
  // GET /transaction/verify/:reference

  async verifyInboundPayment(reference: string): Promise<PaystackVerifyPaymentResponse> {
    try {
      const response = await axios.get<{
        status: boolean;
        message: string;
        data?: {
          id: number;
          status: string;
          reference: string;
          amount: number;    // in kobo
          currency: string;
        };
      }>(`${PAYSTACK_BASE}/transaction/verify/${encodeURIComponent(reference)}`, {
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
        amount: fromKobo(tx.amount),
        currency: tx.currency,
        transactionId: tx.id,
      };
    } catch (err) {
      const axiosErr = err as AxiosError;
      return { verified: false, status: 'api_error', error: axiosErr.message };
    }
  }

  // ── Create transfer recipient ────────────────────────────────────────────────
  // Paystack requires a recipient code before initiating a transfer.
  // POST /transferrecipient

  private async createTransferRecipient(
    payoutDetails: PaystackPayoutDetails,
    currency: string
  ): Promise<string> {
    const response = await axios.post<{
      status: boolean;
      message: string;
      data?: { recipient_code: string };
    }>(
      `${PAYSTACK_BASE}/transferrecipient`,
      {
        type: 'nuban',
        name: payoutDetails.account_name ?? 'TrustExpress User',
        account_number: payoutDetails.account_number,
        bank_code: payoutDetails.bank_code,
        currency,
      },
      { headers: this.headers(), timeout: 15_000 }
    );

    if (!response.data.status || !response.data.data?.recipient_code) {
      throw new Error(response.data.message ?? 'Failed to create Paystack transfer recipient');
    }

    return response.data.data.recipient_code;
  }

  // ── Initiate outbound bank transfer (buy order payout) ──────────────────────
  // POST /transfer
  // Creates recipient first, then initiates transfer.

  async initiateTransfer(
    payoutDetails: PaystackPayoutDetails,
    amount: number,     // in NGN
    currency: string,
    reference: string
  ): Promise<PaystackPayoutResponse> {
    try {
      // Step 1: Create recipient
      const recipientCode = await this.createTransferRecipient(payoutDetails, currency);

      // Step 2: Initiate transfer
      const response = await axios.post<{
        status: boolean;
        message: string;
        data?: {
          reference: string;
          transfer_code: string;
          status: string;
        };
      }>(
        `${PAYSTACK_BASE}/transfer`,
        {
          source: 'balance',
          amount: toKobo(amount),
          recipient: recipientCode,
          reason: payoutDetails.narration ?? `TrustExpress payout ${reference}`,
          reference,
          currency,
        },
        { headers: this.headers(), timeout: 15_000 }
      );

      if (response.data.status && response.data.data) {
        return {
          success: true,
          reference: response.data.data.reference ?? reference,
          transferCode: response.data.data.transfer_code,
          status: response.data.data.status,
        };
      }

      return {
        success: false,
        reference,
        error: response.data.message ?? 'Paystack transfer initiation failed',
      };
    } catch (err) {
      const axiosErr = err as AxiosError<{ message?: string }>;
      if (axiosErr.response?.status === 401) {
        return { success: false, reference, error: 'Invalid or expired Paystack credentials. Please update in settings.' };
      }
      return {
        success: false,
        reference,
        error: axiosErr.response?.data?.message ?? axiosErr.message,
      };
    }
  }

  // ── Check outbound transfer status (buy order) ──────────────────────────────
  // GET /transfer/verify/:reference

  async getTransferStatus(reference: string): Promise<PaystackTransferStatusResponse> {
    try {
      const response = await axios.get<{
        status: boolean;
        message: string;
        data?: {
          reference: string;
          transfer_code: string;
          amount: number;    // in kobo
          currency: string;
          status: string;    // pending | success | failed | reversed
          reason?: string;
        };
      }>(`${PAYSTACK_BASE}/transfer/verify/${encodeURIComponent(reference)}`, {
        headers: this.headers(),
        timeout: 10_000,
      });

      if (!response.data.status || !response.data.data) {
        return { verified: false, status: 'not_found', error: response.data.message };
      }

      const transfer = response.data.data;
      return {
        verified: transfer.status === 'success',
        status: transfer.status,
        transferCode: transfer.transfer_code,
        amount: fromKobo(transfer.amount),
        currency: transfer.currency,
        reference: transfer.reference,
      };
    } catch (err) {
      const axiosErr = err as AxiosError;
      return { verified: false, status: 'api_error', error: axiosErr.message };
    }
  }

  // ── Static factory ──────────────────────────────────────────────────────────

  static createInstance(credentials: PaystackCredentials): PaystackService {
    return new PaystackService(credentials.secretKey);
  }

  static async initiateTransfer(
    payoutDetails: PaystackPayoutDetails,
    amount: number,
    currency: string,
    reference: string,
    credentials: PaystackCredentials
  ): Promise<PaystackPayoutResponse> {
    const service = new PaystackService(credentials.secretKey);
    return service.initiateTransfer(payoutDetails, amount, currency, reference);
  }

  static async verifyPayment(
    reference: string,
    credentials: PaystackCredentials
  ): Promise<PaystackVerifyPaymentResponse> {
    const service = new PaystackService(credentials.secretKey);
    return service.verifyInboundPayment(reference);
  }
}

export default PaystackService;