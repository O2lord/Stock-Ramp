// tests/stock-ramp-errors_test.ts
//
// Ported from trust-vault-errors_test.ts. Covers every pause-related error
// path plus the partial-fill close-fix regression, from the "errors suite"
// perspective:
//   • BuyOrdersPaused on create_buy_order
//   • BuyOrdersPaused on instant_reserve
//   • SellOrdersPaused on create_sell_order
//   • SellOrdersPaused on instant_sell_reserve
//   • Pause does NOT block exits (cancel_or_reduce_buy_order / stock_ramp_withdraw)
//   • A buy order partially settled via submit_buy_vote must remain open
//     until stock_ramp_order.amount == 0.

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
} from "@solana/spl-token";
import { assert } from "chai";
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
  SHARED_VALIDATORS
} from "./helpers";

describe("Stock Ramp - Pause Error Tests", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.StockRamp as Program<StockRamp>;
  const connection = provider.connection;

  let authority: Keypair;
  let buyer: Keypair;
  let seller: Keypair;
  let taker: Keypair;
  let mint: PublicKey;
  let globalState: PublicKey;

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

    await program.methods
      .initializeGlobalState()
      .accountsPartial({
        authority: authority.publicKey,
        globalState,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc()
      .catch(() => {
        /* already initialised */
      });

    await ensureValidatorsRegistered(program, authority.publicKey, globalState, validators);
    await ensureValidatorFeePoolAta(program, authority, globalState, mint);
  });

  // ── Buy Order Pause Errors ──────────────────────────────────────────────────

  describe("Buy Order Pause Errors", () => {
    it("Prevents creating buy order when buy orders are paused", async () => {
      await program.methods
        .pauseBuyOrders(true)
        .accountsPartial({ authority: authority.publicKey, globalState })
        .signers([authority])
        .rpc();

      const seed = 8001;
      const pda = stockRampOrderPda(buyer.publicKey, seed, program.programId);

      try {
        await program.methods
          .createBuyOrder(
            new anchor.BN(seed),
            new anchor.BN(1000 * 10 ** 9),
            new anchor.BN(100),
            "USD",
            "Payment instructions for paused test",
            "flw_paused_test"
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
        assert.fail("Should have rejected buy order creation when paused");
      } catch (error) {
        assert.include((error as Error).toString(), "BuyOrdersPaused");
      }

      await program.methods
        .pauseBuyOrders(false)
        .accountsPartial({ authority: authority.publicKey, globalState })
        .signers([authority])
        .rpc();
    });

    it("Prevents reservation on buy order when buy orders are paused", async () => {
      const seed = 8002;
      const pda = stockRampOrderPda(buyer.publicKey, seed, program.programId);

      await program.methods
        .createBuyOrder(
          new anchor.BN(seed),
          new anchor.BN(1000 * 10 ** 9),
          new anchor.BN(100),
          "USD",
          "Payment instructions",
          "flw_test"
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

      const takerAta = await getOrCreateAssociatedTokenAccount(connection, taker, mint, taker.publicKey);
      await mintTo(connection, authority, mint, takerAta.address, authority, 500 * 10 ** 9);
      const stockRampOrderAta = deriveAta(mint, pda);

      await program.methods
        .pauseBuyOrders(true)
        .accountsPartial({ authority: authority.publicKey, globalState })
        .signers([authority])
        .rpc();

      try {
        await program.methods
          .instantReserve(new anchor.BN(100 * 10 ** 9), new anchor.BN(10000), "USD", null)
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
        assert.fail("Should have rejected reservation when buy orders paused");
      } catch (error) {
        assert.include((error as Error).toString(), "BuyOrdersPaused");
      }

      await program.methods
        .pauseBuyOrders(false)
        .accountsPartial({ authority: authority.publicKey, globalState })
        .signers([authority])
        .rpc();
    });
  });

  // ── Sell Order Pause Errors ─────────────────────────────────────────────────

  describe("Sell Order Pause Errors", () => {
    it("Prevents creating sell order when sell orders are paused", async () => {
      await program.methods
        .pauseSellOrders(true)
        .accountsPartial({ authority: authority.publicKey, globalState })
        .signers([authority])
        .rpc();

      const seed = 8101;
      const pda = stockRampOrderPda(seller.publicKey, seed, program.programId);
      const sellerAta = await getOrCreateAssociatedTokenAccount(connection, seller, mint, seller.publicKey);
      await mintTo(connection, authority, mint, sellerAta.address, authority, 1000 * 10 ** 9);
      const stockRampOrderAta = deriveAta(mint, pda);

      try {
        await program.methods
          .createSellOrder(
            new anchor.BN(seed),
            new anchor.BN(1000 * 10 ** 9),
            new anchor.BN(100),
            "USD",
            "Payment instructions for paused test",
            "flw_paused_test"
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
        assert.fail("Should have rejected sell order creation when paused");
      } catch (error) {
        assert.include((error as Error).toString(), "SellOrdersPaused");
      }

      await program.methods
        .pauseSellOrders(false)
        .accountsPartial({ authority: authority.publicKey, globalState })
        .signers([authority])
        .rpc();
    });

    it("Prevents reservation on sell order when sell orders are paused", async () => {
      const seed = 8102;
      const pda = stockRampOrderPda(seller.publicKey, seed, program.programId);
      const sellerAta = await getOrCreateAssociatedTokenAccount(connection, seller, mint, seller.publicKey);
      await mintTo(connection, authority, mint, sellerAta.address, authority, 1000 * 10 ** 9);
      const stockRampOrderAta = deriveAta(mint, pda);

      await program.methods
        .createSellOrder(
          new anchor.BN(seed),
          new anchor.BN(1000 * 10 ** 9),
          new anchor.BN(100),
          "USD",
          "Payment instructions",
          "flw_test"
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
        assert.fail("Should have rejected reservation when sell orders paused");
      } catch (error) {
        assert.include((error as Error).toString(), "SellOrdersPaused");
      }

      await program.methods
        .pauseSellOrders(false)
        .accountsPartial({ authority: authority.publicKey, globalState })
        .signers([authority])
        .rpc();
    });
  });

  // ── Pause Does Not Block Exits ──────────────────────────────────────────────

  describe("Pause Does Not Block Exits", () => {
    it("Allows cancellation even when buy orders paused", async () => {
      const seed = 8201;
      const pda = stockRampOrderPda(buyer.publicKey, seed, program.programId);

      await program.methods
        .createBuyOrder(
          new anchor.BN(seed),
          new anchor.BN(1000 * 10 ** 9),
          new anchor.BN(100),
          "USD",
          "Payment instructions",
          "flw_test"
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

    it("Allows withdrawal even when sell orders paused", async () => {
      const seed = 8202;
      const pda = stockRampOrderPda(seller.publicKey, seed, program.programId);
      const sellerAta = await getOrCreateAssociatedTokenAccount(connection, seller, mint, seller.publicKey);
      await mintTo(connection, authority, mint, sellerAta.address, authority, 1000 * 10 ** 9);
      const stockRampOrderAta = deriveAta(mint, pda);

      await program.methods
        .createSellOrder(
          new anchor.BN(seed),
          new anchor.BN(1000 * 10 ** 9),
          new anchor.BN(100),
          "USD",
          "Payment instructions",
          "flw_test"
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

  // ── Partial-fill close-fix (error-suite perspective) ───────────────────────

  describe("Buy Order Partial-Fill Does Not Trigger Premature Close", () => {
    const TOTAL = 2_000_000_000; // 2 tokens
    const FILL_1 = 800_000_000; // 0.8 tokens — partial
    const FILL_2 = 1_200_000_000; // remaining 1.2 tokens — final
    const PRICE = 100;

    let srPda: PublicKey;
    let srAta: PublicKey;
    let takerAtaAddr: PublicKey;
    let buyerAtaAddr: PublicKey;
    let feeDestAtaAddr: PublicKey;

    before(async () => {
      const seed = 8300;
      srPda = stockRampOrderPda(buyer.publicKey, seed, program.programId);
      srAta = deriveAta(mint, srPda);

      await program.methods
        .createBuyOrder(
          new anchor.BN(seed),
          new anchor.BN(TOTAL),
          new anchor.BN(PRICE),
          "NGN",
          "pay via FLW",
          "FLW-ERR-PARTIAL"
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

      const takerAtaAcc = await getOrCreateAssociatedTokenAccount(connection, taker, mint, taker.publicKey);
      takerAtaAddr = takerAtaAcc.address;
      await mintTo(connection, authority, mint, takerAtaAddr, authority, TOTAL * 2);

      const buyerAtaAcc = await getOrCreateAssociatedTokenAccount(connection, buyer, mint, buyer.publicKey);
      buyerAtaAddr = buyerAtaAcc.address;

      const feeAcc = await getOrCreateAssociatedTokenAccount(connection, authority, mint, authority.publicKey);
      feeDestAtaAddr = feeAcc.address;
    });

    async function settle(amount: number): Promise<void> {
      await program.methods
        .instantReserve(new anchor.BN(amount), new anchor.BN(amount * PRICE), "NGN", null)
        .accountsPartial({
          stockRampOrder: srPda,
          maker: buyer.publicKey,
          taker: taker.publicKey,
          mint,
          takerAta: takerAtaAddr,
          stockRampOrderAta: srAta,
          globalState,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([taker])
        .rpc();

      const sr = await program.account.stockRampOrder.fetch(srPda);
      const res = sr.reservedAmounts.find((r: any) => r.taker.equals(taker.publicKey) && r.status === 0);
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
            `ev${i}`
          )
          .accountsPartial({
            validator: validators[i].publicKey,
            globalState,
            validatorVote: votePda,
            stockRampOrder: srPda,
            maker: buyer.publicKey,
            mint,
            stockRampOrderAta: srAta,
            feeDestinationAta: feeDestAtaAddr,
            takerAta: takerAtaAddr,
            makerAta: buyerAtaAddr,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            validatorFeePoolAuthority: validatorFeePoolAuthorityPda(program.programId),
            validatorFeePoolAta: validatorFeePoolAta(validatorFeePoolAuthorityPda(program.programId), mint),
          })
          .signers([validators[i]])
          .rpc();
      }
    }

    it("account stays open after first partial settlement", async () => {
      await settle(FILL_1);

      const sr = await program.account.stockRampOrder.fetch(srPda).catch(() => null);
      assert.ok(sr !== null, "BUG REGRESSION: escrow closed prematurely after partial fill");
      assert.equal(sr!.amount.toNumber(), TOTAL - FILL_1, "Remaining capacity must equal TOTAL - FILL_1");
    });

    it("account closes only after the final settlement", async () => {
      await settle(FILL_2);

      const sr = await program.account.stockRampOrder.fetch(srPda).catch(() => null);
      assert.isNull(sr, "Escrow must be closed after the final fill where amount reaches 0");
    });
  });
});