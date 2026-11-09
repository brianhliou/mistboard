import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  JIEQI_SPEC_ID,
  type JieqiMove,
  jieqiHomeSquares,
  STANDARD_JIEQI_DEAL,
} from '@mistboard/game';
import { pgnStandardTermination } from './game-export-shared.js';
import {
  analyzeJieqiDecisions,
  analyzeJieqiPostgame,
  PIKAFISH_JIEQI_ANALYSIS_PROFILE,
} from './jieqi-analysis.js';
import {
  getJieqiClientView,
  jieqiClientEventFor,
  jieqiPublicEvents,
  jieqiTenant,
} from './jieqi-tenant.js';
import { jieqiAnalysisInputsFromEvents } from './routes/jieqi-games.js';
import {
  createTenantRuntimeRoom,
  createTenantRuntimeRoomFromEvents,
  replayTenantEvents,
  tenantSnapshotPayload,
} from './variant-tenant/runtime.js';
import type { TenantRoomEvent } from './variant-tenant/tenant.js';

const test: (name: string, fn: () => void | Promise<void>) => unknown = (
  process.env.VITEST ? await import('vitest') : await import('node:test')
).test;

process.env.MISTBOARD_JIEQI_ENABLED = 'true';

type Event = TenantRoomEvent<'red' | 'black', JieqiMove, typeof JIEQI_SPEC_ID>;
// Legal capture-free game: repetition:true draws at 120; jqe-v1 ends at 80.
const LINE =
  'd1-e2 h8-e8 h3-h7 b8-b4 a4-a5 a10-a9 g1-e3 e8-f8 h1-f2 a9-f9 e3-c5 b4-b5 c5-a3 f8-f6 b3-d3 b5-b2 h7-h6 f6-f4 a1-a2 f4-f6 a3-c5 f6-f4 h6-h7 i7-i6 a5-a6 b2-b4 h7-h4 f9-b9 d3-d8 b4-b7 d8-c8 f4-f5 h4-h5 g10-i8 h5-h1 f5-f8 a2-a5 f8-f9 h1-h9 d10-e9 i4-i5 e10-d10 i1-i3 d10-d9 c8-e8 f9-g9 h9-h8 d9-d10 e8-c8 c7-c6 e2-d3 h10-g8 g4-g5 g9-f9 a5-a1 b9-a9 i3-h3 f9-i9 a6-b6 g8-h10 b1-a3 a9-a8 c8-g8 a8-c8 f1-e2 d10-d9 a3-c2 c8-f8 h3-h1 b10-a8 h1-f1 a7-a6 e2-f3 a8-b10 f2-d1 f8-f9 c2-d4 f9-h9 f3-g2 i8-g6 h8-h1 i9-i8 g8-b8 c10-a8 a1-b1 g6-e8 b8-b9 h9-h3 b9-b8 e9-d8 b8-b9 f10-e9 f1-f8 h10-g8 e4-e5 e9-f10 f8-f2 d9-d10 b9-b8 h3-h5 f2-c2 f10-g9 e1-e2 d10-e10 b8-c8 e8-c10 h1-e1 g9-h10 b1-b4 b7-a7 d4-f3 e10-e9 e1-g1 e9-f9 d1-c3 i10-i9 c3-a4 h10-g9 f3-d2 i8-i7';
function events(setup: unknown, count = 120): Event[] {
  const roomId = 'jq_jqe_860';
  return [
    { type: 'room-created', roomId, at: 1, gameSpecId: JIEQI_SPEC_ID, setup },
    ...LINE.split(' ')
      .slice(0, count)
      .map((token, i): Event => {
        const [from, to] = token.split('-');
        return {
          type: 'move-played',
          roomId,
          at: i + 2,
          color: i % 2 === 0 ? 'red' : 'black',
          move: { from, to } as JieqiMove,
        };
      }),
  ];
}
const oldSetup = { ...STANDARD_JIEQI_DEAL, repetition: true };
const newSetup = { ...oldSetup, adjudicationRule: 'jqe-v1' };

