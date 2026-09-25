// client/components/StockRamp/BuyOrder/TakerCard.tsx
// Taker's-eye view of someone else's buy order: order facts (via
// BuyOrderCard) + the InstantReserveButton to send tokens into escrow.
//
// UNITS: `account.amount` is base units (see lib/tokenAmount.ts); the reserve
// button and dialog work in whole tokens, so it's descaled here. While the
// mint's decimals are still loading we pass 0, which leaves the Reserve
// button disabled rather than letting someone reserve against a
// wrongly-scaled maximum.

"use client";

import * as React from "react";
import type { PublicKey } from "@solana/web3.js";
import { BuyOrderCard } from "./BuyOrderCard";
import { InstantReserveButton } from "./InstantReserveButton";
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
    <BuyOrderCard
      orderPda={orderPda}
      account={account}
      mintSymbol={mintSymbol}
      actions={
        <InstantReserveButton
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
