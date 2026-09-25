// client/components/StockRamp/Shared/CredentialPicker.tsx
// Dropdown of the wallet's saved payment-processor credentials (any of
// Flutterwave/OPay/Paystack), for use inside CreateBuyDialog.tsx /
// CreateSellOrderDialog.tsx's `flutterwaveCredentialId` field. The stored
// value is just the credential's row id — processor-agnostic on-chain (see
// supabase/migrations/0001_payment_processor_credentials.sql's comment).

"use client";

import * as React from "react";
import Link from "next/link";
import { ExternalLink, Loader2 } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/react-select";
import { Badge } from "@/components/ui/badge";
import { PROCESSOR_LABELS } from "@/lib/paymentProcessors/config";
import { usePaymentProcessorCredentials } from "@/hooks/usePaymentProcessorCredentials";
import type { CredentialSide } from "@/lib/paymentProcessors/config";

interface CredentialPickerProps {
  side: CredentialSide;
  value: string;
  onChange: (id: string) => void;
}

export function CredentialPicker({ side, value, onChange }: CredentialPickerProps) {
  const { allCredentials, loading } = usePaymentProcessorCredentials(side);

  return (
    <div className="space-y-2">
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-foreground/50">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading saved payment accounts...
        </div>
      ) : allCredentials.length === 0 ? (
        <p className="text-sm text-foreground/50">
          No payment accounts saved yet.{" "}
          <Link href="/stocks/merchant/settings" target="_blank" className="inline-flex items-center gap-1 text-primary underline">
            Add one in settings <ExternalLink className="h-3 w-3" />
          </Link>
        </p>
      ) : (
        <>
          <Select value={value} onValueChange={onChange}>
            <SelectTrigger>
              <SelectValue placeholder="Choose a payment account" />
            </SelectTrigger>
            <SelectContent>
              {allCredentials.map((cred) => (
                <SelectItem key={cred.id} value={cred.id}>
                  <div className="flex items-center gap-2">
                    <span>{PROCESSOR_LABELS[cred.processor]}</span>
                    <span className="text-foreground/50">— {cred.label || "Unnamed"}</span>
                    {!cred.is_active && (
                      <Badge variant="secondary" className="text-xs">
                        Inactive
                      </Badge>
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Link
            href="/stocks/merchant/settings"
            target="_blank"
            className="inline-flex items-center gap-1 text-xs text-primary underline"
          >
            Manage payment accounts <ExternalLink className="h-3 w-3" />
          </Link>
        </>
      )}
    </div>
  );
}
