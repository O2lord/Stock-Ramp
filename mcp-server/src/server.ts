import "dotenv/config";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import anchorPkg from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

import { getMarketRates, listOpenOrders, listKnownTokens } from "./tools/marketData.js";
import { getOrderStatus } from "./tools/orderStatus.js";
import { getPlatformStats, getFeeStructure } from "./tools/platformStats.js";
import { getProtocolOverview, getCurrenciesAndProcessors } from "./tools/staticInfo.js";
import { SUPPORTED_CURRENCIES } from "./constants.js";
import { prepareBuyOrder, prepareSellOrder, buildCreateBuyOrderAccounts, buildCreateSellOrderAccounts } from "./tools/prepareOrder.js";
import { getReceiptByReference, findReceipt } from "./tools/receipt.js";
import { waitForPayment } from "./tools/waitForPayment.js";
import { buildInstantSellReserveAccounts } from "./tools/reserveSellOrder.js";
import { getPaymentLink } from "./tools/paymentLinkLookup.js";
import { waitForPaymentLink } from "./tools/waitForPaymentLink.js";
import { getXStockPrice } from "./tools/xstocksPrice.js";
import { getIntent } from "./paymentIntents.js";
import { getProgram, getConnection } from "./program.js";
import { proxyQr } from "./qrProxy.js";
import { registerReserveSellOrderApp } from "./widgets/registerReserveSellOrderApp.js";
import { registerReserveBuyOrderApp } from "./widgets/registerReserveBuyOrderApp.js";
import { registerStockRampHubApp } from "./widgets/registerStockRampHubApp.js";
import { renderCheckoutPage } from "./checkoutPage.js";

const { BN } = anchorPkg;

function textResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

/** For tool results that include a QR code — real MCP `image` content
 * block, not a data: URI embedded in text (which Chrome blocks navigating
 * to as a top-level link). Ported unchanged from Trust Vault. */
function imageResult(data: Record<string, unknown> & { qrCodeDataUri: string }) {
  const prefix = "base64,";
  const idx = data.qrCodeDataUri.indexOf(prefix);
  if (idx === -1) {
    throw new Error(`qrCodeDataUri is not a base64 data URI: ${data.qrCodeDataUri.slice(0, 40)}...`);
  }
  const base64 = data.qrCodeDataUri.slice(idx + prefix.length);
  const { qrCodeDataUri: _drop, ...rest } = data;
  return {
    content: [
      { type: "text" as const, text: JSON.stringify({ ...rest, qrCode: "(see attached image)" }, null, 2) },
      { type: "image" as const, data: base64, mimeType: "image/png" },
    ],
  };
}

