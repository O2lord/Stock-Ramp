// client/components/StockRamp/BuyOrder/InstantReserveDialog.tsx
// Taker-side reservation against someone's buy order: send tokens into the
// order's escrow ATA now, get paid fiat by the maker once a validator
// confirms. Wraps `instant_reserve.rs`.
//
// UNITS: `amount` is entered in whole tokens (e.g. "0.1") and scaled to the
// mint's base units via lib/tokenAmount.ts::toBaseUnits before it reaches the
// program — `instant_reserve` transfers exactly this many base units and then
// does `stock_ramp_order.amount.checked_sub(amount)`. `availableAmount` comes
// in already descaled for display, so the max-check below compares
// whole tokens against whole tokens.
//
// This side was always scaled correctly; the AnchorError 6017
// ArithmeticOverflow seen here came from the *other* side of that subtraction
// — CreateBuyDialog stored the order's `amount` unscaled, so 0.1 token
// (100_000 base units) underflowed an order recorded as "1". Both sides now
// go through lib/tokenAmount.ts.
//
// Decimals come from `fetchMintDecimals`, which reads the mint account
// directly instead of `getMint(..., TOKEN_PROGRAM_ID)` — that threw
// TokenInvalidAccountOwnerError on every Token-2022 xStocks mint and needed a
// second fallback call to recover.
//
// PAYOUT DETAILS: this used to be a single optional free-text field, which
// meant a taker could submit with no payout route at all — the on-chain
// reservation would carry `payout_details = None`, and the elected executor
// validator would fail with "Missing payout_details on event" and vote NO
// immediately (see /api/initiate-buy-payout, which requires
// `payoutDetails.account_number` to route the fiat). This is now a required,
// structured, Flutterwave-verified bank-account form — ported from
// trust_vault's InstantPayDialog.tsx — that always serializes to the
// `PayoutBankDetails` shape `lib/paymentProcessors/payout.ts` expects:
// { account_number, bank_code, beneficiary_name }.
//
// BANK LIST DEDUPE: Flutterwave's `/v3/banks/{country}` endpoint (proxied via
// /api/flutterwave/banks) can return multiple entries that share the same
// `code` — this is especially common for Nigeria's mobile-money/microfinance
// banks (e.g. duplicate rows for the same 6-digit NIP code under slightly
// different `id`/`name`). Since the picker below keys and values each
// SelectItem by `bank.code`, un-deduped duplicates produced React's
// "Encountered two children with the same key" warning (seen with codes like
// "090567"). `banks` below is deduped by `code`, keeping the first entry
// seen for each code, since `bank_code` — not `id` — is what's actually sent
// to the verify-account/payout APIs. Distinct codes can still legitimately
// share the same display name (e.g. two "ZenithMobile" rows) — those aren't
// deduped away (that would silently make one bank_code unreachable), but the
// name is disambiguated with "(code)" appended so the list doesn't show two
// identical, unselectable-looking rows.
//
// BANK SEARCH: Nigeria alone has 200+ entries in this list. A plain
// unfiltered <Select> renders every option at once (Radix flips it to open
// upward, filling the whole viewport above the trigger — see the reservation
// dialog screenshot that prompted this). A search box inside SelectContent
// filters the option list client-side by name; it's a plain input, not a
// Radix-native combobox, so keydown events are stopped from bubbling into
// Select's own typeahead handling.
//
// RECEIPT MONITORING: reserving tokens is only half the trade — the maker
// still has to pay out fiat, which happens off-chain, asynchronously, once
// a validator is elected and votes YES (see /api/bot/elect-executor,
// /api/initiate-buy-payout, /api/bot/generate-sell-receipt). The dialog used
// to invalidate the accounts query and close immediately after
// `instantReserve()` resolved, which only confirms the taker's OWN deposit
// transaction — it told the taker nothing about whether they'd actually get
// paid. Ported from trust_vault's InstantPayDialog.tsx::startTransactionMonitoring:
// once the reservation lands, we poll /api/receipts/by-transaction for the row
// that /api/bot/generate-sell-receipt inserts once a validator votes YES, and
// keep the dialog open with a status panel until either a receipt shows up or
// polling times out. We still watch the order account for changes as a UI
// hint to move from "processing" to "generating receipt" sooner, but — unlike
// trust_vault, which had no other way to know a payout was in flight — we
// don't gate polling on that listener firing: sendAndConfirmWithLogging above
// already notes devnet's account-change websocket can drop, and polling is
// what actually finds the receipt regardless.
//
// Once a receipt shows up, "View Receipt" below links to the standalone
// /receipts/[id] page (app/receipts/[id]/page.tsx) — trust_vault has one of
// these too; this repo didn't until now.
//
// STYLING: the "waiting on payout" status panel below used hardcoded
// #0F0D0A hex values (text-[#0F0D0A]/60, border-[rgba(15,13,10,0.12)], etc.)
// instead of this app's semantic tokens. globals.css is explicit that
// components must consume tokens (bg-surface-1, text-foreground,
// border-border, text-muted-foreground, ...) and must not hardcode colors —
// the hex values here predated that rule being enforced and have been
// swapped for the same tokens the new /receipts/[id] page uses, so the panel
// and the page it links to are visually consistent (and respect light/dark
// mode, which the hardcoded hex did not).

