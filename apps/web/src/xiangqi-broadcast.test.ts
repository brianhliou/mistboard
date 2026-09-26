import { XIANGQI_BROADCAST_SCHEMA, type XiangqiColor, type XiangqiMove } from '@mistboard/game';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { track } from './analytics.js';
import { importXiangqiGame } from './review/xiangqi-import.js';
import { buildXiangqiReplayFromMoves } from './review/xiangqi-review-model.js';
import { xiangqiAppearanceChangedEvent } from './theme.js';
import {
  broadcastPageForPath,
  broadcastRecordsCredit,
  formatBroadcastFreshness,
  mountXiangqiBroadcastBoard,
  mountXiangqiBroadcastIndex,
  mountXiangqiBroadcastRound,
  mountXiangqiBroadcastTour,
  serializeBroadcastMovesForAnalysis,
} from './xiangqi-broadcast.js';

// Only `track` is stubbed; the review shell a finished board mounts still
// needs the module's other exports (reviewOpenedProps and friends).
vi.mock('./analytics.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./analytics.js')>()),
  track: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(track).mockClear();
});

function broadcastOpenedCalls(): unknown[] {
  return vi
    .mocked(track)
    .mock.calls.filter(([name]) => name === 'broadcast_opened')
    .map(([, props]) => props);
}

type TimelineEntry = {
  type: 'move-played';
  color: XiangqiColor;
  move: XiangqiMove;
  ply: number;
};

// Red moves on odd plies, black on even — the same alternation the server emits.
function timelineFrom(moves: XiangqiMove[]): TimelineEntry[] {
  return moves.map((move, index) => ({
    type: 'move-played',
    color: index % 2 === 0 ? 'red' : 'black',
    move,
    ply: index + 1,
  }));
}

function stubEventSource(): void {
  vi.stubGlobal(
    'EventSource',
    class {
      addEventListener(): void {}
      close(): void {}
    },
  );
}

// The no-op stub above is enough for mount-only tests. This one keeps the
// listener so a test can push a round update the way the server would.
function stubPushableEventSource(): { push: (payload: unknown, version: string) => void } {
  const listeners = new Map<string, (event: Event) => void>();
  vi.stubGlobal(
    'EventSource',
    class {
      addEventListener(type: string, fn: (event: Event) => void): void {
        listeners.set(type, fn);
      }
      close(): void {}
    },
  );
  return {
    push(payload, version) {
      const fn = listeners.get('round');
      if (!fn) throw new Error('nothing listening for round events');
      fn(new MessageEvent('round', { data: JSON.stringify({ version, payload }) }));
    },
  };
}

function stubFetchJson(payloadForUrl: (url: string) => unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => ({
      ok: true,
      status: 200,
      json: async () => payloadForUrl(String(input)),
    })),
  );
}

describe('serializeBroadcastMovesForAnalysis', () => {
  // A legal, color-alternating opening (red on odd plies) that also exercises
  // rank-10 tokens (b10, a10) — every move is legal, so the analysis importer
  // keeps the whole line instead of truncating at an illegal ply.
  const GAME: XiangqiMove[] = [
    { from: 'b3', to: 'e3' }, // red cannon to center
    { from: 'h8', to: 'e8' }, // black cannon to center
    { from: 'b1', to: 'c3' }, // red horse
    { from: 'b10', to: 'c8' }, // black horse
    { from: 'a1', to: 'a2' }, // red rook up one
    { from: 'a10', to: 'a9' }, // black rook up one
  ];
  const QUERY = 'b3e3,h8e8,b1c3,b10c8,a1a2,a10a9';

  it('round-trips a broadcast timeline through the /analysis/xiangqi importer', () => {
    const query = serializeBroadcastMovesForAnalysis(timelineFrom(GAME));
    expect(query).toBe(QUERY);

    const imported = importXiangqiGame(query);
    expect(imported.error).toBeUndefined();
    expect(imported.moves).toEqual(GAME);
  });

  it('orders by ply regardless of timeline entry order', () => {
    const shuffled = [...timelineFrom(GAME)].reverse();
    expect(serializeBroadcastMovesForAnalysis(shuffled)).toBe(QUERY);
  });

  it('yields an empty query for a board with no moves', () => {
    expect(serializeBroadcastMovesForAnalysis([])).toBe('');
  });
});

describe('formatBroadcastFreshness', () => {
  // Local-time (no Z) timestamps keep the expected labels timezone-independent.
  const NOW = new Date('2026-07-10T12:00:00');

  it('labels sub-day updates relative to now', () => {
    expect(formatBroadcastFreshness('2026-07-10T11:59:40', NOW)).toBe('just now');
    expect(formatBroadcastFreshness('2026-07-10T11:57:00', NOW)).toBe('3m ago');
    expect(formatBroadcastFreshness('2026-07-10T10:00:00', NOW)).toBe('2h ago');
  });

  it('falls back to a short date after a day, adding the year when it differs', () => {
    expect(formatBroadcastFreshness('2026-07-08T18:00:00', NOW)).toBe('Jul 8');
    expect(formatBroadcastFreshness('2025-12-31T18:00:00', NOW)).toBe('Dec 31, 2025');
  });

  it('returns null for missing or invalid timestamps', () => {
    expect(formatBroadcastFreshness(null, NOW)).toBeNull();
    expect(formatBroadcastFreshness(undefined, NOW)).toBeNull();
    expect(formatBroadcastFreshness('not-a-date', NOW)).toBeNull();
  });
});

function fixtureBoard(input: {
  n: number;
  red: string;
  redEn?: string;
  black: string;
  blackEn?: string;
  moves: XiangqiMove[];
  status: 'scheduled' | 'live' | 'complete';
  result: '*' | '1-0' | '0-1' | '1/2-1/2';
  updatedAt?: string;
}) {
  return {
    id: `t-r-b${input.n}`,
    tourSlug: 't',
    roundId: 'r',
    sourceBoardId: `b${input.n}`,
    boardNumber: input.n,
    red: { name: input.red, ...(input.redEn ? { nameEn: input.redEn } : {}) },
    black: { name: input.black, ...(input.blackEn ? { nameEn: input.blackEn } : {}) },
    status: input.status,
    result: input.result,
    plyCount: input.moves.length,
    moves: input.moves,
    ...(input.updatedAt ? { updatedAt: input.updatedAt } : {}),
  };
}

// The ingested shape: Chinese originals with cached English translations on
// the rounds and player tags (tour name here is already English). `rounds`
// carries the sibling-round stats the round switcher renders markers from.
const ROUND = {
  tour: { schema: XIANGQI_BROADCAST_SCHEMA, slug: 't', name: 'Test Cup' },
  round: {
    schema: XIANGQI_BROADCAST_SCHEMA,
    id: 'r',
    tourSlug: 't',
    name: '第1轮',
    nameEn: 'Round 1',
  },
  rounds: [
    {
      schema: XIANGQI_BROADCAST_SCHEMA,
      id: 'r',
      tourSlug: 't',
      name: '第1轮',
      nameEn: 'Round 1',
      boardCount: 2,
      liveBoardCount: 1,
      completeBoardCount: 0,
      scheduledBoardCount: 1,
    },
    {
      schema: XIANGQI_BROADCAST_SCHEMA,
      id: 'r2',
      tourSlug: 't',
      name: '第2轮',
      nameEn: 'Round 2',
      boardCount: 2,
      liveBoardCount: 0,
      completeBoardCount: 2,
      scheduledBoardCount: 0,
    },
  ],
  boards: [
    fixtureBoard({
      n: 1,
      red: '王天一',
      redEn: 'Wang Tianyi',
      black: '郑惟桐',
      blackEn: 'Zheng Weitong',
      moves: [{ from: 'b3', to: 'e3' }],
      status: 'live',
      result: '*',
    }),
    fixtureBoard({
      n: 2,
      red: 'A Player',
      black: 'B Player',
      moves: [],
      status: 'scheduled',
      result: '*',
    }),
  ],
};