function buildServer(): McpServer {
  const server = new McpServer({ name: "stock-ramp", version: "0.1.0" });

  server.registerTool(
    "get_protocol_overview",
    {
      title: "StockRamp protocol overview",
      description:
        "Explains what StockRamp is: non-custodial tokenized-equity-to-fiat settlement on Solana, " +
        'how escrow and validator consensus work. Use for general "what is StockRamp" questions.',
      inputSchema: {},
    },
    async () => textResult({ overview: getProtocolOverview() })
  );

  server.registerTool(
    "list_known_tokens",
    {
      title: "Tokens currently traded on StockRamp",
      description: "Lists mints (mint address + decimals) that currently have at least one open order.",
      inputSchema: {},
    },
    async () => textResult(await listKnownTokens())
  );

  server.registerTool(
    "get_xstock_price",
    {
      title: "Live xStocks reference price",
      description:
        "Resolves a stock ticker (e.g. 'AAPL' or 'AAPLx') to its Solana mint address and current " +
        "reference price from xStocks' public quote feed, optionally converted to a target fiat " +
        "currency. Use this before prepare_stock_offramp to show the person a price estimate, or " +
        "whenever they ask what a stock is worth.",
      inputSchema: {
        symbol: z.string().describe("Stock ticker, e.g. 'AAPL', 'TSLA', or 'AAPLx'"),
        currency: z.enum(SUPPORTED_CURRENCIES).optional(),
      },
    },
    async (args) => textResult(await getXStockPrice(args))
  );

  server.registerTool(
    "get_market_rates",
    {
      title: "Best available market rate",
      description:
        "Returns the best available BUY-order rate for a token/currency pair. Optionally filter " +
        "by mint address and/or currency. Use list_known_tokens or get_xstock_price to resolve a " +
        "ticker to its mint address first.",
      inputSchema: {
        token: z.string().optional().describe("Full mint address"),
        currency: z.enum(SUPPORTED_CURRENCIES).optional(),
      },
    },
    async (args) => textResult(await getMarketRates(args))
  );

  server.registerTool(
    "list_open_orders",
    {
      title: "List open orders",
      description: "Lists currently open buy and/or sell orders, optionally filtered by type, currency, or mint.",
      inputSchema: {
        orderType: z.enum(["buy", "sell"]).optional(),
        currency: z.enum(SUPPORTED_CURRENCIES).optional(),
        token: z.string().optional().describe("Full mint address"),
      },
    },
    async (args) => textResult(await listOpenOrders(args))
  );

  server.registerTool(
    "get_order_status",
    {
      title: "Get order status",
      description:
        "Fetches the live on-chain status of a specific order by its address (PDA), including " +
        "available amount and any active reservations. A reservation disappearing does not by " +
        "itself mean it succeeded -- use get_receipt / find_receipt / wait_for_payment for a real " +
        "success signal.",
      inputSchema: { orderAddress: z.string().describe("Full base58 PDA of the StockRampOrder") },
    },
    async (args) => textResult(await getOrderStatus(args))
  );

  server.registerTool(
    "get_platform_stats",
    {
      title: "Platform statistics",
      description: "Returns protocol-wide stats: total orders created/closed, volume, fees collected, validator count.",
      inputSchema: {},
    },
    async () => textResult(await getPlatformStats())
  );

  server.registerTool(
    "get_fee_structure",
    {
      title: "Fee structure",
      description: "Returns the live protocol fee (read from on-chain GlobalState) and the fixed platform/LP/validator split.",
      inputSchema: {},
    },
    async () => textResult(await getFeeStructure())
  );

  server.registerTool(
    "get_currencies_and_processors",
    {
      title: "Supported currencies and payment processors",
      description: "Lists fiat currencies and payment processors StockRamp currently supports.",
      inputSchema: {},
    },
    async () => textResult(getCurrenciesAndProcessors())
  );

  server.registerTool(
    "prepare_buy_order",
    {
      title: "Prepare a new BUY order (LP)",
      description:
        "For an LP creating a new buy order. Validates inputs, checks for an existing saved " +
        "payment processor credential (blocks with guidance if none exists), derives the order's " +
        "future PDA, and returns a Solana Pay QR/URL. Does not move funds itself.",
      inputSchema: {
        buyerWallet: z.string().describe("LP's base58 wallet pubkey"),
        mint: z.string().describe("Full token mint address"),
        amount: z.number().describe("Amount in display units"),
        pricePerToken: z.number().describe("Whole-currency units per whole token, e.g. 1650 = ₦1650/token"),
        currency: z.enum(SUPPORTED_CURRENCIES),
        paymentInstructions: z.string().max(100),
      },
    },
    async (args) => {
      const result = await prepareBuyOrder(args);
      return result.blocked ? textResult(result) : imageResult(result);
    }
  );

  server.registerTool(
    "prepare_sell_order",
    {
      title: "Prepare a new SELL order (LP)",
      description:
        "For an LP creating a new sell order. Same credential gating as prepare_buy_order, but " +
        "more important here: creating this order deposits real tokens into escrow immediately.",
      inputSchema: {
        sellerWallet: z.string().describe("LP's base58 wallet pubkey"),
        mint: z.string().describe("Full token mint address"),
        amount: z.number().describe("Amount in display units to deposit"),
        pricePerToken: z.number(),
        currency: z.enum(SUPPORTED_CURRENCIES),
        paymentInstructions: z.string().max(100),
      },
    },
    async (args) => {
      const result = await prepareSellOrder(args);
      return result.blocked ? textResult(result) : imageResult(result);
    }
  );

  server.registerTool(
    "get_payment_link",
    {
      title: "Get a payment link",
      description: "Looks up the hosted checkout link for a sell-order reservation by its payout reference.",
      inputSchema: { payoutReference: z.string() },
    },
    async (args) => textResult(await getPaymentLink(args.payoutReference))
  );

  server.registerTool(
    "wait_for_payment_link",
    {
      title: "Wait for a payment link",
      description: "Bounded poll (~30s) for a payment link to become available after reserve_sell_order.",
      inputSchema: { payoutReference: z.string() },
    },
    async (args) => textResult(await waitForPaymentLink(args))
  );

  server.registerTool(
    "get_receipt",
    {
      title: "Get a payment receipt",
      description:
        "Looks up a receipt by payout reference. A receipt row only ever exists after the " +
        "off-chain payout processor verified the transfer succeeded -- reliable success signal, " +
        "unlike an absent on-chain reservation alone.",
      inputSchema: { payoutReference: z.string().describe("The payout_reference emitted at reservation time") },
    },
    async (args) => textResult(await getReceiptByReference(args.payoutReference))
  );

  server.registerTool(
    "find_receipt",
    {
      title: "Find a payment receipt by order + taker",
      description: "Alternative receipt lookup for when you have the order address and taker wallet but not the payout_reference.",
      inputSchema: {
        stockRampOrderAddress: z.string().describe("Full base58 PDA of the order"),
        takerAddress: z.string().describe("Base58 wallet pubkey of the paying customer"),
        sinceIso: z.string().describe("ISO 8601 timestamp -- only receipts at or after this time are considered"),
      },
    },
    async (args) => textResult(await findReceipt(args))
  );

  server.registerTool(
    "wait_for_payment",
    {
      title: "Wait for a payment to settle",
      description:
        "Bounded poll (up to ~40s) for a reservation to resolve. Distinguishes 'success' (a " +
        "matching receipt was found), 'unknown' (no longer active on-chain but no receipt -- " +
        "check manually before treating as paid), or 'pending' (still active, call again).",
      inputSchema: {
        orderAddress: z.string().describe("Full base58 PDA of the order"),
        stockRampOrderAddress: z.string().describe("Same PDA as orderAddress -- used as the receipt lookup key"),
        takerWallet: z.string().describe("Base58 wallet pubkey of the paying customer"),
        sinceUnixSeconds: z.number().describe("Unix timestamp of when the reservation was created"),
      },
    },
    async (args) => textResult(await waitForPayment(args))
  );

  // ── MCP App: reserve buy order card (reserve_buy_order + prepare_stock_offramp) ──
  registerReserveBuyOrderApp(server);

  // ── MCP App: reserve sell order card (reserve_sell_order) ──────────────
  registerReserveSellOrderApp(server);

  // ── MCP App: StockRamp hub (open_stock_ramp) -- browsing entry point,
  // sits alongside the two specific reservation cards rather than
  // replacing them.
  registerStockRampHubApp(server);

  return server;
}

