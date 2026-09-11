import assert from 'node:assert/strict';
import test from 'node:test';
import { buildElephantChessPuzzleQualityReport } from './elephantchess-puzzle-quality-report.js';
import type { PuzzleQualityAggregate } from './persistence-puzzle-quality.js';

function aggregate(
  puzzleId: string,
  runId: string | null,
  overrides: Partial<PuzzleQualityAggregate> = {},
): PuzzleQualityAggregate {
  return {
    puzzleId,
    variant: 'xiangqi',
    sourceKind: runId ? 'mined' : 'seed',
    miningCandidateId: runId ? `candidate-${puzzleId}` : null,
    miningRunId: runId,
    sessions: 0,
    starts: 0,
    solves: 0,
    cleanSolves: 0,
    reveals: 0,
    abandons: 0,
    bounces: 0,
    inProgress: 0,
    wrongAttempts: 0,
    hints: 0,
    votesUp: 0,
    votesDown: 0,
    averageCompletionSeconds: null,
    signedInAttempts: 0,
    signedInSolves: 0,
    rating: null,
    ratingDeviation: null,
    ...overrides,
  };
}

test('quality report separates the pilot and flags only sample-gated outliers', () => {
  const report = buildElephantChessPuzzleQualityReport({
    aggregates: [
      aggregate('pilot-good', 'pilot', {
        sessions: 80,
        starts: 60,
        solves: 40,
        cleanSolves: 30,
        reveals: 10,
        abandons: 10,
        votesUp: 12,
        votesDown: 1,
      }),
      aggregate('pilot-outlier', 'pilot', {
        sessions: 40,
        starts: 20,
        solves: 2,
        reveals: 10,
        abandons: 14,
        bounces: 10,
        wrongAttempts: 50,
        votesUp: 1,
        votesDown: 8,
      }),
      aggregate('pilot-noisy', 'pilot', {
        sessions: 2,
        starts: 2,
        reveals: 2,
        votesDown: 2,
      }),
      aggregate('baseline', null, { sessions: 20, starts: 10, solves: 8 }),
    ],
    pilotRunId: 'pilot',
    generatedAt: '2026-07-21T00:00:00.000Z',
  });

  assert.equal(report.pilot.puzzles, 3);
  assert.equal(report.baseline.puzzles, 1);
  assert.equal(report.checkpoint.plumbing, 'ready');
  assert.equal(report.checkpoint.meaningful, 'waiting');
  assert.equal(report.recommendation, 'review-outliers-only');
  assert.deepEqual(
    report.outliers.map((outlier) => outlier.puzzleId),
    ['pilot-outlier'],
  );
  assert.deepEqual(report.outliers[0]?.flags, ['low-approval', 'high-abandonment', 'retry-heavy']);
});

test('low solve rate alone is difficulty evidence, not a quality outlier', () => {
  const report = buildElephantChessPuzzleQualityReport({
    aggregates: [
      aggregate('hard', 'pilot', {
        sessions: 120,
        starts: 100,
        solves: 10,
        abandons: 30,
        votesUp: 8,
        votesDown: 1,
      }),
    ],
    pilotRunId: 'pilot',
  });

  assert.deepEqual(report.outliers, []);
  assert.equal(report.recommendation, 'no-manual-review-needed');
});

test('a landing puzzle that visitors leave without moving is bounce, not abandonment', () => {
  const report = buildElephantChessPuzzleQualityReport({
    aggregates: [
      // The shape of whichever puzzle sits nearest rating 1500: every anonymous
      // visit lands on it, most never touch a piece.
      aggregate('landing', 'pilot', {
        sessions: 40,
        starts: 6,
        solves: 3,
        abandons: 2,
        bounces: 30,
        inProgress: 5,
      }),
    ],
    pilotRunId: 'pilot',
  });

  assert.deepEqual(report.outliers, []);
  assert.equal(report.pilot.bounces, 30);
  assert.equal(report.pilot.bounceRate, 0.75);
  assert.equal(report.pilot.abandonmentRate, 2 / 6);
  assert.equal(report.pilot.terminalSessions, 5);
});
