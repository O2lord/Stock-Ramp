// client/app/api/solana-pay/instant-reserve/route.ts
// Solana Pay Action endpoint for `instant_reserve` (programs/stock-ramp/src/
// instructions/instant_reserve.rs) — lets a taker reserve into a BUY order's
// escrow by scanning a QR code / opening a Solana Pay link, without needing
// this dApp's UI (e.g. a merchant hands a customer a QR at checkout). The
// in-app equivalent (BuyOrder/InstantReserveButton.tsx) goes through
// useStockRampProgram().instantReserve() with a connected wallet instead —
// this route is for wallets that build the transaction from a URL per the
// Solana Pay spec (https://docs.solanapay.com/spec).
//
// Ported from trust_vault's client/app/api/solana-pay/instant-reserve/route.ts:
// `StockRampOrder`'s on-chain layout is byte-for-byte identical to trust_vault's
// `TrustExpress` struct (same field order — see parseStockRampOrder below), and
// `instant_reserve`'s discriminator/args are unchanged from trust_vault's
// `instant_reserve` (confirmed against client/relics/stock_ramp.ts's IDL: same
// 8-byte discriminator, same (amount, fiatAmount, currency, payoutDetails) args).
// Dropped from the port: trust_vault's yield-split (stock-ramp's instruction has
// no merchant-split feature) and its Supabase receipt lookup on GET (this repo
// has no receipts table yet — see empty supabase/migrations/).
//
// PAYOUT DETAILS: this route bypasses InstantReserveDialog.tsx entirely (a
// wallet building the tx straight from a Solana Pay URL), so it needs its own
// enforcement of the same rule the dialog enforces — payout_details must never
// be null on-chain, or the elected executor validator has nothing to route the
// fiat payout to ("Missing payout_details on event", see initiate-buy-payout's
// route.ts). POST now 400s if payoutDetails is missing, isn't valid JSON, or
// lacks account_number, instead of silently building a tx with payoutDetails
// = null like it used to.
//
// GET  — Solana Pay Action metadata + a capacity pre-check so a stale/full QR
//        surfaces an error before the wallet ever builds a transaction.
// POST — builds, simulates, and returns the unsigned instant_reserve transaction.

import { NextRequest, NextResponse } from "next/server";
import {
  PublicKey,
  Transaction,
  SystemProgram,
  TransactionInstruction,
  Connection,
} from "@solana/web3.js";
import { STOCK_RAMP_PROGRAM_ID, GLOBAL_STATE_SEED, SOLANA_RPC_ENDPOINT } from "@/lib/constant";

// ─── Config ───────────────────────────────────────────────────────────────

const PROGRAM_ID = STOCK_RAMP_PROGRAM_ID;

// Prefer a server-side RPC var if one is ever added — NEXT_PUBLIC_ vars are
// fine here too since this route never holds a secret, just avoids a second
// hardcoded devnet URL drifting from lib/constant.ts's.
const connection = new Connection(process.env.RPC_URL || SOLANA_RPC_ENDPOINT, "confirmed");

const [GLOBAL_STATE_PDA] = PublicKey.findProgramAddressSync([GLOBAL_STATE_SEED], PROGRAM_ID);

// sha256("global:instant_reserve")[0..8] — confirmed against
// client/relics/stock_ramp.ts's IDL `instructions[].discriminator` for "instantReserve".
const INSTANT_RESERVE_DISCRIMINATOR = Buffer.from([49, 131, 230, 138, 27, 60, 108, 209]);

const TOKEN_PROGRAM_CLASSIC = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_PROGRAM_2022 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

const MAX_RESERVATIONS_PER_ORDER = 10; // mirrors programs/stock-ramp/src/constants.rs

