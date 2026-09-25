// client/app/admin/page.tsx
// Gates in three stages before rendering `AdminDashboard`:
//   1. Wallet must be connected.
//   2. Wallet must pass `useIsAdmin()` (bootstrap ADMIN_WALLET_ADDRESS or
//      on-chain GlobalState.authority — see hooks/useIsAdmin.ts).
//   3. GlobalState must exist on this cluster — if not, and the wallet is
//      the bootstrap admin, offer to call `initializeGlobalState()` right
//      here instead of leaving the admin stuck outside their own page.
//
// THEME: every gate screen used to hardcode `text-[#0F0D0A]` (near-black) —
// invisible on the Terminal theme's black background, which is why the
// admin overview rendered as an all-black page with only icons and badges
// visible. Now on tokens throughout.

"use client";

import * as React from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useQueryClient } from "@tanstack/react-query";
import { ShieldAlert, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConnectWalletButton } from "@/components/common/ConnectWalletButton";
import { useToast } from "@/components/ui/use-toast";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useStockRampProgram } from "@/hooks/useStockRampProgram";
import { globalStateQueryKey } from "@/hooks/queries/useGlobalState";
import { parseAnchorError } from "@/lib/parseAnchorError";
import { AdminDashboard } from "@/components/StockRamp/Admin/AdminDashboard";

export default function AdminPage() {
  const { connected, publicKey } = useWallet();
  const { isAdmin, isBootstrapAdmin, globalStateInitialized, isLoadingGlobalState } = useIsAdmin();
  const { initializeGlobalState } = useStockRampProgram();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isInitializing, setIsInitializing] = React.useState(false);

  async function handleInitialize() {
    setIsInitializing(true);
    try {
      await initializeGlobalState();
      await queryClient.invalidateQueries({ queryKey: globalStateQueryKey() });
      toast({ title: "Global state initialized", description: "Stock Ramp is now bootstrapped on this cluster." });
    } catch (err) {
      const parsed = parseAnchorError(err);
      toast({ title: "Couldn't initialize", description: parsed.message, variant: "destructive" });
    } finally {
      setIsInitializing(false);
    }
  }

  if (!connected) {
    return (
      <div className="container mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-8 text-center">
        <ShieldAlert className="h-8 w-8 text-primary" />
        <h1 className="text-xl font-semibold text-foreground">Admin access</h1>
        <p className="text-sm text-muted-foreground">
          Connect the program authority&apos;s wallet to manage Stock Ramp.
        </p>
        <ConnectWalletButton />
      </div>
    );
  }

  if (isLoadingGlobalState) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="container mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-8 text-center">
        <ShieldAlert className="h-8 w-8 text-primary" />
        <h1 className="text-xl font-semibold text-foreground">Not authorized</h1>
        <p className="text-sm text-muted-foreground">
          {publicKey?.toBase58()} isn&apos;t the Stock Ramp authority. Connect the admin wallet to
          continue.
        </p>
      </div>
    );
  }

  if (!globalStateInitialized) {
    return (
      <div className="container mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-8 text-center">
        <Card className="w-full">
          <CardHeader>
            <CardTitle>Bootstrap Stock Ramp</CardTitle>
            <CardDescription>
              GlobalState hasn&apos;t been created on this cluster yet.
              {isBootstrapAdmin
                ? " As the bootstrap admin wallet, you can initialize it now — this sets you as the on-chain authority."
                : " Connect the bootstrap admin wallet to initialize it."}
            </CardDescription>
          </CardHeader>
          {isBootstrapAdmin && (
            <CardContent>
              <Button onClick={handleInitialize} disabled={isInitializing} className="w-full">
                {isInitializing ? "Initializing..." : "Initialize global state"}
              </Button>
            </CardContent>
          )}
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-6xl px-8 py-8">
      <div className="mb-6">
        <h1 className="text-xl font-bold tracking-tight text-foreground">Admin</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage fees, order pausing, and validator consensus.
        </p>
      </div>
      <AdminDashboard />
    </div>
  );
}
