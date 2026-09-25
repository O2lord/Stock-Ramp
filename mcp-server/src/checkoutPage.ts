import type { Request, Response } from "express";
import { getShortLink } from "./qrProxy.js";
import { qrDataUri } from "./solanaPay.js";

/**
 * Human-facing landing page for a short link — what "Copy pay/reservation
 * link" copies, NOT the raw solana: URI (pasting that into a browser does
 * nothing useful — no registered protocol handler). Same pattern as Trust
 * Vault's version, renamed.
 */
export async function renderCheckoutPage(req: Request, res: Response) {
  const target = getShortLink(String(req.params.id));
  if (!target) {
    res.status(404).send(renderExpiredPage());
    return;
  }

  const targetUrl = new URL(target);
  const fiatAmount = targetUrl.searchParams.get("fiatAmount");
  const currency = targetUrl.searchParams.get("currency");
  const solanaUri = `solana:${encodeURIComponent(target)}`;
  const qr = await qrDataUri(solanaUri);

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(renderCard({ fiatAmount, currency, qr, solanaUri }));
}

function renderCard(args: {
  fiatAmount: string | null;
  currency: string | null;
  qr: string;
  solanaUri: string;
}): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Pay with StockRamp</title>
<style>
  body { font-family: -apple-system, sans-serif; background:#0b0c0f; color:#f2f2f2;
         display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; }
  .card { max-width: 360px; padding: 24px; text-align:center; }
  .amount { font-size: 28px; font-weight: 700; margin-bottom: 16px; }
  img { width: 240px; height: 240px; border-radius: 12px; background:#fff; padding: 12px; }
  a.btn { display:block; margin-top:20px; padding:14px; border-radius:10px;
          background:#E8480A; color:#fff; text-decoration:none; font-weight:700; }
  button { margin-top:12px; padding:10px 14px; border-radius:10px; border:1px solid #333;
           background:#1a1b1f; color:#f2f2f2; cursor:pointer; width:100%; }
</style>
</head>
<body>
  <div class="card">
    ${args.fiatAmount ? `<div class="amount">${args.currency ?? ""}${args.fiatAmount}</div>` : ""}
    <img src="${args.qr}" alt="Scan to pay" />
    <a class="btn" href="${args.solanaUri}">Open in wallet</a>
    <button onclick="navigator.clipboard.writeText('${args.solanaUri}').then(()=>{this.textContent='Copied!'})">Copy raw payment link</button>
  </div>
  <script>
    if (/Android|iPhone/i.test(navigator.userAgent)) {
      window.location.href = "${args.solanaUri}";
    }
    const isDesktop = !/Android|iPhone|iPad/i.test(navigator.userAgent);
    if (isDesktop) {
      const hint = document.createElement('p');
      hint.style.cssText = 'color:#9a9ba3;font-size:13px;margin-top:12px;';
      hint.textContent = "On desktop, scan the QR above with your phone's wallet app — the button below may not do anything here.";
      document.querySelector('.card').insertBefore(hint, document.querySelector('.btn'));
    }
  </script>
</body>
</html>`;
}

function renderExpiredPage(): string {
  return `<!doctype html>
<html><head><meta charset="utf-8" /><title>Link expired</title>
<style>body{font-family:-apple-system,sans-serif;background:#0b0c0f;color:#f2f2f2;
display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center;}</style>
</head><body><div><h1>This payment link has expired.</h1>
<p>Ask for a new QR code.</p></div></body></html>`;
}
