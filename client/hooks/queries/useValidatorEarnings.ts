// client/hooks/queries/useValidatorEarnings.ts
// Wraps `account.validatorEarnings.fetch(findValidatorEarningsPda(validator, mint)[0])`.
// Backed by: programs/stock-ramp/src/state/validator_earnings.rs
//
// Note: the on-chain `get_validator_earnings` instruction is itself a no-op
// (programs/stock-ramp/src/instructions/get_validator_earnings.rs) — real
// data comes from fetching the ValidatorEarnings account directly, not from
// calling that instruction.

"use client";

import { useQuery } from "@tanstack/react-query";
import type { PublicKey } from "@solana/web3.js";
import {
  useStockRampProgram,
  findValidatorEarningsPda,
} from "../useStockRampProgram";

export function validatorEarningsQueryKey(validator?: PublicKey | null, mint?: PublicKey | null) {
  return [
    "validatorEarnings",
    validator?.toBase58() ?? null,
    mint?.toBase58() ?? null,
  ] as const;
}

export function useValidatorEarnings(
  validator: PublicKey | null | undefined,
  mint: PublicKey | null | undefined
) {
  const { program } = useStockRampProgram();
  const pda =
    validator && mint ? findValidatorEarningsPda(validator, mint)[0] : null;

  return useQuery({
    queryKey: validatorEarningsQueryKey(validator, mint),
    queryFn: () => program.account.validatorEarnings.fetch(pda as PublicKey),
    enabled: !!pda,
    // A validator with no prior credited votes simply won't have this
    // account initialized yet — that's an expected 404, not worth retrying.
    retry: false,
  });
}
