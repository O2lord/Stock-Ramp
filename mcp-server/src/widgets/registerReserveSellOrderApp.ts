// src/widgets/registerReserveSellOrderApp.ts
// Buying tokenized stock WITH fiat — ported from Trust Vault's version,
// renamed brand/URIs only.
//
// NOTE: the `reserve_sell_order` handler below was the one spot in this
// file missing an explicit `args` type (every other handler here has one)
// — harmless once `@modelcontextprotocol/ext-apps` resolves properly, but
// added for consistency with the rest of the file.
//
// RESOURCE URI VERSIONING: bumped v1 -> v2 when the settled-state summary
// view was added to reserveSellOrderCard.html, and v2 -> v3 when the
// token label started reading data.symbol instead of a bare "token(s)".
// MCP App hosts are entitled to cache a ui:// resource's content by its
// URI indefinitely, so an unchanged URI can keep serving an old cached
// copy of the widget no matter how many times the server is
// rebuilt/restarted or the connector reconnected -- only a new URI forces
// a refetch.
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { reserveSellOrder } from "../tools/reserveSellOrder.js";
import { getPaymentLink } from "../tools/paymentLinkLookup.js";
import { getReceiptByOrder } from "../tools/receiptByOrder.js";
import { findSignerByReference } from "../solanaPay.js";

const RESOURCE_URI = "ui://stock-ramp/reserve-sell-order-card-v3";
const WIDGET_HTML_PATH = path.join(import.meta.dirname, "reserveSellOrderCard.html");

const RESOURCE_DOMAINS = ["https://cdn.jsdelivr.net"];
const CONNECT_DOMAINS = [
  "https://cdn.jsdelivr.net",
  ...(process.env.SUPABASE_URL ? [process.env.SUPABASE_URL] : []),
  ...(process.env.SUPABASE_URL ? [process.env.SUPABASE_URL.replace(/^https:/, "wss:")] : []),
];

export function registerReserveSellOrderApp(server: McpServer) {
  registerAppResource(
    server,
    "Reserve Sell Order Card",
    RESOURCE_URI,
    {
      description:
        "Live reservation QR card for buying a tokenized stock from a SELL order -- scan to " +
        "reserve, auto-updates through payment link and receipt.",
    },
    async () => ({
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
    })
  );

  registerAppTool(
    server,
    "reserve_sell_order",
    {
      title: "Reserve against a SELL order (buy tokens)",
      description:
        "For buying tokenized stock from an open SELL order. Renders a live reservation card " +
        "with a QR code -- no wallet address needed as input. Auto-updates from 'scan to reserve' " +
        "through 'payment link ready' to 'paid, receipt available'.",
      inputSchema: {
        orderAddress: z.string().describe("Full base58 PDA of the SELL order, from list_open_orders"),
        amount: z.number().describe("Amount of tokens to buy, in display units"),
      },
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async (args: { orderAddress: string; amount: number }) => {
      const result = await reserveSellOrder(args);
      return {
        content: [
          {
            type: "text",
            // result.symbol comes from reserveSellOrder.ts's mint->ticker
            // resolution -- falls back to the generic "tokens" only on a
            // lookup miss, same fallback the card itself uses.
            //
            // checkoutPageUrl included here too -- voice sessions have no
            // surface to render the ui:// card on, so content[].text is
            // the only thing that reaches the person in that mode. Without
            // a link here, "scan to sign" pointed at a card that would
            // never appear, with no way to recover (see the matching fix
            // and full reasoning in registerReserveBuyOrderApp.ts).
            // checkoutPageUrl (not transactionRequestUrl) is the one to
            // speak -- it's a plain https link with the same QR plus an
            // "Open in wallet" button; the raw solana: URI has no
            // protocol handler when opened directly in a browser.
            text: `Reservation card ready: ${args.amount} ${result.symbol ?? "tokens"} against order ${args.orderAddress}. ` +
              `Scan to sign, or if the card doesn't show up, open this link on your phone to pay: ${result.checkoutPageUrl}`,
          },
        ],
        structuredContent: result,
      };
    }
  );

  registerAppTool(
    server,
    "get_reservation_payment_link",
    {
      title: "Get reservation payment link (single check)",
      description: "Internal: single non-blocking lookup used by the card's own poll loop.",
      inputSchema: { payoutReference: z.string() },
      _meta: { ui: { resourceUri: RESOURCE_URI, visibility: ["app"] } },
    },
    async (args: { payoutReference: string }) => {
      const link = await getPaymentLink(args.payoutReference);
      const result = link ? { found: true as const, ...link } : { found: false as const };
      return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    }
  );

  registerAppTool(
    server,
    "get_reservation_receipt",
    {
      title: "Get reservation receipt (manual fallback)",
      description: "Internal: on-demand fallback receipt check, used only if Realtime drops.",
      inputSchema: {
        orderAddress: z.string(),
        fiatAmount: z.number(),
        currency: z.string(),
        signerAddress: z.string().optional(),
      },
      _meta: { ui: { resourceUri: RESOURCE_URI, visibility: ["app"] } },
    },
    async (args: { orderAddress: string; fiatAmount: number; currency: string; signerAddress?: string }) => {
      const result = await getReceiptByOrder(args);
      return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    }
  );

  registerAppTool(
    server,
    "resolve_reserve_sell_order_signer",
    {
      title: "Resolve who signed a reservation",
      description: "Internal: looks up the actual wallet that signed a reservation transaction.",
      inputSchema: { reference: z.string() },
      _meta: { ui: { resourceUri: RESOURCE_URI, visibility: ["app"] } },
    },
    async (args: { reference: string }) => {
      const signer = await findSignerByReference(args.reference);
      return { content: [{ type: "text", text: JSON.stringify({ signer }) }], structuredContent: { signer } };
    }
  );
}
