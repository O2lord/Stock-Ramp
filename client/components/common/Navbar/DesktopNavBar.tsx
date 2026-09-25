// client/components/common/Navbar/DesktopNavBar.tsx
// Ported from trust_vault's `DesktopNavBar.tsx`, restyled onto stock-ramp's
// primitives. Filters `NAV_ITEMS` by both `requiresWallet` (wallet must be
// connected) and `requiresAdmin` (wallet must also pass `useIsAdmin()` —
// see that hook for the bootstrap-wallet + on-chain-authority logic). The
// "Admin" item now has a real route to point at (`app/admin/page.tsx`).
//
// NOTE: border was hardcoded to border-[#0F0D0A]/10 (near-black at 10%
// opacity), which reads as a near-invisible hairline against the dark
// theme's near-black background — swapped to `border-foreground/10` so it
// tracks whichever theme is active.

"use client";

import Logo from "@/components/common/Logo";
import { ConnectWalletButton } from "@/components/common/ConnectWalletButton";
import { ThemeSwitcherButton } from "@/components/common/ThemeSwitcherButton";
import { NavBarItem } from "./NavBarItem";
import { useWallet } from "@solana/wallet-adapter-react";
import { NAV_ITEMS } from "@/lib/constant";
import { useIsAdmin } from "@/hooks/useIsAdmin";

export function DesktopNavBar() {
  const { connected } = useWallet();
  const { isAdmin } = useIsAdmin();
  const visibleItems = NAV_ITEMS.filter((item) => {
    if (item.requiresAdmin) return connected && isAdmin;
    if (item.requiresWallet) return connected;
    return true;
  });

  return (
    <div className="hidden border-b border-foreground/10 bg-background md:block">
      <nav className="container mx-auto flex items-center justify-between px-8">
        <div className="flex h-[72px] items-center gap-x-6">
          <Logo />
          <div className="flex h-full items-center gap-1">
            {visibleItems.map((item) => (
              <NavBarItem key={item.href} item={item} />
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ThemeSwitcherButton />
          <ConnectWalletButton />
        </div>
      </nav>
    </div>
  );
}
