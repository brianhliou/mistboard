import { createHash } from 'node:crypto';
import {
  legacyPositionRepetitionKey,
  validateStandardXiangqiPuzzle,
  XIANGQI_SPEC_ID,
  type XiangqiPuzzle,
} from '@mistboard/game';
import type pg from 'pg';
import { withTransaction } from './persistence-db.js';
import {
  listXiangqiPuzzleEditorialCandidates,
  type XiangqiPuzzleEditorialCandidate,
} from './persistence-xiangqi-puzzle-mining.js';

type Queryable = Pick<pg.Pool | pg.PoolClient, 'query'>;

type PublicationCandidate = {
  entry: XiangqiPuzzleEditorialCandidate;
  puzzle: XiangqiPuzzle;
};

export type XiangqiPuzzlePublicationPlan = {
  runId: string;
  runStatus: string;
  sourceLicenseStatus: string;
  totalCandidates: number;
  eligibleCandidates: number;
  alreadyPublished: number;
  currentPuzzleCount: number;
  nextSequence: number;
  publicationSha256: string;
  candidates: PublicationCandidate[];
};

export type XiangqiPuzzlePublicationResult = {
  runId: string;
  publicationSha256: string;
  publishedNow: number;
  alreadyPublished: number;
  totalPublished: number;
  firstSequence: number | null;
  lastSequence: number | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validatedPuzzle(entry: XiangqiPuzzleEditorialCandidate): XiangqiPuzzle {
  const value = entry.candidate.puzzleData;
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    value.variant !== XIANGQI_SPEC_ID ||
    typeof value.title !== 'string' ||
    !isRecord(value.initial) ||
    !Array.isArray(value.solution) ||
    !isRecord(value.goal) ||
    !Array.isArray(value.themes)
  ) {
    throw new Error(`candidate ${entry.candidate.id} has malformed xiangqi puzzle data`);
  }
  const puzzle = value as XiangqiPuzzle;
  const validation = validateStandardXiangqiPuzzle(puzzle);
  if (!validation.ok) {
    throw new Error(
      `candidate ${entry.candidate.id} puzzle ${puzzle.id} failed validation: ` +
        `${validation.issue.code} at ply ${validation.issue.ply}`,
    );
  }
  if (!puzzle.sourceGame) {
    throw new Error(`candidate ${entry.candidate.id} puzzle ${puzzle.id} lacks source provenance`);
  }
  if (
    puzzle.sourceGame.gameId !== entry.candidate.historicalGameId ||
    puzzle.sourceGame.ply !== entry.candidate.postBlunderPly
  ) {
    throw new Error(
      `candidate ${entry.candidate.id} puzzle ${puzzle.id} has mismatched provenance`,
    );
  }
  return puzzle;
}

function publicationHash(items: readonly PublicationCandidate[]): string {
  return createHash('sha256')
    .update(
      JSON.stringify(
        items.map(({ entry, puzzle }) => ({
          candidateId: entry.candidate.id,
          puzzle,
          verifyJudgmentId: entry.verifyJudgment?.id ?? null,
          auditJudgmentId: entry.auditJudgment?.id ?? null,
        })),
      ),
    )
    .digest('hex');
}

