import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyFFQBanqiMove,
  createFFQBanqiDeal,
  createFFQBanqiStateFromSetup,
  FFQ_BANQI_SPEC_ID,
  FFQ_BANQI_WIN_PCT_K,
  getFFQBanqiLegalMoves,
  moveJudgment,
  winPercent,
  winPercentK,
} from '@mistboard/game';
import {
  analyzeFFQBanqiPostgame,
  evaluateFFQBanqiPosition,
  FFQ_BANQI_ANALYSIS_DEPTH,
  FFQ_BANQI_ANALYSIS_ENGINE_ID,
  FFQ_BANQI_RESEARCH_NODES,
  type FFQBanqiAnalysisCache,
  resolveFFQBanqiAnalysis,
} from './ffq-banqi-analysis.js';
import { FFQ_BANQI_DECISIONS_ENGINE_ID } from './ffq-banqi-decisions.js';
import {
  buildFFQBanqiEngineCommands,
  FFQ_BANQI_ENGINE_VERSION,
  type FFQBanqiEngineProvider,
  type FFQBanqiEngineRequest,
  ffqBanqiMoveToUci,
} from './ffq-banqi-engine.js';
import { type FFQBanqiEvent, ffqBanqiTenant } from './ffq-banqi-tenant.js';
import type { AnalysisProgress, AnalysisProgressStore } from './game-analysis-kernel.js';
import { type SweepPlyEval, VacuousAnalysisError } from './game-analysis-sweep.js';
import { replayTenantEvents } from './variant-tenant/runtime.js';

const ROOM = 'ffq_analysis';
const deal = createFFQBanqiDeal(800);
const created = {
  type: 'room-created',
  at: 1,
  roomId: ROOM,
  gameSpecId: FFQ_BANQI_SPEC_ID,
  setup: { deal },
} as const;
const events: FFQBanqiEvent[] = [created];
let state = createFFQBanqiStateFromSetup(ROOM, { deal });
for (let ply = 0; ply < 24 && state.status.type === 'playing'; ply += 1) {
  const legal = getFFQBanqiLegalMoves(state);
  const captures = legal.filter((move) => move.from !== move.to && state.board[move.to]);
  const quiet = legal.filter((move) => move.from !== move.to && !state.board[move.to]);
  const flips = legal.filter((move) => move.from === move.to);
  const move =
    captures[0] ??
    (ply % 4 !== 0 ? quiet[(ply * 7) % Math.max(quiet.length, 1)] : undefined) ??
    flips[(ply * 5) % Math.max(flips.length, 1)] ??
    legal[0]!;
  events.push({ type: 'move-played', at: ply + 2, roomId: ROOM, color: state.status.turn, move });
  state = applyFFQBanqiMove(state, move);
}
const finished: FFQBanqiEvent[] = [
  ...events,
  { type: 'seat-resigned', at: 100, roomId: ROOM, color: 'black' },
];
const score: FFQBanqiEngineProvider = async (request) => ({
  protocolVersion: request.protocolVersion,
  gameId: request.gameId,
  sessionId: request.sessionId,
  move: request.legalMoves[0]!,
  cp: 42,
  mate: null,
});

test('replays N+1 positions at classical L7 and normalizes scores to the red seat', async () => {
  const requests: FFQBanqiEngineRequest[] = [];
  const result = await analyzeFFQBanqiPostgame(finished, async (request) => {
    requests.push(request);
    return score(request);
  });
  assert.equal(result.plies.length, events.length);
  assert.equal(result.engineId, FFQ_BANQI_ANALYSIS_ENGINE_ID);
  assert.equal(result.depth, FFQ_BANQI_ANALYSIS_DEPTH);
  assert.ok(
    result.engineId.includes(
      `@${FFQ_BANQI_ENGINE_VERSION}+misty-ffq-banqi-level-7-n25000-classical`,
    ),
  );
  assert.deepEqual(
    result.plies.map((entry) => entry.cp),
    result.plies.map((_, ply) => (ply % 2 === 0 ? 42 : -42)),
  );
  assert.ok(state.captures.length > 0, 'the line includes captures');
  // A constant side-to-move score swings each mover's win% by about 11 points, so the
  // bounce rule re-searches some positions deeper; the sweep itself is one request a point.
  const sweep = requests.filter((request) => request.nodes === 25_000);
  assert.equal(sweep.length, events.length);
  for (const request of requests) {
    assert.equal(request.engineId, 'misty-ffq-banqi-level-7');
    assert.ok(request.nodes === 25_000 || request.nodes === FFQ_BANQI_RESEARCH_NODES);
    assert.equal(request.movetimeCapMs, request.nodes === 25_000 ? 3_000 : 20_000);
    assert.equal(request.position.view.perspective, request.color === 'white' ? 'red' : 'black');
  }
});

