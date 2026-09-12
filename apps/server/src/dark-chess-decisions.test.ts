import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type DarkChessAnalysisCache,
  type DarkChessAnalysisPublication,
  type DarkChessGameAnalysis,
  resolveDarkChessAnalysis,
  type StoredDarkChessAnalysis,
} from './dark-chess-analysis.js';
import { resolveDarkChessDecisions } from './dark-chess-decisions.js';
import { isFogChessPersistedVariant } from './routes/games.js';

// ── The gate that made the original wiring dead on arrival ──────────────────
// Fog chess games persist as 'dark-chess' (or the legacy 'fog'); 'fog-of-war' is
// the event log's kernel label and is NEVER a games.variant value, so matching on
// it returned null for every game and the route 404'd everywhere. Cheap test, and
// the one that would have caught it.
test('fog chess variant gate accepts the persisted spellings only', () => {
  assert.equal(isFogChessPersistedVariant('dark-chess'), true);
  assert.equal(isFogChessPersistedVariant('fog'), true, 'legacy rows still analyse');
  assert.equal(
    isFogChessPersistedVariant('fog-of-war'),
    false,
    "'fog-of-war' is the kernel label, not a persisted variant",
  );
  // The deleted Draft960 spellings are not fog chess.
  assert.equal(isFogChessPersistedVariant('dark-draft960'), false);
  assert.equal(isFogChessPersistedVariant('fog-draft960'), false);
  assert.equal(isFogChessPersistedVariant('dark-xiangqi'), false);
});

const publication: DarkChessAnalysisPublication = {
  schema_version: 'route/1',
  game_id: 'room-1',
  variant: 'fog-of-war',
  plies: [{ ply: 1, mover: 'white', uci: 'e2e4' }],
};

function analysisWith(seats: DarkChessGameAnalysis['seats']): DarkChessGameAnalysis {
  return {
    engineId: 'misty-analysis@test',
    depth: 18,
    plies: [{ ply: 0, cp: 10, mate: null, best: 'e2e4' }],
    seats,
  };
}

/** Stand-in for the persisted row, so these exercise the real resolver path
 *  (single-row round-trip included) rather than a hand-built analysis object. */
function memoryCache(): DarkChessAnalysisCache & { rows: () => number } {
  const store = new Map<string, StoredDarkChessAnalysis>();
  const key = (roomId: string, engineId: string, depth: number) => `${roomId}|${engineId}|${depth}`;
  return {
    get: async (roomId, engineId, depth) => store.get(key(roomId, engineId, depth)) ?? null,
    save: async (roomId, engineId, depth, payload) => {
      store.set(key(roomId, engineId, depth), payload);
    },
    rows: () => store.size,
  };
}

/** win% rides the wire at full precision (the client rounds for display), so the
 *  [-1, 1] -> win% mapping leaves float noise. Compare within it. */
function closeTo(actual: number | undefined, expected: number, what: string): void {
  assert.ok(
    actual !== undefined && Math.abs(actual - expected) < 1e-9,
    `${what}: expected ~${expected}, got ${actual}`,
  );
}

/** Seed the analysis cache, then project decisions out of it (never computing). */
async function seedAndProject(roomId: string, seats: DarkChessGameAnalysis['seats']) {
  const cache = memoryCache();
  await resolveDarkChessAnalysis(roomId, publication, cache, async () => analysisWith(seats));
  const result = await resolveDarkChessDecisions(roomId, publication, false, cache);
  return { result, cache };
}

