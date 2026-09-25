// client/hooks/queries/useGlobalState.ts
// Wraps `useStockRampProgram().account.globalState.fetch(findGlobalStatePda()[0])`
// in a react-query hook. Backed by: programs/stock-ramp/src/state/global_state.rs

"use client";

import { useQuery } from "@tanstack/react-query";
import { useStockRampProgram, findGlobalStatePda } from "../useStockRampProgram";

export function globalStateQueryKey() {
  return ["globalState"] as const;
}

export function useGlobalState() {
  const { program, connection } = useStockRampProgram();
  const [globalStatePda] = findGlobalStatePda();

  return useQuery({
    queryKey: globalStateQueryKey(),
    queryFn: () => program.account.globalState.fetch(globalStatePda),
    // GlobalState always exists once `initializeGlobalState` has run once —
    // if it 404s, the program hasn't been bootstrapped on this cluster yet.
    retry: false,
    enabled: !!connection,
  });
}
