// client/hooks/useStockRampProgram.ts
// The big program hook — every stock-ramp instruction is exposed from here.
// Wraps the generated IDL client at `client/relics/stock_ramp.ts` /
// `stock_ramp.json`. Mirrors trust_vault's `useTrustVaultProgram.ts` shape,
// adapted to stock-ramp's actual accounts (see STOCKRAMP_FRONTEND_PLAN.md).
//
// Dependency note: this file (and lib/client.ts) needs @solana/web3.js and
// @solana/wallet-adapter-react added to the client's package.json — they
// aren't in the repo root's dependencies yet (see Todo.md).

"use client";

import { useMemo } from "react";
import { Program, BN, type IdlAccounts } from "@coral-xyz/anchor";
import {
  PublicKey,
  SystemProgram,
  Transaction,
  type TransactionSignature,
} from "@solana/web3.js";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { useQuery } from "@tanstack/react-query";

import { getAnchorProvider } from "../lib/client";
import {
  STOCK_RAMP_PROGRAM_ID,
  GLOBAL_STATE_SEED,
  STOCK_RAMP_ORDER_SEED,
  VALIDATOR_VOTE_SEED,
  VALIDATOR_FEE_POOL_AUTHORITY_SEED,
  VALIDATOR_EARNINGS_SEED,
} from "../lib/constant";
import stockRampIdl from "../relics/stock_ramp.json";
import type { StockRamp } from "../relics/stock_ramp";

export type GlobalState = IdlAccounts<StockRamp>["globalState"];
export type StockRampOrderAccount = IdlAccounts<StockRamp>["stockRampOrder"];
export type ValidatorEarningsAccount = IdlAccounts<StockRamp>["validatorEarnings"];
export type ValidatorVoteAccount = IdlAccounts<StockRamp>["validatorVote"];

// -----------------------------------------------------------------------
// PDA helpers — mirror seeds in programs/stock-ramp/src/constants.rs exactly.
// -----------------------------------------------------------------------

export function findGlobalStatePda(programId = STOCK_RAMP_PROGRAM_ID) {
  return PublicKey.findProgramAddressSync([GLOBAL_STATE_SEED], programId);
}

export function findStockRampOrderPda(
  maker: PublicKey,
  seed: BN | number | bigint,
  programId = STOCK_RAMP_PROGRAM_ID
) {
  return PublicKey.findProgramAddressSync(
    [STOCK_RAMP_ORDER_SEED, maker.toBuffer(), new BN(seed.toString()).toArrayLike(Buffer, "le", 8)],
    programId
  );
}

export function findValidatorVotePda(
  stockRampOrder: PublicKey,
  referenceHash: Uint8Array,
  programId = STOCK_RAMP_PROGRAM_ID
) {
  return PublicKey.findProgramAddressSync(
    [VALIDATOR_VOTE_SEED, stockRampOrder.toBuffer(), Buffer.from(referenceHash)],
    programId
  );
}

export function findValidatorFeePoolAuthorityPda(programId = STOCK_RAMP_PROGRAM_ID) {
  return PublicKey.findProgramAddressSync(
    [VALIDATOR_FEE_POOL_AUTHORITY_SEED],
    programId
  );
}

export function findValidatorEarningsPda(
  validator: PublicKey,
  mint: PublicKey,
  programId = STOCK_RAMP_PROGRAM_ID
) {
  return PublicKey.findProgramAddressSync(
    [VALIDATOR_EARNINGS_SEED, validator.toBuffer(), mint.toBuffer()],
    programId
  );
}

function ata(mint: PublicKey, owner: PublicKey, tokenProgramId = TOKEN_PROGRAM_ID) {
  return getAssociatedTokenAddressSync(mint, owner, true, tokenProgramId);
}

// -----------------------------------------------------------------------
// Hook
// -----------------------------------------------------------------------

