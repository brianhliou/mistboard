// A player's record from our own archive, cut the ways a reader asks about it
// (#458): by colour, against one opponent, by opening. Every figure is a count
// over the boards the player API returns, so the page and its filters can
// never disagree with the game list they sit above. No DOM here.

export type Outcome = 'win' | 'draw' | 'loss';
export type Colour = 'red' | 'black';

export type StatBoard = {
  colour: Colour;
  outcome: Outcome;
  opponent: { name: string; nameEn: string | null; slug: string | null };
  /** "C70 五七炮对屏风马进３卒" as the source classifies the game; absent from
   *  API responses that predate the field. */
  opening?: string | null;
};

export type Record3 = { games: number; wins: number; draws: number; losses: number };

export function recordOf(boards: readonly { outcome: Outcome }[]): Record3 {
  const r: Record3 = { games: 0, wins: 0, draws: 0, losses: 0 };
  for (const b of boards) {
    r.games += 1;
    if (b.outcome === 'win') r.wins += 1;
    else if (b.outcome === 'draw') r.draws += 1;
    else r.losses += 1;
  }
  return r;
}

/** Points scored, a draw as a half: 6.5 of 11. */
export function pointsOf(r: Record3): number {
  return r.wins + r.draws / 2;
}

export function recordByColour<T extends StatBoard>(
  boards: readonly T[],
): { all: Record3; red: Record3; black: Record3 } {
  return {
    all: recordOf(boards),
    red: recordOf(boards.filter((b) => b.colour === 'red')),
    black: recordOf(boards.filter((b) => b.colour === 'black')),
  };
}

/** The key an opponent is filtered by: their page's slug, else their name. */
export function opponentKey(opponent: StatBoard['opponent']): string {
  return opponent.slug ?? opponent.name;
}

export type OpponentRow = {
  key: string;
  name: string;
  nameEn: string | null;
  slug: string | null;
  record: Record3;
};

/** Everyone the player has faced, most games first, then by name. */
export function opponentsOf(boards: readonly StatBoard[]): OpponentRow[] {
  const byKey = new Map<string, { opponent: StatBoard['opponent']; boards: StatBoard[] }>();
  for (const b of boards) {
    if (!b.opponent.name) continue;
    const key = opponentKey(b.opponent);
    const entry = byKey.get(key);
    if (entry) entry.boards.push(b);
    else byKey.set(key, { opponent: b.opponent, boards: [b] });
  }
  const rows: OpponentRow[] = [...byKey.entries()].map(([key, { opponent, boards: games }]) => ({
    key,
    name: opponent.name,
    nameEn: opponent.nameEn,
    slug: opponent.slug,
    record: recordOf(games),
  }));
  rows.sort(
    (a, b) =>
      b.record.games - a.record.games || (a.nameEn ?? a.name).localeCompare(b.nameEn ?? b.name),
  );
  return rows;
}

export type Opening = { code: string | null; name: string };

/** "C70 五七炮对屏风马进３卒" -> { code: 'C70', name: '五七炮对屏风马进３卒' }; a
 *  name with no ECCO code keeps the whole string as its name. */
export function parseOpening(value: string | null | undefined): Opening | null {
  const text = value?.trim();
  if (!text) return null;
  const match = text.match(/^([A-E]\d{2})(?:\s+(.*))?$/);
  if (!match) return { code: null, name: text };
  return { code: match[1]!, name: match[2]?.trim() || match[1]! };
}

/** The key an opening is filtered by: its ECCO code, else its name. */
export function openingKey(opening: Opening): string {
  return opening.code ?? opening.name;
}

/** ECCO's five volumes, by the code's letter. The codes run A00 to E99. */
export const ECCO_FAMILY_KEYS = {
  A: 'broadcast.playerEccoA',
  B: 'broadcast.playerEccoB',
  C: 'broadcast.playerEccoC',
  D: 'broadcast.playerEccoD',
  E: 'broadcast.playerEccoE',
} as const;

export type OpeningRow = Opening & { key: string; record: Record3 };

/** The openings the player has had with one colour, most games first, then
 *  by code. Games whose source names no opening are left out. */
export function openingsOf(boards: readonly StatBoard[], colour: Colour): OpeningRow[] {
  const byKey = new Map<string, { opening: Opening; boards: StatBoard[] }>();
  for (const b of boards) {
    if (b.colour !== colour) continue;
    const opening = parseOpening(b.opening);
    if (!opening) continue;
    const key = openingKey(opening);
    const entry = byKey.get(key);
    if (entry) entry.boards.push(b);
    else byKey.set(key, { opening, boards: [b] });
  }
  const rows = [...byKey.entries()].map(([key, { opening, boards: games }]) => ({
    ...opening,
    key,
    record: recordOf(games),
  }));
  rows.sort((a, b) => b.record.games - a.record.games || a.key.localeCompare(b.key));
  return rows;
}

export type BoardFilter = { colour?: Colour; opponent?: string; opening?: string };

export function filterBoards<T extends StatBoard>(boards: readonly T[], filter: BoardFilter): T[] {
  return boards.filter((b) => {
    if (filter.colour && b.colour !== filter.colour) return false;
    if (filter.opponent && opponentKey(b.opponent) !== filter.opponent) return false;
    if (filter.opening) {
      const opening = parseOpening(b.opening);
      if (!opening || openingKey(opening) !== filter.opening) return false;
    }
    return true;
  });
}

/** The filter a page URL asks for (?colour=red&vs=cao-yanlei&opening=C70),
 *  dropping values the player's games do not have. */
export function filterFromSearch(search: string, boards: readonly StatBoard[]): BoardFilter {
  const params = new URLSearchParams(search);
  const filter: BoardFilter = {};
  const colour = params.get('colour');
  if (colour === 'red' || colour === 'black') filter.colour = colour;
  const vs = params.get('vs');
  if (vs && boards.some((b) => opponentKey(b.opponent) === vs)) filter.opponent = vs;
  const opening = params.get('opening');
  if (
    opening &&
    boards.some((b) => {
      const o = parseOpening(b.opening);
      return o !== null && openingKey(o) === opening;
    })
  ) {
    filter.opening = opening;
  }
  return filter;
}

export function searchFromFilter(filter: BoardFilter): string {
  const params = new URLSearchParams();
  if (filter.colour) params.set('colour', filter.colour);
  if (filter.opponent) params.set('vs', filter.opponent);
  if (filter.opening) params.set('opening', filter.opening);
  const text = params.toString();
  return text ? `?${text}` : '';
}
