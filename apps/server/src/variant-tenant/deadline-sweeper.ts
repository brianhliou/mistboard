/**
 * Interval sweeper for durable correspondence deadlines. Lists due
 * room_deadlines rows and routes each to its tenant registration's
 * sweepDueDeadline closure, which re-derives the deadline from the hydrated
 * room before acting — so a stale or orphaned row can never flag a game
 * early. Single-instance deployment today; take a per-room advisory lock
 * here before scaling the web service out.
 */

import { sweepDeadlineWarnings } from '../correspondence-deadline-warning.js';
import { sweepCorrespondenceTurnDigests } from '../correspondence-turn-digest.js';
import { logger } from '../obs.js';
import * as persistence from '../persistence.js';
import { variantTenantForRoomId } from './registry.js';

export const DEADLINE_SWEEP_INTERVAL_MS = 60_000;

export type TenantDeadlineSweeperOptions = {
  intervalMs?: number;
  isPersistenceInitialized?: () => boolean;
  listDue?: (now: Date) => Promise<Array<{ roomId: string; gameSpecId: string }>>;
  now?: () => number;
  registrationFor?: typeof variantTenantForRoomId;
  // Deadline-warning pass, run after the due pass each tick. Injectable so
  // tests can assert it fires without sending real email; defaults to the real
  // correspondence warning sweep.
  warnDeadlines?: (now: Date) => Promise<void>;
  // Daily "your move" digest pass (correspondence-turn-digest.ts): runs every
  // tick, sends at most once per account per digest day. Injectable for tests.
  digestTurns?: (now: Date) => Promise<void>;
  // Expired-challenge reclaim pass: drops lapsed correspondence challenges
  // (private seeks past their TTL). Injectable for tests; defaults to the real
  // delete. Returns the count removed.
  sweepExpiredSeeks?: (now: Date) => Promise<number>;
};

export type TenantDeadlineSweeper = {
  stop(): void;
  // Exposed for tests and for a future admin trigger; the interval calls it.
  tick(): Promise<void>;
};

export function startTenantDeadlineSweeper(
  options: TenantDeadlineSweeperOptions = {},
): TenantDeadlineSweeper {
  const intervalMs = options.intervalMs ?? DEADLINE_SWEEP_INTERVAL_MS;
  const isInitialized = options.isPersistenceInitialized ?? persistence.isInitialized;
  const listDue = options.listDue ?? ((now: Date) => persistence.listDueRoomDeadlines(now));
  const now = options.now ?? Date.now;
  const registrationFor = options.registrationFor ?? variantTenantForRoomId;
  const warnDeadlines = options.warnDeadlines ?? ((at: Date) => sweepDeadlineWarnings(at));
  const digestTurns = options.digestTurns ?? ((at: Date) => sweepCorrespondenceTurnDigests(at));
  const sweepExpiredSeeks =
    options.sweepExpiredSeeks ?? ((at: Date) => persistence.deleteExpiredCorrespondenceSeeks(at));

  async function tick(): Promise<void> {
    if (!isInitialized()) return;
    let due: Array<{ roomId: string; gameSpecId: string }>;
    try {
      due = await listDue(new Date(now()));
    } catch (err) {
      logger.error(
        { kind: 'deadline_sweep_list_failure', error: (err as Error).message, at: now() },
        'deadline sweep list failure',
      );
      return;
    }
    for (const row of due) {
      const registration = registrationFor(row.roomId);
      if (!registration?.sweepDueDeadline) {
        // An orphaned row (no registration claims the prefix, or the tenant
        // has no correspondence capability). Kept, not deleted: the row is
        // the only durable signal that enforcement is owed, and deleting it
        // would silently disarm the game if the registration is back after
        // a rollback. The log is the alarm.
        logger.error(
          {
            kind: 'deadline_sweep_orphan_row',
            room_id: row.roomId,
            game_spec_id: row.gameSpecId,
            at: now(),
          },
          'deadline sweep found a due row no registration claims',
        );
        continue;
      }
      try {
        await registration.sweepDueDeadline(row.roomId);
      } catch (err) {
        logger.error(
          {
            kind: 'deadline_sweep_room_failure',
            room_id: row.roomId,
            error: (err as Error).message,
            at: now(),
          },
          'deadline sweep room failure',
        );
      }
    }
    // Deadline-warning pass: same row source, run after the due pass so a
    // warning failure can never delay timeout enforcement. The pass handles its
    // own errors; guard the call defensively regardless.
    try {
      await warnDeadlines(new Date(now()));
    } catch (err) {
      logger.error(
        { kind: 'deadline_warning_sweep_failure', error: (err as Error).message, at: now() },
        'deadline warning sweep failure',
      );
    }
    // Daily digest: after the warning pass so a game warned this tick is seen
    // as warned and not digested on top of it. Guarded like the rest.
    try {
      await digestTurns(new Date(now()));
    } catch (err) {
      logger.error(
        { kind: 'turn_digest_sweep_failure', error: (err as Error).message, at: now() },
        'turn digest sweep failure',
      );
    }
    // Expired-challenge reclaim: independent of deadline enforcement, guarded so
    // a failure never affects the passes above.
    try {
      await sweepExpiredSeeks(new Date(now()));
    } catch (err) {
      logger.error(
        { kind: 'expired_seek_sweep_failure', error: (err as Error).message, at: now() },
        'expired seek sweep failure',
      );
    }
  }

  const timer = setInterval(() => {
    void tick();
  }, intervalMs);
  timer.unref();

  return {
    stop: () => clearInterval(timer),
    tick,
  };
}