describe('mountXiangqiBroadcastRound (mini-board grid)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders one mini-board card per board with a board, names, and live marker', async () => {
    // Stub the round fetch; EventSource is stubbed to a no-op so the live-stream
    // wiring does not reach for a real connection under happy-dom.
    stubFetchJson(() => ROUND);
    stubEventSource();

    const root = document.createElement('div');
    await mountXiangqiBroadcastRound(root, 't', 'r');

    const cards = root.querySelectorAll('.xqb-board-card');
    expect(cards.length).toBe(2);
    // Each card rebuilds a position and renders the shared board SVG (the board
    // root carries .xq-live-svg; pieces are nested svgs, so match the root only).
    expect(root.querySelectorAll('.xqb-card-board > svg.xq-live-svg').length).toBe(2);
    // lichess's card: both players on the board's own sides, Black above.
    const liveSeats = [...root.querySelectorAll('.xqb-board-card-live .xqb-card-seat')];
    expect(liveSeats.map((seat) => seat.className)).toEqual([
      'xqb-card-seat xqb-card-seat-black',
      'xqb-card-seat xqb-card-seat-red',
    ]);
    // The Chinese names ride the tooltip.
    const titles = [...root.querySelectorAll('.xqb-card-seat-name')].map((node) =>
      node.getAttribute('title'),
    );
    expect(titles.join(' ')).toContain('王天一');
    expect(titles.join(' ')).toContain('郑惟桐');
    // A live game has no score yet: the side to move is marked in that slot
    // (lichess runs its clock there), no badge row of its own. One move in,
    // Black is to move.
    const liveCard = root.querySelector('.xqb-board-card-live');
    expect(
      liveCard?.querySelector('.xqb-card-seat-black .xqb-to-move')?.getAttribute('title'),
    ).toBe('To move');
    expect(liveCard?.querySelector('.xqb-card-seat-red .xqb-to-move')).toBeNull();
    expect(liveCard?.querySelector('.xqb-card-top, .xqb-card-live')).toBeNull();
    expect(
      [...(liveCard?.querySelectorAll('.xqb-score') ?? [])].map((node) => node.textContent),
    ).toEqual(['', '']);
  });

  it('opens an event with no games on the Overview, with its format and no "not started"', async () => {
    // The women's league as it stands before dpxq posts a record: rounds with
    // no games and no times.
    const empty = {
      tour: {
        schema: XIANGQI_BROADCAST_SCHEMA,
        slug: 'w',
        name: '2026年全国象棋女子甲级联赛',
        nameEn: '2026 National Xiangqi Women Division A League',
        startsAt: '2026-09-23T00:00:00+08:00',
      },
      round: { schema: XIANGQI_BROADCAST_SCHEMA, id: 'w-r01', tourSlug: 'w', name: 'Round 1' },
      rounds: [1, 2].map((n) => ({
        schema: XIANGQI_BROADCAST_SCHEMA,
        id: `w-r0${n}`,
        tourSlug: 'w',
        name: `Round ${n}`,
        boardCount: 0,
      })),
      boards: [],
    };
    stubFetchJson(() => empty);
    stubEventSource();
    const root = document.createElement('div');
    await mountXiangqiBroadcastRound(root, 'w', 'w-r01');

    expect(root.querySelector('.xqb-tab.xqb-tab-active')?.textContent).toBe('Overview');
    const pending = root.querySelector('.xqb-overview-pending')?.textContent ?? '';
    expect(pending).toContain('three tables');
    expect(pending).toContain('No games yet');
    // An undated round of a running event is not called upcoming.
    expect(root.querySelector('.xqb-round-picker-button')?.textContent).not.toContain('Upcoming');
    expect(root.textContent).not.toContain('This round has not started');
  });

  it('fires broadcast_opened once for the round surface, not again per stream push', async () => {
    stubFetchJson(() => ROUND);
    const stream = stubPushableEventSource();

    const root = document.createElement('div');
    await mountXiangqiBroadcastRound(root, 't', 'r');
    expect(broadcastOpenedCalls()).toEqual([
      { surface: 'round', tour_slug: 't', round_id: 'r', locale: 'en' },
    ]);

    stream.push({ ...ROUND, round: { ...ROUND.round, updatedAt: 'later' } }, 'v2');
    window.dispatchEvent(new Event(xiangqiAppearanceChangedEvent));
    expect(broadcastOpenedCalls()).toHaveLength(1);
  });

  // The round grid draws every board at once, and .xq-piece in live-xiangqi.css
  // carries a drop-shadow. A filter is an offscreen surface plus a blur re-run
  // per raster tile, so twenty boards was 396 live filters and dropped 382 of
  // 722 frames while scrolling (2026-09-06, 1280x800; 3 of 724 with them off).
  // xiangqi-broadcast.css turns them off, scoped to .xqb-card-board.
  //
  // That scoping is the fragile part, so assert it rather than the rule text:
  // the override only reaches a piece that is INSIDE a card board. A future
  // card that renders a board anywhere else silently gets the filters back, and
  // nothing else in the suite would notice.
  it('keeps every grid piece inside .xqb-card-board, where the filter override reaches', async () => {
    stubFetchJson(() => ROUND);
    stubEventSource();

    const root = document.createElement('div');
    await mountXiangqiBroadcastRound(root, 't', 'r');

    const pieces = root.querySelectorAll('.xq-piece');
    expect(pieces.length).toBeGreaterThan(0);
    for (const piece of pieces) {
      expect(piece.closest('.xqb-card-board')).not.toBeNull();
    }

    const rings = root.querySelectorAll('.xq-live-lastmove-ring');
    for (const ring of rings) {
      expect(ring.closest('.xqb-card-board')).not.toBeNull();
    }
  });

  // A live round pushes on every board change, and each card replays its game
  // from move one to rebuild its SVG. Repainting all twenty per push blocked the
  // main thread for 400-700ms, so cards are cached and only changed ones rebuild.
  //
  // Asserted by DOM node IDENTITY rather than by counting work: identity is what
  // "did not rebuild" actually means, and it cannot pass by accident.
  it('reuses the card element for a board that did not change across a stream push', async () => {
    stubFetchJson(() => ROUND);
    const stream = stubPushableEventSource();

    const root = document.createElement('div');
    await mountXiangqiBroadcastRound(root, 't', 'r');

    const before = [...root.querySelectorAll('.xqb-board-card')];
    expect(before.length).toBe(2);

    // One board gains a move; the other is untouched.
    const next = structuredClone(ROUND) as typeof ROUND & {
      boards: { id: string; plyCount?: number; updatedAt?: string }[];
    };
    next.boards[0]!.plyCount = (next.boards[0]!.plyCount ?? 0) + 1;
    next.boards[0]!.updatedAt = '2026-09-06T12:00:00.000Z';
    stream.push(next, 'v2');

    const after = [...root.querySelectorAll('.xqb-board-card')];
    expect(after.length).toBe(2);

    const idOf = (card: Element) => card.querySelector('.xqb-card-number')?.textContent ?? '';
    const changedBefore = before.find((c) => idOf(c) === idOf(after[0]!));
    // The untouched board keeps its exact element; the changed one is replaced.
    const untouched = after.filter((card) => before.includes(card));
    expect(untouched.length).toBe(1);
    expect(changedBefore && after.includes(changedBefore)).toBeFalsy();
  });

  it('rebuilds every card when board appearance changes', async () => {
    stubFetchJson(() => ROUND);
    stubPushableEventSource();

    const root = document.createElement('div');
    await mountXiangqiBroadcastRound(root, 't', 'r');
    const before = [...root.querySelectorAll('.xqb-board-card')];

    // A skin or layout change rewrites every board SVG, so no card may survive.
    window.dispatchEvent(new Event(xiangqiAppearanceChangedEvent));

    const after = [...root.querySelectorAll('.xqb-board-card')];
    expect(after.length).toBe(before.length);
    expect(after.some((card) => before.includes(card))).toBe(false);
  });

  it('repaints mini-board cards when the board layout changes', async () => {
    stubFetchJson(() => ROUND);
    stubEventSource();
    window.history.replaceState(null, '', '/broadcast/xiangqi/t/round/r');

    const root = document.createElement('div');
    await mountXiangqiBroadcastRound(root, 't', 'r');
    expect(root.querySelectorAll('.xq-live-svg--intersection')).toHaveLength(2);

    window.history.replaceState(null, '', '/broadcast/xiangqi/t/round/r?xqLayout=cell');
    window.dispatchEvent(new Event(xiangqiAppearanceChangedEvent));

    expect(root.querySelectorAll('.xq-live-svg--cell')).toHaveLength(2);
    window.history.replaceState(null, '', '/');
  });

  it('renders English primary with the Chinese preserved as a secondary line', async () => {
    stubFetchJson(() => ROUND);
    stubEventSource();

    const root = document.createElement('div');
    await mountXiangqiBroadcastRound(root, 't', 'r');

    // The header is the tour's, in the column beside the game list (lichess's
    // relay); the round is named by the switcher and the list's heading, not
    // by a heading of its own above the boards.
    expect(root.querySelector('.xqb-event-content .xqb-hero h1')?.textContent).toBe('Test Cup');
    expect(root.querySelector('.xqb-round-heading')).toBeNull();
    expect(root.querySelector('.xqb-side-rail h2')?.textContent).toBe('Round 1');
    // lichess's left column: the game list over the event's chat room; no
    // Source button in the header.
    expect(root.querySelector('.xqb-event-side > .xqb-side-rail + .xqb-event-chat')).not.toBeNull();
    expect(root.querySelector('.xqb-event-header .xqb-link-primary')).toBeNull();

    // Player names: English primary, the Chinese in the tooltip, and the
    // official list's title before the name in its own tag (lichess's GM).
    const names = [...root.querySelectorAll('.xqb-board-card .xqb-card-seat-name')];
    expect(names.map((node) => node.textContent)).toContain('GM Wang Tianyi');
    expect(names.map((node) => node.textContent)).toContain('GM Zheng Weitong');
    expect(names[0]?.querySelector('.xqb-player-title')?.textContent).toBe('GM');
    const titles = names.map((node) => node.getAttribute('title') ?? '');
    expect(titles).toContain('王天一');
    expect(titles).toContain('郑惟桐');
    // Already-English names get no duplicate Chinese.
    expect(titles.some((title) => title.includes('A Player'))).toBe(false);
  });

  it('renders a round switcher listing sibling rounds with the current round selected', async () => {
    stubFetchJson(() => ROUND);
    stubEventSource();

    const root = document.createElement('div');
    await mountXiangqiBroadcastRound(root, 't', 'r');

    // lichess's picker: a pill naming the round and its status, opening a
    // panel of every round linked in place, the current one marked.
    const button = root.querySelector<HTMLButtonElement>('.xqb-hero .xqb-round-picker-button');
    expect(button?.querySelector('.xqb-round-picker-name')?.textContent).toBe('Round 1');
    // A live round reads lichess's "Ongoing".
    expect(button?.querySelector('.xqb-round-status-live')?.textContent).toBe('Ongoing');
    const panel = root.querySelector<HTMLElement>('.xqb-round-picker-panel');
    expect(panel?.hidden).toBe(true);
    button!.click();
    expect(panel?.hidden).toBe(false);
    expect(button?.getAttribute('aria-expanded')).toBe('true');
    const options = [...(panel?.querySelectorAll<HTMLAnchorElement>('.xqb-round-option') ?? [])];
    expect(options.map((option) => option.getAttribute('href'))).toEqual([
      '/broadcast/xiangqi/t/round/r',
      '/broadcast/xiangqi/t/round/r2',
    ]);
    expect(options[0]?.getAttribute('aria-selected')).toBe('true');
    // Round 2 is finished: a check, named for screen readers.
    expect(
      options[1]?.querySelector('.xqb-round-status-finished')?.getAttribute('aria-label'),
    ).toBe('Finished');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(panel?.hidden).toBe(true);
  });

  it('draws an eval gauge on boards that have an eval, and the toggle hides them all', async () => {
    const stored = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
    });
    stubFetchJson(() => ({
      ...ROUND,
      boards: [
        {
          ...fixtureBoard({
            n: 1,
            red: 'R1',
            black: 'B1',
            moves: [],
            status: 'complete',
            result: '0-1',
          }),
          evaluation: { cp: -900, mate: null, source: 'analysis' },
        },
        fixtureBoard({
          n: 2,
          red: 'R2',
          black: 'B2',
          moves: [],
          status: 'complete',
          result: '1-0',
        }),
      ],
    }));
    stubEventSource();

    const root = document.createElement('div');
    await mountXiangqiBroadcastRound(root, 't', 'r');

    // Every card keeps its gauge column so the boards line up; only the
    // evaluated one is filled.
    expect(root.querySelectorAll('.xqb-card-gauge')).toHaveLength(2);
    expect(root.querySelectorAll('.xqb-card-gauge-empty')).toHaveLength(1);
    const gauges = root.querySelectorAll('.xqb-card-gauge:not(.xqb-card-gauge-empty)');
    expect(gauges).toHaveLength(1);
    // Black well ahead: Red's share of the bar is small.
    const fill = gauges[0]?.querySelector<HTMLElement>('.review-eval-bar__fill');
    expect(Number.parseFloat(fill?.style.height ?? '100')).toBeLessThan(25);

    // The game list: the same evaluation in its pill, and each result in
    // colour, the winner's 1 green and the loser's 0 red.
    const railFill = root.querySelector<HTMLElement>(
      '.xqb-side-rail .xqb-rail-gauge .review-eval-bar__fill',
    );
    expect(Number.parseFloat(railFill?.style.height ?? '100')).toBeLessThan(25);
    expect(root.querySelectorAll('.xqb-side-rail .xqb-rail-gauge-empty')).toHaveLength(1);
    const firstRow = root.querySelector('.xqb-side-rail .xqb-rail-row');
    expect(firstRow?.querySelector('.xqb-card-seat-black .xqb-score-win')?.textContent).toBe('1');
    expect(firstRow?.querySelector('.xqb-card-seat-red .xqb-score-loss')?.textContent).toBe('0');

    const toggle = [...root.querySelectorAll<HTMLLabelElement>('.xqb-gauge-toggle')]
      .find((label) => label.textContent?.includes('Evaluation gauge'))
      ?.querySelector('input');
    expect(toggle?.checked).toBe(true);
    toggle!.checked = false;
    toggle!.dispatchEvent(new Event('change'));
    expect(root.querySelector('.xqb-event-layout')?.classList.contains('xqb-gauges-off')).toBe(
      true,
    );
    expect(stored.get('mistboard.broadcast.evalGauge')).toBe('off');
    vi.unstubAllGlobals();
  });

  it('sorts live boards ahead of finished and scheduled boards with result badges', async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString();
    stubFetchJson(() => ({
      ...ROUND,
      boards: [
        fixtureBoard({
          n: 1,
          red: 'R1',
          black: 'B1',
          moves: [],
          status: 'complete',
          result: '1-0',
          updatedAt: twoHoursAgo,
        }),
        fixtureBoard({ n: 2, red: 'R2', black: 'B2', moves: [], status: 'scheduled', result: '*' }),
        fixtureBoard({ n: 3, red: 'R3', black: 'B3', moves: [], status: 'live', result: '*' }),
      ],
    }));
    stubEventSource();

    const root = document.createElement('div');
    await mountXiangqiBroadcastRound(root, 't', 'r');

    // Live leads, then the pairing order; the Red player is each card's last seat.
    const reds = [
      ...root.querySelectorAll('.xqb-board-card .xqb-card-seat-red .xqb-card-seat-name'),
    ];
    expect(reds.map((node) => node.textContent)).toEqual(['R3', 'R1', 'R2']);
    // A finished game shows each side's score, lichess-style, and nothing
    // about when we imported it.
    const complete = root.querySelector('.xqb-board-card-complete');
    expect(
      [...(complete?.querySelectorAll('.xqb-score') ?? [])].map((node) => node.textContent),
    ).toEqual(['0', '1']);
    expect(complete?.textContent).not.toMatch(/ago|plies/);
  });
});

