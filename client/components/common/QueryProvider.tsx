// client/components/common/QueryProvider.tsx
// Thin "use client" wrapper around @tanstack/react-query's QueryClientProvider —
// same rationale as ThemeProvider.tsx: `app/layout.tsx` is a server component
// and can't construct/hold a QueryClient itself.
//
// Decision made (was flagged as blocked in Todo.md): react-query chosen over
// swr for hooks/queries/*, since its query-key invalidation model fits the
// "refetch this account after an Anchor tx confirms" pattern used throughout
// (e.g. re-fetching a StockRampOrder after createBuyOrder/instantReserve/etc.).

"use client";

import { useState } from "react";
import {
  QueryClient,
  QueryClientProvider as TanstackQueryClientProvider,
} from "@tanstack/react-query";

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Solana account data doesn't go stale on its own — only a tx or
            // manual invalidation should trigger a refetch. Avoid noisy
            // refetch-on-window-focus for wallet-gated pages.
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      })
  );

  return (
    <TanstackQueryClientProvider client={queryClient}>
      {children}
    </TanstackQueryClientProvider>
  );
}
