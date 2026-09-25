// client/lib/utils.ts
// Standard shadcn/ui class-merge helper. Nearly every component in
// `client/components/ui/*` imports `cn` from "@/lib/utils" — this file is a
// hard dependency for the whole ui/ folder to compile.

import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merges Tailwind class lists, resolving conflicting utility classes
 * (e.g. `cn("px-2", condition && "px-4")` → `"px-4"` when `condition` is true)
 * the way the last-applied class should win, instead of both being emitted.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