describe('broadcastRecordsCredit', () => {
  // Games imported from an archive carry their origin per board. The credit is
  // derived from that, because tour.sourceUrl is a poll target: it has to be
  // fetchable and parseable, so an archive-imported tour cannot carry one.
  it('credits the single origin the boards came from, without the www', () => {
    expect(
      broadcastRecordsCredit([
        { sourceUrl: 'http://www.dpxq.com/hldcg/search/view_m_142539.html' },
        { sourceUrl: 'http://www.dpxq.com/hldcg/search/view_m_142540.html' },
      ]),
    ).toEqual({ host: 'dpxq.com', href: 'http://www.dpxq.com' });
  });

  it('says nothing when the boards are ours', () => {
    expect(broadcastRecordsCredit([{}, {}])).toBeNull();
  });

  // A mixed-origin round would need a list, and crediting only the first source
  // would be worse than crediting none.
  it('says nothing when boards come from more than one origin', () => {
    expect(
      broadcastRecordsCredit([
        { sourceUrl: 'http://www.dpxq.com/a.html' },
        { sourceUrl: 'https://example.org/b.html' },
      ]),
    ).toBeNull();
  });

  it('ignores a board whose source will not parse rather than dropping the credit', () => {
    expect(
      broadcastRecordsCredit([
        { sourceUrl: 'http://www.dpxq.com/a.html' },
        { sourceUrl: 'not a url' },
      ]),
    ).toEqual({ host: 'dpxq.com', href: 'http://www.dpxq.com' });
  });

  it('ignores non-http schemes so a discovery source never becomes a credit', () => {
    expect(
      broadcastRecordsCredit([{ sourceUrl: 'mistboard-discover://dpxq-live?tourSlug=x' }]),
    ).toBeNull();
  });
});

