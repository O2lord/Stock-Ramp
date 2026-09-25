// client/components/StockRamp/Shared/StockRampCountCard.tsx
// Order count stat card — reads `GlobalState.totalStockRampCreated` /
// `totalStockRampClosed` via `useGlobalState`.

"use client";

import { ListChecks } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useGlobalState } from "@/hooks/queries/useGlobalState";

export function StockRampCountCard() {
  const { data: globalState, isLoading } = useGlobalState();

  const created = globalState?.totalStockRampCreated?.toNumber?.() ?? 0;
  const closed = globalState?.totalStockRampClosed?.toNumber?.() ?? 0;
  const open = Math.max(created - closed, 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">Orders</CardTitle>
        <ListChecks className="h-4 w-4 text-primary" />
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-8 w-16" />
        ) : (
          <>
            <div className="text-2xl font-semibold text-foreground tabular">{open}</div>
            <p className="mt-1 text-xs text-muted-foreground">
              {created} created total · {closed} closed
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
