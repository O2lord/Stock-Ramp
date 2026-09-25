// client/hooks/usePaymentProcessorCredentials.ts
// Client-side data layer for the payment-processor credentials feature.
// One hook covers all 3 processors for a given side (buyer/seller) — the
// settings page renders one instance per processor tab; CreateBuyDialog /
// CreateSellOrderDialog use it to populate the credential picker.

"use client";

import * as React from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import bs58 from "bs58";

import {
  PROCESSORS,
  type Processor,
  type CredentialSide,
  type ProcessorFields,
} from "@/lib/paymentProcessors/config";

export interface CredentialSummary {
  id: string;
  wallet_address: string;
  processor: Processor;
  label: string | null;
  processor_account_id: string | null;
  is_active: boolean;
  last_verified: string | null;
  created_at: string;
  updated_at: string;
}

export interface VerifyResult {
  valid: boolean;
  balance?: number;
  currency?: string;
  error?: string;
}

function generateAuthMessage(action: string): string {
  const timestamp = Date.now();
  const nonce = Math.random().toString(36).substring(2, 15);
  return (
    `Sign this message to authenticate with Stock Ramp.\n\n` +
    `Action: ${action}\n` +
    `Timestamp: ${timestamp}\n` +
    `Nonce: ${nonce}\n\n` +
    `This signature will not cost any gas fees.`
  );
}

export function usePaymentProcessorCredentials(side: CredentialSide) {
  const { publicKey, signMessage } = useWallet();

  const [credentialsByProcessor, setCredentialsByProcessor] = React.useState<
    Record<Processor, CredentialSummary[]>
  >({ flutterwave: [], korapay: [], opay: [], paystack: [] });
  const [loading, setLoading] = React.useState(false);

  const walletAddress = publicKey?.toBase58();

  const fetchAll = React.useCallback(async () => {
    if (!walletAddress) return;
    setLoading(true);
    try {
      const results = await Promise.all(
        PROCESSORS.map(async (processor) => {
          const res = await fetch(
            `/api/payment-processors/${processor}/${side}-credentials/list?walletAddress=${walletAddress}`
          );
          if (!res.ok) return [processor, [] as CredentialSummary[]] as const;
          const data = await res.json();
          return [processor, (data.credentials ?? []) as CredentialSummary[]] as const;
        })
      );
      setCredentialsByProcessor((prev) => {
        const next = { ...prev };
        for (const [processor, list] of results) next[processor] = list;
        return next;
      });
    } finally {
      setLoading(false);
    }
  }, [walletAddress, side]);

  React.useEffect(() => {
    if (walletAddress) fetchAll();
  }, [walletAddress, fetchAll]);

  const signAuthMessage = React.useCallback(
    async (action: string) => {
      if (!signMessage) throw new Error("Wallet does not support message signing");
      const message = generateAuthMessage(action);
      const signature = bs58.encode(await signMessage(new TextEncoder().encode(message)));
      return { message, signature };
    },
    [signMessage]
  );

  const testConnection = React.useCallback(
    async (processor: Processor, fields: ProcessorFields): Promise<VerifyResult> => {
      const res = await fetch(`/api/payment-processors/${processor}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      return res.json();
    },
    []
  );

  const addCredential = React.useCallback(
    async (processor: Processor, fields: ProcessorFields, label?: string) => {
      if (!walletAddress) throw new Error("Connect your wallet first");
      const { message, signature } = await signAuthMessage("store_credentials");

      const res = await fetch(`/api/payment-processors/${processor}/${side}-credentials/store`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress, signature, message, label, ...fields }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error ?? "Failed to save credential");
      }
      await fetchAll();
      return data as { credential: CredentialSummary; balance?: number; currency?: string };
    },
    [walletAddress, side, signAuthMessage, fetchAll]
  );

  const deleteCredential = React.useCallback(
    async (processor: Processor, credentialId: string) => {
      if (!walletAddress) throw new Error("Connect your wallet first");
      const { message, signature } = await signAuthMessage("delete_credential");

      const params = new URLSearchParams({ credentialId, walletAddress, signature, message });
      const res = await fetch(
        `/api/payment-processors/${processor}/${side}-credentials/delete?${params}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error ?? "Failed to delete credential");
      }
      await fetchAll();
    },
    [walletAddress, side, signAuthMessage, fetchAll]
  );

  const refreshStatus = React.useCallback(
    async (processor: Processor, credentialId: string): Promise<VerifyResult> => {
      if (!walletAddress) throw new Error("Connect your wallet first");
      const params = new URLSearchParams({ credentialId, walletAddress });
      const res = await fetch(
        `/api/payment-processors/${processor}/${side}-credentials/status?${params}`
      );
      const result = (await res.json()) as VerifyResult;
      await fetchAll();
      return result;
    },
    [walletAddress, side, fetchAll]
  );

  /**
   * Links a saved credential to a just-created on-chain order, for off-chain
   * lookups only (see supabase/migrations/0007_order_credential_links.sql).
   * NOT required for on-chain correctness — create_buy_order/create_sell_order
   * already store the credential id directly on the StockRampOrder account.
   * Callers should treat a rejected/thrown result here as non-fatal: the
   * order is already live on-chain regardless of whether this link succeeds.
   */
  const linkToOrder = React.useCallback(
    async (processor: Processor, credentialId: string, stockRampOrder: string) => {
      if (!walletAddress) throw new Error("Connect your wallet first");
      const action = side === "buyer" ? "link_buy_order_credential" : "link_sell_order_credential";
      const { message, signature } = await signAuthMessage(action);

      const res = await fetch(`/api/payment-processors/${processor}/${side}-credentials/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stockRampOrder, credentialId, walletAddress, signature, message }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error ?? "Failed to link credential to order");
      }
      return data as { data: { id: string; stock_ramp_order: string } };
    },
    [walletAddress, side, signAuthMessage]
  );

  const allCredentials = React.useMemo(
    () => PROCESSORS.flatMap((p) => credentialsByProcessor[p] ?? []),
    [credentialsByProcessor]
  );

  return {
    credentialsByProcessor,
    allCredentials,
    loading,
    refetch: fetchAll,
    testConnection,
    addCredential,
    deleteCredential,
    refreshStatus,
    linkToOrder,
  };
}
