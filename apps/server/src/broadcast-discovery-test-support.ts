import { XIANGQI_BROADCAST_SCHEMA } from '@mistboard/game';
import type { BroadcastPageSources } from './broadcast-pages.js';
import { getPool } from './persistence-db.js';
import {
  importXiangqiBroadcastPack,
  type StoredXiangqiBroadcastBoard,
  type StoredXiangqiBroadcastRound,
  type StoredXiangqiBroadcastTour,
} from './persistence-xiangqi-broadcasts.js';

const at = new Date('2026-11-13T00:00:00Z');

/** Both events are A-level, so visibility alone decides discovery eligibility. */
export function broadcastDiscoveryFixture() {
  const tours: StoredXiangqiBroadcastTour[] = [true, false].map((listed) => ({
    schema: XIANGQI_BROADCAST_SCHEMA,
    slug: listed ? '2026-shanghai-cup' : '2026-xiangqi-league',
    name: listed ? 'Listed fixture cup' : 'Unlisted fixture cup',
    sourceUrl: `mistboard-discover://dpxq-tour?tour=${listed ? '12461' : '12528'}`,
    startsAt: at.toISOString(),
    endsAt: '2026-11-15T00:00:00Z',
    listed,
    pollMode: 'off',
    pollEnabled: false,
    pollIntervalMs: 30_000,
    createdAt: at,
    updatedAt: at,
  }));
  const rounds: StoredXiangqiBroadcastRound[] = tours.map((tour) => ({
    schema: XIANGQI_BROADCAST_SCHEMA,
    id: `${tour.slug}-r01`,
    tourSlug: tour.slug,
    name: 'Round 1',
    startsAt: at.toISOString(),
    createdAt: at,
    updatedAt: at,
  }));
  const boards: StoredXiangqiBroadcastBoard[] = rounds.flatMap((round) =>
    [false, true].map((live) => ({
      schema: XIANGQI_BROADCAST_SCHEMA,
      id: `${round.id}-${live ? 'live' : 'complete'}`,
      tourSlug: round.tourSlug,
      roundId: round.id,
      sourceBoardId: live ? 'live' : 'complete',
      boardNumber: live ? 2 : 1,
      red: { name: 'Shared fixture player', nameEn: 'Shared Fixture Player' },
      black: {
        name: round.tourSlug === tours[0]!.slug ? 'Listed opponent' : 'Unlisted opponent',
      },
      status: live ? 'live' : 'complete',
      result: live ? '*' : '1-0',
      moves: [{ from: 'h3', to: 'e3' }],
      plyCount: 1,
      finalStatus: { type: 'playing', turn: 'black' },
      createdAt: at,
      updatedAt: at,
    })),
  );
  const sources: BroadcastPageSources = {
    listTours: async () => tours,
    getTour: async (slug) => tours.find((tour) => tour.slug === slug) ?? null,
    listRounds: async (slug) => rounds.filter((round) => round.tourSlug === slug),
    listBoards: async (id) => boards.filter((board) => board.roundId === id),
    getBoard: async (id) => boards.find((board) => board.id === id) ?? null,
    playerSlugs: async () => new Map(),
    shareMeta: async () => null,
  };
  return { tours, rounds, boards, sources };
}

export async function seedBroadcastDiscoveryFixture() {
  const fixture = broadcastDiscoveryFixture();
  for (const tour of fixture.tours) {
    await importXiangqiBroadcastPack({
      tour,
      rounds: fixture.rounds.filter((round) => round.tourSlug === tour.slug),
      boards: fixture.boards.filter((board) => board.tourSlug === tour.slug),
    });
    await getPool().query('UPDATE xiangqi_broadcast_tours SET listed = $2 WHERE slug = $1', [
      tour.slug,
      tour.listed,
    ]);
  }
  return fixture;
}

/**
 * Three listed events, one finished board each, told apart only by where they
 * were relayed from: a board read from dpxq.com, a board under a tour that
 * dpxq discovery found (the board itself names no source), and a board from
 * another site. The last one is the control every dpxq check must keep.
 */
export function broadcastSourceFixture() {
  const base = broadcastDiscoveryFixture();
  const tour0 = base.tours[0]!;
  const round0 = base.rounds[0]!;
  const board0 = base.boards.find((board) => board.roundId === round0.id && board.result !== '*')!;
  const events = [
    {
      key: 'elsewhere',
      slug: '2026-source-fixture-elsewhere',
      tourUrl: 'https://vietnamchess.vn/databank/xqbase-vietnamchess',
      boardUrl: 'https://vietnamchess.vn/databank/xqbase-vietnamchess?view=game&id=1640',
    },
    {
      key: 'dpxqBoard',
      slug: '2026-source-fixture-dpxq-board',
      tourUrl: undefined,
      boardUrl: 'http://www.dpxq.com/hldcg/search/view_m_123456.html',
    },
    {
      key: 'dpxqTour',
      slug: '2026-source-fixture-dpxq-tour',
      tourUrl: 'mistboard-discover://dpxq-tour?tour=13001',
      boardUrl: undefined,
    },
  ] as const;
  const packs = events.map((event) => {
    const { sourceUrl: _tourUrl, ...tourRest } = tour0;
    const tour: StoredXiangqiBroadcastTour = {
      ...tourRest,
      slug: event.slug,
      name: `Source fixture ${event.key}`,
      ...(event.tourUrl ? { sourceUrl: event.tourUrl } : {}),
    };
    const round: StoredXiangqiBroadcastRound = {
      ...round0,
      id: `${event.slug}-r01`,
      tourSlug: event.slug,
    };
    const { sourceUrl: _boardUrl, ...boardRest } = board0;
    const board: StoredXiangqiBroadcastBoard = {
      ...boardRest,
      id: `${event.slug}-r01-complete`,
      tourSlug: event.slug,
      roundId: round.id,
      ...(event.boardUrl ? { sourceUrl: event.boardUrl } : {}),
    };
    return { key: event.key, tour, round, board };
  });
  const byKey = Object.fromEntries(packs.map((pack) => [pack.key, pack])) as Record<
    (typeof events)[number]['key'],
    (typeof packs)[number]
  >;
  const sources: BroadcastPageSources = {
    ...base.sources,
    listTours: async () => packs.map((pack) => pack.tour),
    getTour: async (slug) => packs.find((pack) => pack.tour.slug === slug)?.tour ?? null,
    listRounds: async (slug) =>
      packs.filter((pack) => pack.tour.slug === slug).map((pack) => pack.round),
    listBoards: async (id) =>
      packs.filter((pack) => pack.round.id === id).map((pack) => pack.board),
    getBoard: async (id) => packs.find((pack) => pack.board.id === id)?.board ?? null,
  };
  return { packs, byKey, sources };
}

export async function seedBroadcastSourceFixture() {
  const fixture = broadcastSourceFixture();
  for (const pack of fixture.packs) {
    await importXiangqiBroadcastPack({
      tour: pack.tour,
      rounds: [pack.round],
      boards: [pack.board],
    });
    await getPool().query('UPDATE xiangqi_broadcast_tours SET listed = true WHERE slug = $1', [
      pack.tour.slug,
    ]);
  }
  return fixture;
}
