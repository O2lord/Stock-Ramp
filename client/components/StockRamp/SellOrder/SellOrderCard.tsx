// client/components/StockRamp/SellOrder/SellOrderCard.tsx
// Presentational card for a single sell-side StockRampOrder. Mirrors
// BuyOrder/BuyOrderCard.tsx — same layout, same token usage, only the
// direction badge and the two fact labels differ. Role-specific actions
// (withdraw for makers, instant-sell-reserve for takers) are composed in by
// MakerCard.tsx / TakerCard.tsx via `actions`.
// Backed by: programs/stock-ramp/src/state/stock_ramp_order.rs
//
// UNITS: `account.amount` is in the mint's base units (see lib/tokenAmount.ts),
// so it's descaled by the mint's decimals before display. `pricePerToken` is
// fiat per whole token and is NOT scaled.

"use client";

import * as React from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import ExplorerLink from "@/components/ui/explorer-link";
import type { StockRampOrderAccount } from "@/hooks/useStockRampProgram";
import { useMintDecimals } from "@/hooks/useMintDecimals";
import { formatTokenAmount } from "@/lib/tokenAmount";
import { decodeCurrency } from "@/types/stockRamp";
import type { PublicKey } from "@solana/web3.js";

export interface SellOrderCardProps {
  orderPda: PublicKey;
  account: StockRampOrderAccount;
  /** xStocks symbol for `account.mint`, if resolved — purely cosmetic. */
  mintSymbol?: string;
  /** Slot for role-specific controls (WithdrawButton, InstantSellReserveButton, PriceUpdate, ...). */
  actions?: React.ReactNode;
  className?: string;
}

export function SellOrderCard({ orderPda, account, mintSymbol, actions, className }: SellOrderCardProps) {
  const currency = decodeCurrency(account.currency);
  const decimals = useMintDecimals(account.mint);
  const amountLabel = decimals === undefined ? "…" : formatTokenAmount(account.amount, decimals);
  const pricePerToken = account.pricePerToken?.toNumber?.() ?? 0;
  const activeReservations = account.reservedAmounts?.length ?? 0;
  const pda = orderPda.toBase58();

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-start justify-between gap-2 pb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold tracking-tight text-foreground">
              {mintSymbol ?? "Unknown token"}
            </h3>
            <Badge variant="down">Sell</Badge>
          </div>
          <ExplorerLink type="address" value={pda}>
            <span className="font-mono text-[11px] text-muted-foreground">
              {pda.slice(0, 4)}…{pda.slice(-4)}
            </span>
          </ExplorerLink>
        </div>
        {activeReservations > 0 && <Badge variant="warning">{activeReservations} active</Badge>}
      </CardHeader>

      <CardContent className="space-y-3">
        <div>
          <div className="text-2xl font-bold tracking-tight text-foreground tabular">
            {pricePerToken.toLocaleString()}
            <span className="ml-1.5 text-xs font-medium text-muted-foreground">
              {currency} / token
            </span>
          </div>
        </div>

        <dl className="space-y-1.5 border-t border-border pt-3 text-[13px]">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-muted-foreground">Available to buy</dt>
            <dd className="font-medium text-foreground tabular">{amountLabel} tokens</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="shrink-0 text-muted-foreground">Seller instructions</dt>
            <dd className="truncate text-foreground/80" title={account.paymentInstructions}>
              {account.paymentInstructions || "—"}
            </dd>
          </div>
        </dl>

        {actions && <div className="border-t border-border pt-3">{actions}</div>}
      </CardContent>
    </Card>
  );
}
