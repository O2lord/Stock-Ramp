/**
 * Price keeper — periodically refreshes `price_per_token` on every open
 * StockRampOrder this wallet owns, using live xStocks USD quotes converted
 * to each order's fiat currency.
 *
 * IMPORTANT: update_price requires the order's `maker` to sign (see the
 * on-chain program). This keeper therefore only updates orders whose
 * `maker` matches KEEPER_KEYPAIR_PATH's public key — i.e. it's built to
 * run as the sole LP for this hackathon demo, not as a neutral third-party
 * oracle for other LPs' orders. If you add other LPs later, the program
 * needs a delegated price-authority pubkey separate from `maker`.
 *
 * Run modes:
 *   npm run keeper:once   -> single pass, exits (good for external cron)
 *   npm run keeper:loop   -> polls forever every POLL_INTERVAL_MS
 */

import "dotenv/config";
import * as fs from "fs";
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

import { buildMintToSymbolMap, getUsdPrice } from "./xstocksClient";
import { getUsdToRate } from "./fxRate";

// Adjust this import to wherever `anchor build` emits your IDL types.
// Standard Anchor layout: target/types/stock_ramp.ts at the repo root.
import type { StockRamp } from "../../target/types/stock_ramp";
import idl from "../../target/idl/stock_ramp.json";

const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8899";
const PROGRAM_ID = new PublicKey(process.env.STOCK_RAMP_PROGRAM_ID!);
const KEEPER_KEYPAIR_PATH = process.env.KEEPER_KEYPAIR_PATH!;
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 60_000);

// Skip on-chain updates for price moves smaller than this, to avoid
// burning transaction fees/compute on noise.
const MIN_PRICE_CHANGE_PCT = Number(process.env.MIN_PRICE_CHANGE_PCT || 0.5);

function loadKeypair(path: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function pctChange(oldVal: number, newVal: number): number {
  if (oldVal === 0) return Infinity;
  return (Math.abs(newVal - oldVal) / oldVal) * 100;
}

async function runOnce() {
  const connection = new Connection(RPC_URL, "confirmed");
  const keeperKeypair = loadKeypair(KEEPER_KEYPAIR_PATH);
  const wallet = new anchor.Wallet(keeperKeypair);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const program = new anchor.Program(idl as anchor.Idl, provider) as unknown as anchor.Program<StockRamp>;

  console.log(`[keeper] Fetching open orders for maker ${wallet.publicKey.toBase58()}...`);

  // Fetch ALL StockRampOrder accounts, then filter to ones this keeper's
  // wallet actually owns (can sign for) and that still have unfilled
  // capacity worth quoting.
  const allOrders = await program.account.stockRampOrder.all();
  const myOrders = allOrders.filter(
    (o) => o.account.maker.toBase58() === wallet.publicKey.toBase58() && o.account.amount.toNumber() > 0
  );

  if (myOrders.length === 0) {
    console.log("[keeper] No open orders owned by this wallet — nothing to update.");
    return;
  }

  console.log(`[keeper] Found ${myOrders.length} open order(s) to check.`);

  // Build mint -> symbol map once per run (assets/deployments rarely change).
  const mintToSymbol = await buildMintToSymbolMap();

  // Cache USD quotes per symbol within this run, since multiple orders can
  // share the same mint.
  const usdQuoteCache = new Map<string, number>();

  for (const { publicKey: orderPubkey, account: order } of myOrders) {
    const mint = order.mint.toBase58();
    const symbol = mintToSymbol.get(mint);

    if (!symbol) {
      console.warn(`[keeper] No xStocks symbol found for mint ${mint} — skipping order ${orderPubkey.toBase58()}.`);
      continue;
    }

    const currency = Buffer.from(order.currency).toString("utf-8");

    try {
      let usdQuote = usdQuoteCache.get(symbol);
      if (usdQuote === undefined) {
        usdQuote = await getUsdPrice(symbol);
        usdQuoteCache.set(symbol, usdQuote);
      }

      const fxRate = await getUsdToRate(currency);
      const newPrice = Math.round(usdQuote * fxRate);
      const oldPrice = order.pricePerToken.toNumber();

      const change = pctChange(oldPrice, newPrice);
      if (change < MIN_PRICE_CHANGE_PCT) {
        console.log(
          `[keeper] ${symbol} (${orderPubkey.toBase58().slice(0, 8)}...): ` +
            `${oldPrice} -> ${newPrice} ${currency} (${change.toFixed(2)}% change) — below threshold, skipping.`
        );
        continue;
      }

      console.log(
        `[keeper] ${symbol} (${orderPubkey.toBase58().slice(0, 8)}...): ` +
          `updating ${oldPrice} -> ${newPrice} ${currency} (${change.toFixed(2)}% change)`
      );

      const sig = await program.methods
        .updatePrice(new anchor.BN(newPrice))
        .accounts({
          maker: wallet.publicKey,
          stockRampOrder: orderPubkey,
        })
        .rpc();

      console.log(`[keeper]   -> tx ${sig}`);
    } catch (err) {
      // One order's failure should never stop the rest of the batch.
      console.error(`[keeper] Failed to update order ${orderPubkey.toBase58()}:`, err);
    }
  }
}

async function main() {
  const mode = process.argv[2] || "once";

  if (mode === "once") {
    await runOnce();
    return;
  }

  if (mode === "loop") {
    console.log(`[keeper] Starting poll loop every ${POLL_INTERVAL_MS}ms. Ctrl+C to stop.`);
    for (;;) {
      try {
        await runOnce();
      } catch (err) {
        console.error("[keeper] Run failed:", err);
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }

  console.error(`Unknown mode "${mode}" — use "once" or "loop".`);
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
