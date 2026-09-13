import type { GameSpecId } from '@mistboard/game';
import { isGameSpecId } from '@mistboard/game';
import { webVariantTenantForRoomId } from './variant-tenant/registry.js';

export function gameSpecIdForRoomBootstrap(
  roomId: string,
  requested: string | null,
): GameSpecId | null {
  // Only tenants riding the chess live shell resolve here; tenants with their
  // own client are routed before the shell ever boots.
  const tenant = webVariantTenantForRoomId(roomId);
  if (tenant && !tenant.loadLiveRoomClient) return tenant.gameSpecId;
  return isGameSpecId(requested) ? requested : null;
}