// --- Streamable HTTP transport wiring ---
const app = express();

// Trust exactly one hop of X-Forwarded-For: the Cloudflare tunnel sitting
// in front of this process. Without this, express-rate-limit throws
// ERR_ERL_UNEXPECTED_X_FORWARDED_FOR on every request, since it refuses to
// trust a forwarded IP it wasn't told to expect.
app.set("trust proxy", 1);

app.use(
  cors({
    origin: "*",
    exposedHeaders: ["Mcp-Session-Id"],
    allowedHeaders: ["Content-Type", "Mcp-Session-Id"],
  })
);

app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.get("/checkout/:id", renderCheckoutPage);

// Solana Pay transaction-request routes. Only used by prepare_buy_order/
// prepare_sell_order (LP creating a new order) and reserve_sell_order
// (buyer reserving against a SELL order) -- reserve_buy_order/
// prepare_stock_offramp delegate to the client's own
// /api/solana-pay/instant-reserve route instead (see reserveBuyOrder.ts).
app.get("/pay/:reference", async (req, res) => {
  const intent = getIntent(req.params.reference);
  if (!intent) return res.status(404).json({ error: "Unknown or expired payment request" });
  res.json({ label: "StockRamp", icon: `${process.env.PUBLIC_BASE_URL}/icon.png` });
});

