// client/lib/encryption.ts
// AES-256-GCM encrypt/decrypt for payment processor secrets, shared across
// all 3 processors (flutterwave/opay/paystack) and both sides (buyer/seller).
//
// Uses the SAME env var name (`FLUTTERWAVE_ENCRYPTION_KEY`) that
// discord-bot/lib/{flutterwave,opay,paystack}-credentials-bot.ts already
// expect and decrypt with — that bot code is unmodified, and the comments in
// opay-credentials-bot.ts / paystack-credentials-bot.ts explicitly note "we
// reuse the same FLUTTERWAVE_ENCRYPTION_KEY env var for OPay/Paystack too."
// If you want per-processor keys later, both sides of the encrypt/decrypt
// pair (this file + the discord-bot lib files) need to change together.

import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";

function getKey(): Buffer {
  const key = process.env.FLUTTERWAVE_ENCRYPTION_KEY;
  if (!key || key.length !== 64) {
    throw new Error(
      "FLUTTERWAVE_ENCRYPTION_KEY must be set to a 64-character hex string (32 bytes)"
    );
  }
  return Buffer.from(key, "hex");
}

export interface EncryptedField {
  encrypted: string;
  iv: string;
  authTag: string;
}

export function encryptField(plaintext: string): EncryptedField {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();

  return {
    encrypted,
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
  };
}

export function decryptField(encrypted: string, iv: string, authTag: string): string {
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(iv, "hex"));
  decipher.setAuthTag(Buffer.from(authTag, "hex"));

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}
