import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  applyThreeKingdomsBanqiMove,
  type BanqiPiece,
  banqiPieceLetter,
  createThreeKingdomsBanqiSetup,
  createThreeKingdomsBanqiStateFromSetup,
  getThreeKingdomsBanqiLegalMoves,
  moveJudgment,
  THREE_KINGDOMS_BANQI_SETUP_SQUARES,
  THREE_KINGDOMS_BANQI_SPEC_ID,
  type ThreeKingdomsBanqiSquare,
  type ThreeKingdomsBanqiState,
  winPercent,
} from '@mistboard/game';
import type { AnalysisProgress, AnalysisProgressStore } from './game-analysis-kernel.js';
import { VacuousAnalysisError } from './game-analysis-sweep.js';
import { threeKingdomsBanqiTierRequestFor } from './server-three-kingdoms-banqi-engine.js';
import { THREE_KINGDOMS_BANQI_ANALYSIS_TIER } from './three-kingdoms-banqi-analysis.js';
import {
  analyzeThreeKingdomsBanqiDecisions,
  evaluateThreeKingdomsBanqiFlipDecision,
  resolveThreeKingdomsBanqiDecisions,
  THREE_KINGDOMS_BANQI_DECISION_MOVETIME_CAP_MS,
  THREE_KINGDOMS_BANQI_DECISION_NODES,
  THREE_KINGDOMS_BANQI_DECISIONS_ENGINE_ID,
  type ThreeKingdomsBanqiDecision,
  type ThreeKingdomsBanqiDecisionsCache,
} from './three-kingdoms-banqi-decisions.js';
import {
  buildThreeKingdomsBanqiEngineCommands,
  type ThreeKingdomsBanqiEngineProvider,
  type ThreeKingdomsBanqiEngineRequest,
} from './three-kingdoms-banqi-engine.js';
import type { ThreeKingdomsBanqiEvent } from './three-kingdoms-banqi-tenant.js';

const ROOM = 'tkb_decisions';
let seed = 934;
const setup = createThreeKingdomsBanqiSetup(() => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 0x100000000;
});
const created: ThreeKingdomsBanqiEvent = {
  type: 'room-created',
  at: 1,
  roomId: ROOM,
  gameSpecId: THREE_KINGDOMS_BANQI_SPEC_ID,
  setup,
};
const previousNet = process.env.MISTBOARD_THREE_KINGDOMS_BANQI_NET;
before(() => {
  process.env.MISTBOARD_THREE_KINGDOMS_BANQI_NET = fileURLToPath(import.meta.url);
});
after(() => {
  if (previousNet === undefined) delete process.env.MISTBOARD_THREE_KINGDOMS_BANQI_NET;
  else process.env.MISTBOARD_THREE_KINGDOMS_BANQI_NET = previousNet;
});

function response(cp: number | null, best: string | null = null) {
  return { cp, mate: null, best, depth: 1 };
}

const constant: ThreeKingdomsBanqiEngineProvider = async (request) =>
  response(300, request.searchMoves?.[0]);

function eventsForFlips(count: number): ThreeKingdomsBanqiEvent[] {
  const events: ThreeKingdomsBanqiEvent[] = [created];
  let state = createThreeKingdomsBanqiStateFromSetup(ROOM, setup);
  for (let i = 0; i < count && state.status.type === 'playing'; i += 1) {
    const move = getThreeKingdomsBanqiLegalMoves(state).find((m) => m.from === m.to)!;
    events.push({ type: 'move-played', at: i + 2, roomId: ROOM, color: state.status.turn, move });
    state = applyThreeKingdomsBanqiMove(state, move);
  }
  return events;
}

