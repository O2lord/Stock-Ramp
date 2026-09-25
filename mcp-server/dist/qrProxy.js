const shortLinks = new Map();
export const SHORT_LINK_TTL_MS = 5 * 60 * 1000;
export function registerShortLink(targetUrl) {
    const id = Math.random().toString(36).slice(2, 10);
    shortLinks.set(id, targetUrl);
    setTimeout(() => shortLinks.delete(id), SHORT_LINK_TTL_MS).unref();
    return id;
}
export function getShortLink(id) {
    return shortLinks.get(id);
}
export async function proxyQr(req, res) {
    const target = getShortLink(String(req.params.id));
    if (!target)
        return res.status(404).json({ error: "Unknown or expired QR" });
    const upstream = await fetch(target, {
        method: req.method,
        headers: { "Content-Type": "application/json" },
        body: req.method === "POST" ? JSON.stringify(req.body) : undefined,
    });
    res.status(upstream.status).json(await upstream.json());
}
