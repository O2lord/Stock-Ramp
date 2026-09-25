// client/components/StockRamp/Admin/GlobalStats.tsx
// Read-only overview of `GlobalState` — reuses the existing Shared stat
// cards (VolumeCard, StockRampCountCard) plus a few admin-specific ones
// (fee rate, validator count, pause status, key addresses).
// Backed by: programs/stock-ramp/src/state/global_state.rs, hooks/queries/useGlobalState.ts
//
// THEME: this was the main source of the "admin overview shows only icons"
// bug — every label, number, and address was `text-[#0F0D0A]` (near-black),
// invisible on the Terminal theme's black cards. All on tokens now.

"use client";

import type { ComponentType } from "react";
import { AlertTriangle, ShieldCheck, Users, Percent, PauseCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import ExplorerLink from "@/components/ui/explorer-link";
import { useGlobalState } from "@/hooks/queries/useGlobalState";
import { VolumeCard } from "@/components/StockRamp/Shared/VolumeCard";
import { StockRampCountCard } from "@/components/StockRamp/Shared/StockRampCountCard";

function StatCard({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 text-primary" />
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function shortAddr(addr: string) {
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

export function GlobalStats() {
  const { data: globalState, isLoading, error } = useGlobalState();

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="pt-6">
              <Skeleton className="h-16 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (error || !globalState) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 pt-6 text-sm text-muted-foreground">
          <AlertTriangle className="h-4 w-4 text-primary" />
          GlobalState hasn&apos;t been initialized on this cluster yet.
        </CardContent>
      </Card>
    );
  }

  const feePercent = (globalState.feePercentage / 100).toFixed(2);
  const totalConfirmations = globalState.totalConfirmations.toNumber();
  const totalDisputes = globalState.totalDisputes.toNumber();
  const totalFeesCollected = globalState.totalFeesCollected.toNumber();
  const activeVotes = globalState.activeVoteCount.toNumber();

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <VolumeCard />
        <StockRampCountCard />

        <StatCard title="Fee rate" icon={Percent}>
          <div className="text-2xl font-semibold text-foreground tabular">{feePercent}%</div>
          <p className="mt-1 text-xs text-muted-foreground">{totalFeesCollected} collected total</p>
        </StatCard>

        <StatCard title="Validators" icon={Users}>
          <div className="text-2xl font-semibold text-foreground tabular">
            {globalState.validatorCount} / 5
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {globalState.requiredVotes} votes required · {activeVotes} active
          </p>
        </StatCard>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Confirmations" icon={ShieldCheck}>
          <div className="text-2xl font-semibold text-foreground tabular">{totalConfirmations}</div>
        </StatCard>

        <StatCard title="Disputes" icon={AlertTriangle}>
          <div className="text-2xl font-semibold text-foreground tabular">{totalDisputes}</div>
        </StatCard>

        <StatCard title="Buy orders" icon={PauseCircle}>
          <Badge variant={globalState.buyOrdersPaused ? "destructive" : "up"}>
            {globalState.buyOrdersPaused ? "Paused" : "Active"}
          </Badge>
        </StatCard>

        <StatCard title="Sell orders" icon={PauseCircle}>
          <Badge variant={globalState.sellOrdersPaused ? "destructive" : "up"}>
            {globalState.sellOrdersPaused ? "Paused" : "Active"}
          </Badge>
        </StatCard>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">Addresses</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Authority</span>
            <ExplorerLink type="address" value={globalState.authority.toBase58()}>
              {shortAddr(globalState.authority.toBase58())}
            </ExplorerLink>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Fee destination</span>
            <ExplorerLink type="address" value={globalState.feeDestination.toBase58()}>
              {shortAddr(globalState.feeDestination.toBase58())}
            </ExplorerLink>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Validator fee pool authority</span>
            <ExplorerLink type="address" value={globalState.validatorFeePoolAuthority.toBase58()}>
              {shortAddr(globalState.validatorFeePoolAuthority.toBase58())}
            </ExplorerLink>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
