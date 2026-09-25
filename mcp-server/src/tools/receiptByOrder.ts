// Manual fallback for widget cards' "Check now" button, in case the
// Supabase Realtime socket never connects or drops. Mirrors the Realtime
// subscription's own trust boundary exactly -- filtered on
// trust_express_address (+ fiat amount + currency), same as the widget's
// channel filter -- rather than a stricter filter the primary path doesn't have.
//
// Column is `trust_express_address`, not a renamed `stock_ramp_order_address`
// -- confirmed against discord-bot/bot.ts's actual insert calls. Never
// renamed when the rest of the codebase moved to StockRamp naming.
//
// When known, signerAddress (resolved via a Solana Pay reference — see
// solanaPay.ts's findSignerByReference) narrows the match to that specific
// payer, closing the multi-taker collision gap a shared order can otherwise
// have. When signerAddress is known we match on it alone (plus order +
// currency + success) rather than ANDing in fiat_amount too -- taker wallet
// is already a strong unique key for "this specific reservation", and an
// exact-equality amount filter is fragile: reserveBuyOrder.ts computes its
// display amount as amount * pricePerToken (a float) while the on-chain
// reservation stores Math.round() of that same value (see
// client/app/api/solana-pay/instant-reserve/route.ts). The two are kept in
// sync today, but a strict .eq() here has no tolerance for any future
// rounding drift between them -- a real successful payout could again
// silently never match. When signerAddress isn't known yet, fiat_amount is
// still used to narrow candidates, but rounded and compared with a small
// tolerance rather than exact equality.
import { supabase } from "../supabase.js";
import type { ReceiptRecord } from "./receipt.js";

export async function getReceiptByOrder(args: {
  orderAddress: string;
  fiatAmount: number;
  currency: string;
  signerAddress?: string;
}): Promise<{ found: boolean; receipt?: ReceiptRecord }> {
  let query = supabase
    .from("receipts")
    .select("*")
    .eq("trust_express_address", args.orderAddress)
    .eq("status", "success")
    .eq("currency", args.currency);

  if (args.signerAddress) {
    query = query.eq("taker_address", args.signerAddress);
  }

  const { data, error } = await query.order("created_at", { ascending: false }).limit(5);

  if (error) throw new Error(`Supabase receipts query failed: ${error.message}`);
  if (!data || data.length === 0) return { found: false };

  // Without a signer to narrow by, fall back to a tolerant amount match
  // (rounded, +/- 1 unit) instead of requiring bit-for-bit float equality.
  const row = args.signerAddress
    ? data[0]
    : data.find((r) => Math.abs(Math.round(Number(r.fiat_amount)) - Math.round(args.fiatAmount)) <= 1);

  if (!row) return { found: false };

  return {
    found: true,
    receipt: {
      id: row.id,
      payoutReference: row.payout_reference,
      transactionSignature: row.transaction_signature,
      fiatAmount: row.fiat_amount,
      currency: row.currency,
      tokenAmount: row.token_amount,
      feeAmount: row.fee_amount,
      bankName: row.payout_details?.bank_name ?? row.bank_name ?? null,
      accountNumber: row.payout_details?.account_number ?? row.account_number ?? null,
      beneficiaryName: row.payout_details?.beneficiary_name ?? row.beneficiary_name ?? null,
      status: row.status,
      createdAt: row.created_at,
      receiptUrl: row.receipt_url ?? null,
    },
  };
}
