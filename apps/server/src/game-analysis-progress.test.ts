import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyBanqiMove,
  type BanqiDeal,
  type BanqiMove,
  createInitialBanqiState,
  getBanqiLegalMoves,
  STANDARD_BANQI_DEAL,
} from '@mistboard/game';
import {
  analyzeBanqiDecisions,
  analyzeBanqiPostgame,
  type BanqiDecision,
} from './banqi-analysis.js';
import {
  ANALYSIS_ACCOUNT_PENDING_CAP,
  analysisJobStatusBody,
  enqueueAnalysisJob,
  findPendingAnalysisJob,
  getAnalysisJob,
} from './game-analysis-jobs.js';
import type { AnalysisProgress, AnalysisProgressStore } from './game-analysis-kernel.js';
import { type SweepPlyEval, sweepPlyEvals } from './game-analysis-sweep.js';

// ── Incremental progress + resume (persist expensive output incrementally) ────

function memoryProgress<T>(): AnalysisProgressStore<T> & { saves: AnalysisProgress<T>[] } {
  let state: AnalysisProgress<T> | null = null;
  const saves: AnalysisProgress<T>[] = [];
  return {
    saves,
    async load() {
      return state ? { nextIndex: state.nextIndex, items: [...state.items] } : null;
    },
    async save(progress) {
      state = { nextIndex: progress.nextIndex, items: [...progress.items] };
      saves.push(state);
    },
  };
}

test('sweepPlyEvals checkpoints per ply and resumes from the last checkpoint', async () => {
  const progress = memoryProgress<SweepPlyEval>();
  const moves = ['a', 'b', 'c'];
  let evals = 0;
  const evaluate = async (prefix: string[]) => {
    evals += 1;
    // Simulate a crash after the 2nd evaluated position.
    if (evals === 3) throw new Error('killed');
    return { cp: prefix.length, mate: null, best: null };
  };
  await assert.rejects(sweepPlyEvals(moves, evaluate, 12, progress), /killed/);
  assert.equal(progress.saves.length, 2, 'both completed plies were checkpointed');

  // The re-run resumes: plies 0-1 come from the checkpoint, only 2-3 re-evaluate.
  const rerunPrefixes: number[] = [];
  const resumed = await sweepPlyEvals(
    moves,
    async (prefix: string[]) => {
      rerunPrefixes.push(prefix.length);
      return { cp: prefix.length, mate: null, best: null };
    },
    12,
    progress,
  );
  assert.deepEqual(rerunPrefixes, [2, 3], 'already-checkpointed plies are not recomputed');
  assert.deepEqual(
    resumed.map((p) => p.ply),
    [0, 1, 2, 3],
  );
});

test('analyzeBanqiPostgame resumes a partial sweep without re-evaluating done plies', async () => {
  const deal: BanqiDeal = STANDARD_BANQI_DEAL;
  let state = createInitialBanqiState('t', deal);
  const moves: BanqiMove[] = [];
  for (let i = 0; i < 4; i += 1) {
    const move = getBanqiLegalMoves(state)[0]!;
    moves.push(move);
    state = applyBanqiMove(state, move);
  }
  const progress = memoryProgress<SweepPlyEval>();
  let evals = 0;
  await assert.rejects(
    analyzeBanqiPostgame(
      moves,
      deal,
      async () => {
        evals += 1;
        if (evals === 3) throw new Error('killed');
        return { cp: 1, mate: null, best: null };
      },
      progress,
    ),
    /killed/,
  );
  let resumedEvals = 0;
  const analysis = await analyzeBanqiPostgame(
    moves,
    deal,
    async () => {
      resumedEvals += 1;
      return { cp: 2, mate: null, best: null };
    },
    progress,
  );
  assert.equal(analysis.plies.length, moves.length + 1);
  // 5 positions total, 2 checkpointed before the crash: only 3 re-evaluate.
  assert.equal(resumedEvals, 3);
  assert.deepEqual(
    analysis.plies.map((p) => p.cp),
    [1, 1, 2, 2, 2],
  );
});

