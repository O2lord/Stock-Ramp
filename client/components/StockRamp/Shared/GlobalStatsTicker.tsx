// client/components/StockRamp/Shared/GlobalStatsTicker.tsx
// Full-width stats header, rendered full-bleed directly under the persistent
// Navbar (see app/stocks/page.tsx — mounted as a sibling BEFORE the padded
// container, not inside it).
//
// Two parts:
//   1. LiveTicker — a scrolling price bar with a pinned "N CREATED" badge on
//      the left and a marquee-animated track of one chip per xStocks symbol,
//      each with an up/down triangle and percentage.
//   2. StatsStrip — a static row underneath showing active orders and total
//      volume.
//
// THEME: this file used to set every color as an inline hex style
// (`background: "#0F0D0A"`, `color: "#F5F0E8"`, `#666`, and a hardcoded
// `bg-[#EDE8DF]` on the stats strip). That's why the strip rendered as a
// cream band across an otherwise dark page. It now uses the theme tokens
// from app/globals.css throughout — including `text-up` / `text-down` for
// price direction, which are deliberately separate from `primary`: the
// orange means "action", and a falling price is not an action.
//
// The edge fade gradients are the one place a color value still appears
// inline, because a gradient needs a concrete stop — they're built from
// `hsl(var(--background))` so they still track the theme.
//
// PERCENT CHANGE: the xStocks `/public/assets/{symbol}/price-data` endpoint
// only returns a raw `quote` — there's no previous-close or day-change
// field to read. So the % here is computed client-side against a per-symbol
// BASELINE: the first price observed for that symbol after this component
// mounts (captured once, never reset). It is not "since market open" or
// "24h". That's why the number is 0.0% right after a page load — there's no
// drift to show yet.
//
// Price data comes from useXStockPricesProxied (hooks/useXStockPrices.ts),
// server-proxied and polled every 15s. Stat numbers come from useGlobalState.

"use client";

import * as React from "react";
import { XSTOCKS_MINTS } from "@/lib/constant";
import { useXStockPricesProxied } from "@/hooks/useXStockPrices";
import { useGlobalState } from "@/hooks/queries/useGlobalState";

const SYMBOLS = Object.keys(XSTOCKS_MINTS).filter(Boolean);

function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toString();
}

export function GlobalStatsTicker() {
  const { data: globalState, isLoading: globalLoading } = useGlobalState();
  const { data: prices, isLoading: pricesLoading } = useXStockPricesProxied(SYMBOLS);

  const baselinePricesRef = React.useRef<Record<string, number>>({});

  if (prices) {
    for (const [symbol, price] of Object.entries(prices)) {
      if (!(symbol in baselinePricesRef.current)) {
        baselinePricesRef.current[symbol] = price;
      }
    }
  }

  const totalVolume = globalState?.totalVolume?.toNumber?.() ?? 0;
  const totalCreated = globalState?.totalStockRampCreated?.toNumber?.() ?? 0;
  const totalClosed = globalState?.totalStockRampClosed?.toNumber?.() ?? 0;
  const activeOrders = Math.max(totalCreated - totalClosed, 0);

  const priceChips = SYMBOLS.map((symbol) => {
    const price = prices?.[symbol];
    const baseline = baselinePricesRef.current[symbol];
    const pctChange =
      price != null && baseline != null && baseline > 0 ? ((price - baseline) / baseline) * 100 : null;
    return { symbol, price, pctChange };
  }).filter((item) => item.price != null);

  return (
    <div className="w-full">
      <LiveTicker
        totalCreated={globalLoading ? null : totalCreated}
        priceChips={priceChips}
        pricesLoading={pricesLoading}
      />
      <StatsStrip activeOrders={activeOrders} totalVolume={totalVolume} loading={globalLoading} />
    </div>
  );
}

