// client/hooks/queries/useFeeInfo.ts
// Derives fee info from `GlobalState` (`feePercentage`, `feeDestination`)
// via `useGlobalState`. Backed by: programs/stock-ramp/src/state/global_state.rs

"use client";

import { useMemo } from "react";
import { useGlobalState } from "./useGlobalState";

/** Basis-points -> fraction, e.g. 500 -> 0.05 (5%). */
const BASIS_POINTS_DIVISOR = 10_000;

export function useFeeInfo() {
  const globalStateQuery = useGlobalState();
  const globalState = globalStateQuery.data;

  const feePercentage = globalState?.feePercentage ?? null; // raw basis points
  const feeDestination = globalState?.feeDestination ?? null;

  const feeFraction = useMemo(
    () => (feePercentage != null ? feePercentage / BASIS_POINTS_DIVISOR : null),
    [feePercentage]
  );

  /** Given a fiat/token amount, returns the fee owed at the current global rate. */
  function calculateFee(amount: number): number | null {
    if (feeFraction == null) return null;
    return amount * feeFraction;
  }

  return {
    ...globalStateQuery,
    feePercentageBps: feePercentage,
    feeFraction,
    feeDestination,
    calculateFee,
  };
}
