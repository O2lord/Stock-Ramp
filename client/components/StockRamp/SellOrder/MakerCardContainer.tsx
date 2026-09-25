// client/components/StockRamp/SellOrder/MakerCardContainer.tsx
// Fetches a single order by PDA and renders MakerCard, resolving the mint's
// xStocks symbol along the way. Use this when you already know a PDA belongs
// to the connected wallet's own order (e.g. a "My Orders" list) — for a
// mixed public grid where role isn't known ahead of time, SellOrderGrid.tsx
// decides Maker vs Taker per-card instead.

"use client";

import type { PublicKey } from "@solana/web3.js";
import { Skeleton } from "@/components/ui/skeleton";
import { useStockRampInfo } from "@/hooks/queries/useStockRampInfo";
import { useMintSymbol } from "@/hooks/useXStockPrices";
import { MakerCard } from "./MakerCard";

interface MakerCardContainerProps {
  orderPda: PublicKey;
}

export function MakerCardContainer({ orderPda }: MakerCardContainerProps) {
  const { data: account, isLoading, error } = useStockRampInfo(orderPda);
  const mintSymbol = useMintSymbol(account?.mint.toBase58());

  if (isLoading) return <Skeleton className="h-56 w-full" />;
  if (error || !account) return null;

  return <MakerCard orderPda={orderPda} account={account} mintSymbol={mintSymbol} />;
}
