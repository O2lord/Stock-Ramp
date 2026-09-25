// client/components/StockRamp/Shared/ValidatorEarningsCard.tsx
// Displays a single validator's earnings for a given mint — the real data
// comes from `useValidatorEarnings` fetching the ValidatorEarnings account
// directly (the instruction itself is a no-op — see that hook's comment).

"use client";

import { Coins } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import type { PublicKey } from "@solana/web3.js";
import { useValidatorEarnings } from "@/hooks/queries/useValidatorEarnings";

interface ValidatorEarningsCardProps {
  validator: PublicKey | null | undefined;
  mint: PublicKey | null | undefined;
  /** Symbol label for the mint, e.g. "AAPLx" — purely cosmetic. */
  mintSymbol?: string;
}

export function ValidatorEarningsCard({ validator, mint, mintSymbol }: ValidatorEarningsCardProps) {
  const { data: earnings, isLoading, error } = useValidatorEarnings(validator, mint);

  const accumulated = earnings?.accumulatedAmount?.toNumber?.() ?? 0;
  const totalEarned = earnings?.totalEarned?.toNumber?.() ?? 0;
  const totalCredits = earnings?.totalCredits?.toNumber?.() ?? 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Validator earnings{mintSymbol ? ` · ${mintSymbol}` : ""}
        </CardTitle>
        <Coins className="h-4 w-4 text-primary" />
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-8 w-24" />
        ) : error || !earnings ? (
          <div className="flex items-center gap-2">
            <p className="text-sm text-muted-foreground">No earnings yet for this mint.</p>
            <Badge variant="secondary">0 credits</Badge>
          </div>
        ) : (
          <>
            <div className="text-2xl font-semibold text-foreground tabular">{accumulated}</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Claimable now · {totalEarned} earned lifetime · {totalCredits} vote credits
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
