// client/app/stocks/merchant/page.tsx
// Maker/validator dashboard — "my orders" plus validator-earnings visibility.
//
// The multi-processor fiat CredentialsManager UI (flutterwave/korapay/opay/
// paystack — see discord-bot/lib/*-credentials-bot.ts) now lives at
// `/stocks/merchant/settings` (components/StockRamp/Shared/CredentialManager.tsx
// + CredentialPicker.tsx), linked from the header below. This page itself
// stays scoped to browsing/managing your own on-chain orders.
//
// BuyOrderGrid/SellOrderGrid don't take a `mineOnly` prop (they own that
// toggle internally via Filter.tsx) — rather than fork them for this page,
// this mounts the same grids and prompts the merchant to flip "My orders",
// which is one click. A cleaner option is threading a `defaultMineOnly` prop
// through Filter/BuyOrderGrid/SellOrderGrid later if this page's usage shows
// it's worth the extra prop surface.

"use client";

import * as React from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { Store, ShieldCheck, Settings } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConnectWalletButton } from "@/components/common/ConnectWalletButton";
import { BuyOrderGrid } from "@/components/StockRamp/BuyOrder/BuyOrderGrid";
import { SellOrderGrid } from "@/components/StockRamp/SellOrder/SellOrderGrid";
import { CreateBuyButton } from "@/components/StockRamp/BuyOrder/CreateBuyButton";
import { CreateSellOrderButton } from "@/components/StockRamp/SellOrder/CreateSellOrderButton";
import { useIsAdmin } from "@/hooks/useIsAdmin";

export default function MerchantPage() {
  const { connected, publicKey } = useWallet();
  const { isValidator } = useIsAdmin();

  if (!connected || !publicKey) {
    return (
      <div className="container mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-8 text-center">
        <Store className="h-8 w-8 text-primary" />
        <h1 className="text-xl font-semibold text-foreground">Merchant dashboard</h1>
        <p className="text-sm text-foreground/60">
          Connect a wallet to create orders and manage your own liquidity.
        </p>
        <ConnectWalletButton />
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-6xl px-4 py-8 sm:px-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Merchant</h1>
          <p className="text-sm text-foreground/60">
            Manage your buy and sell orders as a liquidity provider.
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/stocks/merchant/settings">
            <Settings className="mr-2 h-4 w-4" />
            Payment settings
          </Link>
        </Button>
      </div>

      {isValidator && (
        <Card className="mb-6 border-primary/30 bg-primary/5">
          <CardHeader className="flex flex-row items-center gap-2 space-y-0 pb-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <CardTitle className="text-sm font-medium text-foreground">
              You're a registered validator
            </CardTitle>
          </CardHeader>
          <CardContent>
            <CardDescription>
              Reservation votes and earnings claims currently happen via the validator bot process
              (see <code className="text-xs">validator-bot/</code>), not this page. Per-mint earnings
              lookup is available once <code className="text-xs">XSTOCKS_MINTS</code> is filled in —
              see lib/constant.ts.
            </CardDescription>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="buy" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="buy">My buy orders</TabsTrigger>
            <TabsTrigger value="sell">My sell orders</TabsTrigger>
          </TabsList>
          <p className="text-xs text-foreground/50">
            Tip: toggle <span className="font-medium text-foreground/70">My orders</span> in the filter
            bar below to see just your own.
          </p>
        </div>

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
  );
}
