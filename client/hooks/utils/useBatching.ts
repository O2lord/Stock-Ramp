// client/hooks/utils/useBatching.ts
// Generic helper for combining several Anchor instructions into one signed
// transaction, so multi-step flows (e.g. `initializeValidatorFeePoolAta` for
// several mints in a row, or an `instantReserve` immediately followed by a
// `submitBuyVote`) can be sent as a single round-trip instead of one tx per
// instruction. Not a 1:1 port (no trust_vault source was available to copy
// from) — written generically against `useStockRampProgram`'s provider.

"use client";

import { useCallback, useState } from "react";
import { Transaction, type TransactionInstruction, type TransactionSignature } from "@solana/web3.js";
import { useStockRampProgram } from "../useStockRampProgram";

interface BatchState {
  isSending: boolean;
  error: Error | null;
}

export function useBatching() {
  const { provider, connection } = useStockRampProgram();
  const [state, setState] = useState<BatchState>({ isSending: false, error: null });

  /**
   * Sends a list of already-built instructions as a single transaction.
   * Each instruction should come from `program.methods.xyz(...).instruction()`
   * rather than `.rpc()`, so it can be composed here instead of sent immediately.
   */
  const sendBatch = useCallback(
    async (instructions: TransactionInstruction[]): Promise<TransactionSignature> => {
      if (!provider.wallet?.publicKey) throw new Error("Wallet not connected");
      if (instructions.length === 0) throw new Error("No instructions to batch");

      setState({ isSending: true, error: null });
      try {
        const tx = new Transaction().add(...instructions);
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
        tx.recentBlockhash = blockhash;
        tx.feePayer = provider.wallet.publicKey;

        const signed = await provider.wallet.signTransaction(tx);
        const sig = await connection.sendRawTransaction(signed.serialize());
        await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");

        setState({ isSending: false, error: null });
        return sig;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setState({ isSending: false, error });
        throw error;
      }
    },
    [provider, connection]
  );

  return { sendBatch, ...state };
}
