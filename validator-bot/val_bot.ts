// validator-bot/val_bot.ts
//
// Standalone bot that registered validators run independently.
// It watches on-chain events, verifies payments via the platform API,
// and submits votes via submit_buy_vote / submit_sell_vote.
//
// Can be run as a single validator (reads VALIDATOR_PRIVATE_KEY / VALIDATOR_API_KEY)
// or imported by run-all.ts to run all 5 validators concurrently in one process.
//
// NOTE: adjust the IDL/type import paths below to match wherever your
// `anchor build` output actually lives (relics/stock_ramp.json etc).

import {
  Connection,
  PublicKey,
  Keypair,
  SystemProgram,
  Transaction,
  Logs,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';
import { Program, AnchorProvider } from '@coral-xyz/anchor';
import { Wallet as NodeWallet } from '@coral-xyz/anchor';
import { keccak_256 } from '@noble/hashes/sha3';
import bs58 from 'bs58';
import chalk from 'chalk';
import dotenv from 'dotenv';
import IDL from './relics/stock_ramp.json' with { type: 'json' };
import type { StockRamp } from './relics/stock_ramp.js';
import { handleBuyReservation } from './handlers/buyOrderHandler.js';

dotenv.config({ path: '.env' });

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

const PROGRAM_ID = new PublicKey(
  process.env.PROGRAM_ID ||
    process.env.STOCK_RAMP_PROGRAM_ID ||
    '5DLaeZGr4dFhoQkx2hu7QmUYGiS5qmBuNehB5fzGaUkH'
);

const PLATFORM_API_URL = process.env.PLATFORM_API_URL!;

// ─────────────────────────────────────────────────────────────────────────────
// Shared headers helper — used on every outbound API call
// ─────────────────────────────────────────────────────────────────────────────

export function botHeaders(apiKey?: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-validator-key': apiKey ?? process.env.VALIDATOR_API_KEY!,
  };
}

// How long to wait after a reservation event fires before verifying.
const VERIFICATION_DELAY_MS = 10_000;

// How many times to retry verification before voting false.
const MAX_VERIFY_RETRIES = 8;
const RETRY_DELAY_MS = 15_000;

// StockRampOrder account discriminator — from IDL: accounts[StockRampOrder].discriminator
const STOCK_RAMP_ORDER_DISCRIMINATOR = Buffer.from([28, 141, 210, 123, 210, 232, 91, 251]);

// ValidatorVote account discriminator — from IDL: accounts[ValidatorVote].discriminator
const VALIDATOR_VOTE_DISCRIMINATOR = Buffer.from([63, 68, 242, 159, 202, 98, 147, 175]);

// ─────────────────────────────────────────────────────────────────────────────
// Event discriminators — 8-byte prefixes that identify each event type.
// ─────────────────────────────────────────────────────────────────────────────

const DISCRIMINATORS: Record<string, number[]> = {
  InstantPaymentReservedEvent:        [1, 110, 251, 231, 168, 10, 216, 190],
  InstantSellReservationCreatedEvent: [65, 196, 145, 144, 214, 136, 85, 139],
};

// escrowType on-chain constant
const ESCROW_TYPE_SELL = 1;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface ReservationEvent {
  orderType: 'buy' | 'sell';
  stockRampOrder: string;
  maker: string;
  taker: string;
  amount: bigint;
  fiatAmount: bigint;
  currency: string;
  payoutReference: string;
  payoutDetails: string | null;
  signature: string;
}

interface VerifyResult {
  verified: boolean;
  amount?: number;
  currency?: string;
  error?: string;
}

export interface ValidatorConfig {
  privateKey: string; // base58
  apiKey: string;
  label?: string;
  connection?: Connection; // optional shared Connection to avoid opening
                            // one RPC/websocket connection per validator
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared blockhash cache
//
// Solana blockhashes stay valid for ~60-90 seconds. Without caching, every
// validator calls getLatestBlockhash() independently on every vote/ATA-create,
// multiplying RPC load by the number of validators running (5x in run-all.ts).
// This cache is module-scoped so ALL ValidatorBot instances in the process
// share one in-flight request and one cached result.
// ─────────────────────────────────────────────────────────────────────────────

const BLOCKHASH_TTL_MS = 25_000; // refresh well within the ~60-90s validity window

let cachedBlockhash: { blockhash: string; fetchedAt: number } | null = null;
let blockhashFetchPromise: Promise<string> | null = null;

export async function getCachedBlockhash(connection: Connection): Promise<string> {
  const now = Date.now();

  if (cachedBlockhash && now - cachedBlockhash.fetchedAt < BLOCKHASH_TTL_MS) {
    return cachedBlockhash.blockhash;
  }

  // Coalesce concurrent callers into a single outstanding RPC request.
  if (!blockhashFetchPromise) {
    blockhashFetchPromise = connection
      .getLatestBlockhash('confirmed')
      .then(({ blockhash }) => {
        cachedBlockhash = { blockhash, fetchedAt: Date.now() };
        blockhashFetchPromise = null;
        return blockhash;
      })
      .catch((err) => {
        blockhashFetchPromise = null;
        throw err;
      });
  }

  return blockhashFetchPromise;
}

function computeReferenceHash(payoutReference: string): number[] {
  const hash = keccak_256(Buffer.from(payoutReference, 'utf8'));
  return Array.from(hash);
}

function deriveValidatorVotePda(
  stockRampOrderPubkey: PublicKey,
  referenceHash: number[]
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('validator-vote'),
      stockRampOrderPubkey.toBuffer(),
      Buffer.from(referenceHash),
    ],
    PROGRAM_ID
  );
  return pda;
}

