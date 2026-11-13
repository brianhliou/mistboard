import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFFQBanqiDeal, FFQ_BANQI_SPEC_ID, winPercent } from '@mistboard/game';
import type { BanqiDecision } from './banqi-analysis.js';
import {
  analyzeFFQBanqiDecisions,
  evaluateFFQBanqiChanceDecision,
  FFQ_BANQI_DECISIONS_ENGINE_ID,
  ffqBanqiPublicTrack,
  ffqChanceOutcomeFen,
  resolveFFQBanqiDecisions,
} from './ffq-banqi-decisions.js';
import {
  cachedFFQPublicSearch,
  type FFQPublicSearch,
  searchFFQPublicFen,
} from './ffq-banqi-public-analysis.js';
import type { FFQBanqiEvent } from './ffq-banqi-tenant.js';
import type { AnalysisProgress, AnalysisProgressStore } from './game-analysis-kernel.js';

const flip = { from: 0, to: 0 };
const capture = { from: 0, to: 8 };
// Planted case: a0 cannon, a1 screen, a2 covered victim; both generals in the bag.
const fen = '4/4/4/4/4/X3/S3/C3 r 60 60 9 2 3 1 G1g1 0 0';
const score: FFQPublicSearch = async (f) => {
  const fields = f.split(' ');
  const red = 12 * (Number(fields[2]) - Number(fields[3]));
  return { cp: red * (fields[1] === 'r' ? 1 : -1), mate: null, best: 'a0a2' };
};

test('covered captures of either general apply HP to its owner and have opposite luck signs', async () => {
  const own = ffqChanceOutcomeFen(fen, capture, 'G');
  const enemy = ffqChanceOutcomeFen(fen, capture, 'g');
  assert.equal(own, '4/4/4/4/4/C3/S3/4 b 30 60 0 0 0 1 g1 0 0');
  assert.equal(enemy, '4/4/4/4/4/C3/S3/4 b 60 30 0 0 0 1 G1 0 0');
  const a = await evaluateFFQBanqiChanceDecision(fen, own, capture, 1, score);
  const b = await evaluateFFQBanqiChanceDecision(fen, enemy, capture, 1, score);
  assert.ok(Math.abs(a.playedWin - 50) < 1e-10);
  assert.ok(Math.abs(b.playedWin - 50) < 1e-10);
  assert.ok(a.realizedWin < a.playedWin);
  assert.ok(b.realizedWin > b.playedWin);
  assert.equal(b.realizedWin, winPercent(360, null, FFQ_BANQI_DECISIONS_ENGINE_ID));
  // Black mover: friendly black general is unlucky too.
  const black = fen.replace('C3 r', 'c3 b');
  const c = await evaluateFFQBanqiChanceDecision(
    black,
    ffqChanceOutcomeFen(black, capture, 'g'),
    capture,
    2,
    score,
  );
  assert.equal(c.mover, 'black');
  assert.ok(c.realizedWin < c.playedWin);
});

test('terminal general outcomes bypass search; both colours get exact 0/100', async () => {
  const low = fen.replace('60 60', '30 30');
  const calls: string[] = [];
  const search: FFQPublicSearch = async (f) => {
    calls.push(f);
    return score(f);
  };
  for (const [identity, expected] of [
    ['G', 0],
    ['g', 100],
  ] as const) {
    calls.length = 0;
    const result = await evaluateFFQBanqiChanceDecision(
      low,
      ffqChanceOutcomeFen(low, capture, identity),
      capture,
      1,
      search,
    );
    assert.equal(result.realizedWin, expected);
    assert.deepEqual(calls, [low], 'only the pre-move search, no terminal outcome searches');
  }
});

test('flip outcomes remove one public identity and reset clock/chases, passing the turn', () => {
  const before = '4/4/4/4/4/4/4/X3 b 60 60 19 4 2 7 G1g1 0 0';
  assert.equal(ffqChanceOutcomeFen(before, flip, 'g'), '4/4/4/4/4/4/4/g3 r 60 60 0 0 0 8 G1 0 0');
});

test('named planted deal swap: covered a0 and b0 never flipped; whole decisions and every query byte-identical', async () => {
  const deal = createFFQBanqiDeal(1092);
  const i = 0;
  const j = deal.findIndex(
    (piece, index) =>
      index > 0 && index < 4 && (piece.role !== deal[i]!.role || piece.color !== deal[i]!.color),
  );
  assert.ok(j > 0);
  const swapped = [...deal];
  [swapped[i], swapped[j]] = [swapped[j]!, swapped[i]!];
  const log = (d: typeof deal): FFQBanqiEvent[] => [
    {
      type: 'room-created',
      at: 0,
      roomId: 'ffq_hidden',
      gameSpecId: FFQ_BANQI_SPEC_ID,
      setup: { deal: d },
    },
    { type: 'move-played', at: 1, roomId: 'ffq_hidden', color: 'red', move: { from: 4, to: 4 } },
    { type: 'seat-resigned', at: 2, roomId: 'ffq_hidden', color: 'black' },
  ];
  const results: string[] = [],
    queries: string[][] = [];
  for (const d of [deal, swapped, deal]) {
    const q: string[] = [];
    const track = ffqBanqiPublicTrack(log(d));
    const result = await analyzeFFQBanqiDecisions(track, async (f) => {
      q.push(f);
      return { cp: f.includes('G') ? 10 : -10, mate: null, best: 'a1a1' };
    });
    assert.equal(result.length, 1);
    results.push(JSON.stringify(result));
    queries.push(q);
  }
  assert.equal(results[0], results[1]);
  assert.equal(results[0], results[2]);
  assert.deepEqual(queries[0], queries[1]);
  assert.deepEqual(queries[0], queries[2]);
});

