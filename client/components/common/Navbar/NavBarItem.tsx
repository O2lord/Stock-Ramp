// client/components/common/Navbar/NavBarItem.tsx
// Single nav link — simpler than trust_vault's `NavBarItem.tsx` since
// `types/NavBarItem.type.ts` has no dropdown/children shape here, just
// requiresWallet / requiresAdmin / icon / external. Visibility gating
// (wallet-connected / admin) is handled by the caller (DesktopNavBar /
// MobileNavBar) before this renders — this component just renders the link.
//
// NOTE: was hardcoded to text-[#0F0D0A] (near-black), which is invisible
// against the dark theme's near-black background — swapped to the
// theme-aware `text-foreground` token so it renders correctly in both
// light and dark mode (see app/globals.css for the token values).

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { NavBarItem as NavBarItemType } from "@/types/NavBarItem.type";

interface NavBarItemProps {
  item: NavBarItemType;
  onClick?: () => void;
}

export function NavBarItem({ item, onClick }: NavBarItemProps) {
  const pathname = usePathname();
  const isActive = pathname === item.href;
  const Icon = item.icon;

  return (
    <div className="relative flex items-center">
      <Link
        href={item.href}
        target={item.external ? "_blank" : undefined}
        rel={item.external ? "noopener noreferrer" : undefined}
        onClick={onClick}
        className={cn(
          buttonVariants({ variant: "ghost" }),
          "gap-1.5 text-foreground/60 hover:text-foreground",
          isActive && "text-foreground"
        )}
      >
        {Icon && <Icon className="h-4 w-4" />}
        {item.label}
      </Link>
      {isActive && (
        <div className="absolute -bottom-[2px] left-1/2 hidden h-[2px] w-[80%] -translate-x-1/2 rounded-xl bg-[#E8480A] md:block" />
      )}
    </div>
  );
}
