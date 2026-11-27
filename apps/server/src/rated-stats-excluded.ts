import {
  isStatsExcluded,
  isUserIdStatsExcluded,
  type UserAccount,
} from './persistence-accounts.js';
import { isInitialized } from './persistence-db.js';

/**
 * Rated play between stats-excluded accounts (2026-11-26).
 *
 * A stats-excluded account (the owner, QA) plays rated like any signed-in
 * account; a rated game is never formed when BOTH seats are stats-excluded
 * accounts. Each entry point applies that where the second account arrives:
 * the lobby matcher, a correspondence accept or directed challenge, a live
 * invite, a rematch, and the seat gate of both live stacks (the backstop for a
 * stale client or a pre-issued link). See the comment on `isStatsExcluded`.
 */

/** Whether another account (by id) is stats-excluded. */
export type StatsExcludedLookup = (userId: string) => Promise<boolean>;

// Without a database there are no stats flags to read, so nobody is excluded.
// With one, a missing or closed account reads as excluded (fails closed).
export const lookupStatsExcluded: StatsExcludedLookup = async (userId) =>
  isInitialized() && (await isUserIdStatsExcluded(userId));

type SeatHolder = { userId: string | null; revokedAt?: Date | null } | undefined;

/**
 * Whether `accountUser` is stats-excluded and another live seat of the room is
 * already held by a stats-excluded account: the pair a rated room refuses. A
 * counted account never needs the lookup, so it costs no query.
 */
export async function ratedSeatPairsTwoExcluded(
  accountUser: Pick<UserAccount, 'id' | 'statsExcludedAt'> | null,
  seatTokens: Partial<Record<string, SeatHolder>>,
  lookup: StatsExcludedLookup = lookupStatsExcluded,
): Promise<boolean> {
  if (!accountUser || !isStatsExcluded(accountUser)) return false;
  for (const holder of Object.values(seatTokens)) {
    if (!holder || holder.revokedAt != null) continue;
    if (holder.userId === null || holder.userId === accountUser.id) continue;
    if (await lookup(holder.userId)) return true;
  }
  return false;
}

/**
 * Whether two seat holders are distinct accounts that are both stats-excluded:
 * the pair a rated game is never formed between (2026-11-26).
 */
export async function bothStatsExcluded(
  first: string | null,
  second: string | null,
  lookup: StatsExcludedLookup | undefined,
): Promise<boolean> {
  if (!lookup || first === null || second === null || first === second) return false;
  return (await lookup(first)) && (await lookup(second));
}
