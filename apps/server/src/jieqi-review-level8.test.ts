import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createInitialJieqiState,
  createJieqiChasePosition,
  getJieqiLegalMoves,
  type JieqiColor,
  type JieqiGameState,
  type JieqiPieceRole,
  type JieqiSquare,
  jieqiRepetitionPositionKey,
  STANDARD_JIEQI_DEAL,
} from '@mistboard/game';
import {
  ABJCHESS_JIEQI_ANALYSIS_ENGINE_ID,
  ABJCHESS_JIEQI_ANALYSIS_PROFILE,
  ABJCHESS_JIEQI_DECISIONS_ENGINE_ID,
  ABJCHESS_PRE_CHASEDEFAULT_ANALYSIS_ENGINE_ID,
  ABJCHESS_PRE_CHASEDEFAULT_DECISIONS_ENGINE_ID,
  analyzeJieqiDecisions,
  currentJieqiAnalysisProfile,
  evaluateJieqiPosition,
  JIEQI_ANALYSIS_NODES,
  JIEQI_PRE_LEVEL8_ANALYSIS_ENGINE_ID,
  JIEQI_PRE_LEVEL8_DECISIONS_ENGINE_ID,
  jieqiDecisionDepsFromSession,
  PIKAFISH_JIEQI_ANALYSIS_PROFILE,
  resolveJieqiAnalysis,
  resolveJieqiDecisions,
} from './jieqi-analysis.js';
import {
  buildJieqiAnalysisCommands,
  buildJieqiAnalysisInitCommands,
  type JieqiAnalysisRequest,
  jieqiAnalysisEngine,
  jieqiAnalysisEngineAvailable,
} from './jieqi-engine.js';
import {
  jieqiMoveToPikafishUci,
  jieqiStateToPikafishFen,
  pikafishUciToJieqiMove,
} from './jieqi-fen.js';
import { jieqiTenant } from './jieqi-tenant.js';

test('new review grading prefers AB-JChess and falls back only without its binary or net', () => {
  const keys = ['MISTBOARD_ABJCHESS_PATH', 'MISTBOARD_ABJCHESS_NET', 'MISTBOARD_PIKAFISH_PATH'];
  const prior = keys.map((key) => process.env[key]);
  try {
    // Existence is enough for engine selection; no fake binary or net is executed.
    process.env.MISTBOARD_ABJCHESS_PATH = process.execPath;
    process.env.MISTBOARD_ABJCHESS_NET = process.execPath;
    process.env.MISTBOARD_PIKAFISH_PATH = process.execPath;
    assert.equal(jieqiAnalysisEngine(), 'ab-jchess');
    assert.match(ABJCHESS_JIEQI_ANALYSIS_ENGINE_ID, /\+chasedefault/);
    assert.match(ABJCHESS_JIEQI_DECISIONS_ENGINE_ID, /\+chasedefault/);
    assert.equal(ABJCHESS_JIEQI_ANALYSIS_PROFILE.winK, 0.00269);
    assert.equal(currentJieqiAnalysisProfile(), ABJCHESS_JIEQI_ANALYSIS_PROFILE);
    assert.equal(jieqiAnalysisEngineAvailable(), true);
    assert.ok(
      buildJieqiAnalysisInitCommands('pikafish-jieqi').includes('setoption name Hash value 256'),
    );
    process.env.MISTBOARD_PIKAFISH_PATH = '/missing/level8-pikafish';
    assert.equal(jieqiAnalysisEngineAvailable(), true, 'AB-JChess does not need Pikafish');
    process.env.MISTBOARD_ABJCHESS_NET = '/missing/ab-net';
    assert.equal(jieqiAnalysisEngine(), 'pikafish-jieqi');
    assert.equal(jieqiAnalysisEngineAvailable(), false);
    process.env.MISTBOARD_PIKAFISH_PATH = process.execPath;
    assert.equal(currentJieqiAnalysisProfile(), PIKAFISH_JIEQI_ANALYSIS_PROFILE);
    assert.equal(jieqiAnalysisEngineAvailable(), true);
  } finally {
    keys.forEach((key, index) => {
      if (prior[index] === undefined) delete process.env[key];
      else process.env[key] = prior[index];
    });
  }
});

test('analysis UCI restricts roots after its node budget and preserves public history', () => {
  const commands = buildJieqiAnalysisCommands('public anchor', {
    nodes: 600_000,
    movetimeMs: 30_000,
    moves: ['e0e1', 'e9e8'],
    searchMoves: ['a3a4', 'c3c4'],
  });
  assert.equal(commands.at(-2), 'position fen public anchor moves e0e1 e9e8');
  assert.equal(commands.at(-1), 'go nodes 600000 movetime 30000 searchmoves a3a4 c3c4');
});