export function useStockRampProgram() {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();

  const provider = useMemo(() => getAnchorProvider(wallet), [wallet, connection]);

  const program = useMemo(
    () => new Program<StockRamp>(stockRampIdl as StockRamp, provider),
    [provider]
  );

  const wallet_pk = wallet?.publicKey;

  const getGlobalState = useQuery({
  queryKey: ["get-stock-ramp-global-state"],
  queryFn: async () => {
    try {
      const [globalState] = findGlobalStatePda();
      return await program.account.globalState.fetch(globalState);
    } catch (error: unknown) {
      const isAccountNotFound =
        error instanceof Error &&
        (error.message?.includes("Account does not exist") ||
          error.message?.includes("has no data"));
      if (isAccountNotFound) {
        console.log("Stock ramp global state account does not exist yet");
        return null;
      }
      console.error("Error fetching stock ramp global state:", error);
      return null;
    }
  },
  staleTime: 30000,
  refetchOnWindowFocus: false,
  refetchInterval: false,
  retry: false,
});
  // ---------------------------------------------------------------------
  // Token program auto-detection — mirrors trust_express's isToken2022().
  // Callers can still pass tokenProgramId explicitly to skip the lookup.
  // ---------------------------------------------------------------------

  async function detectTokenProgramId(mint: PublicKey): Promise<PublicKey> {
    try {
      const mintInfo = await connection.getAccountInfo(mint);
      if (mintInfo?.owner.equals(TOKEN_2022_PROGRAM_ID)) {
        return TOKEN_2022_PROGRAM_ID;
      }
      return TOKEN_PROGRAM_ID;
    } catch (error) {
      console.warn(`Could not detect token program for mint ${mint.toString()}, defaulting to TOKEN_PROGRAM_ID:`, error);
      return TOKEN_PROGRAM_ID;
    }
  }

  // ---------------------------------------------------------------------
  // Send + confirm with visibility. Unlike a bare `.rpc()` — which returns
  // only after confirmation and gives you nothing to check against Solscan
  // if that confirmation hangs — this sends first, logs (and hands back via
  // onSigned) the signature immediately, and only then confirms using an
  // explicit blockhash/lastValidBlockHeight strategy so a dropped/rate-limited
  // devnet websocket subscription times out instead of hanging forever.
  // Mirrors trust_express's instantSellReserve, generalized for reuse here.
  // ---------------------------------------------------------------------

async function sendAndConfirmWithLogging(
  methodBuilder: { transaction: () => Promise<Transaction> },
  label: string,
  onSigned?: (signature: TransactionSignature) => void
): Promise<TransactionSignature> {
  if (!wallet?.signTransaction || !wallet_pk) {
    throw new Error("Wallet not connected");
  }

  // Cheap, fast check that turns "AccountNotFound" into something a human
  // can act on, instead of an opaque RPC rejection during simulation.
  const balance = await connection.getBalance(wallet_pk);
  if (balance === 0) {
    throw new Error(
      "Your wallet has no SOL. Airdrop some devnet SOL (e.g. via your wallet's faucet, or `solana airdrop 2` in a terminal) before retrying."
    );
  }

  const tx = await methodBuilder.transaction();

  for (const ix of tx.instructions) {
  for (const key of ix.keys) {
    const info = await connection.getAccountInfo(key.pubkey);
    console.log(`[${label}] account ${key.pubkey.toBase58()} exists:`, info !== null);
  }
}
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = wallet_pk;

  // ── DEBUG: simulate BEFORE asking the wallet to sign, so we get the
  // real on-chain error/logs in the console instead of the wallet's
  // opaque "Simulation failed" banner. sigVerify:false lets us simulate
  // an unsigned tx. Remove once we've root-caused the reserve issue.
  try {
    const sim = await connection.simulateTransaction(tx);
    console.log(`[${label}] simulation result:`, sim.value);
    if (sim.value.err) {
      console.error(`[${label}] simulation error:`, sim.value.err);
      console.error(`[${label}] program logs:`, sim.value.logs);
    }
  } catch (simErr) {
    console.error(`[${label}] simulateTransaction threw:`, simErr);
  }
  // ── end debug block

  const signedTx = await wallet.signTransaction(tx);
  const signature = await connection.sendRawTransaction(signedTx.serialize(), {
    skipPreflight: false,
  });

  console.log(`[${label}] transaction sent:`, signature);
  onSigned?.(signature);

  await connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed"
  );

  console.log(`[${label}] transaction confirmed:`, signature);
  return signature;
}

  

  // ---------------------------------------------------------------------
  // Admin
  // ---------------------------------------------------------------------

  async function initializeGlobalState(): Promise<TransactionSignature> {
    if (!wallet_pk) throw new Error("Wallet not connected");
    const [globalState] = findGlobalStatePda();
    return program.methods
      .initializeGlobalState()
      .accountsPartial({
        authority: wallet_pk,
        globalState,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  async function updateFeePercentage(newFeeBasisPoints: number): Promise<TransactionSignature> {
    if (!wallet_pk) throw new Error("Wallet not connected");
    const [globalState] = findGlobalStatePda();
    return program.methods
      .updateFeePercentage(newFeeBasisPoints)
      .accounts({ authority: wallet_pk, globalState })
      .rpc();
  }

  async function updateFeeDestination(newDestination: PublicKey): Promise<TransactionSignature> {
    if (!wallet_pk) throw new Error("Wallet not connected");
    const [globalState] = findGlobalStatePda();
    return program.methods
      .updateFeeDestination(newDestination)
      .accounts({ authority: wallet_pk, globalState })
      .rpc();
  }

  async function pauseBuyOrders(paused: boolean): Promise<TransactionSignature> {
    if (!wallet_pk) throw new Error("Wallet not connected");
    const [globalState] = findGlobalStatePda();
    return program.methods
      .pauseBuyOrders(paused)
      .accounts({ authority: wallet_pk, globalState })
      .rpc();
  }

  async function pauseSellOrders(paused: boolean): Promise<TransactionSignature> {
    if (!wallet_pk) throw new Error("Wallet not connected");
    const [globalState] = findGlobalStatePda();
    return program.methods
      .pauseSellOrders(paused)
      .accounts({ authority: wallet_pk, globalState })
      .rpc();
  }

  async function registerValidator(validator: PublicKey): Promise<TransactionSignature> {
    if (!wallet_pk) throw new Error("Wallet not connected");
    const [globalState] = findGlobalStatePda();
    return program.methods
      .registerValidator(validator)
      .accounts({ authority: wallet_pk, globalState })
      .rpc();
  }

  async function removeValidator(validator: PublicKey): Promise<TransactionSignature> {
    if (!wallet_pk) throw new Error("Wallet not connected");
    const [globalState] = findGlobalStatePda();
    return program.methods
      .removeValidator(validator)
      .accounts({ authority: wallet_pk, globalState })
      .rpc();
  }

  async function updateRequiredVotes(n: number): Promise<TransactionSignature> {
    if (!wallet_pk) throw new Error("Wallet not connected");
    const [globalState] = findGlobalStatePda();
    return program.methods
      .updateRequiredVotes(n)
      .accounts({ authority: wallet_pk, globalState })
      .rpc();
  }

  // ---------------------------------------------------------------------
  // Orders — create / cancel / price / withdraw
  // ---------------------------------------------------------------------

  interface CreateOrderArgs {
    seed: BN | number | bigint;
    mint: PublicKey;
    amount: BN | number | bigint;
    pricePerToken: BN | number | bigint;
    currency: string; // exactly 3 bytes, e.g. "NGN"
    paymentInstructions: string;
    flutterwaveCredentialId: string;
    tokenProgramId?: PublicKey;
  }

  async function createBuyOrder(
    args: CreateOrderArgs,
    onSigned?: (signature: TransactionSignature) => void
  ): Promise<TransactionSignature> {
    if (!wallet_pk) throw new Error("Wallet not connected");
    const tokenProgramId = args.tokenProgramId ?? (await detectTokenProgramId(args.mint));
    const [stockRampOrder] = findStockRampOrderPda(wallet_pk, args.seed);
    const [globalState] = findGlobalStatePda();

    const methodBuilder = program.methods
      .createBuyOrder(
        new BN(args.seed.toString()),
        new BN(args.amount.toString()),
        new BN(args.pricePerToken.toString()),
        args.currency,
        args.paymentInstructions,
        args.flutterwaveCredentialId
      )
      .accountsPartial({
        buyer: wallet_pk,
        mint: args.mint,
        stockRampOrder,
        globalState,
        systemProgram: SystemProgram.programId,
        tokenProgram: tokenProgramId,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      });

    return sendAndConfirmWithLogging(methodBuilder, "createBuyOrder", onSigned);
  }

  async function createSellOrder(args: CreateOrderArgs): Promise<TransactionSignature> {
    if (!wallet_pk) throw new Error("Wallet not connected");
    const tokenProgramId = args.tokenProgramId ?? (await detectTokenProgramId(args.mint));
    const [stockRampOrder] = findStockRampOrderPda(wallet_pk, args.seed);
    const [globalState] = findGlobalStatePda();
    const sellerAta = ata(args.mint, wallet_pk, tokenProgramId);
    const stockRampOrderAta = ata(args.mint, stockRampOrder, tokenProgramId);

    return program.methods
      .createSellOrder(
        new BN(args.seed.toString()),
        new BN(args.amount.toString()),
        new BN(args.pricePerToken.toString()),
        args.currency,
        args.paymentInstructions,
        args.flutterwaveCredentialId
      )
      .accountsPartial({
        seller: wallet_pk,
        mint: args.mint,
        sellerAta,
        stockRampOrder,
        stockRampOrderAta,
        globalState,
        systemProgram: SystemProgram.programId,
        tokenProgram: tokenProgramId,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();
  }

  async function cancelOrReduceBuyOrder(
    orderSeed: BN | number | bigint,
    newAmount: BN | number | bigint
  ): Promise<TransactionSignature> {
    if (!wallet_pk) throw new Error("Wallet not connected");
    const [stockRampOrder] = findStockRampOrderPda(wallet_pk, orderSeed);
    return program.methods
      .cancelOrReduceBuyOrder(new BN(newAmount.toString()))
      .accountsPartial({
        buyer: wallet_pk,
        stockRampOrder,
        maker: wallet_pk,
      })
      .rpc();
  }

  async function updatePrice(
    orderSeed: BN | number | bigint,
    newPricePerToken: BN | number | bigint
  ): Promise<TransactionSignature> {
    if (!wallet_pk) throw new Error("Wallet not connected");
    const [stockRampOrder] = findStockRampOrderPda(wallet_pk, orderSeed);
    return program.methods
      .updatePrice(new BN(newPricePerToken.toString()))
      .accountsPartial({ maker: wallet_pk, stockRampOrder })
      .rpc();
  }

  async function stockRampWithdraw(args: {
    orderSeed: BN | number | bigint;
    mint: PublicKey;
    withdrawAmount: BN | number | bigint;
    tokenProgramId?: PublicKey;
  }): Promise<TransactionSignature> {
    if (!wallet_pk) throw new Error("Wallet not connected");
    const tokenProgramId = args.tokenProgramId ?? (await detectTokenProgramId(args.mint));
    const [stockRampOrder] = findStockRampOrderPda(wallet_pk, args.orderSeed);
    const makerAta = ata(args.mint, wallet_pk, tokenProgramId);
    const stockRampOrderAta = ata(args.mint, stockRampOrder, tokenProgramId);

    return program.methods
      .stockRampWithdraw(new BN(args.withdrawAmount.toString()))
      .accountsPartial({
        maker: wallet_pk,
        stockRampOrder,
        mint: args.mint,
        makerAta,
        stockRampOrderAta,
        tokenProgram: tokenProgramId,
      })
      .rpc();
  }

  // ---------------------------------------------------------------------
  // Instant reserve (buy-side taker) / Instant sell reserve (sell-side taker)
  // ---------------------------------------------------------------------

 async function instantReserve(args: {
  stockRampOrder: PublicKey;
  maker: PublicKey;
  mint: PublicKey;
  amount: BN | number | bigint;
  fiatAmount: BN | number | bigint;
  currency: string;
  payoutDetails?: string | null;
  tokenProgramId?: PublicKey;
}): Promise<TransactionSignature> {
  if (!wallet_pk) throw new Error("Wallet not connected");
  const tokenProgramId = args.tokenProgramId ?? (await detectTokenProgramId(args.mint));
  const [globalState] = findGlobalStatePda();
  const takerAta = ata(args.mint, wallet_pk, tokenProgramId);
  const stockRampOrderAta = ata(args.mint, args.stockRampOrder, tokenProgramId);

  const methodBuilder = program.methods
    .instantReserve(
      new BN(args.amount.toString()),
      new BN(args.fiatAmount.toString()),
      args.currency,
      args.payoutDetails ?? null
    )
    .accountsPartial({
      stockRampOrder: args.stockRampOrder,
      maker: args.maker,
      taker: wallet_pk,
      mint: args.mint,
      takerAta,
      stockRampOrderAta,
      globalState,
      tokenProgram: tokenProgramId,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    });

  return sendAndConfirmWithLogging(methodBuilder, "instantReserve");
}

 async function instantSellReserve(args: {
  stockRampOrder: PublicKey;
  maker: PublicKey;
  amount: BN | number | bigint;
  paymentMode: number;
  buyerPayoutDetails?: string | null;
  payoutReference: string;
}): Promise<TransactionSignature> {
  if (!wallet_pk) throw new Error("Wallet not connected");
  const [globalState] = findGlobalStatePda();

  const methodBuilder = program.methods
    .instantSellReserve(
      new BN(args.amount.toString()),
      args.paymentMode,
      args.buyerPayoutDetails ?? null,
      args.payoutReference
    )
    .accountsPartial({
      stockRampOrder: args.stockRampOrder,
      maker: args.maker,
      buyer: wallet_pk,
      globalState,
      systemProgram: SystemProgram.programId,
    });

  return sendAndConfirmWithLogging(methodBuilder, "instantSellReserve");
}

  // ---------------------------------------------------------------------
  // Validator fee pool setup (one-time per mint)
  // ---------------------------------------------------------------------

  async function initializeValidatorFeePoolAta(
    mint: PublicKey,
    tokenProgramId = TOKEN_PROGRAM_ID
  ): Promise<TransactionSignature> {
    if (!wallet_pk) throw new Error("Wallet not connected");
    const [globalState] = findGlobalStatePda();
    const [validatorFeePoolAuthority] = findValidatorFeePoolAuthorityPda();
    const validatorFeePoolAta = ata(mint, validatorFeePoolAuthority, tokenProgramId);

    return program.methods
      .initializeValidatorFeePoolAta()
      .accountsPartial({
        payer: wallet_pk,
        globalState,
        mint,
        validatorFeePoolAuthority,
        validatorFeePoolAta,
        tokenProgram: tokenProgramId,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  // ---------------------------------------------------------------------
  // Validator voting
  // ---------------------------------------------------------------------

  interface SubmitVoteBaseArgs {
    stockRampOrder: PublicKey;
    maker: PublicKey;
    mint: PublicKey;
    referenceHash: Uint8Array; // keccak256(payoutReference), 32 bytes
    payoutReference: string;
    taker: PublicKey;
    vote: boolean;
    evidence: string;
    feeDestinationAta: PublicKey;
    takerAta: PublicKey;
    makerAta: PublicKey;
    /** Up to 5 ValidatorEarnings PDAs (one per voter) passed as remaining accounts. */
    validatorEarningsAccounts?: PublicKey[];
    tokenProgramId?: PublicKey;
  }

  async function submitBuyVote(
    args: SubmitVoteBaseArgs & { amount: BN | number | bigint; fiatAmount: BN | number | bigint; currency: string }
  ): Promise<TransactionSignature> {
    if (!wallet_pk) throw new Error("Wallet not connected");
    const tokenProgramId = args.tokenProgramId ?? TOKEN_PROGRAM_ID;
    const [globalState] = findGlobalStatePda();
    const [validatorVote] = findValidatorVotePda(args.stockRampOrder, args.referenceHash);
    const [validatorFeePoolAuthority] = findValidatorFeePoolAuthorityPda();
    const stockRampOrderAta = ata(args.mint, args.stockRampOrder, tokenProgramId);
    const validatorFeePoolAta = ata(args.mint, validatorFeePoolAuthority, tokenProgramId);

    return program.methods
      .submitBuyVote(
        Array.from(args.referenceHash) as unknown as number[],
        args.payoutReference,
        args.taker,
        new BN(args.amount.toString()),
        new BN(args.fiatAmount.toString()),
        args.currency,
        args.vote,
        args.evidence
      )
      .accountsPartial({
        validator: wallet_pk,
        globalState,
        stockRampOrder: args.stockRampOrder,
        validatorVote,
        maker: args.maker,
        mint: args.mint,
        stockRampOrderAta,
        feeDestinationAta: args.feeDestinationAta,
        takerAta: args.takerAta,
        makerAta: args.makerAta,
        validatorFeePoolAuthority,
        validatorFeePoolAta,
        tokenProgram: tokenProgramId,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(
        (args.validatorEarningsAccounts ?? []).map((pubkey) => ({
          pubkey,
          isWritable: true,
          isSigner: false,
        }))
      )
      .rpc();
  }

  async function submitSellVote(args: SubmitVoteBaseArgs): Promise<TransactionSignature> {
    if (!wallet_pk) throw new Error("Wallet not connected");
    const tokenProgramId = args.tokenProgramId ?? TOKEN_PROGRAM_ID;
    const [globalState] = findGlobalStatePda();
    const [validatorVote] = findValidatorVotePda(args.stockRampOrder, args.referenceHash);
    const [validatorFeePoolAuthority] = findValidatorFeePoolAuthorityPda();
    const stockRampOrderAta = ata(args.mint, args.stockRampOrder, tokenProgramId);
    const validatorFeePoolAta = ata(args.mint, validatorFeePoolAuthority, tokenProgramId);

    return program.methods
      .submitSellVote(
        Array.from(args.referenceHash) as unknown as number[],
        args.payoutReference,
        args.taker,
        args.vote,
        args.evidence
      )
      .accountsPartial({
        validator: wallet_pk,
        globalState,
        stockRampOrder: args.stockRampOrder,
        validatorVote,
        maker: args.maker,
        mint: args.mint,
        stockRampOrderAta,
        feeDestinationAta: args.feeDestinationAta,
        takerAta: args.takerAta,
        makerAta: args.makerAta,
        validatorFeePoolAuthority,
        validatorFeePoolAta,
        tokenProgram: tokenProgramId,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(
        (args.validatorEarningsAccounts ?? []).map((pubkey) => ({
          pubkey,
          isWritable: true,
          isSigner: false,
        }))
      )
      .rpc();
  }

  async function finalizeExpiredVote(args: {
    stockRampOrder: PublicKey;
    validatorVote: PublicKey;
    mint: PublicKey;
    takerAta: PublicKey;
    payoutReference: string;
    tokenProgramId?: PublicKey;
  }): Promise<TransactionSignature> {
    if (!wallet_pk) throw new Error("Wallet not connected");
    const tokenProgramId = args.tokenProgramId ?? TOKEN_PROGRAM_ID;
    const [globalState] = findGlobalStatePda();
    const stockRampOrderAta = ata(args.mint, args.stockRampOrder, tokenProgramId);

    return program.methods
      .finalizeExpiredVote(args.payoutReference)
      .accountsPartial({
        caller: wallet_pk,
        globalState,
        validatorVote: args.validatorVote,
        stockRampOrder: args.stockRampOrder,
        mint: args.mint,
        stockRampOrderAta,
        takerAta: args.takerAta,
        tokenProgram: tokenProgramId,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  async function closeExecutedVote(validatorVote: PublicKey): Promise<TransactionSignature> {
    if (!wallet_pk) throw new Error("Wallet not connected");
    return program.methods
      .closeExecutedVote()
      .accountsPartial({ caller: wallet_pk, validatorVote, systemProgram: SystemProgram.programId })
      .rpc();
  }

  // ---------------------------------------------------------------------
  // Account fetch helpers (thin wrappers, real caching lives in hooks/queries/*)
  // ---------------------------------------------------------------------

  const account = program.account;

  return {
    program,
    provider,
    connection,
    wallet: wallet_pk,
    account,

    // PDA helpers
    findGlobalStatePda,
    findStockRampOrderPda,
    findValidatorVotePda,
    findValidatorFeePoolAuthorityPda,
    findValidatorEarningsPda,
    getGlobalState,
    // Token program detection / send helpers
    detectTokenProgramId,
    sendAndConfirmWithLogging,

    // Admin
    initializeGlobalState,
    updateFeePercentage,
    updateFeeDestination,
    pauseBuyOrders,
    pauseSellOrders,
    registerValidator,
    removeValidator,
    updateRequiredVotes,

    // Orders
    createBuyOrder,
    createSellOrder,
    cancelOrReduceBuyOrder,
    updatePrice,
    stockRampWithdraw,

    // Reservations
    instantReserve,
    instantSellReserve,

    // Validator setup / voting
    initializeValidatorFeePoolAta,
    submitBuyVote,
    submitSellVote,
    finalizeExpiredVote,
    closeExecutedVote,
  };
}