import assert from 'node:assert/strict';
import test from 'node:test';
import { GOMOKU_DEALT_OPENINGS, type GomokuOpening, RAPFI_LEVELS } from '@mistboard/game';
import { createGomokuEveAdapter, gomokuEveAdapter } from './gomoku-eve-adapter.js';
import { type GomokuEvent, gomokuTenant } from './gomoku-tenant.js';
import { playVariantEngineGame } from './variant-eve.js';
import { replayTenantEvents } from './variant-tenant/runtime.js';

function events(setup: GomokuOpening): GomokuEvent[] {
  return [{ type: 'room-created', roomId: 'gmk_eve_test', gameSpecId: 'gomoku', at: 1, setup }];
}

test('seeded setups use the live dealt pool and survive replay without re-dealing', () => {
  const seen = new Set<string>();
  for (let seed = 0n; seed < 100n; seed++) {
    const setup = gomokuEveAdapter.createSetup!(seed) as GomokuOpening;
    assert.deepEqual(setup, gomokuEveAdapter.createSetup!(seed));
    assert.ok(
      GOMOKU_DEALT_OPENINGS.some(
        ({ stones, turn }) => JSON.stringify({ stones, turn }) === JSON.stringify(setup),
      ),
    );
    const state = replayTenantEvents(gomokuTenant, events(setup)).state;
    assert.equal(state.status.type === 'playing' && state.status.turn, setup.turn);
    assert.equal(state.ply, setup.stones.length);
    assert.deepEqual(state.opening, setup);
    seen.add(JSON.stringify(setup));
  }
  assert.ok(seen.size > 20);
});

test('adapter resolves exactly the live tiers and validates placements through kernel legality', () => {
  for (const tier of RAPFI_LEVELS)
    assert.deepEqual(gomokuEveAdapter.tierFor(`rapfi-level-${tier.level}`), {
      id: `rapfi-level-${tier.level}`,
      movetimeMs: tier.timeMs,
    });
  assert.deepEqual(gomokuEveAdapter.tierFor('rapfi-level-8'), {
    id: 'rapfi-level-8',
    movetimeMs: 5000,
  });
  assert.deepEqual(gomokuEveAdapter.tierFor('rapfi-strongest'), {
    id: 'rapfi-strongest',
    movetimeMs: 5000,
  });
  for (const id of [
    'rapfi-level-9',
    'rapfi-level-01',
    'rapfi-strongest-x',
    'random-legal-gomoku',
    undefined,
  ])
    assert.equal(gomokuEveAdapter.tierFor(id), null);
  const state = replayTenantEvents(gomokuTenant, events(GOMOKU_DEALT_OPENINGS[0]!)).state;
  const legal = gomokuEveAdapter.legalMoves(state);
  for (const move of legal)
    assert.deepEqual(
      gomokuEveAdapter.legalMoveForUci(legal, gomokuEveAdapter.moveToUci(move)),
      move,
    );
  for (const uci of ['p1', 'a0', 'a16', 'h8h9', state.opening!.stones[0]!.square])
    assert.equal(gomokuEveAdapter.legalMoveForUci(legal, uci), null);
});

test('both colours replay the dealt board and history into the unchanged live provider', async () => {
  for (const color of ['black', 'white'] as const) {
    const setup: GomokuOpening = {
      stones: [
        { square: 'h8', color: 'black' },
        ...(color === 'black' ? [{ square: 'g8' as const, color: 'white' as const }] : []),
      ],
      turn: color,
    };
    const log = events(setup);
    const adapter = createGomokuEveAdapter(async (state, id, options) => {
      assert.equal(id, 'rapfi-strongest');
      assert.equal(state.status.type === 'playing' && state.status.turn, color);
      assert.deepEqual(state.opening, setup);
      assert.equal(state.ply, setup.stones.length);
      assert.equal(options.movetimeMs, 5000);
      // No candidate/selection/node overrides or alternate random seed.
      assert.deepEqual(Object.keys(options), ['movetimeMs']);
      return { to: 'i8' };
    });
    assert.deepEqual(
      await adapter.search(
        'rapfi-strongest',
        ['ignored'],
        { movetimeMs: 5000 },
        { events: log, color },
      ),
      { best: 'i8' },
    );
    await assert.rejects(
      adapter.search(
        'rapfi-strongest',
        [],
        { movetimeMs: 5000 },
        { events: log, color: color === 'black' ? 'white' : 'black' },
      ),
      /turn/,
    );
    const later: GomokuEvent[] = [
      ...log,
      {
        type: 'move-played',
        roomId: 'gmk_eve_test',
        at: 2,
        color,
        move: { to: 'i8' },
      },
    ];
    const nextColor = color === 'black' ? 'white' : 'black';
    const afterMove = createGomokuEveAdapter(async (state, id, options) => {
      assert.equal(id, 'rapfi-level-1');
      assert.equal(state.ply, setup.stones.length + 1);
      assert.equal(state.board[7 * 15 + 8], color);
      assert.equal(options.movetimeMs, RAPFI_LEVELS[0]!.timeMs);
      return null;
    });
    assert.deepEqual(
      await afterMove.search(
        'rapfi-level-1',
        [],
        { movetimeMs: RAPFI_LEVELS[0]!.timeMs },
        { events: later, color: nextColor },
      ),
      { best: null },
    );
    const bad = createGomokuEveAdapter(async () => ({ to: 'h8' }));
    await assert.rejects(
      bad.search('rapfi-strongest', [], { movetimeMs: 5000 }, { events: log, color }),
      /illegal/,
    );
  }
});

test('generic EvE completes and replays kernel games with Black/White seats and uniform floor', async () => {
  const adapter = {
    ...gomokuEveAdapter,
    createSetup: () => ({
      stones: [
        ...['d8', 'e8', 'f8', 'g8'].map((square) => ({ square, color: 'black' })),
        ...['c8', 'a1', 'c1', 'e1'].map((square) => ({ square, color: 'white' })),
      ],
      turn: 'black',
    }),
  };
  for (const swapped of [false, true]) {
    const result = await playVariantEngineGame(adapter, {
      firstEngineId: swapped ? 'random-legal-gomoku' : 'rapfi-strongest',
      secondEngineId: swapped ? 'rapfi-strongest' : 'random-legal-gomoku',
      roomId: 'gmk_eve_complete',
      maxPlies: 225,
      seed: '42',
      rng: () => 0,
      moveProvider: async ({ color, legalMoves }) => {
        assert.ok(color === 'black' || color === 'white');
        return legalMoves.find((move) => move.to === 'h8')?.to ?? legalMoves[0]!.to;
      },
    });
    if (swapped) {
      const firstMove = result.events.find((event) => event.type === 'move-played');
      assert.ok(firstMove?.type === 'move-played');
      // h8 wins immediately, but rng=0 selects the first legal point instead.
      const initial = replayTenantEvents(gomokuTenant, result.events.slice(0, 3)).state;
      assert.deepEqual(firstMove.move, adapter.legalMoves(initial)[0]);
      assert.notEqual(firstMove.move.to, 'h8');
    }
    assert.equal(result.status, 'completed');
    const state = replayTenantEvents(gomokuTenant, result.events).state;
    assert.equal(state.status.type, 'finished');
    assert.equal(
      result.result,
      state.status.type === 'finished' ? `${state.status.winner}-wins` : null,
    );
    assert.deepEqual(
      result.events.filter((e) => e.type === 'seat-assigned').map((e) => e.seat),
      ['black', 'white'],
    );
  }
});
