// client/app/page.tsx
// Root landing page, restyled onto the "Terminal" theme (option C from
// client/public/design-preview.html).
//
// Two things changed structurally from the previous pass, both because they
// broke in dark mode rather than for taste:
//
//   1. The "How it works" header used `bg-foreground` + `text-background`.
//      In dark mode that inverts to a cream bar with black text — the light
//      band visible in the old screenshots. It's now a normal surface with
//      a hairline rule, so the section reads as part of the page.
//   2. `border-2 border-foreground` around the panel became a near-white
//      2px box in dark mode. Hairline `border-border` instead — at 2px
//      radii the structure comes from the rules, not from heavy outlines.
//
// The hero drops the italic subtitle (italic + uppercase display is a
// mismatch) and picks up tighter tracking, which is what makes the Terminal
// direction read as deliberate rather than just dark.

"use client";

import Link from "next/link";
import { ArrowRight, ShieldCheck, Zap, Vote } from "lucide-react";
import { Button } from "@/components/ui/button";

const HOW_IT_WORKS = [
  {
    n: "01",
    title: "Find a rate",
    desc: "Browse live buy and sell orders for xStocks — tokenized equities — priced in your local currency by makers.",
  },
  {
    n: "02",
    title: "Reserve instantly",
    desc: "Lock in an amount against an order's escrow. No waiting for a counterparty to show up — the liquidity is already there.",
  },
  {
    n: "03",
    title: "Validator-confirmed payout",
    desc: "A rotating set of registered validators confirm off-chain payment before funds release, so neither side has to trust the other.",
  },
];

const TRUST = [
  {
    icon: ShieldCheck,
    title: "Escrow-backed",
    desc: "Tokens sit in a program-owned escrow, not with a counterparty, until a reservation is resolved.",
  },
  {
    icon: Vote,
    title: "Validator consensus",
    desc: "Payment confirmations require votes from registered validators before any payout executes on-chain.",
  },
  {
    icon: Zap,
    title: "Instant reservations",
    desc: "No matching wait — reserve directly against an existing order's escrowed liquidity.",
  },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-background">
      <div className="h-px w-full bg-primary" />

      {/* Hero */}
      <section className="container mx-auto px-4 py-20 text-center md:py-28">
        <div className="mx-auto max-w-3xl space-y-6">
          <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary">
            Tokenized equities · Solana
          </div>
          <h1 className="text-5xl font-extrabold uppercase leading-[0.95] tracking-[-0.04em] text-foreground sm:text-6xl md:text-7xl">
            Stock Ramp
          </h1>
          <p className="mx-auto max-w-xl text-base leading-relaxed text-muted-foreground">
            Peer-to-peer on-ramp and off-ramp for xStocks, settled directly in local
            currency. No centralized broker required.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-4">
            <Button asChild size="lg" className="gap-2">
              <Link href="/stocks">
                Get started
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/stocks/providers">Browse providers</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="container mx-auto px-4 pb-16">
        <div className="overflow-hidden rounded-lg border border-border bg-surface-1">
          <div className="flex items-center gap-2.5 border-b border-border px-6 py-3.5">
            <Zap className="h-3.5 w-3.5 text-primary" />
            <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
              How it works
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3">
            {HOW_IT_WORKS.map((step, i) => (
              <div
                key={step.n}
                className={`px-6 py-7 ${
                  i < 2 ? "border-b border-border md:border-b-0 md:border-r" : ""
                }`}
              >
                <div className="text-[11px] font-bold tracking-[0.18em] text-primary">
                  {step.n}
                </div>
                <div className="mb-2 mt-3 text-sm font-semibold tracking-tight text-foreground">
                  {step.title}
                </div>
                <p className="text-[13px] leading-relaxed text-muted-foreground">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Trust signals */}
      <section className="container mx-auto px-4 pb-24">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {TRUST.map(({ icon: Icon, title, desc }) => (
            <div
              key={title}
              className="flex items-start gap-3 rounded-lg border border-border bg-surface-1 p-5 transition-colors hover:border-border-strong"
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div>
                <div className="text-sm font-semibold text-foreground">{title}</div>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
