// client/hooks/queries/useStockRampAccounts.ts
// Wraps `account.stockRampOrder.all()`, optionally filtered by maker and/or
// mint via Anchor memcmp filters. Backed by: state/stock_ramp_order.rs

"use client";

import { useQuery } from "@tanstack/react-query";
import bs58 from "bs58";
import type { PublicKey } from "@solana/web3.js";
import { useStockRampProgram } from "../useStockRampProgram";
import type { EscrowType } from "../../types/stockRamp";

export interface UseStockRampAccountsFilters {
  /** Only orders created by this maker (e.g. "My Orders" pages). */
  maker?: PublicKey;
  /** Only orders for this xStocks mint. */
  mint?: PublicKey;
  /** Only buy (1) or sell (0) orders — see ESCROW_TYPE in lib/constant.ts. */
  escrowType?: EscrowType;
}

export function stockRampAccountsQueryKey(filters?: UseStockRampAccountsFilters) {
  return [
    "stockRampOrders",
    filters?.maker?.toBase58() ?? null,
    filters?.mint?.toBase58() ?? null,
    filters?.escrowType ?? null,
  ] as const;
}

/**
 * `StockRampOrder`'s account layout: 8-byte discriminator, then `seed: u64`
 * (8 bytes), then `maker: Pubkey` (32 bytes) — so maker starts at offset 16.
 * `mint: Pubkey` immediately follows maker, at offset 48.
 * `escrow_type: u8` comes after `currency: [u8; 3]`, at offset 48 + 32 + 3 = 83.
 * These offsets mirror the field order in
 * programs/stock-ramp/src/state/stock_ramp_order.rs — keep them in sync if
 * that struct's field order ever changes.
 */
const MAKER_OFFSET = 16;
const MINT_OFFSET = 48;
const ESCROW_TYPE_OFFSET = 83;

export function useStockRampAccounts(filters?: UseStockRampAccountsFilters) {
  const { program } = useStockRampProgram();

  return useQuery({
    queryKey: stockRampAccountsQueryKey(filters),
    queryFn: async () => {
      const memcmpFilters = [];
      if (filters?.maker) {
        memcmpFilters.push({ memcmp: { offset: MAKER_OFFSET, bytes: filters.maker.toBase58() } });
      }
      if (filters?.mint) {
        memcmpFilters.push({ memcmp: { offset: MINT_OFFSET, bytes: filters.mint.toBase58() } });
      }
      if (filters?.escrowType !== undefined) {
        memcmpFilters.push({
          memcmp: { offset: ESCROW_TYPE_OFFSET, bytes: bs58.encode(Buffer.from([filters.escrowType])) },
        });
      }

      return memcmpFilters.length
        ? await program.account.stockRampOrder.all(memcmpFilters)
        : await program.account.stockRampOrder.all();
    },
  });
}
