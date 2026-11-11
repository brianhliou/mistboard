import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { GomokuEvent } from './gomoku-tenant.js';
import type { GameSummary } from './persistence.js';
import { seedVariantFixture } from './seed-variant-fixtures.js';

const roomId = 'gmk_seed_test';
function events(): GomokuEvent[] {
  return [
    {
      type: 'room-created',
      at: 1,
      roomId,
      gameSpecId: 'gomoku',
      setup: {
        stones: [
          { square: 'h8', color: 'white' },
          { square: 'i8', color: 'black' },
          { square: 'h9', color: 'white' },
          { square: 'i9', color: 'black' },
        ],
        turn: 'black',
      },
    },
    ...['a1', 'a15', 'b1', 'c15', 'c1', 'e15', 'd1', 'g15', 'e1'].map((to, index) => ({
      type: 'move-played' as const,
      at: index + 2,
      roomId,
      color: index % 2 ? ('white' as const) : ('black' as const),
      move: { to } as Extract<GomokuEvent, { type: 'move-played' }>['move'],
    })),
  ];
}

function store() {
  const writes: Array<{ roomId: string; seq: number; event: unknown }> = [];
  const games: Array<{ roomId: string; summary: GameSummary }> = [];
  return {
    writes,
    games,
    appendRoomEvent: async (id: string, seq: number, event: unknown) => {
      writes.push({ roomId: id, seq, event });
    },
    recordGameEnd: async (id: string, summary: GameSummary) => {
      games.push({ roomId: id, summary });
    },
  };
}

test('dev seeding replays Gomoku opening and placements into an unrated finished game', async () => {
  const persistence = store();
  const log = events();
  const report = await seedVariantFixture(log, 'gomoku.jsonl', persistence);
  assert.match(report, /gmk_seed_test plies=9 black-wins \/ five/);
  assert.deepEqual(
    persistence.writes,
    log.map((event, seq) => ({ roomId, seq, event })),
  );
  assert.equal(persistence.games.length, 1);
  const summary = persistence.games[0]!.summary;
  assert.equal(summary.variant, 'gomoku');
  assert.equal(summary.plyCount, 9, 'opening stones are not played plies');
  assert.equal(summary.result, 'black-wins');
  assert.equal(summary.termination, 'race');
  assert.equal(summary.rated, false);
  assert.equal(summary.mode, 'eve');
  assert.equal(summary.visibility, 'public');
  assert.equal(summary.corpusId, 'variant-postgame-fixture');
  assert.equal(summary.whiteName, 'Random self-play (white)');
  assert.equal(summary.blackName, 'Random self-play (black)');
});

test('the committed Gomoku fixture can be seeded through the same dev path', async () => {
  const raw = readFileSync(
    new URL('../fixtures/variant-postgame/gomoku.jsonl', import.meta.url),
    'utf8',
  );
  const log = raw
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const persistence = store();
  await seedVariantFixture(log, 'gomoku.jsonl', persistence);
  assert.equal(persistence.games[0]?.summary.variant, 'gomoku');
  assert.equal(persistence.games[0]?.summary.plyCount, log.length - 1);
});

test('dev seeding refuses live, aborted, invalid and unknown fixtures before writes', async () => {
  for (const log of [
    events().slice(0, -1),
    [events()[0]!, { type: 'game-aborted', at: 2, roomId, reason: 'no-start' }],
    events().map((event, index) =>
      index === 2
        ? { type: 'move-played', at: 3, roomId, color: 'white', move: { to: 'a1' } }
        : event,
    ),
    [{ type: 'room-created', at: 1, roomId, gameSpecId: 'unknown' }],
  ]) {
    const persistence = store();
    await assert.rejects(seedVariantFixture(log, 'invalid.jsonl', persistence));
    assert.deepEqual(persistence.writes, []);
    assert.deepEqual(persistence.games, []);
  }
});
