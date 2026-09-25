// tests/validator-consensus_test.ts
//
// Ported and extended from validator_consensus_test.ts — this suite already
// matched the current program's vote-based settlement shape most closely.
//
// Covers:
//   1.  initialize_global_state
//   2.  register_validator / remove_validator / update_required_votes
//   3.  initialize_validator_fee_pool_ata (new — required before any votes)
//   4.  create buy order + instant_reserve (setup helpers)
//   5.  submit_buy_vote — 3-of-5 happy path → tokens released to maker
//   6.  submit_buy_vote — 3 rejections → impossible_to_approve → refund
//   7.  submit_buy_vote — duplicate vote rejected (AlreadyVoted)
//   8.  submit_buy_vote — non-validator rejected (UnauthorizedValidator)
//   9.  submit_buy_vote — validator earnings crediting via remaining_accounts (new)
//  10.  finalize_expired_vote — documented (clock-manipulation required)
//  11.  close_executed_vote — closes a settled ValidatorVote PDA (new)
//  12.  update_price — maker updates price_per_token (new)
//  13.  submit_sell_vote — 3-of-5 happy path
//  14.  PARTIAL FILL CLOSE FIX — buy order that is partially settled stays open;
//       only closes when stock_ramp_order.amount reaches 0
//
// FIX APPLIED (registration tests): `global_state` is a program-wide
// singleton that also persists ACROSS separate `anchor test
// --skip-local-validator` invocations, not just across files in one run.
// This file's original "registers all 5 validators" test called
// registerValidator raw and uncaught, assuming validator_count started at 0
// — but every other *_test.ts file registers the same SHARED_VALIDATORS set
// via ensureValidatorsRegistered() first, so by the time this file runs the
// slots are typically already full. register_validator checks slots-full
// BEFORE checking already-registered, so both this test and the "rejects
// duplicate" test were surfacing ValidatorSlotsFull instead of the behavior
// they're meant to exercise. Fixed to make registration idempotent (like the
// other files) and to make the duplicate-registration test independent of
// how many slots happen to be free when it runs.

import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { StockRamp } from "../target/types/stock_ramp";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { assert } from "chai";
import {
  airdrop,
  airdropAll,
  computeTotalFee,
  ensureValidatorFeePoolAta,
  globalStatePda,
  referenceHash,
  referenceHashBytes,
  splitFee,
  splitValidatorPool,
  stockRampOrderPda,
  validatorEarningsPda,
  validatorEarningsRemainingAccounts,
  validatorFeePoolAta,
  validatorFeePoolAuthorityPda,
  validatorVotePda,
  SHARED_VALIDATORS
} from "./helpers";

