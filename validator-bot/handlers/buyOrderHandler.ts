// validator-bot/handlers/buyOrderHandler.ts
//
// Handles InstantPaymentReservedEvent in the decentralised validator system.
//
// ZERO SUPABASE — validators hold no DB credentials whatsoever.
//    All state (executor election, payout status) goes through the platform API.
//    Validators only need: VALIDATOR_API_KEY + PLATFORM_API_URL + Solana keypair.
//
// Flow:
//   1. ALL validators POST /api/bot/elect-executor — server does the DB race.
//      One wins EXECUTOR, the rest become VERIFIERS.
//   2. EXECUTOR POSTs /api/initiate-buy-payout — server fetches LP payment
//      credentials, sends fiat, records a transfer reference in DB.
//   3. ALL validators poll GET /api/bot/payout-status until the transfer
//      reference appears (or status = failed_to_initiate).
//   4. ALL validators poll GET /api/verify-transfer until SUCCESSFUL or FAILED.
//   5. Each validator submits its on-chain vote via submitBuyVote.
//   6. On-chain program executes when threshold (3-of-5) is reached.

import {
  Connection,
  PublicKey,
  Keypair,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
} from '@solana/spl-token';
import { Program } from '@coral-xyz/anchor';
import BN from 'bn.js';
import { keccak_256 } from '@noble/hashes/sha3';
import chalk from 'chalk';
import type { StockRamp } from '../relics/stock_ramp.js';
import { botHeaders, getCachedBlockhash } from '../val_bot.js';

// ─────────────────────────────────────────────────────────────────────────────
// ReservationEvent — must include payoutDetails decoded from the on-chain event
// ─────────────────────────────────────────────────────────────────────────────

export interface ReservationEvent {
  orderType: 'buy' | 'sell';
  stockRampOrder: string;
  maker: string;
  taker: string;
  amount: bigint;
  fiatAmount: bigint;       // plain fiat value — use Number() directly, no decimal scaling
  currency: string;
  payoutReference: string;
  payoutDetails: string | null;  // JSON string: { account_number, bank_code, ... }
  signature: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeReferenceHash(payoutReference: string): number[] {
  return Array.from(keccak_256(Buffer.from(payoutReference, 'utf8')));
}

function deriveValidatorVotePda(
  stockRampOrderPubkey: PublicKey,
  referenceHash: number[],
  programId: PublicKey
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('validator-vote'), stockRampOrderPubkey.toBuffer(), Buffer.from(referenceHash)],
    programId
  );
  return pda;
}

function deriveGlobalStatePda(programId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('global-state')],
    programId
  );
  return pda;
}

function deriveValidatorFeePoolAuthorityPda(programId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('validator-fee-pool-authority')],
    programId
  );
  return pda;
}

function deriveValidatorFeePoolAta(
  programId: PublicKey,
  mint: PublicKey,
  tokenProgram: PublicKey
): PublicKey {
  return getAssociatedTokenAddressSync(
    mint,
    deriveValidatorFeePoolAuthorityPda(programId),
    true,
    tokenProgram
  );
}

