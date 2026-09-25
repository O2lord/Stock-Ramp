// client/lib/verifyTxSigner.ts
// Shared helper for the admin register-validator / remove-validator routes:
// given a transaction signature the client claims belongs to a given admin
// wallet, independently fetch that transaction from the RPC and confirm (a)
// it actually landed successfully and (b) the claimed admin pubkey was one
// of its signers. This is what stops a client from just POSTing an
// arbitrary adminPubkey in the request body — the server never trusts that
// field on its own, exactly like Trust Vault's register-validator route
// re-derives authority from on-chain state rather than the request body.
import { Connection, PublicKey } from "@solana/web3.js";

export interface TxSignerCheckResult {
  ok: boolean;
  error?: string;
}

export async function verifyTxSignedBy(
  connection: Connection,
  txSignature: string,
  claimedSigner: string
): Promise<TxSignerCheckResult> {
  let signerKey: PublicKey;
  try {
    signerKey = new PublicKey(claimedSigner);
  } catch {
    return { ok: false, error: "Invalid signer public key" };
  }

  const tx = await connection.getTransaction(txSignature, {
    maxSupportedTransactionVersion: 0,
    commitment: "confirmed",
  });

  if (!tx) {
    return { ok: false, error: "Transaction not found (not yet confirmed, or invalid signature)" };
  }
  if (tx.meta?.err) {
    return { ok: false, error: "Transaction failed on-chain" };
  }

  const accountKeys = tx.transaction.message.getAccountKeys({
    accountKeysFromLookups: tx.meta?.loadedAddresses,
  });
  const numRequiredSignatures = tx.transaction.message.header.numRequiredSignatures;

  let signerIndex = -1;
  for (let i = 0; i < numRequiredSignatures; i++) {
    const key = accountKeys.get(i);
    if (key && key.equals(signerKey)) {
      signerIndex = i;
      break;
    }
  }

  if (signerIndex === -1) {
    return { ok: false, error: "Claimed signer did not sign this transaction" };
  }

  return { ok: true };
}