describe("Validator Consensus — 3-of-5 voting system", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.StockRamp as Program<StockRamp>;
  const connection = provider.connection;

  const authority = provider.wallet as anchor.Wallet;
  const maker = Keypair.generate(); // LP / buyer
  const taker = Keypair.generate(); // seller / counterparty

  const validators = SHARED_VALIDATORS;

  let mint: PublicKey;
  let makerAta: PublicKey;
  let takerAta: PublicKey;
  let feeDestinationAta: PublicKey;

  let globalState: PublicKey;
  const stockRampSeed = new BN(42);
  let stockRampOrder: PublicKey;
  let stockRampOrderAta: PublicKey;

  const TOKEN_DECIMALS = 6;
  const DEPOSIT_AMOUNT = 1_000_000; // 1 token (6 dec)
  const PRICE_PER_TOKEN = 1_500;
  const FIAT_AMOUNT = DEPOSIT_AMOUNT * PRICE_PER_TOKEN;
  let actualPayoutReference = "";

  before(async () => {
    await airdropAll(connection, [maker.publicKey, taker.publicKey, ...validators.map((v) => v.publicKey)]);

    mint = await createMint(connection, authority.payer, authority.publicKey, null, TOKEN_DECIMALS);

    makerAta = await createAssociatedTokenAccount(connection, authority.payer, mint, maker.publicKey);
    takerAta = await createAssociatedTokenAccount(connection, authority.payer, mint, taker.publicKey);
    feeDestinationAta = await createAssociatedTokenAccount(connection, authority.payer, mint, authority.publicKey);

    await mintTo(connection, authority.payer, mint, takerAta, authority.publicKey, DEPOSIT_AMOUNT * 20);

    globalState = globalStatePda(program.programId);
    stockRampOrder = stockRampOrderPda(maker.publicKey, stockRampSeed, program.programId);
    stockRampOrderAta = await anchor.utils.token.associatedAddress({ mint, owner: stockRampOrder });
  });

  // ── 1. Initialize global state ─────────────────────────────────────────────
  it("initializes global state with validator defaults", async () => {
    await program.methods
      .initializeGlobalState()
      .accountsPartial({
        authority: authority.publicKey,
        globalState,
        systemProgram: SystemProgram.programId,
      })
      .rpc()
      .catch(() => {
        /* already initialised by an earlier test file sharing this validator */
      });

    const gs = await program.account.globalState.fetch(globalState);
    assert.equal(gs.requiredVotes, 3, "Default threshold should be 3");
    assert.ok(
      gs.validators.every((v: PublicKey) => v.equals(PublicKey.default)) || gs.validatorCount > 0,
      "Validator slots should reflect whatever this localnet already has registered"
    );

    // Verify the fee pool authority PDA was stored correctly. If this fails
    // with PublicKey.default the local validator is running stale GlobalState
    // from a previous deploy — restart it with:
    //   solana-test-validator --reset   OR   anchor localnet
    const expectedPoolAuthority = validatorFeePoolAuthorityPda(program.programId);
    assert.ok(
      gs.validatorFeePoolAuthority.equals(expectedPoolAuthority),
      `validatorFeePoolAuthority mismatch — got ${gs.validatorFeePoolAuthority.toBase58()}, ` +
        `expected ${expectedPoolAuthority.toBase58()}. Restart the local validator to clear stale GlobalState.`
    );
  });

  // ── 2. Register validators ─────────────────────────────────────────────────

  // FIX: made idempotent. `global_state` is shared across every *_test.ts
  // file (and across repeated `--skip-local-validator` runs), and every
  // other file already registers this same SHARED_VALIDATORS set. Calling
  // registerValidator raw and uncaught here assumed a blank slate, which is
  // false whenever another file has run first — so this used to throw
  // ValidatorSlotsFull instead of succeeding.
  it("registers all 5 validators", async () => {
    const gs0 = await program.account.globalState.fetch(globalState);

    if (gs0.validatorCount < 5) {
      for (let i = 0; i < 5; i++) {
        await program.methods
          .registerValidator(validators[i].publicKey)
          .accountsPartial({ authority: authority.publicKey, globalState })
          .rpc()
          .catch(() => {
            // Already registered by an earlier test file — fine, this test
            // only needs to guarantee the end state (all 5 present).
          });
      }
    }

    const gs = await program.account.globalState.fetch(globalState);
    assert.equal(gs.validatorCount, 5);
    for (let i = 0; i < 5; i++) {
      assert.ok(gs.validators[i].equals(validators[i].publicKey), `Slot ${i}`);
    }
  });

  // FIX: no longer assumes a specific free/full slot state. validators[0] is
  // guaranteed to already be registered by the test above (regardless of
  // whether slots were full coming in), so re-registering it always
  // exercises the intended AlreadyRegistered path rather than colliding
  // with a full-slots condition inherited from other test files.
  it("rejects registering the same validator twice", async () => {
    try {
      await program.methods
        .registerValidator(validators[0].publicKey)
        .accountsPartial({ authority: authority.publicKey, globalState })
        .rpc();
      assert.fail("Should have thrown ValidatorAlreadyRegistered");
    } catch (e: any) {
      assert.include(e.toString(), "ValidatorAlreadyRegistered");
    }
  });

  it("rejects registering a 6th validator when slots full", async () => {
    const extra = Keypair.generate();
    try {
      await program.methods
        .registerValidator(extra.publicKey)
        .accountsPartial({ authority: authority.publicKey, globalState })
        .rpc();
      assert.fail("Should have thrown ValidatorSlotsFull");
    } catch (e: any) {
      assert.include(e.toString(), "ValidatorSlotsFull");
    }
  });

  it("removes a validator and frees the slot", async () => {
    await program.methods
      .removeValidator(validators[4].publicKey)
      .accountsPartial({ authority: authority.publicKey, globalState })
      .rpc();

    const gs = await program.account.globalState.fetch(globalState);
    assert.equal(gs.validatorCount, 4);

    // Re-add so subsequent tests have 5 validators.
    await program.methods
      .registerValidator(validators[4].publicKey)
      .accountsPartial({ authority: authority.publicKey, globalState })
      .rpc();
  });

  it("rejects threshold > validator_count", async () => {
    try {
      await program.methods
        .updateRequiredVotes(6)
        .accountsPartial({ authority: authority.publicKey, globalState })
        .rpc();
      assert.fail("Should have thrown InvalidVoteThreshold");
    } catch (e: any) {
      assert.include(e.toString(), "InvalidVoteThreshold");
    }
  });

  // ── 3. Initialize validator fee pool ATA (new instruction) ────────────────
  it("initializes the validator fee pool ATA for this mint", async () => {
    const poolAta = await ensureValidatorFeePoolAta(program, authority.payer, globalState, mint);
    const acc = await getAccount(connection, poolAta);
    assert.ok(acc !== null);
    assert.equal(acc.owner.toString(), validatorFeePoolAuthorityPda(program.programId).toString());
  });

  it("is idempotent — calling it again for the same mint is a cheap no-op", async () => {
    await ensureValidatorFeePoolAta(program, authority.payer, globalState, mint);
    // No throw = pass; init_if_needed leaves the existing account untouched.
  });

  // ── 4. Create buy order + reservation ──────────────────────────────────────
  it("creates a buy order", async () => {
    await program.methods
      .createBuyOrder(
        stockRampSeed,
        new BN(DEPOSIT_AMOUNT),
        new BN(PRICE_PER_TOKEN),
        "NGN",
        "Send to Account 1234",
        "FLW-CRED-001"
      )
      .accountsPartial({
        buyer: maker.publicKey,
        mint,
        stockRampOrder,
        globalState,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([maker])
      .rpc();
  });

  // ── update_price (new) ─────────────────────────────────────────────────────
  it("lets the maker update the price on their own order", async () => {
    const NEW_PRICE = PRICE_PER_TOKEN + 50;

    await program.methods
      .updatePrice(new BN(NEW_PRICE))
      .accountsPartial({ maker: maker.publicKey, stockRampOrder })
      .signers([maker])
      .rpc();

    const order = await program.account.stockRampOrder.fetch(stockRampOrder);
    assert.equal(order.pricePerToken.toNumber(), NEW_PRICE);

    // Restore the original price so downstream fiat_amount math stays simple.
    await program.methods
      .updatePrice(new BN(PRICE_PER_TOKEN))
      .accountsPartial({ maker: maker.publicKey, stockRampOrder })
      .signers([maker])
      .rpc();
  });

  it("rejects update_price from a non-maker signer", async () => {
    const rogue = Keypair.generate();
    await airdrop(connection, rogue.publicKey);

    try {
      await program.methods
        .updatePrice(new BN(999))
        .accountsPartial({ maker: rogue.publicKey, stockRampOrder })
        .signers([rogue])
        .rpc();
      assert.fail("Should have rejected update_price from a non-maker");
    } catch (e: any) {
      // Anchor's has_one constraint fails the seeds/has_one check before the
      // handler runs — surfaces as a constraint or InvalidMaker error.
      assert.ok(
        e.toString().includes("InvalidMaker") ||
          e.toString().includes("ConstraintSeeds") ||
          e.toString().includes("ConstraintHasOne"),
        `Unexpected error: ${e.toString()}`
      );
    }
  });

  it("rejects a zero price", async () => {
    try {
      await program.methods
        .updatePrice(new BN(0))
        .accountsPartial({ maker: maker.publicKey, stockRampOrder })
        .signers([maker])
        .rpc();
      assert.fail("Should have thrown InvalidPrice");
    } catch (e: any) {
      assert.include(e.toString(), "InvalidPrice");
    }
  });

  it("taker creates a reservation (instant_reserve)", async () => {
    await program.methods
      .instantReserve(
        new BN(DEPOSIT_AMOUNT),
        new BN(FIAT_AMOUNT),
        "NGN",
        JSON.stringify({ account_number: "0123456789", bank_code: "044" })
      )
      .accountsPartial({
        stockRampOrder,
        maker: maker.publicKey,
        taker: taker.publicKey,
        mint,
        takerAta,
        stockRampOrderAta,
        globalState,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([taker])
      .rpc();

    const escrow = await getAccount(connection, stockRampOrderAta);
    assert.equal(escrow.amount.toString(), DEPOSIT_AMOUNT.toString());

    const order = await program.account.stockRampOrder.fetch(stockRampOrder);
    const reservation = order.reservedAmounts.find((r: any) => r.taker.equals(taker.publicKey));
    assert.ok(reservation, "Reservation should exist");
    actualPayoutReference = reservation!.payoutReference as string;
    assert.ok(actualPayoutReference, "payout_reference should be set on-chain");
  });

  // ── 5. Happy path with validator earnings crediting ────────────────────────
  it("releases tokens after 3 approve votes and credits validator earnings (3-of-5 consensus)", async () => {
    const votePda = validatorVotePda(stockRampOrder, actualPayoutReference, program.programId);
    const makerAtaBefore = await getAccount(connection, makerAta);

    const votingValidators = validators.slice(0, 3).map((v) => v.publicKey);
    const remainingAccounts = validatorEarningsRemainingAccounts(votingValidators, mint, program.programId);

    for (let i = 0; i < 3; i++) {
      const builder = program.methods
        .submitBuyVote(
          referenceHashBytes(actualPayoutReference),
          actualPayoutReference,
          taker.publicKey,
          new BN(DEPOSIT_AMOUNT),
          new BN(FIAT_AMOUNT),
          "NGN",
          true,
          `flw_ref_${i}`
        )
        .accountsPartial({
          validator: validators[i].publicKey,
          globalState,
          validatorVote: votePda,
          stockRampOrder,
          maker: maker.publicKey,
          mint,
          stockRampOrderAta,
          feeDestinationAta,
          takerAta,
          makerAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          validatorFeePoolAuthority: validatorFeePoolAuthorityPda(program.programId),
          validatorFeePoolAta: validatorFeePoolAta(validatorFeePoolAuthorityPda(program.programId), mint),
        })
        .signers([validators[i]]);

      // Only the 3rd (threshold-reaching) vote actually executes settlement,
      // but passing remaining_accounts on every call is harmless — attach it
      // throughout so whichever call ends up executing has what it needs.
      await builder.remainingAccounts(remainingAccounts).rpc();
    }

    const voteAccount = await program.account.validatorVote.fetch(votePda);
    assert.ok(voteAccount.executed, "Vote should be executed after 3 approvals");
    assert.equal(voteAccount.votesFor, 3);

    // Fee split: 20% platform / 60% maker rebate / 20% validator pool.
    const totalFee = computeTotalFee(DEPOSIT_AMOUNT, 5);
    const { platformFee, makerFee, validatorPoolFee } = splitFee(totalFee);
    const expectedReceived = DEPOSIT_AMOUNT - totalFee + makerFee;

    const makerAtaAfter = await getAccount(connection, makerAta);
    const received = Number(makerAtaAfter.amount) - Number(makerAtaBefore.amount);
    assert.equal(received, expectedReceived, "Maker should receive tokens minus net fee (2 bps after 60% rebate)");

    const feeAta = await getAccount(connection, feeDestinationAta);
    assert.ok(Number(feeAta.amount) >= platformFee, "Fee destination should have received platform share");

    // Validator earnings: each of the 3 voters should have a funded,
    // correctly-attributed ValidatorEarnings PDA.
    const shares = splitValidatorPool(validatorPoolFee, 3);
    for (let i = 0; i < 3; i++) {
      const earningsPda = validatorEarningsPda(validators[i].publicKey, mint, program.programId);
      const earnings = await program.account.validatorEarnings.fetch(earningsPda);
      assert.equal(earnings.validator.toString(), validators[i].publicKey.toString());
      assert.equal(earnings.mint.toString(), mint.toString());
      assert.equal(earnings.accumulatedAmount.toNumber(), shares[i], `validator ${i} share mismatch`);
      assert.equal(earnings.totalCredits.toNumber(), 1);
    }
  });

  // ── 6. Close executed vote (new) ───────────────────────────────────────────
  it("allows anyone to close an already-executed ValidatorVote PDA", async () => {
    const votePda = validatorVotePda(stockRampOrder, actualPayoutReference, program.programId);
    const caller = Keypair.generate();
    await airdrop(connection, caller.publicKey);

    const callerBalBefore = await connection.getBalance(caller.publicKey);

    await program.methods
      .closeExecutedVote()
      .accountsPartial({
        caller: caller.publicKey,
        validatorVote: votePda,
        systemProgram: SystemProgram.programId,
      })
      .signers([caller])
      .rpc();

    const callerBalAfter = await connection.getBalance(caller.publicKey);
    assert.ok(callerBalAfter > callerBalBefore, "Caller should receive the closed PDA's rent lamports");

    const closed = await connection.getAccountInfo(votePda);
    assert.isNull(closed, "validator_vote account should no longer exist");
  });

  it("rejects closing a ValidatorVote that has not been executed", async () => {
    // Fresh order + reservation, vote not yet settled.
    const seed = new BN(46);
    const order = stockRampOrderPda(maker.publicKey, seed, program.programId);
    const orderAta = await anchor.utils.token.associatedAddress({ mint, owner: order });

    await program.methods
      .createBuyOrder(seed, new BN(DEPOSIT_AMOUNT), new BN(PRICE_PER_TOKEN), "NGN", "Send to X", "FLW-CLOSE-001")
      .accountsPartial({
        buyer: maker.publicKey,
        mint,
        stockRampOrder: order,
        globalState,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([maker])
      .rpc();

    await mintTo(connection, authority.payer, mint, takerAta, authority.publicKey, DEPOSIT_AMOUNT);

    await program.methods
      .instantReserve(new BN(DEPOSIT_AMOUNT), new BN(FIAT_AMOUNT), "NGN", null)
      .accountsPartial({
        stockRampOrder: order,
        maker: maker.publicKey,
        taker: taker.publicKey,
        mint,
        takerAta,
        stockRampOrderAta: orderAta,
        globalState,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([taker])
      .rpc();

    const fetched = await program.account.stockRampOrder.fetch(order);
    const res = fetched.reservedAmounts.find((r: any) => r.taker.equals(taker.publicKey));
    const ref = res!.payoutReference as string;
    const votePda = validatorVotePda(order, ref, program.programId);

    // Cast a single (non-executing) vote so the ValidatorVote PDA exists.
    await program.methods
      .submitBuyVote(
        referenceHashBytes(ref),
        ref,
        taker.publicKey,
        new BN(DEPOSIT_AMOUNT),
        new BN(FIAT_AMOUNT),
        "NGN",
        true,
        "partial"
      )
      .accountsPartial({
        validator: validators[0].publicKey,
        globalState,
        validatorVote: votePda,
        stockRampOrder: order,
        maker: maker.publicKey,
        mint,
        stockRampOrderAta: orderAta,
        feeDestinationAta,
        takerAta,
        makerAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        validatorFeePoolAuthority: validatorFeePoolAuthorityPda(program.programId),
        validatorFeePoolAta: validatorFeePoolAta(validatorFeePoolAuthorityPda(program.programId), mint),
      })
      .signers([validators[0]])
      .rpc();

    try {
      await program.methods
        .closeExecutedVote()
        .accountsPartial({
          caller: authority.publicKey,
          validatorVote: votePda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      assert.fail("Should have thrown VoteNotYetExecuted");
    } catch (e: any) {
      assert.include(e.toString(), "VoteNotYetExecuted");
    }

    // Finish settling it (2 more approvals) so subsequent seeds are clean.
    for (let i = 1; i < 3; i++) {
      await program.methods
        .submitBuyVote(
          referenceHashBytes(ref),
          ref,
          taker.publicKey,
          new BN(DEPOSIT_AMOUNT),
          new BN(FIAT_AMOUNT),
          "NGN",
          true,
          "cleanup"
        )
        .accountsPartial({
          validator: validators[i].publicKey,
          globalState,
          validatorVote: votePda,
          stockRampOrder: order,
          maker: maker.publicKey,
          mint,
          stockRampOrderAta: orderAta,
          feeDestinationAta,
          takerAta,
          makerAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          validatorFeePoolAuthority: validatorFeePoolAuthorityPda(program.programId),
          validatorFeePoolAta: validatorFeePoolAta(validatorFeePoolAuthorityPda(program.programId), mint),
        })
        .signers([validators[i]])
        .rpc();
    }
  });

  // ── 7. Rejection path: 3 reject votes → refund ────────────────────────────
  it("refunds taker after 3 reject votes", async () => {
    const seed2 = new BN(43);
    const stockRampOrder2 = stockRampOrderPda(maker.publicKey, seed2, program.programId);
    const stockRampOrderAta2 = await anchor.utils.token.associatedAddress({ mint, owner: stockRampOrder2 });

    await program.methods
      .createBuyOrder(
        seed2,
        new BN(DEPOSIT_AMOUNT),
        new BN(PRICE_PER_TOKEN),
        "NGN",
        "Send to Account 5678",
        "FLW-CRED-002"
      )
      .accountsPartial({
        buyer: maker.publicKey,
        mint,
        stockRampOrder: stockRampOrder2,
        globalState,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([maker])
      .rpc();

    await mintTo(connection, authority.payer, mint, takerAta, authority.publicKey, DEPOSIT_AMOUNT);

    await program.methods
      .instantReserve(new BN(DEPOSIT_AMOUNT), new BN(FIAT_AMOUNT), "NGN", null)
      .accountsPartial({
        stockRampOrder: stockRampOrder2,
        maker: maker.publicKey,
        taker: taker.publicKey,
        mint,
        takerAta,
        stockRampOrderAta: stockRampOrderAta2,
        globalState,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([taker])
      .rpc();

    const order2 = await program.account.stockRampOrder.fetch(stockRampOrder2);
    const res2 = order2.reservedAmounts.find((r: any) => r.taker.equals(taker.publicKey));
    if (!res2) throw new Error("No pending reservation found for taker");
    const ref2 = res2.payoutReference as string;
    const votePda2 = validatorVotePda(stockRampOrder2, ref2, program.programId);

    const takerBefore = await getAccount(connection, takerAta);

    for (let i = 0; i < 3; i++) {
      await program.methods
        .submitBuyVote(
          referenceHashBytes(ref2),
          ref2,
          taker.publicKey,
          new BN(DEPOSIT_AMOUNT),
          new BN(FIAT_AMOUNT),
          "NGN",
          false,
          "Payment not found in Flutterwave"
        )
        .accountsPartial({
          validator: validators[i].publicKey,
          globalState,
          validatorVote: votePda2,
          stockRampOrder: stockRampOrder2,
          maker: maker.publicKey,
          mint,
          stockRampOrderAta: stockRampOrderAta2,
          feeDestinationAta,
          takerAta,
          makerAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          validatorFeePoolAuthority: validatorFeePoolAuthorityPda(program.programId),
          validatorFeePoolAta: validatorFeePoolAta(validatorFeePoolAuthorityPda(program.programId), mint),
        })
        .signers([validators[i]])
        .rpc();
    }

    const voteAccount = await program.account.validatorVote.fetch(votePda2);
    assert.ok(voteAccount.executed, "Vote should be executed after impossible-to-approve");
    assert.equal(voteAccount.votesAgainst, 3);

    const takerAfter = await getAccount(connection, takerAta);
    const refunded = Number(takerAfter.amount) - Number(takerBefore.amount);
    assert.equal(refunded, DEPOSIT_AMOUNT, "Taker should be fully refunded");
  });

  // ── 8. Duplicate vote rejected ─────────────────────────────────────────────
  it("rejects a validator voting twice on the same reservation", async () => {
    const seed3 = new BN(44);
    const stockRampOrder3 = stockRampOrderPda(maker.publicKey, seed3, program.programId);
    const stockRampOrderAta3 = await anchor.utils.token.associatedAddress({ mint, owner: stockRampOrder3 });

    await program.methods
      .createBuyOrder(
        seed3,
        new BN(DEPOSIT_AMOUNT),
        new BN(PRICE_PER_TOKEN),
        "NGN",
        "Send to Account 9999",
        "FLW-CRED-003"
      )
      .accountsPartial({
        buyer: maker.publicKey,
        mint,
        stockRampOrder: stockRampOrder3,
        globalState,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([maker])
      .rpc();

    await mintTo(connection, authority.payer, mint, takerAta, authority.publicKey, DEPOSIT_AMOUNT);

    await program.methods
      .instantReserve(new BN(DEPOSIT_AMOUNT), new BN(FIAT_AMOUNT), "NGN", null)
      .accountsPartial({
        stockRampOrder: stockRampOrder3,
        maker: maker.publicKey,
        taker: taker.publicKey,
        mint,
        takerAta,
        stockRampOrderAta: stockRampOrderAta3,
        globalState,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([taker])
      .rpc();

    const order3 = await program.account.stockRampOrder.fetch(stockRampOrder3);
    const res3 = order3.reservedAmounts.find((r: any) => r.taker.equals(taker.publicKey));
    if (!res3) throw new Error("No pending reservation found for taker");
    const ref3 = res3.payoutReference as string;
    const votePda3 = validatorVotePda(stockRampOrder3, ref3, program.programId);

    const accountsFor = {
      validator: validators[0].publicKey,
      globalState,
      validatorVote: votePda3,
      stockRampOrder: stockRampOrder3,
      maker: maker.publicKey,
      mint,
      stockRampOrderAta: stockRampOrderAta3,
      feeDestinationAta,
      takerAta,
      makerAta,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      validatorFeePoolAuthority: validatorFeePoolAuthorityPda(program.programId),
      validatorFeePoolAta: validatorFeePoolAta(validatorFeePoolAuthorityPda(program.programId), mint),
    };

    await program.methods
      .submitBuyVote(
        referenceHashBytes(ref3),
        ref3,
        taker.publicKey,
        new BN(DEPOSIT_AMOUNT),
        new BN(FIAT_AMOUNT),
        "NGN",
        true,
        "ok"
      )
      .accountsPartial(accountsFor)
      .signers([validators[0]])
      .rpc();

    try {
      await program.methods
        .submitBuyVote(
          referenceHashBytes(ref3),
          ref3,
          taker.publicKey,
          new BN(DEPOSIT_AMOUNT),
          new BN(FIAT_AMOUNT),
          "NGN",
          true,
          "ok"
        )
        .accountsPartial(accountsFor)
        .signers([validators[0]])
        .rpc();
      assert.fail("Should have thrown AlreadyVoted");
    } catch (e: any) {
      assert.include(e.toString(), "AlreadyVoted");
    }
  });

  // ── 9. Non-validator rejected ──────────────────────────────────────────────
  it("rejects a vote from an unregistered signer", async () => {
    const rogue = Keypair.generate();
    await airdrop(connection, rogue.publicKey);

    const seed4 = new BN(45);
    const stockRampOrder4 = stockRampOrderPda(maker.publicKey, seed4, program.programId);
    const stockRampOrderAta4 = await anchor.utils.token.associatedAddress({ mint, owner: stockRampOrder4 });

    await program.methods
      .createBuyOrder(
        seed4,
        new BN(DEPOSIT_AMOUNT),
        new BN(PRICE_PER_TOKEN),
        "NGN",
        "Send to Account 0000",
        "FLW-CRED-004"
      )
      .accountsPartial({
        buyer: maker.publicKey,
        mint,
        stockRampOrder: stockRampOrder4,
        globalState,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([maker])
      .rpc();

    await mintTo(connection, authority.payer, mint, takerAta, authority.publicKey, DEPOSIT_AMOUNT);

    await program.methods
      .instantReserve(new BN(DEPOSIT_AMOUNT), new BN(FIAT_AMOUNT), "NGN", null)
      .accountsPartial({
        stockRampOrder: stockRampOrder4,
        maker: maker.publicKey,
        taker: taker.publicKey,
        mint,
        takerAta,
        stockRampOrderAta: stockRampOrderAta4,
        globalState,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([taker])
      .rpc();

    const order4 = await program.account.stockRampOrder.fetch(stockRampOrder4);
    const res4 = order4.reservedAmounts.find((r: any) => r.taker.equals(taker.publicKey));
    if (!res4) throw new Error("No pending reservation found for taker");
    const ref4 = res4.payoutReference as string;
    const votePda4 = validatorVotePda(stockRampOrder4, ref4, program.programId);

    try {
      await program.methods
        .submitBuyVote(
          referenceHashBytes(ref4),
          ref4,
          taker.publicKey,
          new BN(DEPOSIT_AMOUNT),
          new BN(FIAT_AMOUNT),
          "NGN",
          true,
          "hack"
        )
        .accountsPartial({
          validator: rogue.publicKey,
          globalState,
          validatorVote: votePda4,
          stockRampOrder: stockRampOrder4,
          maker: maker.publicKey,
          mint,
          stockRampOrderAta: stockRampOrderAta4,
          feeDestinationAta,
          takerAta,
          makerAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          validatorFeePoolAuthority: validatorFeePoolAuthorityPda(program.programId),
          validatorFeePoolAta: validatorFeePoolAta(validatorFeePoolAuthorityPda(program.programId), mint),
        })
        .signers([rogue])
        .rpc();
      assert.fail("Should have thrown UnauthorizedValidator");
    } catch (e: any) {
      assert.include(e.toString(), "UnauthorizedValidator");
    }
  });

  // ── 10. Expired vote — documented ──────────────────────────────────────────
  it("documents: finalize_expired_vote triggers refund after timeout", async () => {
    console.log(
      "  ⚠  Clock-manipulation test skipped in standard localnet.",
      "  Run under solana-bankrun / BanksClient with a warped clock, or set",
      "  a short VOTE_EXPIRY_SECONDS in a dedicated test build, to exercise",
      "  finalize_expired_vote end-to-end. The instruction itself:",
      "    • requires clock >= validator_vote.expires_at and !executed",
      "    • refunds the full reserved amount to taker_ata",
      "    • restores stock_ramp_order.amount only for buy orders",
      "      (is_buy_order gate — sell-side reservations don't lock LP capacity",
      "       the same way, so nothing is restored there)",
      "    • decrements global_state.active_vote_count",
      "    • closes the ValidatorVote PDA via `close = caller`"
    );
  });

  // ── 11. Sell-side happy path ────────────────────────────────────────────────
  it("releases tokens to buyer after 3 approve votes on sell order", async () => {
    const sellSeed = new BN(99);
    const sellOrder = stockRampOrderPda(taker.publicKey, sellSeed, program.programId);
    const sellOrderAta = await anchor.utils.token.associatedAddress({ mint, owner: sellOrder });
    const sellerAta = takerAta;
    const buyerAta = makerAta;

    await mintTo(connection, authority.payer, mint, sellerAta, authority.publicKey, DEPOSIT_AMOUNT * 2);

    await program.methods
      .createSellOrder(
        sellSeed,
        new BN(DEPOSIT_AMOUNT),
        new BN(PRICE_PER_TOKEN),
        "NGN",
        "Send to GTB 0000111100",
        "FLW-SELL-001"
      )
      .accountsPartial({
        seller: taker.publicKey,
        mint,
        sellerAta,
        stockRampOrder: sellOrder,
        stockRampOrderAta: sellOrderAta,
        globalState,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([taker])
      .rpc();

    const sellRef = "IS-sell-test-000001";
    const sellOrderFetched = await program.account.stockRampOrder.fetch(sellOrder);
    const available = sellOrderFetched.amount as BN;

    await program.methods
      .instantSellReserve(available, 0, null, sellRef)
      .accountsPartial({
        stockRampOrder: sellOrder,
        maker: taker.publicKey,
        buyer: maker.publicKey,
        globalState,
        systemProgram: SystemProgram.programId,
      })
      .signers([maker])
      .rpc();

    const sellVotePda = validatorVotePda(sellOrder, sellRef, program.programId);

    for (let i = 0; i < 3; i++) {
      await program.methods
        .submitSellVote(referenceHashBytes(sellRef), sellRef, maker.publicKey, true, `sell_evidence_${i}`)
        .accountsPartial({
          validator: validators[i].publicKey,
          globalState,
          validatorVote: sellVotePda,
          stockRampOrder: sellOrder,
          maker: taker.publicKey,
          mint,
          stockRampOrderAta: sellOrderAta,
          feeDestinationAta,
          takerAta: buyerAta,
          makerAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          validatorFeePoolAuthority: validatorFeePoolAuthorityPda(program.programId),
          validatorFeePoolAta: validatorFeePoolAta(validatorFeePoolAuthorityPda(program.programId), mint),
        })
        .signers([validators[i]])
        .rpc();
    }

    const sv = await program.account.validatorVote.fetch(sellVotePda);
    assert.ok(sv.executed, "Sell vote should be executed");
    assert.equal(sv.votesFor, 3);

    const buyerAccount = await getAccount(connection, buyerAta);
    assert.ok(Number(buyerAccount.amount) > 0, "Buyer should have received tokens");
  });

  // ── 12. Partial-fill close fix (regression) ────────────────────────────────
  //
  // Bug: old condition was  !has_active_reservations && remaining_balance <= dust
  // For buy orders the ATA empties to 0 after every settlement, so the old
  // condition fired after the first partial fill and closed the escrow prematurely.
  //
  // Fix: added  order_fully_consumed = stock_ramp_order.amount == 0  as a third
  // gate. This test proves the fix is in place.

  describe("Partial-Fill Close Fix (regression)", () => {
    const TOTAL = 3_000_000; // 3 tokens total capacity
    const FILL_A = 1_000_000; // first partial fill
    const FILL_B = 1_000_000; // second partial fill
    const FILL_C = 1_000_000; // final fill — should trigger close
    const PRICE = 1_000;

    let srPda: PublicKey;
    let srAta: PublicKey;

    before(async () => {
      const seed = new BN(200);
      srPda = stockRampOrderPda(maker.publicKey, seed, program.programId);
      srAta = await anchor.utils.token.associatedAddress({ mint, owner: srPda });

      await program.methods
        .createBuyOrder(
          seed,
          new BN(TOTAL),
          new BN(PRICE),
          "NGN",
          "partial-fill close fix test",
          "FLW-PARTIAL-001"
        )
        .accountsPartial({
          buyer: maker.publicKey,
          mint,
          stockRampOrder: srPda,
          globalState,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([maker])
        .rpc();

      await mintTo(connection, authority.payer, mint, takerAta, authority.publicKey, TOTAL * 3);
    });

    async function fillAndSettle(amount: number) {
      await program.methods
        .instantReserve(new BN(amount), new BN(amount * PRICE), "NGN", null)
        .accountsPartial({
          stockRampOrder: srPda,
          maker: maker.publicKey,
          taker: taker.publicKey,
          mint,
          takerAta,
          stockRampOrderAta: srAta,
          globalState,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([taker])
        .rpc();

      const order = await program.account.stockRampOrder.fetch(srPda);
      const res = order.reservedAmounts.find((r: any) => r.taker.equals(taker.publicKey) && r.status === 0);
      if (!res) throw new Error("No pending reservation found for taker");
      const ref = res.payoutReference as string;
      const votePda = validatorVotePda(srPda, ref, program.programId);

      for (let i = 0; i < 3; i++) {
        await program.methods
          .submitBuyVote(
            referenceHashBytes(ref),
            ref,
            taker.publicKey,
            new BN(amount),
            new BN(amount * PRICE),
            "NGN",
            true,
            `ev${i}`
          )
          .accountsPartial({
            validator: validators[i].publicKey,
            globalState,
            validatorVote: votePda,
            stockRampOrder: srPda,
            maker: maker.publicKey,
            mint,
            stockRampOrderAta: srAta,
            feeDestinationAta,
            takerAta,
            makerAta,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            validatorFeePoolAuthority: validatorFeePoolAuthorityPda(program.programId),
            validatorFeePoolAta: validatorFeePoolAta(validatorFeePoolAuthorityPda(program.programId), mint),
          })
          .signers([validators[i]])
          .rpc();
      }
    }

    it("escrow stays open after first partial fill", async () => {
      await fillAndSettle(FILL_A);

      const order = await program.account.stockRampOrder.fetch(srPda).catch(() => null);
      assert.ok(order !== null, "BUG REGRESSION: escrow closed prematurely after fill A");
      assert.equal(order!.amount.toNumber(), TOTAL - FILL_A, "Remaining capacity should be TOTAL - FILL_A");
    });

    it("escrow stays open after second partial fill", async () => {
      await fillAndSettle(FILL_B);

      const order = await program.account.stockRampOrder.fetch(srPda).catch(() => null);
      assert.ok(order !== null, "BUG REGRESSION: escrow closed prematurely after fill B");
      assert.equal(
        order!.amount.toNumber(),
        TOTAL - FILL_A - FILL_B,
        "Remaining capacity should be TOTAL - FILL_A - FILL_B"
      );
    });

    it("escrow closes exactly on final fill (amount == 0)", async () => {
      await fillAndSettle(FILL_C);

      const order = await program.account.stockRampOrder.fetch(srPda).catch(() => null);
      assert.isNull(order, "Escrow must be closed after FILL_C brings stock_ramp_order.amount to 0");
    });
  });
});