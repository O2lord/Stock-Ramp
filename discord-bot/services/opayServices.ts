// discord-bot/services/opayService.ts  (also imported by Next.js API routes)
//
// OPay payment processor service.
// Mirrors the FlutterwaveService interface so the rest of the codebase
// can swap processors with minimal changes.
//
// OPay auth model:
//   • Cashier create (inbound payment link) → Authorization: Bearer {publicKey}
//   • Everything else → Authorization: Bearer {HMAC-SHA512(sortedPayload, secretKey)}
//   • ALL requests require MerchantId header
//
// Endpoints used:
//   Inbound  → https://cashierapi.opaycheckout.com  (cashier create / status)
//   Outbound → https://cashierapi.opayweb.com       (transfer toBank / status)
//
// Amount unit: kobo (NGN smallest unit). 1 NGN = 100 kobo.
// This service always converts FROM human-readable NGN TO kobo internally.

import axios, { AxiosError } from 'axios';
import crypto from 'crypto';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface OpayCredentials {
  publicKey: string;   // OPAYPUB...
  secretKey: string;   // OPAYPRV...
  merchantId: string;  // e.g. "256619092316009"
}

export interface OpayPayoutDetails {
  account_number: string;
  bank_code: string;
  account_name?: string;
  narration?: string;
}

export interface OpayPayoutResponse {
  success: boolean;
  reference: string;
  orderNo?: string;
  status?: string;
  error?: string;
}

export interface OpayTransferStatusResponse {
  verified: boolean;
  status?: string;       // INITIAL | PENDING | SUCCESS | FAIL
  orderNo?: string;
  amount?: number;       // in NGN (converted from kobo)
  currency?: string;
  reference?: string;
  failureReason?: string;
  error?: string;
}

export interface OpayPaymentLinkResponse {
  success: boolean;
  cashierUrl?: string;
  orderNo?: string;
  reference: string;
  error?: string;
}

export interface OpayVerifyPaymentResponse {
  verified: boolean;
  amount?: number;       // in NGN
  currency?: string;
  status?: string;       // INITIAL | PENDING | SUCCESS | FAIL | CLOSE
  orderNo?: string;
  error?: string;
}

export interface OpayCredentialValidationResult {
  valid: boolean;
  balance?: number;
  currency?: string;
  merchantName?: string;
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Signature helper
//
// OPay requires payload keys sorted alphabetically before signing.
// The signature is: HMAC-SHA512(JSON.stringify(sortedPayload), secretKey)
// ─────────────────────────────────────────────────────────────────────────────

function sortObjectKeys(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.keys(obj)
    .sort()
    .reduce((sorted, key) => {
      const val = obj[key];
      sorted[key] =
        val !== null && typeof val === 'object' && !Array.isArray(val)
          ? sortObjectKeys(val as Record<string, unknown>)
          : val;
      return sorted;
    }, {} as Record<string, unknown>);
}

export function computeOpaySignature(
  payload: Record<string, unknown>,
  secretKey: string
): string {
  const sorted = sortObjectKeys(payload);
  const body = JSON.stringify(sorted);
  return crypto.createHmac('sha512', secretKey).update(body).digest('hex');
}

// ─────────────────────────────────────────────────────────────────────────────
// Amount helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Convert NGN → kobo (OPay's smallest unit for NGN) */
function toKobo(ngnAmount: number): number {
  return Math.round(ngnAmount * 100);
}

/** Convert kobo → NGN */
function fromKobo(kobo: number): number {
  return kobo / 100;
}

// ─────────────────────────────────────────────────────────────────────────────
// Endpoints
// ─────────────────────────────────────────────────────────────────────────────

const OPAY_CASHIER_BASE =
  process.env.OPAY_ENV === 'production'
    ? 'https://cashierapi.opaycheckout.com'
    : 'https://sandboxapi.opaycheckout.com';

const OPAY_TRANSFER_BASE =
  process.env.OPAY_ENV === 'production'
    ? 'https://cashierapi.opayweb.com'
    : 'https://sandboxapi.opaycheckout.com'; // no separate sandbox transfer domain — same host as cashier

// ─────────────────────────────────────────────────────────────────────────────
// OpayService
// ─────────────────────────────────────────────────────────────────────────────

class OpayService {
  private credentials: OpayCredentials;

  constructor(credentials: OpayCredentials) {
    if (!credentials.publicKey || !credentials.secretKey || !credentials.merchantId) {
      throw new Error(
        'OpayService requires publicKey, secretKey, and merchantId. All three are mandatory.'
      );
    }
    if (!credentials.publicKey.startsWith('OPAYPUB')) {
      throw new Error('Invalid OPay public key format. Must start with OPAYPUB');
    }
    if (!credentials.secretKey.startsWith('OPAYPRV')) {
      throw new Error('Invalid OPay secret key format. Must start with OPAYPRV');
    }
    this.credentials = credentials;
  }

  // ── Shared signed-request helper ───────────────────────────────────────────