// A fixed public bag: two red soldiers and one black soldier. The enemy rook
// on b1 can take a red outcome on a1; the remote i5 square is safe. Captures
// account for every other starting tile (their locations are never read).
function fixture(): ThreeKingdomsBanqiState {
  const initial = createThreeKingdomsBanqiStateFromSetup(ROOM, setup);
  const board: ThreeKingdomsBanqiState['board'] = {
    a1: { color: 'red', role: 'soldier', faceDown: true },
    i5: { color: 'black', role: 'soldier', faceDown: true },
    i4: { color: 'red', role: 'soldier', faceDown: true },
    b1: { color: 'black', role: 'chariot', faceDown: false },
    h5: { color: 'red', role: 'horse', faceDown: false },
  };
  const retained = Object.values(board).map((piece) => banqiPieceLetter(piece!));
  const captures = Object.values(initial.board).flatMap((piece) => {
    const index = retained.indexOf(banqiPieceLetter(piece!));
    if (index >= 0) {
      retained.splice(index, 1);
      return [];
    }
    return [{ owner: piece!.color, role: piece!.role }];
  });
  return { ...initial, board, firstColor: 'red', captures, repCounts: {}, ply: 10, moveNumber: 6 };
}

function boardAt(fen: string, square: ThreeKingdomsBanqiSquare): string | undefined {
  const row = fen.split(' ')[0]!.split('/')[5 - Number(square[1])]!;
  let file = 0;
  for (const char of row) {
    if (/\d/.test(char)) file += Number(char);
    else {
      if (file === square.charCodeAt(0) - 97) return char;
      file += 1;
    }
  }
  return undefined;
}

const tactical: ThreeKingdomsBanqiEngineProvider = async (request) => {
  if (request.searchMoves)
    return response(
      0,
      ['i5i5', 'h5f4'].find((move) => request.searchMoves!.includes(move)) ??
        request.searchMoves[0],
    );
  // A planted tactical evaluator: the adjacent rook wins the exposed red
  // soldier. These are opponent-to-move scores, not red-ink scores.
  return response(boardAt(request.fen, 'a1') === 'S' ? 1200 : -200);
};

test('best flip loses zero; an average hanging flip grades as a blunder', async () => {
  const state = fixture();
  const safe = await evaluateThreeKingdomsBanqiFlipDecision(
    state,
    [],
    { from: 'i5', to: 'i5' },
    11,
    tactical,
  );
  assert.equal(safe.bestWin - safe.playedWin, 0);
  assert.equal(safe.playedRank, 1);
  const bad = await evaluateThreeKingdomsBanqiFlipDecision(
    state,
    [],
    { from: 'a1', to: 'a1' },
    11,
    tactical,
  );
  assert.ok(['mistake', 'blunder'].includes(moveJudgment(bad.bestWin, bad.playedWin) ?? ''));
  assert.ok(
    Math.abs(
      bad.playedWin -
        (2 * winPercent(-1200, null, THREE_KINGDOMS_BANQI_DECISIONS_ENGINE_ID) +
          winPercent(200, null, THREE_KINGDOMS_BANQI_DECISIONS_ENGINE_ID)) /
          3,
    ) < 1e-9,
  );
  assert.equal(bad.realizedWin, winPercent(-1200, null, THREE_KINGDOMS_BANQI_DECISIONS_ENGINE_ID));
  assert.ok(
    bad.candidates?.some((entry) => entry.move.slice(0, 2) !== entry.move.slice(2)),
    'board alternative',
  );
});

test('luck is realized minus the fixed-bag mean and its weighted expectation is zero', async () => {
  const state = fixture();
  const red = await evaluateThreeKingdomsBanqiFlipDecision(
    state,
    [],
    { from: 'a1', to: 'a1' },
    11,
    tactical,
  );
  const blackState = {
    ...state,
    board: { ...state.board, a1: state.board.i5, i5: state.board.a1 },
  };
  const black = await evaluateThreeKingdomsBanqiFlipDecision(
    blackState,
    [],
    { from: 'a1', to: 'a1' },
    11,
    tactical,
  );
  assert.equal(red.playedWin, black.playedWin);
  const redLuck = red.realizedWin - red.playedWin;
  const blackLuck = black.realizedWin - black.playedWin;
  assert.ok(redLuck < 0 && blackLuck > 0);
  assert.ok(Math.abs((2 * redLuck + blackLuck) / 3) < 1e-9);
});