test('review analysis preserves the stored rules and the 80/120-ply terminal verdict', async () => {
  for (const [setup, limit] of [
    [oldSetup, 120],
    [newSetup, 80],
  ] as const) {
    const inputs = jieqiAnalysisInputsFromEvents(events(setup));
    assert.ok(inputs);
    assert.deepEqual(inputs.rules, {
      repetition: true,
      ...(limit === 80 ? { adjudicationRule: 'jqe-v1' } : {}),
    });
    const result = await analyzeJieqiPostgame(
      inputs.moves,
      inputs.deal,
      async (state) => {
        assert.equal(state.adjudicationRule, limit === 80 ? 'jqe-v1' : undefined);
        assert.ok(state.positionCounts);
        return { cp: 10, mate: null, best: null };
      },
      undefined,
      PIKAFISH_JIEQI_ANALYSIS_PROFILE,
      inputs.rules,
    );
    assert.equal(result.plies[limit]!.cp, 0);
    assert.equal(result.plies[limit - 1]!.cp, 10);
    const decisions = await analyzeJieqiDecisions(
      inputs.moves,
      inputs.deal,
      {
        multiPv: async () => [],
        evalPosition: async () => ({ cp: 25, mate: null }),
      },
      undefined,
      PIKAFISH_JIEQI_ANALYSIS_PROFILE,
      inputs.rules,
    );
    assert.ok(decisions.length > 0);
    assert.ok(decisions.every((decision) => decision.ply <= limit));
  }
});

test('new rooms stamp jqe-v1; absent/unknown stamps never opt in implicitly', () => {
  const room = createTenantRuntimeRoom(jieqiTenant, 'jq_stamp', { now: 1 });
  assert.ok(room.ok);
  const created = room.room.events[0]!;
  if (created.type !== 'room-created') throw Error('missing setup');
  assert.equal((created.setup as { adjudicationRule?: unknown }).adjudicationRule, 'jqe-v1');
  assert.equal(room.room.projection.state.adjudicationRule, 'jqe-v1');
  assert.equal(
    jieqiTenant.rules.createInitialState('legacy', oldSetup).adjudicationRule,
    undefined,
  );
  assert.equal(
    jieqiTenant.rules.createInitialState('legacy', undefined).adjudicationRule,
    undefined,
  );
  for (const value of ['future', '', null, false, 1]) {
    assert.throws(
      () => replayTenantEvents(jieqiTenant, events({ ...oldSetup, adjudicationRule: value }, 0)),
      /adjudication/,
    );
    assert.throws(
      () => jieqiPublicEvents(events({ ...oldSetup, adjudicationRule: value }, 0)),
      /adjudication/,
    );
  }
  assert.throws(
    () => jieqiTenant.rules.createInitialState('invalid', { ...newSetup, repetition: false }),
    /requires repetition/,
  );
});

test('the same stored game keeps its 120-ply old ending, while the stamped game ends at 80', () => {
  const oldAt80 = replayTenantEvents(jieqiTenant, events(oldSetup, 80)).state;
  assert.equal(oldAt80.status.type, 'playing');
  assert.equal(oldAt80.noCaptureClock, 80);
  const legacy = replayTenantEvents(jieqiTenant, events(oldSetup)).state;
  assert.deepEqual(legacy.status, { type: 'finished', winner: null, reason: 'no-capture-clock' });
  assert.equal(legacy.noCaptureClock, 120);
  const stamped = replayTenantEvents(jieqiTenant, events(newSetup)).state;
  assert.deepEqual(stamped.status, legacy.status);
  assert.equal(stamped.noCaptureClock, 80);
  const publicReplay = replayTenantEvents(jieqiTenant, jieqiPublicEvents(events(newSetup))).state;
  assert.equal(publicReplay.adjudicationRule, 'jqe-v1');
  assert.deepEqual(publicReplay.status, stamped.status);
  assert.equal(publicReplay.noCaptureClock, 80);
  const oldPublic = replayTenantEvents(jieqiTenant, jieqiPublicEvents(events(oldSetup))).state;
  assert.equal(oldPublic.adjudicationRule, undefined);
  assert.equal(oldPublic.noCaptureClock, 120);
});

