// client/app/layout.tsx
// Root layout. Wires up `globals.css`, the theme provider that
// `ThemeSwitcherButton.tsx` depends on, the react-query provider that
// `hooks/queries/*` depend on, the Solana wallet-adapter context
// (`SolanaProvider` — Phantom + Solflare, devnet), and mounts `Navbar` so
// every page gets it without re-importing.
//
// THEME DEFAULT: the "Terminal" direction is designed dark-first (true
// black canvas, hairline borders — see the comment block in globals.css),
// so the default is now `dark` rather than `system`. Light mode still
// works and every token has a light value, but a first-time visitor on a
// light-mode OS should see the theme the app was actually designed in
// rather than the secondary one. The switcher still overrides, and the
// choice still persists.

import type { Metadata } from "next";
import { ThemeProvider } from "@/components/common/ThemeProvider";
import { QueryProvider } from "@/components/common/QueryProvider";
import { SolanaProvider } from "@/components/common/SolanaProvider";
import { Navbar } from "@/components/common/Navbar/Navbar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stock Ramp",
  description: "Peer-to-peer xStocks on-ramp/off-ramp.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <QueryProvider>
            <SolanaProvider>
              <Navbar />
              {children}
            </SolanaProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
