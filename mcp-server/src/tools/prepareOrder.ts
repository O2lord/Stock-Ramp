import pkg from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PROGRAM_ID, STOCK_RAMP_ORDER_SEED, SUPPORTED_CURRENCIES } from "../constants.js";
import { getDecimalsForMint, getTokenProgramForMint } from "./tokenRegistry.js";
import { generateReference, transactionRequestUrl, qrDataUri } from "../solanaPay.js";
import { storeIntent } from "../paymentIntents.js";
import { findActiveCredential } from "./credentialCheck.js";

const { BN } = pkg;

/** Mirrors create_buy_order/create_sell_order's seed derivation:
 * seeds = [b"stock-ramp-order", maker.key(), seed.to_le_bytes()] */
export function deriveStockRampOrderPda(maker: PublicKey, seed: bigint): PublicKey {
  const seedBuf = Buffer.alloc(8);
  seedBuf.writeBigUInt64LE(seed);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from(STOCK_RAMP_ORDER_SEED), maker.toBuffer(), seedBuf],
    PROGRAM_ID
  );
  return pda;
}

export function deriveGlobalStatePda(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync([Buffer.from("global-state")], PROGRAM_ID);
  return pda;
}

/**
 * Accounts for create_buy_order, per the real Anchor context
 * (instructions/create_buy_order.rs): buyer, mint, stock_ramp_order PDA,
 * global_state PDA, system_program, token_program, associated_token_program.
 * No fee-destination account on this instruction — fee_destination is
 * copied from global_state at creation time, inside the handler.
 */
export async function buildCreateBuyOrderAccounts(args: { buyer: PublicKey; mint: string; seed: bigint }) {
  const mintPubkey = new PublicKey(args.mint);
  const tokenProgram = await getTokenProgramForMint(args.mint);
  return {
    buyer: args.buyer,
    mint: mintPubkey,
    stockRampOrder: deriveStockRampOrderPda(args.buyer, args.seed),
    globalState: deriveGlobalStatePda(),
    systemProgram: SystemProgram.programId,
    tokenProgram,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
  };
}

/**
 * prepare_stock_offramp / prepare_buy_order shares this shape: does NOT
 * build a transaction itself. Validates inputs, picks a seed, derives the
 * order's future PDA, and returns a Solana Pay transaction-request URL.
 * The actual unsigned transaction is built in server.ts's POST
 * /pay/:reference handler once the wallet identifies itself.
 *
 * create_buy_order moves no tokens at creation, so unlike a reservation
 * this doesn't need the buyer's ATA resolved up front.
 */
export async function prepareBuyOrder(args: {
  buyerWallet: string;
  mint: string;
  amount: number; // display units
  pricePerToken: number; // raw fiat units per whole token
  currency: string;
  paymentInstructions: string;
}) {
  if (!SUPPORTED_CURRENCIES.includes(args.currency.toUpperCase() as any)) {
    throw new Error(`Unsupported currency "${args.currency}". Supported: ${SUPPORTED_CURRENCIES.join(", ")}`);
  }
  if (args.paymentInstructions.length > 100) {
    throw new Error("paymentInstructions must be 100 characters or fewer.");
  }

  const buyer = new PublicKey(args.buyerWallet);

  const credential = await findActiveCredential({ walletAddress: args.buyerWallet, side: "buyer" });
  if (!credential) {
    const APP_URL = process.env.NEXT_PUBLIC_APP_URL;
    return {
      blocked: true as const,
      reason: "no_credential" as const,
      message:
        "This wallet doesn't have a saved payment processor credential yet. Order creation is " +
        "blocked until one is linked -- an order without a credential can be created on-chain " +
        `but can never actually settle a trade. Link one first at ${APP_URL}/providers/settings, ` +
        "then try again.",
    };
  }

  const decimals = await getDecimalsForMint(args.mint);
  const amountRaw = BigInt(Math.round(args.amount * 10 ** decimals));
  const seed = BigInt(Date.now());
  const orderAddress = deriveStockRampOrderPda(buyer, seed);

  const reference = generateReference();
  storeIntent(reference.toString(), {
    kind: "create_buy_order",
    buyer: buyer.toString(),
    seed: seed.toString(),
    mint: args.mint,
    amountRaw: amountRaw.toString(),
    pricePerToken: new BN(args.pricePerToken).toString(),
    currency: args.currency.toUpperCase(),
    paymentInstructions: args.paymentInstructions,
    credentialId: credential.id,
  });

  const url = transactionRequestUrl(reference);
  return {
    blocked: false as const,
    futureOrderAddress: orderAddress.toString(),
    transactionRequestUrl: url,
    qrCodeDataUri: await qrDataUri(url),
    expiresInSeconds: 300,
    instructions: "Scan this QR (or open the link) with Phantom or Backpack to review and sign.",
  };
}