// ─── StockRampOrder account layout ───────────────────────────────────────
//
// Anchor prepends an 8-byte discriminator, then Borsh-packs fields in IDL
// order with no inter-field padding. Field order mirrors
// programs/stock-ramp/src/state/stock_ramp_order.rs exactly:
//
// Field              Type          Bytes   Offset range
// ─────────────────────────────────────────────────────
// discriminator      [u8;8]            8     0 ..   8
// seed               u64               8     8 ..  16
// maker              pubkey           32    16 ..  48
// mint               pubkey           32    48 ..  80
// currency           [u8;3]            3    80 ..  83
// escrowType         u8                1    83 ..  84
// feePercentage      u16               2    84 ..  86
// feeDestination     pubkey           32    86 .. 118
// reservedFee        u64               8   118 .. 126
// amount             u64               8   126 .. 134
// pricePerToken      u64               8   134 .. 142
// paymentInstructions String    variable   142: u32LE length prefix, 146+: bytes
// reservedAmounts    Vec<ReservedAmount>    after paymentInstructions bytes
// ...
//
// Same shape as trust_vault's TrustExpress (offsets confirmed identical) —
// see hooks/queries/useStockRampAccounts.ts, which relies on the same
// MAKER_OFFSET/MINT_OFFSET/ESCROW_TYPE_OFFSET constants client-side.

interface StockRampOrderAccountData {
  maker: PublicKey;
  mint: PublicKey;
  escrowType: number;
  amount: bigint; // raw u64 — remaining escrow liquidity
  pricePerToken: bigint; // raw u64
  reservedCount: number; // length of reservedAmounts vec
}

function parseStockRampOrder(data: Buffer): StockRampOrderAccountData {
  const maker = new PublicKey(data.subarray(16, 48));
  const mint = new PublicKey(data.subarray(48, 80));
  const escrowType = data.readUInt8(83);
  const amount = data.readBigUInt64LE(126);
  const pricePerToken = data.readBigUInt64LE(134);

  const paymentInstructionsLen = data.readUInt32LE(142);
  const reservedAmountsOffset = 146 + paymentInstructionsLen;

  if (reservedAmountsOffset + 4 > data.length) {
    throw new Error(
      `parseStockRampOrder: reservedAmounts offset ${reservedAmountsOffset} is outside ` +
        `buffer (len=${data.length}). paymentInstructions length read as ${paymentInstructionsLen} ` +
        `at offset 142 — IDL struct layout mismatch.`
    );
  }

  const reservedCount = data.readUInt32LE(reservedAmountsOffset);

  return { maker, mint, escrowType, amount, pricePerToken, reservedCount };
}

function deriveATA(owner: PublicKey, mint: PublicKey, tokenProgram: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];
}

// ─── Borsh serialization for instant_reserve ─────────────────────────────
//
// Args (IDL order): amount: u64, fiatAmount: u64, currency: String,
// payoutDetails: Option<String>

function buildInstructionData(
  tokenAmountRaw: bigint,
  fiatAmountRaw: bigint,
  currency: string,
  payoutDetails: string | null
): Buffer {
  const amountBuf = Buffer.alloc(8);
  amountBuf.writeBigUInt64LE(tokenAmountRaw);

  const fiatBuf = Buffer.alloc(8);
  fiatBuf.writeBigUInt64LE(fiatAmountRaw);

  const currencyBytes = Buffer.from(currency, "utf8");
  const currencyLenBuf = Buffer.alloc(4);
  currencyLenBuf.writeUInt32LE(currencyBytes.length);
  const currencyBuf = Buffer.concat([currencyLenBuf, currencyBytes]);

  let payoutDetailsBuf: Buffer;
  if (payoutDetails) {
    const strBytes = Buffer.from(payoutDetails, "utf8");
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32LE(strBytes.length);
    payoutDetailsBuf = Buffer.concat([Buffer.from([1]), lenBuf, strBytes]);
  } else {
    payoutDetailsBuf = Buffer.from([0]);
  }

  return Buffer.concat([INSTANT_RESERVE_DISCRIMINATOR, amountBuf, fiatBuf, currencyBuf, payoutDetailsBuf]);
}

// ─── CORS ─────────────────────────────────────────────────────────────────

function withCors(res: NextResponse): NextResponse {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, Content-Encoding, Accept-Encoding"
  );
  res.headers.set("Content-Type", "application/json");
  // Bypass ngrok's HTML interstitial during local dev tunneling — without
  // this, strict wallets (Backpack, Solflare) get HTML instead of JSON.
  res.headers.set("ngrok-skip-browser-warning", "true");
  return res;
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, Content-Encoding, Accept-Encoding",
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "true",
    },
  });
}

