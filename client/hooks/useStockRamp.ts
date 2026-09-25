// client/hooks/useStockRamp.ts
// Deprecated: kept as a thin re-export so any existing `useStockRamp()`
// imports keep working, but `useStockRampProgram()` (client/hooks/useStockRampProgram.ts)
// is the real, fully-implemented hook — prefer importing that directly in new code.

"use client";

export { useStockRampProgram as useStockRamp } from "./useStockRampProgram";
