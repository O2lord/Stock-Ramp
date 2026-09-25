// client/components/StockRampBrand/StockRampBrandMark.tsx
//
// DECISION (was previously [TODO] / flagged in STOCKRAMP_FRONTEND_PLAN.md):
// Stock Ramp does not get a distinct brand treatment separate from the
// shared mark — unlike trust_vault, where TrustExpress layers its own
// brand on top of the generic `components/common/Logo.tsx`. Every current
// call site (`Navbar/DesktopNavBar.tsx`, `MobileNavBar.tsx`) already
// imports `Logo` directly and does not reference this file.
//
// This re-export exists only so an import of `StockRampBrandMark` doesn't
// dangle if something reaches for it later — it is intentionally NOT a
// separate implementation. If Stock Ramp ever gets a real logo asset /
// distinct visual identity, that work belongs in `components/common/Logo.tsx`
// (the shared mark), not here.
import Logo from "@/components/common/Logo";

export const StockRampBrandMark = Logo;
export default Logo;
