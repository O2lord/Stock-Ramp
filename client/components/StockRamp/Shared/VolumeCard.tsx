// client/components/StockRamp/Shared/VolumeCard.tsx
// Trading volume stat card — reads `GlobalState.totalVolume` /
// `highWatermarkVolume` via `useGlobalState`.

"use client";

import { TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useGlobalState } from "@/hooks/queries/useGlobalState";

function formatRawUnits(raw: number | bigint): string {
  const n = typeof raw === "bigint" ? Number(raw) : raw;
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(n);
}

export function VolumeCard() {
  const { data: globalState, isLoading } = useGlobalState();

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">Total volume</CardTitle>
        <TrendingUp className="h-4 w-4 text-primary" />
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <>
            <div className="text-2xl font-semibold text-foreground tabular">
              {formatRawUnits(globalState?.totalVolume?.toNumber?.() ?? 0)}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              High watermark: {formatRawUnits(globalState?.highWatermarkVolume?.toNumber?.() ?? 0)}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
