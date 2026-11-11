import assert from 'node:assert/strict';
import test from 'node:test';
import { type BanqiMove, STANDARD_BANQI_DEAL } from '@mistboard/game';
import { analyzeBanqiPostgame } from './banqi-analysis.js';
import type { AnalysisProgress, AnalysisProgressStore } from './game-analysis-kernel.js';
import type { SweepPlyEval } from './game-analysis-sweep.js';

const moves: BanqiMove[] = [
  { from: 'a1', to: 'a1' },
  { from: 'b1', to: 'b1' },
  { from: 'c1', to: 'c1' },
];
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}
const turn = () => new Promise<void>((r) => setImmediate(r));
test('two-position overlap buffers out-of-order results and serializes contiguous immutable checkpoints', async () => {
  const gates = Array.from({ length: 4 }, deferred);
  const saves: AnalysisProgress<SweepPlyEval>[] = [];
  let saving = 0,
    peakSave = 0,
    active = 0,
    peak = 0;
  const store: AnalysisProgressStore<SweepPlyEval> = {
    load: async () => null,
    save: async (p) => {
      saving++;
      peakSave = Math.max(peakSave, saving);
      assert.deepEqual(
        p.items.map((e) => e.ply),
        Array.from({ length: p.nextIndex }, (_, i) => i),
      );
      saves.push(p);
      await turn();
      saving--;
    },
  };
  const pending = analyzeBanqiPostgame(
    moves,
    STANDARD_BANQI_DEAL,
    async (state) => {
      active++;
      peak = Math.max(peak, active);
      await gates[state.ply]!.promise;
      active--;
      return { cp: state.ply, mate: null, best: null, hidden: 'not-serialized' };
    },
    store,
  );
  await turn();
  assert.equal(active, 2, 'must overlap two positions');
  gates[1]!.resolve();
  await turn();
  assert.equal(saves.length, 0, 'cannot checkpoint across missing root');
  gates[0]!.resolve();
  await turn();
  gates[3]!.resolve();
  gates[2]!.resolve();
  const result = await pending;
  assert.equal(peak, 2);
  assert.equal(peakSave, 1);
  assert.deepEqual(
    result.plies.map((e) => e.cp),
    [0, 1, 2, 3],
  );
  assert.doesNotMatch(JSON.stringify(result), /hidden|not-serialized/);
  for (const p of saves) assert.equal(p.items.length, p.nextIndex);
  assert.equal(saves.at(-1)?.nextIndex, 4);
});
test('failure drains every started search/write before rejection; retry resumes only the committed prefix', async () => {
  const root = deferred(),
    second = deferred();
  let state: AnalysisProgress<SweepPlyEval> | null = null;
  let completed = false,
    started: number[] = [];
  const store: AnalysisProgressStore<SweepPlyEval> = {
    load: async () => state,
    save: async (p) => {
      state = { nextIndex: p.nextIndex, items: [...p.items] };
      await turn();
    },
  };
  const pending = analyzeBanqiPostgame(
    moves,
    STANDARD_BANQI_DEAL,
    async (s) => {
      started.push(s.ply);
      if (s.ply === 0) {
        await root.promise;
        return { cp: 10, mate: null, best: null };
      }
      await second.promise;
      throw Error('failed-position');
    },
    store,
  );
  pending.then(
    () => {
      completed = true;
    },
    () => {
      completed = true;
    },
  );
  await turn();
  second.resolve();
  await turn();
  assert.equal(completed, false, 'root search must still drain before job fails');
  root.resolve();
  await assert.rejects(pending, /failed-position/);
  assert.deepEqual(started, [0, 1]);
  assert.equal((state as AnalysisProgress<SweepPlyEval> | null)?.nextIndex, 1);
  const resumed: number[] = [];
  const result = await analyzeBanqiPostgame(
    moves,
    STANDARD_BANQI_DEAL,
    async (s) => {
      resumed.push(s.ply);
      return { cp: s.ply, mate: null, best: null };
    },
    store,
  );
  assert.deepEqual(resumed, [1, 2, 3]);
  assert.deepEqual(
    result.plies.map((e) => e.cp),
    [10, 1, 2, 3],
  );
});
test('checkpoint failure cannot be overwritten by a later completion', async () => {
  let saves = 0;
  let active = 0;
  const pending = analyzeBanqiPostgame(
    moves,
    STANDARD_BANQI_DEAL,
    async () => {
      active++;
      await turn();
      active--;
      return { cp: 1, mate: null, best: null };
    },
    {
      load: async () => null,
      save: async () => {
        saves++;
        throw Error('checkpoint failed');
      },
    },
  );
  await assert.rejects(pending, /checkpoint failed/);
  assert.equal(active, 0);
  assert.equal(saves, 1);
});
