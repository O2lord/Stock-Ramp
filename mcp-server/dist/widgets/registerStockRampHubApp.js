// src/widgets/registerStockRampHubApp.ts
//
// The browsing entry point: one card, opened with no required args, that
// shows live per-currency rates plus Buy/Sell tabs inline. Ported from
// Trust Vault's registerTrustVaultHubApp.ts -- renamed brand/URIs only.
//
// Sits ALONGSIDE reserve_sell_order / reserve_buy_order / prepare_stock_offramp,
// doesn't replace them -- a direct chat command ("sell 3 AAPL for naira")
// still goes straight to prepare_stock_offramp's specific card; this one
// is for browsing/"bring up StockRamp" with no specifics yet.
//
// All reservation work is delegated to the SAME functions the other cards
// already use (reserveSellOrder(), reserveBuyOrder()), wrapped here as
// app-only tools bound to the hub's own resourceUri -- avoids the host
// trying to pop a second card if we called another card's UI-bound tool
// via callServerTool instead.
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { getHubRates, findBestOrder } from "../tools/hubRates.js";
import { reserveSellOrder } from "../tools/reserveSellOrder.js";
import { reserveBuyOrder } from "../tools/reserveBuyOrder.js";
import { getPaymentLink } from "../tools/paymentLinkLookup.js";
import { getReceiptByOrder } from "../tools/receiptByOrder.js";
const RESOURCE_URI = "ui://stock-ramp/hub-v1";
const WIDGET_HTML_PATH = path.join(import.meta.dirname, "stockRampHub.html");
const RESOURCE_DOMAINS = ["https://cdn.jsdelivr.net"];
const CONNECT_DOMAINS = [
    "https://cdn.jsdelivr.net",
    ...(process.env.SUPABASE_URL ? [process.env.SUPABASE_URL] : []),
    ...(process.env.SUPABASE_URL ? [process.env.SUPABASE_URL.replace(/^https:/, "wss:")] : []),
];
export function registerStockRampHubApp(server) {
    registerAppResource(server, "StockRamp Hub", RESOURCE_URI, {
        description: "Live StockRamp home -- current rates per currency, Buy/Sell tabs, and reservation flow, " +
            "all in one card. Opens with no arguments needed.",
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
    registerAppTool(server, "open_stock_ramp", {
        title: "Open StockRamp",
        description: "Opens the StockRamp home card: live buy/sell rates for every stock with liquidity right now, " +
            "grouped by currency AND stock (never mixed across stocks), plus inline Buy/Sell forms to reserve " +
            "an order without leaving the card. Use this for a general 'bring up StockRamp' / 'what are the " +
            "rates' request with no specific stock or amount yet -- for a fully-specified request ('sell 3 AAPL " +
            "for naira') prefer prepare_stock_offramp directly.",
        inputSchema: {},
        _meta: { ui: { resourceUri: RESOURCE_URI } },
    }, async () => {
        const rates = await getHubRates();
        return {
            content: [{ type: "text", text: `StockRamp is open -- ${rates.length} stock/currency pairs have live liquidity right now.` }],
            structuredContent: { rates },
        };
    });
    registerAppTool(server, "hub_refresh_rates", {
        title: "Refresh hub rates",
        description: "Internal: re-fetch live per-currency, per-stock rates for the hub card.",
        inputSchema: {},
        _meta: { ui: { resourceUri: RESOURCE_URI, visibility: ["app"] } },
    }, async () => {
        const rates = await getHubRates();
        return { content: [{ type: "text", text: JSON.stringify(rates) }], structuredContent: { rates } };
    });
    registerAppTool(server, "hub_find_best_order", {
        title: "Find best order for a currency + stock",
        description: "Internal: resolves the best open order for the hub's Buy/Sell form once currency, stock (mint), and " +
            "side are chosen. Always scoped to one mint -- never mixes one stock's order into another stock's price.",
        inputSchema: { orderType: z.enum(["buy", "sell"]), currency: z.string(), mint: z.string() },
        _meta: { ui: { resourceUri: RESOURCE_URI, visibility: ["app"] } },
    }, async (args) => {
        const result = await findBestOrder(args);
        return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    });
    registerAppTool(server, "hub_reserve_sell_order", {
        title: "Reserve a sell order (from the hub)",
        description: "Internal: same as reserve_sell_order, called from inside the hub card's Buy tab.",
        inputSchema: { orderAddress: z.string(), amount: z.number() },
        _meta: { ui: { resourceUri: RESOURCE_URI, visibility: ["app"] } },
    }, async (args) => {
        const result = await reserveSellOrder(args);
        return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    });
    registerAppTool(server, "hub_reserve_buy_order", {
        title: "Reserve a buy order (from the hub)",
        description: "Internal: same as reserve_buy_order, called from inside the hub card's Sell tab.",
        inputSchema: {
            orderAddress: z.string(),
            amount: z.number(),
            payoutDetails: z.object({
                accountNumber: z.string(),
                bankCode: z.string(),
                bankName: z.string(),
                beneficiaryName: z.string(),
            }),
        },
        _meta: { ui: { resourceUri: RESOURCE_URI, visibility: ["app"] } },
    }, async (args) => {
        const result = await reserveBuyOrder(args);
        return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    });
    registerAppTool(server, "hub_get_payment_link", {
        title: "Get reservation payment link (hub poll)",
        description: "Internal: single non-blocking payment-link lookup for the hub's Buy-tab poll loop.",
        inputSchema: { payoutReference: z.string() },
        _meta: { ui: { resourceUri: RESOURCE_URI, visibility: ["app"] } },
    }, async (args) => {
        const link = await getPaymentLink(args.payoutReference);
        const result = link ? { found: true, ...link } : { found: false };
        return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    });
    registerAppTool(server, "hub_get_receipt", {
        title: "Get receipt (hub fallback)",
        description: "Internal: on-demand receipt check for the hub card's 'Check now' button, used if Realtime drops.",
        inputSchema: { orderAddress: z.string(), fiatAmount: z.number(), currency: z.string() },
        _meta: { ui: { resourceUri: RESOURCE_URI, visibility: ["app"] } },
    }, async (args) => {
        const result = await getReceiptByOrder(args);
        return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    });
}
