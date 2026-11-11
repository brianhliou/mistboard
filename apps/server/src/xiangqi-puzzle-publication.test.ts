import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { XIANGQI_PUZZLE_ADMISSION_PROFILE, XIANGQI_SOLVER_SCORE_PROFILE } from '@mistboard/game';
import { loadAllSeedPuzzles } from '@mistboard/game/puzzle-seed';
import type pg from 'pg';
import { close, getPool, init } from './persistence-db.js';
import {
  planXiangqiPuzzlePublication,
  publishXiangqiPuzzlePublication,
} from './xiangqi-puzzle-publication.js';

const engineProfile = {
  binary: { sha256: 'd'.repeat(64) },
  network: { sha256: XIANGQI_SOLVER_SCORE_PROFILE.networkSha256 },
};

function runRow() {
  return {
    engine_profile: engineProfile,
    status: 'review',
    license_status: 'cleared',
    scan_profile: { profileVersion: 'test-v3', ...XIANGQI_PUZZLE_ADMISSION_PROFILE },
    audit_profile: { profileVersion: 'test-v3', ...XIANGQI_PUZZLE_ADMISSION_PROFILE },
  };
}

function seedMatePuzzle() {
  const seed = loadAllSeedPuzzles().find(
    (puzzle) =>
      puzzle.variant === 'xiangqi' &&
      puzzle.goal.type === 'checkmate' &&
      puzzle.solution.length >= 5,
  );
  assert.ok(seed);
  return seed;
}

function candidateRow(puzzle: unknown, auditEvidence: Record<string, unknown>) {
  const now = new Date('2026-10-23T00:00:00Z');
  return {
    id: 'candidate',
    run_id: 'run',
    historical_game_id: 'source-game',
    post_blunder_ply: 17,
    position_key: 'position',
    trigger: 'eval-swing',
    status: 'review',
    rejection_reason: null,
    puzzle_data: puzzle,
    scan_evidence: {},
    artifact_sha256: null,
    created_at: now,
    updated_at: now,
    selection_index: 0,
    cohort: 'representative-live',
    selection_evidence: {},
    position_duplicate_count: 1,
    review_id: null,
    ...Object.fromEntries(
      ['verify', 'audit'].flatMap((stage) =>
        Object.entries({
          id: `${stage}-judgment`,
          candidate_id: 'candidate',
          stage,
          profile_version: 'test-v3',
          verdict: 'pass',
          reason: null,
          engine_profile: engineProfile,
          evidence: {
            ...XIANGQI_PUZZLE_ADMISSION_PROFILE,
            ...(stage === 'audit' ? auditEvidence : { bestMate: 3, secondMate: 5 }),
          },
          artifact_sha256: null,
          created_at: now,
        }).map(([key, value]) => [`${stage}_${key}`, value]),
      ),
    ),
  };
}

async function assertPublishedMateSpeedOnly(
  t: TestContext,
  auditEvidence: Record<string, unknown>,
  expected: boolean | null,
) {
  const puzzle = { ...seedMatePuzzle(), sourceGame: { gameId: 'source-game', ply: 17 } };
  const candidate = candidateRow(puzzle, auditEvidence);
  let inserted: { sql: string; values: unknown[] } | undefined;
  const db = {
    async query(sql: string, values: unknown[] = []) {
      if (sql.includes('SELECT run.status')) return { rows: [runRow()] };
      if (sql.includes('SELECT candidate.*')) return { rows: [candidate] };
      if (sql.includes('max(seq)')) return { rows: [{ count: 0, max_seq: null }] };
      if (sql.includes('INSERT INTO puzzles')) inserted = { sql, values };
      if (sql.includes('RETURNING id')) return { rows: [{ id: 'candidate' }] };
      return { rows: [] };
    },
    release() {},
  };
  init('postgres://unused:unused@localhost/unused');
  t.mock.method(getPool(), 'connect', async () => db as unknown as pg.PoolClient);
  t.after(async () => {
    t.mock.restoreAll();
    await close();
  });
  const plan = await planXiangqiPuzzlePublication(db as unknown as pg.Pool, 'run');
  const result = await publishXiangqiPuzzlePublication({
    runId: 'run',
    expectedTotal: 1,
    expectedPublicationSha256: plan.publicationSha256,
    operatorNote: 'Test publication',
  });
  assert.equal(result.publishedNow, 1);
  assert.ok(inserted);
  assert.match(inserted.sql, /mining_candidate_id, mate_speed_only/);
  assert.equal(inserted.values.at(-1), expected);
  assert.doesNotMatch(inserted.sql, /hidden_reason/);
  assert.deepEqual(JSON.parse(inserted.values[7] as string), puzzle);
}

test('publication records a runner-up mate on a later solver move without hiding the puzzle', async (t) => {
  await assertPublishedMateSpeedOnly(
    t,
    {
      plies: [
        { solutionPly: 0, bestMate: 4, secondMate: null },
        { solutionPly: 2, bestMate: 3, secondMate: 5 },
        { solutionPly: 4, bestMate: 1, secondMate: 1 },
      ],
    },
    true,
  );
});

