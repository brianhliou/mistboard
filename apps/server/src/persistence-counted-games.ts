// One definition of "a game that counts" for every aggregate surface: the
// public /stats page and the homepage number (persistence-site-stats.ts), the
// admin /metrics series (persistence-admin-metrics.ts), and the scheduled
// readout (persistence-mistboard-readout.ts). They used to each spell the
// filter out; three copies of `mode IN ('pvp', 'pve')` were fine until the
// filter grew a second clause.
//
// A counted game is a completed human game (people against people or a bot)
// with no seat held by an account flagged `users.stats_excluded_at`
// (migration 136: the operator's own accounts, which had played half of all
// games). Engine-vs-engine and corpus modes were already out; excluded seats
// are the same idea applied to accounts. The games themselves are untouched:
// profiles, replays, and the /accounts roster still show them.

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

// Completed pvp/pve game with no excluded seat.
export function countedHumanGame(gamesAlias = 'g'): string {
  return `${gamesAlias}.status = 'completed' AND ${gamesAlias}.mode IN ('pvp', 'pve')
    AND NOT ${excludedSeatExists(gamesAlias)}`;
}

// Aborted pvp/pve game with no excluded seat (the readout's demand signal).
export function countedAbortedGame(gamesAlias = 'g'): string {
  return `${gamesAlias}.status = 'aborted' AND ${gamesAlias}.mode IN ('pvp', 'pve')
    AND NOT ${excludedSeatExists(gamesAlias)}`;
}

// Completed pvp/pve game that an excluded account sat in: what the counts
// above leave out, reported on /metrics beside bot-vs-bot so the exclusion
// is visible rather than silent.
export function internalHumanGame(gamesAlias = 'g'): string {
  return `${gamesAlias}.status = 'completed' AND ${gamesAlias}.mode IN ('pvp', 'pve')
    AND ${excludedSeatExists(gamesAlias)}`;
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
