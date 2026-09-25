// client/app/receipts/[id]/page.tsx
// Standalone settlement-receipt page. Linked from
// InstantReserveDialog.tsx once /api/receipts/by-transaction finds a row —
// this is the "View Receipt" destination that dialog's inline summary used
// to have nowhere to send the taker.
//
// Adapted from trust_vault's app/(dashboard)/receipts/[id]/page.tsx, with
// four deliberate differences:
//   1. Styling uses this app's own Terminal design tokens (bg-surface-1,
//      text-muted-foreground, etc. — see app/globals.css) instead of
//      trust_vault's hardcoded cream/orange hex palette. globals.css is
//      explicit that components must not hardcode colors.
//   2. No fee row: /api/bot/generate-sell-receipt (this repo's pending-
//      receipt insert route) doesn't write `fee_amount` onto the row, and
//      neither does bot.ts's upsertSettlementReceipt — this repo's
//      `receipts` table has no fee_amount column at all (see
//      supabase/migrations/0003_stock_ramp_operational_tables.sql), unlike
//      trust_vault's. Rendered only if present would still be misleading
//      here since it can never be present; dropped entirely instead.
//   3. Token symbol comes from a reverse lookup against XSTOCKS_MINTS
//      (lib/constant.ts) instead of reading Metaplex metadata off-chain —
//      these devnet mints are throwaway SPL stand-ins with no metadata
//      account, so a metadata fetch would just fail silently every time.
//   4. Buy vs. sell detection: same signal as trust_vault (presence of an
//      `account_number` means fiat was paid out to a bank account, which
//      only happens for a sell order — see bot.ts's upsertSettlementReceipt,
//      which only ever populates account_number/bank_name/beneficiary_name
//      from the reservation's on-chain payoutDetails, and that field is
//      only ever set on SELL reservations). Previously this page hardcoded
//      "Buy Order · Fiat → Token" unconditionally — this repo's receipts
//      insert route is literally named generate-sell-receipt and there is
//      no buy-receipt equivalent for the pending-row path, so every one of
//      these receipts was mislabeled.
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { PublicKey } from "@solana/web3.js";
import { CheckCircle2, AlertCircle, ExternalLink, Printer, ArrowLeft, Clock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { connection } from "@/lib/client";
import { fetchMintDecimals, formatTokenAmount } from "@/lib/tokenAmount";
import { XSTOCKS_MINTS } from "@/lib/constant";

interface Receipt {
  id: string;
  payout_reference: string | null;
  transaction_signature: string | null;
  taker_address: string;
  maker_address: string;
  token_amount: string | number;
  fiat_amount: string | number;
  currency: string;
  status: string;
  payout_method: string | null;
  mint_address: string | null;
  /** Legacy column name (shared schema with trust_vault) — actually holds
   *  the StockRampOrder PDA for this repo. See generate-sell-receipt. */
  trust_express_address: string;
  created_at: string;
  // Only ever populated on sell orders — see bot.ts's
  // upsertSettlementReceipt, which sources these from the reservation's
  // on-chain payoutDetails (bank payout instructions). A buy order has no
  // bank payout, so these stay null and that's exactly how we tell the
  // two apart (isSellOrder below).
  account_number?: string | null;
  bank_name?: string | null;
  beneficiary_name?: string | null;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  NGN: "₦",
  KES: "KSh",
  GHS: "₵",
  ZAR: "R",
  UGX: "USh",
  TZS: "TSh",
  USD: "$",
};

function isSuccess(status: string) {
  return status === "success" || status === "completed";
}

/** A sell order pays fiat out to a bank account; a buy order never does. */
function isSellOrder(r: Receipt): boolean {
  return !!r.account_number;
}

export default function ReceiptPage() {
  const params = useParams<{ id: string }>();
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [decimals, setDecimals] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`/api/receipts/${params.id}`);
        if (!res.ok) {
          if (!cancelled) setNotFound(true);
          return;
        }
        const data = (await res.json()) as Receipt;
        if (!cancelled) setReceipt(data);
      } catch (err) {
        console.error("[receipt page] failed to fetch receipt:", err);
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [params.id]);

  useEffect(() => {
    if (!receipt?.mint_address) return;
    let cancelled = false;

    fetchMintDecimals(connection, new PublicKey(receipt.mint_address))
      .then((d) => {
        if (!cancelled) setDecimals(d);
      })
      .catch((err) => {
        console.warn("[receipt page] could not fetch mint decimals:", err);
        if (!cancelled) setDecimals(6);
      });

    return () => {
      cancelled = true;
    };
  }, [receipt?.mint_address]);

  const tokenSymbol = receipt?.mint_address
    ? Object.entries(XSTOCKS_MINTS).find(([, addr]) => addr === receipt.mint_address)?.[0] ?? "TOKEN"
    : "TOKEN";

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading receipt…</p>
        </div>
      </div>
    );
  }

  if (notFound || !receipt) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <AlertCircle className="mx-auto mb-3 h-10 w-10 text-destructive" />
          <p className="text-sm font-bold text-foreground">Receipt not found</p>
          <Link href="/stocks" className="mt-2 block text-xs text-muted-foreground underline">
            Back to Stocks
          </Link>
        </div>
      </div>
    );
  }

  const success = isSuccess(receipt.status);
  const sellOrder = isSellOrder(receipt);
  const currencySymbol = CURRENCY_SYMBOLS[receipt.currency] ?? receipt.currency;
  const tokenAmountDisplay =
    decimals !== null ? formatTokenAmount(receipt.token_amount, decimals) : "…";
  const fiatAmountDisplay = Number(receipt.fiat_amount).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });

  return (
    <div className="container mx-auto max-w-md px-4 py-8 sm:px-8">
      <Link
        href="/stocks"
        className="mb-6 inline-flex items-center gap-1.5 text-xs text-muted-foreground no-underline transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Stocks
      </Link>

      <div className="rounded-lg border border-border bg-surface-1">
        {/* Header */}
        <div className="border-b border-border px-6 py-5 text-center">
          <p className="text-lg font-bold tracking-tight text-foreground">Transaction Receipt</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {sellOrder ? "Sell Order · Token → Fiat" : "Buy Order · Fiat → Token"}
          </p>
        </div>

        {/* Status */}
        <div className="flex items-center justify-between px-6 pt-5">
          <span className="text-xs text-muted-foreground">Status</span>
          <span
            className={`rounded-md px-3 py-1 text-xs font-bold uppercase tracking-wider ${
              success ? "bg-up/10 text-up" : "bg-primary/10 text-primary"
            }`}
          >
            {receipt.status.toUpperCase()}
          </span>
        </div>

        {/* Key amounts */}
        <div className="flex items-center gap-2 px-6 py-4">
          <div className="flex-1 rounded-md bg-surface-2 px-4 py-3">
            <p className="mb-0.5 text-xs text-muted-foreground">{sellOrder ? "Tokens sold" : "You reserved"}</p>
            {sellOrder ? (
              <p className="text-base font-bold tabular text-foreground">
                {tokenAmountDisplay} <span className="text-xs text-muted-foreground">{tokenSymbol}</span>
              </p>
            ) : (
              <p className="text-base font-bold tabular text-foreground">
                {currencySymbol}
                {fiatAmountDisplay}
              </p>
            )}
          </div>
          <div className="flex-shrink-0 text-sm font-bold text-primary">→</div>
          <div className="flex-1 rounded-md bg-surface-2 px-4 py-3">
            <p className="mb-0.5 text-xs text-muted-foreground">{sellOrder ? "Fiat received" : "You received"}</p>
            {sellOrder ? (
              <p className="text-base font-bold tabular text-foreground">
                {currencySymbol}
                {fiatAmountDisplay}
              </p>
            ) : (
              <p className="text-base font-bold tabular text-foreground">
                {tokenAmountDisplay} <span className="text-xs text-muted-foreground">{tokenSymbol}</span>
              </p>
            )}
          </div>
        </div>

        {/* Details */}
        <div className="border-t border-border px-6 pb-5">
          <Row label="Receipt ID" value={receipt.id} mono truncate />
          <Row label="Date" value={new Date(receipt.created_at).toLocaleString()} />
          {receipt.payout_reference && (
            <Row label="Reference" value={receipt.payout_reference} mono truncate />
          )}

          {/* Sell orders pay fiat out to a bank account — surface those
              details here. Buy orders never populate these columns. */}
          {sellOrder && (
            <>
              {receipt.beneficiary_name && <Row label="Recipient" value={receipt.beneficiary_name} />}
              {receipt.account_number && <Row label="Account No" value={receipt.account_number} mono />}
              {receipt.bank_name && <Row label="Bank" value={receipt.bank_name} />}
            </>
          )}

          <div className="flex items-start justify-between gap-4 border-b border-border py-2.5">
            <span className="flex-shrink-0 text-xs text-muted-foreground">Transaction:</span>
            {receipt.transaction_signature ? (
              <a
                href={`https://explorer.solana.com/tx/${receipt.transaction_signature}?cluster=devnet`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-primary hover:underline"
              >
                View on Explorer <ExternalLink className="h-3 w-3" />
              </a>
            ) : (
              <span className="text-xs text-muted-foreground">—</span>
            )}
          </div>
        </div>

        {!success && (
          <div className="flex items-start gap-2 border-t border-border px-6 py-3 text-xs text-muted-foreground">
            <Clock className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            <span>
              This receipt&apos;s status is still <span className="font-medium">{receipt.status}</span> — refresh this
              page if you&apos;re expecting an update.
            </span>
          </div>
        )}

        {/* Footer actions */}
        <div className="flex gap-3 border-t border-border px-6 py-4">
          <Button variant="outline" size="default" className="flex-1" onClick={() => window.print()}>
            <Printer className="mr-2 h-3.5 w-3.5" /> Print
          </Button>
          <Button asChild size="default" className="flex-1">
            <Link href="/stocks">
              <CheckCircle2 className="mr-2 h-3.5 w-3.5" /> Done
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  mono = false,
  truncate = false,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
  truncate?: boolean;
}) {
  const display = value ? value : "—";
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border py-2.5">
      <span className="flex-shrink-0 text-xs text-muted-foreground">{label}:</span>
      <span
        className={`text-right text-xs text-foreground ${mono ? "font-mono" : ""} ${
          truncate ? "max-w-[200px] truncate" : ""
        }`}
      >
        {display}
      </span>
    </div>
  );
}
