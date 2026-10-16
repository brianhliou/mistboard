// Lichess-style head-to-head record for the review underboard's Crosstable tab:
// the pair's score in this variant over one cell per game, oldest on the left,
// the game being reviewed outlined. Data comes from
// `GET /api/games/:roomId/crosstable`; the server resolves the pair from the
// room's own seats and refuses to build a record for guest or private seats, so
// this module never handles identities, only names and outcomes.

import { t } from '../i18n/catalog.js';
import { playerNameEl, profileTargetFor } from '../profile-link.js';

export type CrosstablePlayer = {
  name: string;
  kind: 'account' | 'engine';
  // Linkable profile identity, at most one set; both null for a seat with no page.
  handle?: string | null;
  botId?: string | null;
};

export type CrosstableGame = {
  roomId: string;
  reviewUrl: string;
  endedAt: string;
  aSeat: 'white' | 'black';
  // From player a's perspective (a = this room's first seat).
  outcome: 'a' | 'b' | 'draw';
};

export type CrosstableResponse =
  | { available: false; reason: 'guest' | 'private' | 'unsupported' }
  | {
      available: true;
      variant: string;
      players: [CrosstablePlayer, CrosstablePlayer];
      score: { a: number; b: number; draws: number; total: number };
      // Newest first, at most 20, including the current room.
      games: CrosstableGame[];
    };

export async function fetchCrosstable(roomId: string): Promise<CrosstableResponse | null> {
  try {
    const response = await fetch(`/api/games/${encodeURIComponent(roomId)}/crosstable`);
    if (!response.ok) return null;
    return (await response.json()) as CrosstableResponse;
  } catch {
    return null;
  }
}

function note(text: string, className = 'review-underboard-empty'): HTMLElement {
  const p = document.createElement('p');
  p.className = className;
  p.textContent = text;
  return p;
}

// Lichess tallies: wins plus half a point per draw, "3½" style.
export function formatPoints(wins: number, draws: number): string {
  const whole = wins + Math.floor(draws / 2);
  return draws % 2 === 1 ? `${whole}½` : String(whole);
}

type Side = 'a' | 'b';

// The point a side took from a game: 1, 0, or ½.
function pointFor(side: Side, outcome: CrosstableGame['outcome']): '1' | '0' | '½' {
  if (outcome === 'draw') return '½';
  return outcome === side ? '1' : '0';
}

function pointClass(point: '1' | '0' | '½'): string {
  if (point === '1') return 'review-crosstable__cell--win';
  if (point === '0') return 'review-crosstable__cell--loss';
  return 'review-crosstable__cell--draw';
}

// One player's row: name, one cell per game, the total. Lichess anatomy: the
// two rows share columns, so a column reads as one game (both cells link to it).
type Standing = 'lead' | 'trail' | 'level';

function playerRow(
  side: Side,
  player: CrosstablePlayer,
  games: readonly CrosstableGame[],
  total: string,
  standing: Standing,
  currentRoomId: string,
): HTMLTableRowElement {
  const name = player.name;
  const row = document.createElement('tr');
  row.className = `review-crosstable__row review-crosstable__row--${side}`;
  // Lichess column order: the game cells packed against the names from the
  // left (a filler cell takes the slack), then the name, then the total.
  const fill = document.createElement('td');
  fill.className = 'review-crosstable__fill';
  row.append(fill);
  for (const game of games) {
    const point = pointFor(side, game.outcome);
    const cell = document.createElement('td');
    cell.className = `review-crosstable__cell ${pointClass(point)}`;
    // A row's cell opens that game from this player's side: the shell reads
    // ?flip=1 as "second seat at the bottom".
    const seat = side === 'a' ? game.aSeat : game.aSeat === 'white' ? 'black' : 'white';
    const link = document.createElement('a');
    link.href = seat === 'black' ? `${game.reviewUrl}?flip=1` : game.reviewUrl;
    link.textContent = point;
    link.title = `${game.endedAt.slice(0, 10)} · ${name}`;
    if (game.roomId === currentRoomId) {
      cell.classList.add('review-crosstable__cell--current');
      link.setAttribute('aria-current', 'page');
    }
    cell.append(link);
    row.append(cell);
  }
  const head = document.createElement('th');
  head.scope = 'row';
  head.className = 'review-crosstable__name';
  head.append(playerNameEl(name, profileTargetFor(player), 'review-crosstable__name-text'));
  const score = document.createElement('td');
  score.className = `review-crosstable__score review-crosstable__score--${standing}`;
  score.textContent = total;
  row.append(head, score);
  return row;
}

export function renderCrosstable(
  data: CrosstableResponse | null,
  currentRoomId: string,
): HTMLElement {
  if (!data) return note(t('underboard.crosstableUnavailable'));
  if (!data.available) {
    if (data.reason === 'guest') return note(t('underboard.crosstableGuest'));
    if (data.reason === 'private') return note(t('underboard.crosstablePrivate'));
    return note(t('underboard.crosstableUnavailable'));
  }
  const [a, b] = data.players;
  const root = document.createElement('div');
  root.className = 'review-crosstable';

  // The server lists newest first; read left to right like a scoresheet, and
  // the scroller opens at the right end (the newest games) when it overflows.
  const games = [...data.games].reverse();
  const scroller = document.createElement('div');
  scroller.className = 'review-crosstable__scroller';
  const table = document.createElement('table');
  table.className = 'review-crosstable__table';
  const body = document.createElement('tbody');
  // Totals read green for the leader and red for the trailer (lichess).
  const standingA: Standing =
    data.score.a === data.score.b ? 'level' : data.score.a > data.score.b ? 'lead' : 'trail';
  const standingB: Standing =
    standingA === 'level' ? 'level' : standingA === 'lead' ? 'trail' : 'lead';
  body.append(
    playerRow(
      'a',
      a,
      games,
      formatPoints(data.score.a, data.score.draws),
      standingA,
      currentRoomId,
    ),
    playerRow(
      'b',
      b,
      games,
      formatPoints(data.score.b, data.score.draws),
      standingB,
      currentRoomId,
    ),
  );
  table.append(body);
  scroller.append(table);
  root.append(scroller);

  if (data.score.total > data.games.length) {
    root.append(
      note(
        t('underboard.crosstableShowingLast', {
          shown: String(data.games.length),
          total: String(data.score.total),
        }),
        'review-crosstable__note',
      ),
    );
  }
  return root;
}

/** The review-config slice for the Crosstable tab: shown only when both seats
 *  are identifiable (accounts or engines; lichess hides it for anonymous), and
 *  loaded lazily the first time the tab opens. Spread it into the config. */
export function crosstableConfig(
  roomId: string,
  players: ReadonlyArray<{ kind?: string }> | undefined,
): { showCrosstable: boolean; crosstable?: { load(): Promise<HTMLElement> } } {
  const eligible =
    players?.length === 2 &&
    players.every((player) => player.kind === 'account' || player.kind === 'engine');
  if (!eligible) return { showCrosstable: false };
  return {
    showCrosstable: true,
    crosstable: { load: async () => renderCrosstable(await fetchCrosstable(roomId), roomId) },
  };
}
