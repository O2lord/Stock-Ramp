// discord-bot/lib/opay-credentials-bot.ts
//
// Bot-side credential retrieval for OPay orders.
// Mirrors flutterwave-credentials-bot.ts exactly — same decrypt function,
// same table structure, same return shape (OpayCredentialInfo).
//
// Used by:
//   - verify-payment/route.ts  (sell order payment verification)
//   - verify-transfer/route.ts (buy order transfer verification)
//   - initiate-buy-payout/route.ts (executor payout)

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import type { OpayCredentials } from '../services/opayServices';

const ALGORITHM = 'aes-256-gcm';

// ─────────────────────────────────────────────────────────────────────────────
// Decrypt helper — same as Flutterwave version, reused for both keys
// ─────────────────────────────────────────────────────────────────────────────

export function decrypt(encrypted: string, iv: string, authTag: string): string {
  const ENCRYPTION_KEY = process.env.FLUTTERWAVE_ENCRYPTION_KEY!;
  // NOTE: We reuse the same FLUTTERWAVE_ENCRYPTION_KEY env var for OPay too.
  // Both Flutterwave and OPay credentials are encrypted with the same platform key.
  // If you want separate keys per processor in future, add OPAY_ENCRYPTION_KEY.

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

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface OpayCredentialInfo {
  credentials: OpayCredentials;
  credential_id: string;
  wallet_address: string;
  is_active: boolean;
  label: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Get OPay credentials for a BUY order
// Reads buyer_flutterwave_credentials WHERE processor = 'opay'
// ─────────────────────────────────────────────────────────────────────────────

export async function getOpayCredentialsForBuyOrder(
  trustExpressPda: string
): Promise<OpayCredentialInfo | null> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  console.log(`🔍 [OPay] Looking up buyer credentials for PDA: ${trustExpressPda}`);

  // Step 1: resolve credential_id from the existing link table (unchanged)
  const { data: link, error: linkError } = await supabase
    .from('buy_order_credentials')
    .select('credential_id, wallet_address')
    .eq('trust_express_pda', trustExpressPda)
    .maybeSingle();

  if (linkError || !link) {
    console.warn(`⚠️ [OPay] No buy_order_credentials row for PDA: ${trustExpressPda}`);
    return null;
  }

  // Step 2: fetch credential, filtering by processor = 'opay'
  const { data: cred, error: credError } = await supabase
    .from('buyer_flutterwave_credentials')
    .select(`
      encrypted_secret_key,
      encryption_iv,
      encryption_auth_tag,
      encrypted_public_key,
      encryption_public_key_iv,
      encryption_public_key_auth_tag,
      processor_account_id,
      is_active,
      label,
      processor
    `)
    .eq('id', link.credential_id)
    .eq('wallet_address', link.wallet_address)
    .eq('processor', 'opay')
    .single();

  if (credError || !cred) {
    console.warn(`⚠️ [OPay] No OPay buyer credentials for credential_id: ${link.credential_id}`);
    return null;
  }

  if (!cred.is_active) {
    throw new Error('OPay buyer credentials are inactive. Please activate them in settings.');
  }

  if (!cred.encrypted_public_key || !cred.encryption_public_key_iv || !cred.encryption_public_key_auth_tag) {
    throw new Error('OPay credentials missing public key fields. Re-save credentials in settings.');
  }

  if (!cred.processor_account_id) {
    throw new Error('OPay credentials missing merchant ID. Re-save credentials in settings.');
  }

  const secretKey = decrypt(cred.encrypted_secret_key, cred.encryption_iv, cred.encryption_auth_tag);
  const publicKey = decrypt(
    cred.encrypted_public_key,
    cred.encryption_public_key_iv,
    cred.encryption_public_key_auth_tag
  );

  console.log(`✅ [OPay] Decrypted buyer credentials for PDA: ${trustExpressPda}`);

  return {
    credentials: {
      publicKey,
      secretKey,
      merchantId: cred.processor_account_id,
    },
    credential_id: link.credential_id,
    wallet_address: link.wallet_address,
    is_active: cred.is_active,
    label: cred.label,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Get OPay credentials for a SELL order
// Reads seller_flutterwave_accounts WHERE processor = 'opay'
// ─────────────────────────────────────────────────────────────────────────────

export async function getOpayCredentialsForSellOrder(
  trustExpressPda: string
): Promise<OpayCredentialInfo | null> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  console.log(`🔍 [OPay] Looking up seller credentials for PDA: ${trustExpressPda}`);

  const { data: link, error: linkError } = await supabase
    .from('sell_order_credentials')
    .select('credential_id, wallet_address')
    .eq('trust_express_pda', trustExpressPda)
    .maybeSingle();

  if (linkError || !link) {
    console.warn(`⚠️ [OPay] No sell_order_credentials row for PDA: ${trustExpressPda}`);
    return null;
  }

  const { data: cred, error: credError } = await supabase
    .from('seller_flutterwave_accounts')
    .select(`
      encrypted_secret_key,
      encryption_iv,
      encryption_auth_tag,
      encrypted_public_key,
      encryption_public_key_iv,
      encryption_public_key_auth_tag,
      processor_account_id,
      is_active,
      label,
      processor
    `)
    .eq('id', link.credential_id)
    .eq('wallet_address', link.wallet_address)
    .eq('processor', 'opay')
    .single();

  if (credError || !cred) {
    console.warn(`⚠️ [OPay] No OPay seller credentials for credential_id: ${link.credential_id}`);
    return null;
  }

  if (!cred.is_active) {
    throw new Error('OPay seller credentials are inactive. Please activate them in settings.');
  }

  const secretKey = decrypt(cred.encrypted_secret_key, cred.encryption_iv, cred.encryption_auth_tag);
  const publicKey = decrypt(
    cred.encrypted_public_key!,
    cred.encryption_public_key_iv!,
    cred.encryption_public_key_auth_tag!
  );

  return {
    credentials: {
      publicKey,
      secretKey,
      merchantId: cred.processor_account_id!,
    },
    credential_id: link.credential_id,
    wallet_address: link.wallet_address,
    is_active: cred.is_active,
    label: cred.label,
  };
}