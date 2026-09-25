// client/components/StockRamp/SellOrder/InstantSellReserveDialog.tsx
// Dialog-only version of what used to be InstantSellReserveButton.tsx — see
// that file's original header comment for the full history of the Payment
// Link rework (PAYMENT_MODE.DIRECT removed, PaymentLinkDisplay step, etc.).
// That logic is unchanged here; only the trigger + pause-gate moved out to
// `InstantSellReserveButton.tsx`, mirroring trust_express's split between
// `InstantBuyDialog` and `InstantBuyButton`.
//
// UNITS: `amount` is entered in whole tokens and scaled to the mint's base
// units via lib/tokenAmount.ts::toBaseUnits before it reaches the program —
// `instant_sell_reserve` subtracts it from the order's stored `amount`, which
// is itself base units (create_sell_order.rs escrows exactly that many).
// `availableAmount` arrives already descaled for display. The `mint` prop
// exists only to look up those decimals — `instantSellReserve` resolves the
// mint account itself and takes no `mint` argument.
//
// Decimals come from `fetchMintDecimals`, which reads the mint account
// directly rather than assuming classic SPL Token — plain `getMint(connection,
// mint)` throws TokenInvalidAccountOwnerError on a Token-2022 mint, which
// most xStocks mints are.
//
// TOKEN SYMBOL: resolved via a reverse lookup against XSTOCKS_MINTS
// (lib/constant.ts) — same technique app/receipts/[id]/page.tsx uses, and
// for the same reason (these devnet mints are throwaway SPL stand-ins with
// no Metaplex metadata account, so metadata fetches aren't an option).
// PaymentLinkDisplay's `tokenSymbol` prop used to go unset here, silently
// falling back to that component's own default of "…" — every "Order
// Summary" in this dialog showed "0.01 …" instead of "0.01 AAPLx".
//
// RECEIPT MONITORING: paying the payment link is only half the trade — the
// fiat payment being confirmed (PaymentLinkDisplay's "completed" status)
// just means Flutterwave/OPay saw the money move; the taker still doesn't
// get their tokens until a validator votes and executes the on-chain
// settlement (see /api/bot/generate-sell-receipt,
// discord-bot/bot.ts::upsertSettlementReceipt). This dialog used to
// invalidate the accounts query and toast "Payment confirmed" as soon as
// PaymentLinkDisplay reported completion, then leave the taker with
// nothing — no way to tell whether tokens actually landed, no receipt.
// Once the fiat side clears, we now poll /api/receipts/by-reference/[reference]
// — the same lookup /payment-success/[reference]/page.tsx already uses — for
// the row that generate-sell-receipt inserts once a validator votes, and
// keep the dialog open on a status panel with a "View Receipt" link (to the
// same /receipts/[id] page InstantReserveDialog links to) once it shows up.
//
// This used to poll /api/receipts/by-transaction instead, filtered on
// `created_at >= since` where `since` was stamped the instant this dialog
// *learned* the payment was done (PaymentLinkDisplay's onPaymentComplete,
// which fires when payment_links.status flips to "completed"). But
// bot.ts::handleValidatorVoteExecuted inserts the receipts row (via
// upsertSettlementReceipt) *before* it calls updatePaymentLinkStatus(...,
// "completed") — the very update that unblocks onPaymentComplete. So the
// receipt's created_at was always earlier than `since`, the `since` filter
// excluded it every time, and this dialog just spun in "waiting" until it
// hit RECEIPT_MAX_POLLS and gave up — even though the receipt had existed
// in the DB the whole time (confirmed by /api/receipts/by-reference/[ref]
// finding it immediately from the payment-success tab). Looking it up by
// the exact payout_reference sidesteps the ordering/timing race entirely.
//
// ALREADY-PROCESSED FALLBACK: `instantSellReserve` can throw "This
// transaction has already been processed" when a submit is retried (wallet
// resend, flaky RPC, double-click) but the original attempt actually landed
// on-chain — the reservation, and the bot's payment link for it, already
// exist. Previously this just surfaced "Reservation failed" and stopped:
// the taker had no way to reach the payment link/receipt that was, in fact,
// already generated for their earlier attempt, since this dialog's own
// `payoutReference` state only ever holds the (never-sent) reference from
// the *failed* retry, not the original successful one. Mirrors trust_vault's
// `InstantBuyDialog.tsx::handleAlreadyProcessedError`: on that specific
// error, poll `payment_links` directly for the most recent pending/ready row
// against this order + wallet and pick up from there instead of dead-ending.

