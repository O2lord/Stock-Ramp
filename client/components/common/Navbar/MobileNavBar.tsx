// client/components/common/Navbar/MobileNavBar.tsx
// Ported from trust_vault's `MobileNavBar.tsx` — hamburger + Sheet drawer,
// restyled onto stock-ramp's primitives. Same `requiresAdmin` gating as
// DesktopNavBar.tsx (see `useIsAdmin` for the authorization logic).
//
// NOTE: border was hardcoded to border-[#0F0D0A]/10, invisible against the
// dark theme's near-black background — swapped to `border-foreground/10`.

"use client";

import * as React from "react";
import { Menu } from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import Logo from "@/components/common/Logo";
import { ConnectWalletButton } from "@/components/common/ConnectWalletButton";
import { ThemeSwitcherButton } from "@/components/common/ThemeSwitcherButton";
import { NavBarItem } from "./NavBarItem";
import { NAV_ITEMS } from "@/lib/constant";
import { useIsAdmin } from "@/hooks/useIsAdmin";

export function MobileNavBar() {
  const [isOpen, setIsOpen] = React.useState(false);
  const { connected } = useWallet();
  const { isAdmin } = useIsAdmin();
  const visibleItems = NAV_ITEMS.filter((item) => {
    if (item.requiresAdmin) return connected && isAdmin;
    if (item.requiresWallet) return connected;
    return true;
  });

  return (
    <div className="block border-b border-foreground/10 bg-background md:hidden">
      <nav className="flex items-center justify-between px-4 h-[64px]">
        <Sheet open={isOpen} onOpenChange={setIsOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[280px]">
            <Logo isMobile />
            <div className="flex flex-col gap-1 pt-6">
              {visibleItems.map((item) => (
                <NavBarItem key={item.href} item={item} onClick={() => setIsOpen(false)} />
              ))}
            </div>
            <div className="pt-6">
              <ThemeSwitcherButton />
            </div>
          </SheetContent>
        </Sheet>
        <ConnectWalletButton />
      </nav>
    </div>
  );
}
