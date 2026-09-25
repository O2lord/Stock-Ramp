import { fetchAllOrders } from "./fetchOrders.js";
import { qrDataUri, generateReference } from "../solanaPay.js";
import { registerShortLink, SHORT_LINK_TTL_MS } from "../qrProxy.js";
import { resolveMintToSymbol } from "../xstocksClient.js";

export interface ReserveBuyOrderPayoutDetails {
  accountNumber: string;
  bankCode: string;
  bankName: string;
  beneficiaryName: string;
}

/**
 * reserve_buy_order -- a token holder selling into an open BUY order. This
 * IS the core off-ramp action ("sell my AAPLx for naira") — prepare_stock_offramp
 * is a thin wrapper around this that resolves a stock symbol to its mint
 * and finds the best matching order first (see prepareStockOfframp.ts).
 *
 * Delegates to the client app's own /api/solana-pay/instant-reserve route
 * (same pattern Trust Vault used) rather than building the instant_reserve
 * transaction in this server directly — that route is the one place the
 * instruction's exact account/arg shape is confirmed correct.
 *
 * REQUIRES: your StockRamp client repo to expose an equivalent
 * /api/solana-pay/instant-reserve route, forked from Trust Vault's. This
 * server does not implement that route itself.
 */
export async function reserveBuyOrder(args: {
  orderAddress: string;
  amount: number;
  payoutDetails: ReserveBuyOrderPayoutDetails;
}) {
  const APP_URL = process.env.NEXT_PUBLIC_APP_URL;
  if (!APP_URL) {
    throw new Error(
      "NEXT_PUBLIC_APP_URL is not set on this MCP server. reserve_buy_order builds a URL " +
        "pointing at that app's /api/solana-pay/instant-reserve route."
    );
  }

  const orders = await fetchAllOrders();
  const order = orders.find((o) => o.orderAddress === args.orderAddress);
  if (!order) throw new Error(`No order found at ${args.orderAddress}.`);
  if (order.orderType !== "buy") {
    throw new Error(`${args.orderAddress} is a ${order.orderType} order -- reserve_buy_order only works against buy orders.`);
  }
  if (args.amount > order.amount) {
    throw new Error(`Requested ${args.amount} exceeds the ${order.amount} available on this order.`);
  }

  // Rounded to match client/app/api/solana-pay/instant-reserve/route.ts's
  // `BigInt(Math.round(fiatAmountNum))` -- that route rounds this exact
  // value before writing it on-chain as the reservation's fiatAmount, which
  // is what ultimately lands in receipts.fiat_amount for BUY orders (see
  // discord-bot/bot.ts's handleValidatorVoteExecuted, which passes BUY
  // fiatAmount through unscaled). If this stays unrounded, the card/state
  // fiatAmount used for the "Check now" and Realtime receipt matches (see
  // reserveBuyOrderCard.html) never equals the row that actually gets
  // written, and a successful payout silently never surfaces as "paid" in
  // the UI.
  const fiatAmount = Math.round(args.amount * order.pricePerToken);
  const reference = generateReference();

  // Ticker for display only (card shows "0.01 AAPLx" instead of the
  // generic "0.01 tokens"). This is the direct reserve_buy_order entry
  // point -- unlike prepareStockOfframp.ts, which already resolves a
  // symbol on its way to finding the order and was returning it, a caller
  // hitting this tool straight (with an order address it already knows)
  // got no symbol at all, so the card's `data.symbol ?? "token"` fallback
  // always fired. Resolved here so both paths behave the same. Best-effort
  // -- a lookup miss (e.g. devnet mint the API doesn't recognize) falls
  // back to the card's own "token" default rather than failing the
  // reservation.
  let symbol: string | undefined;
  try {
    symbol = (await resolveMintToSymbol(order.mint)) ?? undefined;
  } catch (err) {
    console.warn("[reserveBuyOrder] symbol resolution failed:", err);
  }

  // Param name confirmed against client/app/api/solana-pay/instant-reserve/
  // route.ts's GET/POST handlers, which both read
  // searchParams.get("stockRampOrder") -- this was "stockRampOrderAddress"
  // here, a mismatch that meant the route always fell through to its
  // "Missing required parameters" branch and rejected every request built
  // by this tool.
  const apiUrl = new URL("/api/solana-pay/instant-reserve", APP_URL);
  apiUrl.searchParams.set("stockRampOrder", args.orderAddress);
  apiUrl.searchParams.set("tokenAmount", args.amount.toString());
  apiUrl.searchParams.set("fiatAmount", fiatAmount.toString());
  apiUrl.searchParams.set("currency", order.currency);
  apiUrl.searchParams.set("reference", reference.toString());
  // Only account_number, bank_code, and beneficiary_name are what the
  // client route (instant-reserve/route.ts) actually checks for and needs
  // -- it requires account_number to be present and rejects the whole
  // JSON-encoded string once it's over 100 chars (mirrors a fixed-size
  // on-chain field, see MAX_PAYMENT_INSTRUCTIONS_LEN there). "type" and
  // "bank_name" were being sent too, which the route never reads and which
  // pushed real-world values (e.g. "Access Bank" + a longer beneficiary
  // name) over that cap, so every reservation with a full bank name failed
  // with PAYOUT_DETAILS_TOO_LONG. bankName is kept in this function's own
  // return value (and shown on the card) for display purposes only -- it's
  // just not sent on-chain.
  apiUrl.searchParams.set(
    "payoutDetails",
    JSON.stringify({
      account_number: args.payoutDetails.accountNumber,
      bank_code: args.payoutDetails.bankCode,
      beneficiary_name: args.payoutDetails.beneficiaryName,
    })
  );
  const rpcUrl = process.env.SOLANA_RPC_URL ?? "";
  const cluster = rpcUrl.includes("devnet") ? "devnet" : rpcUrl.includes("mainnet") ? "mainnet-beta" : "devnet";
  apiUrl.searchParams.set("cluster", cluster);

  const id = registerShortLink(apiUrl.toString());
  const shortUrl = `${process.env.PUBLIC_BASE_URL}/qr/${id}`;
  const solanaPayUrl = `solana:${encodeURIComponent(shortUrl)}`;

  return {
    orderAddress: args.orderAddress,
    tokenAmount: args.amount,
    symbol,
    fiatAmount,
    currency: order.currency,
    payoutDetails: args.payoutDetails,
    transactionRequestUrl: solanaPayUrl,
    reference: reference.toString(),
    checkoutPageUrl: `${process.env.PUBLIC_BASE_URL}/checkout/${id}`,
    qrCodeDataUri: await qrDataUri(solanaPayUrl),
    expiresInSeconds: Math.floor(SHORT_LINK_TTL_MS / 1000),
    instructions:
      `Scan this QR (or open the link) with Phantom or Backpack to sign -- this moves ${args.amount} ` +
      `${symbol ?? "tokens"} into escrow immediately on approval. Fiat pays out automatically to the ` +
      "bank account you provided, no separate payment step needed.",
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
    publicBaseUrl: APP_URL,
  };
}