// ─── GET — Solana Pay action metadata ─────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const stockRampOrderAddress = searchParams.get("stockRampOrder");
    const tokenAmount = searchParams.get("tokenAmount");
    const fiatAmount = searchParams.get("fiatAmount");
    const currency = searchParams.get("currency");

    const iconUrl = process.env.NEXT_PUBLIC_APP_URL
      ? `${process.env.NEXT_PUBLIC_APP_URL}/logo.png`
      : undefined; // [flag] no Stock Ramp logo asset exists yet — see StockRampBrandMark.tsx

    // ── Capacity check on GET ─────────────────────────────────────────────
    // Per the Solana Pay spec, wallets GET the action URL first to show the
    // label/title/description before ever POSTing. Returning a non-200 here
    // lets the wallet surface our message instead of letting the customer
    // approve a transaction that would fail on-chain against a stale/full order.
    if (stockRampOrderAddress && fiatAmount && currency) {
      try {
        const orderInfo = await connection.getAccountInfo(new PublicKey(stockRampOrderAddress));
        if (orderInfo && orderInfo.owner.equals(PROGRAM_ID)) {
          const { amount: orderAmount, pricePerToken, reservedCount, mint } = parseStockRampOrder(
            orderInfo.data
          );

          const fiatAmountNum = parseFloat(fiatAmount);
          if (!isNaN(fiatAmountNum) && fiatAmountNum > 0 && pricePerToken > BigInt(0)) {
            let decimals = 6;
            try {
              const mintInfo = await connection.getAccountInfo(mint);
              if (mintInfo) decimals = mintInfo.data[44];
            } catch {
              /* fall back to default 6 */
            }

            const fiatAmountRaw = BigInt(Math.round(fiatAmountNum));
            const scalar = BigInt(10) ** BigInt(decimals);
            const tokenAmountRaw = (fiatAmountRaw * scalar + pricePerToken - BigInt(1)) / pricePerToken;

            if (reservedCount >= MAX_RESERVATIONS_PER_ORDER) {
              return withCors(
                NextResponse.json(
                  {
                    error:
                      "This payment link has expired — the order is fully booked. Please ask for a new QR code.",
                  },
                  { status: 400 }
                )
              );
            }
            if (orderAmount < tokenAmountRaw) {
              return withCors(
                NextResponse.json(
                  {
                    error:
                      "This payment link has expired — the order no longer has enough liquidity. Please ask for a new QR code.",
                  },
                  { status: 400 }
                )
              );
            }
          }
        }
      } catch (capacityErr) {
        // Non-fatal — better to show the QR and let POST catch a real
        // problem than to block on a transient RPC error.
        console.warn("[instant-reserve GET] Capacity pre-check failed (non-fatal):", capacityErr);
      }
    }

    return withCors(
      NextResponse.json({
        label: "Stock Ramp — Instant Reserve",
        icon: iconUrl,
        title: `Pay ${currency ?? ""} ${fiatAmount ?? ""}`.trim(),
        description: tokenAmount
          ? `Send ${tokenAmount} tokens — receive ${fiatAmount} ${currency} once a validator confirms payment.`
          : "Reserve into this buy order's escrow.",
      })
    );
  } catch (error) {
    console.error("[instant-reserve] GET error:", error);
    return withCors(NextResponse.json({ error: "Internal server error" }, { status: 500 }));
  }
}

