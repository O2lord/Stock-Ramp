import axios, { AxiosInstance, AxiosError } from "axios";
import crypto from 'crypto';
import dotenv from "dotenv";
dotenv.config();

interface PayoutDetails {
  type?: 'bank_transfer' | 'mobile_money' | 'flutterwave_wallet';
  bank_code?: string;
  account_bank?: string;
  account_number: string;
  account_name?: string;
  beneficiary_name?: string;
  phone_number?: string;
  network?: string;
  narration?: string;
}

interface FlutterwaveTransferData {
  id: number;
  account_number: string;
  bank_code: string;
  full_name: string;
  created_at: string;
  currency: string;
  debit_currency: string;
  amount: number;
  fee: number;
  status: string;
  reference: string;
  meta?: unknown;
  narration: string;
  complete_message: string;
  requires_approval: number;
  is_approved: number;
  bank_name: string;
}

interface FlutterwaveErrorData {
  message: string;
  code?: string;
  data?: unknown;
}

interface PayoutResponse {
  success: boolean;
  data?: FlutterwaveTransferData;
  reference: string;
  flw_ref?: string;
  error?: string;
}

interface PayoutStatusResponse {
  success: boolean;
  status?: string;
  data?: FlutterwaveTransferData;
  error?: string;
}

interface BankInfo {
  id: number;
  code: string;
  name: string;
}

interface AccountVerificationDetails {
  account_number: string;
  account_bank: string;
}

interface AccountVerificationResponse {
  success: boolean;
  accountName?: string;
  accountNumber?: string;
  error?: string;
}

interface CurrencyInfo {
  name: string;
  min_amount: number;
  max_amount: number;
}

interface SupportedCurrencies {
  [key: string]: CurrencyInfo;
}

interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

interface CredentialValidationResult {
  valid: boolean;
  balance?: number;
  currency?: string;
  error?: string;
}

interface PaymentLinkResponse {
  status: string;
  message: string;
  data: {
    link: string;
    reference: string;
  };
}

interface TransactionData {
  id: number;
  tx_ref: string;
  flw_ref: string;
  amount: number;
  currency: string;
  charged_amount: number;
  status: string;
  payment_type: string;
  created_at: string;
  account_id: number;
  customer: {
    name: string;
    email: string;
    phone_number: string;
  };
}

interface VerifyPaymentResponse {
  status: string;
  message: string;
  data: TransactionData;
}

class FlutterwaveService {
  private baseURL: string;
  private secretKey: string;
  private client: AxiosInstance;
  

  /**
   * ✅ PRODUCTION: Constructor now REQUIRES secretKey
   * No fallback to platform credentials
   * @param secretKey - REQUIRED Flutterwave secret key
   */
  constructor(secretKey: string) {
    this.baseURL = "https://api.flutterwave.com/v3";
    
    // ✅ PRODUCTION: Validate secret key is provided
    if (!secretKey) {
      throw new Error(
        "Flutterwave secret key is REQUIRED. Platform credential fallbacks have been removed for security."
      );
    }

    // ✅ PRODUCTION: Validate secret key format
    const isValidSecretKey = secretKey.startsWith('FLWSECK-') || secretKey.startsWith('FLWSECK_TEST-');
    const isValidPublicKey = secretKey.startsWith('FLWPUBK-') || secretKey.startsWith('FLWPUBK_TEST-');
    
    if (!isValidSecretKey && !isValidPublicKey) {
      throw new Error(
        "Invalid Flutterwave secret key format. Key must start with 'FLWSECK-' or 'FLWSECK_TEST-'"
      );
    }

    this.secretKey = secretKey;

    this.client = axios.create({
      baseURL: this.baseURL,
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        "Content-Type": "application/json",
      },
    });
  }


