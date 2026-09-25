// client/app/stocks/merchant/settings/page.tsx
// Payment processor credentials settings — the piece flagged as blocked in
// Todo.md's "TrustExpress/CredentialsManager equivalent" item. Wallet-gated
// like app/stocks/merchant/page.tsx. Two top-level tabs (buy-side / sell-side)
// since a merchant's payout account (buy side) and inbound-collection account
// (sell side) are frequently different accounts, matching trust_vault's own
// buyer/seller split. Within each side, one sub-tab per processor.
//
// Scope: single manager (this page), all 4 processors — Flutterwave, Korapay,
// OPay, Paystack — driven entirely off `PROCESSORS` in
// lib/paymentProcessors/config.ts, so adding a processor there (as Korapay
// now is) surfaces a new tab here automatically without touching this file.
// Credentials saved here surface in the picker on CreateBuyDialog.tsx /
// CreateSellOrderDialog.tsx via hooks/usePaymentProcessorCredentials.ts.

"use client";

import * as React from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Settings } from "lucide-react";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ConnectWalletButton } from "@/components/common/ConnectWalletButton";
import { CredentialManager } from "@/components/StockRamp/Shared/CredentialManager";
import { PROCESSORS, PROCESSOR_LABELS } from "@/lib/paymentProcessors/config";

export default function MerchantSettingsPage() {
  const { connected, publicKey } = useWallet();

  if (!connected || !publicKey) {
    return (
      <div className="container mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-8 text-center">
        <Settings className="h-8 w-8 text-primary" />
        <h1 className="text-xl font-semibold text-foreground">Payment settings</h1>
        <p className="text-sm text-foreground/60">
          Connect a wallet to add or manage your payment processor accounts.
        </p>
        <ConnectWalletButton />
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-3xl px-4 py-8 sm:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground">Payment settings</h1>
        <p className="text-sm text-foreground/60">
          Add your payment processor accounts here, then pick one when you create a buy or sell order.
        </p>
      </div>

      <Tabs defaultValue="buyer" className="space-y-6">
        <TabsList>
          <TabsTrigger value="buyer">Buy-order payouts</TabsTrigger>
          <TabsTrigger value="seller">Sell-order collections</TabsTrigger>
        </TabsList>

        <TabsContent value="buyer" className="space-y-4">
          <p className="text-sm text-foreground/50">
            Used to send fiat to takers when your buy orders get reserved.
          </p>
          <ProcessorTabs side="buyer" />
        </TabsContent>

        <TabsContent value="seller" className="space-y-4">
          <p className="text-sm text-foreground/50">
            Used to collect fiat from takers who reserve your sell orders.
          </p>
          <ProcessorTabs side="seller" />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ProcessorTabs({ side }: { side: "buyer" | "seller" }) {
  return (
    <Tabs defaultValue={PROCESSORS[0]} className="space-y-4">
      <TabsList>
        {PROCESSORS.map((processor) => (
          <TabsTrigger key={processor} value={processor}>
            {PROCESSOR_LABELS[processor]}
          </TabsTrigger>
        ))}
      </TabsList>
      {PROCESSORS.map((processor) => (
        <TabsContent key={processor} value={processor}>
          <CredentialManager processor={processor} side={side} />
        </TabsContent>
      ))}
    </Tabs>
  );
}
