// client/components/StockRamp/Shared/Filter.tsx
// Order-list filtering bar shared by BuyOrderGrid.tsx / SellOrderGrid.tsx.
// Mirrors trust_vault's `Shared/Filter.tsx`, adapted to stock-ramp's actual
// filter axes: escrow type is implicit (this component is mounted once per
// grid), so the controls here are mint, currency, and "mine only".
//
// NOTE: the search icon was hardcoded to text-[#0F0D0A]/40 (near-black),
// invisible against the dark theme's near-black background — swapped to
// `text-foreground/40`.

"use client";

import * as React from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/react-select";
import { XSTOCKS_MINTS } from "@/lib/constant";

export interface FilterState {
  /** Free-text match against mint symbol or address. */
  search: string;
  /** Symbol key into XSTOCKS_MINTS, or "" for all. */
  symbol: string;
  /** 3-letter currency code, or "" for all. */
  currency: string;
  /** Only orders made by the connected wallet. */
  mineOnly: boolean;
}

export const DEFAULT_FILTER_STATE: FilterState = {
  search: "",
  symbol: "",
  currency: "",
  mineOnly: false,
};

interface FilterProps {
  value: FilterState;
  onChange: (next: FilterState) => void;
  /** Currencies actually present in the current order set, for the dropdown. */
  availableCurrencies?: string[];
  /** Hide the "mine only" toggle (e.g. on a public marketplace page). */
  showMineOnly?: boolean;
  className?: string;
}

export function Filter({
  value,
  onChange,
  availableCurrencies = [],
  showMineOnly = true,
  className,
}: FilterProps) {
  const symbols = Object.keys(XSTOCKS_MINTS);
  const hasActiveFilters = value.search || value.symbol || value.currency || value.mineOnly;

  function patch(partial: Partial<FilterState>) {
    onChange({ ...value, ...partial });
  }

  return (
    <div className={`flex flex-wrap items-center gap-3 ${className ?? ""}`}>
      <div className="relative flex-1 min-w-[180px]">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground/40" />
        <Input
          placeholder="Search by mint or symbol"
          value={value.search}
          onChange={(e) => patch({ search: e.target.value })}
          className="pl-9"
        />
      </div>

      <Select value={value.symbol || "all"} onValueChange={(v) => patch({ symbol: v === "all" ? "" : v })}>
        <SelectTrigger className="w-[140px]">
          <SelectValue placeholder="Any stock" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Any stock</SelectItem>
          {symbols.length === 0 ? (
            <SelectItem value="_none" disabled>
              No mints configured
            </SelectItem>
          ) : (
            symbols.map((symbol) => (
              <SelectItem key={symbol} value={symbol}>
                {symbol}
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>

      <Select value={value.currency || "all"} onValueChange={(v) => patch({ currency: v === "all" ? "" : v })}>
        <SelectTrigger className="w-[120px]">
          <SelectValue placeholder="Any currency" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Any currency</SelectItem>
          {availableCurrencies.map((currency) => (
            <SelectItem key={currency} value={currency}>
              {currency}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {showMineOnly && (
        <Button
          type="button"
          variant={value.mineOnly ? "default" : "outline"}
          size="sm"
          onClick={() => patch({ mineOnly: !value.mineOnly })}
        >
          My orders
        </Button>
      )}

      {hasActiveFilters && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onChange(DEFAULT_FILTER_STATE)}
          className="gap-1"
        >
          <X className="h-3.5 w-3.5" />
          Clear
        </Button>
      )}
    </div>
  );
}
