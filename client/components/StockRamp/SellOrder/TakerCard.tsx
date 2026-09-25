// client/components/StockRamp/SellOrder/TakerCard.tsx
// Taker's-eye view of someone else's sell order: order facts (via
// SellOrderCard) + the InstantSellReserveButton to reserve tokens and
// commit to paying the maker.
//
// UNITS: `account.amount` is base units (see lib/tokenAmount.ts); the reserve
// button and dialog work in whole tokens, so it's descaled here. `mint` is
// forwarded because the dialog needs it to scale the entered amount back to
// base units — `instant_sell_reserve` itself takes no mint account.

"use client";

import * as React from "react";
import type { PublicKey } from "@solana/web3.js";
import { SellOrderCard } from "./SellOrderCard";
import { InstantSellReserveButton } from "./InstantSellReserveButton";
import type { StockRampOrderAccount } from "@/hooks/useStockRampProgram";
import { useMintDecimals } from "@/hooks/useMintDecimals";
import { toUiAmount } from "@/lib/tokenAmount";

interface TakerCardProps {
  orderPda: PublicKey;
  account: StockRampOrderAccount;
  mintSymbol?: string;
}

export function TakerCard({ orderPda, account, mintSymbol }: TakerCardProps) {
  const decimals = useMintDecimals(account.mint);
  const availableAmount = decimals === undefined ? 0 : toUiAmount(account.amount, decimals);

  return (
    <SellOrderCard
      orderPda={orderPda}
      account={account}
      mintSymbol={mintSymbol}
      actions={
        <InstantSellReserveButton
          stockRampOrder={orderPda}
          maker={account.maker}
          mint={account.mint}
          currency={account.currency}
          availableAmount={availableAmount}
          pricePerToken={account.pricePerToken?.toNumber?.() ?? 0}
        />
      }
    />
  );
}