"use client";

import * as React from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import type { PublicKey } from "@solana/web3.js";
import { CheckCircle2, Clock, Loader2, Receipt, ArrowRight } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/lib/supabase/client";

import { useStockRampProgram } from "@/hooks/useStockRampProgram";
import { stockRampAccountsQueryKey } from "@/hooks/queries/useStockRampAccounts";
import { parseAnchorError } from "@/lib/parseAnchorError";
import { fetchMintDecimals, toBaseUnits } from "@/lib/tokenAmount";
import { XSTOCKS_MINTS } from "@/lib/constant";
import { decodeCurrency, PAYMENT_MODE } from "@/types/stockRamp";
import { PaymentLinkDisplay } from "@/components/StockRamp/Shared/PaymentLinkDisplay";

interface InstantSellReserveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stockRampOrder: PublicKey;
  maker: PublicKey;
  /** Mint of the token being reserved — used only to scale `amount` to base units. */
  mint: PublicKey;
  currency: number[] | Uint8Array;
  /** Available amount in WHOLE TOKENS (already descaled by the caller). */
  availableAmount: number;
  pricePerToken: number;
}

/** Row shape of the `receipts` table, as returned by
 *  /api/receipts/by-reference/[reference]. Only the fields this dialog uses. */
interface ReservationReceipt {
  id: string;
  transaction_signature: string | null;
  payout_reference: string | null;
  token_amount: string | number;
  fiat_amount: string | number;
  currency: string;
  status: string;
  created_at: string;
}

type ReceiptStatus = "idle" | "waiting" | "completed" | "timeout";

// Polling cadence for the receipt lookup once the fiat payment has cleared.
// 3s * 90 =~ 4.5 minutes, which comfortably covers validator election +
// consensus voting + settlement.
const RECEIPT_POLL_INTERVAL_MS = 3000;
const RECEIPT_MAX_POLLS = 90;

// How long to look back for an already-generated payment link on the
// "already been processed" fallback path, and how many times to retry
// before giving up (mirrors trust_vault's handleAlreadyProcessedError).
const ALREADY_PROCESSED_LOOKBACK_MS = 60_000;
const ALREADY_PROCESSED_MAX_ATTEMPTS = 10;
const ALREADY_PROCESSED_POLL_INTERVAL_MS = 2000;

function generatePayoutReferenceFromTimestamp(timestamp: number, walletAddress: string): string {
  const walletPrefix = walletAddress.slice(0, 8);
  return `IS-${timestamp}-${walletPrefix}`;
}

/** Reverse lookup of a mint address against the static xStocks map — same
 *  technique app/receipts/[id]/page.tsx uses. Falls back to "TOKEN" rather
 *  than "…" so an unresolved mint still reads as a symbol, not a stall. */
function resolveTokenSymbol(mint: PublicKey): string {
  const mintAddress = mint.toBase58();
  return Object.entries(XSTOCKS_MINTS).find(([, addr]) => addr === mintAddress)?.[0] ?? "TOKEN";
}

