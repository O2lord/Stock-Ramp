// client/components/common/Navbar/Navbar.tsx
// Entry point — mirrors trust_vault's `Navbar/index.tsx` shape (renders both
// Desktop and Mobile, Tailwind breakpoints decide which shows).

import { DesktopNavBar } from "./DesktopNavBar";
import { MobileNavBar } from "./MobileNavBar";

export function Navbar() {
  return (
    <>
      <DesktopNavBar />
      <MobileNavBar />
    </>
  );
}