app.post("/pay/:reference", async (req, res) => {
  const intent = getIntent(req.params.reference);
  if (!intent) return res.status(404).json({ error: "Unknown or expired payment request" });

  const walletPubkey = new PublicKey(req.body.account);
  const program = getProgram();

  let transaction;
  if (intent.kind === "create_buy_order") {
    const accounts = await buildCreateBuyOrderAccounts({
      buyer: walletPubkey,
      mint: intent.mint,
      seed: BigInt(intent.seed),
    });

    transaction = await program.methods
      .createBuyOrder(
        new BN(intent.seed),
        new BN(intent.amountRaw),
        new BN(intent.pricePerToken),
        intent.currency,
        intent.paymentInstructions,
        intent.credentialId
      )
      .accounts(accounts as any)
      .transaction();
  } else if (intent.kind === "create_sell_order") {
    const accounts = await buildCreateSellOrderAccounts({
      seller: walletPubkey,
      mint: intent.mint,
      seed: BigInt(intent.seed),
    });

    transaction = await program.methods
      .createSellOrder(
        new BN(intent.seed),
        new BN(intent.amountRaw),
        new BN(intent.pricePerToken),
        intent.currency,
        intent.paymentInstructions,
        intent.credentialId
      )
      .accounts(accounts as any)
      .transaction();
  } else if (intent.kind === "reserve_sell_order") {
    const accounts = buildInstantSellReserveAccounts({
      stockRampOrder: new PublicKey(intent.stockRampOrder),
      maker: new PublicKey(intent.maker),
      buyer: walletPubkey,
    });

    transaction = await program.methods
      .instantSellReserve(
        new BN(intent.amountRaw),
        0, // payment_mode: 0 = payment link
        null, // payout_details -- not needed for payment_mode 0
        intent.payoutReference
      )
      .accounts(accounts as any)
      .transaction();
  } else {
    return res.status(501).json({ error: `Unknown intent kind` });
  }

  // Attach the Solana Pay reference as a non-signer, non-writable account,
  // so findSignerByReference can later recover the wallet that signed.
  transaction.instructions[0].keys.push({
    pubkey: new PublicKey(req.params.reference),
    isSigner: false,
    isWritable: false,
  });

  transaction.feePayer = walletPubkey;
  const { blockhash } = await getConnection().getLatestBlockhash();
  transaction.recentBlockhash = blockhash;

  const serialized = transaction.serialize({ requireAllSignatures: false }).toString("base64");
  res.json({ transaction: serialized, message: "Confirm your StockRamp order" });
});

app.get("/qr/:id", proxyQr);
app.post("/qr/:id", proxyQr);

const mcpRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please slow down." },
});

const transports = new Map<string, StreamableHTTPServerTransport>();

app.post("/mcp", mcpRateLimiter, async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  let transport = sessionId ? transports.get(sessionId) : undefined;

  if (!transport) {
    const server = buildServer();
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        transports.set(id, transport!);
      },
    });
    transport.onclose = () => {
      if (transport?.sessionId) transports.delete(transport.sessionId);
    };
    await server.connect(transport);
  }

  await transport.handleRequest(req, res, req.body);
});

app.get("/mcp", mcpRateLimiter, async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const transport = sessionId ? transports.get(sessionId) : undefined;
  if (!transport) {
    res.status(400).send("Unknown or missing session");
    return;
  }
  await transport.handleRequest(req, res);
});

app.delete("/mcp", mcpRateLimiter, async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const transport = sessionId ? transports.get(sessionId) : undefined;
  if (!transport) {
    res.status(400).send("Unknown or missing session");
    return;
  }
  await transport.handleRequest(req, res);
  transports.delete(sessionId!);
});

const PORT = process.env.PORT ?? 3939;
app.listen(PORT, () => {
  console.log(`StockRamp MCP server listening on :${PORT}/mcp`);
});
