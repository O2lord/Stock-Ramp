// client/hooks/queries/useStockRampInfo.ts
// Single-order fetch via `account.stockRampOrder.fetch(pda)`.
// Backed by: programs/stock-ramp/src/state/stock_ramp_order.rs

"use client";

import { useQuery } from "@tanstack/react-query";
import type { PublicKey } from "@solana/web3.js";
import { useStockRampProgram } from "../useStockRampProgram";

export function stockRampInfoQueryKey(orderPda?: PublicKey | null) {
  return ["stockRampOrder", orderPda?.toBase58() ?? null] as const;
}

export function useStockRampInfo(orderPda: PublicKey | null | undefined) {
  const { program } = useStockRampProgram();

  return useQuery({
    queryKey: stockRampInfoQueryKey(orderPda),
    queryFn: () => program.account.stockRampOrder.fetch(orderPda as PublicKey),
    enabled: !!orderPda,
  });
}
