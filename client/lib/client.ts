// client/lib/client.ts
// Anchor provider/connection setup for the Stock Ramp frontend.
//
// NOTE: this relies on @solana/web3.js, @solana/wallet-adapter-react, and
// @coral-xyz/anchor. Only @coral-xyz/anchor and @solana/spl-token are in the
// repo root's package.json today — @solana/web3.js and the wallet-adapter
// packages still need to be added (`yarn add @solana/web3.js
// @solana/wallet-adapter-react @solana/wallet-adapter-base`) before this
// compiles inside `client/`. Flagging rather than silently assuming a
// package manager run happened.

import { AnchorProvider } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import { SOLANA_RPC_ENDPOINT } from "./constant";

/** Shared connection instance — avoid re-instantiating per render. */
export const connection = new Connection(SOLANA_RPC_ENDPOINT, "confirmed");

/**
 * A no-op wallet used for read-only Anchor calls (fetching accounts, running
 * `.simulate()`) when no wallet is connected yet. Anchor's `Program`
 * constructor requires *some* `Wallet`-shaped object even for reads.
 */
export function getReadOnlyWallet(): AnchorWallet {
  const keypairLikePublicKey = PublicKey.default;
  return {
    publicKey: keypairLikePublicKey,
    // These two are never invoked for read-only usage — Anchor only calls
    // them when actually sending a signed transaction.
    signTransaction: async () => {
      throw new Error("Read-only wallet cannot sign transactions");
    },
    signAllTransactions: async () => {
      throw new Error("Read-only wallet cannot sign transactions");
    },
  } as unknown as AnchorWallet;
}

/**
 * Builds an AnchorProvider from the connected wallet-adapter wallet.
 * Pass `wallet` from `useAnchorWallet()` (or `undefined` before connect —
 * falls back to a read-only wallet so queries still work pre-connect).
 */
export function getAnchorProvider(wallet: AnchorWallet | undefined): AnchorProvider {
  return new AnchorProvider(connection, wallet ?? getReadOnlyWallet(), {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
}
