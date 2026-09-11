import type { PuzzleQualityAggregate } from './persistence-puzzle-quality.js';
import type { XiangqiEditorialCandidateSignals } from './xiangqi-puzzle-editorial-ranking.js';

export type PuzzleQualityOutlierFlag =
  | 'low-approval'
  | 'high-reveal'
  | 'high-abandonment'
  | 'retry-heavy';

export type PuzzleQualityCohortSummary = {
  puzzles: number;
  sessions: number;
  starts: number;
  terminalSessions: number;
  solves: number;
  cleanSolves: number;
  reveals: number;
  abandons: number;
  bounces: number;
  wrongAttempts: number;
  hints: number;
  votesUp: number;
  votesDown: number;
  signedInAttempts: number;
  signedInSolves: number;
  solveRate: number | null;
  cleanSolveRate: number | null;
  revealRate: number | null;
  /** Abandons after at least one move, over starts. */
  abandonmentRate: number | null;
  /** Views that left without moving, over sessions. The page, not the puzzle. */
  bounceRate: number | null;
  approvalRate: number | null;
};

export type ElephantChessPuzzleQualityReport = {
  kind: 'elephantchess-puzzle-quality-report';
  pilotRunId: string;
  generatedAt: string;
  thresholds: {
    plumbingSessions: number;
    meaningfulStarts: number;
    perPuzzleSessions: number;
    perPuzzleVotes: number;
  };
  checkpoint: {
    plumbing: 'waiting' | 'ready';
    meaningful: 'waiting' | 'ready';
    sessionsRemaining: number;
    startsRemaining: number;
  };
  pilot: PuzzleQualityCohortSummary;
  baseline: PuzzleQualityCohortSummary;
  outliers: Array<{
    puzzleId: string;
    miningCandidateId: string | null;
    flags: PuzzleQualityOutlierFlag[];
    sessions: number;
    starts: number;
    terminalSessions: number;
    solveRate: number | null;
    revealRate: number | null;
    abandonmentRate: number | null;
    approvalRate: number | null;
    wrongAttemptsPerStart: number | null;
    rating: number | null;
    miningSignals: XiangqiEditorialCandidateSignals | null;
  }>;
  recommendation: 'collect-more-data' | 'review-outliers-only' | 'no-manual-review-needed';
};

const ratio = (numerator: number, denominator: number): number | null =>
  denominator > 0 ? numerator / denominator : null;

export function summarizePuzzleQuality(
  aggregates: readonly PuzzleQualityAggregate[],
): PuzzleQualityCohortSummary {
  const totals = aggregates.reduce(
    (summary, puzzle) => ({
      sessions: summary.sessions + puzzle.sessions,
      starts: summary.starts + puzzle.starts,
      solves: summary.solves + puzzle.solves,
      cleanSolves: summary.cleanSolves + puzzle.cleanSolves,
      reveals: summary.reveals + puzzle.reveals,
      abandons: summary.abandons + puzzle.abandons,
      bounces: summary.bounces + puzzle.bounces,
      wrongAttempts: summary.wrongAttempts + puzzle.wrongAttempts,
      hints: summary.hints + puzzle.hints,
      votesUp: summary.votesUp + puzzle.votesUp,
      votesDown: summary.votesDown + puzzle.votesDown,
      signedInAttempts: summary.signedInAttempts + puzzle.signedInAttempts,
      signedInSolves: summary.signedInSolves + puzzle.signedInSolves,
    }),
    {
      sessions: 0,
      starts: 0,
      solves: 0,
      cleanSolves: 0,
      reveals: 0,
      abandons: 0,
      bounces: 0,
      wrongAttempts: 0,
      hints: 0,
      votesUp: 0,
      votesDown: 0,
      signedInAttempts: 0,
      signedInSolves: 0,
    },
  );
  const terminalSessions = totals.solves + totals.reveals + totals.abandons;
  const votes = totals.votesUp + totals.votesDown;
  return {
    puzzles: aggregates.length,
    ...totals,
    terminalSessions,
    solveRate: ratio(totals.solves, terminalSessions),
    cleanSolveRate: ratio(totals.cleanSolves, terminalSessions),
    revealRate: ratio(totals.reveals, terminalSessions),
    abandonmentRate: ratio(totals.abandons, totals.starts),
    bounceRate: ratio(totals.bounces, totals.sessions),
    approvalRate: ratio(totals.votesUp, votes),
  };
}