// ─── POST — Build and return the transaction ──────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const account: string = body.account;

    if (!account) {
      return withCors(NextResponse.json({ error: "Missing account in request body" }, { status: 400 }));
    }

    const { searchParams } = new URL(req.url);
    const stockRampOrderAddress = searchParams.get("stockRampOrder");
    const tokenAmount = searchParams.get("tokenAmount"); // display hint only
    const fiatAmount = searchParams.get("fiatAmount");
    const currency = searchParams.get("currency");
    const payoutDetailsRaw = searchParams.get("payoutDetails");
    // Optional Solana Pay reference pubkey — included as a trailing
    // non-signer, non-writable key so the tx can be located on-chain by
    // watching for it. Anchor only reads the first 10 accounts for
    // InstantReserve's context; anything appended after is ignored by
    // account resolution (same pattern this program uses for
    // submitBuyVote's validatorEarningsAccounts remaining accounts).
    const referenceParam = searchParams.get("reference");

    if (!stockRampOrderAddress || !fiatAmount || !currency) {
      return withCors(NextResponse.json({ error: "Missing required parameters" }, { status: 400 }));
    }

    let stockRampOrderPubkey: PublicKey;
    let buyerPubkey: PublicKey;
    try {
      stockRampOrderPubkey = new PublicKey(stockRampOrderAddress);
      buyerPubkey = new PublicKey(account);
    } catch {
      return withCors(NextResponse.json({ error: "Invalid public key format" }, { status: 400 }));
    }

    const tokenAmountNum = tokenAmount ? parseFloat(tokenAmount) : 0; // logging only
    const fiatAmountNum = parseFloat(fiatAmount);
    if (isNaN(fiatAmountNum) || fiatAmountNum <= 0) {
      return withCors(NextResponse.json({ error: "Invalid fiat amount" }, { status: 400 }));
    }

    const orderInfo = await connection.getAccountInfo(stockRampOrderPubkey);
    if (!orderInfo) {
      return withCors(NextResponse.json({ error: "StockRampOrder account not found" }, { status: 404 }));
    }
    if (!orderInfo.owner.equals(PROGRAM_ID)) {
      return withCors(
        NextResponse.json(
          {
            error: "Invalid StockRampOrder account owner",
            actual: orderInfo.owner.toString(),
            expected: PROGRAM_ID.toString(),
          },
          { status: 400 }
        )
      );
    }

    const { maker, mint, escrowType, amount: orderAmount, pricePerToken, reservedCount } =
      parseStockRampOrder(orderInfo.data);

    // instant_reserve is the BUY-side taker action — the maker's escrow
    // holds tokens they want to buy fiat for. The program itself doesn't
    // enforce this (see instructions/instant_reserve.rs), but a QR pointed
    // at a SELL order would be a client-side mistake worth catching early.
    const ESCROW_TYPE_BUY = 1;
    if (escrowType !== ESCROW_TYPE_BUY) {
      return withCors(
        NextResponse.json(
          { error: "This order is not a buy order — instant_reserve only applies to buy orders." },
          { status: 400 }
        )
      );
    }

    let tokenProgramId = TOKEN_PROGRAM_CLASSIC;
    let decimals = 6;
    try {
      const mintInfo = await connection.getAccountInfo(mint);
      if (mintInfo) {
        decimals = mintInfo.data[44];
        if (mintInfo.owner.equals(TOKEN_PROGRAM_2022)) {
          tokenProgramId = TOKEN_PROGRAM_2022;
        }
      }
    } catch {
      console.warn("[instant-reserve] Could not fetch mint info, defaulting to classic token program");
    }

    // Derive the token amount from the on-chain price using integer
    // arithmetic only — see trust_vault's port notes on why floats aren't
    // safe here (IEEE-754 rounding can under-derive by 1 ULP and trip
    // InsufficientAmount on-chain). Ceiling division so the taker never
    // sends less than the fiat amount is worth.
    if (pricePerToken <= BigInt(0)) {
      return withCors(NextResponse.json({ error: "Order has an invalid price" }, { status: 400 }));
    }
    const fiatAmountRaw = BigInt(Math.round(fiatAmountNum));
    const scalar = BigInt(10) ** BigInt(decimals);
    const tokenAmountRaw = (fiatAmountRaw * scalar + pricePerToken - BigInt(1)) / pricePerToken;

    console.log(
      `[instant-reserve] fiatAmountRaw=${fiatAmountRaw} pricePerToken=${pricePerToken} ` +
        `decimals=${decimals} tokenAmountRaw=${tokenAmountRaw} (frontend hint was ${tokenAmountNum})`
    );

    // ── Re-validate order capacity right before building the tx ──────────
    // Time passed between QR generation and the scan — another reservation
    // may have consumed liquidity or filled the reservation slots since.
    if (reservedCount >= MAX_RESERVATIONS_PER_ORDER) {
      return withCors(
        NextResponse.json(
          {
            error: "ORDER_CAPACITY_FULL",
            message: "This order is fully booked. Please try again to get a fresh rate.",
          },
          { status: 409 }
        )
      );
    }
    if (orderAmount < tokenAmountRaw) {
      return withCors(
        NextResponse.json(
          {
            error: "ORDER_INSUFFICIENT_AMOUNT",
            message: "This order no longer has enough liquidity. Please try again to get a fresh rate.",
          },
          { status: 409 }
        )
      );
    }

    // payout_details is REQUIRED — see InstantReserveDialog.tsx's file header
    // for why. This route bypasses that dialog entirely (a wallet building
    // the tx from a raw Solana Pay URL), so the same enforcement has to live
    // here too, or a QR-initiated reserve can still land on-chain with
    // payout_details = None and get stuck exactly like the in-app bug did.
    // Capped at MAX_PAYMENT_INSTRUCTIONS_LEN (100 chars) on-chain, so a
    // caller must fit { account_number, bank_code, beneficiary_name } (or
    // whatever PayoutBankDetails needs) into that budget.
    if (!payoutDetailsRaw) {
      return withCors(
        NextResponse.json(
          {
            error: "MISSING_PAYOUT_DETAILS",
            message:
              "payoutDetails is required — pass a JSON-encoded { account_number, bank_code, beneficiary_name } as a query parameter.",
          },
          { status: 400 }
        )
      );
    }
    try {
      const parsed = JSON.parse(payoutDetailsRaw);
      if (!parsed?.account_number) {
        throw new Error("missing account_number");
      }
    } catch {
      return withCors(
        NextResponse.json(
          {
            error: "INVALID_PAYOUT_DETAILS",
            message: "payoutDetails must be valid JSON containing at least account_number.",
          },
          { status: 400 }
        )
      );
    }
    if (payoutDetailsRaw.length > 100) {
      return withCors(
        NextResponse.json(
          {
            error: "PAYOUT_DETAILS_TOO_LONG",
            message:
              "payoutDetails must be at most 100 characters once JSON-encoded — trim beneficiary_name or omit optional fields.",
          },
          { status: 400 }
        )
      );
    }
    const payoutDetails: string = payoutDetailsRaw;

    const instructionData = buildInstructionData(tokenAmountRaw, fiatAmountRaw, currency, payoutDetails);

    const takerAta = deriveATA(buyerPubkey, mint, tokenProgramId);
    const stockRampOrderAta = deriveATA(stockRampOrderPubkey, mint, tokenProgramId);

    // Accounts — must match InstantReserve's context in
    // instructions/instant_reserve.rs exactly, in order.
    const keys = [
      { pubkey: stockRampOrderPubkey, isSigner: false, isWritable: true },
      { pubkey: maker, isSigner: false, isWritable: false },
      { pubkey: buyerPubkey, isSigner: true, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: takerAta, isSigner: false, isWritable: true },
      { pubkey: stockRampOrderAta, isSigner: false, isWritable: true },
      { pubkey: GLOBAL_STATE_PDA, isSigner: false, isWritable: false },
      { pubkey: tokenProgramId, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ...(referenceParam ? [{ pubkey: new PublicKey(referenceParam), isSigner: false, isWritable: false }] : []),
    ];

    const reserveInstruction = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys,
      data: instructionData,
    });

    const transaction = new Transaction();
    transaction.add(reserveInstruction);

    const { blockhash } = await connection.getLatestBlockhash("finalized");
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = buyerPubkey;

    const serialized = transaction.serialize({ requireAllSignatures: false, verifySignatures: false });

    try {
      const sim = await connection.simulateTransaction(transaction, undefined, true);
      if (sim.value.err) {
        console.error("[instant-reserve] Simulation failed:", JSON.stringify(sim.value.err));
        console.error("[instant-reserve] Simulation logs:", sim.value.logs);
      }
    } catch (simErr) {
      console.warn("[instant-reserve] Could not simulate:", simErr);
    }

    return withCors(
      NextResponse.json({
        transaction: serialized.toString("base64"),
        message: `Reserve ${tokenAmountNum || Number(tokenAmountRaw) / Number(scalar)} tokens for ${fiatAmountNum} ${currency} instant payout`,
      })
    );
  } catch (error) {
    console.error("[instant-reserve] POST error:", error);
    return withCors(
      NextResponse.json(
        {
          error: "Failed to create transaction",
          details: error instanceof Error ? error.message : "Unknown error",
        },
        { status: 500 }
      )
    );
  }
}
