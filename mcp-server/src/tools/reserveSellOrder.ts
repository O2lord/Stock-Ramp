import { PublicKey, SystemProgram } from "@solana/web3.js";
import { fetchAllOrders } from "./fetchOrders.js";
import { getDecimalsForMint } from "./tokenRegistry.js";
import { deriveGlobalStatePda } from "./prepareOrder.js";
import { generateReference, transactionRequestHttpUrl, qrDataUri } from "../solanaPay.js";
import { registerShortLink } from "../qrProxy.js";
import { storeIntent } from "../paymentIntents.js";
import { resolveMintToSymbol } from "../xstocksClient.js";

export function buildInstantSellReserveAccounts(args: {
  stockRampOrder: PublicKey;
  maker: PublicKey;
  buyer: PublicKey;
}) {
  return {
    stockRampOrder: args.stockRampOrder,
    maker: args.maker,
    buyer: args.buyer,
    globalState: deriveGlobalStatePda(),
    systemProgram: SystemProgram.programId,
  };
}

/**
 * reserve_sell_order -- a buyer purchasing tokens from an open SELL order.
 * No buyerWallet argument -- the wallet identifies itself when it scans
 * and signs, via server.ts's POST /pay/:reference (req.body.account).
 */
export async function reserveSellOrder(args: { orderAddress: string; amount: number }) {
  const orders = await fetchAllOrders();
  const order = orders.find((o) => o.orderAddress === args.orderAddress);
  if (!order) throw new Error(`No order found at ${args.orderAddress}.`);
  if (order.orderType !== "sell") {
    throw new Error(`${args.orderAddress} is a ${order.orderType} order -- reserve_sell_order only works against sell orders.`);
  }
  if (args.amount > order.amount) {
    throw new Error(`Requested ${args.amount} exceeds the ${order.amount} available on this order.`);
  }

  const decimals = await getDecimalsForMint(order.mint);
  const amountRaw = BigInt(Math.round(args.amount * 10 ** decimals));
  // Left unrounded deliberately -- unlike the BUY path (see
  // reserveBuyOrder.ts, where the client route rounds this to an integer
  // before writing it on-chain), the SELL path's receipts.fiat_amount is
  // whatever discord-bot/bot.ts's handleValidatorVoteExecuted descales
  // back down: Number(onChainFiatAmount) / 10^decimals, where the on-chain
  // value was computed as amountRaw * pricePerToken. That round-trip
  // through base units and back is mathematically this same product, but
  // it's a float division of a large integer, so it can land a few ULPs
  // off (4474.8199999999997 vs 4474.82). Rounding here would NOT make the
  // two equal -- it would just move the mismatch. The card compares with
  // a rounded, +/-1 tolerance instead (see reserveSellOrderCard.html), and
  // prefers the taker wallet as the match key when it has one.
  const fiatAmount = args.amount * order.pricePerToken;

  // Ticker for display only (card shows "0.01 AAPLx" instead of the
  // generic "0.01 tokens"). Best-effort -- a lookup miss (e.g. a devnet
  // mint the live xStocks API doesn't recognize) just leaves the card to
  // fall back to its own generic "token" label.
  let symbol: string | undefined;
  try {
    symbol = (await resolveMintToSymbol(order.mint)) ?? undefined;
  } catch (err) {
    console.warn("[reserveSellOrder] symbol resolution failed:", err);
  }

  const reference = generateReference();
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payoutReference = `SR-${nowSeconds}-${reference.toString().slice(0, 8)}`;

  storeIntent(reference.toString(), {
    kind: "reserve_sell_order",
    stockRampOrder: args.orderAddress,
    maker: order.maker,
    amountRaw: amountRaw.toString(),
    payoutReference,
  });

  const httpUrl = transactionRequestHttpUrl(reference);
  const id = registerShortLink(httpUrl);
  const shortUrl = `${process.env.PUBLIC_BASE_URL}/qr/${id}`;
  const url = `solana:${encodeURIComponent(shortUrl)}`;

  return {
    payoutReference,
    // The Solana Pay reference key, needed by the card to resolve which
    // wallet actually signed (resolve_reserve_sell_order_signer ->
    // findSignerByReference). This was missing from the returned object,
    // so the card's resolveSigner() always bailed on `!state.reference`
    // and signerAddress was permanently null -- every receipt match fell
    // back to the fiat amount alone. `payoutReference` is a different
    // thing (the processor-facing SR-... string) and is not a substitute.
    reference: reference.toString(),
    orderAddress: args.orderAddress,
    tokenAmount: args.amount,
    symbol,
    fiatAmount,
    currency: order.currency,
    transactionRequestUrl: url,
    checkoutPageUrl: `${process.env.PUBLIC_BASE_URL}/checkout/${id}`,
    qrCodeDataUri: await qrDataUri(url),
    expiresInSeconds: 300,
    instructions:
      "Scan this QR (or open the link) with Phantom or Backpack to lock in this reservation -- " +
      "nothing to provide up front, your wallet identifies itself the moment you sign. A payment " +
      "link appears automatically within about 30 seconds after.",
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
    publicBaseUrl: process.env.NEXT_PUBLIC_APP_URL,
  };
}