test('a reveal divides one node budget among distinct possible roles, with a 200K floor', async () => {
  const played = { from: 'b1', to: 'c3' } as const;
  for (const base of [ABJCHESS_JIEQI_ANALYSIS_PROFILE, PIKAFISH_JIEQI_ANALYSIS_PROFILE]) {
    for (const total of [6_000_000, base.decisionEval.nodes!]) {
      const requests: JieqiAnalysisRequest[] = [];
      const profile = {
        ...base,
        decisionCandidates: 'multipv' as const,
        decisionEval: { nodes: total, movetimeMs: 30_000 },
      };
      const deps = jieqiDecisionDepsFromSession(
        {
          evaluateFen: async (_fen, opts) => {
            requests.push(opts);
            return { cp: 25, mate: null, best: null, depth: 4 };
          },
          multiPv: async () => [],
        },
        profile,
      );
      const [result] = await analyzeJieqiDecisions(
        [played],
        STANDARD_JIEQI_DEAL,
        deps,
        undefined,
        profile,
      );
      assert.ok(result);
      assert.equal(requests.length, 6, 'six distinct roles, not fifteen individual pieces');
      assert.deepEqual(
        requests.map((opts) => opts.nodes),
        Array(6).fill(Math.max(200_000, Math.floor(total / 6))),
      );
      assert.ok(requests.every((opts) => opts.depth === undefined && opts.fresh));
    }
  }
});

test('ranking plus every candidate pool stays within one Level 8 reveal budget', async () => {
  let nodes = 0;
  const deps = jieqiDecisionDepsFromSession(
    {
      evaluateFen: async (_fen, opts) => {
        assert.ok(opts.nodes && opts.nodes >= 200_000);
        nodes += opts.nodes;
        return { cp: 25, mate: null, best: null, depth: 4 };
      },
      multiPv: async (_fen, opts) => {
        nodes += opts.nodes!;
        return ['a0a1', 'c0e2', 'g0e2'].map((move, i) => ({
          move,
          index: i + 1,
          cp: 0,
          mate: null,
          depth: 4,
          pv: [move],
          bound: null,
        }));
      },
    },
    PIKAFISH_JIEQI_ANALYSIS_PROFILE,
  );
  const [decision] = await analyzeJieqiDecisions(
    [{ from: 'b1', to: 'c3' }],
    STANDARD_JIEQI_DEAL,
    deps,
    undefined,
    PIKAFISH_JIEQI_ANALYSIS_PROFILE,
  );
  assert.equal(decision!.candidates!.length, 4);
  assert.ok(nodes <= JIEQI_ANALYSIS_NODES);
  assert.ok(
    nodes > JIEQI_ANALYSIS_NODES * 0.99,
    'the full budget is shared, not repeated per role/move',
  );
});

test('a review search is restricted to the kernel public legal roots', async () => {
  const state = createInitialJieqiState('roots', STANDARD_JIEQI_DEAL);
  await evaluateJieqiPosition(state, async (_fen, opts) => {
    assert.deepEqual(opts.searchMoves, getJieqiLegalMoves(state).map(jieqiMoveToPikafishUci));
    return { cp: 25, mate: null, best: 'e0e1' };
  });
});

test('the kernel capture clock scores a root draw without asking a rule50-blind engine', async () => {
  const state = createInitialJieqiState('clock', STANDARD_JIEQI_DEAL);
  // Generals and a blocker: every legal move is capture-free.
  state.board = {
    e1: { color: 'red', role: 'general', faceDown: false },
    e10: { color: 'black', role: 'general', faceDown: false },
    e5: { color: 'red', role: 'soldier', faceDown: false },
  };
  for (const limit of [80, 120]) {
    state.adjudicationRule = limit === 80 ? 'jqe-v1' : undefined;
    state.noCaptureClock = limit - 1;
    const result = await evaluateJieqiPosition(state, async () =>
      assert.fail('all roots draw by the kernel clock'),
    );
    assert.equal(result.cp, 0);
    assert.equal(result.mate, null);
    assert.ok(
      getJieqiLegalMoves(state).some((move) => jieqiMoveToPikafishUci(move) === result.best),
    );
  }
});