function deriveGlobalStatePda(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('global-state')],
    PROGRAM_ID
  );
  return pda;
}

function deriveValidatorFeePoolAuthorityPda(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('validator-fee-pool-authority')],
    PROGRAM_ID
  );
  return pda;
}

function deriveValidatorFeePoolAta(mint: PublicKey, tokenProgram: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(
    mint,
    deriveValidatorFeePoolAuthorityPda(),
    true,
    tokenProgram
  );
}

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

function discriminatorMatches(buf: Buffer, expected: number[]): boolean {
  if (buf.length < 8) return false;
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== expected[i]) return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Manual buffer decoders
//
// The Anchor IDL coder is NOT used here. If your IDL has no field definitions
// on events, program.coder.events.decode() returns empty data objects,
// causing fields to be undefined — silently swallowed by the catch block.
// These decoders parse the raw log bytes directly.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * InstantPaymentReservedEvent layout (after 8-byte discriminator):
 *   [32]   stock_ramp_order    PublicKey
 *   [32]   taker               PublicKey
 *   [8]    amount              u64 LE
 *   [8]    fiat_amount         u64 LE
 *   [4+N]  currency            length-prefixed string
 *   [1]    has_payout_details  Option prefix (0 or 1)
 *   [4+N]  payout_details      present only if prefix == 1
 *   [4+N]  payout_reference    length-prefixed string
 */
function decodeInstantPaymentReservedEvent(
  buf: Buffer,
  signature: string
): ReservationEvent | null {
  try {
    let offset = 8; // skip discriminator

    const stockRampOrder = new PublicKey(buf.slice(offset, offset + 32));
    offset += 32;

    const taker = new PublicKey(buf.slice(offset, offset + 32));
    offset += 32;

    const amount = buf.readBigUInt64LE(offset);
    offset += 8;

    const fiatAmount = buf.readBigUInt64LE(offset);
    offset += 8;

    // currency
    if (buf.length < offset + 4) return null;
    const currencyLength = buf.readUInt32LE(offset);
    offset += 4;

    if (buf.length < offset + currencyLength) return null;
    const currency = buf.slice(offset, offset + currencyLength).toString('utf8');
    offset += currencyLength;

    let payoutDetails: string | null = null;

    if (buf.length > offset) {
      const hasPayoutDetails = buf.readUInt8(offset) === 1;
      offset += 1;

      if (hasPayoutDetails) {
        if (buf.length < offset + 4) return null;
        const payoutDetailsLength = buf.readUInt32LE(offset);
        offset += 4;

        if (
          payoutDetailsLength > 0 &&
          payoutDetailsLength < 10_000 &&
          buf.length >= offset + payoutDetailsLength
        ) {
          payoutDetails = buf.slice(offset, offset + payoutDetailsLength).toString('utf8');
          offset += payoutDetailsLength;
        } else {
          return null; // malformed
        }
      }
    }

    // payout_reference
    if (buf.length < offset + 4) return null;
    const payoutReferenceLength = buf.readUInt32LE(offset);
    offset += 4;

    if (
      payoutReferenceLength === 0 ||
      payoutReferenceLength > 1000 ||
      buf.length < offset + payoutReferenceLength
    ) {
      return null;
    }

    const payoutReference = buf
      .slice(offset, offset + payoutReferenceLength)
      .toString('utf8');

    return {
      orderType: 'buy',
      stockRampOrder: stockRampOrder.toString(),
      maker: '', // fetched from on-chain account in handleReservationEvent
      taker: taker.toString(),
      amount,
      fiatAmount,
      currency,
      payoutReference,
      payoutDetails,
      signature,
    };
  } catch (err) {
    console.error(chalk.red('❌ Failed to decode InstantPaymentReservedEvent:'), err);
    return null;
  }
}

/**
 * InstantSellReservationCreatedEvent layout (after 8-byte discriminator):
 *   [32]   stock_ramp_order  PublicKey
 *   [32]   maker             PublicKey  (seller)
 *   [32]   taker             PublicKey  (buyer)
 *   [8]    amount            u64 LE
 *   [8]    fiat_amount       u64 LE
 *   [4+N]  currency          length-prefixed string
 *   [1]    payment_mode      u8
 *   [4+N]  payout_reference  length-prefixed string
 */
