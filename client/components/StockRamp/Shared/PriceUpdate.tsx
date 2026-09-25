// client/components/StockRamp/Shared/PriceUpdate.tsx
// Wraps `update_price.rs` (via `useStockRampProgram().updatePrice`) +
// `lib/priceKeeper.ts`'s live reference price, so a maker can see how their
// stored `pricePerToken` compares to the current market and push a new
// price in one click. Distinct from `keeper/`'s automated price bot — this
// is the manual, maker-facing equivalent.

"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { useStockRampProgram } from "@/hooks/useStockRampProgram";
import { stockRampAccountsQueryKey } from "@/hooks/queries/useStockRampAccounts";
import { parseAnchorError } from "@/lib/parseAnchorError";
import { getReferencePrice, priceDeviationPct } from "@/lib/priceKeeper";
import { decodeCurrency } from "@/types/stockRamp";
import type { BN } from "@coral-xyz/anchor";

interface PriceUpdateProps {
  orderSeed: BN | number | bigint;
  currentPrice: number;
  currency: number[] | Uint8Array;
  /** xStocks symbol for this order's mint, e.g. "AAPLx" — needed to fetch a reference price. */
  symbol?: string;
}

export function PriceUpdate({ orderSeed, currentPrice, currency, symbol }: PriceUpdateProps) {
  const { updatePrice } = useStockRampProgram();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [referencePrice, setReferencePrice] = React.useState<number | null>(null);
  const [isFetchingReference, setIsFetchingReference] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const currencyCode = decodeCurrency(currency);

  const fetchReference = React.useCallback(async () => {
    if (!symbol) return;
    setIsFetchingReference(true);
    try {
      const price = await getReferencePrice(symbol, currencyCode);
      setReferencePrice(price);
    } catch (err) {
      toast({
        title: "Couldn't fetch reference price",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setIsFetchingReference(false);
    }
  }, [symbol, currencyCode, toast]);

  React.useEffect(() => {
    fetchReference();
  }, [fetchReference]);

  const deviation = referencePrice != null ? priceDeviationPct(currentPrice, referencePrice) : null;

  async function handleSync() {
    if (!referencePrice) return;
    setIsSubmitting(true);
    try {
      await updatePrice(orderSeed, referencePrice);
      queryClient.invalidateQueries({ queryKey: stockRampAccountsQueryKey() });
      toast({ title: "Price updated", description: `New price: ${referencePrice} ${currencyCode}` });
    } catch (err) {
      const parsed = parseAnchorError(err);
      toast({ title: "Price update failed", description: parsed.message, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-[#0F0D0A]/70">
        {currentPrice} {currencyCode}
      </span>

      {deviation != null && (
        <Badge variant={Math.abs(deviation) < 1 ? "success" : Math.abs(deviation) < 5 ? "warning" : "destructive"}>
          {deviation > 0 ? <TrendingUp className="mr-1 h-3 w-3" /> : <TrendingDown className="mr-1 h-3 w-3" />}
          {deviation.toFixed(1)}% vs market
        </Badge>
      )}

      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={fetchReference}
        disabled={isFetchingReference || !symbol}
        title="Refresh reference price"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${isFetchingReference ? "animate-spin" : ""}`} />
      </Button>

      {referencePrice != null && Math.round(referencePrice) !== currentPrice && (
        <Button type="button" size="sm" variant="outline" onClick={handleSync} disabled={isSubmitting}>
          {isSubmitting ? "Updating..." : `Sync to ${referencePrice}`}
        </Button>
      )}
    </div>
  );
}
