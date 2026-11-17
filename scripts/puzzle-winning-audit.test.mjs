import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import pg from 'pg';
import {
  XIANGQI_SOLVER_GATE_VERSION,
  XIANGQI_SOLVER_SCORE_PROFILE,
} from '../packages/game/dist/index.js';
import { loadAllSeedPuzzles } from '../packages/game/dist/puzzle-seed.js';
import {
  assessStoredAudit,
  buildReport,
  checkpointKey,
  exportSnapshot,
  recheckPuzzle,
  reportHtml,
} from './puzzle-winning-audit.mjs';

const puzzle = loadAllSeedPuzzles().find((p) => p.variant === 'xiangqi' && p.solution.length >= 3);
assert.ok(puzzle);
function row() {
  return {
    id: puzzle.id,
    puzzle,
    audit_matches_puzzle: true,
    audit_verdict: 'pass',
    network_sha256: XIANGQI_SOLVER_SCORE_PROFILE.networkSha256,
    audit_id: '1',
    evidence: {
      solverGateVersion: XIANGQI_SOLVER_GATE_VERSION,
      plies: puzzle.solution.flatMap((_, i) =>
        i % 2 === 0
          ? [
              {
                solutionPly: i,
                matchesShipped: true,
                bestCp: 600,
                bestMate: null,
                secondCp: 40,
                secondMate: null,
              },
            ]
          : [],
      ),
    },
  };
}

test('stored audit reclassification catches mate versus a winning alternative at any solver ply', () => {
  const input = row();
  input.evidence.plies.at(-1).bestMate = 9;
  input.evidence.plies.at(-1).bestCp = 29991;
  input.evidence.plies.at(-1).secondCp = 1730;
  const result = assessStoredAudit(input);
  assert.equal(result.status, 'flagged');
  assert.equal(result.failures[0].ply, puzzle.solution.length - 1);
  assert.equal(result.failures[0].reason, 'insufficient-separation');
  input.evidence.plies.at(-1).bestMate = 1;
  assert.equal(assessStoredAudit(input).status, 'flagged');
});

test('missing, malformed, stale or incomplete evidence stays unknown', () => {
  for (const change of [
    (r) => (r.network_sha256 = 'old-main-net'),
    (r) => (r.evidence.solverGateVersion = 'winning-floor-v2'),
    (r) => (r.evidence.plies[0].secondCp = null),
    (r) => {
      r.evidence.plies[0].bestMate = 1;
      r.evidence.plies[0].secondMate = 1;
    },
    (r) => (r.audit_matches_puzzle = false),
    (r) => (r.audit_verdict = 'reject'),
    (r) => (r.evidence = {}),
    (r) => r.evidence.plies.pop(),
    (r) => (r.evidence.plies[0].bestCp = NaN),
    (r) => delete r.evidence.plies[0].secondMate,
    (r) => (r.evidence.plies[0].solutionPly = 2),
  ]) {
    const input = row();
    change(input);
    assert.equal(assessStoredAudit(input).status, 'needs-reanalysis');
  }
});

test('fresh recheck stops at a failing solver position and validates the stored line first', async () => {
  let calls = 0;
  const result = await recheckPuzzle(puzzle, async () => {
    calls++;
    return {
      unique: false,
      reason: 'insufficient-separation',
      best: { scoreCp: 29991, mate: 9 },
      second: { scoreCp: 1730, mate: null },
      lines: [],
    };
  });
  assert.equal(calls, 1);
  assert.equal(result.verdict, 'confirmed-gate-failure');
  assert.equal(result.plies[0].ply, 0);
  const invalid = await recheckPuzzle(
    { ...puzzle, solution: [{ from: 'a1', to: 'a1' }] },
    async () => {
      throw new Error('must not run');
    },
  );
  assert.equal(invalid.verdict, 'needs-reanalysis');
});

test('a unique engine move different from the stored answer is not cleared', async () => {
  const result = await recheckPuzzle(puzzle, async () => ({
    unique: true,
    reason: 'only-move',
    lines: [{ pvUci: ['a0a0'] }],
  }));
  assert.equal(result.verdict, 'engine-disagrees');
});

test('checkpoint identity includes the profile and exact puzzle content', () => {
  const key = checkpointKey({ id: 'p', profileHash: 'a', puzzleHash: 'b' });
  assert.notEqual(key, checkpointKey({ id: 'p', profileHash: 'new', puzzleHash: 'b' }));
  assert.notEqual(key, checkpointKey({ id: 'p', profileHash: 'a', puzzleHash: 'new' }));
});

test('report separates historical flags from fresh evidence and escapes source text', () => {
  const input = row();
  input.id = '<unsafe>';
  input.evidence.plies[0].secondCp = 500;
  const report = buildReport({ exportedAt: '2026-11-09', rows: [input] });
  assert.equal(report.storedCounts.flagged, 1);
  assert.equal(report.freshCounts['not-rechecked'], 1);
  const html = reportHtml(report);
  assert.ok(html.includes('&lt;unsafe&gt;'));
  assert.ok(!html.includes('<unsafe>'));
  assert.ok(html.includes('None are applied automatically'));
});

test('database export starts a read-only transaction and emits no write SQL', async (t) => {
  const statements = [];
  const directory = mkdtempSync(join(tmpdir(), 'puzzle-audit-test-'));
  const path = join(directory, 'snapshot.json');
  t.mock.method(pg.Client.prototype, 'connect', async () => {});
  t.mock.method(pg.Client.prototype, 'end', async () => {});
  t.mock.method(pg.Client.prototype, 'query', async (sql) => {
    statements.push(sql);
    return { rows: sql.startsWith('SELECT') ? [row()] : [] };
  });
  t.after(() => {
    t.mock.restoreAll();
    rmSync(directory, { recursive: true, force: true });
  });
  assert.equal((await exportSnapshot(path)).served, 1);
  assert.equal(statements[0], 'BEGIN READ ONLY');
  assert.ok(statements.every((sql) => !/\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/i.test(sql)));
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).rows[0].id, puzzle.id);
});

test('mixed engine profiles cannot be presented as one corpus recheck', () => {
  assert.throws(
    () => buildReport({ rows: [] }, [{ profileHash: 'one' }, { profileHash: 'other' }]),
    /one fixed search profile/,
  );
});
