// client/components/StockRamp/BuyOrder/MakerCard.tsx
// Maker's-eye view of their own buy order: order facts (via BuyOrderCard) +
// maker-only controls (price sync, cancel/reduce) + a reservation list so
// the maker can see who has sent tokens and owes payment.
//
// UNITS: `account.amount` and every `ReservedAmount.amount` are in the mint's
// base units (see lib/tokenAmount.ts), so both the reservation list and the
// amounts handed to CancelOrReduceButton are descaled to whole tokens here.
// CancelOrReduceButton scales back up on submit, which is why it also needs
// the mint.

"use client";

import * as React from "react";
import type { PublicKey } from "@solana/web3.js";
import { BuyOrderCard } from "./BuyOrderCard";
import { CancelOrReduceButton } from "./CancelOrReduceButton";
import { PriceUpdate } from "@/components/StockRamp/Shared/PriceUpdate";
import { Badge } from "@/components/ui/badge";
import type { StockRampOrderAccount } from "@/hooks/useStockRampProgram";
import { useMintDecimals } from "@/hooks/useMintDecimals";
import { formatTokenAmount, toUiAmount } from "@/lib/tokenAmount";
import { RESERVATION_STATUS_LABEL, type ReservationStatus } from "@/types/stockRamp";

interface MakerCardProps {
  orderPda: PublicKey;
  account: StockRampOrderAccount;
  mintSymbol?: string;
}

export function MakerCard({ orderPda, account, mintSymbol }: MakerCardProps) {
  const decimals = useMintDecimals(account.mint);

  // Summed in base units first, then descaled once — summing descaled floats
  // would compound rounding error across up to 10 reservations.
  const reservedRaw = (account.reservedAmounts ?? [])
    .filter((r) => [0, 1, 4].includes(r.status as ReservationStatus))
    .reduce((sum, r) => sum + (r.amount?.toNumber?.() ?? 0), 0);

  const currentAmount = decimals === undefined ? 0 : toUiAmount(account.amount, decimals);
  const reservedAmount = decimals === undefined ? 0 : toUiAmount(reservedRaw, decimals);

  return (
    <BuyOrderCard
      orderPda={orderPda}
      account={account}
      mintSymbol={mintSymbol}
      actions={
        <div className="space-y-3">
          <PriceUpdate
            orderSeed={account.seed}
            currentPrice={account.pricePerToken?.toNumber?.() ?? 0}
            currency={account.currency}
            symbol={mintSymbol}
          />
          <CancelOrReduceButton
            orderSeed={account.seed}
            mint={account.mint}
            currentAmount={currentAmount}
            reservedAmount={reservedAmount}
          />
          {account.reservedAmounts && account.reservedAmounts.length > 0 && (
            <ul className="space-y-1 pt-1">
              {account.reservedAmounts.map((r, i) => (
                <li key={i} className="flex items-center justify-between text-xs text-[#0F0D0A]/70">
                  <span>
                    {r.taker.toBase58().slice(0, 4)}...{r.taker.toBase58().slice(-4)} ·{" "}
                    {decimals === undefined ? "…" : formatTokenAmount(r.amount, decimals)} tokens
                  </span>
                  <Badge variant="secondary">
                    {RESERVATION_STATUS_LABEL[r.status as ReservationStatus] ?? "Unknown"}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      }
    />
  );
}
