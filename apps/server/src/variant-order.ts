// Variant order for the homepage play panel (GET /api/play/variant-order):
// game spec ids ordered by counted human games (pvp + pve, the shared
// persistence-counted-games.ts filter) that ended in the trailing 28 days,
// most first, ties broken by the canonical shelf order.
//
// Every shelf spec is in the list, played or not, so the client gets a
// complete order; a known, non-retired spec off the shelf appears only when it
// had counted games. Unknown and retired ids in `games.variant` are dropped.
//
// The read is a GROUP BY over the window, cheap but pointless to repeat per
// homepage view: the result is cached in memory for six hours. Without a
// database (the in-memory dev pair) the order is empty and the client keeps
// its own.

import {
  CANONICAL_VARIANT_ORDER,
  canonicalVariantOrderIndex,
  type GameSpecId,
  isGameSpecId,
  isRetiredGameSpec,
} from '@mistboard/game';
import * as persistence from './persistence.js';

export const VARIANT_ORDER_WINDOW_DAYS = 28;
export const VARIANT_ORDER_CACHE_MS = 6 * 60 * 60 * 1000;

export interface VariantOrderResponse {
  order: string[];
  windowDays: typeof VARIANT_ORDER_WINDOW_DAYS;
  computedAt: string;
}

export function rankVariants(counts: ReadonlyArray<{ variant: string; count: number }>): string[] {
  const byId = new Map<GameSpecId, number>();
  for (const id of CANONICAL_VARIANT_ORDER) byId.set(id, 0);
  for (const { variant, count } of counts) {
    if (!isGameSpecId(variant) || isRetiredGameSpec(variant)) continue;
    byId.set(variant, (byId.get(variant) ?? 0) + count);
  }
  return [...byId.entries()]
    .filter(([id, count]) => count > 0 || CANONICAL_VARIANT_ORDER.includes(id))
    .sort(
      ([a, countA], [b, countB]) =>
        countB - countA ||
        canonicalVariantOrderIndex(a) - canonicalVariantOrderIndex(b) ||
        a.localeCompare(b),
    )
    .map(([id]) => id);
}

let cached: { value: VariantOrderResponse; at: number } | null = null;

export function clearVariantOrderCache(): void {
  cached = null;
}

export async function getVariantOrder(nowMs: number = Date.now()): Promise<VariantOrderResponse> {
  if (!persistence.isInitialized()) {
    return {
      order: [],
      windowDays: VARIANT_ORDER_WINDOW_DAYS,
      computedAt: new Date(nowMs).toISOString(),
    };
  }
  if (cached && nowMs - cached.at < VARIANT_ORDER_CACHE_MS) return cached.value;
  const counts = await persistence.getRecentCountedGamesByVariant(VARIANT_ORDER_WINDOW_DAYS, {
    now: new Date(nowMs),
  });
  const value: VariantOrderResponse = {
    order: rankVariants(counts),
    windowDays: VARIANT_ORDER_WINDOW_DAYS,
    computedAt: new Date(nowMs).toISOString(),
  };
  cached = { value, at: nowMs };
  return value;
}
