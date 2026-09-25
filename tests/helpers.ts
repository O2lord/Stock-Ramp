// tests/helpers.ts
//
// Shared helpers for the Stock Ramp test suite. Centralised here (instead of
// duplicated per-file, as in the old Trust Vault suite) so that PDA seeds,
// account shapes, and fee math stay in exactly one place and can't drift
// between test files as the program evolves.

import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  Connection,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAccount,
  TokenAccountNotFoundError,
} from "@solana/spl-token";
import { keccak256 } from "js-sha3";
import * as fs from "fs";

// ─── Program-level constants (mirrors constants.rs) ────────────────────────

export const STOCK_RAMP_SELL = 0;
export const STOCK_RAMP_BUY = 1;

export const STATUS_PENDING = 0;
export const STATUS_PAYMENT_SENT = 1;
export const STATUS_COMPLETED = 2;
export const STATUS_CANCELLED = 3;
export const STATUS_DISPUTED = 4;

export const PAYMENT_MODE_LINK = 0;
export const PAYMENT_MODE_DIRECT = 1;

export const DEFAULT_FEE_BASIS_POINTS = 5; // 0.05%
export const MAX_FEE_BASIS_POINTS = 1000; // 10%
export const DEFAULT_REQUIRED_VOTES = 3;
export const MAX_VALIDATORS = 5;
export const VOTE_EXPIRY_SECONDS = 30 * 60;

// PDA seed prefixes
const SEED_GLOBAL_STATE = "global-state";
const SEED_STOCK_RAMP_ORDER = "stock-ramp-order";
const SEED_VALIDATOR_VOTE = "validator-vote";
const SEED_VALIDATOR_FEE_POOL_AUTHORITY = "validator-fee-pool-authority";
const SEED_VALIDATOR_EARNINGS = "validator-earnings";

// ─── PDA derivation ─────────────────────────────────────────────────────────

export function globalStatePda(programId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from(SEED_GLOBAL_STATE)],
    programId
  );
  return pda;
}

export function stockRampOrderPda(
  maker: PublicKey,
  seed: number | BN,
  programId: PublicKey
): PublicKey {
  const seedBn = seed instanceof BN ? seed : new BN(seed);
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from(SEED_STOCK_RAMP_ORDER),
      maker.toBuffer(),
      seedBn.toArrayLike(Buffer, "le", 8),
    ],
    programId
  );
  return pda;
}

export function referenceHash(payoutReference: string): Buffer {
  return Buffer.from(keccak256.array(payoutReference));
}

export function referenceHashBytes(payoutReference: string): number[] {
  return Array.from(referenceHash(payoutReference));
}

export function validatorVotePda(
  stockRampOrder: PublicKey,
  payoutReference: string,
  programId: PublicKey
): PublicKey {
  const refHash = referenceHash(payoutReference);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from(SEED_VALIDATOR_VOTE), stockRampOrder.toBuffer(), refHash],
    programId
  );
  return pda;
}

export function validatorFeePoolAuthorityPda(programId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from(SEED_VALIDATOR_FEE_POOL_AUTHORITY)],
    programId
  );
  return pda;
}

export function validatorEarningsPda(
  validator: PublicKey,
  mint: PublicKey,
  programId: PublicKey
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from(SEED_VALIDATOR_EARNINGS), validator.toBuffer(), mint.toBuffer()],
    programId
  );
  return pda;
}

/** Derive an ATA address without creating it on-chain. */
export function deriveAta(mint: PublicKey, owner: PublicKey): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  return ata;
}

export function validatorFeePoolAta(
  feePoolAuthority: PublicKey,
  mint: PublicKey
): PublicKey {
  return deriveAta(mint, feePoolAuthority);
}

// ─── Fee math (mirrors submit_vote.rs split_fee) ───────────────────────────
//
// Split: 20% platform / 60% maker rebate / 20% validator pool.
// The validator pool gets the true remainder to avoid integer-division dust
// loss — replicate that here so tests can assert exact expected balances.

export function computeTotalFee(amount: number, feeBps: number): number {
  return Math.floor((amount * feeBps) / 10000);
}

export function splitFee(totalFee: number): {
  platformFee: number;
  makerFee: number;
  validatorPoolFee: number;
} {
  const platformFee = Math.floor((totalFee * 20) / 100);
  const makerFee = Math.floor((totalFee * 60) / 100);
  const validatorPoolFee = totalFee - platformFee - makerFee;
  return { platformFee, makerFee, validatorPoolFee };
}