test('swapping two still-covered identities changes no engine input or analysis payload', async () => {
  const covered = state.board.flatMap((piece, index) => (piece?.faceDown ? [index] : []));
  const i = covered[0]!;
  const j = covered.find(
    (index) => deal[index]!.color !== deal[i]!.color || deal[index]!.role !== deal[i]!.role,
  );
  assert.notEqual(j, undefined, 'the swap changes two distinct pieces');
  const swappedDeal = [...deal];
  [swappedDeal[i], swappedDeal[j!]] = [swappedDeal[j!]!, swappedDeal[i]!];
  const swapped = [{ ...created, setup: { deal: swappedDeal } }, ...finished.slice(1)];
  assert.notDeepEqual(
    replayTenantEvents(ffqBanqiTenant, finished).state.board,
    replayTenantEvents(ffqBanqiTenant, swapped).state.board,
  );
  const inputs: string[][] = [[], []];
  const results = [];
  for (const [index, log] of [finished, swapped].entries()) {
    results.push(
      await analyzeFFQBanqiPostgame(log, async (request) => {
        inputs[index]!.push(
          JSON.stringify({ request, commands: buildFFQBanqiEngineCommands(request) }),
        );
        return score(request);
      }),
    );
  }
  assert.ok(inputs[0]!.length > events.length, 'the sweep plus its deeper re-searches');
  assert.deepEqual(inputs[0], inputs[1], 'every serialized request and stdin block');
  assert.equal(JSON.stringify(results[0]), JSON.stringify(results[1]), 'whole analysis payload');
});

test('mate scores use seat POV; terminal positions bypass the engine', async () => {
  const black = replayTenantEvents(ffqBanqiTenant, events.slice(0, 2)).state;
  assert.deepEqual(
    await evaluateFFQBanqiPosition(black, async (request) => ({
      ...(await score(request)),
      cp: null,
      mate: 3,
    })),
    { cp: null, mate: -3, best: ffqBanqiMoveToUci(getFFQBanqiLegalMoves(black)[0]!) },
  );
  const terminal = replayTenantEvents(ffqBanqiTenant, finished).state;
  for (const winner of ['red', 'black', null] as const) {
    assert.deepEqual(
      await evaluateFFQBanqiPosition(
        {
          ...terminal,
          status: { type: 'finished', winner, reason: winner ? 'hp' : 'no-progress' },
        },
        async () => {
          throw new Error('terminal position must not query engine');
        },
      ),
      { cp: winner === 'red' ? 30_000 : winner === 'black' ? -30_000 : 0, mate: null, best: null },
    );
  }
});

test('checkpoints resume without re-evaluating completed positions; missing deal fails closed', async () => {
  let checkpoint: AnalysisProgress<SweepPlyEval> | null = null;
  const progress: AnalysisProgressStore<SweepPlyEval> = {
    load: async () => checkpoint,
    save: async (value) => {
      checkpoint = { ...value, items: [...value.items] };
    },
  };
  let calls = 0;
  await assert.rejects(
    analyzeFFQBanqiPostgame(
      events.slice(0, 4),
      async (request) => {
        calls += 1;
        if (calls === 3) throw new Error('interrupted');
        return score(request);
      },
      progress,
    ),
    /interrupted/,
  );
  calls = 0;
  const result = await analyzeFFQBanqiPostgame(
    events.slice(0, 4),
    async (request) => {
      if (request.nodes === 25_000) calls += 1;
      return score(request);
    },
    progress,
  );
  assert.equal(calls, 2, 'only the two unfinished sweep points');
  assert.equal(result.plies.length, 4);
  await assert.rejects(
    analyzeFFQBanqiPostgame([{ ...created, setup: undefined }], score),
    /missing_deal/,
  );
});

