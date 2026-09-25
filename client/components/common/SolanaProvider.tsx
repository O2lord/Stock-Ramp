// client/components/common/SolanaProvider.tsx
// Wallet-adapter context — ported from trust_vault's `components/SolanaProvider.tsx`.
// Same two adapters (Phantom, Solflare), same devnet choice trust_vault made
// (matches `SOLANA_CLUSTER` / `SOLANA_RPC_ENDPOINT` in `lib/constant.ts`, and
// `components/ui/explorer-link.tsx`'s hardcoded "devnet").
//
// Uses `SOLANA_RPC_ENDPOINT` (defaults to `https://api.devnet.solana.com`,
// overridable via `NEXT_PUBLIC_SOLANA_RPC_ENDPOINT`) rather than trust_vault's
// `clusterApiUrl(network)`, since stock-ramp's RPC endpoint is already a
// shared constant other files (`lib/client.ts`) depend on — one source of
// truth instead of two ways to point at "devnet".
//
// Adapters are imported from their own dedicated packages
// (`@solana/wallet-adapter-phantom` / `-solflare`), NOT the
// `@solana/wallet-adapter-wallets` barrel. That barrel re-exports every
// adapter including WalletConnect, which transitively pulls in
// `@walletconnect/solana-adapter` -> `@reown/appkit` -> `viem` -> `ox`'s
// "tempo" module (a dynamic `require` webpack can't statically analyze,
// surfaced as a "Critical dependency: the request of a dependency is an
// expression" build warning) and `pino`'s logger (which optionally wants
// `pino-pretty`, surfaced as a "Module not found: pino-pretty" warning) —
// none of it reachable code, since only Phantom/Solflare are used, but
// webpack still walks and warns on the whole barrel's module graph.
// Importing the two adapters directly avoids pulling that graph in at all.

"use client";

import React, { type PropsWithChildren, useMemo } from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import "@solana/wallet-adapter-react-ui/styles.css";

import { SOLANA_RPC_ENDPOINT } from "@/lib/constant";

export function SolanaProvider({ children }: PropsWithChildren) {
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    []
  );

  return (
    <ConnectionProvider endpoint={SOLANA_RPC_ENDPOINT}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
