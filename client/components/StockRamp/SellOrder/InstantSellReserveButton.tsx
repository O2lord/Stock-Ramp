// client/components/StockRamp/SellOrder/InstantSellReserveButton.tsx
// Trigger + pause-gate for `InstantSellReserveDialog`. Mirrors trust_express's
// `InstantBuyButton.tsx` — same action (taker buys a maker's escrowed
// tokens off a sell order), same gate on `sellOrdersPaused`. ASSUMPTION:
// `globalState.sellOrdersPaused` exists on the IDL account, matching the
// `pauseSellOrders` instruction already in `useStockRampProgram`.
//
// `mint` is passed straight through to the dialog, which needs it only to
// look up the mint's decimals and scale the entered amount to base units
// (see lib/tokenAmount.ts). `availableAmount` is in whole tokens.

"use client";
import React, { useState, useCallback } from "react";
import { ShoppingCart, AlertCircle } from "lucide-react";
import type { PublicKey } from "@solana/web3.js";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

import { useStockRampProgram, type GlobalState } from "@/hooks/useStockRampProgram";
import { InstantSellReserveDialog } from "./InstantSellReserveDialog";

interface InstantSellReserveButtonProps {
  stockRampOrder: PublicKey;
  maker: PublicKey;
  /** Mint of the order's token — forwarded to the dialog for decimal scaling. */
  mint: PublicKey;
  currency: number[] | Uint8Array;
  /** Available amount in whole tokens. */
  availableAmount: number;
  pricePerToken: number;
  className?: string;
}

export function InstantSellReserveButton({
  stockRampOrder,
  maker,
  mint,
  currency,
  availableAmount,
  pricePerToken,
  className,
}: InstantSellReserveButtonProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { getGlobalState } = useStockRampProgram();
  const globalStateData = getGlobalState.data as GlobalState | null | undefined;
  const isFetching = getGlobalState.isFetching;
  const sellOrdersPaused = (globalStateData as { sellOrdersPaused?: boolean } | null | undefined)?.sellOrdersPaused ?? false;

  const handleButtonClick = useCallback(() => {
    if (sellOrdersPaused) {
      toast.error("Buys Paused", {
        description: "Buying tokens off sell orders is temporarily disabled by the platform administrator.",
        icon: <AlertCircle className="h-5 w-5" />,
        duration: 5000,
      });
      return;
    }
    setDialogOpen(true);
  }, [sellOrdersPaused]);

  return (
    <>
      <Button
        type="button"
        size="sm"
        className={className}
        onClick={handleButtonClick}
        disabled={availableAmount <= 0 || isFetching}
      >
        <ShoppingCart className="mr-2 h-4 w-4" />
        {isFetching ? "Checking..." : "Buy"}
      </Button>

      <InstantSellReserveDialog
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
