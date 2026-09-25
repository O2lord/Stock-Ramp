// client/components/StockRamp/Admin/AdminSettings.tsx
// Fee config, order pausing, validator vote threshold, and validator fee
// pool ATA setup — every `AdminAction` instruction in
// programs/stock-ramp/src/instructions/admin.rs plus
// initialize_validator_fee_pool_ata.rs, wired to `useStockRampProgram()`.
//
// Single-field controlled inputs (not react-hook-form/zod) deliberately —
// these are independent one-shot admin actions, not a single multi-field
// form to submit together, so this mirrors the lighter pattern already used
// by `BuyOrder/CancelOrReduceButton.tsx` rather than introducing a new
// schema file for a handful of primitive inputs.

"use client";

import * as React from "react";
import { PublicKey } from "@solana/web3.js";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import { useStockRampProgram } from "@/hooks/useStockRampProgram";
import { useGlobalState, globalStateQueryKey } from "@/hooks/queries/useGlobalState";
import { parseAnchorError } from "@/lib/parseAnchorError";

// Mirrors programs/stock-ramp/src/constants.rs::MAX_FEE_BASIS_POINTS (10%).
const MAX_FEE_BPS = 1000;

export function AdminSettings() {
  const { data: globalState, isLoading } = useGlobalState();
  const {
    updateFeePercentage,
    updateFeeDestination,
    pauseBuyOrders,
    pauseSellOrders,
    updateRequiredVotes,
    initializeValidatorFeePoolAta,
  } = useStockRampProgram();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [feePercent, setFeePercent] = React.useState("");
  const [feeDestination, setFeeDestination] = React.useState("");
  const [requiredVotes, setRequiredVotes] = React.useState("");
  const [feePoolMint, setFeePoolMint] = React.useState("");
  const [pendingAction, setPendingAction] = React.useState<string | null>(null);

  // Seed the editable fields from on-chain state once it loads, without
  // clobbering in-progress edits on every refetch.
  const seeded = React.useRef(false);
  React.useEffect(() => {
    if (!globalState || seeded.current) return;
    setFeePercent((globalState.feePercentage / 100).toString());
    setFeeDestination(globalState.feeDestination.toBase58());
    setRequiredVotes(globalState.requiredVotes.toString());
    seeded.current = true;
  }, [globalState]);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: globalStateQueryKey() });
  }

  async function run(action: string, fn: () => Promise<string>, successTitle: string) {
    setPendingAction(action);
    try {
      await fn();
      invalidate();
      toast({ title: successTitle });
    } catch (err) {
      const parsed = parseAnchorError(err);
      toast({ title: "Action failed", description: parsed.message, variant: "destructive" });
    } finally {
      setPendingAction(null);
    }
  }

  function handleUpdateFee() {
    const pct = Number(feePercent);
    const maxPct = MAX_FEE_BPS / 100;
    if (Number.isNaN(pct) || pct < 0 || pct > maxPct) {
      toast({ title: "Invalid fee", description: `Fee must be between 0% and ${maxPct}%.`, variant: "destructive" });
      return;
    }
    const bps = Math.round(pct * 100);
    run("fee", () => updateFeePercentage(bps), `Fee updated to ${pct}%`);
  }

  function handleUpdateDestination() {
    let destination: PublicKey;
    try {
      destination = new PublicKey(feeDestination.trim());
    } catch {
      toast({ title: "Invalid address", description: "Enter a valid Solana public key.", variant: "destructive" });
      return;
    }
    run("destination", () => updateFeeDestination(destination), "Fee destination updated");
  }

  function handlePauseBuy(paused: boolean) {
    run("pauseBuy", () => pauseBuyOrders(paused), paused ? "Buy orders paused" : "Buy orders resumed");
  }

  function handlePauseSell(paused: boolean) {
    run("pauseSell", () => pauseSellOrders(paused), paused ? "Sell orders paused" : "Sell orders resumed");
  }

  function handleUpdateRequiredVotes() {
    const n = Number(requiredVotes);
    if (!Number.isInteger(n) || n < 1 || n > 5) {
      toast({ title: "Invalid threshold", description: "Required votes must be between 1 and 5.", variant: "destructive" });
      return;
    }
    if (globalState && n > globalState.validatorCount) {
      toast({
        title: "Invalid threshold",
        description: `Only ${globalState.validatorCount} validator(s) registered.`,
        variant: "destructive",
      });
      return;
    }
    run("requiredVotes", () => updateRequiredVotes(n), `Required votes set to ${n}`);
  }

  function handleInitFeePoolAta() {
    let mint: PublicKey;
    try {
      mint = new PublicKey(feePoolMint.trim());
    } catch {
      toast({ title: "Invalid mint", description: "Enter a valid mint address.", variant: "destructive" });
      return;
    }
    run("feePoolAta", () => initializeValidatorFeePoolAta(mint), "Validator fee pool ATA initialized");
  }

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="pt-6">
              <Skeleton className="h-24 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Fee percentage</CardTitle>
          <CardDescription>
            Basis-point fee taken on completed reservations, split 20/60/20 platform/maker/validators.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-end gap-2">
          <div className="flex-1 space-y-1">
            <Label htmlFor="fee-percent">Fee (%)</Label>
            <Input
              id="fee-percent"
              type="number"
              step="0.01"
              min={0}
              max={MAX_FEE_BPS / 100}
              value={feePercent}
              onChange={(e) => setFeePercent(e.target.value)}
            />
          </div>
          <Button onClick={handleUpdateFee} disabled={pendingAction === "fee"}>
            {pendingAction === "fee" ? "Saving..." : "Update"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Fee destination</CardTitle>
          <CardDescription>Wallet that receives the platform&apos;s share of fees.</CardDescription>
        </CardHeader>
        <CardContent className="flex items-end gap-2">
          <div className="flex-1 space-y-1">
            <Label htmlFor="fee-destination">Address</Label>
            <Input
              id="fee-destination"
              value={feeDestination}
              onChange={(e) => setFeeDestination(e.target.value)}
            />
          </div>
          <Button onClick={handleUpdateDestination} disabled={pendingAction === "destination"}>
            {pendingAction === "destination" ? "Saving..." : "Update"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Order pausing</CardTitle>
          <CardDescription>Freeze new activity on one or both order books.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="pause-buy">Buy orders paused</Label>
            <Switch
              id="pause-buy"
              checked={!!globalState?.buyOrdersPaused}
              disabled={pendingAction === "pauseBuy"}
              onCheckedChange={handlePauseBuy}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="pause-sell">Sell orders paused</Label>
            <Switch
              id="pause-sell"
              checked={!!globalState?.sellOrdersPaused}
              disabled={pendingAction === "pauseSell"}
              onCheckedChange={handlePauseSell}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Required validator votes</CardTitle>
          <CardDescription>
            How many of the up-to-5 validators must agree before a vote executes.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-end gap-2">
          <div className="flex-1 space-y-1">
            <Label htmlFor="required-votes">Threshold (1-5)</Label>
            <Input
              id="required-votes"
              type="number"
              min={1}
              max={5}
              value={requiredVotes}
              onChange={(e) => setRequiredVotes(e.target.value)}
            />
          </div>
          <Button onClick={handleUpdateRequiredVotes} disabled={pendingAction === "requiredVotes"}>
            {pendingAction === "requiredVotes" ? "Saving..." : "Update"}
          </Button>
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Validator fee pool ATA</CardTitle>
          <CardDescription>
            One-time setup per xStocks mint — creates the associated token account validators earn
            into. Run this once for each mint before votes on that mint can credit validator earnings.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-end gap-2">
          <div className="flex-1 space-y-1">
            <Label htmlFor="fee-pool-mint">Mint address</Label>
            <Input
              id="fee-pool-mint"
              placeholder="e.g. XsDoVfqeBukxuZHW..."
              value={feePoolMint}
              onChange={(e) => setFeePoolMint(e.target.value)}
            />
          </div>
          <Button onClick={handleInitFeePoolAta} disabled={pendingAction === "feePoolAta"}>
            {pendingAction === "feePoolAta" ? "Initializing..." : "Initialize"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