  private async signedPost<T>(
    baseUrl: string,
    path: string,
    payload: Record<string, unknown>
  ): Promise<T> {
    const signature = computeOpaySignature(payload, this.credentials.secretKey);
    const response = await axios.post<T>(`${baseUrl}${path}`, payload, {
      headers: {
        'Authorization': `Bearer ${signature}`,
        'MerchantId': this.credentials.merchantId,
        'Content-Type': 'application/json',
      },
      timeout: 15_000,
    });
    return response.data;
  }

  // ── Validate credentials ────────────────────────────────────────────────────
  // OPay doesn't have a /balances endpoint like Flutterwave, so we do a
  // minimal cashier status call with a dummy reference to confirm auth works.
  // A 02006 (not found) response means auth passed — credentials are valid.

  static async validateCredentials(
    credentials: OpayCredentials
  ): Promise<OpayCredentialValidationResult> {
    try {
      if (
        !credentials.publicKey?.startsWith('OPAYPUB') ||
        !credentials.secretKey?.startsWith('OPAYPRV') ||
        !credentials.merchantId
      ) {
        return { valid: false, error: 'Invalid credential format' };
      }

      const service = new OpayService(credentials);
      const payload = {
        country: 'NG',
        reference: `tv_validate_${Date.now()}`,
      };

      const data = await service.signedPost<{ code: string; message: string }>(
        OPAY_CASHIER_BASE,
        '/api/v1/international/cashier/status',
        payload
      );

      // 00000 = found (unlikely with dummy ref), 02006 = not found — both mean auth is OK
      if (data.code === '00000' || data.code === '02006') {
        return { valid: true };
      }

      // 02000 = authentication failed
      if (data.code === '02000') {
        return { valid: false, error: 'Authentication failed — check your keys and merchant ID' };
      }

      // Any other code still means the request reached OPay authenticated
      return { valid: true };
    } catch (err) {
      const axiosErr = err as AxiosError;
      if (axiosErr.response?.status === 401) {
        return { valid: false, error: 'Invalid credentials' };
      }
      return { valid: false, error: 'Network error or OPay unavailable' };
    }
  }

  // ── Create inbound payment link (sell order) ────────────────────────────────
  //
  // OPay cashier create uses PublicKey auth (not HMAC signature).
  // Returns a cashierUrl the buyer redirects to.