test('cache reads never compute; concurrent requests coalesce and reload uses cache', async () => {
  let stored: SweepPlyEval[] | null = null;
  let saves = 0;
  const cache: FFQBanqiAnalysisCache = {
    get: async () => stored,
    save: async (_room, _engine, _depth, plies) => {
      saves += 1;
      stored = plies;
    },
  };
  let calls = 0;
  const analyze = async () => {
    calls += 1;
    return analyzeFFQBanqiPostgame(events.slice(0, 3), score);
  };
  assert.equal(await resolveFFQBanqiAnalysis(ROOM, events, cache, analyze, false), null);
  assert.equal(calls, 0);
  const [a, b] = await Promise.all([
    resolveFFQBanqiAnalysis(ROOM, events, cache, analyze),
    resolveFFQBanqiAnalysis(ROOM, events, cache, analyze),
  ]);
  assert.deepEqual(a, b);
  assert.equal(calls, 1);
  assert.equal(saves, 1);
  assert.deepEqual(await resolveFFQBanqiAnalysis(ROOM, events, cache, analyze, false), a);
  assert.equal(calls, 1);
});

test('an all-null engine sweep is rejected and never cached', async () => {
  let saves = 0;
  const cache: FFQBanqiAnalysisCache = {
    get: async () => null,
    save: async () => {
      saves += 1;
    },
  };
  await assert.rejects(
    resolveFFQBanqiAnalysis('ffq_vacuous', events, cache, (log) =>
      analyzeFFQBanqiPostgame(log, async (request) => ({
        ...(await score(request)),
        cp: null,
        mate: null,
      })),
    ),
    VacuousAnalysisError,
  );
  assert.equal(saves, 0);
});

// Grades the way the review does: the mover's win% before and after, on the curve the stored
// engine id names. Null entries are ungraded (unstable evals ungrade both moves they touch).
function gradeSeries(plies: SweepPlyEval[]): (string | null)[] {
  const win = (entry: SweepPlyEval) =>
    winPercent(entry.cp, entry.mate, FFQ_BANQI_ANALYSIS_ENGINE_ID);
  const ungraded = new Set<number>();
  plies.forEach((entry, index) => {
    if (!entry.unstable) return;
    ungraded.add(index);
    ungraded.add(index + 1);
  });
  return plies.map((entry, k) => {
    if (k === 0 || ungraded.has(k)) return null;
    const redMoved = k % 2 === 1;
    const before = win(plies[k - 1]!);
    const after = win(entry);
    return moveJudgment(redMoved ? before : 100 - before, redMoved ? after : 100 - after);
  });
}

test('a side-to-move bounce is re-searched deeper, while a sustained drop stays a blunder', async () => {
  // Plies whose move neither flips nor captures a covered piece: the only ones a bounce rule may
  // judge, since a reveal legitimately moves the value.
  const deterministic = new Set<number>();
  let replay = replayTenantEvents(ffqBanqiTenant, [created]).state;
  events.slice(1).forEach((event, index) => {
    if (event.type !== 'move-played') return;
    if (!replay.board[event.move.to]?.faceDown) deterministic.add(index + 1);
    replay = applyFFQBanqiMove(replay, event.move);
  });
  const bounce = [...deterministic].find(
    (k) => k % 2 === 1 && k >= 3 && deterministic.has(k + 1) && k + 4 < events.length,
  );
  assert.notEqual(bounce, undefined, 'the line has two quiet moves in a row after a red move');
  const drop = [...deterministic].find((k) => k % 2 === 1 && k > bounce! + 3);
  assert.notEqual(drop, undefined, 'the line has a later quiet red move');
  // Red-POV targets. Around the bounce the shallow search reads 1306 / 345 / 1306 (the shape seen
  // in a real FFQ review); the deeper search agrees with both neighbours. The planted drop is a
  // real one: red's move gives up 1000cp and no deeper search changes it.
  const red = (ply: number, deep: boolean): number => {
    if (ply === bounce) return deep ? 1300 : 345;
    return ply >= drop! ? -1000 : 1306;
  };
  const researched: number[] = [];
  const result = await analyzeFFQBanqiPostgame(finished, async (request) => {
    const deep = request.nodes > 25_000;
    if (deep) researched.push(request.ply);
    const cp = red(request.ply, deep) * (request.color === 'white' ? 1 : -1);
    return { ...(await score(request)), cp };
  });
  const grades = gradeSeries(result.plies);
  assert.deepEqual(researched, [bounce], 'only the out-of-line position is re-searched');
  assert.equal(result.plies[bounce!]!.cp, 1300, 'the deeper score replaces the shallow one');
  assert.equal(grades[bounce!], null, 'the move into the bounce is not a mistake');
  assert.equal(grades[bounce! + 1], null, 'nor the move out of it');
  assert.equal(grades[drop!], 'blunder', 'a sustained drop is still a blunder');
  assert.deepEqual(
    grades.flatMap((grade, ply) => (grade ? [ply] : [])),
    [drop],
    'no other graded move anywhere',
  );
  assert.ok(result.plies.every((entry) => !entry.unstable));
});

