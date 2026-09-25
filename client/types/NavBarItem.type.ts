// client/types/NavBarItem.type.ts
// Shape consumed by `components/common/Navbar/Navbar.tsx`.

import type { ComponentType, SVGProps } from "react";

export interface NavBarItem {
  label: string;
  href: string;
  /** lucide-react icon component (already a dependency — see package.json). */
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  /** Render only when a wallet is connected (e.g. "My Orders", "Admin"). */
  requiresWallet?: boolean;
  /** Render only for the program's `GlobalState.authority` / a registered validator. */
  requiresAdmin?: boolean;
  /** Open in a new tab (external links). */
  external?: boolean;
}
