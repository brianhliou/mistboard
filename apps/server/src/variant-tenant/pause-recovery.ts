import { logger } from '../obs.js';
import { listStalePausedTenantRoomIds } from '../persistence.js';
import { type TenantManagedRoom, variantTenantForRoomId } from './registry.js';

type PauseRecovery = (room: TenantManagedRoom, at: number, staleAfterMs: number) => Promise<void>;

// Each ws runtime binds its concrete tenant and writer here once. Dispatch
// stays type-erased, without forwarding another hook through every variant.
const recoveryByKind = new Map<string, PauseRecovery>();

export function registerTenantPauseRecovery(kind: string, recover: PauseRecovery): void {
  recoveryByKind.set(kind, recover);
}

export async function resumeStalePausedTenantRooms(now: Date, staleAfterMs: number): Promise<void> {
  for (const roomId of await listStalePausedTenantRoomIds(now, staleAfterMs)) {
    const registration = variantTenantForRoomId(roomId);
    if (!registration) continue;
    const recover = recoveryByKind.get(registration.kind);
    if (!recover) continue;
    try {
      const room = await registration.getOrLoadRoom(roomId);
      if (room) await recover(room, now.getTime(), staleAfterMs);
    } catch (err) {
      logger.error(
        { kind: 'stale_paused_tenant_resume_failure', room_id: roomId, err },
        'stale paused tenant room could not resume',
      );
    }
  }
}
