// client/components/StockRamp/SellOrder/MakerCard.tsx
// Maker's-eye view of their own sell order: order facts (via SellOrderCard) +
// maker-only controls (price sync, withdraw) + a reservation list so the
// maker can see who has committed to buying and owes payment.
//
// UNITS: `account.amount` and every `ReservedAmount.amount` are in the mint's
// base units (see lib/tokenAmount.ts), so both the reservation list and the
// amount handed to WithdrawButton are descaled to whole tokens here.
// WithdrawButton scales back up on submit.

"use client";

import * as React from "react";
import type { PublicKey } from "@solana/web3.js";
import { SellOrderCard } from "./SellOrderCard";
import { WithdrawButton } from "./WithdrawButton";
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

  const hasActiveReservations = (account.reservedAmounts ?? []).some((r) =>
    [0, 1, 4].includes(r.status as ReservationStatus)
  );

  // 0 while decimals load, which leaves the withdraw controls disabled rather
  // than offering a wrongly-scaled maximum.
  const availableAmount = decimals === undefined ? 0 : toUiAmount(account.amount, decimals);

  return (
    <SellOrderCard
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
          <WithdrawButton
            orderSeed={account.seed}
            mint={account.mint}
            availableAmount={availableAmount}
            hasActiveReservations={hasActiveReservations}
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
