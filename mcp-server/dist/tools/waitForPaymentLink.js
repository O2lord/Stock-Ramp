import { getPaymentLink } from "./paymentLinkLookup.js";
/**
 * The discord bot generates the actual payment link asynchronously after
 * picking up the on-chain reservation event (resolve credential -> call
 * processor API -> store in payment_links) -- not available the instant
 * reserve_sell_order's transaction confirms. 30s window covers that
 * pipeline with margin.
 */
export async function waitForPaymentLink(args) {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
        const link = await getPaymentLink(args.payoutReference);
        if (link)
            return { found: true, ...link };
        await new Promise((r) => setTimeout(r, 3000));
    }
    return {
        found: false,
        message: "Payment link isn't ready yet -- ask again in a moment. The reservation itself " +
            "already landed on-chain; this is just waiting on the link-generation step.",
    };
}
