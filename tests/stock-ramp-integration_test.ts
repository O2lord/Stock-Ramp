// tests/stock-ramp-integration_test.ts
//
// Rewritten from trust-vault-integration_test.ts. The old suite settled
// reservations via a single `botAuthority`-signed `confirmSellPayment` /
// `confirmPayout` instruction. Those instructions no longer exist in Stock
// Ramp — settlement now goes through 3-of-5 validator consensus
// (submit_buy_vote / submit_sell_vote). Every scenario below is re-expressed
// against that flow.
//
// Covers:
//   • Multiple concurrent reservations on a sell order
//   • Settling reservations independently — approve path and reject path
//   • Partial withdrawal from a sell order via stock_ramp_withdraw
//   • Complete buy-order lifecycle from creation to validator-vote auto-close
//   • Fee distribution across multiple settled transactions
//   • Partial-fill close fix (integration-level regression check)
//
// NOTE ON SHARED STATE (3 fixes applied below):
//   `global_state` is a program-wide singleton PDA shared across the ENTIRE
//   test run (all *_test.ts files, one long-lived validator process). Three
//   assumptions that used to silently break because of this:
//
//   1. "Partial Withdrawal" used to assert an ABSOLUTE seller balance after
//      withdrawing. But `seller`/`sellerAta` are reused across every
//      `describe` block in this file, so leftover maker-fee rebates from an
//      earlier settlement (in "Multiple Concurrent Reservations") were
//      already sitting in the account. Fixed to assert the DELTA
//      (before/after), which is correct regardless of what else touched
//      this ATA earlier in the run.
//
//   2. "Fee Distribution Verification" used to hardcode `5` (bps) when
//      computing the expected fee. But `create_sell_order.rs` snapshots
//      `fee_percentage` from `global_state.fee_percentage` AT CREATION TIME
//      — if any earlier test file (running against the same shared
//      validator) calls `update_fee_percentage` and doesn't restore it,
//      every order created afterward inherits a different bps than the
//      hardcoded constant assumes. Fixed to read the actual snapshotted
//      `fee_percentage` off the created order instead of assuming a
//      constant.
//
//   3. "Fee Distribution Verification" also under-counted the actual
//      platform-ATA balance because `settleSellReservation` never passed
//      `remainingAccounts` (ValidatorEarnings PDAs) to `submitSellVote`.
//      `submit_vote.rs`'s `credit_validator_earnings` redirects any
//      uncredited validator-pool share (20% of the fee) straight into
//      `fee_destination_ata` when no earnings PDA is supplied for a voter —
//      so the platform ATA was silently receiving 40% of the fee (platform
//      20% + redirected pool 20%) instead of the intended 20%. Fixed by
//      passing the validator-earnings remaining accounts for the 3 voters,
//      so the pool share is actually credited to validators instead of
//      falling back to the platform destination.

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { StockRamp } from "../target/types/stock_ramp";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { assert } from "chai";
import {
  airdropAll,
  computeTotalFee,
  deriveAta,
  ensureValidatorFeePoolAta,
  ensureValidatorsRegistered,
  globalStatePda,
  loadAuthorityKeypair,
  referenceHashBytes,
  splitFee,
  stockRampOrderPda,
  validatorEarningsRemainingAccounts,
  validatorFeePoolAta,
  validatorFeePoolAuthorityPda,
  validatorVotePda,
  SHARED_VALIDATORS
} from "./helpers";