test('uses mover-seat POV for either ink and seat, L8 NNUE/ChanceMix, and bounded budgets', async () => {
  for (const firstColor of ['red', 'black'] as const) {
    for (const turn of ['red', 'black'] as const) {
      const state = { ...fixture(), firstColor, status: { type: 'playing', turn } as const };
      const requests: ThreeKingdomsBanqiEngineRequest[] = [];
      const result = await evaluateThreeKingdomsBanqiFlipDecision(
        state,
        [],
        { from: 'a1', to: 'a1' },
        11,
        async (request) => {
          requests.push(request);
          return constant(request);
        },
      );
      assert.equal(result.mover, turn);
      assert.ok(
        Math.abs(
          result.playedWin - winPercent(-300, null, THREE_KINGDOMS_BANQI_DECISIONS_ENGINE_ID),
        ) < 1e-9,
      );
      assert.equal(
        result.realizedWin,
        winPercent(-300, null, THREE_KINGDOMS_BANQI_DECISIONS_ENGINE_ID),
      );
      assert.ok(requests.length <= 3 + 4 * 3);
      for (const request of requests) {
        assert.equal(request.nodes, THREE_KINGDOMS_BANQI_DECISION_NODES);
        assert.equal(request.movetimeCapMs, THREE_KINGDOMS_BANQI_DECISION_MOVETIME_CAP_MS);
        assert.equal(request.chance, 'mix');
        assert.equal(request.evalFile, fileURLToPath(import.meta.url));
      }
    }
  }
});

test('hidden permutations change no engine input, decision or whole stored payload', async () => {
  const events = eventsForFlips(3);
  const touched = new Set(
    events.flatMap((event) => (event.type === 'move-played' ? [event.move.from] : [])),
  );
  const initial = createThreeKingdomsBanqiStateFromSetup(ROOM, setup);
  const hidden = Object.keys(initial.board).filter(
    (key) => !touched.has(key as ThreeKingdomsBanqiSquare),
  ) as ThreeKingdomsBanqiSquare[];
  const a = hidden[0]!;
  const b = hidden.find(
    (key) => banqiPieceLetter(initial.board[key]!) !== banqiPieceLetter(initial.board[a]!),
  )!;
  const deal = [...setup.deal];
  const i = THREE_KINGDOMS_BANQI_SETUP_SQUARES.indexOf(a),
    j = THREE_KINGDOMS_BANQI_SETUP_SQUARES.indexOf(b);
  [deal[i], deal[j]] = [deal[j]!, deal[i]!];
  assert.notDeepEqual(deal, setup.deal);
  const swapped = [{ ...created, setup: { deal } }, ...events.slice(1)];
  const inputs: string[][] = [[], []];
  const payloads: string[] = [];
  for (const [index, log] of [events, swapped].entries()) {
    const cache: ThreeKingdomsBanqiDecisionsCache = {
      get: async () => null,
      save: async (roomId, engineId, depth, decisions) => {
        payloads.push(JSON.stringify({ roomId, engineId, depth, decisions }));
      },
    };
    await resolveThreeKingdomsBanqiDecisions(ROOM, log, cache, (history) =>
      analyzeThreeKingdomsBanqiDecisions(history, async (request) => {
        inputs[index]!.push(
          JSON.stringify({ request, commands: buildThreeKingdomsBanqiEngineCommands(request) }),
        );
        return constant(request);
      }),
    );
  }
  assert.deepEqual(inputs[0], inputs[1]);
  assert.equal(payloads[0], payloads[1]);
  const request = threeKingdomsBanqiTierRequestFor(
    [created],
    initial,
    THREE_KINGDOMS_BANQI_ANALYSIS_TIER,
    250,
  );
  assert.equal(request.fen.split(' ')[7], 'G1A2E2R2H2C2S5g1a2e2r2h2c2s5');
});

