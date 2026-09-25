// client/app/stocks/page.tsx
// The main Stock Ramp marketplace — Buy/Sell order books.
//
// GlobalStatsTicker is deliberately rendered OUTSIDE the padded `container`
// below, as the very first thing on the page, full-bleed edge-to-edge: it
// sits flush under the persistent Navbar (app/layout.tsx), not indented
// like a normal section.
//
// THEME: page chrome now uses the Terminal tokens — the heading picks up
// the tight tracking used across the app, and the paused-orders banner uses
// `bg-destructive/10` + `text-destructive` rather than a raw red, so it
// reads correctly in both modes.

"use client";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { GlobalStatsTicker } from "@/components/StockRamp/Shared/GlobalStatsTicker";
import { BuyOrderGrid } from "@/components/StockRamp/BuyOrder/BuyOrderGrid";
import { SellOrderGrid } from "@/components/StockRamp/SellOrder/SellOrderGrid";
import { CreateBuyButton } from "@/components/StockRamp/BuyOrder/CreateBuyButton";
import { CreateSellOrderButton } from "@/components/StockRamp/SellOrder/CreateSellOrderButton";
import { useGlobalState } from "@/hooks/queries/useGlobalState";

export default function StocksPage() {
  const { data: globalState } = useGlobalState();

  return (
    <>
      <GlobalStatsTicker />

      <div className="container mx-auto max-w-6xl px-4 py-8 sm:px-8">
        <div className="mb-6">
          <h1 className="text-xl font-bold tracking-tight text-foreground">Stocks</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Browse live buy and sell orders for xStocks, or create your own.
          </p>
        </div>

        {globalState?.buyOrdersPaused || globalState?.sellOrdersPaused ? (
          <div className="mb-6 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {globalState.buyOrdersPaused && globalState.sellOrdersPaused
              ? "Buy and sell orders are currently paused by the protocol authority."
              : globalState.buyOrdersPaused
              ? "Buy orders are currently paused by the protocol authority."
              : "Sell orders are currently paused by the protocol authority."}
          </div>
        ) : null}

        <Tabs defaultValue="buy" className="space-y-4">
          <TabsList>
            <TabsTrigger value="buy">Buy orders</TabsTrigger>
            <TabsTrigger value="sell">Sell orders</TabsTrigger>
          </TabsList>

          <TabsContent value="buy" className="space-y-4">
            <div className="flex justify-end">
              <CreateBuyButton />
            </div>
            <BuyOrderGrid />
          </TabsContent>

          <TabsContent value="sell" className="space-y-4">
            <div className="flex justify-end">
              <CreateSellOrderButton />
            </div>
            <SellOrderGrid />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