  async createPaymentLink(params: {
    amount: number;          // in NGN
    currency: string;
    reference: string;       // unique tx reference
    returnUrl: string;
    callbackUrl: string;
    buyerName?: string;
    buyerEmail?: string;
    buyerPhone?: string;
    description?: string;
    trustExpressAddress?: string;
  }): Promise<OpayPaymentLinkResponse> {
    const payload = {
      country: 'NG',
      reference: params.reference,
      amount: {
        total: toKobo(params.amount),
        currency: params.currency,
      },
      returnUrl: params.returnUrl,
      callbackUrl: params.callbackUrl,
      expireAt: 30, // minutes
      userInfo: {
        userName: params.buyerName ?? 'TrustExpress User',
        userEmail: params.buyerEmail ?? 'user@trustexpress.io',
        userMobile: params.buyerPhone ?? '',
        userId: params.trustExpressAddress ?? params.reference,
      },
      product: {
        name: 'Crypto Purchase',
        description: params.description ?? `TrustExpress order ${params.reference}`,
      },
    };

    try {
      const response = await axios.post<{
        code: string;
        message: string;
        data?: { cashierUrl: string; orderNo: string; reference: string };
      }>(
        `${OPAY_CASHIER_BASE}/api/v1/international/cashier/create`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${this.credentials.publicKey}`,
            MerchantId: this.credentials.merchantId,
            'Content-Type': 'application/json',
          },
          timeout: 15_000,
        }
      );

      if (response.data.code === '00000' && response.data.data?.cashierUrl) {
        return {
          success: true,
          cashierUrl: response.data.data.cashierUrl,
          orderNo: response.data.data.orderNo,
          reference: params.reference,
        };
      }

      return {
        success: false,
        reference: params.reference,
        error: response.data.message ?? 'Failed to create OPay cashier payment',
      };
    } catch (err) {
      const axiosErr = err as AxiosError<{ message?: string }>;
      return {
        success: false,
        reference: params.reference,
        error: axiosErr.response?.data?.message ?? axiosErr.message,
      };
    }
  }

  // ── Verify inbound payment (sell order) ────────────────────────────────────
  //
  // Polls /cashier/status with the tx reference.
  // OPay statuses: INITIAL | PENDING | SUCCESS | FAIL | CLOSE

  async verifyInboundPayment(
    reference: string
  ): Promise<OpayVerifyPaymentResponse> {
    const payload = { country: 'NG', reference };

    try {
      const data = await this.signedPost<{
        code: string;
        message: string;
        data?: {
          reference: string;
          orderNo: string;
          status: string;
          amount: { total: number; currency: string };
          failureCode?: string;
          failureReason?: string;
        };
      }>(OPAY_CASHIER_BASE, '/api/v1/international/cashier/status', payload);

      if (data.code !== '00000' || !data.data) {
        return {
          verified: false,
          status: 'not_found',
          error: data.message,
        };
      }

      const txData = data.data;
      const isSuccess = txData.status === 'SUCCESS';

      return {
        verified: isSuccess,
        status: txData.status,
        amount: fromKobo(txData.amount.total),
        currency: txData.amount.currency,
        orderNo: txData.orderNo,
      };
    } catch (err) {
      const axiosErr = err as AxiosError;
      return {
        verified: false,
        status: 'api_error',
        error: axiosErr.message,
      };
    }
  }

  // ── Initiate outbound bank transfer (buy order) ─────────────────────────────
  //
  // Sends fiat FROM LP's OPay account TO taker's bank account.
  // Endpoint: POST /api/v3/transfer/toBank (cashierapi.opayweb.com)

  async initiateTransfer(
    payoutDetails: OpayPayoutDetails,
    amount: number,     // in NGN
    currency: string,
    reference: string
  ): Promise<OpayPayoutResponse> {
    // ✅ FIX: OPay /api/v3/transfer/toBank requires bank details nested inside
    // a `receiver` object. Sending bankCode/bankAccountNumber at the top level
    // causes "receiver can not be null" error from the OPay API.
    const payload: Record<string, unknown> = {
      country: 'NG',
      amount: String(toKobo(amount)),
      currency,
      reference,
      reason: payoutDetails.narration ?? `TrustExpress payout ${reference}`,
      receiver: {
        bankAccountNumber: payoutDetails.account_number,
        bankCode: payoutDetails.bank_code,
        name: payoutDetails.account_name ?? '',
      },
    };

    try {
      const data = await this.signedPost<{
        code: string;
        message: string;
        data?: {
          reference: string;
          orderNo: string;
          status: string;
        };
      }>(OPAY_TRANSFER_BASE, '/api/v3/transfer/toBank', payload);

      if (data.code === '00000' && data.data) {
        return {
          success: true,
          reference: data.data.reference ?? reference,
          orderNo: data.data.orderNo,
          status: data.data.status,
        };
      }

      return {
        success: false,
        reference,
        error: data.message ?? 'OPay transfer initiation failed',
      };
    } catch (err) {
      const axiosErr = err as AxiosError<{ message?: string; code?: string }>;

      // Handle expired/invalid credentials
      if (axiosErr.response?.status === 401) {
        return {
          success: false,
          reference,
          error: 'Invalid or expired OPay credentials. Please update in settings.',
        };
      }

      return {
        success: false,
        reference,
        error: axiosErr.response?.data?.message ?? axiosErr.message,
      };
    }
  }

  // ── Check outbound transfer status (buy order) ──────────────────────────────
  //
  // Endpoint: POST /api/v3/transfer/status/toBank
  // OPay transfer statuses: INITIAL | PENDING | SUCCESS | FAIL

  async getTransferStatus(
    reference: string,
    orderNo?: string
  ): Promise<OpayTransferStatusResponse> {
    const payload: Record<string, unknown> = { country: 'NG', reference };
    if (orderNo) payload.orderNo = orderNo;

    try {
      const data = await this.signedPost<{
        code: string;
        message: string;
        data?: {
          reference: string;
          orderNo: string;
          amount: string;        // kobo as string
          currency: string;
          fee: string;
          status: string;
          failureReason: string;
          bankAccountNumber: string;
        };
      }>(OPAY_TRANSFER_BASE, '/api/v3/transfer/status/toBank', payload);

      if (data.code !== '00000' || !data.data) {
        return {
          verified: false,
          status: 'not_found',
          error: data.message,
        };
      }

      const transfer = data.data;
      const isSuccess = transfer.status === 'SUCCESS';

      return {
        verified: isSuccess,
        status: transfer.status,
        orderNo: transfer.orderNo,
        amount: fromKobo(Number(transfer.amount)),
        currency: transfer.currency,
        reference: transfer.reference,
        failureReason: transfer.failureReason || undefined,
      };
    } catch (err) {
      const axiosErr = err as AxiosError;
      return {
        verified: false,
        status: 'api_error',
        error: axiosErr.message,
      };
    }
  }

  // ── Static factory ──────────────────────────────────────────────────────────

  static createInstance(credentials: OpayCredentials): OpayService {
    return new OpayService(credentials);
  }

  static async initiateTransfer(
    payoutDetails: OpayPayoutDetails,
    amount: number,
    currency: string,
    reference: string,
    credentials: OpayCredentials
  ): Promise<OpayPayoutResponse> {
    const service = new OpayService(credentials);
    return service.initiateTransfer(payoutDetails, amount, currency, reference);
  }

  static async verifyPayment(
    reference: string,
    credentials: OpayCredentials
  ): Promise<OpayVerifyPaymentResponse> {
    const service = new OpayService(credentials);
    return service.verifyInboundPayment(reference);
  }
}

export default OpayService;