export function buildElephantChessPuzzleQualityReport(input: {
  aggregates: readonly PuzzleQualityAggregate[];
  pilotRunId: string;
  signalsByCandidateId?: ReadonlyMap<string, XiangqiEditorialCandidateSignals>;
  generatedAt?: string;
  limit?: number;
  perPuzzleSessions?: number;
  perPuzzleVotes?: number;
  plumbingSessions?: number;
  meaningfulStarts?: number;
}): ElephantChessPuzzleQualityReport {
  const perPuzzleSessions = input.perPuzzleSessions ?? 10;
  const perPuzzleVotes = input.perPuzzleVotes ?? 5;
  const plumbingSessions = input.plumbingSessions ?? 100;
  const meaningfulStarts = input.meaningfulStarts ?? 1_000;
  const pilotAggregates = input.aggregates.filter(
    (puzzle) => puzzle.miningRunId === input.pilotRunId,
  );
  const baselineAggregates = input.aggregates.filter(
    (puzzle) => puzzle.miningRunId !== input.pilotRunId,
  );
  const pilot = summarizePuzzleQuality(pilotAggregates);
  const baseline = summarizePuzzleQuality(baselineAggregates);
  const signals = input.signalsByCandidateId ?? new Map();
  const outliers = pilotAggregates
    .map((puzzle) => {
      const terminalSessions = puzzle.solves + puzzle.reveals + puzzle.abandons;
      const votes = puzzle.votesUp + puzzle.votesDown;
      const approvalRate = ratio(puzzle.votesUp, votes);
      const revealRate = ratio(puzzle.reveals, terminalSessions);
      const abandonmentRate = ratio(puzzle.abandons, puzzle.starts);
      const wrongAttemptsPerStart = ratio(puzzle.wrongAttempts, puzzle.starts);
      const flags: PuzzleQualityOutlierFlag[] = [];
      if (votes >= perPuzzleVotes && approvalRate !== null && approvalRate < 0.5) {
        flags.push('low-approval');
      }
      if (terminalSessions >= perPuzzleSessions && revealRate !== null && revealRate >= 0.5) {
        flags.push('high-reveal');
      }
      if (
        puzzle.starts >= perPuzzleSessions &&
        abandonmentRate !== null &&
        abandonmentRate >= 0.5
      ) {
        flags.push('high-abandonment');
      }
      if (
        puzzle.starts >= perPuzzleSessions &&
        wrongAttemptsPerStart !== null &&
        wrongAttemptsPerStart >= 2
      ) {
        flags.push('retry-heavy');
      }
      return {
        puzzleId: puzzle.puzzleId,
        miningCandidateId: puzzle.miningCandidateId,
        flags,
        sessions: puzzle.sessions,
        starts: puzzle.starts,
        terminalSessions,
        solveRate: ratio(puzzle.solves, terminalSessions),
        revealRate,
        abandonmentRate,
        approvalRate,
        wrongAttemptsPerStart,
        rating: puzzle.rating,
        miningSignals: puzzle.miningCandidateId
          ? (signals.get(puzzle.miningCandidateId) ?? null)
          : null,
      };
    })
    .filter((puzzle) => puzzle.flags.length > 0)
    .sort(
      (left, right) =>
        right.flags.length - left.flags.length ||
        (left.approvalRate ?? 1) - (right.approvalRate ?? 1) ||
        right.sessions - left.sessions,
    )
    .slice(0, input.limit ?? 20);

  return {
    kind: 'elephantchess-puzzle-quality-report',
    pilotRunId: input.pilotRunId,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    thresholds: {
      plumbingSessions,
      meaningfulStarts,
      perPuzzleSessions,
      perPuzzleVotes,
    },
    checkpoint: {
      plumbing: pilot.sessions >= plumbingSessions ? 'ready' : 'waiting',
      meaningful: pilot.starts >= meaningfulStarts ? 'ready' : 'waiting',
      sessionsRemaining: Math.max(0, plumbingSessions - pilot.sessions),
      startsRemaining: Math.max(0, meaningfulStarts - pilot.starts),
    },
    pilot,
    baseline,
    outliers,
    recommendation:
      pilot.sessions < plumbingSessions
        ? 'collect-more-data'
        : outliers.length > 0
          ? 'review-outliers-only'
          : 'no-manual-review-needed',
  };
}
