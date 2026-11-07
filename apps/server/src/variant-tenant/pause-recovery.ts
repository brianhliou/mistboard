import { logger } from '../obs.js';
import { listStalePausedTenantRoomIds } from '../persistence.js';
import { type TenantManagedRoom, variantTenantForRoomId } from './registry.js';

// Resolves true when it resumed the room, false when the room was not eligible.
type PauseRecovery = (
  room: TenantManagedRoom,
  at: number,
  staleAfterMs: number,
) => Promise<boolean>;

// The first sweep after a deploy can find a backlog (119 rooms in prod on
// 2026-10-31). A resumed PvE room with the engine on move starts a search, and
// the engine pools hold two searches with a short queue timeout, after which
// the bot resigns. Space the resumes; skipped rooms cost nothing.
export const TENANT_STALE_RESUME_SPACING_MS = 3_000;

// Each ws runtime binds its concrete tenant and writer here once. Dispatch
// stays type-erased, without forwarding another hook through every variant.
const recoveryByKind = new Map<string, PauseRecovery>();

export function registerTenantPauseRecovery(kind: string, recover: PauseRecovery): void {
  recoveryByKind.set(kind, recover);
}

export async function resumeStalePausedTenantRooms(
  now: Date,
  staleAfterMs: number,
  spacingMs: number = TENANT_STALE_RESUME_SPACING_MS,
): Promise<number> {
  let resumed = 0;
  for (const roomId of await listStalePausedTenantRoomIds(now, staleAfterMs)) {
    const registration = variantTenantForRoomId(roomId);
    if (!registration) continue;
    const recover = recoveryByKind.get(registration.kind);
    if (!recover) continue;
    try {
      const room = await registration.getOrLoadRoom(roomId);
      if (!room) continue;
      if (resumed > 0 && spacingMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, spacingMs).unref());
      }
      if (await recover(room, now.getTime(), staleAfterMs)) resumed += 1;
    } catch (err) {
      logger.error(
        { kind: 'stale_paused_tenant_resume_failure', room_id: roomId, err },
        'stale paused tenant room could not resume',
      );
    }
  }
  return resumed;
}
