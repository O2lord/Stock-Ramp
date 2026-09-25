const APP_URL = process.env.NEXT_PUBLIC_APP_URL;
// Mirrors client/lib/paymentProcessors/config.ts's PROCESSORS — duplicated
// here rather than imported since mcp-server/ is a separate Node package
// outside client/'s TS project (same reasoning noted elsewhere in this repo
// for keeper/ vs client/ duplication).
const PROCESSORS = ["flutterwave", "korapay", "opay", "paystack"];
/**
 * Checks whether a wallet already has a saved, active processor credential
 * BEFORE offering to create an order via chat.
 *
 * The real client route is /api/payment-processors/{processor}/
 * {buyer,seller}-credentials/list?walletAddress=... (confirmed against
 * client/app/api/payment-processors/[processor]/{buyer,seller}-credentials/
 * list/route.ts) -- it takes one specific processor per call, there's no
 * "check all processors" route. This used to hit the stale
 * /api/flutterwave/{buyer,seller}-credentials/list path (a leftover from
 * before the [processor]-parameterized routes existed), which 404s.
 *
 * If `processor` isn't given, checks all four supported processors and
 * returns the first active credential found.
 */
export async function findActiveCredential(args) {
    if (!APP_URL) {
        throw new Error("NEXT_PUBLIC_APP_URL is not set -- needed to check saved credentials.");
    }
    const path = args.side === "buyer" ? "buyer-credentials" : "seller-credentials";
    const processorsToCheck = args.processor ? [args.processor] : PROCESSORS;
    for (const processor of processorsToCheck) {
        const url = new URL(`/api/payment-processors/${processor}/${path}/list`, APP_URL);
        url.searchParams.set("walletAddress", args.walletAddress);
        const res = await fetch(url.toString());
        if (!res.ok) {
            throw new Error(`Credential lookup failed for ${processor} (${res.status}) -- cannot safely offer order creation without this check.`);
        }
        const { credentials } = (await res.json());
        const active = credentials.find((c) => c.is_active);
        if (active)
            return { ...active, processor };
    }
    return null;
}
