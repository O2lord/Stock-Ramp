// client/lib/constant.ts
// Program IDs, cluster config, and mint addresses for the Stock Ramp frontend.

import { PublicKey } from "@solana/web3.js";

/**
 * Deployed program ID — confirmed live on devnet (verified via Solscan:
 * initializeGlobalState + a prior deployWithMaxDataLen both landed against
 * this exact address, so this is the real deployed keypair, not a
 * placeholder). `client/relics/stock_ramp.ts`'s embedded `address` field
 * and `programs/stock-ramp/src/lib.rs`'s `declare_id!` both mirror this
 * same value — keep all three in sync if this program is ever redeployed.
 */
export const STOCK_RAMP_PROGRAM_ID = new PublicKey(
  "5DLaeZGr4dFhoQkx2hu7QmUYGiS5qmBuNehB5fzGaUkH"
);

/** Cluster the app talks to. Mirrors `components/ui/explorer-link.tsx`'s hardcoded "devnet". */
export const SOLANA_CLUSTER: "devnet" | "mainnet-beta" | "testnet" = "devnet";

export const SOLANA_RPC_ENDPOINT =
  process.env.NEXT_PUBLIC_SOLANA_RPC_ENDPOINT ??
  "https://api.devnet.solana.com";

/**
 * Hardcoded bootstrap admin wallet, gating `/admin` before `GlobalState`
 * exists on this cluster (there's no `GlobalState.authority` to check
 * against until `initializeGlobalState()` has been called once). See
 * `hooks/useIsAdmin.ts` for the full authorization logic — this constant is
 * one of two ways in, the other being the live `GlobalState.authority`.
 * Mirrors trust_vault's hardcoded admin-address check.
 */
export const ADMIN_WALLET_ADDRESS =
  "SR4T4SpgqQv1E4Q7pMN82GwWCMez1dySTMN6K2hk2LJ";

// ---------------------------------------------------------------------
// PDA seed prefixes — mirror programs/stock-ramp/src/constants.rs exactly.
// ---------------------------------------------------------------------
export const GLOBAL_STATE_SEED = Buffer.from("global-state");
export const STOCK_RAMP_ORDER_SEED = Buffer.from("stock-ramp-order");
export const VALIDATOR_VOTE_SEED = Buffer.from("validator-vote");
export const VALIDATOR_FEE_POOL_AUTHORITY_SEED = Buffer.from(
  "validator-fee-pool-authority"
);
export const VALIDATOR_EARNINGS_SEED = Buffer.from("validator-earnings");

// ---------------------------------------------------------------------
// Reservation status codes — mirror constants.rs STATUS_* constants.
// ---------------------------------------------------------------------
export const RESERVATION_STATUS = {
  PENDING: 0,
  PAYMENT_SENT: 1,
  COMPLETED: 2,
  CANCELLED: 3,
  DISPUTED: 4,
} as const;

// ---------------------------------------------------------------------
// Payment mode codes — mirror constants.rs PAYMENT_MODE_* constants.
// ---------------------------------------------------------------------
export const PAYMENT_MODE = {
  LINK: 0,
  DIRECT: 1,
} as const;

// ---------------------------------------------------------------------
// Escrow type codes — mirror state/stock_ramp_order.rs STOCK_RAMP_* constants.
// ---------------------------------------------------------------------
export const ESCROW_TYPE = {
  SELL: 0,
  BUY: 1,
} as const;

// ---------------------------------------------------------------------
// xStocks mint addresses.
// DECISION (see Todo.md "Decisions made this pass"): xStocks has no devnet
// deployment (mainnet-only, custody-backed RWA product from Backed Finance),
// so these are throwaway devnet SPL stand-ins, not real xStocks mints — do
// NOT expect `useXStockAssets()` / the live api.xstocks.fi asset list to
// recognize these addresses; that API only knows about real mainnet
// deployments. Grids/Filter/providers-page symbol resolution all read this
// static map directly (see BuyOrderGrid.tsx's `mintSymbolByAddress`), which
// is exactly why filling this in unblocks them independent of the live API.
// More symbols (MSFTx, etc.) still need throwaway devnet mints — add them
// here as they're created.
//
// The KEYS here must match real xStocks symbols exactly (confirmed against
// docs.xstocks.fi's Assets API — GET /public/assets, GET
// /public/assets/{symbol}/price-data) since useOrderQuote / useOrderUsdQuote
// / useXStockPricesProxied (hooks/useXStockPrices.ts) use these keys
// directly as the `symbol` path param when querying api.xstocks.fi for live
// prices via /api/xstocks/price — a mismatched key 404s there even though
// the devnet mint itself is fine. NVIDIA's real xStocks/Nasdaq-style symbol
// is "NVDAx" (ticker NVDA + x), not "NVIDIAx" — that mismatch was the exact
// cause of the "Failed to fetch NVIDIAx: xStocks API returned 404" logs.
// ---------------------------------------------------------------------
export const XSTOCKS_MINTS: Record<string, string> = {
  AAPLx: "AApLxE2BHqAowPKpZ72Euqxnf8umVRdK79Rsh2xKjE9H",
  AMZNx: "AMxz5EtXWThjVBXvcQ24aFg75H41KYqC71Q29wgpA8Kc",
  METAx: "MTxTuSschyv88CCCCB17RDGc4L6H33u2y23GwCbPyfY",
  NVDAx: "Nx1kifUWHU6kLM42tPU7NJTFBGEADTwRbwrfpm1141W",
  TSLAx: "TxLGAssFm6Rmk494RBKfDwjW7jpY2JzaYSuTMPdqeXD",
  
};

// ---------------------------------------------------------------------
// Nav bar items — shape defined in types/NavBarItem.type.ts. Consumed by
// components/common/Navbar/Navbar.tsx. The Admin item is gated by
// `requiresAdmin` (checked against `useIsAdmin()` in DesktopNavBar /
// MobileNavBar, not just wallet-connected).
//
// "Home" was removed from here — the logo/wordmark (Logo.tsx) now links to
// "/" directly, so a separate nav item duplicated that path. Stocks is the
// first real destination once inside the app.
// ---------------------------------------------------------------------
import type { NavBarItem } from "../types/NavBarItem.type";

export const NAV_ITEMS: NavBarItem[] = [
  { label: "Stocks", href: "/stocks" },
  { label: "Merchant", href: "/stocks/merchant", requiresWallet: true },
  { label: "Providers", href: "/stocks/providers" },
  { label: "Admin", href: "/admin", requiresWallet: true, requiresAdmin: true },
];
