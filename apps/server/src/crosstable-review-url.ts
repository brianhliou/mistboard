// The review URL for a finished room, split out of crosstable.ts so modules
// on the persistence side (persistence-lobby-activity.ts) can use it without
// importing crosstable.ts, which imports routes/lib.ts and from there
// account-session.ts and persistence.ts: a cycle the dependency check refuses.
import { DARK_CHESS_SPEC_ID } from '@mistboard/game';
import {
  type VariantTenantRegistration,
  variantTenantForRoomId,
  variantTenantForSpecId,
} from './variant-tenant/registry.js';

export type CrosstableTenantLookup = {
  forRoomId: (roomId: string) => Pick<VariantTenantRegistration, 'export'> | null;
  forSpecId: (gameSpecId: string) => Pick<VariantTenantRegistration, 'export'> | null;
};

export const REGISTRY_LOOKUP: CrosstableTenantLookup = {
  forRoomId: variantTenantForRoomId,
  forSpecId: variantTenantForSpecId,
};

const CHESS_STACK_VARIANTS: ReadonlySet<string> = new Set([DARK_CHESS_SPEC_ID, 'fog']);

export function crosstableReviewUrl(
  roomId: string,
  variant: string,
  lookup: CrosstableTenantLookup = REGISTRY_LOOKUP,
): string | null {
  const routeBase =
    lookup.forRoomId(roomId)?.export?.gameRouteBase ??
    lookup.forSpecId(variant)?.export?.gameRouteBase ??
    null;
  if (routeBase) return `${routeBase}/${encodeURIComponent(roomId)}`;
  if (CHESS_STACK_VARIANTS.has(variant)) return `/game/${encodeURIComponent(roomId)}`;
  return null;
}
