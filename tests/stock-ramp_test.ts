// tests/stock-ramp_test.ts
//
// Ported from trust-vault_test.ts for the renamed/refactored Stock Ramp
// program. Covers:
//   • Global-state initialisation
//   • Validator registration (setup for later suites)
//   • Admin pause controls — buy orders and sell orders independently
//   • Pause does NOT block exits (cancel / withdraw)
//   • Partial-fill close-fix smoke test: buy order stays open after partial
//     settlement via submit_buy_vote, only closes on the fill that brings
//     amount to zero.
//
// Renames from Trust Vault:
//   trust-express          -> stock-ramp-order
//   TrustExpress           -> StockRampOrder
//   createExpressBuyOrder  -> createBuyOrder
//   createExpressSell      -> createSellOrder
//   expressWithdraw        -> stockRampWithdraw
//   confirmPayout / confirmSellPayment -> REMOVED, replaced by
//                                          submitBuyVote / submitSellVote
//
// New requirement not present in Trust Vault: submit_buy_vote /
// submit_sell_vote require the validator fee pool ATA to already exist for
// the mint (it's no longer init_if_needed inline — see
// initialize_validator_fee_pool_ata.rs) so we call
// ensureValidatorFeePoolAta() once per mint before any votes are cast.

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { StockRamp } from "../target/types/stock_ramp";
import { Keypair, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { assert, expect } from "chai";
import {
  airdropAll,
  deriveAta,
  ensureValidatorFeePoolAta,
  ensureValidatorsRegistered,
  globalStatePda,
  loadAuthorityKeypair,
  referenceHashBytes,
  stockRampOrderPda,
  validatorFeePoolAta,
  validatorFeePoolAuthorityPda,
  validatorVotePda,
  SHARED_VALIDATORS,
} from "./helpers";

describe("Stock Ramp", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.StockRamp as Program<StockRamp>;
  const connection = provider.connection;

  let authority: Keypair;
  let buyer: Keypair;
  let seller: Keypair;
  let taker: Keypair;
  let mint: anchor.web3.PublicKey;
  let globalState: anchor.web3.PublicKey;

  // 5 validators for the partial-fill close test
  const validators = SHARED_VALIDATORS;

  before(async () => {
    authority = loadAuthorityKeypair();
    buyer = Keypair.generate();
    seller = Keypair.generate();
    taker = Keypair.generate();

    await airdropAll(connection, [
      authority.publicKey,
      buyer.publicKey,
      seller.publicKey,
      taker.publicKey,
      ...validators.map((v) => v.publicKey),
    ]);

    mint = await createMint(connection, authority, authority.publicKey, null, 9);
    globalState = globalStatePda(program.programId);
  });

  // ── Initialisation ────────────────────────────────────────────────────────

  describe("Initialization", () => {
    it("Initializes or verifies global state", async () => {
      await program.methods
        .initializeGlobalState()
        .accountsPartial({
          authority: authority.publicKey,
          globalState,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();

      const gs = await program.account.globalState.fetch(globalState);
      expect(gs.authority.toString()).to.equal(authority.publicKey.toString());
      expect(gs.feePercentage).to.equal(5);
      expect(gs.requiredVotes).to.equal(3);
      expect(gs.totalStockRampCreated.toNumber()).to.be.greaterThanOrEqual(0);

      const expectedPoolAuthority = validatorFeePoolAuthorityPda(program.programId);
      assert.ok(
        gs.validatorFeePoolAuthority.equals(expectedPoolAuthority),
        "validator_fee_pool_authority must be derived and stored at init time"
      );
    });

    it("Registers validators for subsequent tests", async () => {
      await ensureValidatorsRegistered(
        program,
        authority.publicKey,
        globalState,
        validators
      );
      const gs = await program.account.globalState.fetch(globalState);
      assert.ok(gs.validatorCount >= 5, "At least 5 validators should be registered");
    });

    it("Initializes the validator fee pool ATA for the test mint", async () => {
      const poolAta = await ensureValidatorFeePoolAta(program, authority, globalState, mint);
      const acc = await connection.getAccountInfo(poolAta);
      assert.ok(acc !== null, "validator fee pool ATA should exist after setup");
    });
  });

  // ── Admin Pause Controls ────────────────────────────────────────────────────

  describe("Admin Pause Controls", () => {
    describe("Buy Order Pause", () => {
      it("Pauses buy order creation globally", async () => {
        await program.methods
          .pauseBuyOrders(true)
          .accountsPartial({ authority: authority.publicKey, globalState })
          .signers([authority])
          .rpc();

        const gs = await program.account.globalState.fetch(globalState);
        assert.equal(gs.buyOrdersPaused, true);

        const seed = 9001;
        const pda = stockRampOrderPda(buyer.publicKey, seed, program.programId);

        try {
          await program.methods
            .createBuyOrder(
              new anchor.BN(seed),
              new anchor.BN(1000 * 10 ** 9),
              new anchor.BN(100),
              "NGN",
              "Payment instructions",
              "flw_cred_test"
            )
            .accountsPartial({
              buyer: buyer.publicKey,
              mint,
              stockRampOrder: pda,
              globalState,
              systemProgram: SystemProgram.programId,
              tokenProgram: TOKEN_PROGRAM_ID,
              associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            })
            .signers([buyer])
            .rpc();
          assert.fail("Should have failed — buy order creation paused");
        } catch (error) {
          assert.include((error as Error).toString(), "BuyOrdersPaused");
        }

        await program.methods
          .pauseBuyOrders(false)
          .accountsPartial({ authority: authority.publicKey, globalState })
          .signers([authority])
          .rpc();
      });

      it("Prevents reservations on buy orders when paused", async () => {
        const seed = 9002;
        const pda = stockRampOrderPda(buyer.publicKey, seed, program.programId);

        await program.methods
          .createBuyOrder(
            new anchor.BN(seed),
            new anchor.BN(1000 * 10 ** 9),
            new anchor.BN(100),
            "NGN",
            "Payment instructions",
            "flw_cred_test"
          )
          .accountsPartial({
            buyer: buyer.publicKey,
            mint,
            stockRampOrder: pda,
            globalState,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          })
          .signers([buyer])
          .rpc();

        const takerAta = await getOrCreateAssociatedTokenAccount(
          connection,
          taker,
          mint,
          taker.publicKey
        );
        await mintTo(connection, authority, mint, takerAta.address, authority, 500 * 10 ** 9);

        const stockRampOrderAta = deriveAta(mint, pda);

        await program.methods
          .pauseBuyOrders(true)
          .accountsPartial({ authority: authority.publicKey, globalState })
          .signers([authority])
          .rpc();

        try {
          await program.methods
            .instantReserve(new anchor.BN(100 * 10 ** 9), new anchor.BN(10000), "NGN", null)
            .accountsPartial({
              stockRampOrder: pda,
              maker: buyer.publicKey,
              taker: taker.publicKey,
              mint,
              takerAta: takerAta.address,
              stockRampOrderAta,
              globalState,
              tokenProgram: TOKEN_PROGRAM_ID,
              associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
              systemProgram: SystemProgram.programId,
            })
            .signers([taker])
            .rpc();
          assert.fail("Should have failed — buy order reservations paused");
        } catch (error) {
          assert.include((error as Error).toString(), "BuyOrdersPaused");
        }

        await program.methods
          .pauseBuyOrders(false)
          .accountsPartial({ authority: authority.publicKey, globalState })
          .signers([authority])
          .rpc();
      });

      it("Still allows cancellations when buy orders paused", async () => {
        const seed = 9003;
        const pda = stockRampOrderPda(buyer.publicKey, seed, program.programId);

        await program.methods
          .createBuyOrder(
            new anchor.BN(seed),
            new anchor.BN(1000 * 10 ** 9),
            new anchor.BN(100),
            "NGN",
            "Payment instructions",
            "flw_cred_test"
          )
          .accountsPartial({
            buyer: buyer.publicKey,
            mint,
            stockRampOrder: pda,
            globalState,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          })
          .signers([buyer])
          .rpc();

        await program.methods
          .pauseBuyOrders(true)
          .accountsPartial({ authority: authority.publicKey, globalState })
          .signers([authority])
          .rpc();

        // Cancel should still succeed while paused — cancel_or_reduce_buy_order
        // only needs {buyer, stockRampOrder, maker}, no system/token programs.
        await program.methods
          .cancelOrReduceBuyOrder(new anchor.BN(0))
          .accountsPartial({
            buyer: buyer.publicKey,
            stockRampOrder: pda,
            maker: buyer.publicKey,
          })
          .signers([buyer])
          .rpc();

        await program.methods
          .pauseBuyOrders(false)
          .accountsPartial({ authority: authority.publicKey, globalState })
          .signers([authority])
          .rpc();
      });
    });

    describe("Sell Order Pause", () => {
      it("Pauses sell order creation globally", async () => {
        await program.methods
          .pauseSellOrders(true)
          .accountsPartial({ authority: authority.publicKey, globalState })
          .signers([authority])
          .rpc();

        const gs = await program.account.globalState.fetch(globalState);
        assert.equal(gs.sellOrdersPaused, true);

        const seed = 9101;
        const pda = stockRampOrderPda(seller.publicKey, seed, program.programId);
        const sellerAta = await getOrCreateAssociatedTokenAccount(
          connection,
          seller,
          mint,
          seller.publicKey
        );
        await mintTo(connection, authority, mint, sellerAta.address, authority, 1000 * 10 ** 9);
        const stockRampOrderAta = deriveAta(mint, pda);

        try {
          await program.methods
            .createSellOrder(
              new anchor.BN(seed),
              new anchor.BN(1000 * 10 ** 9),
              new anchor.BN(100),
              "NGN",
              "Payment instructions",
              "flw_cred_test"
            )
            .accountsPartial({
              seller: seller.publicKey,
              mint,
              sellerAta: sellerAta.address,
              stockRampOrder: pda,
              stockRampOrderAta,
              globalState,
              systemProgram: SystemProgram.programId,
              tokenProgram: TOKEN_PROGRAM_ID,
              associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            })
            .signers([seller])
            .rpc();
          assert.fail("Should have failed — sell order creation paused");
        } catch (error) {
          assert.include((error as Error).toString(), "SellOrdersPaused");
        }

        await program.methods
          .pauseSellOrders(false)
          .accountsPartial({ authority: authority.publicKey, globalState })
          .signers([authority])
          .rpc();
      });

      it("Prevents reservations on sell orders when paused", async () => {
        const seed = 9102;
        const pda = stockRampOrderPda(seller.publicKey, seed, program.programId);
        const sellerAta = await getOrCreateAssociatedTokenAccount(
          connection,
          seller,
          mint,
          seller.publicKey
        );
        await mintTo(connection, authority, mint, sellerAta.address, authority, 1000 * 10 ** 9);
        const stockRampOrderAta = deriveAta(mint, pda);

        await program.methods
          .createSellOrder(
            new anchor.BN(seed),
            new anchor.BN(1000 * 10 ** 9),
            new anchor.BN(100),
            "NGN",
            "Payment instructions",
            "flw_cred_test"
          )
          .accountsPartial({
            seller: seller.publicKey,
            mint,
            sellerAta: sellerAta.address,
            stockRampOrder: pda,
            stockRampOrderAta,
            globalState,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          })
          .signers([seller])
          .rpc();

        await program.methods
          .pauseSellOrders(true)
          .accountsPartial({ authority: authority.publicKey, globalState })
          .signers([authority])
          .rpc();

        try {
          await program.methods
            .instantSellReserve(new anchor.BN(100 * 10 ** 9), 0, null, "PAUSE-TEST-REF")
            .accountsPartial({
              stockRampOrder: pda,
              maker: seller.publicKey,
              buyer: taker.publicKey,
              globalState,
              systemProgram: SystemProgram.programId,
            })
            .signers([taker])
            .rpc();
          assert.fail("Should have failed — sell order reservations paused");
        } catch (error) {
          assert.include((error as Error).toString(), "SellOrdersPaused");
        }

        await program.methods
          .pauseSellOrders(false)
          .accountsPartial({ authority: authority.publicKey, globalState })
          .signers([authority])
          .rpc();
      });

      it("Still allows withdrawals when sell orders paused", async () => {
        const seed = 9103;
        const pda = stockRampOrderPda(seller.publicKey, seed, program.programId);
        const sellerAta = await getOrCreateAssociatedTokenAccount(
          connection,
          seller,
          mint,
          seller.publicKey
        );
        await mintTo(connection, authority, mint, sellerAta.address, authority, 1000 * 10 ** 9);
        const stockRampOrderAta = deriveAta(mint, pda);

        await program.methods
          .createSellOrder(
            new anchor.BN(seed),
            new anchor.BN(1000 * 10 ** 9),
            new anchor.BN(100),
            "NGN",
            "Payment instructions",
            "flw_cred_test"
          )
          .accountsPartial({
            seller: seller.publicKey,
            mint,
            sellerAta: sellerAta.address,
            stockRampOrder: pda,
            stockRampOrderAta,
            globalState,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          })
          .signers([seller])
          .rpc();

        await program.methods
          .pauseSellOrders(true)
          .accountsPartial({ authority: authority.publicKey, globalState })
          .signers([authority])
          .rpc();

        // stock_ramp_withdraw only needs {maker, stockRampOrder, mint,
        // makerAta, stockRampOrderAta, tokenProgram} — no system_program.
        await program.methods
          .stockRampWithdraw(new anchor.BN(100 * 10 ** 9))
          .accountsPartial({
            maker: seller.publicKey,
            stockRampOrder: pda,
            mint,
            makerAta: sellerAta.address,
            stockRampOrderAta,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([seller])
          .rpc();

        await program.methods
          .pauseSellOrders(false)
          .accountsPartial({ authority: authority.publicKey, globalState })
          .signers([authority])
          .rpc();
      });
    });

    it("Can pause buy and sell orders independently", async () => {
      await program.methods
        .pauseBuyOrders(true)
        .accountsPartial({ authority: authority.publicKey, globalState })
        .signers([authority])
        .rpc();

      let gs = await program.account.globalState.fetch(globalState);
      assert.equal(gs.buyOrdersPaused, true);
      assert.equal(gs.sellOrdersPaused, false, "Sell orders must still be active");

      await program.methods
        .pauseBuyOrders(false)
        .accountsPartial({ authority: authority.publicKey, globalState })
        .signers([authority])
        .rpc();

      await program.methods
        .pauseSellOrders(true)
        .accountsPartial({ authority: authority.publicKey, globalState })
        .signers([authority])
        .rpc();

      gs = await program.account.globalState.fetch(globalState);
      assert.equal(gs.buyOrdersPaused, false, "Buy orders must be unpaused");
      assert.equal(gs.sellOrdersPaused, true);

      await program.methods
        .pauseSellOrders(false)
        .accountsPartial({ authority: authority.publicKey, globalState })
        .signers([authority])
        .rpc();
    });
  });

  // ── Partial-fill close-fix (smoke) ──────────────────────────────────────────
  // A buy order that is partially filled must stay open; only the fill that
  // brings stock_ramp_order.amount to exactly 0 triggers auto-close.

  describe("Buy Order Partial-Fill Close Fix (smoke)", () => {
    const TOTAL = 1_000_000_000; // 1 token (9 decimals)
    const PARTIAL = 400_000_000; // 0.4 tokens
    const PRICE = 100;

    it("escrow stays open after partial fill, closes only on final fill", async () => {
      const seed = 9500;
      const srPda = stockRampOrderPda(buyer.publicKey, seed, program.programId);
      const srAta = deriveAta(mint, srPda);

      await program.methods
        .createBuyOrder(
          new anchor.BN(seed),
          new anchor.BN(TOTAL),
          new anchor.BN(PRICE),
          "NGN",
          "pay via FLW",
          "FLW-SMOKE-TEST"
        )
        .accountsPartial({
          buyer: buyer.publicKey,
          mint,
          stockRampOrder: srPda,
          globalState,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([buyer])
        .rpc();

      const takerAta = await getOrCreateAssociatedTokenAccount(connection, taker, mint, taker.publicKey);
      await mintTo(connection, authority, mint, takerAta.address, authority, TOTAL * 2);

      const buyerAta = await getOrCreateAssociatedTokenAccount(connection, buyer, mint, buyer.publicKey);
      const feeDestAta = await getOrCreateAssociatedTokenAccount(
        connection,
        authority,
        mint,
        authority.publicKey
      );

      async function fillAmount(amount: number) {
        await program.methods
          .instantReserve(new anchor.BN(amount), new anchor.BN(amount * PRICE), "NGN", null)
          .accountsPartial({
            stockRampOrder: srPda,
            maker: buyer.publicKey,
            taker: taker.publicKey,
            mint,
            takerAta: takerAta.address,
            stockRampOrderAta: srAta,
            globalState,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([taker])
          .rpc();

        const sr = await program.account.stockRampOrder.fetch(srPda);
        const res = sr.reservedAmounts.find(
          (r: any) => r.taker.equals(taker.publicKey) && r.status === 0
        );
        if (!res) throw new Error("No pending reservation found for taker");
        const ref = res.payoutReference as string;
        const votePda = validatorVotePda(srPda, ref, program.programId);

        for (let i = 0; i < 3; i++) {
          await program.methods
            .submitBuyVote(
              referenceHashBytes(ref),
              ref,
              taker.publicKey,
              new anchor.BN(amount),
              new anchor.BN(amount * PRICE),
              "NGN",
              true,
              `evidence_${i}`
            )
            .accountsPartial({
              validator: validators[i].publicKey,
              globalState,
              validatorVote: votePda,
              stockRampOrder: srPda,
              maker: buyer.publicKey,
              mint,
              stockRampOrderAta: srAta,
              feeDestinationAta: feeDestAta.address,
              takerAta: takerAta.address,
              makerAta: buyerAta.address,
              tokenProgram: TOKEN_PROGRAM_ID,
              systemProgram: SystemProgram.programId,
              validatorFeePoolAuthority: validatorFeePoolAuthorityPda(program.programId),
              validatorFeePoolAta: validatorFeePoolAta(
                validatorFeePoolAuthorityPda(program.programId),
                mint
              ),
            })
            .signers([validators[i]])
            .rpc();
        }
      }

      await fillAmount(PARTIAL);

      let sr = await program.account.stockRampOrder.fetch(srPda).catch(() => null);
      assert.ok(sr !== null, "Escrow must NOT close after partial fill #1");
      assert.equal(
        sr!.amount.toNumber(),
        TOTAL - PARTIAL,
        "Remaining capacity should be TOTAL - PARTIAL after fill #1"
      );

      const remaining = TOTAL - PARTIAL;
      await fillAmount(remaining);

      sr = await program.account.stockRampOrder.fetch(srPda).catch(() => null);
      assert.isNull(sr, "Escrow MUST close after final fill (amount reaches 0)");
    });
  });
});