test('a false hidden identity cannot change the public bag or candidate means', async () => {
  const state = fixture();
  const changed = {
    ...state,
    board: { ...state.board, i5: { color: 'red', role: 'general', faceDown: true } as BanqiPiece },
  };
  const inputs: string[][] = [[], []];
  const results = [];
  for (const [i, position] of [state, changed].entries()) {
    results.push(
      await evaluateThreeKingdomsBanqiFlipDecision(
        position,
        [],
        { from: 'a1', to: 'a1' },
        11,
        async (request) => {
          inputs[i]!.push(JSON.stringify(request));
          return tactical(request);
        },
      ),
    );
  }
  assert.deepEqual(inputs[0], inputs[1]);
  assert.equal(JSON.stringify(results[0]), JSON.stringify(results[1]));
});

test('cache-only reads never compute; concurrent computations coalesce and reload', async () => {
  let saved: ThreeKingdomsBanqiDecision[] | null = null;
  let calls = 0;
  const cache: ThreeKingdomsBanqiDecisionsCache = {
    get: async () => saved,
    save: async (_r, _e, _d, value) => {
      saved = value;
    },
  };
  const analyze = async () => {
    calls += 1;
    return analyzeThreeKingdomsBanqiDecisions(eventsForFlips(1), constant);
  };
  assert.equal(await resolveThreeKingdomsBanqiDecisions(ROOM, [], cache, analyze, false), null);
  assert.equal(calls, 0);
  const [a, b] = await Promise.all([
    resolveThreeKingdomsBanqiDecisions(ROOM, [], cache, analyze),
    resolveThreeKingdomsBanqiDecisions(ROOM, [], cache, analyze),
  ]);
  assert.deepEqual(a, b);
  assert.equal(calls, 1);
  assert.deepEqual(await resolveThreeKingdomsBanqiDecisions(ROOM, [], cache, analyze, false), a);
  assert.equal(calls, 1);
});

test('checkpoints resume completed flips; scoreless outcomes fail without saving', async () => {
  let checkpoint: AnalysisProgress<ThreeKingdomsBanqiDecision> | null = null;
  const progress: AnalysisProgressStore<ThreeKingdomsBanqiDecision> = {
    load: async () => checkpoint,
    save: async (value) => {
      checkpoint = { ...value, items: [...value.items] };
    },
  };
  const events = eventsForFlips(2);
  let firstCalls = 0;
  await analyzeThreeKingdomsBanqiDecisions(
    events.slice(0, 2),
    async (request) => {
      firstCalls += 1;
      return constant(request);
    },
    progress,
  );
  let resumeCalls = 0;
  const resumed = await analyzeThreeKingdomsBanqiDecisions(
    events,
    async (request) => {
      resumeCalls += 1;
      return constant(request);
    },
    progress,
  );
  assert.equal(resumed.length, 2);
  let allCalls = 0;
  assert.deepEqual(
    await analyzeThreeKingdomsBanqiDecisions(events, async (request) => {
      allCalls += 1;
      return constant(request);
    }),
    resumed,
  );
  assert.equal(firstCalls + resumeCalls, allCalls);
  let saves = 0;
  await assert.rejects(
    resolveThreeKingdomsBanqiDecisions(
      'scoreless',
      events,
      {
        get: async () => null,
        save: async () => {
          saves += 1;
        },
      },
      (log) =>
        analyzeThreeKingdomsBanqiDecisions(log, async (request) =>
          response(null, request.searchMoves?.[0]),
        ),
    ),
    VacuousAnalysisError,
  );
  assert.equal(saves, 0);
  assert.deepEqual(await analyzeThreeKingdomsBanqiDecisions([created], constant), []);
});