// Builds the remainingAccounts list for submitBuyVote / submitSellVote.
//
// Fetches global_state.validators — the authoritative list of all registered
// validators — and derives a ValidatorEarnings PDA for each active slot.
async function buildValidatorEarningRemainingAccounts(
  program: Program<StockRamp>,
  signingValidatorKey: PublicKey,  // kept for signature compatibility, no longer needed
  mint: PublicKey,
  programId: PublicKey,
  tag = ''
): Promise<{ pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[]> {

  const globalStatePda = PublicKey.findProgramAddressSync(
    [Buffer.from('global-state')],
    programId
  )[0];

  const globalState = await (program.account as any).globalState.fetch(globalStatePda);

  const allValidators: PublicKey[] = (globalState.validators as PublicKey[]).filter(
    (v: PublicKey) => !v.equals(PublicKey.default)
  );

  const pdas = allValidators.map((validator) => ({
    pubkey: PublicKey.findProgramAddressSync(
      [Buffer.from('validator-earnings'), validator.toBuffer(), mint.toBuffer()],
      programId
    )[0],
    isSigner: false,
    isWritable: true,
  }));

  console.log(
    chalk.gray(`${tag} 📋 Earnings PDAs (${pdas.length}): ${allValidators.map((v) => v.toBase58().slice(0, 8) + '...').join(', ')}`)
  );

  return pdas;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared fetch helper with timeout
// ─────────────────────────────────────────────────────────────────────────────

async function apiFetch(
  url: string,
  options: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const { timeoutMs = 15_000, ...fetchOptions } = options;
  return fetch(url, {
    ...fetchOptions,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1 — Executor election through platform API
// ─────────────────────────────────────────────────────────────────────────────

async function electExecutor(
  event: ReservationEvent,
  validatorApiKey: string,
  platformApiUrl: string,
  tag: string
): Promise<'executor' | 'verifier'> {
  try {
    const res = await apiFetch(`${platformApiUrl}/api/bot/elect-executor`, {
      method: 'POST',
      headers: botHeaders(validatorApiKey),
      body: JSON.stringify({
        payout_reference: event.payoutReference,
        stock_ramp_order_pda: event.stockRampOrder,
      }),
      timeoutMs: 10_000,
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(chalk.yellow(`${tag} ⚠️  elect-executor returned ${res.status}: ${text}`));
      // Default to verifier on error — safe, prevents double-payout
      return 'verifier';
    }

    const data = await res.json() as { role: 'executor' | 'verifier' };
    return data.role;
  } catch (err) {
    console.error(chalk.yellow(`${tag} ⚠️  elect-executor network error: ${err instanceof Error ? err.message : err}`));
    return 'verifier';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2 — Executor calls the platform API to initiate the fiat payout
// ─────────────────────────────────────────────────────────────────────────────

async function executePayout(
  event: ReservationEvent,
  scaledFiatAmount: number,
  validatorApiKey: string,
  platformApiUrl: string,
  tag: string,
  program: Program<StockRamp>
): Promise<{ success: boolean; transferReference: string | null; error?: string }> {
  // Guard: payout_details is required for the server to know where to send money
  if (!event.payoutDetails) {
    const errMsg = 'Missing payout_details on event — cannot route fiat transfer';
    console.error(chalk.red(`${tag} ❌ ${errMsg}`));
    return { success: false, transferReference: null, error: errMsg };
  }

  // Fetch fee percentage from on-chain order and deduct from fiat sent to taker
  const stockRampOrderAccount = await (program.account as any).stockRampOrder.fetch(
    new PublicKey(event.stockRampOrder)
  );
  const feePercentage: number = stockRampOrderAccount.feePercentage;
  const fiatFee = Math.floor(scaledFiatAmount * feePercentage / 10000);
  const takerFiatAmount = scaledFiatAmount - fiatFee;

  console.log(
    chalk.cyan(`${tag} 💸 Sending ${takerFiatAmount} ${event.currency} to taker (${fiatFee} fee deducted) — ref: ${event.payoutReference}`)
  );

  try {
    const res = await apiFetch(`${platformApiUrl}/api/initiate-buy-payout`, {
      method: 'POST',
      headers: botHeaders(validatorApiKey),
      body: JSON.stringify({
        payout_reference:      event.payoutReference,
        stock_ramp_order_pda:  event.stockRampOrder,
        taker:                 event.taker,
        maker:                 event.maker,
        fiat_amount:           takerFiatAmount,
        token_amount:          event.amount.toString(),
        currency:              event.currency,
        payout_details:        event.payoutDetails,
      }),
      timeoutMs: 30_000,
    });

    const data = await res.json() as {
      success: boolean;
      transfer_reference?: string;
      error?: string;
      idempotent?: boolean;
    };

    if (!res.ok || !data.success) {
      throw new Error(data.error ?? `HTTP ${res.status}`);
    }

    if (data.idempotent) {
      console.log(chalk.gray(`${tag} ℹ️  Payout already exists (idempotent). Transfer ref: ${data.transfer_reference}`));
    }

    const transferReference = data.transfer_reference ?? null;

    if (!transferReference) {
      const errMsg = `initiate-buy-payout returned success but no transfer_reference for ${event.payoutReference}`;
      console.error(`❌ ${errMsg}`);
      return { success: false, transferReference: null, error: errMsg };
    }

    console.log(chalk.green(`${tag} ✅ Payout initiated — transfer ref: ${transferReference}`));
    return { success: true, transferReference };

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`${tag} ❌ Payout initiation failed: ${errMsg}`));
    return { success: false, transferReference: null, error: errMsg };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3 — All validators wait for executor + verify transfer outcome
//
// Phase A: poll /api/bot/payout-status until transfer_reference appears
//          or status = 'failed_to_initiate' (fast-fail).
// Phase B: poll /api/verify-transfer until SUCCESSFUL or FAILED.
// ─────────────────────────────────────────────────────────────────────────────

async function waitForTransferResult(
  event: ReservationEvent,
  validatorApiKey: string,
  platformApiUrl: string,
  tag: string
): Promise<{ verified: boolean; evidence: string }> {
  const MAX_WAIT_FOR_EXECUTOR_MS = 60_000;  // 60s for executor to initiate
  const POLL_INTERVAL_MS         = 5_000;
  const MAX_TRANSFER_POLLS       = 24;       // 24 × 5s = 2 min of transfer polling

  // ── Phase A: wait for transfer_reference ──────────────────────────────
  console.log(chalk.gray(`${tag} ⏳ Waiting for payout confirmation (${event.payoutReference})...`));
  const deadline = Date.now() + MAX_WAIT_FOR_EXECUTOR_MS;
  let transferReference: string | null = null;

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);

    try {
      const res = await apiFetch(
        `${platformApiUrl}/api/bot/payout-status` +
        `?payout_reference=${encodeURIComponent(event.payoutReference)}`,
        {
          headers: botHeaders(validatorApiKey),
          timeoutMs: 10_000,
        }
      );

      if (!res.ok) continue;

      const data = await res.json() as {
        status: string;
        transfer_reference: string | null;
      };

      // Executor couldn't initiate — fast-fail, no point polling the payment provider
      if (data.status === 'failed_to_initiate') {
        return {
          verified: false,
          evidence: 'Payout initiation failed — executor marked status=failed_to_initiate',
        };
      }

      if (data.transfer_reference) {
        transferReference = data.transfer_reference;
        console.log(chalk.green(`${tag} ✅ Payout confirmed — transfer ref: ${transferReference}`));
        break;
      }
    } catch (err) {
      console.warn(chalk.yellow(`${tag} ⚠️  payout-status poll error: ${err instanceof Error ? err.message : err}`));
    }
  }

  if (!transferReference) {
    return {
      verified: false,
      evidence: `Executor did not record transfer ref within ${MAX_WAIT_FOR_EXECUTOR_MS / 1000}s`,
    };
  }

  // ── Phase B: poll verify-transfer ─────────────────────────────────────────
  console.log(chalk.gray(`${tag} 🔄 Verifying transfer (${transferReference})...`));

  for (let attempt = 1; attempt <= MAX_TRANSFER_POLLS; attempt++) {
    await sleep(POLL_INTERVAL_MS);

    try {
      const url =
        `${platformApiUrl}/api/verify-transfer` +
        `?payout_reference=${encodeURIComponent(event.payoutReference)}` +
        `&stock_ramp_order_pda=${encodeURIComponent(event.stockRampOrder)}`;

      const res = await apiFetch(url, {
        headers: botHeaders(validatorApiKey),
        timeoutMs: 10_000,
      });

      if (!res.ok) {
        console.warn(chalk.yellow(`${tag} ⚠️  verify-transfer returned ${res.status} (check ${attempt})`));
        continue;
      }

      const result = await res.json() as {
        verified: boolean;
        status?: string;
        amount?: number;
        currency?: string;
        error?: string;
      };

      if (result.verified) {
        return {
          verified: true,
          evidence:
            `Transfer SUCCESSFUL. Ref: ${transferReference}. ` +
            `Amount: ${result.amount} ${result.currency}`,
        };
      }

      if (result.status === 'FAILED' || result.status === 'REVERSED') {
        return {
          verified: false,
          evidence: `Transfer ${result.status}. Ref: ${transferReference}`,
        };
      }

      console.log(
        chalk.gray(`${tag} ⏳ Transfer check ${attempt}/${MAX_TRANSFER_POLLS}: ${result.status ?? 'pending'}...`)
      );
    } catch (err) {
      console.warn(
        chalk.yellow(`${tag} ⚠️  verify-transfer error (check ${attempt}): ${err instanceof Error ? err.message : err}`)
      );
    }
  }

  return {
    verified: false,
    evidence: `Transfer still PENDING after ${MAX_TRANSFER_POLLS} polls. Ref: ${transferReference}`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 4b — Submit buy vote on-chain
// ─────────────────────────────────────────────────────────────────────────────

async function submitBuyVoteOnChain(
  program: Program<StockRamp>,
  validatorKeypair: Keypair,
  connection: Connection,
  event: ReservationEvent,
  vote: boolean,
  evidence: string,
  tag: string
): Promise<void> {
  const stockRampOrderPubkey = new PublicKey(event.stockRampOrder);
  const takerPubkey          = new PublicKey(event.taker);
  const makerPubkey          = new PublicKey(event.maker);

  const referenceHash    = computeReferenceHash(event.payoutReference);
  const programId        = program.programId;
  const validatorVotePda = deriveValidatorVotePda(stockRampOrderPubkey, referenceHash, programId);
  const globalStatePda   = deriveGlobalStatePda(programId);

  const stockRampOrderAccount = await (program.account as any).stockRampOrder.fetch(stockRampOrderPubkey);
  const mint: PublicKey            = stockRampOrderAccount.mint;
  const feeDestination: PublicKey  = stockRampOrderAccount.feeDestination;

  const mintInfo     = await connection.getAccountInfo(mint);
  const tokenProgram = mintInfo?.owner.equals(TOKEN_2022_PROGRAM_ID)
    ? TOKEN_2022_PROGRAM_ID
    : TOKEN_PROGRAM_ID;

  const stockRampOrderAta         = getAssociatedTokenAddressSync(mint, stockRampOrderPubkey, true, tokenProgram);
  const feeDestinationAta         = getAssociatedTokenAddressSync(mint, feeDestination, false, tokenProgram);
  const takerAta                  = getAssociatedTokenAddressSync(mint, takerPubkey, false, tokenProgram);
  const makerAta                  = getAssociatedTokenAddressSync(mint, makerPubkey, false, tokenProgram);
  const validatorFeePoolAuthority = deriveValidatorFeePoolAuthorityPda(programId);
  const validatorFeePoolAta       = deriveValidatorFeePoolAta(programId, mint, tokenProgram);

  // Create any missing ATAs so the on-chain execution can transfer tokens.
  //
  // validatorFeePoolAta is included here because SubmitBuyVote does NOT use
  // init_if_needed on it — see initialize_validator_fee_pool_ata.rs, which
  // exists as a separate one-time-per-mint instruction specifically because
  // bundling init_if_needed into the vote instructions blows the 4096-byte
  // SBF stack limit. That means this ATA must already exist on-chain for a
  // given mint before ANY vote for that mint can be submitted — otherwise
  // Anchor's account validation fails with AccountNotInitialized (0xbc4)
  // before the instruction body even runs, regardless of the vote's value.
  // ATA creation is permissionless regardless of who the owner PDA is, so we
  // pre-create it here exactly like the other three ATAs, rather than
  // requiring a separate manual call to initializeValidatorFeePoolAta.
  const preIxs = [];
  for (const [ata, authority] of [
    [feeDestinationAta,   feeDestination],
    [makerAta,            makerPubkey],
    [takerAta,            takerPubkey],
    [validatorFeePoolAta, validatorFeePoolAuthority],
  ] as [PublicKey, PublicKey][]) {
    if (!(await connection.getAccountInfo(ata))) {
      preIxs.push(
        createAssociatedTokenAccountInstruction(
          validatorKeypair.publicKey,
          ata,
          authority,
          mint,
          tokenProgram
        )
      );
    }
  }

  if (preIxs.length > 0) {
    const ataTx = new Transaction().add(...preIxs);
    const blockhash = await getCachedBlockhash(connection); // shared cache, not a fresh RPC call per validator
    ataTx.recentBlockhash = blockhash;
    ataTx.feePayer = validatorKeypair.publicKey;
    ataTx.sign(validatorKeypair);
    await connection.sendRawTransaction(ataTx.serialize(), { skipPreflight: false });
    console.log(chalk.gray(`${tag} 📝 Created ${preIxs.length} missing ATA(s)`));
  }

  const sig = await program.methods
    .submitBuyVote(
      referenceHash,
      event.payoutReference,
      takerPubkey,
      new BN(event.amount.toString()),
      new BN(event.fiatAmount.toString()),
      event.currency,
      vote,
      evidence.substring(0, 200)
    )
    .accountsPartial({
      validator:         validatorKeypair.publicKey,
      globalState:       globalStatePda,
      stockRampOrder:    stockRampOrderPubkey,
      validatorVote:     validatorVotePda,
      maker:             makerPubkey,
      mint,
      stockRampOrderAta,
      feeDestinationAta,
      takerAta,
      makerAta,
      tokenProgram,
      systemProgram:     SystemProgram.programId,
      validatorFeePoolAuthority,
      validatorFeePoolAta,
    })
    .remainingAccounts(
      await buildValidatorEarningRemainingAccounts(
        program,
        validatorKeypair.publicKey,
        mint,
        programId,
        tag
      )
    )
    .rpc();

  console.log(chalk.green(`${tag} ✅ Vote cast (${vote ? 'YES' : 'NO'}) — tx: ${sig.slice(0, 20)}...`));
}

async function submitBuyVoteWithRetry(
  program: Program<StockRamp>,
  validatorKeypair: Keypair,
  connection: Connection,
  event: ReservationEvent,
  vote: boolean,
  evidence: string,
  tag: string,
  maxAttempts = 3
): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await submitBuyVoteOnChain(
        program, validatorKeypair, connection, event, vote, evidence, tag
      );
      return;
    } catch (err: any) {
      // Normalise the error message — raw RPC errors may not be Error instances
      // and can stringify as "[object Object]" if not handled carefully.
      const msg: string =
        err?.message ??
        err?.error?.errorMessage ??
        (typeof err === 'string' ? err : JSON.stringify(err));

      // Extract numeric custom error code from raw RPC JSON responses like:
      //   {"InstructionError":[0,{"Custom":6052}]}
      const codeMatch = msg.match(/"Custom"\s*:\s*(\d+)/);
      const code = codeMatch ? Number(codeMatch[1]) : undefined;

      // Terminal conditions — do not retry, not an error.
      //   6051 AlreadyVoted | 6052 VoteAlreadyExecuted | 6035 ReservationAlreadyProcessed
      //   6034 ReservationNotFound | 6053 VoteExpired
      //
      // 'Unknown action' / 'Account does not exist' are included here to match
      // the precedent already set in val_bot.ts's sell-vote error handler:
      // when a vote lands right as the 3-of-5 threshold is met (the program
      // executes + closes/reallocs the vote account in the same tx), the
      // client-side confirmation response can come back malformed even
      // though the tx actually landed and the vote executed. Without this,
      // it was being treated as retryable — logged as a scary ❌, wasting a
      // retry, and the retry just rediscovered AlreadyVoted/VoteAlreadyExecuted
      // anyway.
      if (
        msg.includes('AlreadyVoted')                || code === 6051 ||
        msg.includes('VoteAlreadyExecuted')         || code === 6052 ||
        msg.includes('ReservationAlreadyProcessed') || code === 6035 ||
        msg.includes('Unknown action')              ||
        msg.includes('Account does not exist')
      ) {
        console.log(chalk.gray(`${tag} ℹ️  Vote already recorded for ${event.payoutReference} — skipping`));
        return;
      }
      if (msg.includes('ReservationNotFound') || code === 6034) {
        console.log(chalk.gray(`${tag} ℹ️  Reservation ${event.payoutReference} already resolved — skipping`));
        return;
      }
      if (msg.includes('VoteExpired') || code === 6053) {
        console.log(chalk.yellow(`${tag} ⌛ Vote window expired for ${event.payoutReference}`));
        return;
      }

      // Retryable failure
      console.error(chalk.red(`${tag} ❌ Vote attempt ${attempt}/${maxAttempts} failed: ${msg}`));
      if (attempt < maxAttempts) {
        await sleep(1000 * attempt);
      } else {
        throw err;
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export — called by val_bot.ts for every buy reservation
// ─────────────────────────────────────────────────────────────────────────────

export async function handleBuyReservation(
  program: Program<StockRamp>,
  validatorKeypair: Keypair,
  connection: Connection,
  event: ReservationEvent,
  apiKey: string,
  tag: string
): Promise<void> {
  const platformApiUrl = process.env.PLATFORM_API_URL;

  if (!platformApiUrl) {
    throw new Error('PLATFORM_API_URL env var is required');
  }

  if (!apiKey) {
    throw new Error('VALIDATOR_API_KEY is required — ensure it is set in your .env');
  }

  // Buy order fiatAmount is the plain human-readable fiat value — no scaling.
  const scaledFiatAmount = Number(event.fiatAmount);

  // Fetch mint decimals from the stock ramp order account (for display only)
  let tokenDisplay = event.amount.toString();
  try {
    const sroAccount = await (program.account as any).stockRampOrder.fetch(
      new PublicKey(event.stockRampOrder)
    );
    const mintInfo = await connection.getAccountInfo(sroAccount.mint);
    const decimals = mintInfo?.data[44] ?? 9; // decimals at offset 44 in mint layout
    tokenDisplay = (Number(event.amount) / Math.pow(10, decimals)).toFixed(2);
  } catch { /* fall back to raw */ }

  console.log(chalk.white(`${tag} 💰 Fiat: ${scaledFiatAmount} ${event.currency} | Tokens: ${tokenDisplay} | Ref: ${event.payoutReference}`));

  // ── 1. Race to become executor (server handles the DB race) ───────────────
  const role = await electExecutor(event, apiKey, platformApiUrl, tag);
  const roleColour = role === 'executor' ? chalk.magenta : chalk.blue;
  console.log(roleColour(`${tag} 🏷️  Role: ${role.toUpperCase()} — ${event.payoutReference}`));

  // ── 2. Executor: initiate the fiat payout ─────────────────────────────────
  if (role === 'executor') {
    const payoutResult = await executePayout(
      event,
      scaledFiatAmount,
      apiKey,
      platformApiUrl,
      tag,
      program
    );

    if (!payoutResult.success) {
      // Vote false immediately — verifiers will see failed_to_initiate and fast-fail
      console.error(chalk.red(`${tag} ❌ Executor payout failed — voting NO immediately`));
      await submitBuyVoteWithRetry(
        program, validatorKeypair, connection, event,
        false,
        `Payout initiation failed: ${payoutResult.error}`,
        tag
      );
      return;
    }
  }

  // ── 3. ALL validators: wait for payout then verify transfer ───────────────
  // Random jitter so 5 validators don't hammer verify-transfer simultaneously
  await sleep(Math.floor(Math.random() * 3_000));

  const { verified, evidence } = await waitForTransferResult(
    event,
    apiKey,
    platformApiUrl,
    tag
  );

  const verifiedColour = verified ? chalk.green : chalk.red;
  console.log(verifiedColour(`${tag} 📊 ${verified ? '✅ VERIFIED' : '❌ UNVERIFIED'} — ${evidence}`));

  // ── 4. ALL validators: submit on-chain vote ───────────────────────────────
  console.log(chalk.cyan(`${tag} ⛓️  Casting ${verified ? 'YES' : 'NO'} vote on-chain...`));
  await submitBuyVoteWithRetry(
    program, validatorKeypair, connection, event,
    verified,
    evidence,
    tag
  );
}
