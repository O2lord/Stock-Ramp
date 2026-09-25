import { Keypair, PublicKey } from "@solana/web3.js";
import QRCode from "qrcode";
import { getConnection } from "./program.js";

const RAW_BASE_URL = process.env.PUBLIC_BASE_URL;

if (!RAW_BASE_URL) {
  throw new Error(
    "PUBLIC_BASE_URL is not set. Set it to this server's bare origin, e.g. " +
      "https://stock-ramp-mcp-production.up.railway.app — NOT the /mcp " +
      "connector URL pasted into Claude.ai's custom-connector field."
  );
}
if (RAW_BASE_URL.endsWith("/mcp") || RAW_BASE_URL.includes("/mcp/")) {
  throw new Error(
    `PUBLIC_BASE_URL is "${RAW_BASE_URL}", which contains "/mcp" — that's the ` +
      `MCP connector endpoint, not this server's origin. Every QR this server ` +
      `generates will 404 when scanned. Strip everything from "/mcp" onward.`
  );
}
const BASE_URL = RAW_BASE_URL.replace(/\/+$/, "");

/** A fresh keypair's pubkey, used only as a correlation reference per Solana
 * Pay spec (§4.2 of the transaction-request spec) — never used to sign. */
export function generateReference(): PublicKey {
  return Keypair.generate().publicKey;
}

/**
 * Resolves the actual signer wallet from a Solana Pay reference key, once
 * a transaction carrying it has landed. The reference is attached as a
 * non-signing account on the transaction (see server.ts's POST
 * /pay/:reference) specifically so this lookup works.
 */
export async function findSignerByReference(reference: string): Promise<string | null> {
  const connection = getConnection();
  const sigs = await connection.getSignaturesForAddress(new PublicKey(reference), { limit: 1 });
  if (sigs.length === 0) return null;
  const tx = await connection.getTransaction(sigs[0].signature, { maxSupportedTransactionVersion: 0 });
  return tx?.transaction.message.staticAccountKeys[0]?.toString() ?? null;
}

export function transactionRequestHttpUrl(reference: PublicKey): string {
  return `${BASE_URL}/pay/${reference.toString()}`;
}

export function transactionRequestUrl(reference: PublicKey): string {
  return `solana:${encodeURIComponent(transactionRequestHttpUrl(reference))}`;
}

export async function qrDataUri(uri: string): Promise<string> {
  return QRCode.toDataURL(uri, { margin: 1, width: 300, errorCorrectionLevel: "L" });
}
