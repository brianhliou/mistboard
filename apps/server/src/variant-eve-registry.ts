// The variants the EvE runner can play. Adding a ladder means adding a line
// here; variant-eve-registry.test.ts fails the build when a tenant offers
// playable engines without an adapter, so a new variant cannot ship a ladder
// that nothing can rate.

import { atomicXiangqiEveAdapter } from './atomic-xiangqi-eve-adapter.js';
import { duckXiangqiEveAdapter } from './duck-xiangqi-eve-adapter.js';
import { fortressXiangqiEveAdapter } from './fortress-xiangqi-eve-adapter.js';
import type { AnyVariantEveAdapter } from './variant-eve.js';
import { xiangqiEveAdapter } from './xiangqi-eve-adapter.js';

const VARIANT_EVE_ADAPTERS: readonly AnyVariantEveAdapter[] = [
  xiangqiEveAdapter,
  fortressXiangqiEveAdapter,
  duckXiangqiEveAdapter,
  atomicXiangqiEveAdapter,
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

/** EvE room id for a task: the tenant's live prefix plus `eve_`, so `xq_eve_<task>`. */
export function eveRoomId(adapter: AnyVariantEveAdapter, taskId: string): string {
  return `${adapter.tenant.roomIdPrefix}eve_${taskId}`;
}
