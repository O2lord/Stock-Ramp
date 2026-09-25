// client/components/StockRamp/Shared/CredentialManager.tsx
// Generic add/list/verify/delete UI for one processor + one side at a time.
// One component instead of trust_vault's 6 near-duplicate
// {Flutterwave,Korapay,OPay,Paystack}{Buyer,Seller}CredentialManager.tsx
// files — the only thing that varies between them is which fields to render
// and which table to hit, both already captured in lib/paymentProcessors/config.ts.

"use client";

import * as React from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  Shield,
  Plus,
  Trash2,
  RefreshCw,
  Eye,
  EyeOff,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";

import {
  PROCESSOR_LABELS,
  PROCESSOR_FIELDS,
  type Processor,
  type CredentialSide,
  type ProcessorFields,
} from "@/lib/paymentProcessors/config";
import {
  usePaymentProcessorCredentials,
  type CredentialSummary,
  type VerifyResult,
} from "@/hooks/usePaymentProcessorCredentials";

interface CredentialManagerProps {
  processor: Processor;
  side: CredentialSide;
}

export function CredentialManager({ processor, side }: CredentialManagerProps) {
  const { publicKey } = useWallet();
  const { toast } = useToast();
  const {
    credentialsByProcessor,
    loading,
    testConnection,
    addCredential,
    deleteCredential,
    refreshStatus,
  } = usePaymentProcessorCredentials(side);

  const credentials = credentialsByProcessor[processor];
  const fieldDefs = PROCESSOR_FIELDS[processor];

  const [showAddDialog, setShowAddDialog] = React.useState(false);
  const [formValues, setFormValues] = React.useState<ProcessorFields>({});
  const [label, setLabel] = React.useState("");
  const [revealed, setRevealed] = React.useState<Record<string, boolean>>({});
  const [testResult, setTestResult] = React.useState<VerifyResult | null>(null);
  const [testing, setTesting] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [checkingId, setCheckingId] = React.useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = React.useState<string | null>(null);

  const resetForm = () => {
    setFormValues({});
    setLabel("");
    setTestResult(null);
    setRevealed({});
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testConnection(processor, formValues);
      setTestResult(result);
      if (result.valid) {
        toast({ title: "Credentials verified", description: "Connection to " + PROCESSOR_LABELS[processor] + " succeeded." });
      } else {
        toast({ title: "Invalid credentials", description: result.error, variant: "destructive" });
      }
    } catch (err) {
      toast({ title: "Test failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await addCredential(processor, formValues, label.trim() || undefined);
      toast({ title: "Credential saved", description: `${PROCESSOR_LABELS[processor]} account added.` });
      setShowAddDialog(false);
      resetForm();
    } catch (err) {
      toast({ title: "Couldn't save credential", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (credentialId: string) => {
    try {
      await deleteCredential(processor, credentialId);
      toast({ title: "Credential removed" });
      setDeleteConfirmId(null);
    } catch (err) {
      toast({ title: "Couldn't delete credential", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    }
  };

  const handleCheckStatus = async (credential: CredentialSummary) => {
    setCheckingId(credential.id);
    try {
      const result = await refreshStatus(processor, credential.id);
      if (result.valid) {
        toast({
          title: "Still valid",
          description: result.balance !== undefined ? `Balance: ${result.balance} ${result.currency ?? ""}` : undefined,
        });
      } else {
        toast({ title: "Credential is no longer valid", description: result.error, variant: "destructive" });
      }
    } finally {
      setCheckingId(null);
    }
  };

  const isFormComplete = fieldDefs.every((f) => formValues[f.key]?.trim());

  if (!publicKey) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{PROCESSOR_LABELS[processor]}</CardTitle>
          <CardDescription>Connect your wallet to manage {PROCESSOR_LABELS[processor]} credentials.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Shield className="h-5 w-5 text-primary" />
                {PROCESSOR_LABELS[processor]}
              </CardTitle>
              <CardDescription>
                {side === "buyer"
                  ? "Used to send fiat payouts when your buy orders are reserved."
                  : "Used to collect fiat payments for your sell orders."}
              </CardDescription>
            </div>
            <Button size="sm" onClick={() => setShowAddDialog(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add account
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-foreground/40" />
            </div>
          ) : credentials.length === 0 ? (
            <div className="py-8 text-center text-sm text-foreground/50">
              No {PROCESSOR_LABELS[processor]} account saved yet.
            </div>
          ) : (
            <div className="space-y-3">
              {credentials.map((credential) => (
                <div
                  key={credential.id}
                  className="flex items-center justify-between rounded-lg border border-border bg-background/40 p-3"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-foreground">{credential.label || "Unnamed account"}</p>
                      <Badge variant={credential.is_active ? "default" : "secondary"}>
                        {credential.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                    <p className="text-xs text-foreground/40">
                      Added {new Date(credential.created_at).toLocaleDateString()}
                      {credential.last_verified &&
                        ` · Last checked ${new Date(credential.last_verified).toLocaleDateString()}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleCheckStatus(credential)}
                      disabled={checkingId === credential.id}
                    >
                      {checkingId === credential.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeleteConfirmId(credential.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={showAddDialog}
        onOpenChange={(open) => {
          setShowAddDialog(open);
          if (!open) resetForm();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add {PROCESSOR_LABELS[processor]} account</DialogTitle>
            <DialogDescription>
              Enter your {PROCESSOR_LABELS[processor]} API credentials. They're encrypted before storage and only
              decrypted server-side when processing a payout.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cred-label">Label (optional)</Label>
              <Input
                id="cred-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Main business account"
              />
            </div>

            {fieldDefs.map((def) => (
              <div key={def.key} className="space-y-2">
                <Label htmlFor={`cred-${def.key}`}>{def.label}</Label>
                <div className="relative">
                  <Input
                    id={`cred-${def.key}`}
                    type={def.secret && !revealed[def.key] ? "password" : "text"}
                    value={formValues[def.key] ?? ""}
                    onChange={(e) =>
                      setFormValues((prev) => ({ ...prev, [def.key]: e.target.value }))
                    }
                    placeholder={def.placeholder}
                    className={def.secret ? "pr-10" : undefined}
                  />
                  {def.secret && (
                    <button
                      type="button"
                      onClick={() => setRevealed((prev) => ({ ...prev, [def.key]: !prev[def.key] }))}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground/40 hover:text-foreground"
                    >
                      {revealed[def.key] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  )}
                </div>
              </div>
            ))}

            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={handleTest}
              disabled={testing || !isFormComplete}
            >
              {testing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Testing...
                </>
              ) : (
                "Test connection"
              )}
            </Button>

            {testResult && (
              <div
                className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${
                  testResult.valid
                    ? "border-primary/30 bg-primary/5 text-foreground"
                    : "border-destructive/30 bg-destructive/5 text-destructive"
                }`}
              >
                {testResult.valid ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
                ) : (
                  <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                )}
                <div>
                  <p>{testResult.valid ? "Credentials verified" : testResult.error}</p>
                  {testResult.valid && testResult.balance !== undefined && (
                    <p className="text-xs text-foreground/60">
                      Balance: {testResult.balance} {testResult.currency}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || !isFormComplete}>
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save account"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove this account?</DialogTitle>
            <DialogDescription>
              This can't be undone. Make sure no active orders still reference this credential — they'll fail to pay
              out or collect fiat if it's removed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => deleteConfirmId && handleDelete(deleteConfirmId)}>
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
