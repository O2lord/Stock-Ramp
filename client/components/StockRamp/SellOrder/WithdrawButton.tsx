// client/components/StockRamp/SellOrder/WithdrawButton.tsx
// Wraps `stock_ramp_withdraw.rs` via `useStockRampProgram().stockRampWithdraw`
// — the maker-side control for a SELL order. There's no separate cancel/reduce
// instruction for sell orders (unlike buy orders): withdrawing the full
// remaining `amount` with no active reservations closes the order and
// reclaims rent + the escrow ATA in one instruction (see stock_ramp_withdraw.rs).
//
// UNITS: `availableAmount` arrives in WHOLE TOKENS (descaled by the caller
// for display), while `withdraw_amount` on-chain is in base units — it's
// checked against the order's stored `amount` and then transferred out of the
// escrow ATA. Scale on submit via lib/tokenAmount.ts::toBaseUnits.

"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { PublicKey } from "@solana/web3.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ConfirmationDialog from "@/components/ui/confirmation-dialog";
import { useToast } from "@/components/ui/use-toast";
import { useStockRampProgram } from "@/hooks/useStockRampProgram";
import { useMintDecimals } from "@/hooks/useMintDecimals";
import { stockRampAccountsQueryKey } from "@/hooks/queries/useStockRampAccounts";
import { parseAnchorError } from "@/lib/parseAnchorError";
import { toBaseUnits } from "@/lib/tokenAmount";
import type { BN } from "@coral-xyz/anchor";

interface WithdrawButtonProps {
  orderSeed: BN | number | bigint;
  mint: PublicKey;
  /** Currently available (unreserved) amount on the order, in whole tokens. */
  availableAmount: number;
  /** True if any reservation is pending/payment_sent/disputed — a full withdrawal still leaves the order open until these settle. */
  hasActiveReservations: boolean;
}

export function WithdrawButton({ orderSeed, mint, availableAmount, hasActiveReservations }: WithdrawButtonProps) {
  const { stockRampWithdraw } = useStockRampProgram();
  const decimals = useMintDecimals(mint);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [mode, setMode] = React.useState<"none" | "partial" | "full">("none");
  const [amount, setAmount] = React.useState(String(availableAmount));
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  // Keep the prefilled input in step with the order as it changes on-chain,
  // as long as the maker hasn't opened the withdraw dialog to edit it.
  React.useEffect(() => {
    if (mode === "none") setAmount(String(availableAmount));
  }, [availableAmount, mode]);

  async function submit(withdrawAmount: number) {
    if (decimals === undefined) {
      toast({ title: "Still loading token details", description: "Try again in a moment.", variant: "destructive" });
      return;
    }

    setIsSubmitting(true);
    try {
      await stockRampWithdraw({
        orderSeed,
        mint,
        withdrawAmount: toBaseUnits(withdrawAmount, decimals),
      });
      queryClient.invalidateQueries({ queryKey: stockRampAccountsQueryKey() });
      toast({
        title: withdrawAmount === availableAmount && !hasActiveReservations ? "Order closed" : "Tokens withdrawn",
        description:
          withdrawAmount === availableAmount && !hasActiveReservations
            ? "Escrow closed and rent reclaimed."
            : `Withdrew ${withdrawAmount} tokens.`,
      });
      setMode("none");
    } catch (err) {
      const parsed = parseAnchorError(err);
      toast({ title: "Withdrawal failed", description: parsed.message, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button type="button" size="sm" variant="outline" onClick={() => setMode("partial")} disabled={availableAmount <= 0}>
        Withdraw
      </Button>
      <Button
        type="button"
        size="sm"
        variant="destructive"
        onClick={() => setMode("full")}
        disabled={availableAmount <= 0}
      >
        {hasActiveReservations ? "Withdraw all available" : "Close order"}
      </Button>

      {mode === "partial" && (
        <ConfirmationDialog
          isOpen
          onClose={() => setMode("none")}
          onConfirm={() => submit(Number(amount))}
          isProcessing={isSubmitting}
          title="Withdraw tokens"
          confirmText="Withdraw"
          description={
            <div className="space-y-2 text-left">
              <p>Up to {availableAmount} tokens are currently unreserved and available to withdraw.</p>
              <Input
                type="number"
                step="any"
                max={availableAmount}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          }
        />
      )}

      {mode === "full" && (
        <ConfirmationDialog
          isOpen
          onClose={() => setMode("none")}
          onConfirm={() => submit(availableAmount)}
          isProcessing={isSubmitting}
          title={hasActiveReservations ? "Withdraw all available tokens?" : "Close this sell order?"}
          confirmText={hasActiveReservations ? "Withdraw all" : "Close order"}
          description={
            hasActiveReservations
              ? `This withdraws all ${availableAmount} unreserved tokens — the order stays open until its active reservations settle.`
              : "This closes the order, reclaims the escrow account, and returns your rent."
          }
        />
      )}
    </div>
  );
}