describe('mountXiangqiBroadcastIndex (live and past zones)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const startView = buildXiangqiReplayFromMoves([]).views[0]!;

  function indexEntry(input: {
    slug: string;
    name: string;
    nameEn?: string;
    live: boolean;
    updatedAt: string;
    featured?: boolean;
  }) {
    return {
      tour: {
        schema: XIANGQI_BROADCAST_SCHEMA,
        slug: input.slug,
        name: input.name,
        ...(input.nameEn ? { nameEn: input.nameEn } : {}),
        location: 'Chengdu',
        startsAt: '2026-07-01',
        endsAt: '2026-07-08',
      },
      roundCount: 3,
      boardCount: 14,
      liveBoardCount: input.live ? 2 : 0,
      completeBoardCount: input.live ? 0 : 14,
      scheduledBoardCount: 0,
      totalPlies: 480,
      updatedAt: input.updatedAt,
      lastSyncLog: null,
      featuredBoard:
        input.featured === false
          ? null
          : {
              id: `${input.slug}-b1`,
              roundId: 'r1',
              boardNumber: 1,
              red: { name: 'Red Player' },
              black: { name: 'Black Player' },
              status: input.live ? ('live' as const) : ('complete' as const),
              result: input.live ? ('*' as const) : ('1-0' as const),
              plyCount: 40,
              updatedAt: input.updatedAt,
              view: startView,
            },
    };
  }

  it('orders Past by event date, newest first, and puts a running event under Ongoing', async () => {
    const entry = (slug: string, startsAt: string, endsAt: string, updatedAt: string) => {
      const base = indexEntry({ slug, name: slug, live: false, updatedAt });
      return { ...base, tour: { ...base.tour, startsAt, endsAt } };
    };
    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString();
    stubFetchJson(() => ({
      tours: [
        // Synced last, played first: the backfill that used to top the list.
        entry('spring', '2026-03-01', '2026-03-05', '2026-09-24T10:00:00Z'),
        entry('summer', '2026-07-01', '2026-07-05', '2026-09-01T10:00:00Z'),
        entry('autumn', '2026-09-09', '2026-09-13', '2026-09-02T10:00:00Z'),
        entry('running', '2026-09-20', soon, '2026-09-23T10:00:00Z'),
      ],
    }));
    const root = document.createElement('div');
    await mountXiangqiBroadcastIndex(root);

    // The running event is the featured one; the rest are past, newest first.
    expect(root.querySelector('.xqb-tour-card-featured .xqb-tour-card-name')?.textContent).toBe(
      'running',
    );
    const pastSection = [...root.querySelectorAll('.xqb-section')].find(
      (section) => section.querySelector('h2')?.textContent === 'Past',
    );
    expect(
      [...(pastSection?.querySelectorAll('.xqb-tour-card-name') ?? [])].map((n) => n.textContent),
    ).toEqual(['autumn', 'summer', 'spring']);
  });

  it('features the live event, lists the rest under Past, and never shows our import time', async () => {
    const threeMinutesAgo = new Date(Date.now() - 3 * 60_000).toISOString();
    // Past tour listed first in the payload to prove the featured slot is
    // status-driven, not order-driven. It also has no featured board, covering
    // the initial-position thumbnail fallback.
    stubFetchJson(() => ({
      tours: [
        {
          ...indexEntry({
            slug: 'past-open',
            name: 'Past Open',
            live: false,
            updatedAt: threeMinutesAgo,
            featured: false,
          }),
          latestRound: {
            id: 'past-open-r05',
            name: 'Round 5',
            startsAt: '2026-07-08T13:00:00+08:00',
            live: false,
          },
        },
        {
          ...indexEntry({
            slug: 'live-cup',
            name: '直播杯',
            nameEn: 'Live Cup',
            live: true,
            updatedAt: threeMinutesAgo,
          }),
          latestRound: { id: 'live-cup-r03', name: 'Round 3', startsAt: null, live: true },
          players: [
            { name: '无名', nameEn: 'Nobody Ranked' },
            { name: '王天一', nameEn: 'Wang Tianyi' },
          ],
        },
      ],
    }));

    const root = document.createElement('div');
    await mountXiangqiBroadcastIndex(root);

    // The section rail, lichess's left column.
    expect([...root.querySelectorAll('.xqb-rail-link')].map((node) => node.textContent)).toEqual([
      'Broadcasts',
      'Calendar',
      'About',
      'Pro players',
      'Pro teams',
    ]);
    expect(root.querySelector('.xqb-rail-link-active')?.textContent).toBe('Broadcasts');

    const featured = root.querySelector('.xqb-tour-card-featured');
    expect(featured?.className).toContain('xqb-tour-card-live');
    expect(featured?.querySelector('.xqb-tour-status-live')?.textContent).toBe('Round 3 · Live');
    expect(featured?.querySelector('.xqb-tour-card-name')?.textContent).toBe('Live Cup');
    expect(featured?.querySelector('.xqb-name-zh')?.textContent).toBe('直播杯');
    // Who is playing: ranked by the CXA lists; an unranked name stays off.
    expect(featured?.querySelector('.xqb-tour-players')?.textContent).toBe('GM Wang Tianyi');

    const headings = [...root.querySelectorAll('.xqb-section h2')].map((node) => node.textContent);
    expect(headings).toEqual(['Past']);
    const pastCard = root.querySelector('.xqb-section .xqb-tour-card');
    expect(pastCard?.querySelector('.xqb-tour-status')?.textContent).toMatch(/^Round 5 · Jul 8/);
    expect(pastCard?.textContent).not.toContain('Updated');

    // Both cards carry the event's art (a drawn placeholder: its name over a
    // board motif), lichess's card image, in place of a board thumbnail.
    const arts = root.querySelectorAll('.xqb-tour-card > .xqb-event-art');
    expect(arts.length).toBe(2);
    expect(arts[0]?.querySelector('.xqb-event-art-zh')?.textContent).toBeTruthy();
    expect(root.querySelector('.xqb-tour-card .xqb-card-board')).toBeNull();
  });

  it('features the latest event when nothing is live', async () => {
    stubFetchJson(() => ({
      tours: [
        indexEntry({
          slug: 'past-open',
          name: 'Past Open',
          live: false,
          updatedAt: new Date().toISOString(),
        }),
      ],
    }));

    const root = document.createElement('div');
    await mountXiangqiBroadcastIndex(root);

    expect(root.querySelector('.xqb-tour-card-featured .xqb-tour-card-name')?.textContent).toBe(
      'Past Open',
    );
    expect(root.querySelectorAll('.xqb-tour-card').length).toBe(1);
    expect(broadcastOpenedCalls()).toEqual([{ surface: 'index', locale: 'en' }]);
  });
});