/**
   * Static factory method to create instance with credentials
   * @param secretKey - REQUIRED Flutterwave secret key
   * @returns New FlutterwaveService instance
   */
  static createInstanceWithKey(secretKey: string): FlutterwaveService {
    return new FlutterwaveService(secretKey);
  }

  /**
   * Static method to validate credentials before using them
   * @param secretKey - Flutterwave secret key to validate
   * @returns Validation result with balance info if valid
   */
  static async validateCredentials(secretKey: string): Promise<CredentialValidationResult> {
    try {
      if (!secretKey) {
        return { valid: false, error: 'Secret key is required' };
      }

      if (!secretKey.startsWith('FLWSECK-') && !secretKey.startsWith('FLWSECK_TEST-')) {
        return { valid: false, error: 'Invalid secret key format' };
      }

      const response = await axios.get('https://api.flutterwave.com/v3/balances', {
        headers: {
          'Authorization': `Bearer ${secretKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.status === 200 && response.data.status === 'success') {
        const balanceData = response.data.data && response.data.data.length > 0 
          ? response.data.data[0] 
          : null;

        return {
          valid: true,
          balance: balanceData?.available_balance,
          currency: balanceData?.currency,
        };
      }

      return { valid: false, error: 'Invalid API response' };
    } catch (error) {
      const axiosError = error as AxiosError;
      return {
        valid: false,
        error: axiosError.response?.status === 401 
          ? 'Invalid or expired credentials'
          : 'Network error or API unavailable',
      };
    }
  }




   /**
   * ✅ PRODUCTION: Initiate payout using provided credentials ONLY
   * NO FALLBACK to platform credentials
   * @throws Error if credentials are invalid
   */
async initiatePayout(
  payoutDetails: PayoutDetails | string,
  amount: number,
  currency: string,
  payoutReference: string
): Promise<PayoutResponse> {
  try {
    const details: PayoutDetails =
      typeof payoutDetails === "string"
        ? JSON.parse(payoutDetails)
        : payoutDetails;

    const payoutRequest = this._buildPayoutRequest(
      details,
      amount,
      currency,
      payoutReference
    );

    console.log(`🔄 [FLW] POST /transfers — ref: ${payoutReference}, amount: ${amount} ${currency}`);
    console.log(`🔄 [FLW] Payload:`, JSON.stringify(payoutRequest, null, 2));

    const response = await this.client.post("/transfers", payoutRequest);

    console.log(`🔄 [FLW] Response status: ${response.status}`);
    console.log(`🔄 [FLW] Response body:`, JSON.stringify(response.data, null, 2));

    if (response.data.status === "success") {
      const transferData = response.data.data;
      
      // Flutterwave transfer ID is the stable identifier for outbound transfers.
      // There is no "flw_ref" on transfer initiation — that field exists only on
      // incoming transaction objects. We use the numeric transfer ID as our ref.
      const transferId = transferData?.id ? String(transferData.id) : undefined;

      console.log(`✅ [FLW] Transfer created — id: ${transferId}, status: ${transferData?.status}, reference: ${transferData?.reference}`);

      if (!transferId) {
        console.error(`❌ [FLW] Response was success but data.id is missing! Full data:`, JSON.stringify(transferData, null, 2));
      }

      return {
        success: true,
        data: transferData,
        reference: payoutReference,
        flw_ref: transferId,  // numeric transfer ID — use this for status polling
      };
    } else {
      console.error(`❌ [FLW] Transfer rejected — status: ${response.data.status}, message: ${response.data.message}`);
      return {
        success: false,
        error: response.data.message,
        reference: payoutReference,
      };
    }
  } catch (error: unknown) {
    const axiosError = error as AxiosError;

    console.error(`❌ [FLW] Transfer threw for ${payoutReference}`);
    console.error(`❌ [FLW] HTTP status: ${axiosError.response?.status}`);
    console.error(`❌ [FLW] Response body:`, JSON.stringify(axiosError.response?.data, null, 2));
    console.error(`❌ [FLW] Message: ${axiosError.message}`);

    const errorMessage = this.getErrorMessage(axiosError.response?.data);

    if (axiosError.response?.status === 401) {
      return {
        success: false,
        error: 'Invalid or expired Flutterwave credentials. Please update your credentials in settings.',
        reference: payoutReference,
      };
    }

    if (axiosError.response?.status === 403) {
      return {
        success: false,
        error: 'Insufficient permissions or account suspended. Please check your Flutterwave account status.',
        reference: payoutReference,
      };
    }

    return {
      success: false,
      error: errorMessage,
      reference: payoutReference,
    };
  }
}

/**
   * ✅ PRODUCTION: Static method to initiate payout with user credentials
   * This is the main method to use - NO FALLBACK
   * @param payoutDetails - Payout details
   * @param amount - Amount to pay out
   * @param currency - Currency code
   * @param payoutReference - Unique reference
   * @param secretKey - REQUIRED user's secret key
   * @returns Payout response (NO usedPlatformCredentials flag)
   */
  static async initiatePayout(
    payoutDetails: PayoutDetails | string,
    amount: number,
    currency: string,
    payoutReference: string,
    secretKey: string
  ): Promise<PayoutResponse> {
    // ✅ PRODUCTION: Validate secretKey is provided
    if (!secretKey) {
      throw new Error(
        'Flutterwave secret key is required. Platform credential fallbacks have been removed for security.'
      );
    }

    // Create service instance with user's credentials
    const service = new FlutterwaveService(secretKey);
    
    // Execute payout
    return await service.initiatePayout(
      payoutDetails,
      amount,
      currency,
      payoutReference
    );
  }


 /**
   * Check the status of a payout
   */
  async checkPayoutStatus(transferId: string): Promise<PayoutStatusResponse> {
    try {
      const response = await this.client.get(`/transfers/${transferId}`);

      return {
        success: true,
        status: response.data.data.status,
        data: response.data.data,
      };
    } catch (error: unknown) {
      const axiosError = error as AxiosError;
      console.error(
        `Error checking payout status for ${transferId}:`,
        axiosError.response?.data || axiosError.message
      );
      return {
        success: false,
        error: this.getErrorMessage(axiosError.response?.data),
      };
    }
  }

  /**
   * Get available banks for bank transfers
   */
  async getBanks(country: string = "NG"): Promise<BankInfo[]> {
    try {
      const response = await this.client.get(`/banks/${country}`);
      return response.data.data;
    } catch (error: unknown) {
      const axiosError = error as AxiosError;
      console.error(
        `Error fetching banks for ${country}:`,
        axiosError.response?.data || axiosError.message
      );
      return [];
    }
  }

  /**
   * Verify account number and get account name
   */
  async verifyAccount(accountDetails: AccountVerificationDetails): Promise<AccountVerificationResponse> {
    try {
      const response = await this.client.post(
        "/accounts/resolve",
        accountDetails
      );

      if (response.data.status === "success") {
        return {
          success: true,
          accountName: response.data.data.account_name,
          accountNumber: response.data.data.account_number,
        };
      } else {
        return {
          success: false,
          error: response.data.message,
        };
      }
    } catch (error: unknown) {
      const axiosError = error as AxiosError;
      console.error(
        "Account verification error:",
        axiosError.response?.data || axiosError.message
      );
      return {
        success: false,
        error: this.getErrorMessage(axiosError.response?.data),
      };
    }
  }


  /**
   * Build payout request based on payout details type
   */
  private _buildPayoutRequest(
    details: PayoutDetails,
    amount: number,
    currency: string,
    payoutReference: string
  ) {
    const baseRequest = {
      account_bank: details.bank_code || details.account_bank,
      account_number: details.account_number,
      amount: amount,
      narration: details.narration || `Instant payout - ${payoutReference}`,
      currency: currency,
      reference: payoutReference,
      callback_url: process.env.FLUTTERWAVE_CALLBACK_URL,
      debit_currency: currency,
    };

    switch (details.type) {
      case "bank_transfer":
        return {
          ...baseRequest,
          beneficiary_name: details.beneficiary_name || details.account_name,
        };

      case "mobile_money":
        return {
          ...baseRequest,
          account_bank: "MPS",
          account_number: details.phone_number,
          beneficiary_name: details.beneficiary_name,
          mobile_money: {
            phone: details.phone_number,
            network: details.network,
          },
        };

      case "flutterwave_wallet":
        return {
          ...baseRequest,
          account_bank: "barter",
          beneficiary_name: details.beneficiary_name,
        };

      default:
        return {
          ...baseRequest,
          beneficiary_name: details.beneficiary_name || details.account_name,
        };
    }
  }

  /**
   * Get supported currencies and their limits
   */
  getSupportedCurrencies(): SupportedCurrencies {
    return {
      NGN: {
        name: "Nigerian Naira",
        min_amount: 10,
        max_amount: 50000000,
      },
      GHS: {
        name: "Ghanaian Cedi",
        min_amount: 1,
        max_amount: 500000,
      },
      KES: {
        name: "Kenyan Shilling",
        min_amount: 10,
        max_amount: 1000000,
      },
      UGX: {
        name: "Ugandan Shilling",
        min_amount: 100,
        max_amount: 50000000,
      },
      TZS: {
        name: "Tanzanian Shilling",
        min_amount: 100,
        max_amount: 5000000,
      },
      USD: {
        name: "US Dollar",
        min_amount: 1,
        max_amount: 20000,
      },
      EUR: {
        name: "Euro",
        min_amount: 1,
        max_amount: 20000,
      },
      GBP: {
        name: "British Pound",
        min_amount: 1,
        max_amount: 20000,
      },
    };
  }

  /**
   * Validate payout details before processing
   */
  validatePayoutDetails(
    details: PayoutDetails,
    amount: number,
    currency: string
  ): ValidationResult {
    const errors: string[] = [];
    const supportedCurrencies = this.getSupportedCurrencies();

    if (!supportedCurrencies[currency]) {
      errors.push(`Unsupported currency: ${currency}`);
    } else {
      const currencyInfo = supportedCurrencies[currency];
      if (amount < currencyInfo.min_amount) {
        errors.push(
          `Amount too low. Minimum: ${currencyInfo.min_amount} ${currency}`
        );
      }
      if (amount > currencyInfo.max_amount) {
        errors.push(
          `Amount too high. Maximum: ${currencyInfo.max_amount} ${currency}`
        );
      }
    }

    if (!details.account_number) {
      errors.push("Account number is required");
    }

    if (!details.bank_code && !details.account_bank) {
      errors.push("Bank code is required");
    }

    if (!details.beneficiary_name && !details.account_name) {
      errors.push("Beneficiary name is required");
    }

    if (details.type === "mobile_money") {
      if (!details.phone_number) {
        errors.push("Phone number is required for mobile money");
      }
      if (!details.network) {
        errors.push("Mobile network is required for mobile money");
      }
    }

    return {
      isValid: errors.length === 0,
      errors: errors,
    };
  }

  /**
   * Helper method to extract error message from API response
   */
  private getErrorMessage(responseData: unknown): string {
    if (responseData && typeof responseData === 'object') {
      const errorData = responseData as FlutterwaveErrorData;
      return errorData.message || 'Unknown API error';
    }
    return 'Network or unknown error occurred';
  }

/**
 * ✅ FIXED: Create payment link with MANDATORY seller credentials
 * @param payload - Payment link payload with all details
 * @param redirectUrl - URL to redirect after payment (for backwards compatibility, not used)
 * @param credentialId - REQUIRED seller's credential ID
 * @returns Payment link URL
 */
async createPaymentLink(
  payload: {
    amount: number;
    currency: string;
    tx_ref: string;
    redirect_url?: string;
    customer: {
      name: string;
      email: string;
    };
    customizations?: {
      title?: string;
      description?: string;
      logo?: string;
    };
    meta: {
      reference: string;
      source: string;
      trust_express_address?: string;
      buyer_address?: string;
      seller_address?: string;
    };
  },
  redirectUrl: string,
  credentialId: string
): Promise<string> {
  try {
    // ✅ MANDATORY: credentialId is required
    if (!credentialId) {
      throw new Error('Credential ID is required to create payment link');
    }

    console.log('🔗 Creating payment link with seller credentials');
    console.log(`   Credential ID: ${credentialId}`);
    console.log('   Payload:', JSON.stringify(payload, null, 2));
    
    // Get seller's secret key
    const secretKeyToUse = await FlutterwaveService.getSecretKeyFromCredentialId(credentialId);
    
    // Try to get subaccount ID for this seller
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: sellerData } = await supabase
      .from('seller_flutterwave_accounts')
      .select('flutterwave_subaccount_id')
      .eq('id', credentialId)
      .maybeSingle();

    const subaccountId = sellerData?.flutterwave_subaccount_id || null;
    
    if (subaccountId) {
      console.log(`   ✅ Found subaccount ID: ${subaccountId}`);
    } else {
      console.log('   ⚠️  No subaccount ID found for this seller');
    }

    // Use the payload directly but add subaccount if available
    const finalPayload: any = { ...payload };
    
    // Add subaccount if available (payment goes to seller)
    if (subaccountId) {
      finalPayload.subaccounts = [subaccountId];
      console.log('   ✅ Added subaccount to payload');
    }

    console.log('   Final payload:', JSON.stringify(finalPayload, null, 2));

    // Make API call with seller's credentials
    const response = await this.client.post('/payments', finalPayload, {
      headers: {
        'Authorization': `Bearer ${secretKeyToUse}`,
        'Content-Type': 'application/json',
      },
    });

    console.log('   Response status:', response.status);
    console.log('   Response data:', JSON.stringify(response.data, null, 2));

    const responseData = response.data;
    if (response.status === 200 && responseData.status === 'success') {
      console.log(`   ✅ Payment link created: ${responseData.data.link}`);
      return responseData.data.link;
    }

    throw new Error(`Failed to create payment link: ${responseData.message || 'Unknown error from API'}`);

  } catch (error) {
    console.error('❌ Payment link creation failed - Full error details:');
    if (axios.isAxiosError(error)) {
      console.error('   Axios error response data:', error.response?.data);
      console.error('   Axios error status:', error.response?.status);
      console.error('   Axios error headers:', error.response?.headers);
      throw new Error(
        `Payment link creation failed: ${
          error.response?.data?.message || error.message || 'UNKNOWN_AXIOS_ERROR'
        }`
      );
    } else if (error instanceof Error) {
      console.error('   Error message:', error.message);
      console.error('   Error name:', error.name);
      console.error('   Error stack:', error.stack);
    } else {
      console.error('   Unknown error:', error);
    }
    
    throw new Error(
      `Payment link creation failed: ${
        error instanceof Error ? error.message : 'UNKNOWN_ERROR'
      }`
    );
  }
}

/**
 * Get recent transactions from seller's Flutterwave account
 * @param credentialId - REQUIRED seller's credential ID
 * @param txRef - Optional transaction reference to filter by
 * @returns Array of recent successful transactions
 */
static async getRecentTransactions(
  credentialId: string,
  txRef?: string
): Promise<any[]> {
  try {
    if (!credentialId) {
      throw new Error('Credential ID is required to fetch transactions');
    }

    const secretKey = await this.getSecretKeyFromCredentialId(credentialId);

    // Get transactions from last 24 hours
    const fromDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const toDate = new Date().toISOString();

    let url = `https://api.flutterwave.com/v3/transactions?from=${fromDate}&to=${toDate}&status=successful`;
    
    // Add tx_ref filter if provided
    if (txRef) {
      url += `&tx_ref=${txRef}`;
    }

    const response = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (response.data.status === 'success') {
      const transactions = response.data.data || [];
      
      // If specific txRef was requested, filter client-side as backup
      if (txRef) {
        return transactions.filter((tx: any) => tx.tx_ref === txRef);
      }
      
      return transactions;
    }

    console.warn('⚠️ Failed to fetch transactions:', response.data.message);
    return [];
  } catch (error) {
    const axiosError = error as AxiosError;
    
    // Handle rate limiting
    if (axiosError.response?.status === 429) {
      console.warn('⚠️ Rate limit hit, waiting before retry...');
      await new Promise(resolve => setTimeout(resolve, 5000));
      // Retry once
      return this.getRecentTransactions(credentialId, txRef);
    }
    
    console.error('❌ Error fetching transactions:', axiosError.response?.data || axiosError.message);
    return [];
  }
}

  /**
   * ✅ FIXED: Verify payment with MANDATORY credential ID
   * NO FALLBACK to platform credentials
   * @param reference - Transaction reference to verify
   * @param credentialId - REQUIRED seller's credential ID
   * @returns Payment verification result
   */
  static async verifyPayment(
    reference: string,
    credentialId: string
  ): Promise<{ verified: boolean; amount?: number; currency?: string; status?: string; transactionId?: number }> {
    try {
      // ✅ MANDATORY: credentialId is required
      if (!credentialId) {
        console.error('❌ verifyPayment called without credentialId');
        throw new Error('Credential ID is required for payment verification');
      }

      console.log(`🔍 Verifying payment with seller credential: ${credentialId}`);
      console.log(`   Transaction reference: ${reference}`);

      // Get seller's secret key
      const secretKey = await this.getSecretKeyFromCredentialId(credentialId);

      console.log(`   Using seller's Flutterwave account for verification`);

      const response = await axios.get(
        `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${reference}`,
        {
          headers: {
            'Authorization': `Bearer ${secretKey}`,
            'Content-Type': 'application/json',
          },
        }
      );

      console.log(`   API Response Status: ${response.status}`);
      console.log(`   API Response:`, JSON.stringify(response.data, null, 2));

      if (response.data.status === 'success' && response.data.data.status === 'successful') {
        console.log(`✅ Payment verified successfully`);
        console.log(`   Amount: ${response.data.data.amount} ${response.data.data.currency}`);
        console.log(`   Transaction ID: ${response.data.data.id}`);

        return {
          verified: true,
          amount: response.data.data.amount,
          currency: response.data.data.currency,
          status: response.data.data.status,
          transactionId: response.data.data.id,
        };
      }

      console.log(`⚠️ Payment not successful. Status: ${response.data.data?.status}`);
      return { verified: false, status: response.data.data?.status };
    } catch (error) {
      const axiosError = error as AxiosError;
      console.error('❌ Error verifying payment:', axiosError.response?.data || axiosError.message);
      return { verified: false };
    }
  }

/**
 * ✅ FIXED: Get secret key from credential ID (from database)
 * Now only checks seller_flutterwave_accounts table for sell orders
 * @param credentialId - Credential ID from database
 * @returns Decrypted secret key
 */
private static async getSecretKeyFromCredentialId(credentialId: string): Promise<string> {
  const { createClient } = await import('@supabase/supabase-js');
  
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // ✅ For sell orders, only check seller credentials
  const { data: sellerData, error: sellerError } = await supabase
    .from('seller_flutterwave_accounts')
    .select('encrypted_secret_key, encryption_iv, encryption_auth_tag, is_active')
    .eq('id', credentialId)
    .maybeSingle();

  if (sellerError) {
    console.error('❌ Error fetching seller credentials:', sellerError);
    throw new Error(`Failed to fetch seller credentials: ${sellerError.message}`);
  }

  if (!sellerData) {
    throw new Error(`Seller credential ${credentialId} not found in seller_flutterwave_accounts`);
  }

  // Check if credentials are active
  if (!sellerData.is_active) {
    throw new Error(`Seller credentials are inactive. Please activate them in settings.`);
  }

  // Decrypt seller credentials
  const ALGORITHM = 'aes-256-gcm';
  const ENCRYPTION_KEY = process.env.FLUTTERWAVE_ENCRYPTION_KEY!;
  
  if (!ENCRYPTION_KEY) {
    throw new Error('FLUTTERWAVE_ENCRYPTION_KEY environment variable is required');
  }

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    Buffer.from(ENCRYPTION_KEY, 'hex'),
    Buffer.from(sellerData.encryption_iv, 'hex')
  );

  decipher.setAuthTag(Buffer.from(sellerData.encryption_auth_tag, 'hex'));

  let decrypted = decipher.update(sellerData.encrypted_secret_key, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  console.log(`✅ Decrypted seller credentials for: ${credentialId}`);
  return decrypted;
}
}

export default FlutterwaveService;