test('decisions project the solve: candidates, rank, verdict and belief context', async () => {
  const { result, cache } = await seedAndProject('room-1', {
    white: {
      rows: [
        {
          ply: 51,
          color: 'white',
          uci: 'e2d1',
          belief: { size: 10, truth_in_p: true, truth_in_i: false },
          verdict: 'sample_error',
          search: {
            engine_top: 'e2d3',
            top_value: 0.05,
            played_value: -0.18,
            played_rank: 7,
            candidates: [
              { move: 'e2d3', value: 0.05 },
              { move: 'e2d1', value: -0.18, played: true },
            ],
          },
        },
      ],
      budget: {},
    },
  });

  assert.equal(cache.rows(), 1, 'analysis + decisions share ONE cache row');
  assert.ok(result, 'decisions resolve off the cached analysis row');
  assert.equal(result.decisions.length, 1);
  const d = result.decisions[0];
  assert.equal(d?.ply, 51);
  assert.equal(d?.mover, 'white');
  assert.equal(d?.playedRank, 7);
  assert.equal(d?.verdict, 'sample_error');
  assert.equal(d?.beliefSize, 10);
  assert.equal(d?.truthInBelief, true);
  assert.equal(d?.truthInSample, false);
  // GT-CFR value in [-1, 1] -> win%: (v + 1) / 2 * 100.
  closeTo(d?.bestWin, 52.5, 'bestWin');
  closeTo(d?.playedWin, 41, 'playedWin');
  assert.equal(d?.candidates?.length, 2);
  assert.equal(d?.candidates?.[0]?.move, 'e2d3');
  closeTo(d?.candidates?.[0]?.win, 52.5, 'candidate 1 win');
  assert.equal(d?.candidates?.[0]?.played, undefined);
  assert.equal(d?.candidates?.[1]?.move, 'e2d1');
  closeTo(d?.candidates?.[1]?.win, 41, 'candidate 2 win');
  assert.equal(d?.candidates?.[1]?.played, true);
});

test('a row without a solve yields no decision rather than a fabricated one', async () => {
  // --no-search profile: belief and grading, but no per-ply solve, so there is
  // nothing to rank. A decision row here would be invented.
  const { result } = await seedAndProject('room-2', {
    white: {
      rows: [{ ply: 3, color: 'white', uci: 'e2e4', belief: { size: 4, truth_in_p: true } }],
      budget: {},
    },
  });
  assert.ok(result);
  assert.deepEqual(result.decisions, []);
});

test('a row cached before candidates existed degrades to the rank alone', async () => {
  const { result } = await seedAndProject('room-5', {
    white: {
      rows: [
        {
          ply: 7,
          color: 'white',
          uci: 'e2e4',
          search: { engine_top: 'd2d4', top_value: 0.2, played_value: 0.1 },
        },
      ],
      budget: {},
    },
  });
  const d = result?.decisions[0];
  assert.equal(d?.candidates, undefined, 'no candidates rather than an empty list');
  assert.equal(d?.playedRank, null, 'rank absent on pre-candidates rows');
  closeTo(d?.bestWin, 60, 'bestWin');
  closeTo(d?.playedWin, 55, 'playedWin');
});

test('decisions from both seats interleave in ply order', async () => {
  const row = (ply: number, color: 'white' | 'black') => ({
    ply,
    color,
    uci: 'e2e4',
    search: { engine_top: 'e2e4', top_value: 0.2, played_value: 0.1, played_rank: 2 },
  });
  const { result } = await seedAndProject('room-3', {
    white: { rows: [row(1, 'white'), row(3, 'white')], budget: {} },
    black: { rows: [row(2, 'black'), row(4, 'black')], budget: {} },
  });
  assert.deepEqual(
    result?.decisions.map((d) => [d.ply, d.mover]),
    [
      [1, 'white'],
      [2, 'black'],
      [3, 'white'],
      [4, 'black'],
    ],
  );
});

test('decisions ride the analysis cache: a miss never computes', async () => {
  const cache = memoryCache();
  let computes = 0;
  const compute = async (): Promise<DarkChessGameAnalysis> => {
    computes += 1;
    return analysisWith({});
  };
  const result = await resolveDarkChessDecisions('room-4', publication, false, cache, compute);
  assert.equal(result, null, 'no analysis cached -> no decisions');
  assert.equal(computes, 0, 'and the GET path never triggers an engine pass');
});
