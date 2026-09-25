// client/components/StockRamp/SellOrder/TakerCardContainer.tsx
// Fetches a single order by PDA and renders TakerCard, resolving the mint's
// xStocks symbol along the way.

"use client";

import type { PublicKey } from "@solana/web3.js";
import { Skeleton } from "@/components/ui/skeleton";
import { useStockRampInfo } from "@/hooks/queries/useStockRampInfo";
import { useMintSymbol } from "@/hooks/useXStockPrices";
import { TakerCard } from "./TakerCard";

interface TakerCardContainerProps {
  orderPda: PublicKey;
}

export function TakerCardContainer({ orderPda }: TakerCardContainerProps) {
  const { data: account, isLoading, error } = useStockRampInfo(orderPda);
  const mintSymbol = useMintSymbol(account?.mint.toBase58());

  if (isLoading) return <Skeleton className="h-56 w-full" />;
  if (error || !account) return null;

  return <TakerCard orderPda={orderPda} account={account} mintSymbol={mintSymbol} />;
}
