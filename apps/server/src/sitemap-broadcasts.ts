// sitemap-broadcasts.xml (#458): the broadcast index, every event page and
// every round page, each dated from its latest game. A round's date is its
// start (the day its games were played, the same date the player pages use),
// else the last change to one of its started boards; an event's is the latest
// of its rounds. Not the boards' updated_at alone: a re-import or a name
// backfill touches every board, and a lastmod that moves on maintenance
// teaches a crawler to ignore it. Rounds with no started
// board, and events with no such round, are left out: an empty pairing sheet
// is not a page worth pointing a crawler at.

import { getPool } from './persistence-db.js';

export type BroadcastRoundDate = {
  tourSlug: string;
  roundId: string;
  /** The round's start, else the latest change to one of its started boards. */
  lastGameAt: Date;
};

export async function listBroadcastRoundDates(): Promise<BroadcastRoundDate[]> {
  const { rows } = await getPool().query<{
    tour_slug: string;
    round_id: string;
    last_game_at: Date;
  }>(
    `SELECT boards.tour_slug, boards.round_id,
            COALESCE(rounds.starts_at, MAX(boards.updated_at)) AS last_game_at
       FROM xiangqi_broadcast_boards boards
       JOIN xiangqi_broadcast_rounds rounds ON rounds.id = boards.round_id
      WHERE boards.status <> 'scheduled'
      GROUP BY boards.tour_slug, boards.round_id, rounds.starts_at
      ORDER BY boards.tour_slug, boards.round_id`,
  );
  return rows.map((row) => ({
    tourSlug: row.tour_slug,
    roundId: row.round_id,
    lastGameAt: row.last_game_at,
  }));
}

export type BroadcastSitemapEntry = { path: string; lastmod?: string };

const isoDate = (date: Date): string => date.toISOString().slice(0, 10);

export function broadcastSitemapEntries(
  rounds: readonly BroadcastRoundDate[],
): BroadcastSitemapEntry[] {
  const byTour = new Map<string, BroadcastRoundDate[]>();
  for (const round of rounds) {
    byTour.set(round.tourSlug, [...(byTour.get(round.tourSlug) ?? []), round]);
  }
  const newest = (list: readonly BroadcastRoundDate[]): string | undefined => {
    const times = list.map((r) => r.lastGameAt.getTime());
    return times.length > 0 ? isoDate(new Date(Math.max(...times))) : undefined;
  };
  const entries: BroadcastSitemapEntry[] = [
    { path: '/broadcast/xiangqi', lastmod: newest(rounds) },
  ];
  for (const [tourSlug, tourRounds] of [...byTour].sort(([a], [b]) => a.localeCompare(b))) {
    const tourPath = `/broadcast/xiangqi/${encodeURIComponent(tourSlug)}`;
    entries.push({ path: tourPath, lastmod: newest(tourRounds) });
    for (const round of tourRounds) {
      entries.push({
        path: `${tourPath}/round/${encodeURIComponent(round.roundId)}`,
        lastmod: isoDate(round.lastGameAt),
      });
    }
  }
  return entries;
}
