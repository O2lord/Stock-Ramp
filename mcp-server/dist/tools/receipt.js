import { supabase } from "../supabase.js";
function mapRow(row) {
    const payoutDetails = row.payout_details ?? {};
    const APP_URL = process.env.NEXT_PUBLIC_APP_URL;
    const fallbackReceiptUrl = APP_URL ? `${APP_URL.replace(/\/+$/, "")}/receipts/${row.id}` : null;
    return {
        id: row.id,
        payoutReference: row.payout_reference,
        transactionSignature: row.transaction_signature,
        fiatAmount: row.fiat_amount,
        currency: row.currency,
        tokenAmount: row.token_amount,
        feeAmount: row.fee_amount,
        bankName: payoutDetails.bank_name ?? row.bank_name ?? null,
        accountNumber: payoutDetails.account_number ?? row.account_number ?? null,
        beneficiaryName: payoutDetails.beneficiary_name ?? row.beneficiary_name ?? null,
        status: row.status,
        createdAt: row.created_at,
        receiptUrl: row.receipt_url ?? fallbackReceiptUrl,
    };
}
/**
 * The actual success oracle -- a row here ONLY exists after a verified
 * successful transfer. Absence of a reservation on-chain is NOT sufficient
 * to claim success on its own (see submit_vote.rs: both success and
 * rejection remove the reservation entry the same way) -- this is.
 *
 * DB column is `trust_express_address` -- confirmed against discord-bot/
 * bot.ts's actual insert calls (generateValidatorSettlementReceipt,
 * storePaymentLinkInDB). The column was never renamed when the rest of the
 * codebase moved from Trust Vault to StockRamp naming, so this stays
 * unrenamed to match what the bot actually writes -- the TS-facing
 * function arg name (stockRampOrderAddress) is unaffected, only the raw
 * column string in .eq() matters here.
 */
export async function findReceipt(args) {
    const { data, error } = await supabase
        .from("receipts")
        .select("*")
        .eq("trust_express_address", args.stockRampOrderAddress)
        .eq("taker_address", args.takerAddress)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    if (error)
        throw new Error(`Supabase receipts query failed: ${error.message}`);
    if (!data)
        return null;
    // A "pending" row with null transaction_signature must NOT be reported
    // as a match here -- only exactly "success" + a populated signature.
    if (data.status !== "success" || !data.transaction_signature) {
        return null;
    }
    return mapRow(data);
}
export async function getReceiptByReference(payoutReference) {
    const { data, error } = await supabase
        .from("receipts")
        .select("*")
        .eq("payout_reference", payoutReference)
        .maybeSingle();
    if (error)
        throw new Error(`Supabase receipts query failed: ${error.message}`);
    return data ? mapRow(data) : null;
}
