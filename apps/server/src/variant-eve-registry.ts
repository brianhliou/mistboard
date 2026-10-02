// The variants the EvE runner can play. Adding a ladder means adding a line
// here; variant-eve-registry.test.ts fails the build when a tenant offers
// playable engines without an adapter, so a new variant cannot ship a ladder
// that nothing can rate.

import { atomicXiangqiEveAdapter } from './atomic-xiangqi-eve-adapter.js';
import { banqiEveAdapter } from './banqi-eve-adapter.js';
import { crazyhouseXiangqiEveAdapter } from './crazyhouse-xiangqi-eve-adapter.js';
import { duckXiangqiEveAdapter } from './duck-xiangqi-eve-adapter.js';
import { fortressXiangqiEveAdapter } from './fortress-xiangqi-eve-adapter.js';
import { jieqiEveAdapter } from './jieqi-eve-adapter.js';
import { jungleEveAdapter } from './jungle-eve-adapter.js';
import type { AnyVariantEveAdapter } from './variant-eve.js';
import { xiangqiEveAdapter } from './xiangqi-eve-adapter.js';

const VARIANT_EVE_ADAPTERS: readonly AnyVariantEveAdapter[] = [
  xiangqiEveAdapter,
  fortressXiangqiEveAdapter,
  duckXiangqiEveAdapter,
  atomicXiangqiEveAdapter,
  crazyhouseXiangqiEveAdapter,
  jieqiEveAdapter,
  // Data-only (#488): no random floor, so they play scheduled games but are
  // never ladder-rated.
  banqiEveAdapter,
  jungleEveAdapter,
];

const BY_VARIANT: ReadonlyMap<string, AnyVariantEveAdapter> = new Map(
  VARIANT_EVE_ADAPTERS.map((adapter) => [adapter.gameSpecId, adapter]),
);

export const EVE_VARIANT_IDS: readonly string[] = VARIANT_EVE_ADAPTERS.map(
  (adapter) => adapter.gameSpecId,
);

export function eveAdapterFor(variant: string | undefined): AnyVariantEveAdapter | null {
  if (!variant) return null;
  return BY_VARIANT.get(variant) ?? null;
}

/**
 * The capabilities an engine worker advertises for the variants whose engine is
 * a binary it may lack: `{ banqi_engine: true, jungle_engine: false, ... }`,
 * probed on this box. A task requiring a capability the worker reports false
 * (or does not report) is never claimed, so it waits instead of failing.
 */
export function eveWorkerCapabilities(): Record<string, boolean> {
  const capabilities: Record<string, boolean> = {};
  for (const adapter of VARIANT_EVE_ADAPTERS) {
    if (!adapter.requiredCapability) continue;
    capabilities[adapter.requiredCapability] = adapter.available?.() ?? false;
  }
  return capabilities;
}

/** EvE room id for a task: the tenant's live prefix plus `eve_`, so `xq_eve_<task>`. */
export function eveRoomId(adapter: AnyVariantEveAdapter, taskId: string): string {
  return `${adapter.tenant.roomIdPrefix}eve_${taskId}`;
}
