// client/components/common/ThemeProvider.tsx
// Thin client-component wrapper around next-themes — needed because
// `next-themes`'s ThemeProvider must be invoked from a "use client" boundary,
// and `app/layout.tsx` (a server component) can't call "use client" hooks
// directly. Pairs with `ThemeSwitcherButton.tsx`, which calls `useTheme()`.

"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ThemeProviderProps } from "next-themes";

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