describe("Stock Ramp - Integration Tests", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.StockRamp as Program<StockRamp>;
  const connection = provider.connection;

  let authority: Keypair;
  let seller: Keypair;
  let buyer1: Keypair;
  let buyer2: Keypair;
  let mint: PublicKey;
  let globalState: PublicKey;

  const validators = SHARED_VALIDATORS;

  before(async () => {
    authority = loadAuthorityKeypair();
    seller = Keypair.generate();
    buyer1 = Keypair.generate();
    buyer2 = Keypair.generate();

    await airdropAll(connection, [
      authority.publicKey,
      seller.publicKey,
      buyer1.publicKey,
      buyer2.publicKey,
      ...validators.map((v) => v.publicKey),
    ]);

    mint = await createMint(connection, authority, authority.publicKey, null, 9);
    globalState = globalStatePda(program.programId);

    await program.methods
      .initializeGlobalState()
      .accountsPartial({
        authority: authority.publicKey,
        globalState,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc()
      .catch(() => {});

    const gs = await program.account.globalState.fetch(globalState);
    assert.equal(
      gs.authority.toString(),
      authority.publicKey.toString(),
      "Authority mismatch — global state not properly initialized"
    );

    await ensureValidatorsRegistered(program, authority.publicKey, globalState, validators);
    await ensureValidatorFeePoolAta(program, authority, globalState, mint);
  });

  /** Settle a pending sell-order reservation with 3 approve/reject votes. */
  async function settleSellReservation(
    stockRampOrder: PublicKey,
    stockRampOrderAta: PublicKey,
    seller: PublicKey,
    taker: PublicKey,
    payoutReference: string,
    approve: boolean,
    feeDestinationAta: PublicKey,
    takerAta: PublicKey,
    makerAta: PublicKey
  ): Promise<void> {
    const votePda = validatorVotePda(stockRampOrder, payoutReference, program.programId);

    // FIX (Bug 3): pass the ValidatorEarnings remaining accounts for the 3
    // voters below. Without this, credit_validator_earnings() can't find a
    // PDA for any voter, treats the whole validator-pool share as
    // "uncredited", and redirects it straight into feeDestinationAta —
    // silently doubling what the platform ATA actually receives.
    const remainingAccounts = validatorEarningsRemainingAccounts(
      validators.slice(0, 3).map((v) => v.publicKey),
      mint,
      program.programId
    );

    for (let i = 0; i < 3; i++) {
      await program.methods
        .submitSellVote(
          referenceHashBytes(payoutReference),
          payoutReference,
          taker,
          approve,
          `evidence_${i}`
        )
        .accountsPartial({
          validator: validators[i].publicKey,
          globalState,
          validatorVote: votePda,
          stockRampOrder,
          maker: seller,
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
        .remainingAccounts(remainingAccounts)
        .signers([validators[i]])
        .rpc();
    }
  }

  /** Settle a pending buy-order reservation with 3 approve/reject votes. */
  async function settleBuyReservation(
    stockRampOrder: PublicKey,
    stockRampOrderAta: PublicKey,
    maker: PublicKey,
    taker: PublicKey,
    amount: number,
    fiatAmount: number,
    currency: string,
    payoutReference: string,
    approve: boolean,
    feeDestinationAta: PublicKey,
    takerAta: PublicKey,
    makerAta: PublicKey
  ): Promise<void> {
    const votePda = validatorVotePda(stockRampOrder, payoutReference, program.programId);

    // Same fix applied here for consistency, even though the current buy-side
    // tests in this file don't assert on the platform-fee-destination balance
    // — keeps validator earnings correctly credited instead of leaking to
    // the platform ATA on every settlement in this suite.
    const remainingAccounts = validatorEarningsRemainingAccounts(
      validators.slice(0, 3).map((v) => v.publicKey),
      mint,
      program.programId
    );

    for (let i = 0; i < 3; i++) {
      await program.methods
        .submitBuyVote(
          referenceHashBytes(payoutReference),
          payoutReference,
          taker,
          new anchor.BN(amount),
          new anchor.BN(fiatAmount),
          currency,
          approve,
          `evidence_${i}`
        )
        .accountsPartial({
          validator: validators[i].publicKey,
          globalState,
          validatorVote: votePda,
          stockRampOrder,
          maker,
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
        .remainingAccounts(remainingAccounts)
        .signers([validators[i]])
        .rpc();
    }
  }

  // ── Multiple Concurrent Reservations ───────────────────────────────────────

  describe("Multiple Concurrent Reservations", () => {
    const sellOrderSeed = 500;
    let sellOrderPda: PublicKey;
    let sellOrderAta: PublicKey;

    it("Handles multiple buyers reserving from same sell order", async () => {
      sellOrderPda = stockRampOrderPda(seller.publicKey, sellOrderSeed, program.programId);
      sellOrderAta = deriveAta(mint, sellOrderPda);

      const sellerAta = await getOrCreateAssociatedTokenAccount(connection, seller, mint, seller.publicKey);
      await mintTo(connection, authority, mint, sellerAta.address, authority, 5000 * 10 ** 9);

      await program.methods
        .createSellOrder(
          new anchor.BN(sellOrderSeed),
          new anchor.BN(5000 * 10 ** 9),
          new anchor.BN(100),
          "USD",
          "Bank transfer to account XYZ",
          "flw_multi_test"
        )
        .accountsPartial({
          seller: seller.publicKey,
          mint,
          sellerAta: sellerAta.address,
          stockRampOrder: sellOrderPda,
          stockRampOrderAta: sellOrderAta,
          globalState,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([seller])
        .rpc();

      await program.methods
        .instantSellReserve(new anchor.BN(1000 * 10 ** 9), 0, "buyer1-details", "BUYER1-REF")
        .accountsPartial({
          stockRampOrder: sellOrderPda,
          maker: seller.publicKey,
          buyer: buyer1.publicKey,
          globalState,
          systemProgram: SystemProgram.programId,
        })
        .signers([buyer1])
        .rpc();

      await program.methods
        .instantSellReserve(new anchor.BN(800 * 10 ** 9), 1, "buyer2-details", "BUYER2-REF")
        .accountsPartial({
          stockRampOrder: sellOrderPda,
          maker: seller.publicKey,
          buyer: buyer2.publicKey,
          globalState,
          systemProgram: SystemProgram.programId,
        })
        .signers([buyer2])
        .rpc();

      const sellOrder = await program.account.stockRampOrder.fetch(sellOrderPda);
      assert.equal(sellOrder.reservedAmounts.length, 2);

      const b1Res = sellOrder.reservedAmounts.find(
        (r: any) => r.taker.toString() === buyer1.publicKey.toString()
      );
      const b2Res = sellOrder.reservedAmounts.find(
        (r: any) => r.taker.toString() === buyer2.publicKey.toString()
      );
      assert.isDefined(b1Res);
      assert.isDefined(b2Res);
      assert.equal(b1Res!.amount.toString(), (1000 * 10 ** 9).toString());
      assert.equal(b2Res!.amount.toString(), (800 * 10 ** 9).toString());
    });

    it("Settles reservations for multiple buyers independently (approve + reject)", async () => {
      const buyer1Ata = await getOrCreateAssociatedTokenAccount(connection, buyer1, mint, buyer1.publicKey);
      const buyer2Ata = await getOrCreateAssociatedTokenAccount(connection, buyer2, mint, buyer2.publicKey);
      const feeDestinationAta = await getOrCreateAssociatedTokenAccount(
        connection,
        authority,
        mint,
        authority.publicKey
      );
      const sellerAta = await getOrCreateAssociatedTokenAccount(connection, seller, mint, seller.publicKey);

      // Read the ACTUAL fee bps snapshotted on this order rather than
      // assuming a constant — global_state.fee_percentage may have been
      // changed by an earlier test file sharing this validator process.
      const sellOrderForFee = await program.account.stockRampOrder.fetch(sellOrderPda);
      const feeBps = sellOrderForFee.feePercentage;

      // Approve buyer1's reservation — tokens released to buyer1.
      await settleSellReservation(
        sellOrderPda,
        sellOrderAta,
        seller.publicKey,
        buyer1.publicKey,
        "BUYER1-REF",
        true,
        feeDestinationAta.address,
        buyer1Ata.address,
        sellerAta.address
      );

      const buyer1Account = await getAccount(connection, buyer1Ata.address);
      const totalFee = computeTotalFee(1000 * 10 ** 9, feeBps);
      const expectedReceived = 1000 * 10 ** 9 - totalFee;
      assert.equal(
        buyer1Account.amount.toString(),
        expectedReceived.toString(),
        "buyer1 should receive amount minus the fee"
      );

      // Reject buyer2's reservation — order.amount is restored, no tokens move.
      const sellOrderBefore = await program.account.stockRampOrder.fetch(sellOrderPda);
      const amountBefore = sellOrderBefore.amount.toNumber();

      await settleSellReservation(
        sellOrderPda,
        sellOrderAta,
        seller.publicKey,
        buyer2.publicKey,
        "BUYER2-REF",
        false,
        feeDestinationAta.address,
        buyer2Ata.address,
        sellerAta.address
      );

      const buyer2Account = await getAccount(connection, buyer2Ata.address);
      assert.equal(buyer2Account.amount.toString(), "0", "buyer2 must receive nothing on rejection");

      const sellOrderAfter = await program.account.stockRampOrder.fetch(sellOrderPda);
      const b2Res = sellOrderAfter.reservedAmounts.find(
        (r: any) => r.taker.toString() === buyer2.publicKey.toString()
      );
      assert.isUndefined(b2Res, "buyer2 reservation should be removed after rejection");
      assert.equal(
        sellOrderAfter.amount.toNumber(),
        amountBefore + 800 * 10 ** 9,
        "rejected amount must be returned to available capacity"
      );
    });
  });

  // ── Partial Withdrawal ──────────────────────────────────────────────────────

  describe("Partial Withdrawal", () => {
    it("Allows the maker to withdraw part of an unreserved sell order", async () => {
      const seed = 600;
      const pda = stockRampOrderPda(seller.publicKey, seed, program.programId);
      const ata = deriveAta(mint, pda);

      const sellerAta = await getOrCreateAssociatedTokenAccount(connection, seller, mint, seller.publicKey);
      await mintTo(connection, authority, mint, sellerAta.address, authority, 10000 * 10 ** 9);

      await program.methods
        .createSellOrder(
          new anchor.BN(seed),
          new anchor.BN(10000 * 10 ** 9),
          new anchor.BN(100),
          "USD",
          "Payment instructions",
          "flw_partial_test"
        )
        .accountsPartial({
          seller: seller.publicKey,
          mint,
          sellerAta: sellerAta.address,
          stockRampOrder: pda,
          stockRampOrderAta: ata,
          globalState,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([seller])
        .rpc();

      const orderBefore = await program.account.stockRampOrder.fetch(pda);
      const withdrawAmount = orderBefore.amount.divn(2);

      // FIX (Bug 1): `sellerAta` is reused across every describe block in
      // this file. An earlier test ("Settles reservations... approve +
      // reject") already paid a maker-fee rebate into this same account, so
      // we compare a DELTA, not an absolute post-withdrawal balance.
      const sellerBalanceBefore = (await getAccount(connection, sellerAta.address)).amount;

      await program.methods
        .stockRampWithdraw(withdrawAmount)
        .accountsPartial({
          maker: seller.publicKey,
          stockRampOrder: pda,
          mint,
          makerAta: sellerAta.address,
          stockRampOrderAta: ata,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([seller])
        .rpc();

      const orderAfter = await program.account.stockRampOrder.fetch(pda);
      assert.equal(
        orderAfter.amount.toString(),
        orderBefore.amount.sub(withdrawAmount).toString(),
        "order.amount should drop by exactly the withdrawn amount"
      );

      const sellerBalanceAfter = (await getAccount(connection, sellerAta.address)).amount;
      assert.equal(
        (sellerBalanceAfter - sellerBalanceBefore).toString(),
        withdrawAmount.toString(),
        "seller should have received exactly the withdrawn amount back (delta, not absolute balance)"
      );
    });
  });

  // ── Complete Order Lifecycle ────────────────────────────────────────────────

  describe("Complete Order Lifecycle", () => {
    it("Executes full buy order flow from creation to validator-vote auto-close", async () => {
      const seed = 700;
      const pda = stockRampOrderPda(buyer1.publicKey, seed, program.programId);
      const ata = deriveAta(mint, pda);
      const AMOUNT = 2000 * 10 ** 9;
      const PRICE = 150;

      await program.methods
        .createBuyOrder(
          new anchor.BN(seed),
          new anchor.BN(AMOUNT),
          new anchor.BN(PRICE),
          "EUR",
          "SEPA transfer to IBAN XYZ",
          "flw_lifecycle_test"
        )
        .accountsPartial({
          buyer: buyer1.publicKey,
          mint,
          stockRampOrder: pda,
          globalState,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([buyer1])
        .rpc();

      // Read the actual fee bps snapshotted on this order.
      const buyOrderForFee = await program.account.stockRampOrder.fetch(pda);
      const feeBps = buyOrderForFee.feePercentage;

      const sellerAta = await getOrCreateAssociatedTokenAccount(connection, seller, mint, seller.publicKey);
      await mintTo(connection, authority, mint, sellerAta.address, authority, AMOUNT);

      await program.methods
        .instantReserve(new anchor.BN(AMOUNT), new anchor.BN(AMOUNT * PRICE), "EUR", "seller-payout-details")
        .accountsPartial({
          stockRampOrder: pda,
          maker: buyer1.publicKey,
          taker: seller.publicKey,
          mint,
          takerAta: sellerAta.address,
          stockRampOrderAta: ata,
          globalState,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([seller])
        .rpc();

      const buyOrder = await program.account.stockRampOrder.fetch(pda);
      const reservation = buyOrder.reservedAmounts[0];
      const payoutReference = reservation.payoutReference as string;

      const buyerAta = await getOrCreateAssociatedTokenAccount(connection, buyer1, mint, buyer1.publicKey);
      const feeDestinationAta = await getOrCreateAssociatedTokenAccount(
        connection,
        authority,
        mint,
        authority.publicKey
      );

      const buyer1BalanceBefore = BigInt((await getAccount(connection, buyerAta.address)).amount);

      await settleBuyReservation(
        pda,
        ata,
        buyer1.publicKey,
        seller.publicKey,
        AMOUNT,
        AMOUNT * PRICE,
        "EUR",
        payoutReference,
        true,
        feeDestinationAta.address,
        sellerAta.address,
        buyerAta.address
      );

      const buyer1BalanceAfter = BigInt((await getAccount(connection, buyerAta.address)).amount);
      const actualReceived = Number(buyer1BalanceAfter - buyer1BalanceBefore);

      const totalFee = computeTotalFee(AMOUNT, feeBps);
      const { makerFee } = splitFee(totalFee);
      const expectedReceived = AMOUNT - totalFee + makerFee; // maker gets principal minus net fee (after 60% rebate)

      assert.equal(actualReceived, expectedReceived, "buyer1 (maker) should receive amount minus net fee");

      // Account must be auto-closed (amount was fully consumed by a single fill).
      try {
        await program.account.stockRampOrder.fetch(pda);
        assert.fail("Account should have been auto-closed by submit_buy_vote");
      } catch (error) {
        assert.include((error as Error).toString(), "Account does not exist");
      }
    });
  });

  // ── Fee Distribution Verification ──────────────────────────────────────────

  describe("Fee Distribution Verification", () => {
    it("Correctly distributes fees across multiple settled transactions", async () => {
      const seed = 800;
      const pda = stockRampOrderPda(seller.publicKey, seed, program.programId);
      const ata = deriveAta(mint, pda);

      const sellerAta = await getOrCreateAssociatedTokenAccount(connection, seller, mint, seller.publicKey);
      await mintTo(connection, authority, mint, sellerAta.address, authority, 20000 * 10 ** 9);

      await program.methods
        .createSellOrder(
          new anchor.BN(seed),
          new anchor.BN(20000 * 10 ** 9),
          new anchor.BN(100),
          "USD",
          "Payment instructions",
          "flw_fee_test"
        )
        .accountsPartial({
          seller: seller.publicKey,
          mint,
          sellerAta: sellerAta.address,
          stockRampOrder: pda,
          stockRampOrderAta: ata,
          globalState,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([seller])
        .rpc();

      // Read the ACTUAL fee bps snapshotted on this order at creation time
      // (global_state.fee_percentage may have been changed by an earlier
      // test file running against this same shared validator process —
      // do not assume the DEFAULT_FEE_BASIS_POINTS constant here).
      const order = await program.account.stockRampOrder.fetch(pda);
      const actualFeeBps = order.feePercentage;

      const feeDestAta = await getOrCreateAssociatedTokenAccount(connection, authority, mint, authority.publicKey);
      const buyer1Ata = await getOrCreateAssociatedTokenAccount(connection, buyer1, mint, buyer1.publicKey);

      const feeBalanceBefore = (await getAccount(connection, feeDestAta.address)).amount;

      const numTx = 3;
      const amountPer = 5000 * 10 ** 9;

      for (let i = 0; i < numTx; i++) {
        const ref = `FEE-TEST-${i}`;
        await program.methods
          .instantSellReserve(new anchor.BN(amountPer), 0, null, ref)
          .accountsPartial({
            stockRampOrder: pda,
            maker: seller.publicKey,
            buyer: buyer1.publicKey,
            globalState,
            systemProgram: SystemProgram.programId,
          })
          .signers([buyer1])
          .rpc();

        // FIX (Bug 3): settleSellReservation now passes remainingAccounts
        // internally, so the validator-pool share (20% of the fee) is
        // credited to validators[0..2] instead of leaking into feeDestAta.
        await settleSellReservation(
          pda,
          ata,
          seller.publicKey,
          buyer1.publicKey,
          ref,
          true,
          feeDestAta.address,
          buyer1Ata.address,
          sellerAta.address
        );
      }

      const feeBalanceAfter = (await getAccount(connection, feeDestAta.address)).amount;
      const totalFeePerTx = computeTotalFee(amountPer, actualFeeBps);
      const { platformFee } = splitFee(totalFeePerTx);
      const expectedPlatformFees = numTx * platformFee;

      assert.equal(
        Number(feeBalanceAfter - feeBalanceBefore),
        expectedPlatformFees,
        "fee destination should receive exactly numTx * platform_fee (20% of total fee, using the order's actual snapshotted bps)"
      );
    });
  });

  // ── Partial-Fill Close Fix (integration perspective) ───────────────────────
  //
  //   • LP creates a buy order for N tokens
  //   • Taker1 fills M < N tokens and the vote succeeds
  //   • ⚠ OLD BUG: account closed here because the escrow ATA emptied to 0
  //   • ✅ FIX: account stays open; only closes when stock_ramp_order.amount == 0
  //   • Taker2 fills the remaining N-M tokens
  //   • Account closes correctly after this final fill

  describe("Partial-Fill Close Fix (integration)", () => {
    const LP_SEED = 900;
    const TOTAL = 3_000_000_000; // 3 tokens (9 decimals)
    const FILL_1 = 1_000_000_000; // taker fills 1 token
    const FILL_2 = 2_000_000_000; // taker fills remaining 2 tokens
    const PRICE = 100;

    let srPda: PublicKey;
    let srAta: PublicKey;
    let lpAta: PublicKey;
    let sellerAtaAddr: PublicKey;
    let feeAtaAddr: PublicKey;

    before(async () => {
      srPda = stockRampOrderPda(buyer1.publicKey, LP_SEED, program.programId);
      srAta = deriveAta(mint, srPda);

      await program.methods
        .createBuyOrder(
          new anchor.BN(LP_SEED),
          new anchor.BN(TOTAL),
          new anchor.BN(PRICE),
          "NGN",
          "pay via FLW — integration partial fill test",
          "FLW-INT-PARTIAL"
        )
        .accountsPartial({
          buyer: buyer1.publicKey,
          mint,
          stockRampOrder: srPda,
          globalState,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([buyer1])
        .rpc();

      const sellerAta = await getOrCreateAssociatedTokenAccount(connection, seller, mint, seller.publicKey);
      sellerAtaAddr = sellerAta.address;
      await mintTo(connection, authority, mint, sellerAtaAddr, authority, TOTAL * 2);

      const lpAtaAcc = await getOrCreateAssociatedTokenAccount(connection, buyer1, mint, buyer1.publicKey);
      lpAta = lpAtaAcc.address;

      const feeAcc = await getOrCreateAssociatedTokenAccount(connection, authority, mint, authority.publicKey);
      feeAtaAddr = feeAcc.address;
    });

    async function fillAndSettle(amount: number): Promise<void> {
      await program.methods
        .instantReserve(new anchor.BN(amount), new anchor.BN(amount * PRICE), "NGN", null)
        .accountsPartial({
          stockRampOrder: srPda,
          maker: buyer1.publicKey,
          taker: seller.publicKey,
          mint,
          takerAta: sellerAtaAddr,
          stockRampOrderAta: srAta,
          globalState,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([seller])
        .rpc();

      const sr = await program.account.stockRampOrder.fetch(srPda);
      const res = sr.reservedAmounts.find((r: any) => r.taker.equals(seller.publicKey) && r.status === 0);
      if (!res) throw new Error("No pending reservation found for taker");
      const ref = res.payoutReference as string;

      await settleBuyReservation(
        srPda,
        srAta,
        buyer1.publicKey,
        seller.publicKey,
        amount,
        amount * PRICE,
        "NGN",
        ref,
        true,
        feeAtaAddr,
        sellerAtaAddr,
        lpAta
      );
    }

    it("escrow survives the first partial fill (BUG REGRESSION CHECK)", async () => {
      const lpBalBefore = BigInt((await getAccount(connection, lpAta)).amount);

      await fillAndSettle(FILL_1);

      const sr = await program.account.stockRampOrder.fetch(srPda).catch(() => null);
      assert.ok(sr !== null, "REGRESSION: premature close — escrow must NOT close after partial fill");
      assert.equal(
        sr!.amount.toNumber(),
        TOTAL - FILL_1,
        "Remaining capacity must be TOTAL - FILL_1 after first partial fill"
      );

      const lpBalAfter = BigInt((await getAccount(connection, lpAta)).amount);
      assert.ok(lpBalAfter > lpBalBefore, "LP should have received tokens after fill 1");
    });

    it("escrow closes correctly after the final fill (amount reaches 0)", async () => {
      await fillAndSettle(FILL_2);

      const sr = await program.account.stockRampOrder.fetch(srPda).catch(() => null);
      assert.isNull(sr, "Escrow must be closed after final fill brings stock_ramp_order.amount to 0");
    });
  });
});