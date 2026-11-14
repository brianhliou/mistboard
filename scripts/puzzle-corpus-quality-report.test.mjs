import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  buildCorpusQualityReport,
  corpusQualityReportHtml,
} from './puzzle-corpus-quality-report.mjs';

const sha = (value) => createHash('sha256').update(value).digest('hex');
function fixture() {
  const puzzle = {
    id: 'test-puzzle',
    title: '<unsafe>',
    goal: { type: 'winning-advantage' },
    solution: [{ from: 'a1', to: 'a5' }],
  };
  const snapshot = JSON.stringify({ rows: [{ id: puzzle.id, puzzle }] });
  const manifest = {
    snapshotSha256: sha(snapshot),
    ids: [puzzle.id],
    puzzles: 1,
    executionId: 'execution',
    sources: { core: 'hash' },
    shards: [{ shard: 0, ids: [puzzle.id] }],
    canary: false,
  };
  const shard = [
    {
      type: 'verified-profile',
      profile: {
        shard: 0,
        executionId: manifest.executionId,
        snapshotSha256: manifest.snapshotSha256,
        sourceHashes: manifest.sources,
        binarySha256: 'binary',
      },
    },
    { type: 'policy-profile', solverGateVersion: 'fixed-gate' },
    {
      type: 'puzzle',
      id: puzzle.id,
      puzzleHash: sha(JSON.stringify(puzzle)),
      judgments: [{ solutionPly: 0, verdict: 'fail', reason: 'insufficient-separation' }],
      evidence: [{ solutionPly: 0, searches: [] }],
      decision: { disposition: 'withhold-candidate', reason: '<unsafe>', firstProblemPly: 0 },
    },
    { type: 'complete', puzzles: 1 },
    { type: 'shard-receipt', shard: 0, puzzles: 1, workerWallSeconds: 10 },
  ];
  return { snapshot, manifest, shards: [shard] };
}

test('completed corpus report retains proposals and escapes source content', () => {
  const { snapshot, manifest, shards } = fixture();
  const report = buildCorpusQualityReport(snapshot, manifest, shards);
  assert.deepEqual(report.decisions, {
    keep: 0,
    'shorter-replacement': 0,
    'withhold-candidate': 1,
    'needs-review': 0,
  });
  assert.equal(report.workerWallSeconds, 10);
  assert.equal(report.solverPositions, 1);
  const html = corpusQualityReportHtml(report);
  assert.ok(html.includes('&lt;unsafe&gt;'));
  assert.ok(!html.includes('<unsafe>'));
  assert.ok(html.includes('Read-only proposals'));
  assert.ok(html.includes('First problem: solver turn 1'));
});

test('incomplete, stale and mixed evidence cannot be presented as a finished corpus audit', () => {
  const changes = [
    (f) => {
      f.snapshot += ' ';
    },
    (f) => {
      f.shards[0].pop();
    },
    (f) => {
      f.shards[0][0].profile.executionId = 'another-run';
    },
    (f) => {
      f.shards[0][0].profile.sourceHashes = { core: 'different' };
    },
    (f) => {
      f.shards[0][2].puzzleHash = 'stale-content';
    },
    (f) => {
      f.manifest.shards[0].ids = ['other-puzzle'];
    },
    (f) => {
      f.shards[0].splice(3, 0, f.shards[0][2]);
    },
  ];
  for (const change of changes) {
    const f = fixture();
    change(f);
    assert.throws(() => buildCorpusQualityReport(f.snapshot, f.manifest, f.shards));
  }
});

test('root choice guard uses recorded kernel coverage and preserves the raw search decision', () => {
  const f = fixture();
  f.shards[0][2].decision = {
    disposition: 'keep',
    reason: 'all-solver-turns-pass',
    firstProblemPly: null,
  };
  f.shards[0][2].evidence[0].searches = [{ moveCoverage: { legalMoveCount: 1 } }];
  const report = buildCorpusQualityReport(f.snapshot, f.manifest, f.shards);
  assert.equal(report.forcedStarts, 1);
  assert.equal(report.entries[0].decision.reason, 'no-choice-at-root');
  assert.equal(report.entries[0].rawDecision.disposition, 'keep');
  assert.equal(report.decisions.keep, 0);
  assert.equal(report.decisions['withhold-candidate'], 1);
});

test('mate proofs render their objective and provide root coverage without an engine score', () => {
  const f = fixture();
  const row = f.shards[0][2];
  row.decision = { disposition: 'keep', reason: 'all-solver-turns-pass', firstProblemPly: null };
  row.evidence[0].mateGoalEvidence = {
    mateIn: 3,
    verdict: 'unique',
    reason: 'unique-within-mate-goal',
    winningMoves: [{ from: 'a1', to: 'a5' }],
    nodes: 123,
    complete: true,
    legalMoveCount: 1,
  };
  const report = buildCorpusQualityReport(f.snapshot, f.manifest, f.shards);
  assert.equal(report.forcedStarts, 1);
  const html = corpusQualityReportHtml(report);
  assert.ok(html.includes('mate within 3 moves'));
  assert.ok(html.includes('123 nodes'));
  assert.ok(html.includes('All legal starting moves checked.'));
  assert.ok(!html.includes('1M/5M'));
});

test('a selective mate retry retains its failed first receipt and actual second budget', () => {
  const f = fixture();
  const row = f.shards[0][2];
  const first = {
    mateIn: 3,
    verdict: 'unresolved',
    reason: 'mate-goal-budget-exhausted',
    winningMoves: [],
    nodes: 123,
    complete: false,
    legalMoveCount: 5,
    limits: { maxNodes: 250000, maxTimeMs: 3000 },
  };
  const last = {
    ...first,
    verdict: 'unique',
    reason: 'unique-within-mate-goal',
    winningMoves: [{ from: 'a1', to: 'a5' }],
    complete: true,
    limits: { maxNodes: 5000000, maxTimeMs: 30000 },
  };
  row.evidence[0].mateGoalEvidence = last;
  row.evidence[0].mateGoalAttempts = [first, last];
  const html = corpusQualityReportHtml(buildCorpusQualityReport(f.snapshot, f.manifest, f.shards));
  assert.ok(html.includes('mate-goal-budget-exhausted'));
  assert.ok(html.includes('250,000 node / 3s cap'));
  assert.ok(html.includes('5,000,000 node / 30s cap'));
  assert.equal((html.match(/Board proof /g) ?? []).length, 2);
});