describe('mountXiangqiBroadcastBoard (side rail + round switcher)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const MOVES: XiangqiMove[] = [{ from: 'b3', to: 'e3' }];
  const replay = buildXiangqiReplayFromMoves(MOVES);
  const BOARD_RESPONSE = {
    board: {
      id: 't-r-b1',
      tourSlug: 't',
      roundId: 'r',
      sourceBoardId: 'b1',
      boardNumber: 1,
      red: { name: '王天一', nameEn: 'Wang Tianyi' },
      black: { name: '郑惟桐', nameEn: 'Zheng Weitong' },
      status: 'live',
      result: '*',
      plyCount: MOVES.length,
      moves: MOVES,
    },
    state: { status: { type: 'playing', turn: 'black' }, moveNumber: 1 },
    timeline: timelineFrom(MOVES),
    view: replay.views[replay.maxPly]!,
    views: { truth: replay.views[replay.maxPly]! },
    history: { truth: replay.views.map((view, ply) => ({ ply, view })) },
  };

  it('lists sibling boards in a rail with the current board highlighted', async () => {
    stubFetchJson((url) =>
      url.includes('/api/xiangqi/broadcasts/boards/') ? BOARD_RESPONSE : ROUND,
    );
    stubEventSource();

    const root = document.createElement('div');
    await mountXiangqiBroadcastBoard(root, 't-r-b1');

    expect(root.querySelector('.xqb-side-rail')).not.toBeNull();
    const rows = [...root.querySelectorAll('.xqb-rail-row')];
    // Board 2 is paired and not started, with no moves: listed, not a link.
    expect(rows.map((row) => row.getAttribute('href'))).toEqual([
      '/broadcast/xiangqi/board/t-r-b1',
      null,
    ]);

    const current = root.querySelector('.xqb-rail-row-current');
    expect(current?.getAttribute('href')).toBe('/broadcast/xiangqi/board/t-r-b1');
    expect(current?.getAttribute('aria-current')).toBe('page');
    // Players render English-primary with their titles; the row carries an
    // eval pill (empty until the game has an evaluation) and a live marker.
    expect(
      [...(current?.querySelectorAll('.xqb-card-seat-name') ?? [])].map((node) => node.textContent),
    ).toEqual(['GM Wang Tianyi', 'GM Zheng Weitong']);
    expect(current?.querySelector('.xqb-rail-gauge.xqb-rail-gauge-empty')).not.toBeNull();
    // Live: the side to move marked in the score column, as on the cards.
    expect(current?.classList.contains('xqb-rail-row-live')).toBe(true);
    expect(current?.querySelector('.xqb-card-seat-black .xqb-to-move')).not.toBeNull();

    // An open board takes the whole content column (lichess): no header or
    // tabs above it; the list's heading is the way back to the round.
    expect(root.querySelector('.xqb-event-board-open')).not.toBeNull();
    expect(root.querySelector('.xqb-hero')).toBeNull();
    expect(root.querySelector('.xqb-tabs')).toBeNull();
    expect(root.querySelector('.xqb-side-rail h2 .xqb-rail-back')?.getAttribute('href')).toBe(
      '/broadcast/xiangqi/t/round/r',
    );
    // One open event, carrying the board's status at mount time.
    expect(broadcastOpenedCalls()).toEqual([
      { surface: 'board', tour_slug: 't', round_id: 'r', board_status: 'live', locale: 'en' },
    ]);
  });

  // The server's Pikafish read of the head position, Red POV, our squares.
  // After red's cannon move Black is to move, so the lines are Black's picks.
  const LIVE_EVAL = {
    ply: 1,
    nodes: 300_000,
    depth: 14,
    cp: -20,
    mate: null,
    lines: [
      { move: 'h10g8', cp: -20, mate: null, pv: ['h10g8', 'b1c3', 'h8e8'] },
      { move: 'b10c8', cp: -12, mate: null, pv: ['b10c8', 'h1g3'] },
      { move: 'a10a9', cp: 40, mate: null, pv: ['a10a9'] },
    ],
  };

  it('renders the eval bar, the engine lines, and arrows at the head from the live eval', async () => {
    stubFetchJson((url) =>
      url.includes('/api/xiangqi/broadcasts/boards/')
        ? { ...BOARD_RESPONSE, liveEval: LIVE_EVAL }
        : ROUND,
    );
    stubEventSource();
    window.history.replaceState(null, '', '/broadcast/xiangqi/board/t-r-b1');

    const root = document.createElement('div');
    await mountXiangqiBroadcastBoard(root, 't-r-b1');

    // Gauge beside the board, filled from Red's win probability (Black ahead: under half).
    const gauge = root.querySelector(
      '.xqb-board-stage-with-gauge .xqb-eval-gauge .review-eval-bar',
    );
    expect(gauge).not.toBeNull();
    const fill = gauge?.querySelector<HTMLElement>('.review-eval-bar__fill');
    expect(Number.parseFloat(fill?.style.height ?? '')).toBeLessThan(50);

    // Compact panel: headline, engine name and depth, three formatted lines.
    const panel = root.querySelector('.xqb-engine');
    expect(panel?.querySelector('.xqb-engine-eval')?.textContent).toBe('-0.2');
    expect(panel?.querySelector('.xqb-engine-sub')?.textContent).toBe('Pikafish, depth 14');
    const lines = [...(panel?.querySelectorAll('.xqb-engine-line') ?? [])];
    expect(lines.map((line) => line.querySelector('.xqb-engine-line-eval')?.textContent)).toEqual([
      '-0.2',
      '-0.1',
      '+0.4',
    ]);
    expect(lines[0]?.querySelector('.xqb-engine-line-pv')?.textContent).toBe('h10-g8 b1-c3 h8-e8');
    // At the head: no live tag, and the top lines draw as arrows.
    expect(panel?.querySelector<HTMLElement>('.xqb-engine-live-tag')?.hidden).toBe(true);
    const arrows = root.querySelectorAll('.xqb-board-frame .xq-live-arrows .xq-arrow');
    expect(arrows.length).toBeGreaterThan(0);
    expect(root.querySelector('.xq-arrow--pv1')).not.toBeNull();
    // Arrows are drawn in our squares: PV1 runs h10 -> g8 (not Pikafish's h9g7).
    window.history.replaceState(null, '', '/');
  });

  it('hides the arrows and shows the live tag when the viewer scrolls back from the head', async () => {
    stubFetchJson((url) =>
      url.includes('/api/xiangqi/broadcasts/boards/')
        ? { ...BOARD_RESPONSE, liveEval: LIVE_EVAL }
        : ROUND,
    );
    stubEventSource();
    window.history.replaceState(null, '', '/broadcast/xiangqi/board/t-r-b1');

    const root = document.createElement('div');
    await mountXiangqiBroadcastBoard(root, 't-r-b1');
    const prev = [...root.querySelectorAll<HTMLButtonElement>('.xqb-control')].find(
      (button) => button.textContent === 'Prev',
    );
    prev?.click();

    expect(root.querySelector('.xqb-ply-label')?.textContent).toBe('0 / 1');
    expect(root.querySelectorAll('.xqb-board-frame .xq-arrow').length).toBe(0);
    // The gauge and the panel keep the HEAD eval, flagged as the live position.
    expect(root.querySelector('.xqb-eval-gauge .review-eval-bar')).not.toBeNull();
    expect(root.querySelector('.xqb-engine-eval')?.textContent).toBe('-0.2');
    expect(root.querySelector<HTMLElement>('.xqb-engine-live-tag')?.hidden).toBe(false);
    expect(root.querySelector('.xqb-engine')?.classList.contains('xqb-engine-behind-head')).toBe(
      true,
    );
    window.history.replaceState(null, '', '/');
  });

  it('ignores a live eval for a ply that is not the head, and renders no engine layer without one', async () => {
    stubFetchJson((url) =>
      url.includes('/api/xiangqi/broadcasts/boards/')
        ? { ...BOARD_RESPONSE, liveEval: { ...LIVE_EVAL, ply: 0 } }
        : ROUND,
    );
    stubEventSource();
    const stale = document.createElement('div');
    await mountXiangqiBroadcastBoard(stale, 't-r-b1');
    expect(stale.querySelector('.xqb-engine')).toBeNull();
    expect(stale.querySelector('.xqb-eval-gauge')).toBeNull();
    expect(stale.querySelectorAll('.xq-arrow').length).toBe(0);

    stubFetchJson((url) =>
      url.includes('/api/xiangqi/broadcasts/boards/') ? BOARD_RESPONSE : ROUND,
    );
    const plain = document.createElement('div');
    await mountXiangqiBroadcastBoard(plain, 't-r-b1');
    expect(plain.querySelector('.xqb-engine')).toBeNull();
    expect(plain.querySelector('.xqb-board-stage-with-gauge')).toBeNull();
    expect(plain.querySelector('.xqb-board-frame')).not.toBeNull();
  });

  it('renders the board without a rail when the round context fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes('/api/xiangqi/broadcasts/boards/')) {
          return { ok: true, status: 200, json: async () => BOARD_RESPONSE };
        }
        return { ok: false, status: 500, json: async () => ({}) };
      }),
    );
    stubEventSource();

    const root = document.createElement('div');
    await mountXiangqiBroadcastBoard(root, 't-r-b1');

    expect(root.querySelector('.xqb-side-rail')).toBeNull();
    expect(root.querySelector('.xqb-round-select')).toBeNull();
    // The board page itself still renders.
    expect(root.querySelector('.xqb-board-frame')).not.toBeNull();
    expect(root.querySelector('.xqb-hero h1')?.textContent).toContain('Wang Tianyi');
  });
});

