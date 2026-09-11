// One definition of "a game that counts" for every aggregate surface: the
// public /stats page and the homepage number (persistence-site-stats.ts), the
// admin /metrics series (persistence-admin-metrics.ts), and the scheduled
// readout (persistence-mistboard-readout.ts). They used to each spell the
// filter out; three copies of `mode IN ('pvp', 'pve')` were fine until the
// filter grew a second clause.
//
// A counted game is a completed human game (people against people or a bot),
// finished on or after the public launch date, with no seat held by an
// account flagged `users.stats_excluded_at` (migration 136: the operator's
// own accounts, which had played half of all games). Engine-vs-engine and
// corpus modes were already out; excluded seats and the launch date are the
// same idea applied to accounts and to time. The games themselves are
// untouched: profiles, replays, and the /accounts roster still show them.
//
// The launch date exists because 197 of the 476 games that survived the
// account exclusion were guest-seat fog chess games from May 2026, played by
// the operator before accounts existed and before anyone else had found the
// site. A guest seat carries no identity, so no account flag can reach them;
// the date can. June 2026 had 16 guest games across six variants, which is
// what visitors look like. Set 2026-09-11.

export const STATS_COUNTED_FROM = '2026-06-01';

// Games alias must be the table alias in the caller's FROM clause.
export function excludedSeatExists(gamesAlias: string): string {
  return `EXISTS (
    SELECT 1 FROM game_participants xp
    JOIN users xu ON xu.id = xp.subject_id
    WHERE xp.game_id = ${gamesAlias}.room_id
      AND xp.subject_type = 'user'
      AND xu.stats_excluded_at IS NOT NULL
  )`;
}

// Finished on or after the launch date.
export function sinceLaunch(gamesAlias: string): string {
  return `${gamesAlias}.ended_at >= '${STATS_COUNTED_FROM}'::timestamptz`;
}

// Completed pvp/pve game since launch with no excluded seat.
export function countedHumanGame(gamesAlias = 'g'): string {
  return `${gamesAlias}.status = 'completed' AND ${gamesAlias}.mode IN ('pvp', 'pve')
    AND ${sinceLaunch(gamesAlias)}
    AND NOT ${excludedSeatExists(gamesAlias)}`;
}

// Aborted pvp/pve game since launch with no excluded seat (the readout's
// demand signal).
export function countedAbortedGame(gamesAlias = 'g'): string {
  return `${gamesAlias}.status = 'aborted' AND ${gamesAlias}.mode IN ('pvp', 'pve')
    AND ${sinceLaunch(gamesAlias)}
    AND NOT ${excludedSeatExists(gamesAlias)}`;
}

// Completed pvp/pve game that an excluded account sat in, any date: what the
// counts above leave out, reported on /metrics beside bot-vs-bot so the
// exclusion is visible rather than silent.
export function internalHumanGame(gamesAlias = 'g'): string {
  return `${gamesAlias}.status = 'completed' AND ${gamesAlias}.mode IN ('pvp', 'pve')
    AND ${excludedSeatExists(gamesAlias)}`;
}

// Completed pvp/pve game before the launch date with no excluded seat: the
// other thing the counts leave out, reported the same way.
export function preLaunchHumanGame(gamesAlias = 'g'): string {
  return `${gamesAlias}.status = 'completed' AND ${gamesAlias}.mode IN ('pvp', 'pve')
    AND NOT ${sinceLaunch(gamesAlias)}
    AND NOT ${excludedSeatExists(gamesAlias)}`;
}

// A seat with a countable person behind it: a signed-in account that is not
// excluded. Guest seats carry no subject id and cannot be counted as people
// (memory guests_have_no_identity_in_db).
export function countedAccountSeat(participantsAlias = 'p'): string {
  return `${participantsAlias}.subject_type = 'user'
    AND ${participantsAlias}.subject_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM users cu
      WHERE cu.id = ${participantsAlias}.subject_id AND cu.stats_excluded_at IS NULL
    )`;
}

// Row filter for counts over the users table itself.
export const COUNTED_USER = `stats_excluded_at IS NULL`;