"use client";

import * as React from "react";
import Link from "next/link";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { CheckCircle2, AlertCircle, Loader2, Search, Clock, Receipt, ArrowRight } from "lucide-react";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/react-select";
import { useToast } from "@/components/ui/use-toast";

import { useStockRampProgram } from "@/hooks/useStockRampProgram";
import { stockRampAccountsQueryKey } from "@/hooks/queries/useStockRampAccounts";
import { parseAnchorError } from "@/lib/parseAnchorError";
import { fetchMintDecimals, toBaseUnits } from "@/lib/tokenAmount";
import { decodeCurrency } from "@/types/stockRamp";

interface InstantReserveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stockRampOrder: PublicKey;
  maker: PublicKey;
  mint: PublicKey;
  currency: number[] | Uint8Array;
  /** Available amount in WHOLE TOKENS (already descaled by the caller). */
  availableAmount: number;
  pricePerToken: number;
}

interface Bank {
  id: number;
  code: string;
  name: string;
}

/** Row shape of the `receipts` table, as returned by
 *  /api/receipts/by-transaction. Only the fields this dialog uses. */
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

type PaymentStatus =
  | "idle"
  | "processing"
  | "generating_receipt"
  | "completed"
  | "timeout";

/** Currencies with a Flutterwave bank list + account-resolve endpoint.
 *  Mirrors trust_vault's InstantPayDialog.tsx currencyToCountryMap. */
const CURRENCY_TO_COUNTRY: Record<string, string> = {
  NGN: "NG",
  GHS: "GH",
  KES: "KE",
  UGX: "UG",
  TZS: "TZ",
  ZAR: "ZA",
};

// Polling cadence for the receipt lookup once a reservation has landed.
// 3s * 90 =~ 4.5 minutes, which comfortably covers validator election +
// consensus voting + the Flutterwave payout call (see /api/initiate-buy-payout).
const RECEIPT_POLL_INTERVAL_MS = 3000;
const RECEIPT_MAX_POLLS = 90;