/**
 * Accounts for create_sell_order, per the real Anchor context
 * (instructions/create_sell_order.rs): seller, mint, seller_ata,
 * stock_ramp_order PDA, stock_ramp_order_ata (escrow), global_state,
 * system_program, token_program, associated_token_program.
 */
export async function buildCreateSellOrderAccounts(args: { seller: PublicKey; mint: string; seed: bigint }) {
  const mintPubkey = new PublicKey(args.mint);
  const tokenProgram = await getTokenProgramForMint(args.mint);
  const stockRampOrder = deriveStockRampOrderPda(args.seller, args.seed);

  return {
    seller: args.seller,
    mint: mintPubkey,
    sellerAta: getAssociatedTokenAddressSync(mintPubkey, args.seller, false, tokenProgram),
    stockRampOrder,
    stockRampOrderAta: getAssociatedTokenAddressSync(mintPubkey, stockRampOrder, true, tokenProgram),
    globalState: deriveGlobalStatePda(),
    systemProgram: SystemProgram.programId,
    tokenProgram,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
  };
}

export async function prepareSellOrder(args: {
  sellerWallet: string;
  mint: string;
  amount: number;
  pricePerToken: number;
  currency: string;
  paymentInstructions: string;
}) {
  if (!SUPPORTED_CURRENCIES.includes(args.currency.toUpperCase() as any)) {
    throw new Error(`Unsupported currency "${args.currency}". Supported: ${SUPPORTED_CURRENCIES.join(", ")}`);
  }
  if (args.paymentInstructions.length > 100) {
    throw new Error("paymentInstructions must be 100 characters or fewer.");
  }

  const seller = new PublicKey(args.sellerWallet);

  const credential = await findActiveCredential({ walletAddress: args.sellerWallet, side: "seller" });
  if (!credential) {
    return {
      blocked: true as const,
      reason: "no_credential" as const,
      message:
        "This wallet doesn't have a saved payment processor credential yet. A sell order created " +
        "without one would deposit real tokens into escrow with no way to ever settle a trade " +
        `against it -- link a credential first at ${process.env.NEXT_PUBLIC_APP_URL}/providers/settings, ` +
        "then try again.",
    };
  }

  const decimals = await getDecimalsForMint(args.mint);
  const amountRaw = BigInt(Math.round(args.amount * 10 ** decimals));
  const seed = BigInt(Date.now());
  const orderAddress = deriveStockRampOrderPda(seller, seed);

  const reference = generateReference();
  storeIntent(reference.toString(), {
    kind: "create_sell_order",
    seller: seller.toString(),
    seed: seed.toString(),
    mint: args.mint,
    amountRaw: amountRaw.toString(),
    pricePerToken: new BN(args.pricePerToken).toString(),
    currency: args.currency.toUpperCase(),
    paymentInstructions: args.paymentInstructions,
    credentialId: credential.id,
  });

  const url = transactionRequestUrl(reference);
  return {
    blocked: false as const,
    futureOrderAddress: orderAddress.toString(),
    transactionRequestUrl: url,
    qrCodeDataUri: await qrDataUri(url),
    expiresInSeconds: 300,
    instructions:
      "Scan this QR (or open the link) with Phantom or Backpack to review and sign. " +
      `This deposits ${args.amount} tokens into escrow immediately on approval.`,
  };
}