/** Per-validator earnings share, mirroring credit_validator_earnings's
 *  remainder-to-first-voter allocation. */
export function splitValidatorPool(
  validatorPoolFee: number,
  voterCount: number
): number[] {
  if (voterCount === 0) return [];
  const per = Math.floor(validatorPoolFee / voterCount);
  const remainder = validatorPoolFee - per * voterCount;
  return Array.from({ length: voterCount }, (_, i) => (i === 0 ? per + remainder : per));
}

/** Mirrors constants.rs::compute_dust_threshold */
export function computeDustThreshold(decimals: number): number {
  if (decimals < 3) return 1000;
  return Math.max(10 ** (decimals - 3), 1000);
}

// ─── Misc chain helpers ─────────────────────────────────────────────────────

export async function airdrop(
  connection: Connection,
  pubkey: PublicKey,
  sol = 2
): Promise<void> {
  const sig = await connection.requestAirdrop(pubkey, sol * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig, "confirmed");
}

export async function airdropAll(
  connection: Connection,
  pubkeys: PublicKey[],
  sol = 2
): Promise<void> {
  for (const pk of pubkeys) await airdrop(connection, pk, sol);
}

export async function getTokenBalance(
  connection: Connection,
  tokenAccount: PublicKey
): Promise<bigint> {
  try {
    const acc = await getAccount(connection, tokenAccount);
    return acc.amount;
  } catch (err) {
    if (err instanceof TokenAccountNotFoundError) return BigInt(0);
    throw err;
  }
}

export function loadAuthorityKeypair(): Keypair {
  try {
    const data = JSON.parse(
      fs.readFileSync(
        "/Users/o2lord/projects/keypairs/Stock_ramp/SR4T4SpgqQv1E4Q7pMN82GwWCMez1dySTMN6K2hk2LJ.json",
        "utf-8"
      )
    );
    return Keypair.fromSecretKey(new Uint8Array(data));
  } catch {
    return Keypair.fromSeed(new Uint8Array(32).fill(1));
  }
}

/**
 * Idempotently registers up to MAX_VALIDATORS validators against global
 * state. Safe to call from multiple test files against the same localnet.
 */
export async function ensureValidatorsRegistered(
  program: Program<any>,
  authority: PublicKey,
  globalState: PublicKey,
  validators: Keypair[]
): Promise<void> {
  for (const v of validators) {
    try {
      await program.methods
        .registerValidator(v.publicKey)
        .accountsPartial({ authority, globalState })
        .rpc();
    } catch {
      // Already registered — ignore.
    }
  }
}

/**
 * Idempotently creates the validator fee pool ATA for a given mint.
 * submit_buy_vote / submit_sell_vote require this ATA to already exist
 * (it is NOT init_if_needed on those instructions — see
 * initialize_validator_fee_pool_ata.rs for why).
 */
export async function ensureValidatorFeePoolAta(
  program: Program<any>,
  payer: Keypair,
  globalState: PublicKey,
  mint: PublicKey
): Promise<PublicKey> {
  const programId = program.programId;
  const poolAuthority = validatorFeePoolAuthorityPda(programId);
  const poolAta = validatorFeePoolAta(poolAuthority, mint);

  try {
    await program.methods
      .initializeValidatorFeePoolAta()
      .accountsPartial({
        payer: payer.publicKey,
        globalState,
        mint,
        validatorFeePoolAuthority: poolAuthority,
        validatorFeePoolAta: poolAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([payer])
      .rpc();
  } catch {
    // Already initialised for this mint — ignore.
  }

  return poolAta;
}

/**
 * Builds the ValidatorEarnings remaining_accounts list for a set of voting
 * validators, so submit_buy_vote / submit_sell_vote can credit each of them
 * on the settling (threshold-reaching) vote call.
 */
export function validatorEarningsRemainingAccounts(
  validators: PublicKey[],
  mint: PublicKey,
  programId: PublicKey
): { pubkey: PublicKey; isWritable: boolean; isSigner: boolean }[] {
  return validators.map((v) => ({
    pubkey: validatorEarningsPda(v, mint, programId),
    isWritable: true,
    isSigner: false,
  }));
}

// Shared, deterministic validator set — used by every test file so the
// singleton GlobalState's 5 validator slots don't collide across files.
export const SHARED_VALIDATORS: Keypair[] = Array.from({ length: 5 }, (_, i) =>
  Keypair.fromSeed(new Uint8Array(32).fill(i + 10)) // deterministic, distinct per index
);