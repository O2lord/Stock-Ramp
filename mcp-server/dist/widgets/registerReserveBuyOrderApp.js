// src/widgets/registerReserveBuyOrderApp.ts
//
// MCP App for reserve_buy_order AND prepare_stock_offramp -- both render
// the SAME card (ui://stock-ramp/reserve-buy-order-card-v2), since
// prepare_stock_offramp's return shape is reserveBuyOrder's shape plus a
// few extra fields (symbol, mint, priceDivergencePct). This is the star
// tool for the "sell my AAPLx for naira" chat flow: prepare_stock_offramp
// resolves a ticker to a mint and finds the best order automatically, so
// the model never needs to already know a specific order's PDA address --
// reserve_buy_order stays available for a caller who already has one
// (e.g. from list_open_orders).
//
// RESOURCE URI VERSIONING: MCP App hosts are entitled to cache a ui://
// resource's content by its URI indefinitely -- that's the whole point of
// the "-vN" suffix. Bump it whenever this card's HTML/JS changes in a way
// that matters to an already-open host cache (as happened when the
// settled-state summary view was added below reserveBuyOrderCard.html):
// rebuilding and restarting the server does NOT invalidate a host's
// cached copy of an unchanged URI, and neither does deleting chats or
// reconnecting the MCP connector -- only a new URI does.
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { reserveBuyOrder } from "../tools/reserveBuyOrder.js";
import { prepareStockOfframp } from "../tools/prepareStockOfframp.js";
import { getReceiptByOrder } from "../tools/receiptByOrder.js";
import { findSignerByReference } from "../solanaPay.js";
const RESOURCE_URI = "ui://stock-ramp/reserve-buy-order-card-v2";
const WIDGET_HTML_PATH = path.join(import.meta.dirname, "reserveBuyOrderCard.html");
const RESOURCE_DOMAINS = ["https://cdn.jsdelivr.net"];
const CONNECT_DOMAINS = [
    "https://cdn.jsdelivr.net",
    ...(process.env.SUPABASE_URL ? [process.env.SUPABASE_URL] : []),
    ...(process.env.SUPABASE_URL ? [process.env.SUPABASE_URL.replace(/^https:/, "wss:")] : []),
];
const payoutDetailsSchema = z.object({
    accountNumber: z.string(),
    bankCode: z.string(),
    bankName: z.string(),
    beneficiaryName: z.string(),
});
export function registerReserveBuyOrderApp(server) {
    registerAppResource(server, "Reserve Buy Order Card", RESOURCE_URI, {
        description: "Live QR card for selling tokenized stock into an open BUY order -- scan to sign, fiat " +
            "lands in your bank automatically, no separate payment step.",
    }, async () => ({
        contents: [
            {
                uri: RESOURCE_URI,
                mimeType: RESOURCE_MIME_TYPE,
                text: await fs.readFile(WIDGET_HTML_PATH, "utf-8"),
                _meta: {
                    ui: {
                        csp: { resourceDomains: RESOURCE_DOMAINS, connectDomains: CONNECT_DOMAINS },
                        permissions: { clipboardWrite: {} },
                    },
                },
            },
        ],
    }));
    // --- prepare_stock_offramp: THE headline tool -----------------------
    registerAppTool(server, "prepare_stock_offramp", {
        title: "Sell a tokenized stock for cash",
        description: "The core off-ramp action: sell a tokenized stock (by ticker, e.g. 'AAPL' or 'AAPLx') for " +
            "fiat paid directly into a bank account. Resolves the ticker to its Solana mint, finds the " +
            "best available on-chain liquidity for that stock/currency pair, and renders a live QR " +
            "card -- no wallet address needed as input, it identifies itself on scan. Use this instead " +
            "of reserve_buy_order whenever the person names a stock by ticker rather than an order address.",
        inputSchema: {
            symbol: z.string().describe("Stock ticker, e.g. 'AAPL', 'TSLA', or 'AAPLx'"),
            amount: z.number().describe("Number of shares/tokens to sell"),
            currency: z.string().describe("Fiat currency to receive, e.g. 'NGN'"),
            payoutDetails: payoutDetailsSchema.describe("Bank account that should receive the payout"),
        },
        _meta: { ui: { resourceUri: RESOURCE_URI } },
    }, async (args) => {
        const result = await prepareStockOfframp(args);
        return {
            content: [
                {
                    type: "text",
                    // Include checkoutPageUrl in the spoken/text content, not just
                    // structuredContent -- voice sessions never render the ui://
                    // card (no visual surface to draw it on), so content[].text is
                    // the ONLY thing that reaches the person in that mode. Without
                    // the link here, a voice session that says "scan to sign" is
                    // asking the person to look at a card that will never appear,
                    // with no way to recover. checkoutPageUrl (not
                    // transactionRequestUrl/solanaPayUrl) is the right one to speak
                    // -- it's a plain https link that opens a page with the same QR
                    // plus an "Open in wallet" button, whereas the solana: URI has
                    // no protocol handler when pasted into a browser (see
                    // checkoutPage.ts).
                    text: result.found
                        ? `Found a ${result.currency ?? args.currency} buyer for ${args.amount} ${result.symbol}. ` +
                            `Scan the QR card to sign, or if the card doesn't show up (e.g. in voice mode), open this link on your phone to pay: ${result.checkoutPageUrl}`
                        : result.message ?? "No liquidity available.",
                },
            ],
            structuredContent: result,
        };
    });
    // --- reserve_buy_order: direct order-address entry point ------------
    registerAppTool(server, "reserve_buy_order", {
        title: "Reserve against a BUY order (sell tokens)",
        description: "For selling tokens into a SPECIFIC open BUY order you already have the address for " +
            "(e.g. from list_open_orders). If you only know the stock's ticker, use " +
            "prepare_stock_offramp instead -- it finds the best order automatically.",
        inputSchema: {
            orderAddress: z.string().describe("Full base58 PDA of the BUY order, from list_open_orders"),
            amount: z.number().describe("Amount of tokens to sell, in display units"),
            payoutDetails: payoutDetailsSchema.describe("Bank account that should receive the fiat payout"),
        },
        _meta: { ui: { resourceUri: RESOURCE_URI } },
    }, async (args) => {
        const result = await reserveBuyOrder(args);
        return {
            content: [
                {
                    type: "text",
                    // result.symbol comes from reserveBuyOrder.ts's mint->ticker
                    // resolution -- falls back to the generic "tokens" only on a
                    // lookup miss, same fallback the card itself uses.
                    // checkoutPageUrl included for the same reason as in
                    // prepare_stock_offramp above: it's the only fallback a voice
                    // session (no card surface) has to offer.
                    text: `Sell card ready: ${args.amount} ${result.symbol ?? "tokens"} into order ${args.orderAddress}. ` +
                        `Scan to sign, or if the card doesn't show up, open this link on your phone to pay: ${result.checkoutPageUrl}`,
                },
            ],
            structuredContent: result,
        };
    });
    registerAppTool(server, "get_reserve_buy_order_receipt", {
        title: "Get sell reservation receipt (manual fallback)",
        description: "Internal: on-demand fallback receipt check for the card's 'Check now' button, used only " +
            "if its Realtime subscription drops.",
        inputSchema: {
            orderAddress: z.string(),
            fiatAmount: z.number(),
            currency: z.string(),
            signerAddress: z.string().optional(),
        },
        _meta: { ui: { resourceUri: RESOURCE_URI, visibility: ["app"] } },
    }, async (args) => {
        const result = await getReceiptByOrder(args);
        return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    });
    registerAppTool(server, "resolve_reserve_buy_order_signer", {
        title: "Resolve who signed a reservation",
        description: "Internal: looks up the actual wallet that signed a reservation transaction.",
        inputSchema: { reference: z.string() },
        _meta: { ui: { resourceUri: RESOURCE_URI, visibility: ["app"] } },
    }, async (args) => {
        const signer = await findSignerByReference(args.reference);
        return { content: [{ type: "text", text: JSON.stringify({ signer }) }], structuredContent: { signer } };
    });
}