export async function planXiangqiPuzzlePublication(
  db: Queryable,
  runId: string,
): Promise<XiangqiPuzzlePublicationPlan> {
  if (!runId.trim()) throw new Error('runId is required');
  const runResult = await db.query<{ status: string; license_status: string }>(
    `SELECT run.status, source.license_status
     FROM xiangqi_puzzle_mining_runs run
     JOIN historical_xiangqi_sources source ON source.id = run.source_id
     WHERE run.id = $1`,
    [runId],
  );
  const run = runResult.rows[0];
  if (!run) throw new Error(`xiangqi puzzle mining run ${runId} not found`);
  if (run.status !== 'review' && run.status !== 'completed') {
    throw new Error(`run ${runId} must be in review or completed, got ${run.status}`);
  }
  if (run.license_status !== 'cleared') {
    throw new Error(`run ${runId} source license is not cleared`);
  }

  const entries = await listXiangqiPuzzleEditorialCandidates(db, {
    runId,
    statuses: ['review', 'approved', 'published'],
  });
  const seenPuzzleIds = new Set<string>();
  const items = entries.map((entry) => {
    if (entry.verifyJudgment?.verdict !== 'pass') {
      throw new Error(`candidate ${entry.candidate.id} lacks a latest passing verify judgment`);
    }
    if (entry.auditJudgment?.verdict !== 'pass') {
      throw new Error(`candidate ${entry.candidate.id} lacks a latest passing audit judgment`);
    }
    if (entry.positionDuplicateCount !== 1) {
      throw new Error(`candidate ${entry.candidate.id} repeats a position in the publication set`);
    }
    if (
      (entry.candidate.status === 'approved' || entry.candidate.status === 'published') &&
      (entry.latestReview?.verdict !== 'approve' || entry.latestReview.reason !== 'publishable')
    ) {
      throw new Error(`candidate ${entry.candidate.id} lacks a publishable approval review`);
    }
    const puzzle = validatedPuzzle(entry);
    if (seenPuzzleIds.has(puzzle.id)) {
      throw new Error(`publication set contains duplicate puzzle id ${puzzle.id}`);
    }
    seenPuzzleIds.add(puzzle.id);
    return { entry, puzzle };
  });
  const eligible = items.filter(({ entry }) => entry.candidate.status !== 'published');
  const published = items.filter(({ entry }) => entry.candidate.status === 'published');

  if (items.length > 0) {
    const puzzleIds = items.map(({ puzzle }) => puzzle.id);
    const candidateIds = items.map(({ entry }) => entry.candidate.id);
    const existingResult = await db.query<{
      id: string;
      mining_candidate_id: string | null;
    }>(
      `SELECT id, mining_candidate_id
       FROM puzzles
       WHERE id = ANY($1::text[]) OR mining_candidate_id = ANY($2::text[])`,
      [puzzleIds, candidateIds],
    );
    const byCandidate = new Map(
      existingResult.rows.flatMap((row) =>
        row.mining_candidate_id ? [[row.mining_candidate_id, row] as const] : [],
      ),
    );
    const byPuzzle = new Map(existingResult.rows.map((row) => [row.id, row]));

    // positionDuplicateCount only partitions within this run, so it cannot see
    // a position an EARLIER run already published. Without this check the same
    // tactical position, reached in two different source games, ships twice as
    // two unrelated puzzles. Mined puzzles carry their candidate, so the
    // published position set is reachable without a new column.
    // Runs before 2026-10 stored keys in the old spelling (chariot and cannon
    // both `c`), so look a position up in both spellings.
    const publishingKeys = new Map<string, string>();
    for (const { entry } of items) {
      if (entry.candidate.status === 'published') continue;
      publishingKeys.set(entry.candidate.positionKey, entry.candidate.id);
      publishingKeys.set(
        legacyPositionRepetitionKey(entry.candidate.positionKey),
        entry.candidate.id,
      );
    }
    if (publishingKeys.size > 0) {
      const priorPositions = await db.query<{ position_key: string; puzzle_id: string }>(
        `SELECT prior.position_key, puzzle.id AS puzzle_id
           FROM puzzles puzzle
           JOIN xiangqi_puzzle_mining_candidates prior
             ON prior.id = puzzle.mining_candidate_id
          WHERE prior.run_id <> $1
            AND prior.position_key = ANY($2::text[])`,
        [runId, [...publishingKeys.keys()]],
      );
      for (const row of priorPositions.rows) {
        const candidateId = publishingKeys.get(row.position_key);
        throw new Error(
          `candidate ${candidateId} repeats a position already published as puzzle ${row.puzzle_id}`,
        );
      }
    }

    for (const { entry, puzzle } of items) {
      const linked = byCandidate.get(entry.candidate.id);
      const sameId = byPuzzle.get(puzzle.id);
      if (entry.candidate.status === 'published') {
        if (!linked || linked.id !== puzzle.id) {
          throw new Error(`published candidate ${entry.candidate.id} lacks its served puzzle row`);
        }
        continue;
      }
      if (linked || sameId) {
        throw new Error(`candidate ${entry.candidate.id} conflicts with an existing puzzle row`);
      }
    }
  }

  const puzzleStats = await db.query<{ count: number; max_seq: number | null }>(
    `SELECT count(*)::int AS count, max(seq)::int AS max_seq FROM puzzles`,
  );
  const currentPuzzleCount = puzzleStats.rows[0]?.count ?? 0;
  const nextSequence = (puzzleStats.rows[0]?.max_seq ?? -1) + 1;
  return {
    runId,
    runStatus: run.status,
    sourceLicenseStatus: run.license_status,
    totalCandidates: items.length,
    eligibleCandidates: eligible.length,
    alreadyPublished: published.length,
    currentPuzzleCount,
    nextSequence,
    publicationSha256: publicationHash(items),
    candidates: eligible,
  };
}