export function InstantSellReserveDialog({
  open,
  onOpenChange,
  stockRampOrder,
  maker,
  mint,
  currency,
  availableAmount,
  pricePerToken,
}: InstantSellReserveDialogProps) {
  const { instantSellReserve, wallet, connection } = useStockRampProgram();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [amount, setAmount] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const [payoutReference, setPayoutReference] = React.useState<string | null>(null);
  const [transactionSignature, setTransactionSignature] = React.useState<string | undefined>(undefined);

  const tokenSymbol = React.useMemo(() => resolveTokenSymbol(mint), [mint]);

  // ── Receipt monitoring (see file header) ────────────────────────────────
  const [receiptStatus, setReceiptStatus] = React.useState<ReceiptStatus>("idle");
  const [receipt, setReceipt] = React.useState<ReservationReceipt | null>(null);
  const pollTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const pollCountRef = React.useRef(0);

  // ── Already-processed fallback (see file header) ────────────────────────
  const alreadyProcessedTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  const currencyCode = decodeCurrency(currency);
  const amountNum = Number(amount) || 0;
  // price_per_token is fiat per WHOLE token, so this stays in UI units.
  const fiatAmount = Math.round(amountNum * pricePerToken);

  const stopReceiptMonitoring = React.useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const stopAlreadyProcessedPolling = React.useCallback(() => {
    if (alreadyProcessedTimerRef.current) {
      clearInterval(alreadyProcessedTimerRef.current);
      alreadyProcessedTimerRef.current = null;
    }
  }, []);

  // Stop any live intervals if the component unmounts mid-poll.
  React.useEffect(() => {
    return () => {
      stopReceiptMonitoring();
      stopAlreadyProcessedPolling();
    };
  }, [stopReceiptMonitoring, stopAlreadyProcessedPolling]);

  // Looked up by exact payout_reference — same lookup
  // /payment-success/[reference]/page.tsx already uses successfully — rather
  // than the old `since`-windowed /api/receipts/by-transaction query (see
  // file header for why that query could never match).
  const pollForReceipt = React.useCallback(async (reference: string): Promise<ReservationReceipt | null> => {
    try {
      const res = await fetch(`/api/receipts/by-reference/${encodeURIComponent(reference)}`);
      if (res.status === 404) return null; // not inserted yet — keep polling
      if (!res.ok) {
        console.error("[InstantSellReserveDialog] receipt poll returned", res.status);
        return null;
      }
      const data = await res.json();
      return data && data.id ? (data as ReservationReceipt) : null;
    } catch (err) {
      console.error("[InstantSellReserveDialog] receipt poll failed:", err);
      return null;
    }
  }, []);

  const startReceiptMonitoring = React.useCallback((reference: string) => {
    pollCountRef.current = 0;
    setReceiptStatus("waiting");

    pollTimerRef.current = setInterval(async () => {
      pollCountRef.current += 1;

      if (pollCountRef.current >= RECEIPT_MAX_POLLS) {
        stopReceiptMonitoring();
        setReceiptStatus("timeout");
        return;
      }

      const found = await pollForReceipt(reference);
      if (found) {
        stopReceiptMonitoring();
        setReceipt(found);
        setReceiptStatus("completed");
        toast({ title: "Tokens released", description: "Your receipt is ready." });
      }
    }, RECEIPT_POLL_INTERVAL_MS);
  }, [stopReceiptMonitoring, pollForReceipt, toast]);

  // On "already been processed", the reservation this component tried to
  // create almost certainly already exists on-chain from an earlier
  // (silently successful) submit — look up the payment link the bot already
  // generated for it instead of dead-ending on a "Reservation failed" toast.
  const recoverAlreadyProcessedReservation = React.useCallback(() => {
    if (!wallet) return;

    stopAlreadyProcessedPolling();
    let attempts = 0;

    toast({
      title: "Recovering your reservation",
      description: "That submit already went through — looking up your payment link.",
    });

    alreadyProcessedTimerRef.current = setInterval(async () => {
      attempts += 1;

      try {
        const { data, error } = await supabase
          .from("payment_links")
          .select("payout_reference, transaction_signature, status")
          .eq("trust_express_address", stockRampOrder.toBase58())
          .eq("buyer_address", wallet.toBase58())
          .gte("created_at", new Date(Date.now() - ALREADY_PROCESSED_LOOKBACK_MS).toISOString())
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) {
          console.error("[InstantSellReserveDialog] already-processed lookup failed:", error);
          return;
        }

        if (data?.payout_reference) {
          stopAlreadyProcessedPolling();
          setPayoutReference(data.payout_reference);
          setTransactionSignature(data.transaction_signature ?? undefined);
          queryClient.invalidateQueries({ queryKey: stockRampAccountsQueryKey() });
          toast({ title: "Found your reservation", description: "Picking up where that attempt left off." });
          return;
        }

        if (attempts >= ALREADY_PROCESSED_MAX_ATTEMPTS) {
          stopAlreadyProcessedPolling();
          toast({
            title: "Couldn't recover that reservation",
            description: "If tokens were reserved, check the Stocks page or contact support with your wallet address.",
            variant: "destructive",
          });
        }
      } catch (err) {
        console.error("[InstantSellReserveDialog] already-processed lookup threw:", err);
      }
    }, ALREADY_PROCESSED_POLL_INTERVAL_MS);
  }, [wallet, stockRampOrder, queryClient, toast, stopAlreadyProcessedPolling]);

  async function handleSubmit() {
    if (!wallet) {
      toast({ title: "Connect a wallet first", variant: "destructive" });
      return;
    }
    if (amountNum <= 0 || amountNum > availableAmount) {
      toast({ title: "Invalid amount", description: `Enter between 0 and ${availableAmount}.`, variant: "destructive" });
      return;
    }

    setIsSubmitting(true);
    try {
      const decimals = await fetchMintDecimals(connection, mint);
      const rawAmount = toBaseUnits(amountNum, decimals);

      // Guard against an amount small enough to round to 0 base units, which
      // the program would reject with InvalidAmount.
      if (rawAmount.isZero()) {
        toast({
          title: "Amount too small",
          description: `The smallest amount this token supports is ${10 ** -decimals}.`,
          variant: "destructive",
        });
        return;
      }

      const reference = generatePayoutReferenceFromTimestamp(Date.now(), wallet.toBase58());

      const result = await instantSellReserve({
        stockRampOrder,
        maker,
        amount: rawAmount,
        paymentMode: PAYMENT_MODE.LINK,
        buyerPayoutDetails: null,
        payoutReference: reference,
      });

      setTransactionSignature(result);
      setPayoutReference(reference);

      queryClient.invalidateQueries({ queryKey: stockRampAccountsQueryKey() });
      toast({ title: "Reservation created", description: `Generating your payment link for ${fiatAmount} ${currencyCode}...` });
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      if (/already\s+(been\s+)?processed/i.test(raw)) {
        recoverAlreadyProcessedReservation();
      } else {
        const parsed = parseAnchorError(err);
        toast({ title: "Reservation failed", description: parsed.message, variant: "destructive" });
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  function resetAndClose(nextOpen: boolean) {
    onOpenChange(nextOpen);
    if (!nextOpen) {
      stopReceiptMonitoring();
      stopAlreadyProcessedPolling();
      setAmount("");
      setPayoutReference(null);
      setTransactionSignature(undefined);
      setReceiptStatus("idle");
      setReceipt(null);
    }
  }

  const isWaitingOnReceipt = receiptStatus !== "idle";

  return (
    <Dialog open={open} onOpenChange={resetAndClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{payoutReference ? "Complete your payment" : "Reserve tokens from this sell order"}</DialogTitle>
          <DialogDescription>
            {isWaitingOnReceipt
              ? "Waiting for a validator to confirm and release your tokens on-chain."
              : payoutReference
              ? "Pay the maker via the link below — tokens release automatically once a validator confirms payment."
              : "You'll owe the seller fiat via a payment link, then a validator releases the tokens once payment is confirmed."}
          </DialogDescription>
        </DialogHeader>

        {isWaitingOnReceipt ? (
          <div className="space-y-4">
            <div className="rounded-md border border-border p-4">
              <div className="flex items-center justify-between text-sm mb-3">
                <span className="text-muted-foreground">You paid</span>
                <span className="font-medium text-foreground">
                  {fiatAmount} {currencyCode}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm mb-4">
                <span className="text-muted-foreground">You'll receive</span>
                <span className="font-medium text-foreground">
                  {amountNum} {tokenSymbol}
                </span>
              </div>

              {receiptStatus === "waiting" && (
                <div className="flex items-center gap-3">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  <div className="text-sm text-foreground">
                    <p className="font-medium">Waiting for validator confirmation</p>
                    <p className="text-xs text-muted-foreground">
                      A validator needs to confirm and release your tokens on-chain. This can take a minute or two.
                    </p>
                  </div>
                </div>
              )}

              {receiptStatus === "completed" && receipt && (
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 text-up mt-0.5" />
                  <div className="text-sm text-foreground">
                    <p className="font-medium">Tokens released</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Receipt ID: <span className="font-mono">{receipt.id}</span>
                    </p>
                    {receipt.transaction_signature && (
                      <p className="text-xs text-muted-foreground">
                        Tx: <span className="font-mono">{receipt.transaction_signature.slice(0, 8)}…{receipt.transaction_signature.slice(-8)}</span>
                      </p>
                    )}
                    <Link
                      href={`/receipts/${receipt.id}`}
                      className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-foreground underline"
                    >
                      View full receipt <ArrowRight className="h-3 w-3" />
                    </Link>
                  </div>
                </div>
              )}

              {receiptStatus === "timeout" && (
                <div className="flex items-start gap-3">
                  <Clock className="h-5 w-5 text-primary mt-0.5" />
                  <div className="text-sm text-foreground">
                    <p className="font-medium">Still processing</p>
                    <p className="text-xs text-muted-foreground">
                      This is taking longer than expected. Your payment was confirmed — check back shortly for your receipt.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {receiptStatus === "completed" && receipt && (
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Receipt className="h-3.5 w-3.5" />
                Keep the receipt ID above for your records.
              </p>
            )}
          </div>
        ) : payoutReference ? (
          <PaymentLinkDisplay
            payoutReference={payoutReference}
            transactionSignature={transactionSignature}
            stockRampOrder={stockRampOrder.toBase58()}
            tokenSymbol={tokenSymbol}
            tokenAmount={amountNum}
            fiatAmount={fiatAmount}
            currency={currencyCode}
            onPaymentLinkReady={() => {
              queryClient.invalidateQueries({ queryKey: stockRampAccountsQueryKey() });
            }}
            onPaymentComplete={() => {
              queryClient.invalidateQueries({ queryKey: stockRampAccountsQueryKey() });
              toast({ title: "Payment confirmed", description: "Tokens will release once a validator submits the vote." });
              // Fiat side is done — now wait for on-chain settlement and
              // surface the receipt once it lands (see file header). Look
              // it up by the exact payout_reference we already have, not a
              // `since` timestamp — the receipt row can (and typically
              // does) already exist by the time this callback fires.
              if (payoutReference) startReceiptMonitoring(payoutReference);
            }}
            onBack={() => resetAndClose(false)}
          />
        ) : (
          <>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Amount (max {availableAmount})</Label>
                <Input
                  type="number"
                  step="any"
                  max={availableAmount}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                />
                <p className="text-xs text-[#0F0D0A]/50">
                  You'll owe ≈ {fiatAmount} {currencyCode}, payable via a hosted payment link
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => resetAndClose(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={handleSubmit} disabled={isSubmitting}>
                {isSubmitting ? "Reserving..." : "Confirm reservation"}
              </Button>
            </DialogFooter>
          </>
        )}

        {isWaitingOnReceipt && (
          <DialogFooter>
            {receiptStatus === "completed" && receipt ? (
              <>
                <Button type="button" variant="outline" asChild>
                  <Link href={`/receipts/${receipt.id}`}>View Receipt</Link>
                </Button>
                <Button type="button" onClick={() => resetAndClose(false)}>
                  Done
                </Button>
              </>
            ) : (
              <Button
                type="button"
                onClick={() => resetAndClose(false)}
                disabled={receiptStatus === "waiting"}
              >
                {receiptStatus === "timeout" ? "Done" : "Waiting..."}
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