test('canonical weighted pool means and top-plus-played ceiling; same query coalesces and failures retry', async () => {
  const before = '4/4/4/4/4/4/4/XX2 r 60 60 0 0 0 1 G1g2 0 0';
  let calls = 0;
  const search = cachedFFQPublicSearch(async (f) => {
    calls++;
    return {
      cp: f === before ? 20 : f.startsWith('4/4/4/4/4/4/4/G') ? -200 : 100,
      mate: null,
      best: 'b0b0',
    };
  });
  const result = await evaluateFFQBanqiChanceDecision(
    before,
    ffqChanceOutcomeFen(before, flip, 'G'),
    flip,
    1,
    search,
  );
  assert.equal(result.candidates?.length, 2);
  const expected =
    winPercent(200, null, FFQ_BANQI_DECISIONS_ENGINE_ID) / 3 +
    (2 * winPercent(-100, null, FFQ_BANQI_DECISIONS_ENGINE_ID)) / 3;
  assert.ok(Math.abs(result.playedWin - expected) < 1e-10);
  assert.ok(result.bestWin >= result.playedWin);
  const copy = await search(before);
  copy.cp = 999;
  assert.equal((await search(before)).cp, 20);
  assert.equal(calls, 5);
  let n = 0;
  const retry = cachedFFQPublicSearch(async () => {
    if (++n === 1) throw new Error('interrupted');
    return { cp: 0, mate: null, best: 'a0a0' };
  });
  await assert.rejects(retry(before), /interrupted/);
  await Promise.all([retry(before), retry(before)]);
  assert.equal(n, 2);
});

test('checkpoint failure resumes at the interrupted ply; cache-only reads do no work', async () => {
  const after = ffqChanceOutcomeFen(fen, capture, 'g');
  const track = { frames: [{ fen }, { fen: after }], moves: [capture] };
  let checkpoint: AnalysisProgress<BanqiDecision> | null = null;
  const progress: AnalysisProgressStore<BanqiDecision> = {
    load: async () => checkpoint,
    save: async (p) => {
      checkpoint = JSON.parse(JSON.stringify(p));
    },
  };
  const first = await analyzeFFQBanqiDecisions(track, score, progress);
  assert.deepEqual(
    await analyzeFFQBanqiDecisions(
      track,
      async () => {
        throw new Error('must resume');
      },
      progress,
    ),
    first,
  );
  assert.equal(
    await resolveFFQBanqiDecisions(
      'ffq_cache',
      [],
      {
        get: async () => null,
        save: async () => {
          throw new Error('must not save');
        },
      },
      undefined,
      false,
    ),
    null,
  );
});

test('real MistyFFQ public-FEN covered-capture smoke is deterministic', {
  skip: !process.env.MISTBOARD_FFQ_BANQI_ENGINE_PATH,
}, async () => {
  const before = '4/4/4/4/4/X3/S3/C3 r 60 60 0 0 0 1 G1 0 0';
  const after = ffqChanceOutcomeFen(before, capture, 'G');
  const one = await evaluateFFQBanqiChanceDecision(before, after, capture, 1, searchFFQPublicFen);
  const two = await evaluateFFQBanqiChanceDecision(before, after, capture, 1, searchFFQPublicFen);
  assert.equal(JSON.stringify(one), JSON.stringify(two));
  assert.ok(Number.isFinite(one.playedWin));
});

test('outcome fan-out never exceeds two slots and interrupted checkpoints retain exactly the completed prefix', async () => {
  const before = '4/4/4/4/4/4/4/XXX1 r 60 60 0 0 0 1 G1g2 0 0';
  const first = ffqChanceOutcomeFen(before, flip, 'G');
  const nextMove = { from: 1, to: 1 };
  const after = ffqChanceOutcomeFen(first, nextMove, 'g');
  const track = {
    frames: [{ fen: before }, { fen: first }, { fen: after }],
    moves: [flip, nextMove],
  };
  let checkpoint: AnalysisProgress<BanqiDecision> | null = null;
  const progress: AnalysisProgressStore<BanqiDecision> = {
    load: async () => checkpoint,
    save: async (p) => {
      checkpoint = JSON.parse(JSON.stringify(p));
    },
  };
  let active = 0,
    peak = 0;
  const search: FFQPublicSearch = async (f) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setImmediate(resolve));
    active--;
    return { cp: 0, mate: null, best: f === first ? 'b0b0' : 'a0a0' };
  };
  let calls = 0;
  await assert.rejects(
    analyzeFFQBanqiDecisions(
      track,
      async (f) => {
        if (++calls === 4) throw new Error('second root interrupted');
        return search(f);
      },
      progress,
    ),
    /second root interrupted/,
  );
  assert.equal((checkpoint as AnalysisProgress<BanqiDecision> | null)?.nextIndex, 1);
  const resumedQueries: string[] = [];
  const resumed = await analyzeFFQBanqiDecisions(
    track,
    async (f) => {
      resumedQueries.push(f);
      return search(f);
    },
    progress,
  );
  assert.equal(resumed.length, 2);
  assert.ok(!resumedQueries.includes(before));
  assert.equal(peak, 2);
  assert.equal(active, 0);
  assert.deepEqual(resumed, await analyzeFFQBanqiDecisions(track, search));
});
