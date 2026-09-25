// PRODUCTION FIX: flutterwave-credentials-bot.ts
// Updated to return full credential object instead of just secret key

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';

export function decrypt(encrypted: string, iv: string, authTag: string): string {
  const ENCRYPTION_KEY = process.env.FLUTTERWAVE_ENCRYPTION_KEY!;
  
  if (!ENCRYPTION_KEY) {
    throw new Error('FLUTTERWAVE_ENCRYPTION_KEY environment variable is required');
  }
  
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    Buffer.from(ENCRYPTION_KEY, 'hex'),
    Buffer.from(iv, 'hex')
  );

  decipher.setAuthTag(Buffer.from(authTag, 'hex'));

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

interface CredentialInfo {
  secret_key: string;
  credential_id: string;
  wallet_address: string;
  is_active: boolean;
  label: string | null;
}

async function getDecryptedCredentials(
  credentialId: string,
  walletAddress: string
): Promise<CredentialInfo | null> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  try {
    const { data, error } = await supabase
      .from('buyer_flutterwave_credentials')
      .select('encrypted_secret_key, encryption_iv, encryption_auth_tag, is_active, label')
      .eq('id', credentialId)
      .eq('wallet_address', walletAddress)
      .single(); // Changed from .eq('is_active', true) to allow checking inactive status

    if (error) {
      console.error('Error fetching credentials from database:', error);
      return null;
    }

    if (!data) {
      console.error('No credentials found for credential ID:', credentialId);
      return null;
    }

    // ✅ PRODUCTION: Check if credentials are active
    if (!data.is_active) {
      console.error('Credentials are inactive for credential ID:', credentialId);
      throw new Error('Flutterwave credentials are inactive. Please activate them in settings.');
    }

    const decryptedKey = decrypt(
      data.encrypted_secret_key,
      data.encryption_iv,
      data.encryption_auth_tag
    );

    return {
      secret_key: decryptedKey,
      credential_id: credentialId,
      wallet_address: walletAddress,
      is_active: data.is_active,
      label: data.label,
    };
  } catch (error) {
    console.error('Error decrypting credentials:', error);
    throw error;
  }
}

/**
 * ✅ PRODUCTION: Get credentials for a trust express buy order
 * Returns full credential info or null if not found
 * @param trustExpressPda - Trust Express PDA address
 * @returns Credential info or null
 */
export async function getCredentialsForTrustExpress(
  trustExpressPda: string
): Promise<CredentialInfo | null> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  try {
    console.log(`🔍 Looking up credentials for trust express: ${trustExpressPda}`);

    // ✅ PRODUCTION: Look up credential link
    const { data: linkData, error: linkError } = await supabase
      .from('buy_order_credentials')
      .select('credential_id, wallet_address')
      .eq('trust_express_pda', trustExpressPda)
      .single();

    if (linkError) {
      console.error('Error fetching credential link:', linkError);
      return null;
    }

    if (!linkData) {
      console.error('No credential link found for trust express:', trustExpressPda);
      return null;
    }

    console.log(`✅ Found credential link: ${linkData.credential_id} for wallet: ${linkData.wallet_address}`);

    // Get and decrypt the credentials
    const credentials = await getDecryptedCredentials(
      linkData.credential_id,
      linkData.wallet_address
    );

    if (!credentials) {
      console.error('Failed to decrypt credentials');
      return null;
    }

    console.log(`✅ Successfully retrieved credentials for: ${credentials.label || 'Unnamed'}`);
    return credentials;
  } catch (error) {
    console.error('Error getting credentials for trust express:', error);
    throw error; // Re-throw to let caller handle
  }
}

/**
 * ✅ PRODUCTION: Get credentials for a sell order
 * @param trustExpressPda - Trust Express PDA address
 * @returns Credential info or null
 */
export async function getCredentialsForSellOrder(
  trustExpressPda: string
): Promise<CredentialInfo | null> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  try {
    console.log(`🔍 Looking up seller credentials for: ${trustExpressPda}`);

    // Look up credential link in sell_order_credentials
    const { data: linkData, error: linkError } = await supabase
      .from('sell_order_credentials')
      .select('credential_id')
      .eq('trust_express_pda', trustExpressPda)
      .single();

    if (linkError || !linkData) {
      console.error('No credential link found in sell_order_credentials');
      return null;
    }

    console.log(`✅ Found seller credential link: ${linkData.credential_id}`);

    // Get seller credentials
    const { data: sellerCred, error: sellerError } = await supabase
      .from('seller_flutterwave_accounts')
      .select('encrypted_secret_key, encryption_iv, encryption_auth_tag, is_active, label, wallet_address')
      .eq('id', linkData.credential_id)
      .single();

    if (sellerError || !sellerCred) {
      console.error('Failed to fetch seller credentials');
      return null;
    }

    // Check if active
    if (!sellerCred.is_active) {
      throw new Error('Seller Flutterwave credentials are inactive');
    }

    // Decrypt
    const decryptedKey = decrypt(
      sellerCred.encrypted_secret_key,
      sellerCred.encryption_iv,
      sellerCred.encryption_auth_tag
    );

    return {
      secret_key: decryptedKey,
      credential_id: linkData.credential_id,
      wallet_address: sellerCred.wallet_address,
      is_active: sellerCred.is_active,
      label: sellerCred.label,
    };
  } catch (error) {
    console.error('Error getting seller credentials:', error);
    throw error;
  }
}

/**
 * ✅ PRODUCTION: Validate that credentials exist and are active
 * @param trustExpressPda - Trust Express PDA
 * @param orderType - 'buy' or 'sell'
 * @returns Validation result
 */
export async function validateOrderHasCredentials(
  trustExpressPda: string,
  orderType: 'buy' | 'sell'
): Promise<{ valid: boolean; error?: string }> {
  try {
    const credentials = orderType === 'buy'
      ? await getCredentialsForTrustExpress(trustExpressPda)
      : await getCredentialsForSellOrder(trustExpressPda);

    if (!credentials) {
      return {
        valid: false,
        error: `No Flutterwave credentials linked to this ${orderType} order`
      };
    }

    if (!credentials.is_active) {
      return {
        valid: false,
        error: 'Flutterwave credentials are inactive'
      };
    }

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}