describe('event page (tabs, default round, standings)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState({}, '', '/');
  });

  const TOUR = {
    tour: { schema: XIANGQI_BROADCAST_SCHEMA, slug: 't', name: 'Test Cup' },
    rounds: ROUND.rounds,
    recordsSource: null,
  };

  it('opens the tour URL on the live round, with Boards as the default tab and the pairings rail', async () => {
    const urls: string[] = [];
    stubFetchJson((url) => {
      urls.push(url);
      return url.includes('/rounds/') ? ROUND : TOUR;
    });
    stubEventSource();

    const root = document.createElement('div');
    await mountXiangqiBroadcastTour(root, 't');

    // The broadcast reads, in order; the event's chat room loads beside them.
    expect(urls.filter((url) => url.startsWith('/api/xiangqi/'))).toEqual([
      '/api/xiangqi/broadcasts/t',
      '/api/xiangqi/broadcasts/t/rounds/r',
    ]);
    expect(urls).toContain('/api/chat/broadcast/t');
    // The tour URL resolves to a round page but is tracked as the tour surface.
    expect(broadcastOpenedCalls()).toEqual([
      { surface: 'tour', tour_slug: 't', round_id: 'r', locale: 'en' },
    ]);
    const tabs = [...root.querySelectorAll('.xqb-tab')];
    // lichess's order, Overview first; the event still opens on Boards.
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Overview', 'Boards', 'Players']);
    expect(root.querySelector('.xqb-tab-active')?.textContent).toBe('Boards');
    expect(root.querySelectorAll('.xqb-board-card')).toHaveLength(2);
    // The round's pairings sit in the rail with nothing highlighted.
    expect(root.querySelectorAll('.xqb-rail-row')).toHaveLength(2);
    expect(root.querySelector('.xqb-rail-row-current')).toBeNull();
  });

  it('opens the tour URL on the latest round with games when nothing is live', async () => {
    const urls: string[] = [];
    stubFetchJson((url) => {
      urls.push(url);
      if (url.includes('/rounds/')) return { ...ROUND, round: ROUND.rounds[1] };
      return {
        ...TOUR,
        rounds: [
          { ...ROUND.rounds[0], liveBoardCount: 0, completeBoardCount: 2 },
          { ...ROUND.rounds[1], boardCount: 3, completeBoardCount: 3 },
          { ...ROUND.rounds[1], id: 'r3', name: '第3轮', nameEn: 'Round 3', boardCount: 0 },
        ],
      };
    });
    stubEventSource();

    const root = document.createElement('div');
    await mountXiangqiBroadcastTour(root, 't');
    expect(urls[1]).toBe('/api/xiangqi/broadcasts/t/rounds/r2');
  });

  it('switches tabs in place: Overview lists the schedule, Players computes standings from every round', async () => {
    const finished = {
      ...ROUND,
      boards: [
        { ...ROUND.boards[0], status: 'complete', result: '1-0' },
        { ...ROUND.boards[1], status: 'complete', result: '1/2-1/2' },
      ],
    };
    stubFetchJson((url) =>
      url.includes('/rounds/r2') ? { ...finished, round: ROUND.rounds[1] } : finished,
    );
    stubEventSource();

    const root = document.createElement('div');
    await mountXiangqiBroadcastRound(root, 't', 'r');

    (root.querySelectorAll('.xqb-tab')[0] as HTMLButtonElement).click();
    expect(root.querySelector('.xqb-tab-active')?.textContent).toBe('Overview');
    expect(window.location.search).toBe('?tab=overview');
    // lichess's overview: one strip of facts and links, then the share box; no
    // schedule (the round select is the schedule) and no table of labels.
    expect(root.querySelector('.xqb-overview-strip')?.textContent).toContain('2 rounds');
    expect(root.querySelector('.xqb-round-row')).toBeNull();
    expect(root.querySelector('.xqb-facts')).toBeNull();
    expect(root.querySelectorAll('.xqb-share-url')).toHaveLength(2);

    (root.querySelectorAll('.xqb-tab')[2] as HTMLButtonElement).click();
    // The other rounds are fetched once the tab opens; then the table paints.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const rows = [...root.querySelectorAll('.xqb-standings tbody tr')].map((row) =>
      [...row.querySelectorAll('td')].map((cell) => cell.textContent),
    );
    // Round 1 + round 2 are the same two games twice: two wins for Wang, two draws each for the others.
    expect(rows[0]?.slice(0, 1).map((cell) => cell?.replace(/王天一.*$/, ''))).toEqual(['1']);
    expect(rows.map((row) => row[4])).toEqual(['2', '1', '1', '0']);
  });

  it('says why a round has no games instead of showing a bare zero', async () => {
    stubFetchJson(() => ({
      ...ROUND,
      boards: [],
      round: { ...ROUND.round, startsAt: '2020-01-01T09:00:00+08:00' },
      tour: { ...ROUND.tour, sourceUrl: 'mistboard-discover://dpxq-tour?tour=12524&tourSlug=t' },
    }));
    stubEventSource();

    const root = document.createElement('div');
    await mountXiangqiBroadcastRound(root, 't', 'r');
    const empty = root.querySelector('.xqb-empty');
    expect(empty?.textContent).toContain('No game records yet');
    expect(empty?.querySelector('a')?.getAttribute('href')).toBe(
      'http://www.dpxq.com/hldcg/movelist_12524.html',
    );
    // The left column stays, so the page keeps its shape and its chat: the
    // game list says there are none yet.
    expect(root.querySelector('.xqb-side-rail .xqb-rail-empty')?.textContent).toBe('No games yet');
    expect(root.querySelector('.xqb-event-side')).not.toBeNull();
  });

  it('renders round times in the event clock, not the viewer clock', async () => {
    stubFetchJson(() => ({
      ...ROUND,
      round: { ...ROUND.round, startsAt: '2026-09-13T14:30:00+08:00' },
    }));
    stubEventSource();

    const root = document.createElement('div');
    await mountXiangqiBroadcastRound(root, 't', 'r');
    expect(root.querySelector('.xqb-round-meta')?.textContent).toContain('2:30 PM');
  });
});

