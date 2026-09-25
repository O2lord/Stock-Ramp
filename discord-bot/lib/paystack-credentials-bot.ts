// discord-bot/lib/paystack-credentials-bot.ts
//
// Bot-side credential retrieval for Paystack orders.
// Mirrors opay-credentials-bot.ts exactly — same decrypt function,
// same table structure, same return shape.
//
// Paystack only needs a single secretKey (no public key, no merchant ID).
// The encrypted_secret_key column is used; encrypted_public_key is left null.
//
// Used by:
//   - verify-payment/route.ts  (sell order payment verification)
//   - verify-transfer/route.ts (buy order transfer verification)
//   - initiate-buy-payout/route.ts (executor payout)

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import type { PaystackCredentials } from '../services/paystackService';

const ALGORITHM = 'aes-256-gcm';

// ─────────────────────────────────────────────────────────────────────────────
// Decrypt helper — shared across all processors
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface PaystackCredentialInfo {
  credentials: PaystackCredentials;
  credential_id: string;
  wallet_address: string;
  is_active: boolean;
  label: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Get Paystack credentials for a BUY order
// Reads buyer_flutterwave_credentials WHERE processor = 'paystack'
// ─────────────────────────────────────────────────────────────────────────────

export async function getPaystackCredentialsForBuyOrder(
  trustExpressPda: string
): Promise<PaystackCredentialInfo | null> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  console.log(`🔍 [Paystack] Looking up buyer credentials for PDA: ${trustExpressPda}`);

  const { data: link, error: linkError } = await supabase
    .from('buy_order_credentials')
    .select('credential_id, wallet_address')
    .eq('trust_express_pda', trustExpressPda)
    .maybeSingle();

  if (linkError || !link) {
    console.warn(`⚠️ [Paystack] No buy_order_credentials row for PDA: ${trustExpressPda}`);
    return null;
  }

  const { data: cred, error: credError } = await supabase
    .from('buyer_flutterwave_credentials')
    .select(`
      encrypted_secret_key,
      encryption_iv,
      encryption_auth_tag,
      is_active,
      label,
      processor
    `)
    .eq('id', link.credential_id)
    .eq('wallet_address', link.wallet_address)
    .eq('processor', 'paystack')
    .single();

  if (credError || !cred) {
    console.warn(`⚠️ [Paystack] No Paystack buyer credentials for credential_id: ${link.credential_id}`);
    return null;
  }

  if (!cred.is_active) {
    throw new Error('Paystack buyer credentials are inactive. Please activate them in settings.');
  }

  const secretKey = decrypt(cred.encrypted_secret_key, cred.encryption_iv, cred.encryption_auth_tag);
  console.log(`✅ [Paystack] Decrypted buyer credentials for PDA: ${trustExpressPda}`);

  return {
    credentials: { secretKey },
    credential_id: link.credential_id,
    wallet_address: link.wallet_address,
    is_active: cred.is_active,
    label: cred.label,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Get Paystack credentials for a SELL order
// Reads seller_flutterwave_accounts WHERE processor = 'paystack'
// ─────────────────────────────────────────────────────────────────────────────

export async function getPaystackCredentialsForSellOrder(
  trustExpressPda: string
): Promise<PaystackCredentialInfo | null> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  console.log(`🔍 [Paystack] Looking up seller credentials for PDA: ${trustExpressPda}`);

  const { data: link, error: linkError } = await supabase
    .from('sell_order_credentials')
    .select('credential_id, wallet_address')
    .eq('trust_express_pda', trustExpressPda)
    .maybeSingle();

  if (linkError || !link) {
    console.warn(`⚠️ [Paystack] No sell_order_credentials row for PDA: ${trustExpressPda}`);
    return null;
  }

  const { data: cred, error: credError } = await supabase
    .from('seller_flutterwave_accounts')
    .select(`
      encrypted_secret_key,
      encryption_iv,
      encryption_auth_tag,
      is_active,
      label,
      processor,
      wallet_address
    `)
    .eq('id', link.credential_id)
    .eq('processor', 'paystack')
    .single();

  if (credError || !cred) {
    console.warn(`⚠️ [Paystack] No Paystack seller credentials for credential_id: ${link.credential_id}`);
    return null;
  }

  if (!cred.is_active) {
    throw new Error('Paystack seller credentials are inactive. Please activate them in settings.');
  }

  const secretKey = decrypt(cred.encrypted_secret_key, cred.encryption_iv, cred.encryption_auth_tag);

  return {
    credentials: { secretKey },
    credential_id: link.credential_id,
    wallet_address: cred.wallet_address,
    is_active: cred.is_active,
    label: cred.label,
  };
}