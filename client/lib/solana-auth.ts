// client/lib/solana-auth.ts
// Copied verbatim from trust_vault's client/lib/solana-auth.ts — pure
// signature-verification helpers, no product-specific logic to adapt.
// Used by the payment-processor credential API routes to require a wallet
// signature on every write (store/delete), while reads stay signature-free.

import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";

/**
 * Verifies a Solana wallet signature.
 * @param walletAddress - base58 public key of the wallet
 * @param signature - base58-encoded signature
 * @param message - the original message that was signed
 */
export async function verifySignature(
  walletAddress: string,
  signature: string,
  message: string
): Promise<boolean> {
  try {
    if (!walletAddress || !signature || !message) {
      console.error("Missing required parameters for signature verification");
      return false;
    }

    let publicKey: PublicKey;
    try {
      publicKey = new PublicKey(walletAddress);
    } catch (error) {
      console.error("Invalid wallet address format:", error);
      return false;
    }

    let signatureUint8: Uint8Array;
    try {
      signatureUint8 = bs58.decode(signature);
    } catch (error) {
      console.error("Invalid signature format:", error);
      return false;
    }

    const messageUint8 = new TextEncoder().encode(message);

    return nacl.sign.detached.verify(messageUint8, signatureUint8, publicKey.toBytes());
  } catch (error) {
    console.error("Error verifying signature:", error);
    return false;
  }
}

/**
 * Generates a message for the user to sign on the frontend before sending
 * a write request (store/delete) to the API.
 */
export function generateAuthMessage(
  action: string,
  additionalData?: Record<string, string | number | boolean>
): string {
  const timestamp = Date.now();
  const nonce = Math.random().toString(36).substring(2, 15);

  let message = `Sign this message to authenticate with Stock Ramp.\n\n`;
  message += `Action: ${action}\n`;
  message += `Timestamp: ${timestamp}\n`;
  message += `Nonce: ${nonce}\n`;

  if (additionalData) {
    message += `\nAdditional Data:\n`;
    for (const [key, value] of Object.entries(additionalData)) {
      message += `${key}: ${value}\n`;
    }
  }

  message += `\nThis signature will not cost any gas fees.`;
  return message;
}

/** Prevents replay attacks — rejects messages older than maxAgeMinutes. */
export function validateMessageTimestamp(message: string, maxAgeMinutes = 5): boolean {
  try {
    const timestampMatch = message.match(/Timestamp:\s*(\d+)/);
    if (!timestampMatch) {
      console.error("No timestamp found in message");
      return false;
    }

    const timestamp = parseInt(timestampMatch[1], 10);
    if (isNaN(timestamp)) {
      console.error("Invalid timestamp format");
      return false;
    }

    const now = Date.now();
    const maxAge = maxAgeMinutes * 60 * 1000;

    if (now - timestamp > maxAge) {
      console.error("Message timestamp is too old");
      return false;
    }
    if (timestamp > now + 60_000) {
      console.error("Message timestamp is in the future");
      return false;
    }

    return true;
  } catch (error) {
    console.error("Error validating message timestamp:", error);
    return false;
  }
}

export function extractActionFromMessage(message: string): string | null {
  const actionMatch = message.match(/Action:\s*(.+)/);
  return actionMatch ? actionMatch[1].trim() : null;
}

export function validateMessageAction(message: string, expectedAction: string): boolean {
  return extractActionFromMessage(message) === expectedAction;
}

export function validateMessage(
  message: string,
  expectedAction: string,
  maxAgeMinutes = 5
): { valid: boolean; error?: string } {
  if (!validateMessageTimestamp(message, maxAgeMinutes)) {
    return { valid: false, error: "Message timestamp is invalid or too old" };
  }
  if (!validateMessageAction(message, expectedAction)) {
    return { valid: false, error: "Message action does not match expected action" };
  }
  return { valid: true };
}