// ─── Live ticker: pinned "N CREATED" badge + scrolling price track ────────
function LiveTicker({
  totalCreated,
  priceChips,
  pricesLoading,
}: {
  totalCreated: number | null;
  priceChips: { symbol: string; price: number | undefined; pctChange: number | null }[];
  pricesLoading: boolean;
}) {
  return (
    <div className="relative w-full overflow-hidden border-b border-primary/20 bg-surface-1">
      {/* Pinned created-count badge */}
      <div className="absolute inset-y-0 left-0 z-20 flex items-center gap-1.5 border-r border-primary/20 bg-surface-1 px-4">
        <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary tabular">
          {totalCreated == null ? "…" : totalCreated}
        </span>
        <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          Created
        </span>
      </div>

      {/* Edge fades — left one wider to clear the pinned badge */}
      <div
        className="pointer-events-none absolute inset-y-0 left-0 z-10 w-[120px]"
        style={{ background: "linear-gradient(90deg, hsl(var(--surface-1)) 62%, transparent)" }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16"
        style={{ background: "linear-gradient(270deg, hsl(var(--surface-1)), transparent)" }}
        aria-hidden
      />

      <div className="pl-[110px]">
        <div className="flex w-max animate-marquee hover:[animation-play-state:paused]">
          <PriceTrack priceChips={priceChips} pricesLoading={pricesLoading} />
          <PriceTrack priceChips={priceChips} pricesLoading={pricesLoading} aria-hidden />
        </div>
      </div>
    </div>
  );
}

function PriceTrack({
  priceChips,
  pricesLoading,
  ...rest
}: {
  priceChips: { symbol: string; price: number | undefined; pctChange: number | null }[];
  pricesLoading: boolean;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className="flex items-center py-2.5" {...rest}>
      {priceChips.length > 0 ? (
        priceChips.map(({ symbol, price, pctChange }, i) => (
          <div
            key={`${symbol}-${i}`}
            className="flex items-center gap-2 whitespace-nowrap border-r border-border px-8"
          >
            <span className="text-[10.5px] font-bold uppercase tracking-[0.13em] text-muted-foreground">
              {symbol}
            </span>
            <span className="text-[13px] font-bold text-foreground tabular">
              ${price!.toFixed(2)}
            </span>
            <PctChange value={pctChange} />
          </div>
        ))
      ) : (
        <div className="whitespace-nowrap px-8 text-xs text-muted-foreground">
          {pricesLoading ? "Fetching live prices…" : "No live prices available."}
        </div>
      )}
    </div>
  );
}

function PctChange({ value }: { value: number | null }) {
  if (value == null) {
    return <span className="text-xs font-bold text-muted-foreground">—</span>;
  }
  const isFlat = value === 0;
  const isUp = value > 0;
  const tone = isFlat ? "text-muted-foreground" : isUp ? "text-up" : "text-down";

  return (
    <span className={`flex items-center gap-1 text-[13px] font-bold tabular ${tone}`}>
      {!isFlat && (
        <svg
          width="9"
          height="9"
          viewBox="0 0 10 10"
          aria-hidden
          style={{ transform: isUp ? "none" : "rotate(180deg)" }}
        >
          <path d="M5 0L10 10H0L5 0Z" fill="currentColor" />
        </svg>
      )}
      {Math.abs(value).toFixed(1)}%
    </span>
  );
}

// ─── Static stats strip — permanently visible, never scrolls ──────────────
function StatsStrip({
  activeOrders,
  totalVolume,
  loading,
}: {
  activeOrders: number;
  totalVolume: number;
  loading: boolean;
}) {
  const stats = [
    { label: "Active orders", value: loading ? "—" : activeOrders.toString() },
    { label: "Total volume", value: loading ? "—" : formatCount(totalVolume) },
  ];

  return (
    <div className="flex w-full items-center justify-center gap-10 border-b border-border bg-background py-3 text-center">
      {stats.map((s) => (
        <div key={s.label} className="flex items-center gap-2.5">
          <span className="text-[10.5px] font-bold uppercase tracking-[0.15em] text-muted-foreground">
            {s.label}
          </span>
          <span className="text-[13px] font-bold text-foreground tabular">{s.value}</span>
        </div>
      ))}
    </div>
  );
}
