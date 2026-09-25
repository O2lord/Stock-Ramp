// client/components/StockRamp/Admin/ApiKeyModal.tsx
// One-time reveal for a freshly-minted validator API key, mirroring Trust
// Vault's ApiKeyModal step. The plaintext key is returned exactly once by
// POST /api/admin/register-validator — only its hash is persisted server
// side — so this modal is the only place it will ever be shown. Closing it
// (or navigating away) loses it for good; the admin has to remove and
// re-register the validator to mint a new one.

"use client";

import * as React from "react";
import { Copy, Check, TriangleAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";

interface ApiKeyModalProps {
  open: boolean;
  onClose: () => void;
  apiKey: string;
  walletPubkey: string;
  label?: string | null;
}

export function ApiKeyModal({ open, onClose, apiKey, walletPubkey, label }: ApiKeyModalProps) {
  const [copied, setCopied] = React.useState(false);
  const { toast } = useToast();

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Couldn't copy", description: "Select and copy the key manually.", variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Validator API key</DialogTitle>
          <DialogDescription>
            {label ? `${label} — ` : ""}
            {walletPubkey.slice(0, 4)}...{walletPubkey.slice(-4)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-surface-1 px-3 py-2">
            {/*
              `min-w-0` here is load-bearing: this is a flex item with
              `flex-1`, but a flex item's default `min-width` is `auto`,
              which for a `whitespace-nowrap` child means "at least as wide
              as my full unwrapped content." Without overriding that, this
              64-char key forces the row (and, since DialogContent is a
              `grid`, the *entire* dialog's implicit column — header,
              warning box, footer button included) to stretch to the key's
              full width instead of staying inside max-w-lg. `min-w-0`
              lets it shrink to the actual available space so
              `overflow-x-auto` can do its job (scroll within the box)
              instead of the box itself growing.
            */}
            <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-sm">{apiKey}</code>
            <Button type="button" size="sm" variant="outline" onClick={handleCopy}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </div>

          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <TriangleAlert className="h-4 w-4 shrink-0 mt-0.5" />
            <p>
              This key is shown once and never stored in plaintext. Copy it into the validator
              bot&apos;s <code>.env</code> as <code>VALIDATOR_API_KEY</code> now — if you lose it,
              remove and re-register this validator to mint a new one.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" onClick={onClose}>
            I&apos;ve saved this key
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