test('a bounce the deeper search confirms stays graded; one it moves without settling is unstable', async () => {
  const deterministic = new Set<number>();
  let replay = replayTenantEvents(ffqBanqiTenant, [created]).state;
  events.slice(1).forEach((event, index) => {
    if (event.type !== 'move-played') return;
    if (!replay.board[event.move.to]?.faceDown) deterministic.add(index + 1);
    replay = applyFFQBanqiMove(replay, event.move);
  });
  const bounce = [...deterministic].find(
    (k) => k % 2 === 1 && k >= 3 && deterministic.has(k + 1) && k + 4 < events.length,
  )!;
  const run = (shallowCp: number, deepCp: number) =>
    analyzeFFQBanqiPostgame(finished, async (request) => {
      const deep = request.nodes > 25_000;
      const value = request.ply === bounce ? (deep ? deepCp : shallowCp) : 1306;
      return { ...(await score(request)), cp: value * (request.color === 'white' ? 1 : -1) };
    });
  // Confirmed: red gave something up and black did not take it. Both are real mistakes.
  const confirmed = await run(345, 345);
  assert.equal(confirmed.plies[bounce]!.unstable, undefined);
  assert.deepEqual(gradeSeries(confirmed.plies).slice(bounce, bounce + 2), ['mistake', 'mistake']);
  // The deeper search moves the value by more than the threshold but not into line: neither
  // budget can be trusted to grade the two moves it sits between.
  const shifted = await run(-500, 345);
  assert.equal(shifted.plies[bounce]!.cp, 345);
  assert.equal(shifted.plies[bounce]!.unstable, true);
  assert.deepEqual(gradeSeries(shifted.plies).slice(bounce, bounce + 2), [null, null]);
});

test('the reconciled analysis id keeps the fitted win curve and leaves the luck id unchanged', () => {
  assert.ok(FFQ_BANQI_ANALYSIS_ENGINE_ID.endsWith('-winfit20261113-reconcile1'));
  assert.equal(winPercentK(FFQ_BANQI_ANALYSIS_ENGINE_ID), FFQ_BANQI_WIN_PCT_K);
  assert.equal(
    FFQ_BANQI_DECISIONS_ENGINE_ID,
    `misty-ffq-banqi-decisions@${FFQ_BANQI_ENGINE_VERSION}+misty-ffq-banqi-level-7-n25000-classical-ms3000-masked2-winfit20261113-d1-top-played`,
  );
});

test('a board ending includes the terminal point without an engine request', async () => {
  let current = createFFQBanqiStateFromSetup(ROOM, { deal });
  const log: FFQBanqiEvent[] = [created];
  while (current.status.type === 'playing' && current.ply < 100) {
    const legal = getFFQBanqiLegalMoves(current);
    const move =
      legal.find((m) => m.from !== m.to && current.board[m.to]) ??
      legal.find((m) => m.from === m.to) ??
      legal[0]!;
    log.push({
      type: 'move-played',
      at: current.ply + 2,
      roomId: ROOM,
      color: current.status.turn,
      move,
    });
    current = applyFFQBanqiMove(current, move);
  }
  assert.equal(current.status.type, 'finished');
  let calls = 0;
  const result = await analyzeFFQBanqiPostgame(log, async (request) => {
    if (request.nodes === 25_000) calls++;
    return score(request);
  });
  assert.equal(calls, current.ply);
  assert.equal(result.plies.length, current.ply + 1);
  assert.deepEqual(result.plies.at(-1), {
    ply: current.ply,
    ...(await evaluateFFQBanqiPosition(current)),
  });
});
