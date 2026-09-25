// client/components/StockRamp/BuyOrder/CancelOrReduceButton.tsx
// Wraps `cancel_or_reduce_buy_order.rs` via `useStockRampProgram().cancelOrReduceBuyOrder`.
// Setting new_amount to 0 (with no active reservations) fully cancels and
// reclaims rent — the on-chain handler decides which event fires, this
// component just offers both actions from one control.
//
// UNITS: `currentAmount` / `reservedAmount` arrive in WHOLE TOKENS (the
// caller descales them for display), but the program's `new_amount` argument
// is in base units — it's compared against the order's stored `amount` and
// against reservation amounts, all of which are base units. Scale on submit
// via lib/tokenAmount.ts::toBaseUnits. Zero is passed through as a literal
// zero, since "cancel" means cancel at any scale.

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
import { BN } from "@coral-xyz/anchor";

interface CancelOrReduceButtonProps {
  orderSeed: BN | number | bigint;
  /** Mint of the order's token — needed to scale `newAmount` to base units. */
  mint: PublicKey;
  /** Current order amount, in whole tokens. */
  currentAmount: number;
  /** Sum of pending/payment_sent/disputed reservation amounts in whole tokens — new_amount can't go below this. */
  reservedAmount: number;
}

export function CancelOrReduceButton({ orderSeed, mint, currentAmount, reservedAmount }: CancelOrReduceButtonProps) {
  const { cancelOrReduceBuyOrder } = useStockRampProgram();
  const decimals = useMintDecimals(mint);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [mode, setMode] = React.useState<"none" | "reduce" | "cancel">("none");
  const [newAmount, setNewAmount] = React.useState(String(currentAmount));
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  // Keep the prefilled input in step with the order as it changes on-chain,
  // as long as the maker hasn't opened the reduce dialog to edit it.
  React.useEffect(() => {
    if (mode === "none") setNewAmount(String(currentAmount));
  }, [currentAmount, mode]);

  async function submit(amount: number) {
    if (decimals === undefined) {
      toast({ title: "Still loading token details", description: "Try again in a moment.", variant: "destructive" });
      return;
    }

    setIsSubmitting(true);
    try {
      const rawAmount = amount === 0 ? new BN(0) : toBaseUnits(amount, decimals);
      await cancelOrReduceBuyOrder(orderSeed, rawAmount);
      queryClient.invalidateQueries({ queryKey: stockRampAccountsQueryKey() });
      toast({ title: amount === 0 ? "Order cancelled" : "Order reduced", description: amount === 0 ? "Rent reclaimed." : `New amount: ${amount}` });
      setMode("none");
    } catch (err) {
      const parsed = parseAnchorError(err);
      toast({ title: "Action failed", description: parsed.message, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button type="button" size="sm" variant="outline" onClick={() => setMode("reduce")}>
        Reduce
      </Button>
      <Button type="button" size="sm" variant="destructive" onClick={() => setMode("cancel")}>
        Cancel order
      </Button>

      {mode === "reduce" && (
        <ConfirmationDialog
          isOpen
          onClose={() => setMode("none")}
          onConfirm={() => submit(Number(newAmount))}
          isProcessing={isSubmitting}
          title="Reduce buy order"
          confirmText="Reduce"
          description={
            <div className="space-y-2 text-left">
              <p>
                Must stay at or above the reserved amount ({reservedAmount} tokens) — active
                reservations can't be reduced away.
              </p>
              <Input
                type="number"
                step="any"
                min={reservedAmount}
                value={newAmount}
                onChange={(e) => setNewAmount(e.target.value)}
              />
            </div>
          }
        />
      )}

      {mode === "cancel" && (
        <ConfirmationDialog
          isOpen
          onClose={() => setMode("none")}
          onConfirm={() => submit(0)}
          isProcessing={isSubmitting}
          title="Cancel this buy order?"
          confirmText="Cancel order"
          description={
            reservedAmount > 0
              ? `This order still has ${reservedAmount} tokens reserved — it will be reduced to that amount instead of fully closing until those reservations settle.`
              : "This closes the order and reclaims the account rent to your wallet."
          }
        />
      )}
    </div>
  );
}
