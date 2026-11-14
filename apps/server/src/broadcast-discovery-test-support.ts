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