// Sparse public positions/cycles from the kernel's jqe conformance fixtures.
function position(
  pieces: Record<string, string>,
  turn: JieqiColor,
  stamped: boolean,
): JieqiGameState {
  const state = createInitialJieqiState('rules');
  const roles: Record<string, JieqiPieceRole> = { K: 'general', R: 'chariot', N: 'horse' };
  const board: JieqiGameState['board'] = {};
  for (const [uci, code] of Object.entries(pieces)) {
    const square = `${uci[0]}${Number(uci[1]) + 1}` as JieqiSquare;
    board[square] = {
      color: code === code.toUpperCase() ? 'red' : 'black',
      role: roles[code.toUpperCase()]!,
      faceDown: false,
    };
  }
  const rule = stamped ? 'jqe-v1' : undefined;
  const key = jieqiRepetitionPositionKey(board, turn, rule);
  return {
    ...state,
    board,
    status: { type: 'playing', turn },
    adjudicationRule: rule,
    positionCounts: { [key]: 1 },
    repetitionLog: [{ key, ...(rule ? { chase: createJieqiChasePosition(board) } : {}) }],
  };
}

function play(state: JieqiGameState, moves: string[]): JieqiGameState {
  for (const uci of moves) {
    const next = jieqiTenant.rules.applyMove(state, pikafishUciToJieqiMove(uci)!);
    assert.notEqual(next, state, `legal fixture move ${uci}`);
    state = next;
  }
  return state;
}

test('review roots keep twofold playable and score the neutral third occurrence as a draw', async () => {
  const cycle = ['e0f0', 'd9d8', 'f0e0', 'd8d9'];
  const initial = position({ e0: 'K', d9: 'k' }, 'red', true);
  const beforeSecond = play(initial, cycle.slice(0, 3));
  await evaluateJieqiPosition(beforeSecond, async (_fen, opts) => {
    assert.ok(opts.searchMoves!.includes('d8d9'), 'the second occurrence is not terminal');
    return { cp: 20, mate: null, best: 'd8d9' };
  });
  const beforeThird = play(initial, [...cycle, ...cycle.slice(0, 3)]);
  const result = await evaluateJieqiPosition(beforeThird, async (_fen, opts) => {
    assert.ok(!opts.searchMoves!.includes('d8d9'), 'kernel draw is removed from engine search');
    return { cp: -200, mate: null, best: opts.searchMoves![0]! };
  });
  assert.equal(result.cp, 0);
  assert.equal(result.best, 'd8d9');
});

test('review roots score the perpetual checker as losing under legacy and stamped rules', async () => {
  const cycle = ['e9f9', 'e7f7', 'f9e9', 'f7e7'];
  for (const stamped of [false, true]) {
    const before = play(position({ d0: 'K', e9: 'k', e7: 'R' }, 'black', stamped), [
      ...cycle,
      ...cycle.slice(0, 3),
    ]);
    await evaluateJieqiPosition(before, async (_fen, opts) => {
      assert.ok(
        !opts.searchMoves!.includes('f7e7'),
        'checking loss is removed regardless of engine score',
      );
      return { cp: 20, mate: null, best: opts.searchMoves![0]! };
    });
  }
});

test('review roots distinguish a stamped perpetual-chase win from a legacy draw', async () => {
  const cycle = ['a1b1', 'b3a5', 'b1a1', 'a5b3'];
  for (const stamped of [false, true]) {
    const before = play(position({ d0: 'K', e9: 'k', a1: 'R', b3: 'n', h7: 'n' }, 'red', stamped), [
      ...cycle,
      ...cycle.slice(0, 3),
    ]);
    const result = await evaluateJieqiPosition(before, async (_fen, opts) => {
      assert.ok(!opts.searchMoves!.includes('a5b3'));
      return { cp: -500, mate: null, best: opts.searchMoves![0]! };
    });
    assert.equal(result.best, 'a5b3');
    assert.equal(result.mate, null, 'a rule loss is not a board mate');
    assert.equal(result.cp, stamped ? -30_000 : 0, 'red POV: the stamped red chaser loses');
  }
});