test('analyzeBanqiDecisions resumes from the saved move cursor', async () => {
  const deal: BanqiDeal = STANDARD_BANQI_DEAL;
  // Two opening flips: two graded decisions.
  let state = createInitialBanqiState('t', deal);
  const moves: BanqiMove[] = [];
  for (let i = 0; i < 2; i += 1) {
    const flip = getBanqiLegalMoves(state).find((m) => m.from === m.to)!;
    moves.push(flip);
    state = applyBanqiMove(state, flip);
  }
  const progress = memoryProgress<BanqiDecision>();
  let evals = 0;
  await assert.rejects(
    analyzeBanqiDecisions(
      moves,
      deal,
      {
        evalPosition: async () => {
          evals += 1;
          // Let the first flip's whole fan-out finish, then die mid-second-flip.
          if (progress.saves.length > 0) throw new Error('killed');
          return { cp: 50, mate: null };
        },
      },
      progress,
    ),
    /killed/,
  );
  assert.equal(progress.saves.length, 1, 'the first graded flip was checkpointed');

  const checkpoint = progress.saves[0]!.items[0]!;
  let resumedEvals = 0;
  const decisions = await analyzeBanqiDecisions(
    moves,
    deal,
    {
      evalPosition: async () => {
        resumedEvals += 1;
        return { cp: 50, mate: null };
      },
    },
    progress,
  );
  assert.equal(decisions.length, 2);
  assert.deepEqual(
    decisions.map((d) => d.ply),
    [1, 2],
  );
  // Only the second flip was re-graded on resume.
  assert.deepEqual(decisions[0], checkpoint);
  assert.ok(resumedEvals > 0 && resumedEvals < evals);
});

// ── Job queue caps + status envelope ──────────────────────────────────────────

test('enqueueAnalysisJob enforces the per-account pending cap', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const enqueued: string[] = [];
  try {
    for (let i = 0; i < ANALYSIS_ACCOUNT_PENDING_CAP; i += 1) {
      const result = enqueueAnalysisJob({
        variant: 'captest',
        roomId: `room-${i}`,
        kind: 'analysis',
        accountId: 'acct-cap',
        run: async () => {
          await gate;
          return { ok: true };
        },
      });
      assert.ok(result.ok);
      if (result.ok) enqueued.push(result.job.id);
    }
    const over = enqueueAnalysisJob({
      variant: 'captest',
      roomId: 'room-over',
      kind: 'analysis',
      accountId: 'acct-cap',
      run: async () => null,
    });
    assert.deepEqual(over, { ok: false, error: 'too_many_pending_analyses' });
    // A DIFFERENT account still fits (the cap is per-account, not global).
    const other = enqueueAnalysisJob({
      variant: 'captest',
      roomId: 'room-other',
      kind: 'analysis',
      accountId: 'acct-other',
      run: async () => null,
    });
    assert.ok(other.ok);
  } finally {
    release();
  }
  // Let the chain drain so later tests start from an empty pending set.
  await new Promise((resolve) => setTimeout(resolve, 10));
});

test('job lifecycle: pending -> done with the result envelope; coalescing lookup works', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const result = enqueueAnalysisJob({
    variant: 'lifetest',
    roomId: 'room-1',
    kind: 'decisions',
    accountId: 'acct-life',
    run: async () => {
      await gate;
      return { decisions: [1] };
    },
  });
  assert.ok(result.ok);
  if (!result.ok) return;
  const job = result.job;
  assert.deepEqual(analysisJobStatusBody(job), { status: 'pending' });
  assert.equal(findPendingAnalysisJob('lifetest', 'room-1', 'decisions'), job);
  assert.equal(findPendingAnalysisJob('lifetest', 'room-1', 'analysis'), null);
  release();
  for (let i = 0; i < 200 && getAnalysisJob(job.id)?.status === 'pending'; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(job.status, 'done');
  assert.deepEqual(analysisJobStatusBody(job), { status: 'done', result: { decisions: [1] } });
  assert.equal(findPendingAnalysisJob('lifetest', 'room-1', 'decisions'), null);
});
