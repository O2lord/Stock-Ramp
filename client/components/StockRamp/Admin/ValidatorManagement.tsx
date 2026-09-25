// client/components/StockRamp/Admin/ValidatorManagement.tsx
// Validator list/register/remove + earnings lookup. Reuses
// `Shared/ValidatorEarningsCard.tsx` for the earnings lookup panel.
//
// `remove_validator` requires `active_vote_count == 0` on-chain
// (StockRampError::ActiveVotesInProgress) — the Remove button is disabled
// whenever there's an active vote in progress rather than letting the
// transaction fail, since that's a known, checkable precondition.
//
// Off-chain sync: after each on-chain register/remove transaction confirms,
// this component calls POST /api/admin/register-validator or
// /api/admin/remove-validator (supabase/migrations/0005_validators.sql) to
// mint or revoke the validator bot's x-validator-key — closing the gap
// where the "Register" button only performed the on-chain step and new
// validators had no way to get a working API key. If the on-chain tx
// succeeds but the off-chain sync call fails (network blip, Supabase
// down), the validator IS registered/removed on-chain regardless — that's
// surfaced as a distinct warning rather than implying the whole action
// failed, since retrying the on-chain step would just error as
// already-registered / already-removed.

"use client";

import * as React from "react";
import { PublicKey } from "@solana/web3.js";
import { useQueryClient } from "@tanstack/react-query";
import { UserPlus, UserMinus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import ExplorerLink from "@/components/ui/explorer-link";
import ConfirmationDialog from "@/components/ui/confirmation-dialog";
import { useToast } from "@/components/ui/use-toast";
import { useStockRampProgram } from "@/hooks/useStockRampProgram";
import { useGlobalState, globalStateQueryKey } from "@/hooks/queries/useGlobalState";
import { ValidatorEarningsCard } from "@/components/StockRamp/Shared/ValidatorEarningsCard";
import { ApiKeyModal } from "@/components/StockRamp/Admin/ApiKeyModal";
import { parseAnchorError } from "@/lib/parseAnchorError";

const DEFAULT_PUBKEY = new PublicKey(new Uint8Array(32));

function shortAddr(pk: PublicKey) {
  const s = pk.toBase58();
  return `${s.slice(0, 4)}...${s.slice(-4)}`;
}

interface RevealedKey {
  apiKey: string;
  walletPubkey: string;
  label: string | null;
}

export function ValidatorManagement() {
  const { data: globalState, isLoading } = useGlobalState();
  const { registerValidator, removeValidator, wallet } = useStockRampProgram();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [newValidator, setNewValidator] = React.useState("");
  const [newLabel, setNewLabel] = React.useState("");
  const [isRegistering, setIsRegistering] = React.useState(false);
  const [removeTarget, setRemoveTarget] = React.useState<PublicKey | null>(null);
  const [isRemoving, setIsRemoving] = React.useState(false);
  const [revealedKey, setRevealedKey] = React.useState<RevealedKey | null>(null);

  const [earningsValidator, setEarningsValidator] = React.useState("");
  const [earningsMint, setEarningsMint] = React.useState("");

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: globalStateQueryKey() });
  }

  async function handleRegister() {
    if (!wallet) {
      toast({ title: "Wallet not connected", variant: "destructive" });
      return;
    }
    let validator: PublicKey;
    try {
      validator = new PublicKey(newValidator.trim());
    } catch {
      toast({ title: "Invalid address", description: "Enter a valid Solana public key.", variant: "destructive" });
      return;
    }
    const label = newLabel.trim() || undefined;
    setIsRegistering(true);
    try {
      const txSignature = await registerValidator(validator);
      invalidate();
      setNewValidator("");
      setNewLabel("");

      // On-chain step succeeded — now provision the off-chain API key. A
      // failure here doesn't undo the on-chain registration, so it's
      // reported as its own warning rather than as "registration failed".
      try {
        const res = await fetch("/api/admin/register-validator", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            adminPubkey: wallet.toBase58(),
            validatorPubkey: validator.toBase58(),
            label,
            txSignature,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "Failed to provision API key");

        setRevealedKey({ apiKey: data.apiKey, walletPubkey: data.walletPubkey, label: data.label ?? null });
        toast({ title: "Validator registered", description: shortAddr(validator) });
      } catch (syncErr) {
        toast({
          title: "Validator registered on-chain, but key provisioning failed",
          description:
            syncErr instanceof Error
              ? `${syncErr.message} — retry from this panel, or set VALIDATOR_API_KEY manually.`
              : "Retry provisioning the API key, or set VALIDATOR_API_KEY manually.",
          variant: "destructive",
        });
      }
    } catch (err) {
      const parsed = parseAnchorError(err);
      toast({ title: "Couldn't register validator", description: parsed.message, variant: "destructive" });
    } finally {
      setIsRegistering(false);
    }
  }

  async function handleRemove() {
    if (!removeTarget) return;
    if (!wallet) {
      toast({ title: "Wallet not connected", variant: "destructive" });
      return;
    }
    const target = removeTarget;
    setIsRemoving(true);
    try {
      const txSignature = await removeValidator(target);
      invalidate();
      setRemoveTarget(null);
      toast({ title: "Validator removed", description: shortAddr(target) });

      // Revoke the off-chain key so it stops working immediately, rather
      // than only after someone manually edits VALIDATOR_API_KEYS.
      try {
        const res = await fetch("/api/admin/remove-validator", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            adminPubkey: wallet.toBase58(),
            validatorPubkey: target.toBase58(),
            txSignature,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error ?? "Failed to revoke API key");
        }
      } catch (syncErr) {
        toast({
          title: "Validator removed on-chain, but key revocation failed",
          description:
            syncErr instanceof Error
              ? `${syncErr.message} — remove the key from VALIDATOR_API_KEYS manually if it was set there.`
              : "Revoke the validator's key manually if needed.",
          variant: "destructive",
        });
      }
    } catch (err) {
      const parsed = parseAnchorError(err);
      toast({ title: "Couldn't remove validator", description: parsed.message, variant: "destructive" });
    } finally {
      setIsRemoving(false);
    }
  }

  const activeValidators = (globalState?.validators ?? []).filter(
    (v) => !v.equals(DEFAULT_PUBKEY)
  );
  const activeVotes = globalState?.activeVoteCount?.toNumber?.() ?? 0;
  const slotsFull = (globalState?.validatorCount ?? 0) >= 5;

  let parsedEarningsValidator: PublicKey | null = null;
  let parsedEarningsMint: PublicKey | null = null;
  try {
    if (earningsValidator.trim()) parsedEarningsValidator = new PublicKey(earningsValidator.trim());
  } catch {
    parsedEarningsValidator = null;
  }
  try {
    if (earningsMint.trim()) parsedEarningsMint = new PublicKey(earningsMint.trim());
  } catch {
    parsedEarningsMint = null;
  }

  if (isLoading) {
    return <Skeleton className="h-48 w-full" />;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Registered validators</CardTitle>
          <CardDescription>
            Up to 5 validators vote on reservations. {globalState?.requiredVotes ?? 0} of{" "}
            {globalState?.validatorCount ?? 0} registered must agree to execute a vote.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {activeValidators.length === 0 ? (
            <p className="text-sm text-muted-foreground">No validators registered yet.</p>
          ) : (
            activeValidators.map((validator) => (
              <div
                key={validator.toBase58()}
                className="flex items-center justify-between rounded-md border border-border px-3 py-2"
              >
                <ExplorerLink type="address" value={validator.toBase58()}>
                  {shortAddr(validator)}
                </ExplorerLink>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => setRemoveTarget(validator)}
                  disabled={activeVotes > 0}
                >
                  <UserMinus className="mr-1 h-3.5 w-3.5" />
                  Remove
                </Button>
              </div>
            ))
          )}
          {activeVotes > 0 && (
            <p className="text-xs text-muted-foreground">
              {activeVotes} active vote(s) in progress — validators can&apos;t be removed until they
              clear.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Register a validator</CardTitle>
          <CardDescription>
            {slotsFull
              ? "All 5 validator slots are full."
              : "Add a new validator wallet. Registering also provisions an x-validator-key for its bot — you'll see it once."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <Label htmlFor="new-validator">Validator address</Label>
              <Input
                id="new-validator"
                placeholder="Validator wallet public key"
                value={newValidator}
                onChange={(e) => setNewValidator(e.target.value)}
                disabled={slotsFull}
              />
            </div>
            <div className="w-40 space-y-1">
              <Label htmlFor="new-validator-label">Label (optional)</Label>
              <Input
                id="new-validator-label"
                placeholder="e.g. bot-1"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                disabled={slotsFull}
              />
            </div>
            <Button onClick={handleRegister} disabled={slotsFull || isRegistering}>
              <UserPlus className="mr-1 h-3.5 w-3.5" />
              {isRegistering ? "Registering..." : "Register"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Check validator earnings</CardTitle>
          <CardDescription>Look up a validator&apos;s accumulated earnings for a specific mint.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="earnings-validator">Validator address</Label>
              <Input
                id="earnings-validator"
                value={earningsValidator}
                onChange={(e) => setEarningsValidator(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="earnings-mint">Mint address</Label>
              <Input
                id="earnings-mint"
                value={earningsMint}
                onChange={(e) => setEarningsMint(e.target.value)}
              />
            </div>
          </div>
          {parsedEarningsValidator && parsedEarningsMint && (
            <ValidatorEarningsCard validator={parsedEarningsValidator} mint={parsedEarningsMint} />
          )}
        </CardContent>
      </Card>

      {removeTarget && (
        <ConfirmationDialog
          isOpen
          onClose={() => setRemoveTarget(null)}
          onConfirm={handleRemove}
          isProcessing={isRemoving}
          title="Remove this validator?"
          confirmText="Remove"
          description={`${removeTarget.toBase58()} will no longer be able to vote on reservations. Its API key will also be revoked.`}
        />
      )}

      {revealedKey && (
        <ApiKeyModal
          open
          onClose={() => setRevealedKey(null)}
          apiKey={revealedKey.apiKey}
          walletPubkey={revealedKey.walletPubkey}
          label={revealedKey.label}
        />
      )}
    </div>
  );
}