test('publication distinguishes speed-only admission from immediate mates and missing audits', async (t) => {
  const cases: { name: string; evidence: Record<string, unknown>; expected: boolean | null }[] = [
    {
      name: 'immediate mates are accepted by the grader',
      evidence: { plies: [{ bestMate: 1, secondMate: 3 }] },
      expected: false,
    },
    {
      name: 'a lone mate is unique',
      evidence: { plies: [{ bestMate: 3, secondMate: null }] },
      expected: false,
    },
    {
      name: 'negative mate means the runner-up loses',
      evidence: { plies: [{ bestMate: 3, secondMate: -5 }] },
      expected: false,
    },
    {
      name: 'centipawn evidence is not a mate',
      evidence: { plies: [{ bestMate: null, secondMate: null }] },
      expected: false,
    },
    { name: 'missing audit plies are unknown', evidence: {}, expected: null },
    { name: 'empty audit plies are unknown', evidence: { plies: [] }, expected: null },
    {
      name: 'missing mate scores are unknown',
      evidence: { plies: [{ bestCp: 29997, secondCp: 29995 }] },
      expected: null,
    },
  ];
  for (const item of cases) {
    await t.test(item.name, async (subtest) => {
      await assertPublishedMateSpeedOnly(subtest, item.evidence, item.expected);
    });
  }
});

test('publication refuses a DPXQ puzzle without its http credit and accepts one with it (#712)', async () => {
  const plan = (sourceGame: Record<string, unknown>) => {
    const candidate = candidateRow({ ...seedMatePuzzle(), sourceGame }, {});
    const db = {
      async query(sql: string) {
        if (sql.includes('SELECT run.status'))
          return {
            rows: [{ ...runRow(), source_slug: 'dpxq-archive-test' }],
          };
        if (sql.includes('SELECT candidate.*')) return { rows: [candidate] };
        if (sql.includes('max(seq)')) return { rows: [{ count: 0, max_seq: null }] };
        return { rows: [] };
      },
    };
    return planXiangqiPuzzlePublication(db as unknown as pg.Pool, 'run');
  };
  await assert.rejects(
    plan({ gameId: 'source-game', ply: 17 }),
    /lacks the required source credit/,
  );
  await assert.rejects(
    plan({
      gameId: 'source-game',
      ply: 17,
      attribution: { name: 'DPXQ', url: 'https://www.dpxq.com/hldcg/search/view_m_1.html' },
    }),
    /does not accept/,
  );
  const ok = await plan({
    gameId: 'source-game',
    ply: 17,
    attribution: { name: 'DPXQ', url: 'http://www.dpxq.com/hldcg/search/view_m_1.html' },
  });
  assert.equal(ok.totalCandidates, 1);
});

// A prior pass may be valid evidence for its old policy, but cannot certify a
// candidate under the current mining rule simply by being the latest row.
test('publication rejects old gate versions and stale profile judgments', async () => {
  const puzzle = { ...seedMatePuzzle(), sourceGame: { gameId: 'source-game', ply: 17 } };
  const plan = (run: object, overrides: object = {}) => {
    const candidate = { ...candidateRow(puzzle, {}), ...overrides };
    const db = {
      async query(sql: string) {
        if (sql.includes('SELECT run.status')) return { rows: [run] };
        if (sql.includes('SELECT candidate.*')) return { rows: [candidate] };
        if (sql.includes('max(seq)')) return { rows: [{ count: 0, max_seq: null }] };
        return { rows: [] };
      },
    };
    return planXiangqiPuzzlePublication(db as unknown as pg.Pool, 'run');
  };
  await assert.rejects(
    plan({ status: 'review', license_status: 'cleared' }),
    /admission profile mismatch/,
  );
  await assert.rejects(plan(runRow(), { verify_evidence: {} }), /admission profile mismatch/);
  await assert.rejects(plan(runRow(), { audit_evidence: {} }), /admission profile mismatch/);
  await assert.rejects(
    plan(runRow(), { verify_profile_version: 'previous-profile' }),
    /different mining profile/,
  );
  await assert.rejects(
    plan(runRow(), { audit_profile_version: 'previous-profile' }),
    /different mining profile/,
  );
  await assert.rejects(
    plan({ ...runRow(), audit_profile: { ...runRow().audit_profile, winRateK: 400 } }),
    /admission profile mismatch: winRateK/,
  );
  await assert.rejects(
    plan({ ...runRow(), scan_profile: { ...runRow().scan_profile, endpointVersion: 'old' } }),
    /admission profile mismatch: endpointVersion/,
  );
  await assert.rejects(
    plan({ ...runRow(), engine_profile: { ...engineProfile, network: { sha256: 'old' } } }),
    /incompatible scoring engine/,
  );
  await assert.rejects(
    plan(runRow(), {
      verify_engine_profile: { ...engineProfile, binary: { sha256: 'e'.repeat(64) } },
    }),
    /different scoring engine/,
  );
  await assert.rejects(
    plan(runRow(), { audit_engine_profile: { ...engineProfile, network: { sha256: 'old' } } }),
    /different scoring engine/,
  );
  await assert.rejects(
    plan({ ...runRow(), scan_profile: { ...runRow().scan_profile, minimumRootLegalMoves: 1 } }),
    /admission profile mismatch: minimumRootLegalMoves/,
  );
  await assert.rejects(
    plan(runRow(), {
      puzzle_data: {
        ...puzzle,
        goal: { type: 'winning-advantage' },
        solution: [{ from: 'a3', to: 'e3' }],
        initial: {
          ...puzzle.initial,
          status: { type: 'playing', turn: 'red' },
          board: {
            e1: { color: 'red', role: 'general' },
            a3: { color: 'red', role: 'chariot' },
            d10: { color: 'black', role: 'general' },
            e3: { color: 'black', role: 'chariot' },
            d2: { color: 'black', role: 'chariot' },
            h2: { color: 'black', role: 'horse' },
          },
        },
      },
    }),
    /no starting choice/,
  );
  assert.equal((await plan(runRow())).eligibleCandidates, 1);
});
