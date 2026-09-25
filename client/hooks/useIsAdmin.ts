// client/hooks/useIsAdmin.ts
// Central "is this connected wallet allowed into /admin" check, used by
// `app/admin/page.tsx` (page-level gate) and `components/common/Navbar/*`
// (nav-item visibility).
//
// Two independent layers, because `GlobalState` might not exist yet on this
// cluster:
//
//  1. Bootstrap: `ADMIN_WALLET_ADDRESS` (lib/constant.ts) is treated as admin
//     unconditionally. This is the wallet expected to call
//     `initializeGlobalState()` for the first time — without this escape
//     hatch nobody could ever reach the admin page to bootstrap the program,
//     since `GlobalState.authority` doesn't exist before that call succeeds.
//  2. Once `GlobalState` exists, the on-chain source of truth takes over:
//     `GlobalState.authority` is the real authority every `AdminAction`
//     instruction actually checks (`has_one = authority` in
//     `instructions/admin.rs`). Kept as a second, independent check (rather
//     than replacing #1) so the bootstrap wallet never locks itself out if
//     authority is ever rotated to a different key without updating this
//     constant — it fails open only for this one hardcoded address, not for
//     anyone else.
//
// `isValidator` is separate from `isAdmin` — a registered validator can vote
// on reservations but has none of the `AdminAction` authority above.

"use client";

import { useMemo } from "react";
import { PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { ADMIN_WALLET_ADDRESS } from "@/lib/constant";
import { useGlobalState } from "./queries/useGlobalState";

const DEFAULT_PUBKEY = new PublicKey(new Uint8Array(32));

export function useIsAdmin() {
  const { publicKey } = useWallet();
  const { data: globalState, isLoading, isError } = useGlobalState();

  const isBootstrapAdmin =
    !!publicKey && publicKey.toBase58() === ADMIN_WALLET_ADDRESS;

  const isAuthority =
    !!publicKey && !!globalState && globalState.authority.equals(publicKey);

  const isValidator = useMemo(() => {
    if (!publicKey || !globalState) return false;
    return globalState.validators.some(
      (v) => !v.equals(DEFAULT_PUBKEY) && v.equals(publicKey)
    );
  }, [publicKey, globalState]);

  // GlobalState 404s (react-query error, no retry) until
  // `initializeGlobalState()` has been called once on this cluster.
  const globalStateInitialized = !isLoading && !isError && !!globalState;

  return {
    isAdmin: isBootstrapAdmin || isAuthority,
    isValidator,
    isBootstrapAdmin,
    isAuthority,
    globalStateInitialized,
    isLoadingGlobalState: isLoading,
  };
}
