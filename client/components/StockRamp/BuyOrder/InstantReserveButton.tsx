// client/components/StockRamp/BuyOrder/InstantReserveButton.tsx
// Trigger + pause-gate for `InstantReserveDialog`. Mirrors trust_express's
// `InstantPayButton.tsx` — same underlying action (taker sends tokens to
// escrow, owed fiat by the maker), same gate: refuse to open the dialog
// while the platform admin has buy orders paused, with a toast explaining
// why. ASSUMPTION: `globalState.buyOrdersPaused` exists on the IDL account,
// matching the `pauseBuyOrders` instruction already in `useStockRampProgram`.

"use client";
import React, { useState, useCallback } from "react";
import { HandCoins, AlertCircle } from "lucide-react";
import type { PublicKey } from "@solana/web3.js";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

import { useStockRampProgram, type GlobalState } from "@/hooks/useStockRampProgram";
import { InstantReserveDialog } from "./InstantReserveDialog";

interface InstantReserveButtonProps {
  stockRampOrder: PublicKey;
  maker: PublicKey;
  mint: PublicKey;
  currency: number[] | Uint8Array;
  availableAmount: number;
  pricePerToken: number;
  className?: string;
}

export function InstantReserveButton({
  stockRampOrder,
  maker,
  mint,
  currency,
  availableAmount,
  pricePerToken,
  className,
}: InstantReserveButtonProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { getGlobalState } = useStockRampProgram();
  const globalStateData = getGlobalState.data as GlobalState | null | undefined;
  const isFetching = getGlobalState.isFetching;
  const buyOrdersPaused = (globalStateData as { buyOrdersPaused?: boolean } | null | undefined)?.buyOrdersPaused ?? false;

  const handleButtonClick = useCallback(() => {
    if (buyOrdersPaused) {
      toast.error("Reservations Paused", {
        description: "Reserving into buy orders is temporarily disabled by the platform administrator.",
        icon: <AlertCircle className="h-5 w-5" />,
        duration: 5000,
      });
      return;
    }
    setDialogOpen(true);
  }, [buyOrdersPaused]);

  return (
    <>
      {/* outline — supporting action, not the lone primary */}
      <Button
        type="button"
        size="sm"
        variant="outline"
        className={className}
        onClick={handleButtonClick}
        disabled={availableAmount <= 0 || isFetching}
      >
        <HandCoins className="mr-2 h-4 w-4" />
        {isFetching ? "Checking..." : "Reserve"}
      </Button>

      <InstantReserveDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        stockRampOrder={stockRampOrder}
        maker={maker}
        mint={mint}
        currency={currency}
        availableAmount={availableAmount}
        pricePerToken={pricePerToken}
      />
    </>
  );
}