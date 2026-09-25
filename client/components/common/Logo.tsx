// Ported from trust_vault: client/components/common/Logo.tsx
// [TODO] swap /logos/shield2.png for a Stock Ramp asset once branding is finalized.
//
// Links to "/" (the marketing landing page) — clicking the mark or
// wordmark is the app's "go home" affordance now that "Home" has been
// removed from NAV_ITEMS (lib/constant.ts), so this is the only way back
// to the landing page from inside the app besides the browser back button.
import Link from "next/link";
import React from "react";
import Image from "next/image";

function Logo({ isMobile }: { isMobile?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2">
      {!isMobile && (
        <Image
          src="/logos/shield2.png"
          alt="Stock Ramp Logo"
          width="32"
          height="32"
          className="rounded-full"
        />
      )}
      <span className="text-2xl font-bold leading-tight tracking-tighter text-foreground">
        Stock Ramp
      </span>
    </Link>
  );
}

export default Logo;
