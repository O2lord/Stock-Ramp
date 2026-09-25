/**
 * Generate a deterministic payout reference from transaction signature
 * This ensures frontend and bot can both derive the same reference
 */
export function generatePayoutReference(
  transactionSignature: string,
  walletAddress: string
): string {
  // Use first 8 chars of wallet address
  const walletPrefix = walletAddress.slice(0, 8);
  
  // Use first 10 chars of transaction signature for uniqueness
  const sigPrefix = transactionSignature.slice(0, 10);
  
  // Format: IS-{sig_prefix}-{wallet_prefix}
  // Example: IS-3wUVFicwg5-2DdU1e5d
  return `IS-${sigPrefix}-${walletPrefix}`;
}

/**
 * Alternative: Generate from timestamp (matches bot's current behavior)
 * Less reliable but works if both use same timestamp source
 */
export function generatePayoutReferenceFromTimestamp(
  timestamp: number,
  walletAddress: string
): string {
  const walletPrefix = walletAddress.slice(0, 8);
  return `IS-${timestamp}-${walletPrefix}`;
}
