// client/lib/paymentProcessors/db.ts
// Shared row <-> field mapping for the two credential tables, so the store
// and status route handlers (buyer + seller, x3 processors) don't each
// reimplement encrypt-on-write / decrypt-on-read.

import { encryptField, decryptField } from "@/lib/encryption";
import type { ProcessorFields } from "./config";

export interface CredentialRow {
  id: string;
  wallet_address: string;
  processor: string;
  label: string | null;
  encrypted_secret_key: string;
  encryption_iv: string;
  encryption_auth_tag: string;
  encrypted_public_key: string | null;
  encryption_public_key_iv: string | null;
  encryption_public_key_auth_tag: string | null;
  processor_account_id: string | null;
  is_active: boolean;
  last_verified: string | null;
  created_at: string;
  updated_at: string;
}

/** Encrypts whichever fields are present into the columns store/route.ts inserts. */
export function encryptFieldsForRow(fields: ProcessorFields) {
  const secret = encryptField(fields.secretKey!);

  const row: Record<string, unknown> = {
    encrypted_secret_key: secret.encrypted,
    encryption_iv: secret.iv,
    encryption_auth_tag: secret.authTag,
    processor_account_id: fields.merchantId ?? null,
  };

  if (fields.publicKey) {
    const pub = encryptField(fields.publicKey);
    row.encrypted_public_key = pub.encrypted;
    row.encryption_public_key_iv = pub.iv;
    row.encryption_public_key_auth_tag = pub.authTag;
  }

  return row;
}

/** Decrypts a stored row back into plain fields, for a live status re-check. */
export function decryptRowFields(row: CredentialRow): ProcessorFields {
  const fields: ProcessorFields = {
    secretKey: decryptField(row.encrypted_secret_key, row.encryption_iv, row.encryption_auth_tag),
  };

  if (row.encrypted_public_key && row.encryption_public_key_iv && row.encryption_public_key_auth_tag) {
    fields.publicKey = decryptField(
      row.encrypted_public_key,
      row.encryption_public_key_iv,
      row.encryption_public_key_auth_tag
    );
  }
  if (row.processor_account_id) {
    fields.merchantId = row.processor_account_id;
  }

  return fields;
}

export const PUBLIC_COLUMNS =
  "id, wallet_address, processor, label, processor_account_id, is_active, last_verified, created_at, updated_at";