describe('mountXiangqiBroadcastBoard (finished board on the review shell)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const MOVES: XiangqiMove[] = [
    { from: 'b3', to: 'e3' },
    { from: 'h10', to: 'g8' },
  ];
  const replay = buildXiangqiReplayFromMoves(MOVES);
  const COMPLETE = {
    board: {
      id: 't-r-b1',
      tourSlug: 't',
      roundId: 'r',
      sourceBoardId: 'b1',
      boardNumber: 1,
      red: { name: '程宇东', nameEn: 'Cheng Yudong', federation: '广东' },
      black: { name: '顾博文', nameEn: 'Gu Bowen', federation: '上海' },
      status: 'complete',
      result: '0-1',
      plyCount: MOVES.length,
      moves: MOVES,
      sourceUrl: 'http://www.dpxq.com/hldcg/search/view_m_143066.html',
    },
    state: { status: { type: 'finished', winner: 'black', reason: 'resignation' }, moveNumber: 2 },
    timeline: timelineFrom(MOVES),
    view: replay.views[replay.maxPly]!,
    views: { truth: replay.views[replay.maxPly]! },
    history: { truth: replay.views.map((view, ply) => ({ ply, view })) },
  };

  it('mounts the shared review inside the event page for a finished game', async () => {
    stubFetchJson((url) =>
      url.includes('/api/xiangqi/broadcasts/boards/')
        ? COMPLETE
        : { ...ROUND, round: { ...ROUND.round, startsAt: '2026-09-09T14:30:00+08:00' } },
    );
    stubEventSource();

    const root = document.createElement('div');
    await mountXiangqiBroadcastBoard(root, 't-r-b1');

    // The board takes the event page's content column beside the round's
    // game list (lichess's relay), as the page's only content.
    const body = root.querySelector('.xqb-event-board-open .xqb-event-content > .xqb-event-body');
    expect(body?.querySelector('.review-shell--embedded')).not.toBeNull();
    expect(root.querySelector('.xqb-event-content')?.children.length).toBe(1);
    // Embedded: no info card or second rail inside the review.
    expect(root.querySelector('.game-meta-card')).toBeNull();
    expect(root.querySelector('.review-shell__left')).toBeNull();
    expect(root.querySelectorAll('.xqb-side-rail').length).toBe(1);
    expect(root.querySelector('.xiangqi-live-board')).not.toBeNull();
    expect(root.querySelector('.engine-panel')).not.toBeNull();
    expect(root.textContent).toContain('Computer analysis');
    expect(root.textContent).toContain('Cheng Yudong');
    // Provenance: the dpxq page, by host.
    const provenance = root.querySelector('.review-provenance');
    expect(provenance?.querySelector('a')?.getAttribute('href')).toBe(
      'http://www.dpxq.com/hldcg/search/view_m_143066.html',
    );
    expect(provenance?.querySelector('a')?.textContent).toBe('dpxq.com');
    // The round's game list, current board marked.
    const rail = root.querySelector('.xqb-side-rail');
    expect(rail?.querySelector('.xqb-rail-row-current')?.getAttribute('href')).toBe(
      '/broadcast/xiangqi/board/t-r-b1',
    );
    // The live-replay chrome is gone.
    expect(root.querySelector('.xqb-controls')).toBeNull();
    // The board surface fires its open event once; the review shell it hands
    // off to owns `review_opened` and does not get a second broadcast_opened.
    expect(broadcastOpenedCalls()).toEqual([
      { surface: 'board', tour_slug: 't', round_id: 'r', board_status: 'complete', locale: 'en' },
    ]);
  });
});

describe('broadcastPageForPath (in-place navigation)', () => {
  it('opens every reader page in place and leaves the rest to a page load', () => {
    for (const path of [
      '/broadcast/xiangqi',
      '/broadcast/xiangqi/calendar',
      '/broadcast/xiangqi/about',
      '/broadcast/xiangqi/2026-xiangqi-league',
      '/broadcast/xiangqi/2026-xiangqi-league/round/2026-xiangqi-league-r05',
      '/broadcast/xiangqi/board/2026-xiangqi-league-r05-b1',
    ]) {
      expect(broadcastPageForPath(path), path).not.toBeNull();
    }
    for (const path of [
      '/broadcast/xiangqi/ops',
      '/broadcast/xiangqi/board',
      '/broadcast/xiangqi/ops/round/r1',
      '/broadcast/xiangqi/a/b/c',
      '/players/wang-yubo',
      '/',
    ]) {
      expect(broadcastPageForPath(path), path).toBeNull();
    }
  });
});

describe('team league round (lichess: one grid, a team filter, matches on Teams)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState({}, '', '/');
  });

  const teamBoard = (
    n: number,
    red: [string, string],
    black: [string, string],
    match: string,
    kind: 'standard' | 'blitz',
  ) => ({
    ...fixtureBoard({
      n,
      red: red[0],
      black: black[0],
      moves: [],
      status: 'complete',
      result: '1-0',
    }),
    red: { name: red[0], federation: red[1] },
    black: { name: black[0], federation: black[1] },
    details: { match, table: 1, game: kind === 'blitz' ? 2 : 1, kind },
  });
  const TEAM_ROUND = {
    ...ROUND,
    boards: [
      teamBoard(1, ['甲', '浙江'], ['乙', '江苏'], '浙江-江苏', 'standard'),
      teamBoard(2, ['乙', '江苏'], ['甲', '浙江'], '浙江-江苏', 'blitz'),
      teamBoard(3, ['丙', '北京'], ['丁', '上海'], '北京-上海', 'standard'),
    ],
  };

  it('shows every game in one grid, narrows it to a team, and lists the matches on Teams', async () => {
    stubFetchJson(() => TEAM_ROUND);
    stubEventSource();
    const root = document.createElement('div');
    await mountXiangqiBroadcastRound(root, 't', 'r');

    const cards = () => root.querySelectorAll('.xqb-event-body .xqb-board-card');
    // No match sections nested in the Boards tab: one grid of all three.
    expect(root.querySelector('.xqb-event-body .xqb-match')).toBeNull();
    expect(root.querySelectorAll('.xqb-event-body .xqb-board-grid')).toHaveLength(1);
    expect(cards()).toHaveLength(3);

    const filter = root.querySelector<HTMLSelectElement>('.xqb-team-filter');
    expect([...(filter?.options ?? [])].map((option) => option.value)).toEqual([
      '',
      '上海',
      '北京',
      '江苏',
      '浙江',
    ]);
    filter!.value = '浙江';
    filter!.dispatchEvent(new Event('change'));
    // That team's two games, under its match's line.
    expect(cards()).toHaveLength(2);
    expect(root.querySelectorAll('.xqb-event-body .xqb-match')).toHaveLength(1);

    const teamsTab = [...root.querySelectorAll<HTMLButtonElement>('.xqb-tab')].find(
      (button) => button.textContent === 'Teams',
    );
    teamsTab!.click();
    await vi.waitFor(() => expect(root.querySelector('.xqb-standings')).not.toBeNull());
    const fixtures = root.querySelectorAll('.xqb-match-list .xqb-match');
    expect(fixtures).toHaveLength(2);
    // A match's Boards button opens the grid on that match.
    fixtures[1]!.querySelector<HTMLButtonElement>('.xqb-match-open')!.click();
    expect(root.querySelector('.xqb-tab-active')?.textContent).toBe('Boards');
    expect(cards()).toHaveLength(1);
  });
});

