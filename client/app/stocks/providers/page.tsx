// client/app/stocks/providers/page.tsx
// Public directory of liquidity providers (makers) — aggregates every
// StockRampOrder by maker so someone can see who's offering liquidity
// before diving into the full order book at /stocks. Distinct from that
// page: this is a per-maker rollup, not a per-order list.
//
// [flag, not assumed] Same as merchant/page.tsx: the multi-processor fiat
// CredentialsManager UI (which provider/processor a maker accepts payouts
// through) isn't built here — no product decision has been made on how to
// surface that yet. This page only rolls up on-chain order data, which
// needs no such decision.

"use client";

import * as React from "react";
import Link from "next/link";
import { Store, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import ExplorerLink from "@/components/ui/explorer-link";
import { useStockRampAccounts } from "@/hooks/queries/useStockRampAccounts";
import { useXStockAssets } from "@/hooks/useXStockPrices";
import { XSTOCKS_MINTS } from "@/lib/constant";
import { ESCROW_TYPE, decodeCurrency } from "@/types/stockRamp";

interface ProviderSummary {
  maker: string;
  buyOrders: number;
  sellOrders: number;
  currencies: Set<string>;
  symbols: Set<string>;
}

export default function ProvidersPage() {
  const { data: orders, isLoading } = useStockRampAccounts();
  const { data: assets } = useXStockAssets();

  const mintSymbolByAddress = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const [symbol, mint] of Object.entries(XSTOCKS_MINTS)) {
      map.set(mint, symbol);
    }
    return map;
  }, []);

  const providers = React.useMemo(() => {
    if (!orders) return [];
    const byMaker = new Map<string, ProviderSummary>();

    for (const { account } of orders) {
      const maker = account.maker.toBase58();
      const existing = byMaker.get(maker) ?? {
        maker,
        buyOrders: 0,
        sellOrders: 0,
        currencies: new Set<string>(),
        symbols: new Set<string>(),
      };

      if (account.escrowType === ESCROW_TYPE.BUY) existing.buyOrders += 1;
      else existing.sellOrders += 1;

      existing.currencies.add(decodeCurrency(account.currency));
      const symbol = mintSymbolByAddress.get(account.mint.toBase58());
      if (symbol) existing.symbols.add(symbol);

      byMaker.set(maker, existing);
    }

    return Array.from(byMaker.values()).sort(
      (a, b) => b.buyOrders + b.sellOrders - (a.buyOrders + a.sellOrders)
    );
  }, [orders, mintSymbolByAddress]);

  return (
    <div className="container mx-auto max-w-6xl px-4 py-8 sm:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground">Providers</h1>
        <p className="text-sm text-foreground/60">
          Liquidity providers currently offering buy or sell orders on Stock Ramp.
        </p>
      </div>

      {isLoading || (!orders && !assets) ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : providers.length === 0 ? (
        <p className="py-12 text-center text-sm text-foreground/60">
          No liquidity providers yet — be the first to{" "}
          <Link href="/stocks/merchant" className="text-primary underline">
            create an order
          </Link>
          .
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {providers.map((provider) => (
            <Card key={provider.maker}>
              <CardHeader className="space-y-1 pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Store className="h-4 w-4 text-primary" />
                  <ExplorerLink type="address" value={provider.maker}>
                    {provider.maker.slice(0, 4)}...{provider.maker.slice(-4)}
                  </ExplorerLink>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-4 text-sm text-foreground/70">
                  <span>{provider.buyOrders} buy</span>
                  <span>{provider.sellOrders} sell</span>
                </div>

                {provider.symbols.size > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {Array.from(provider.symbols).map((symbol) => (
                      <Badge key={symbol} variant="secondary">
                        {symbol}
                      </Badge>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap gap-1.5">
                  {Array.from(provider.currencies).map((currency) => (
                    <Badge key={currency} variant="outline">
                      {currency}
                    </Badge>
                  ))}
                </div>

                {/* No maker-level filter exists on /stocks yet (Filter.tsx only
                    matches search text against mint symbol/address) — link to
                    the general marketplace rather than promising a filtered view. */}
                <Link href="/stocks" className="flex items-center gap-1 text-xs font-medium text-primary">
                  Browse marketplace <ArrowRight className="h-3 w-3" />
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
