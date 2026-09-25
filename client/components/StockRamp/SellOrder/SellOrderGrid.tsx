// client/components/StockRamp/SellOrder/SellOrderGrid.tsx
// Public grid of all SELL orders. Mirrors BuyOrder/BuyOrderGrid.tsx exactly,
// swapped to escrowType SELL and the SellOrder role cards.
//
// NOTE: the empty-state message was hardcoded to text-[#0F0D0A]/60
// (near-black), invisible against the dark theme's near-black background —
// swapped to `text-foreground/60`.

"use client";

import * as React from "react";
import { useStockRampAccounts } from "@/hooks/queries/useStockRampAccounts";
import { useStockRampProgram } from "@/hooks/useStockRampProgram";
import { useXStockAssets } from "@/hooks/useXStockPrices";
import { Filter, DEFAULT_FILTER_STATE, type FilterState } from "@/components/StockRamp/Shared/Filter";
import { Skeleton } from "@/components/ui/skeleton";
import { ESCROW_TYPE, decodeCurrency } from "@/types/stockRamp";
import { XSTOCKS_MINTS } from "@/lib/constant";
import { MakerCard } from "./MakerCard";
import { TakerCard } from "./TakerCard";

export function SellOrderGrid() {
  const { wallet } = useStockRampProgram();
  const { data: orders, isLoading } = useStockRampAccounts({ escrowType: ESCROW_TYPE.SELL });
  const { data: assets } = useXStockAssets();
  const [filter, setFilter] = React.useState<FilterState>(DEFAULT_FILTER_STATE);

  const mintSymbolByAddress = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const [symbol, mint] of Object.entries(XSTOCKS_MINTS)) {
      map.set(mint, symbol);
    }
    return map;
  }, []);

  const rows = React.useMemo(() => {
    if (!orders) return [];
    return orders.map(({ publicKey, account }) => ({
      publicKey,
      account,
      mintSymbol: mintSymbolByAddress.get(account.mint.toBase58()),
      currency: decodeCurrency(account.currency),
    }));
  }, [orders, mintSymbolByAddress]);

  const availableCurrencies = React.useMemo(
    () => Array.from(new Set(rows.map((r) => r.currency))).sort(),
    [rows]
  );

  const filtered = React.useMemo(() => {
    return rows.filter((row) => {
      if (filter.mineOnly && (!wallet || !row.account.maker.equals(wallet))) return false;
      if (filter.currency && row.currency !== filter.currency) return false;
      if (filter.symbol && row.mintSymbol !== filter.symbol) return false;
      if (filter.search) {
        const needle = filter.search.trim().toLowerCase();
        const haystack = `${row.mintSymbol ?? ""} ${row.account.mint.toBase58()}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [rows, filter, wallet]);

  if (isLoading || (!orders && !assets)) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-56 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Filter value={filter} onChange={setFilter} availableCurrencies={availableCurrencies} />

      {filtered.length === 0 ? (
        <p className="text-sm text-foreground/60 py-8 text-center">No sell orders match your filters.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((row) =>
            wallet && row.account.maker.equals(wallet) ? (
              <MakerCard
                key={row.publicKey.toBase58()}
                orderPda={row.publicKey}
                account={row.account}
                mintSymbol={row.mintSymbol}
              />
            ) : (
              <TakerCard
                key={row.publicKey.toBase58()}
                orderPda={row.publicKey}
                account={row.account}
                mintSymbol={row.mintSymbol}
              />
            )
          )}
        </div>
      )}
    </div>
  );
}