function decodeInstantSellReservationCreatedEvent(
  buf: Buffer,
  signature: string
): ReservationEvent | null {
  try {
    let offset = 8;

    const stockRampOrder = new PublicKey(buf.slice(offset, offset + 32));
    offset += 32;

    const maker = new PublicKey(buf.slice(offset, offset + 32));
    offset += 32;

    const taker = new PublicKey(buf.slice(offset, offset + 32));
    offset += 32;

    const amount = buf.readBigUInt64LE(offset);
    offset += 8;

    const fiatAmount = buf.readBigUInt64LE(offset);
    offset += 8;

    if (buf.length < offset + 4) return null;
    const currencyLength = buf.readUInt32LE(offset);
    offset += 4;

    if (buf.length < offset + currencyLength) return null;
    const currency = buf.slice(offset, offset + currencyLength).toString('utf8');
    offset += currencyLength;

    // Skip payment_mode (u8)
    offset += 1;

    if (buf.length < offset + 4) return null;
    const payoutReferenceLength = buf.readUInt32LE(offset);
    offset += 4;

    if (
      payoutReferenceLength === 0 ||
      payoutReferenceLength > 1000 ||
      buf.length < offset + payoutReferenceLength
    ) {
      return null;
    }

    const payoutReference = buf
      .slice(offset, offset + payoutReferenceLength)
      .toString('utf8');

    return {
      orderType: 'sell',
      stockRampOrder: stockRampOrder.toString(),
      maker: maker.toString(),
      taker: taker.toString(),
      amount,
      fiatAmount,
      currency,
      payoutReference,
      payoutDetails: null,  // sell events have no outbound bank details
      signature,
    };
  } catch (err) {
    console.error(chalk.red('❌ Failed to decode InstantSellReservationCreatedEvent:'), err);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Log parser — reads raw "Program data: <base64>" lines from the Solana log,
// identifies the event by its 8-byte discriminator, and decodes manually.
// ─────────────────────────────────────────────────────────────────────────────

function parseReservationEvents(
  logs: string[],
  signature: string
): ReservationEvent[] {
  const events: ReservationEvent[] = [];

  for (const log of logs) {
    if (!log.startsWith('Program data: ')) continue;

    const base64Data = log.replace('Program data: ', '').trim();

    let buf: Buffer;
    try {
      buf = Buffer.from(base64Data, 'base64');
    } catch {
      continue;
    }

    if (buf.length < 8) continue;

    if (discriminatorMatches(buf, DISCRIMINATORS.InstantPaymentReservedEvent)) {
      const event = decodeInstantPaymentReservedEvent(buf, signature);
      if (event) {
        console.log(chalk.white(`📥 Buy reservation detected: ${event.payoutReference}`));
        events.push(event);
      }
      continue;
    }

    if (discriminatorMatches(buf, DISCRIMINATORS.InstantSellReservationCreatedEvent)) {
      const event = decodeInstantSellReservationCreatedEvent(buf, signature);
      if (event) {
        console.log(chalk.white(`📥 Sell reservation detected: ${event.payoutReference}`));
        events.push(event);
      }
      continue;
    }
  }

  return events;
}

// ─────────────────────────────────────────────────────────────────────────────
// Platform API
// ─────────────────────────────────────────────────────────────────────────────

async function verifyPaymentWithRetry(
  event: ReservationEvent,
  apiKey: string,
  tag: string
): Promise<VerifyResult> {
  for (let attempt = 1; attempt <= MAX_VERIFY_RETRIES; attempt++) {
    try {
      const url = new URL(`${PLATFORM_API_URL}/api/verify-payment`);
      url.searchParams.set('payout_reference', event.payoutReference);
      url.searchParams.set('stock_ramp_order_pda', event.stockRampOrder);
      url.searchParams.set('order_type', event.orderType);

      const response = await fetch(url.toString(), {
        headers: botHeaders(apiKey),
      });

      if (!response.ok) {
        console.warn(chalk.yellow(`[${tag}] ⚠️  Attempt ${attempt}/${MAX_VERIFY_RETRIES}: API returned ${response.status}`));
        if (attempt < MAX_VERIFY_RETRIES) await sleep(RETRY_DELAY_MS);
        continue;
      }

      const data = await response.json() as VerifyResult;

      if (data.verified) {
        console.log(chalk.green(`[${tag}] ✅ Attempt ${attempt}/${MAX_VERIFY_RETRIES}: payment verified`));
        return data;
      }

      console.log(chalk.gray(`[${tag}] ⏳ Attempt ${attempt}/${MAX_VERIFY_RETRIES}: not verified yet (${data.error ?? 'pending'})`));
      if (attempt < MAX_VERIFY_RETRIES) await sleep(RETRY_DELAY_MS);

    } catch (error) {
      console.warn(chalk.yellow(`[${tag}] ⚠️  Attempt ${attempt}/${MAX_VERIFY_RETRIES}: network error: ${error}`));
      if (attempt < MAX_VERIFY_RETRIES) await sleep(RETRY_DELAY_MS);
    }
  }

  console.error(chalk.red(`[${tag}] ❌ Payment not verified after ${MAX_VERIFY_RETRIES} attempts`));
  return { verified: false, error: 'Payment not found after max retries' };
}

// ─────────────────────────────────────────────────────────────────────────────
// On-chain voting — sell side only
// Buy vote submission is handled inside handlers/buyOrderHandler.ts
// ─────────────────────────────────────────────────────────────────────────────

async function submitSellVote(
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
  const validatorVotePda = deriveValidatorVotePda(stockRampOrderPubkey, referenceHash);
  const globalStatePda   = deriveGlobalStatePda();

  const stockRampOrderAccount = await (program.account as any).stockRampOrder.fetch(stockRampOrderPubkey);
  const mint: PublicKey            = stockRampOrderAccount.mint;
  const feeDestination: PublicKey  = stockRampOrderAccount.feeDestination;

  // Retry getAccountInfo up to 3 times — mintInfo can be null on RPC
  // timing issues, which causes tokenProgram to be undefined → tx failure
  let mintInfo = await connection.getAccountInfo(mint);
  if (!mintInfo) {
    await sleep(1000);
    mintInfo = await connection.getAccountInfo(mint);
  }
  if (!mintInfo) {
    await sleep(2000);
    mintInfo = await connection.getAccountInfo(mint);
  }

  // Default to TOKEN_PROGRAM_ID if still null (standard SPL token)
  const tokenProgram = mintInfo?.owner.equals(TOKEN_2022_PROGRAM_ID)
    ? TOKEN_2022_PROGRAM_ID
    : TOKEN_PROGRAM_ID;

  const stockRampOrderAta         = getAssociatedTokenAddressSync(mint, stockRampOrderPubkey, true, tokenProgram);
  const feeDestinationAta         = getAssociatedTokenAddressSync(mint, feeDestination, false, tokenProgram);
  const takerAta                  = getAssociatedTokenAddressSync(mint, takerPubkey, false, tokenProgram);
  const makerAta                  = getAssociatedTokenAddressSync(mint, makerPubkey, false, tokenProgram);
  const validatorFeePoolAuthority = deriveValidatorFeePoolAuthorityPda();
  const validatorFeePoolAta       = deriveValidatorFeePoolAta(mint, tokenProgram);

  // Pre-create any missing ATAs so the on-chain close/dust-sweep path can
  // transfer tokens. Mirrors the same pattern used in buyOrderHandler.ts.
  //
  // validatorFeePoolAta is included here for the same reason it is in
  // buyOrderHandler.ts: SubmitSellVote does NOT use init_if_needed on it
  // (see initialize_validator_fee_pool_ata.rs — bundling init_if_needed
  // here blows the SBF stack limit), so it must already exist on-chain for
  // this mint before ANY vote for that mint can be submitted, or Anchor's
  // account validation fails with AccountNotInitialized before the
  // instruction body runs. ATA creation is permissionless regardless of
  // the owner PDA, so we pre-create it exactly like the other three ATAs.
  const preIxs = [];
  for (const [ata, authority] of [
    [feeDestinationAta,   feeDestination],
    [takerAta,            takerPubkey],
    [makerAta,            makerPubkey],
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
    const blockhash = await getCachedBlockhash(connection);
    ataTx.recentBlockhash = blockhash;
    ataTx.feePayer = validatorKeypair.publicKey;
    ataTx.sign(validatorKeypair);
    await connection.sendRawTransaction(ataTx.serialize(), { skipPreflight: false });
    console.log(chalk.gray(`[${tag}] 📝 Created ${preIxs.length} missing ATA(s) for sell vote`));
  }

  const sig = await program.methods
    .submitSellVote(
      referenceHash,
      event.payoutReference,
      takerPubkey,
      vote,
      evidence
    )
    .accountsPartial({
      validator: validatorKeypair.publicKey,
      globalState: globalStatePda,
      stockRampOrder: stockRampOrderPubkey,
      validatorVote: validatorVotePda,
      maker: makerPubkey,
      mint,
      stockRampOrderAta,
      feeDestinationAta,
      takerAta,
      makerAta,
      tokenProgram,
      systemProgram: SystemProgram.programId,
      validatorFeePoolAuthority,
      validatorFeePoolAta,
    })
    .remainingAccounts(
      await buildValidatorEarningRemainingAccounts(program, validatorKeypair.publicKey, mint, program.programId, tag)
    )
    .rpc();

  console.log(chalk.green(`[${tag}] ✅ Vote cast (${vote ? 'YES' : 'NO'}) — tx: ${sig.slice(0, 20)}...`));
}

// ─────────────────────────────────────────────────────────────────────────────
// ValidatorBot class
// ─────────────────────────────────────────────────────────────────────────────

export class ValidatorBot {
  private readonly connection: Connection;
  private readonly validatorKeypair: Keypair;
  private readonly program: Program<StockRamp>;
  private readonly apiKey: string;
  private readonly tag: string;
  private readonly processedSignatures = new Set<string>();
  private readonly inFlight = new Set<string>();

  constructor(config: ValidatorConfig) {
    if (!config.privateKey) throw new Error('privateKey is required');
    if (!config.apiKey)     throw new Error('apiKey is required');
    if (!PLATFORM_API_URL)  throw new Error('PLATFORM_API_URL is required');

    if (config.connection) {
      // Reuse a shared Connection (and its single websocket) across all
      // validators in this process instead of opening a new RPC connection
      // and websocket per validator.
      this.connection = config.connection;
    } else {
      const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
      this.connection = new Connection(rpcUrl, {
        commitment: 'confirmed',
        wsEndpoint: rpcUrl.replace('https://', 'wss://').replace('http://', 'ws://'),
      });
    }

    this.validatorKeypair = Keypair.fromSecretKey(bs58.decode(config.privateKey));
    this.apiKey  = config.apiKey;
    this.tag     = config.label ?? this.validatorKeypair.publicKey.toString().slice(0, 6);

    const wallet   = new NodeWallet(this.validatorKeypair);
    const provider = new AnchorProvider(this.connection, wallet, {
      commitment: 'confirmed',
      preflightCommitment: 'confirmed',
    });

    this.program = new Program(IDL as any, provider) as Program<StockRamp>;

    console.log(chalk.blue(`[${this.tag}] 🤖 Validator initialized: ${this.validatorKeypair.publicKey.toString()}`));
  }

  // ── Core event handler ────────────────────────────────────────────────────

  private async handleReservationEvent(event: ReservationEvent): Promise<void> {
    const { payoutReference, orderType } = event;

    if (this.inFlight.has(payoutReference)) return;
    this.inFlight.add(payoutReference);

    try {
      console.log(chalk.white(`[${this.tag}] 🔔 New ${orderType} reservation: ${payoutReference}`));
      console.log(chalk.white(`[${this.tag}]    Ref:    ${event.payoutReference}`));
      console.log(chalk.white(`[${this.tag}]    Taker:  ${event.taker.slice(0, 12)}...`));
      let displayAmount = event.amount.toString();
      try {
        const sroAccount = await (this.program.account as any).stockRampOrder.fetch(
          new PublicKey(event.stockRampOrder)
        );
        const mintInfo = await this.connection.getAccountInfo(sroAccount.mint);
        const decimals = mintInfo?.data[44] ?? 9; // decimals at offset 44 in mint layout
        displayAmount = (Number(event.amount) / Math.pow(10, decimals)).toFixed(2);
      } catch { /* fall back to raw */ }
      // fiatAmount is a plain, unscaled fiat value (e.g. 44748 = ₦44,748) — do NOT divide by 1e9.
      console.log(chalk.white(`[${this.tag}]    Amount: ${displayAmount} tokens | ${Number(event.fiatAmount)} ${event.currency}`));

      // Both buy and sell events need maker — buy events don't include it in the
      // log so we fetch it from the chain account.
      if (!event.maker) {
        try {
          const sroAccount = await (this.program.account as any).stockRampOrder.fetch(
            new PublicKey(event.stockRampOrder)
          );
          event.maker = sroAccount.maker.toString();
        } catch (err) {
          console.error(chalk.red(`[${this.tag}] ❌ Failed to fetch stock ramp order account:`), err);
          return;
        }
      }

      // ── BUY ORDER ────────────────────────────────────────────────────────────
      // Executor election + payout initiation + transfer verification + vote.
      // All handled inside handleBuyReservation — do NOT call verifyPaymentWithRetry
      // for buy orders (there is no inbound payment to verify; the bot sends fiat OUT).
      if (orderType === 'buy') {
        await handleBuyReservation(
          this.program,
          this.validatorKeypair,
          this.connection,
          event,
          this.apiKey,
          this.tag
        );
        return;
      }

      // ── SELL ORDER ───────────────────────────────────────────────────────────
      // Taker pays the seller via the platform's payment link. Validators verify the
      // inbound payment then vote. No executor election needed — all validators
      // independently check the same inbound reference.
      console.log(chalk.gray(`[${this.tag}] ⏳ Waiting ${VERIFICATION_DELAY_MS / 1000}s for payment to settle...`));
      await sleep(VERIFICATION_DELAY_MS);

      console.log(chalk.gray(`[${this.tag}] 🔍 Verifying payment...`));
      const verifyResult = await verifyPaymentWithRetry(event, this.apiKey, this.tag);

      const vote     = verifyResult.verified;
      const evidence = vote
        ? `Payment verified: ${verifyResult.amount} ${verifyResult.currency}`
        : `Payment not found or failed: ${verifyResult.error ?? 'unverified'}`;

      const verifiedColour = vote ? chalk.green : chalk.red;
      console.log(verifiedColour(`[${this.tag}] 📊 ${vote ? '✅ VERIFIED' : '❌ UNVERIFIED'} — ${evidence}`));
      console.log(chalk.cyan(`[${this.tag}] ⛓️  Casting ${vote ? 'YES' : 'NO'} vote on-chain...`));

      await submitSellVote(this.program, this.validatorKeypair, this.connection, event, vote, evidence.substring(0, 200), this.tag);

      if (vote) {
        try {
          const sroAccount = await (this.program.account as any).stockRampOrder.fetch(
            new PublicKey(event.stockRampOrder)
          );
          const mintInfo = await this.connection.getAccountInfo(sroAccount.mint);
          if (!mintInfo) throw new Error('Could not fetch mint account');
          const mintDecimals = mintInfo.data[44];
          const scaledFiatAmount = (Number(event.fiatAmount) / Math.pow(10, mintDecimals)).toString();

          const res = await fetch(`${PLATFORM_API_URL}/api/bot/generate-sell-receipt`, {
            method: 'POST',
            headers: botHeaders(this.apiKey),
            body: JSON.stringify({
              payout_reference:      event.payoutReference,
              stock_ramp_order_pda:  event.stockRampOrder,
              taker:                 event.taker,
              maker:                 event.maker,
              token_amount:          event.amount.toString(),
              fiat_amount:           scaledFiatAmount,
              currency:              event.currency,
              transaction_signature: event.signature,
              mint_address:          null,
            }),
          });
          const data = await res.json();
          if (data.success && !data.idempotent) {
            console.log(chalk.green(`[${this.tag}] 📄 Receipt generated: ${data.receipt_id}`));
          } else if (!data.success) {
            console.warn(chalk.yellow(`[${this.tag}] ⚠️  Receipt API error: ${data.error}`));
          }
        } catch (err) {
          console.warn(chalk.yellow(`[${this.tag}] ⚠️  Receipt generation failed (non-fatal):`), err);
        }
      }
    } catch (error: any) {
      const msg: string =
        error?.message ??
        error?.error?.errorMessage ??
        (typeof error === 'string' ? error : JSON.stringify(error));

      const codeMatch = msg.match(/"Custom"\s*:\s*(\d+)/);
      const code = codeMatch ? Number(codeMatch[1]) : undefined;

      if (
        msg.includes('VoteAlreadyExecuted')     || code === 6052 ||
        msg.includes('Unknown action')           ||
        msg.includes('Account does not exist')
      ) {
        console.log(chalk.gray(`[${this.tag}] ℹ️  Vote already executed for ${payoutReference}`));
        return;
      }
      if (msg.includes('AlreadyVoted') || code === 6051) {
        console.log(chalk.gray(`[${this.tag}] ℹ️  Already voted for ${payoutReference}`));
        return;
      }
      if (msg.includes('VoteExpired') || code === 6053) {
        console.log(chalk.yellow(`[${this.tag}] ⌛ Vote window expired for ${payoutReference}`));
        return;
      }
      if (
        msg.includes('ReservationNotFound')         || code === 6034 ||
        msg.includes('ReservationAlreadyProcessed') || code === 6035
      ) {
        console.log(chalk.gray(`[${this.tag}] ℹ️  Reservation ${payoutReference} already resolved`));
        return;
      }

      console.error(chalk.red(`[${this.tag}] ❌ Error handling reservation ${payoutReference}:`), error);
    } finally {
      this.inFlight.delete(payoutReference);
    }
  }

  // ── Log subscription ──────────────────────────────────────────────────────

  private async processLogs(logs: Logs): Promise<void> {
    const { signature, logs: logLines, err } = logs;

    if (err) return;
    if (this.processedSignatures.has(signature)) return;
    this.processedSignatures.add(signature);

    if (this.processedSignatures.size > 2000) {
      const [first] = this.processedSignatures;
      this.processedSignatures.delete(first);
    }

    const events = parseReservationEvents(logLines, signature);

    for (const event of events) {
      this.handleReservationEvent(event).catch((err) => {
        console.error(chalk.red(`[${this.tag}] ❌ Unhandled error in handleReservationEvent:`), err);
      });
    }
  }

  // ── Startup catchup — replays reservations missed while offline ───────────

  private async catchupMissedReservations(): Promise<void> {
    console.log(chalk.blue(`[${this.tag}] 🔄 Scanning for missed reservations...`));

    try {
      const accounts = await this.connection.getProgramAccounts(PROGRAM_ID, {
        filters: [
          {
            memcmp: {
              offset: 0,
              bytes: bs58.encode(STOCK_RAMP_ORDER_DISCRIMINATOR),
            },
          },
        ],
      });

      console.log(chalk.blue(`[${this.tag}]    Found ${accounts.length} active StockRampOrder(s)`));

      let replayed = 0;
      let skipped  = 0;

      for (const { pubkey } of accounts) {
        let sro: any;
        try {
          sro = await (this.program.account as any).stockRampOrder.fetch(pubkey);
        } catch {
          continue;
        }

        if (!sro.reservedAmounts || sro.reservedAmounts.length === 0) continue;

        for (const reservation of sro.reservedAmounts) {
          if (reservation.status !== 0) continue;

          const ref: string | null = reservation.payoutReference ?? null;
          if (!ref) continue;

          if (this.inFlight.has(ref)) {
            skipped++;
            continue;
          }

          const referenceHash   = computeReferenceHash(ref);
          const votePda         = deriveValidatorVotePda(pubkey, referenceHash);
          const voteAccountInfo = await this.connection.getAccountInfo(votePda);

          if (voteAccountInfo) {
            try {
              const voteAccount = await (this.program.account as any).validatorVote.fetch(votePda);

              if (voteAccount.executed) { skipped++; continue; }

              const alreadyVoted =
                Array.isArray(voteAccount.voters) &&
                voteAccount.voters.some(
                  (v: any) => !v.equals(PublicKey.default) && v.equals(this.validatorKeypair.publicKey)
                );

              if (alreadyVoted) { skipped++; continue; }
            } catch {
              skipped++;
              continue;
            }
          }

          const orderType: 'buy' | 'sell' = sro.escrowType === ESCROW_TYPE_SELL ? 'sell' : 'buy';
          const currency = Buffer.from(sro.currency)
            .toString('utf8')
            .replace(/\0/g, '')
            .trim();

          const event: ReservationEvent = {
            orderType,
            stockRampOrder: pubkey.toString(),
            maker: sro.maker.toString(),
            taker: reservation.taker.toString(),
            amount: BigInt(reservation.amount.toString()),
            fiatAmount: BigInt(reservation.fiatAmount.toString()),
            currency,
            payoutReference: ref,
            payoutDetails: reservation.payoutDetails ?? null,
            signature: 'catchup',
          };

          console.log(chalk.yellow(`[${this.tag}] 🔁 Replaying missed ${orderType} reservation: ${ref}`));
          replayed++;

          this.handleReservationEvent(event).catch((err) => {
            console.error(chalk.red(`[${this.tag}] ❌ Catchup error for ${ref}:`), err);
          });
        }
      }

      if (replayed === 0 && skipped === 0) {
        console.log(chalk.blue(`[${this.tag}] ✅ Catchup complete — no pending reservations found`));
      } else {
        console.log(chalk.blue(`[${this.tag}] ✅ Catchup complete — replayed: ${replayed}, already handled: ${skipped}`));
      }
    } catch (err) {
      console.error(chalk.red(`[${this.tag}] ❌ Catchup scan failed:`), err);
    }
  }

  // ── Expired vote cleanup ──────────────────────────────────────────────────

  private startExpiredVoteCleaner(): void {
    const INTERVAL_MS = 5 * 60 * 1000;

    setInterval(async () => {
      try {
        const voteAccounts = await this.connection.getProgramAccounts(PROGRAM_ID, {
          filters: [
            {
              memcmp: {
                offset: 0,
                bytes: bs58.encode(VALIDATOR_VOTE_DISCRIMINATOR),
              },
            },
          ],
        });

        const now = Math.floor(Date.now() / 1000);

        for (const { pubkey } of voteAccounts) {
          try {
            const voteAccount = await (this.program.account as any).validatorVote.fetch(pubkey);

            // ── Close executed votes (rent reclaim) ─────────────────────────
            if (voteAccount.executed) {
              const sig = await this.program.methods
                .closeExecutedVote()
                .accountsPartial({
                  caller: this.validatorKeypair.publicKey,
                  validatorVote: pubkey,
                  systemProgram: SystemProgram.programId,
                })
                .rpc();
              console.log(chalk.green(`[${this.tag}] ♻️  Closed executed vote, rent reclaimed: ${sig.slice(0, 20)}...`));
              continue;
            }

            // ── Finalize expired votes (refund taker) ───────────────────────
            if (voteAccount.expiresAt.toNumber() > now) continue;

            const stockRampOrderPubkey: PublicKey = voteAccount.stockRampOrder;
            const takerPubkey: PublicKey           = voteAccount.taker;

            const stockRampOrderAccount = await (this.program.account as any).stockRampOrder.fetch(
              stockRampOrderPubkey
            );

            // Find the matching reservation by taker + pending status + present reference
            const reservation = (stockRampOrderAccount.reservedAmounts as any[]).find(
              (r: any) => r.taker.equals(takerPubkey) && r.status === 0 && r.payoutReference
            );

            if (!reservation) {
              console.log(chalk.gray(`[${this.tag}] ℹ️  No matching reservation for expired vote ${pubkey.toString()} — skipping`));
              continue;
            }

            const payoutReference: string = reservation.payoutReference;

            const mint: PublicKey = stockRampOrderAccount.mint;
            const mintInfo        = await this.connection.getAccountInfo(mint);
            const tokenProgram    = mintInfo?.owner.equals(TOKEN_2022_PROGRAM_ID)
              ? TOKEN_2022_PROGRAM_ID
              : TOKEN_PROGRAM_ID;

            const stockRampOrderAta = getAssociatedTokenAddressSync(mint, stockRampOrderPubkey, true, tokenProgram);
            const takerAta          = getAssociatedTokenAddressSync(mint, takerPubkey, false, tokenProgram);

            const sig = await this.program.methods
              .finalizeExpiredVote(payoutReference)
              .accountsPartial({
                caller: this.validatorKeypair.publicKey,
                globalState: deriveGlobalStatePda(),
                validatorVote: pubkey,
                stockRampOrder: stockRampOrderPubkey,
                mint,
                stockRampOrderAta,
                takerAta,
                tokenProgram,
                systemProgram: SystemProgram.programId,
              })
              .rpc();

            console.log(chalk.green(`[${this.tag}] ✅ Expired vote finalized: ${sig}`));
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            // 'Unknown action' is a known symptom of a specific race, not a
            // real failure: this cleaner's setInterval runs on every one of
            // the 5 validators concurrently, each taking its own
            // getProgramAccounts snapshot of ValidatorVote accounts and then
            // racing the others to closeExecutedVote()/finalizeExpiredVote()
            // on the same accounts. If a different validator's tx lands
            // first and closes/reallocs the account this validator is
            // mid-confirmation on, the client-side confirmation response can
            // come back malformed (containing the literal string
            // 'undefined') even though nothing actually went wrong on-chain.
            // handleReservationEvent's catch above already treats this the
            // same way for submit_sell_vote, and
            // handlers/buyOrderHandler.ts::submitBuyVoteWithRetry documents
            // the identical race for submit_buy_vote — this is just the
            // third call site that can hit it.
            if (
              !msg.includes('VoteNotYetExpired') &&
              !msg.includes('VoteAlreadyExecuted') &&
              !msg.includes('ReservationNotFound') &&
              !msg.includes('Account does not exist or has no data') &&
              !msg.includes('AccountNotInitialized') &&
              !msg.includes('Unknown action')
            ) {
              console.warn(chalk.yellow(`[${this.tag}] ⚠️  Failed to finalize vote ${pubkey.toString()}: ${msg}`));
            }
          }
        }
      } catch (err) {
        console.error(chalk.red(`[${this.tag}] ❌ Error in expired vote cleaner:`), err);
      }
    }, INTERVAL_MS);
  }

  // ── Startup ───────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    console.log(chalk.blue(`[${this.tag}] 🚀 Starting...`));

    const version = await this.connection.getVersion();
    console.log(chalk.green(`[${this.tag}] ✅ Connected to Solana (${version['solana-core']})`));

    const globalStatePda = deriveGlobalStatePda();
    const globalState    = await (this.program.account as any).globalState.fetch(globalStatePda);
    const isRegistered   = globalState.validators.some(
      (v: PublicKey) => v.equals(this.validatorKeypair.publicKey)
    );

    if (!isRegistered) {
      throw new Error(
        `[${this.tag}] ❌ Validator ${this.validatorKeypair.publicKey.toString()} is NOT registered on-chain.`
      );
    }

    console.log(chalk.green(`[${this.tag}] ✅ Registered on-chain — required votes: ${globalState.requiredVotes}`));

    // Catchup before going live — handles events missed during startup/restart
    await this.catchupMissedReservations();

    // Live WebSocket subscription
    this.connection.onLogs(
      PROGRAM_ID,
      (logs) => {
        this.processLogs(logs).catch((err) =>
          console.error(chalk.red(`[${this.tag}] ❌ Error in log handler:`), err)
        );
      },
      'confirmed'
    );

    console.log(chalk.green(`[${this.tag}] 👂 Listening for on-chain events...`));

    this.startExpiredVoteCleaner();
    console.log(chalk.blue(`[${this.tag}] 🧹 Expired vote cleaner started`));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Single-validator entry point
// ─────────────────────────────────────────────────────────────────────────────

async function sendHeartbeat() {
  try {
    const res = await fetch(`${PLATFORM_API_URL}/api/bot/heartbeat`, {
      method: 'POST',
      headers: botHeaders(),
    });
    if (res.ok) {
      console.log(chalk.cyan('[V1] 💓 Heartbeat sent'));
    } else {
      console.warn(chalk.yellow(`[V1] ⚠️  Heartbeat rejected (${res.status})`));
    }
  } catch (err) {
    console.warn(chalk.yellow(`[V1] ⚠️  Heartbeat failed: ${err}`));
  }
}

async function main() {
  const bot = new ValidatorBot({
    privateKey: process.env.VALIDATOR_PRIVATE_KEY!,
    apiKey:     process.env.VALIDATOR_API_KEY!,
    label:      'V1',
  });

  process.on('SIGINT',  () => { console.log(chalk.yellow('\n👋 Shutting down...')); process.exit(0); });
  process.on('SIGTERM', () => { console.log(chalk.yellow('\n👋 Shutting down...')); process.exit(0); });

  sendHeartbeat(); // immediate on startup
  setInterval(sendHeartbeat, 60_000); // every 60 seconds

  await bot.start();
}

const isMain = process.argv[1]?.endsWith('val_bot.ts') || process.argv[1]?.endsWith('val_bot.js');
if (isMain) {
  main().catch((err) => {
    console.error(chalk.red('❌ Fatal error:'), err);
    process.exit(1);
  });
}
