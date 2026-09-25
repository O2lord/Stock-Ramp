// client/app/payment-success/[payoutReference]/page.tsx
// Landing page for the redirect_url Flutterwave/OPay send buyers to after a
// hosted checkout — see discord-bot/bot.ts::generatePaymentLink, which
// builds this as `${NEXT_PUBLIC_APP_URL}/payment-success/${reference}` for
// every InstantSellReserve payment link. Without this route, every
// completed checkout landed on Next's default 404 page instead of telling
// the buyer their payment went through — the tokens still released fine
// (that happens entirely through on-chain validator consensus, independent
// of this page), but the buyer had no confirmation and no path to their
// receipt.
//
// Adapted from trust_vault's client/app/(dashboard)/payment-success/
// [payoutReference]/page.tsx, with three deliberate differences:
//   1. No `(dashboard)` route group — this repo's app/ has no such group
//      (see app/receipts/[id]/page.tsx, also top-level), and the redirect
//      URL above has no /dashboard prefix either.
//   2. Styling uses this app's Terminal design tokens (bg-surface-1,
//      text-up, text-destructive, border-border — see app/globals.css)
//      instead of trust_vault's hardcoded green-50/red-50 hex and its
//      undefined `panel` class. globals.css is explicit that components
//      must consume tokens, not hardcode colors.
//   3. `params` is consumed as a plain object, not unwrapped with React's
//      `use()`. trust_vault runs Next.js 15, where dynamic-route `params`
//      are Promises. This repo pins next@^14.2.18 (see client/package.json),
//      where `params` is handed to page components — client or server —
//      as a plain object. Calling `use()` on that plain object is what was
//      throwing "An unsupported type was passed to use(): [object Object]"
//      on every render and 500-ing this route.
// Everything else — the Flutterwave vs. OPay redirect-param detection, the
// receipt polling against /api/receipts/by-reference/[reference] (receipts
// insert asynchronously once a validator votes, so this may not exist the
// instant the buyer lands here), and the status states — is unchanged.
"use client";