export function InstantReserveDialog({
  open,
  onOpenChange,
  stockRampOrder,
  maker,
  mint,
  currency,
  availableAmount,
  pricePerToken,
}: InstantReserveDialogProps) {
  const { instantReserve, wallet, connection } = useStockRampProgram();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const currencyCode = decodeCurrency(currency);
  const country = CURRENCY_TO_COUNTRY[currencyCode];
  const supportsBankLookup = Boolean(country);

  const [amount, setAmount] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  // ── Payout details (structured — see file header) ─────────────────────
  const [bankCode, setBankCode] = React.useState("");
  const [accountNumber, setAccountNumber] = React.useState("");
  const [beneficiaryName, setBeneficiaryName] = React.useState("");
  const [verificationStatus, setVerificationStatus] =
    React.useState<"idle" | "loading" | "success" | "error">("idle");
  const [verificationError, setVerificationError] = React.useState<string | null>(null);
  const [verifiedAccountName, setVerifiedAccountName] = React.useState<string | null>(null);
  const [lastVerified, setLastVerified] = React.useState<{ accountNumber: string; bankCode: string } | null>(null);

  // ── Receipt monitoring (see file header) ────────────────────────────────
  const [paymentStatus, setPaymentStatus] = React.useState<PaymentStatus>("idle");
  const [receipt, setReceipt] = React.useState<ReservationReceipt | null>(null);
  const [reservedSummary, setReservedSummary] = React.useState<{ amount: number; fiat: number; currency: string } | null>(null);
  const pollTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const pollCountRef = React.useRef(0);
  const subscriptionIdRef = React.useRef<number | null>(null);

  const amountNum = Number(amount) || 0;
  // price_per_token is fiat per WHOLE token, so this stays in UI units.
  const fiatAmount = Math.round(amountNum * pricePerToken);

  // ── Bank list for the taker's currency ─────────────────────────────────
  const { data: banksData, isLoading: banksLoading, error: banksError } = useQuery({
    queryKey: ["flutterwave-banks", country],
    queryFn: async () => {
      const res = await fetch(`/api/flutterwave/banks?country=${country}`);
      if (!res.ok) throw new Error("Failed to fetch banks");
      return res.json() as Promise<{ banks: Bank[] }>;
    },
    enabled: open && supportsBankLookup,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const banks = React.useMemo(() => {
    const raw = banksData?.banks ?? [];
    // De-dupe by `code` — Flutterwave's bank list can contain multiple rows
    // for the same NIP code (see file header). Keep the first occurrence of
    // each code so the picker's keys/values stay unique.
    const seen = new Set<string>();
    const deduped: Bank[] = [];
    for (const bank of raw) {
      if (seen.has(bank.code)) continue;
      seen.add(bank.code);
      deduped.push(bank);
    }
    const sorted = deduped.sort((a, b) => a.name.localeCompare(b.name));

    // Distinct codes can still share the exact same display name (e.g. two
    // "ZenithMobile" rows for different NIP codes) — that's a genuinely
    // different bank_code sent to Flutterwave, so we can't drop either one,
    // but showing the same label twice with no way to tell them apart is
    // just confusing. Append the code to disambiguate only the names that
    // collide.
    const nameCounts = new Map<string, number>();
    for (const bank of sorted) {
      nameCounts.set(bank.name, (nameCounts.get(bank.name) ?? 0) + 1);
    }
    return sorted.map((bank) =>
      (nameCounts.get(bank.name) ?? 0) > 1
        ? { ...bank, name: `${bank.name} (${bank.code})` }
        : bank
    );
  }, [banksData?.banks]);

  // ── Bank search — 200+ unfiltered options is unusable as a plain list ───
  const [bankSearch, setBankSearch] = React.useState("");
  const filteredBanks = React.useMemo(() => {
    const q = bankSearch.trim().toLowerCase();
    if (!q) return banks;
    return banks.filter((bank) => bank.name.toLowerCase().includes(q));
  }, [banks, bankSearch]);

  React.useEffect(() => {
    if (banksError) {
      toast({ title: "Couldn't load banks", description: "You can still enter your bank details manually below.", variant: "destructive" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [banksError]);

  // ── Debounced account verification ──────────────────────────────────────
  const verifyAccount = React.useCallback(
    async (accNum: string, bCode: string) => {
      if (!accNum || !bCode || !supportsBankLookup) return;
      if (lastVerified && lastVerified.accountNumber === accNum && lastVerified.bankCode === bCode) return;

      setVerificationStatus("loading");
      setVerificationError(null);

      try {
        const res = await fetch("/api/flutterwave/verify-account", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ account_number: accNum.trim(), account_bank: bCode.trim() }),
        });
        const data = await res.json();

        if (data.success && data.account_name) {
          setVerifiedAccountName(data.account_name);
          setVerificationStatus("success");
          setLastVerified({ accountNumber: accNum, bankCode: bCode });
          if (!beneficiaryName) setBeneficiaryName(data.account_name);
        } else {
          setVerificationStatus("error");
          setVerificationError(data.error ?? "Could not verify account");
          setVerifiedAccountName(null);
        }
      } catch {
        setVerificationStatus("error");
        setVerificationError("Network error verifying account");
        setVerifiedAccountName(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [supportsBankLookup, lastVerified, beneficiaryName]
  );

  React.useEffect(() => {
    if (!accountNumber || !bankCode || !supportsBankLookup) {
      setVerificationStatus("idle");
      setVerifiedAccountName(null);
      setVerificationError(null);
      return;
    }
    const t = setTimeout(() => verifyAccount(accountNumber, bankCode), 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountNumber, bankCode, supportsBankLookup]);

  // Manual-entry currencies (no bank list/verification available) just need
  // the three fields non-empty — payout_details must never be null, but we
  // can't verify a bank we don't have a lookup for.
  const payoutDetailsComplete = supportsBankLookup
    ? verificationStatus === "success" && Boolean(beneficiaryName.trim())
    : Boolean(bankCode.trim() && accountNumber.trim() && beneficiaryName.trim());

  // ── Receipt monitoring helpers ───────────────────────────────────────────
  const stopReceiptMonitoring = React.useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (subscriptionIdRef.current !== null) {
      connection.removeAccountChangeListener(subscriptionIdRef.current).catch(() => {});
      subscriptionIdRef.current = null;
    }
  }, [connection]);

  // Stop any live listener/interval if the component unmounts mid-poll.
  React.useEffect(() => stopReceiptMonitoring, [stopReceiptMonitoring]);

  const pollForReceipt = React.useCallback(async (since: string): Promise<ReservationReceipt | null> => {
    try {
      const params = new URLSearchParams({ stockRampOrder: stockRampOrder.toBase58(), since });
      if (wallet) params.set("takerAddress", wallet.toBase58());

      const res = await fetch(`/api/receipts/by-transaction?${params.toString()}`);
      if (!res.ok) {
        console.error("[instantReserve dialog] receipt poll returned", res.status);
        return null;
      }
      const data = await res.json();
      return data && data.id ? (data as ReservationReceipt) : null;
    } catch (err) {
      console.error("[instantReserve dialog] receipt poll failed:", err);
      return null;
    }
  }, [stockRampOrder, wallet]);

  const startReceiptMonitoring = React.useCallback((since: string) => {
    pollCountRef.current = 0;
    setPaymentStatus("processing");

    // Watch the order account itself — the elected validator's settlement
    // vote mutates this account once it executes. This is a UI hint only
    // (see file header on why polling below doesn't depend on it firing).
    try {
      subscriptionIdRef.current = connection.onAccountChange(
        stockRampOrder,
        () => {
          setPaymentStatus((prev) => (prev === "completed" ? prev : "generating_receipt"));
          queryClient.invalidateQueries({ queryKey: stockRampAccountsQueryKey() });
        },
        "confirmed"
      );
    } catch (err) {
      console.warn("[instantReserve dialog] could not subscribe to order account changes:", err);
    }

    pollTimerRef.current = setInterval(async () => {
      pollCountRef.current += 1;

      if (pollCountRef.current >= RECEIPT_MAX_POLLS) {
        stopReceiptMonitoring();
        setPaymentStatus("timeout");
        return;
      }

      const found = await pollForReceipt(since);
      if (found) {
        stopReceiptMonitoring();
        setReceipt(found);
        setPaymentStatus("completed");
        toast({ title: "Payment received", description: "The maker's payout has been confirmed." });
      }
    }, RECEIPT_POLL_INTERVAL_MS);
  }, [connection, stockRampOrder, queryClient, stopReceiptMonitoring, pollForReceipt, toast]);

  function resetAndClose(nextOpen: boolean) {
    onOpenChange(nextOpen);
    if (!nextOpen) {
      stopReceiptMonitoring();
      setAmount("");
      setBankCode("");
      setAccountNumber("");
      setBeneficiaryName("");
      setBankSearch("");
      setVerificationStatus("idle");
      setVerificationError(null);
      setVerifiedAccountName(null);
      setLastVerified(null);
      setPaymentStatus("idle");
      setReceipt(null);
      setReservedSummary(null);
    }
  }

  async function handleSubmit() {
    if (!wallet) {
      toast({ title: "Connect a wallet first", variant: "destructive" });
      return;
    }
    if (amountNum <= 0 || amountNum > availableAmount) {
      toast({ title: "Invalid amount", description: `Enter between 0 and ${availableAmount}.`, variant: "destructive" });
      return;
    }
    if (!payoutDetailsComplete) {
      toast({
        title: "Payout details required",
        description: supportsBankLookup
          ? "Please finish account verification before reserving."
          : "Please fill in your bank, account number, and beneficiary name.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const decimals = await fetchMintDecimals(connection, mint);
      const rawAmount = toBaseUnits(amountNum, decimals);

      if (rawAmount.isZero()) {
        toast({
          title: "Amount too small",
          description: `The smallest amount this token supports is ${10 ** -decimals}.`,
          variant: "destructive",
        });
        return;
      }

      const payoutDetailsJson = JSON.stringify({
        account_number: accountNumber.trim(),
        bank_code: bankCode.trim(),
        beneficiary_name: beneficiaryName.trim(),
      });

      await instantReserve({
        stockRampOrder,
        maker,
        mint,
        amount: rawAmount,
        fiatAmount: new BN(fiatAmount),
        currency: currencyCode,
        payoutDetails: payoutDetailsJson,
      });

      queryClient.invalidateQueries({ queryKey: stockRampAccountsQueryKey() });
      toast({ title: "Reserved", description: `${amountNum} tokens sent to escrow. You're owed ${fiatAmount} ${currencyCode}.` });

      // Don't close the dialog yet — the reservation itself is confirmed,
      // but the maker's fiat payout is still pending validator consensus.
      // Keep the dialog open on a status panel until a receipt shows up
      // (or polling times out) instead of leaving the taker with no idea
      // whether they'll actually get paid. See file header.
      setReservedSummary({ amount: amountNum, fiat: fiatAmount, currency: currencyCode });
      startReceiptMonitoring(new Date().toISOString());
    } catch (err) {
      console.error("[instantReserve dialog] failed:", err);
      console.error("[instantReserve dialog] program logs:", (err as { logs?: string[] })?.logs);
      const parsed = parseAnchorError(err);
      toast({ title: "Reservation failed", description: parsed.message, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  }

  const isWaitingOnPayout = paymentStatus !== "idle";

  return (
    <Dialog open={open} onOpenChange={resetAndClose}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isWaitingOnPayout ? "Reservation in progress" : "Reserve into this buy order"}
          </DialogTitle>
          <DialogDescription>
            {isWaitingOnPayout
              ? `Waiting for the maker's payout of ${reservedSummary?.fiat ?? fiatAmount} ${reservedSummary?.currency ?? currencyCode} to be confirmed.`
              : `You'll send tokens to escrow now and receive ${fiatAmount || 0} ${currencyCode} from the maker once a validator confirms payment.`}
          </DialogDescription>
        </DialogHeader>

        {isWaitingOnPayout ? (
          <div className="space-y-4">
            <div className="rounded-md border border-border p-4">
              <div className="flex items-center justify-between text-sm mb-3">
                <span className="text-muted-foreground">You reserved</span>
                <span className="font-medium text-foreground">
                  {reservedSummary?.amount} tokens
                </span>
              </div>
              <div className="flex items-center justify-between text-sm mb-4">
                <span className="text-muted-foreground">You're owed</span>
                <span className="font-medium text-foreground">
                  {reservedSummary?.fiat} {reservedSummary?.currency}
                </span>
              </div>

              {paymentStatus === "processing" && (
                <div className="flex items-center gap-3">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  <div className="text-sm text-foreground">
                    <p className="font-medium">Waiting for validator confirmation</p>
                    <p className="text-xs text-muted-foreground">
                      A validator needs to confirm the maker's payout before it's final. This can take a minute or two.
                    </p>
                  </div>
                </div>
              )}

              {paymentStatus === "generating_receipt" && (
                <div className="flex items-center gap-3">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  <div className="text-sm text-foreground">
                    <p className="font-medium">Payout detected — generating receipt</p>
                    <p className="text-xs text-muted-foreground">
                      The order was just updated on-chain. Fetching your receipt now.
                    </p>
                  </div>
                </div>
              )}

              {paymentStatus === "completed" && receipt && (
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 text-up mt-0.5" />
                  <div className="text-sm text-foreground">
                    <p className="font-medium">Payment confirmed</p>
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

              {paymentStatus === "timeout" && (
                <div className="flex items-start gap-3">
                  <Clock className="h-5 w-5 text-primary mt-0.5" />
                  <div className="text-sm text-foreground">
                    <p className="font-medium">Still processing</p>
                    <p className="text-xs text-muted-foreground">
                      This is taking longer than expected. Your reservation is safely on-chain — check back shortly for your receipt.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {paymentStatus === "completed" && receipt && (
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Receipt className="h-3.5 w-3.5" />
                Keep the receipt ID above for your records.
              </p>
            )}
          </div>
        ) : (
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
              <p className="text-xs text-muted-foreground">
                You'll receive ≈ {fiatAmount} {currencyCode}
              </p>
            </div>

            <div className="space-y-3 rounded-md border border-border p-3">
              <p className="text-xs font-medium text-foreground">
                Where should the maker send your {currencyCode}?
              </p>

              {supportsBankLookup ? (
                <div className="space-y-1">
                  <Label>Bank</Label>
                  <Select
                    value={bankCode}
                    onValueChange={(v) => {
                      setBankCode(v);
                      setBankSearch("");
                      setVerificationStatus("idle");
                      setVerifiedAccountName(null);
                      setVerificationError(null);
                    }}
                    disabled={banksLoading}
                    onOpenChange={(isOpen) => {
                      if (!isOpen) setBankSearch("");
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={banksLoading ? "Loading banks..." : "Choose your bank"} />
                    </SelectTrigger>
                    <SelectContent className="max-h-80">
                      <div className="sticky top-0 z-10 -mx-1 -mt-1 mb-1 bg-[var(--popover)] p-2 pb-1.5">
                        <div className="relative">
                          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                          <input
                            autoFocus
                            value={bankSearch}
                            onChange={(e) => setBankSearch(e.target.value)}
                            onKeyDown={(e) => {
                              // Let typing (including space) reach the input
                              // instead of Radix's built-in typeahead/select
                              // shortcuts, but still allow Escape to close.
                              if (e.key !== "Escape") e.stopPropagation();
                            }}
                            placeholder="Search banks..."
                            className="h-8 w-full rounded-sm border border-input bg-transparent pl-7 pr-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                          />
                        </div>
                      </div>
                      {filteredBanks.length === 0 ? (
                        <p className="px-2 py-3 text-center text-sm text-muted-foreground">
                          No banks match &quot;{bankSearch}&quot;
                        </p>
                      ) : (
                        filteredBanks.map((bank) => (
                          <SelectItem key={bank.code} value={bank.code}>
                            {bank.name}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="space-y-1">
                  <Label>Bank code</Label>
                  <Input
                    value={bankCode}
                    onChange={(e) => setBankCode(e.target.value)}
                    placeholder="Your bank's code"
                  />
                  <p className="text-xs text-muted-foreground">
                    Automatic bank lookup isn't available for {currencyCode} — enter your bank code directly.
                  </p>
                </div>
              )}

              <div className="space-y-1">
                <Label>Account number</Label>
                <div className="relative">
                  <Input
                    value={accountNumber}
                    onChange={(e) => setAccountNumber(e.target.value)}
                    placeholder="1234567890"
                  />
                  {supportsBankLookup && accountNumber && bankCode && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      {verificationStatus === "loading" && (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      )}
                      {verificationStatus === "success" && (
                        <CheckCircle2 className="h-4 w-4 text-up" />
                      )}
                      {verificationStatus === "error" && (
                        <AlertCircle className="h-4 w-4 text-destructive" />
                      )}
                    </div>
                  )}
                </div>
                {verificationStatus === "error" && verificationError && (
                  <p className="text-xs text-destructive">{verificationError}</p>
                )}
              </div>

              <div className="space-y-1">
                <Label>Beneficiary name</Label>
                <Input
                  value={beneficiaryName}
                  onChange={(e) => setBeneficiaryName(e.target.value)}
                  placeholder="Full name on the account"
                />
                {verifiedAccountName && beneficiaryName !== verifiedAccountName && (
                  <p className="text-xs text-muted-foreground">Verified name: {verifiedAccountName}</p>
                )}
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          {isWaitingOnPayout ? (
            paymentStatus === "completed" && receipt ? (
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
                disabled={paymentStatus === "processing" || paymentStatus === "generating_receipt"}
              >
                {paymentStatus === "timeout" ? "Done" : "Reserving..."}
              </Button>
            )
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => resetAndClose(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={handleSubmit} disabled={isSubmitting || !payoutDetailsComplete}>
                {isSubmitting ? "Reserving..." : "Confirm reservation"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
