// client/lib/parseAnchorError.ts
// Turns whatever a failed `.rpc()` call throws into a short, human-readable
// message, using the 66 named errors in programs/stock-ramp/src/error.rs
// (embedded in the IDL's `errors` array at client/relics/stock_ramp.json —
// see that file, or client/relics/stock_ramp.ts's typed `errors` export, for
// the full list/order instead of hand-copying codes here, so this never
// drifts from the program if error.rs changes).

import { AnchorError, ProgramError } from "@coral-xyz/anchor";
import stockRampIdl from "../relics/stock_ramp.json";

interface IdlErrorEntry {
  code: number;
  name: string;
  msg?: string;
}

const IDL_ERRORS: IdlErrorEntry[] = (stockRampIdl as { errors?: IdlErrorEntry[] }).errors ?? [];

const ERROR_BY_CODE = new Map<number, IdlErrorEntry>(IDL_ERRORS.map((e) => [e.code, e]));
const ERROR_MSG_BY_CODE = new Map<number, string>(
  IDL_ERRORS.map((e) => [e.code, e.msg ?? e.name])
);

export interface ParsedAnchorError {
  /** Numeric Anchor error code, e.g. 6047. Null if this wasn't a program error. */
  code: number | null;
  /** PascalCase variant name from error.rs, e.g. "BuyOrdersPaused". Null if unknown. */
  name: string | null;
  /** The #[msg("...")] string from error.rs — what to show the user. */
  message: string;
}

/**
 * Parses a thrown value from an Anchor `.rpc()` / `.send()` call into a
 * `{ code, name, message }` triple. Falls back to a generic message for
 * non-program errors (RPC timeouts, wallet rejections, etc.) rather than
 * throwing again — this is meant to sit directly in a `catch` block.
 */
export function parseAnchorError(err: unknown): ParsedAnchorError {
  // Connection/simulation-level errors surface here as plain Error messages,
  // before any "Program log:" lines exist for AnchorError.parse to find —
  // so these must be checked first.
  if (err instanceof Error) {
    if (err.message.includes("AccountNotFound") || err.message.includes("insufficient funds")) {
      return {
        code: null,
        name: null,
        message:
          "Your wallet doesn't have enough SOL to send this transaction. Try airdropping some devnet SOL.",
      };
    }
  }

  // Anchor already recognizes its own "Program log:" formatted errors.
  const anchorErr =
    err instanceof AnchorError ? err : AnchorError.parse((err as { logs?: string[] })?.logs ?? []);
  if (anchorErr) {
    const code = anchorErr.error.errorCode.number;
    const entry = ERROR_BY_CODE.get(code);
    return {
      code,
      name: entry?.name ?? anchorErr.error.errorCode.code ?? null,
      message: entry?.msg ?? anchorErr.error.errorMessage ?? "Transaction failed.",
    };
  }

  // Some SDK paths surface a plain ProgramError instead.
  const programErr = ProgramError.parse(err, ERROR_MSG_BY_CODE);
  if (programErr) {
    const code = (programErr as unknown as { code: number }).code;
    const entry = ERROR_BY_CODE.get(code);
    return {
      code,
      name: entry?.name ?? null,
      message: entry?.msg ?? programErr.message ?? "Transaction failed.",
    };
  }

  // User-rejected-in-wallet is the single most common non-program error.
  const raw = err instanceof Error ? err.message : String(err);
  if (/user rejected/i.test(raw)) {
    return { code: null, name: null, message: "You rejected the transaction in your wallet." };
  }

  return { code: null, name: null, message: raw || "Something went wrong. Please try again." };
}