test('whole stamped client views and public replay logs survive unseen identity swaps', () => {
  // Neither c1 nor c4 moves in the first 80 plies.
  const swapped = { ...newSetup, red: [...newSetup.red], black: [...newSetup.black] };
  const home = jieqiHomeSquares('red'),
    a = home.indexOf('c1'),
    b = home.indexOf('c4');
  [swapped.red[a], swapped.red[b]] = [swapped.red[b]!, swapped.red[a]!];
  for (const count of [1, 79, 80]) {
    const one = events(newSetup, count),
      two = events(swapped, count);
    assert.equal(JSON.stringify(jieqiPublicEvents(one)), JSON.stringify(jieqiPublicEvents(two)));
    const left = replayTenantEvents(jieqiTenant, one).state;
    const right = replayTenantEvents(jieqiTenant, two).state;
    assert.deepEqual(left.status, right.status);
    for (const seat of ['red', 'black', 'spectator'] as const) {
      const first = JSON.stringify(getJieqiClientView(left, { id: 'client', seat, solo: false }));
      assert.equal(
        first,
        JSON.stringify(getJieqiClientView(right, { id: 'client', seat, solo: false })),
      );
      for (const field of ['positionCounts', 'repetitionLog', 'chase', 'adjudicationRule'])
        assert.equal(first.includes(`"${field}"`), false);
      assert.equal(JSON.stringify(jieqiClientEventFor(one[0]!, seat, 0)).includes('setup'), false);
    }
  }
});

test('whole live snapshots expose only the public rule stamp and survive hidden identity swaps', () => {
  const swapped = { ...newSetup, red: [...newSetup.red] };
  const home = jieqiHomeSquares('red');
  const a = home.indexOf('c1'),
    b = home.indexOf('c4');
  [swapped.red[a], swapped.red[b]] = [swapped.red[b]!, swapped.red[a]!];
  const payload = (setup: unknown, seat: 'red' | 'black' | 'spectator') => {
    const created = createTenantRuntimeRoomFromEvents(jieqiTenant, events(setup, 1));
    if (!created.ok) throw new Error(created.error);
    return {
      ...tenantSnapshotPayload(jieqiTenant, created.room, {
        id: `client-${seat}`,
        seat,
        solo: false,
      }),
      serverAt: 0,
    };
  };
  for (const seat of ['red', 'black', 'spectator'] as const) {
    const left = payload(newSetup, seat);
    const serialized = JSON.stringify(left);
    assert.equal((left as Record<string, unknown>).adjudicationRule, 'jqe-v1');
    assert.equal(serialized, JSON.stringify(payload(swapped, seat)));
    for (const field of ['setup', 'deal', 'positionCounts', 'repetitionLog', 'chase'])
      assert.equal(serialized.includes(`"${field}"`), false);
    assert.equal('adjudicationRule' in payload(oldSetup, seat), false);
  }
});

test('chase termination persists distinctly; legacy chasing keeps its original meaning', () => {
  for (const reason of ['chasing', 'perpetual-chase'] as const) {
    assert.equal(jieqiTenant.persistence.termination(reason), reason);
    assert.equal(pgnStandardTermination(reason), 'normal');
  }
  assert.throws(
    () => jieqiTenant.persistence.termination('future-reason'),
    /unknown jieqi termination/,
  );
  const migration = readFileSync(
    new URL('../migrations/192_add_perpetual_chase_termination.sql', import.meta.url),
    'utf8',
  );
  assert.ok(migration.includes("'chasing'"));
  assert.ok(migration.includes("'perpetual-chase'"));
  assert.equal(/UPDATE\s+games/i.test(migration), false);
});

import {
  createJieqiChasePosition,
  type JieqiBoard,
  type JieqiGameState,
  jieqiMoveToPikafishUci,
  jieqiPlyReveal,
  jieqiRepetitionPositionKey,
} from '@mistboard/game';
import {
  buildTenantGamePgn,
  buildTenantGamePublicationJson,
  tenantExportBinding,
} from './game-export-tenant.js';
import { jieqiRuleEndingRisk } from './jieqi-draw-guard.js';
import type { RecentEveGameRecord } from './persistence.js';
import { jieqiPostgameForApi, jieqiWatchPostgameForApi } from './routes/jieqi-games.js';

function summary(
  termination: RecentEveGameRecord['termination'] = 'progress-clock',
): RecentEveGameRecord {
  return {
    roomId: 'jq_jqe_860',
    variant: JIEQI_SPEC_ID,
    mode: 'pvp',
    result: 'draw',
    termination,
    plyCount: 80,
    startedAt: new Date(1),
    endedAt: new Date(81),
    whiteName: null,
    blackName: null,
    corpusId: null,
    rated: false,
    visibility: 'private',
    participants: [],
    jobId: null,
    gameIndex: null,
    whiteEngineId: null,
    blackEngineId: null,
    timeControl: null,
    initialMs: null,
    incrementMs: null,
  };
}