describe('eval gauge for a finished draw not analysed yet', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('draws it level rather than blank, in the list and on the card', async () => {
    stubFetchJson(() => ({
      ...ROUND,
      boards: [
        fixtureBoard({
          n: 1,
          red: 'R1',
          black: 'B1',
          moves: [],
          status: 'complete',
          result: '1/2-1/2',
        }),
      ],
    }));
    stubEventSource();
    const root = document.createElement('div');
    await mountXiangqiBroadcastRound(root, 't', 'r');
    const pill = root.querySelector<HTMLElement>(
      '.xqb-side-rail .xqb-rail-gauge .review-eval-bar__fill',
    );
    expect(pill?.style.height).toBe('50.0%');
    const card = root.querySelector<HTMLElement>('.xqb-card-gauge .review-eval-bar__fill');
    expect(card?.style.height).toBe('50.0%');
  });
});

describe('boards pager (lichess: pages, a page size that persists)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState({}, '', '/');
  });

  it('shows twelve boards a page by default, pages through, and remembers the page size', async () => {
    const stored = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => void stored.set(key, value),
      removeItem: (key: string) => void stored.delete(key),
    });
    const boards = Array.from({ length: 15 }, (_, i) =>
      fixtureBoard({
        n: i + 1,
        red: `R${i}`,
        black: `B${i}`,
        moves: [],
        status: 'complete',
        result: '1-0',
      }),
    );
    stubFetchJson(() => ({ ...ROUND, boards }));
    stubEventSource();
    const root = document.createElement('div');
    await mountXiangqiBroadcastRound(root, 't', 'r');

    const cards = () => root.querySelectorAll('.xqb-event-body .xqb-board-card').length;
    const count = () => root.querySelector('.xqb-pager-count')?.textContent;
    const buttons = () => root.querySelectorAll<HTMLButtonElement>('.xqb-pager-button');
    expect([count(), cards()]).toEqual(['1-12 / 15', 12]);
    expect(buttons()[0]?.disabled).toBe(true);
    buttons()[2]!.click();
    expect([count(), cards()]).toEqual(['13-15 / 15', 3]);
    expect(buttons()[3]?.disabled).toBe(true);

    const size = root.querySelector<HTMLSelectElement>('.xqb-per-page')!;
    size.value = '24';
    size.dispatchEvent(new Event('change'));
    // A new size starts again at the first page, and is kept for next time.
    expect([count(), cards()]).toEqual(['1-15 / 15', 15]);
    expect(stored.get('mistboard.broadcast.perPage')).toBe('24');
  });
});

describe("results-only boards (a round page's pairing and result, no moves)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const RESULTS_ROUND = {
    ...ROUND,
    tour: {
      schema: XIANGQI_BROADCAST_SCHEMA,
      slug: 't',
      name: '2024年第20届亚洲象棋个人锦标赛 男子组',
      nameEn: '2024 20th Asian Xiangqi Individual Championship Men',
    },
    boards: [
      {
        ...fixtureBoard({
          n: 1,
          red: '刘柏宏',
          redEn: 'Liu Bohong',
          black: '黄学谦',
          blackEn: 'Wong Hok Him',
          moves: [{ from: 'b3', to: 'e3' }],
          status: 'complete',
          result: '1-0',
        }),
        red: { name: '刘柏宏', nameEn: 'Liu Bohong', federation: '中国' },
        black: { name: '黄学谦', nameEn: 'Wong Hok Him', federation: '中国香港' },
        details: { match: '男子组', table: 1 },
      },
      {
        ...fixtureBoard({
          n: 2,
          red: '郑彦隆',
          redEn: 'Zheng Yanlong',
          black: '吴宗翰',
          blackEn: 'Wu Zonghan',
          moves: [],
          status: 'complete',
          result: '1-0',
        }),
        red: { name: '郑彦隆', nameEn: 'Zheng Yanlong', federation: '中国香港' },
        black: { name: '吴宗翰', nameEn: 'Wu Zonghan', federation: '新加坡' },
        details: { table: 2 },
      },
    ],
  };

  it('shows the players, the result and the start position, and opens nothing', async () => {
    stubFetchJson(() => RESULTS_ROUND);
    stubEventSource();
    const root = document.createElement('div');
    await mountXiangqiBroadcastRound(root, 't', 'r');

    const cards = [...root.querySelectorAll('.xqb-board-card')];
    expect(cards).toHaveLength(2);
    const [played, resultOnly] = cards;
    expect(played?.tagName).toBe('A');
    expect(resultOnly?.tagName).toBe('DIV');
    expect(resultOnly?.classList.contains('xqb-board-card-no-moves')).toBe(true);
    expect(resultOnly?.querySelector('.xqb-card-no-moves')?.textContent).toBe('Result only');
    // The start position still draws, under the label.
    expect(resultOnly?.querySelector('.xqb-card-board > svg.xq-live-svg')).not.toBeNull();
    expect(
      [...(resultOnly?.querySelectorAll('.xqb-score') ?? [])].map((node) => node.textContent),
    ).toEqual(['0', '1']);
    expect(resultOnly?.getAttribute('title')).toContain('without the game');

    const rows = [...root.querySelectorAll('.xqb-rail-row')];
    expect(rows.map((row) => row.tagName)).toEqual(['A', 'DIV']);
    expect(rows[1]?.classList.contains('xqb-rail-row-no-moves')).toBe(true);
  });

  it('an individual championship is not read as team matches', async () => {
    // Its records carry 男子组 and federations, the team championship's shape.
    stubFetchJson(() => RESULTS_ROUND);
    stubEventSource();
    const root = document.createElement('div');
    await mountXiangqiBroadcastRound(root, 't', 'r');
    expect(root.querySelector('.xqb-team-filter')).toBeNull();
    expect([...root.querySelectorAll('.xqb-tab')].map((tab) => tab.textContent)).not.toContain(
      'Teams',
    );
  });
});

describe('event header before any round exists', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('gives the dates and says nothing about rounds', async () => {
    stubFetchJson(() => ({
      tour: {
        schema: XIANGQI_BROADCAST_SCHEMA,
        slug: 't',
        name: 'Test Cup',
        startsAt: '2026-10-02T00:00:00+08:00',
        endsAt: '2026-10-08T23:59:59+08:00',
      },
      rounds: [],
    }));
    stubEventSource();
    const root = document.createElement('div');
    await mountXiangqiBroadcastTour(root, 't');
    const header = root.querySelector('.xqb-event-header')?.textContent ?? '';
    expect(header).toContain('Test Cup');
    expect(header).not.toMatch(/0 rounds/);
  });
});