export async function publishXiangqiPuzzlePublication(input: {
  runId: string;
  expectedTotal: number;
  expectedPublicationSha256: string;
  operatorNote: string;
}): Promise<XiangqiPuzzlePublicationResult> {
  if (!Number.isSafeInteger(input.expectedTotal) || input.expectedTotal <= 0) {
    throw new Error('expectedTotal must be a positive integer');
  }
  if (!/^[0-9a-f]{64}$/.test(input.expectedPublicationSha256)) {
    throw new Error('expectedPublicationSha256 must be a lowercase sha256');
  }
  const operatorNote = input.operatorNote.trim();
  if (!operatorNote) throw new Error('operatorNote is required');

  return withTransaction(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      'mistboard:puzzle-seed-sync',
    ]);
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      `mistboard:xiangqi-puzzle-publication:${input.runId}`,
    ]);
    const plan = await planXiangqiPuzzlePublication(client, input.runId);
    if (plan.totalCandidates !== input.expectedTotal) {
      throw new Error(
        `publication total changed: expected ${input.expectedTotal}, got ${plan.totalCandidates}`,
      );
    }
    if (plan.publicationSha256 !== input.expectedPublicationSha256) {
      throw new Error(
        `publication sha changed: expected ${input.expectedPublicationSha256}, ` +
          `got ${plan.publicationSha256}`,
      );
    }

    let sequence = plan.nextSequence;
    const firstSequence = plan.candidates.length > 0 ? sequence : null;
    for (const { entry, puzzle } of plan.candidates) {
      if (entry.candidate.status === 'review') {
        await client.query(
          `INSERT INTO xiangqi_puzzle_editorial_reviews
             (candidate_id, reviewer_user_id, verdict, reason, notes)
           VALUES ($1, NULL, 'approve', 'publishable', $2)`,
          [entry.candidate.id, operatorNote],
        );
      }
      await client.query(
        `INSERT INTO puzzles
           (id, variant, title, seq, goal_type, themes, solution_plies, data,
            source_kind, mined_at, mining_candidate_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::json, 'mined', now(), $9)`,
        [
          puzzle.id,
          puzzle.variant,
          puzzle.title,
          sequence,
          puzzle.goal.type,
          [...puzzle.themes],
          puzzle.solution.length,
          JSON.stringify(puzzle),
          entry.candidate.id,
        ],
      );
      const updated = await client.query<{ id: string }>(
        `UPDATE xiangqi_puzzle_mining_candidates
         SET status = 'published', rejection_reason = NULL, updated_at = now()
         WHERE id = $1 AND run_id = $2 AND status = ANY($3::text[])
         RETURNING id`,
        [entry.candidate.id, input.runId, ['review', 'approved']],
      );
      if (!updated.rows[0]) {
        throw new Error(`candidate ${entry.candidate.id} changed during publication`);
      }
      sequence += 1;
    }
    await client.query(
      `UPDATE xiangqi_puzzle_mining_runs
       SET status = 'completed', finished_at = COALESCE(finished_at, now()), updated_at = now()
       WHERE id = $1 AND status = ANY($2::text[])`,
      [input.runId, ['review', 'completed']],
    );
    const totalPublished = plan.alreadyPublished + plan.candidates.length;
    return {
      runId: input.runId,
      publicationSha256: plan.publicationSha256,
      publishedNow: plan.candidates.length,
      alreadyPublished: plan.alreadyPublished,
      totalPublished,
      firstSequence,
      lastSequence: plan.candidates.length > 0 ? sequence - 1 : null,
    };
  });
}