test('stamped postgame and watch replays end at the same 80-ply clock as the live room', async () => {
  const deps = {
    getGameSummary: async () => summary(),
    loadRoomEvents: async () => events(newSetup, 80),
  };
  const postgame = await jieqiPostgameForApi('jq_jqe_860', deps);
  const watch = await jieqiWatchPostgameForApi('jq_jqe_860', deps);
  assert.ok(postgame && watch);
  for (const payload of [postgame, watch]) {
    assert.deepEqual(payload.state.status, {
      type: 'finished',
      winner: null,
      reason: 'no-capture-clock',
    });
    const wire = JSON.stringify(payload);
    assert.equal(wire.includes('repetitionLog'), false);
    assert.equal(wire.includes('positionCounts'), false);
  }
});

test('Jieqi PGN and JSON preserve the distinct chase reason and winner', () => {
  const binding = tenantExportBinding(jieqiTenant, {
    gameRouteBase: '/jieqi/game',
    uci: jieqiMoveToPikafishUci,
    publicEvents: (log) => jieqiPublicEvents(log as Event[]),
    hiddenPieces: { variant: 'jieqi', reveal: jieqiPlyReveal },
  });
  const game = binding.finishedGame(events(newSetup, 80), 'jq_jqe_860');
  assert.ok(game);
  for (const termination of ['chasing', 'perpetual-chase'] as const) {
    const record = { ...summary(termination), result: 'black-wins' as const };
    const pgn = buildTenantGamePgn(record, game, '/jieqi/game');
    assert.ok(pgn);
    assert.ok(pgn.includes(`[MistboardTermination "${termination}"]`));
    assert.ok(pgn.includes('[Result "0-1"]'));
    const json = buildTenantGamePublicationJson(record, game, '/jieqi/game');
    assert.equal(json.termination, termination);
    assert.equal(json.result, 'black');
    assert.equal(JSON.stringify(json).includes('repetitionLog'), false);
  }
});

function chaseState(stamped: boolean): JieqiGameState {
  const board: JieqiBoard = {
    d1: { color: 'red', role: 'general', faceDown: false },
    e10: { color: 'black', role: 'general', faceDown: false },
    a2: { color: 'red', role: 'chariot', faceDown: false },
    b4: { color: 'black', role: 'horse', faceDown: false },
    h8: { color: 'black', role: 'horse', faceDown: false },
  };
  const base = jieqiTenant.rules.createInitialState('jq_chase', stamped ? newSetup : oldSetup);
  const key = jieqiRepetitionPositionKey(board, 'red', base.adjudicationRule);
  return {
    ...base,
    board,
    positionCounts: { [key]: 1 },
    repetitionLog: [{ key, ...(stamped ? { chase: createJieqiChasePosition(board) } : {}) }],
  };
}

test('the live tenant and bot guard distinguish stamped chase losses from legacy repetition draws', () => {
  const cycle: JieqiMove[] = [
    { from: 'a2', to: 'b2' },
    { from: 'b4', to: 'a6' },
    { from: 'b2', to: 'a2' },
    { from: 'a6', to: 'b4' },
  ];
  for (const stamped of [false, true]) {
    let state = chaseState(stamped);
    for (const move of [...cycle, ...cycle.slice(0, 2)])
      state = jieqiTenant.rules.applyMove(state, move);
    assert.deepEqual(jieqiRuleEndingRisk(state, cycle[2]!), {
      outcome: stamped ? 'loss' : 'draw',
      reason: stamped ? 'perpetual-chase' : 'repetition',
      via: 'reply',
    });
    const end = jieqiTenant.rules.applyMove(
      jieqiTenant.rules.applyMove(state, cycle[2]!),
      cycle[3]!,
    );
    assert.deepEqual(end.status, {
      type: 'finished',
      winner: stamped ? 'black' : null,
      reason: stamped ? 'perpetual-chase' : 'repetition',
    });
  }
  const stamped = jieqiTenant.rules.createInitialState('jq_reveal_clock', newSetup);
  assert.deepEqual(
    jieqiRuleEndingRisk({ ...stamped, noCaptureClock: 79 }, { from: 'a4', to: 'a5' }),
    {
      outcome: 'draw',
      reason: 'no-capture-clock',
      via: 'move',
    },
  );
});