import React, { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle, XCircle, Loader2, Receipt, ExternalLink, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface PaymentSuccessPageProps {
  // Next.js 14 passes `params` as a plain object on both server and client
  // page components — it is NOT a Promise here (that's a Next.js 15
  // change). This project pins next@^14.2.18, so params must be consumed
  // directly, without React's `use()`.
  params: {
    payoutReference: string;
  };
}

type ConfirmationStatus = "loading" | "success" | "failed" | "invalid";

interface ConfirmationResult {
  success: boolean;
  message: string;
  transactionSignature?: string;
  tokenAmount?: string;
  fiatAmount?: string;
  currency?: string;
}

const RECEIPT_POLL_ATTEMPTS = 10;
const RECEIPT_POLL_INTERVAL_MS = 3000;

const PaymentSuccessPage: React.FC<PaymentSuccessPageProps> = ({ params }) => {
  const router = useRouter();
  const searchParams = useSearchParams();

  const { payoutReference } = params;

  const [status, setStatus] = useState<ConfirmationStatus>("loading");
  const [result, setResult] = useState<ConfirmationResult | null>(null);

  // Receipt lookup — resolves payoutReference -> the receipt's actual DB id
  // via /api/receipts/by-reference/[reference]. The receipt row is created
  // asynchronously once a validator votes, so this polls for a bit.
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [receiptLookup, setReceiptLookup] = useState<"idle" | "polling" | "found" | "not_found">("idle");

  // Flutterwave sends: ?status=completed&tx_ref=xxx&transaction_id=xxx
  const flutterwaveStatus = searchParams.get("status");
  const txRef = searchParams.get("tx_ref");
  const transactionId = searchParams.get("transaction_id");

  // OPay sends: ?status=SUCCESS&orderNo=xxx (no tx_ref / transaction_id)
  const opayStatus = searchParams.get("status");
  const orderNo = searchParams.get("orderNo");
  const isOpay = !!orderNo || (opayStatus === "SUCCESS" && !txRef);

  const confirmPayment = () => {
    if (isOpay) {
      if (opayStatus === "SUCCESS") {
        setStatus("success");
        setResult({
          success: true,
          message:
            "Payment received via OPay! Validators are confirming your transaction. Tokens will be released to your wallet automatically within 30 seconds.",
        });
      } else if (opayStatus === "FAIL" || opayStatus === "CLOSE") {
        setStatus("failed");
        setResult({
          success: false,
          message: `OPay payment ${opayStatus === "CLOSE" ? "was cancelled or timed out" : "failed"}. No funds have been deducted.`,
        });
      } else {
        setStatus("success");
        setResult({
          success: true,
          message:
            "If your payment was completed, validators are confirming it now. Tokens will be released to your wallet automatically within 30 seconds.",
        });
      }
      return;
    }

    // Flutterwave path
    if (!flutterwaveStatus || !txRef || !transactionId) {
      setStatus("invalid");
      setResult({ success: false, message: "Missing payment parameters." });
      return;
    }

    if (flutterwaveStatus !== "completed") {
      setStatus("failed");
      setResult({ success: false, message: `Payment not completed. Status: ${flutterwaveStatus}` });
      return;
    }

    // Payment is done on Flutterwave's side. Validators verify and release
    // tokens automatically via on-chain voting — this page doesn't drive that.
    setStatus("success");
    setResult({
      success: true,
      message:
        "Payment received! Validators are confirming your transaction. Tokens will be released to your wallet automatically within 30 seconds.",
    });
  };

  useEffect(() => {
    confirmPayment();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (status !== "success") return;
    if (receiptId) return;

    let cancelled = false;
    let attempts = 0;

    const fetchReceiptId = async (): Promise<string | null> => {
      try {
        const res = await fetch(`/api/receipts/by-reference/${payoutReference}`);
        if (!res.ok) return null;
        const data = await res.json();
        return data?.id ?? null;
      } catch {
        return null;
      }
    };

    setReceiptLookup("polling");

    const poll = async () => {
      const id = await fetchReceiptId();
      if (cancelled) return;

      if (id) {
        setReceiptId(id);
        setReceiptLookup("found");
        return;
      }

      attempts += 1;
      if (attempts >= RECEIPT_POLL_ATTEMPTS) {
        setReceiptLookup("not_found");
        return;
      }
      setTimeout(poll, RECEIPT_POLL_INTERVAL_MS);
    };

    poll();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const handleViewReceipt = () => {
    if (receiptId) {
      router.push(`/receipts/${receiptId}`);
    }
  };

  const handleViewTransaction = () => {
    if (result?.transactionSignature) {
      window.open(`https://explorer.solana.com/tx/${result.transactionSignature}?cluster=devnet`, "_blank");
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md bg-surface-1 border-border">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            {status === "loading" && <Loader2 className="w-16 h-16 text-primary animate-spin" />}
            {status === "success" && <CheckCircle className="w-16 h-16 text-up" />}
            {status === "failed" && <XCircle className="w-16 h-16 text-destructive" />}
            {status === "invalid" && <AlertCircle className="w-16 h-16 text-primary" />}
          </div>

          <CardTitle className="text-foreground text-xl">
            {status === "loading" && "Processing Payment..."}
            {status === "success" && "Payment Successful!"}
            {status === "failed" && "Payment Failed"}
            {status === "invalid" && "Invalid Payment"}
          </CardTitle>

          <CardDescription className="text-muted-foreground break-all">
            Reference: {payoutReference}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {status === "loading" && (
            <div className="text-center text-foreground space-y-2">
              <p>Confirming your payment...</p>
              <p className="text-sm text-muted-foreground">
                Please wait while we release your tokens on the blockchain.
              </p>
            </div>
          )}

          {status === "success" && result && (
            <div className="space-y-4">
              <div className="rounded-md border border-border bg-up/10 p-4">
                <p className="text-up text-sm">{result.message}</p>
              </div>

              {(result.tokenAmount || result.fiatAmount) && (
                <div className="rounded-md border border-border bg-surface-2 p-4 space-y-2">
                  <h3 className="text-foreground font-medium mb-3">Transaction Details</h3>
                  {result.tokenAmount && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Tokens Received:</span>
                      <span className="text-foreground font-medium">{result.tokenAmount}</span>
                    </div>
                  )}
                  {result.fiatAmount && result.currency && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Amount Paid:</span>
                      <span className="text-foreground font-medium">
                        {result.currency} {result.fiatAmount}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {result.transactionSignature && (
                <Button onClick={handleViewTransaction} variant="outline" className="w-full">
                  <ExternalLink className="w-4 h-4 mr-2" />
                  View on Solana Explorer
                </Button>
              )}
            </div>
          )}

          {(status === "failed" || status === "invalid") && result && (
            <div className="space-y-4">
              <div className="rounded-md border border-border bg-destructive/10 p-4">
                <p className="text-destructive text-sm">{result.message}</p>
              </div>

              <div className="rounded-md border border-border bg-surface-2 p-4">
                <h3 className="text-foreground font-medium mb-2">What to do next:</h3>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>
                    • Save your payment reference:{" "}
                    <span className="text-foreground font-mono text-xs break-all">{payoutReference}</span>
                  </li>
                  <li>• Contact support with this reference</li>
                  <li>• Check your payment method was charged</li>
                  <li>• Do not make another payment</li>
                </ul>
              </div>

              <Button onClick={() => router.push("/stocks")} variant="default" className="w-full">
                Back to Stocks
              </Button>
            </div>
          )}

          {status === "success" && (
            <div className="pt-4 border-t border-border">
              {receiptLookup === "found" && (
                <Button onClick={handleViewReceipt} variant="default" className="w-full">
                  <Receipt className="w-4 h-4 mr-2" />
                  View Receipt
                </Button>
              )}

              {receiptLookup === "polling" && (
                <Button variant="default" className="w-full" disabled>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Preparing Receipt...
                </Button>
              )}

              {(receiptLookup === "idle" || receiptLookup === "not_found") && (
                <Button onClick={() => router.push("/stocks")} variant="outline" className="w-full">
                  <Receipt className="w-4 h-4 mr-2" />
                  {receiptLookup === "not_found" ? "Can't find it yet — back to Stocks" : "Back to Stocks"}
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default PaymentSuccessPage;
