import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

const before = JSON.parse(await readFile(new URL('./before.json', import.meta.url)));
const label = process.argv[2] ?? 'after';
assert.match(label, /^(after|pass2-(20|50|100|200)k)$/);
const after = JSON.parse(await readFile(new URL(`./${label}.json`, import.meta.url)));
assert.ok(before.finishedAt && after.finishedAt, 'both benchmark runs must be complete');
assert.equal(before.machine.engineSha256, after.machine.engineSha256);
assert.equal(before.machine.netSha256, after.machine.netSha256);
assert.equal(before.games.length, 3);
assert.equal(after.games.length, 3);
const percentile = (xs, p) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * p) - 1];
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const games = before.games.map((old, index) => {
  const next = after.games[index];
  assert.ok(old.complete && next.complete);
  assert.equal(old.seed, next.seed);
  assert.equal(old.corpusSha256, next.corpusSha256);
  assert.deepEqual(old.flips, next.flips);
  assert.equal(old.decisions.length, old.flips.length);
  assert.equal(next.decisions.length, next.flips.length);
  const flips = old.decisions.map((previous, i) => {
    const current = next.decisions[i];
    assert.equal(previous.ply, current.ply);
    assert.ok(current.rankedTopThree?.length > 0 && current.rankedTopThree.length <= 3);
    const oldBest = previous.candidates[0].move;
    const oldTiedBest = previous.candidates
      .filter((c) => Math.abs(c.win - previous.bestWin) < 1e-9)
      .map((c) => c.move);
    return {
      ply: current.ply,
      oldBest,
      rankedTopThree: current.rankedTopThree,
      oldBestInTopThree: current.rankedTopThree.includes(oldBest),
      anyRetainedOldTiedBestInTopThree: oldTiedBest.some((m) => current.rankedTopThree.includes(m)),
      oldBestInBaselineCandidates: current.candidates.some((c) => c.move === oldBest),
      oldDecisionLoss: previous.decisionLoss,
      newDecisionLoss: current.decisionLoss,
      decisionLossDelta: current.decisionLoss - previous.decisionLoss,
      oldLuck: previous.luck,
      newLuck: current.luck,
      luckDelta: current.luck - previous.luck,
      oldPlayedWin: previous.playedWin,
      newPlayedWin: current.playedWin,
      oldRealizedWin: previous.realizedWin,
      newRealizedWin: current.realizedWin,
      beforeMs: previous.wallMs,
      afterMs: current.wallMs,
    };
  });
  return {
    name: old.name,
    seed: old.seed,
    plies: old.plies,
    flipCount: flips.length,
    beforeMs: old.wallMs,
    afterMs: next.wallMs,
    speedup: old.wallMs / next.wallMs,
    beforeMeanFlipMs: old.meanFlipMs,
    afterMeanFlipMs: next.meanFlipMs,
    beforeSearches: old.searches,
    afterSearches: next.searches,
    beforeRequestedNodes: old.requestedNodes,
    afterRequestedNodes: next.requestedNodes,
    flips,
  };
});
const flips = games.flatMap((g) => g.flips);
const lossErrors = flips.map((f) => Math.abs(f.decisionLossDelta));
const luckErrors = flips.map((f) => Math.abs(f.luckDelta));
const summary = {
  flipCount: flips.length,
  oldBestInTopThree: flips.filter((f) => f.oldBestInTopThree).length,
  oldBestOutsideTopThree: flips.filter((f) => !f.oldBestInTopThree).length,
  agreementRate: mean(flips.map((f) => Number(f.oldBestInTopThree))),
  anyRetainedOldTiedBestInTopThreeRate: mean(
    flips.map((f) => Number(f.anyRetainedOldTiedBestInTopThree)),
  ),
  oldBestInBaselineCandidatesRate: mean(flips.map((f) => Number(f.oldBestInBaselineCandidates))),
  decisionLossMeanAbsoluteDelta: mean(lossErrors),
  decisionLossP95AbsoluteDelta: percentile(lossErrors, 0.95),
  decisionLossMaxAbsoluteDelta: Math.max(...lossErrors),
  luckMeanAbsoluteDelta: mean(luckErrors),
  luckP95AbsoluteDelta: percentile(luckErrors, 0.95),
  luckMaxAbsoluteDelta: Math.max(...luckErrors),
  beforeTotalMs: games.reduce((n, g) => n + g.beforeMs, 0),
  afterTotalMs: games.reduce((n, g) => n + g.afterMs, 0),
  beforeRequestedNodes: games.reduce((n, g) => n + g.beforeRequestedNodes, 0),
  afterRequestedNodes: games.reduce((n, g) => n + g.afterRequestedNodes, 0),
  beforeSearches: games.reduce((n, g) => n + g.beforeSearches, 0),
  afterSearches: games.reduce((n, g) => n + g.afterSearches, 0),
};
summary.speedup = summary.beforeTotalMs / summary.afterTotalMs;
summary.beforeMeanFlipMs = summary.beforeTotalMs / summary.flipCount;
summary.afterMeanFlipMs = summary.afterTotalMs / summary.flipCount;
await writeFile(
  new URL(label === 'after' ? './comparison.json' : `./comparison-${label}.json`, import.meta.url),
  `${JSON.stringify(
    {
      units: 'Win percentage points; deltas are new minus old; wall times in milliseconds.',
      agreement:
        'The original best move (stable tie-break) is in the new cheap top three. Any retained tied best also reported (the old rows retain only three plus played).',
      machine: after.machine,
      beforeEngineId: before.engineId,
      afterEngineId: after.engineId,
      summary,
      games,
    },
    null,
    2,
  )}\n`,
);
console.log(JSON.stringify(summary, null, 2));