test('new grading preserves historical AB-JChess and pre-Level-8 Pikafish cache rows', async () => {
  for (const [analysisId, decisionsId] of [
    [ABJCHESS_PRE_CHASEDEFAULT_ANALYSIS_ENGINE_ID, ABJCHESS_PRE_CHASEDEFAULT_DECISIONS_ENGINE_ID],
    [
      PIKAFISH_JIEQI_ANALYSIS_PROFILE.analysisEngineId,
      PIKAFISH_JIEQI_ANALYSIS_PROFILE.decisionsEngineId,
    ],
    [JIEQI_PRE_LEVEL8_ANALYSIS_ENGINE_ID, JIEQI_PRE_LEVEL8_DECISIONS_ENGINE_ID],
  ]) {
    const plies = [{ ply: 0, cp: 37, mate: null, best: null }];
    const analysis = await resolveJieqiAnalysis(
      'cached',
      [],
      STANDARD_JIEQI_DEAL,
      {
        get: async (_room, id) => (id === analysisId ? plies : null),
        save: async () => assert.fail('cached rows are immutable'),
      },
      async () => assert.fail('cached games are not regraded'),
    );
    assert.equal(analysis!.engineId, analysisId);
    assert.deepEqual(analysis!.plies, plies);
    const decisions = [
      { ply: 1, mover: 'red' as const, bestWin: 70, playedWin: 60, realizedWin: 50, playedRank: 2 },
    ];
    const result = await resolveJieqiDecisions(
      'cached',
      [],
      STANDARD_JIEQI_DEAL,
      {
        get: async (_room, id) => (id === decisionsId ? decisions : null),
        save: async () => assert.fail('cached rows are immutable'),
      },
      async () => assert.fail('cached games are not regraded'),
    );
    assert.equal(result!.engineId, decisionsId);
    assert.deepEqual(result!.decisions, decisions);
    const regraded = await resolveJieqiDecisions(
      'explicit-regrade',
      [],
      STANDARD_JIEQI_DEAL,
      {
        get: async (_room, id) => (id === decisionsId ? decisions : null),
        save: async (_room, id) =>
          assert.equal(id, ABJCHESS_JIEQI_ANALYSIS_PROFILE.decisionsEngineId),
      },
      async () => [],
      true,
      ABJCHESS_JIEQI_ANALYSIS_PROFILE,
      { servePreviousAlgorithms: false },
    );
    assert.equal(regraded!.engineId, ABJCHESS_JIEQI_ANALYSIS_PROFILE.decisionsEngineId);
    assert.deepEqual(regraded!.decisions, []);
  }
});

test('a known draw cannot mask a scoreless search of a capture that could avoid it', async () => {
  const state = position({ e0: 'K', d9: 'k', a1: 'R', a2: 'n' }, 'red', false);
  state.noCaptureClock = 119;
  const result = await evaluateJieqiPosition(state, async (_fen, opts) => {
    assert.ok(opts.searchMoves!.includes('a1a2'), 'capture resets the clock');
    return { cp: null, mate: null, best: null };
  });
  assert.equal(result.cp, null);
  assert.equal(result.mate, null);
});

test('AB candidate ranking keeps the canonical clock, repetition, check and chase verdicts', async () => {
  const neutral = ['e0f0', 'd9d8', 'f0e0', 'd8d9'];
  const checks = ['e9f9', 'e7f7', 'f9e9', 'f7e7'];
  const chases = ['a1b1', 'b3a5', 'b1a1', 'a5b3'];
  const cases: Array<{ state: JieqiGameState; move: string; cp: number }> = [];
  for (const stamped of [false, true]) {
    const clock = position({ e0: 'K', d9: 'k' }, 'red', stamped);
    clock.noCaptureClock = stamped ? 79 : 119;
    cases.push({ state: clock, move: 'e0f0', cp: 0 });
    cases.push({
      state: play(position({ e0: 'K', d9: 'k' }, 'red', stamped), [
        ...neutral,
        ...neutral.slice(0, 3),
      ]),
      move: 'd8d9',
      cp: 0,
    });
    cases.push({
      state: play(position({ d0: 'K', e9: 'k', e7: 'R' }, 'black', stamped), [
        ...checks,
        ...checks.slice(0, 3),
      ]),
      move: 'f7e7',
      cp: -30_000,
    });
    cases.push({
      state: play(position({ d0: 'K', e9: 'k', a1: 'R', b3: 'n', h7: 'n' }, 'red', stamped), [
        ...chases,
        ...chases.slice(0, 3),
      ]),
      move: 'a5b3',
      cp: stamped ? 30_000 : 0,
    });
  }
  for (const { state, move, cp } of cases) {
    const deps = jieqiDecisionDepsFromSession(
      {
        evaluateFen: async (_fen, opts) => {
          assert.notEqual(opts.moves?.at(-1), move, 'kernel-terminal roots never reach the engine');
          assert.ok(opts.searchMoves?.length, 'child roots are restricted by the kernel');
          return { cp: 10, mate: null, best: null, depth: 3 };
        },
        multiPv: async () => assert.fail('AB ranks legal moves instead of MultiPV'),
      },
      ABJCHESS_JIEQI_ANALYSIS_PROFILE,
    );
    const fen = jieqiStateToPikafishFen(state, { public: true });
    const table = await deps.multiPv(fen, {
      fen,
      moves: [],
      state,
      decisionWindow: { anchor: state, moves: [] },
    });
    assert.equal(
      table.find((line) => line.move === move)?.cp,
      cp,
      `${move} under ${state.adjudicationRule ?? 'legacy'} rules`,
    );
  }
});
