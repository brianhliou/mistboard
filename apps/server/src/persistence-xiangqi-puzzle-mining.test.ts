import {
  createInitialXiangqiState,
  legacyPositionRepetitionKey,
  positionRepetitionKey,
  XIANGQI_SPEC_ID,
  type XiangqiPuzzle,
} from '@mistboard/game';
import type { ElephantChessPilotGame } from './elephantchess-pilot-manifest.js';
import { buildElephantChessPilotManifest } from './elephantchess-pilot-manifest.js';
import { getPool } from './persistence-db.js';
import { assert, definePersistenceTests, sha256, test } from './persistence-test-support.js';
import {
  advanceXiangqiPuzzleMiningRunAfterAudit,
  checkpointXiangqiPuzzleMiningShard,
  claimNextXiangqiPuzzleMiningAuditCandidate,
  claimNextXiangqiPuzzleMiningShard,
  completeXiangqiPuzzleMiningShard,
  failXiangqiPuzzleMiningAuditCandidate,
  failXiangqiPuzzleMiningShard,
  getXiangqiPuzzleMiningCandidate,
  getXiangqiPuzzleMiningRun,
  heartbeatXiangqiPuzzleMiningShard,
  initializeXiangqiPuzzleMiningRun,
  listXiangqiPuzzleEditorialCandidates,
  recordXiangqiPuzzleEditorialReview,
  recordXiangqiPuzzleMiningCandidate,
  recordXiangqiPuzzleMiningJudgment,
  XIANGQI_PUZZLE_MINING_RUN_QUERY,
  type XiangqiPuzzleMiningCandidate,
} from './persistence-xiangqi-puzzle-mining.js';
import { processNextXiangqiPuzzleAuditCandidate } from './xiangqi-puzzle-audit-worker.js';
import { processNextXiangqiPuzzleMiningShard } from './xiangqi-puzzle-mining-worker.js';
import {
  planXiangqiPuzzlePublication,
  publishXiangqiPuzzlePublication,
} from './xiangqi-puzzle-publication.js';

const SOURCE_ID = 'source-elephant-pilot-test';
const BATCH_ID = 'batch-elephant-pilot-test';

function pilotGame(index: number, correspondence = false): ElephantChessPilotGame {
  return {
    historicalGameId: `pilot-historical-${index}`,
    sourceGameId: `pilot-source-${index}`,
    importBatchId: BATCH_ID,
    plyCount: 30 + index,
    result: index % 2 === 0 ? '1-0' : '0-1',
    redEloBefore: index < 4 ? 1_000 : 980 + index * 3,
    blackEloBefore: index < 4 ? 1_000 : 990 + index * 4,
    timeControlCategory: correspondence ? 'CORRESPONDENCE' : index % 2 ? 'RAPID' : 'BLITZ',
    ratingMode: index % 3 ? 'rated' : 'casual',
    redPlayerId: `pilot-red-${index % 5}`,
    blackPlayerId: `pilot-black-${index % 6}`,
  };
}

async function seedEligibleGames(games: readonly ElephantChessPilotGame[]): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO historical_xiangqi_sources
       (id, slug, name, source_type, license, license_status)
     VALUES ($1, 'elephantchess-pvp', 'ElephantChess', 'platform-export', 'GPL-3.0', 'cleared')`,
    [SOURCE_ID],
  );
  await pool.query(
    `INSERT INTO historical_xiangqi_import_batches
       (id, source_id, status, input_sha256, finished_at)
     VALUES ($1, $2, 'completed', $3, now())`,
    [BATCH_ID, SOURCE_ID, 'a'.repeat(64)],
  );
  for (const game of games) {
    await pool.query(
      `INSERT INTO historical_xiangqi_games
         (id, source_id, import_batch_id, source_game_id, content_sha256,
          result, ply_count, move_format, moves, tags, quality_flags, visibility)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'uci-0indexed', '[]'::jsonb,
               '{}'::jsonb, '{}'::text[], 'unlisted')`,
      [
        game.historicalGameId,
        SOURCE_ID,
        BATCH_ID,
        game.sourceGameId,
        sha256(game.historicalGameId),
        game.result,
        game.plyCount,
      ],
    );
  }
}

function publishablePuzzle(id: string, gameId: string, ply: number): XiangqiPuzzle {
  return {
    id,
    variant: XIANGQI_SPEC_ID,
    title: 'Red mate in 1',
    initial: {
      id,
      board: {
        d1: { color: 'red', role: 'general' },
        a9: { color: 'red', role: 'chariot' },
        h8: { color: 'red', role: 'chariot' },
        e10: { color: 'black', role: 'general' },
      },
      status: { type: 'playing', turn: 'red' },
      moveNumber: 1,
      progressClock: 0,
      positionCounts: {},
    },
    solution: [{ from: 'h8', to: 'h10' }],
    goal: { type: 'checkmate', winner: 'red' },
    themes: ['checkmate', 'matein1', 'endgame'],
    sourceGame: { gameId, ply },
  };
}

definePersistenceTests('xiangqi puzzle mining', () => {
  test('run initialization is idempotent and shard claims resume with fencing', async () => {
    const games = [
      ...Array.from({ length: 12 }, (_, index) => pilotGame(index)),
      ...Array.from({ length: 4 }, (_, index) => pilotGame(12 + index, true)),
    ];
    await seedEligibleGames(games);
    const manifest = buildElephantChessPilotManifest(games, {
      importBatchId: BATCH_ID,
      seed: 'persistence-pilot-v1',
      targets: { representativeLiveBase: 4, coverageLive: 2, correspondenceMax: 2 },
    });

    const first = await initializeXiangqiPuzzleMiningRun({
      manifest,
      serializedSha256: 'b'.repeat(64),
      shardSize: 3,
      engineProfile: { engine: 'pikafish-test' },
    });
    const second = await initializeXiangqiPuzzleMiningRun({
      manifest,
      serializedSha256: 'b'.repeat(64),
      shardSize: 3,
      engineProfile: { engine: 'pikafish-test' },
    });
    assert.deepEqual(second, first);
    assert.equal(first.selectedGames, 8);
    assert.equal(first.shards, 3);
    assert.match(first.executionSha256 ?? '', /^[0-9a-f]{64}$/);

    const counts = await getPool().query<{ games: number; shards: number }>(
      `SELECT
         (SELECT count(*)::int FROM xiangqi_puzzle_mining_games WHERE run_id = $1) AS games,
         (SELECT count(*)::int FROM xiangqi_puzzle_mining_shards WHERE run_id = $1) AS shards`,
      [first.id],
    );
    assert.deepEqual(counts.rows, [{ games: 8, shards: 3 }]);
    const differentlySharded = await initializeXiangqiPuzzleMiningRun({
      manifest,
      serializedSha256: 'b'.repeat(64),
      shardSize: 4,
      engineProfile: { engine: 'pikafish-test' },
    });
    const differentEngine = await initializeXiangqiPuzzleMiningRun({
      manifest,
      serializedSha256: 'b'.repeat(64),
      shardSize: 3,
      engineProfile: { engine: 'different-engine' },
    });
    assert.notEqual(differentlySharded.id, first.id);
    assert.notEqual(differentEngine.id, first.id);
    assert.notEqual(differentEngine.executionSha256, first.executionSha256);
    assert.equal(differentlySharded.manifestSha256, first.manifestSha256);
    assert.equal(differentEngine.manifestSha256, first.manifestSha256);

    const reorderedProfile = await initializeXiangqiPuzzleMiningRun({
      manifest,
      serializedSha256: 'b'.repeat(64),
      shardSize: 3,
      engineProfile: { nested: { second: 2, first: 1 }, engine: 'stable-order' },
    });
    const sameReorderedProfile = await initializeXiangqiPuzzleMiningRun({
      manifest,
      serializedSha256: 'b'.repeat(64),
      shardSize: 3,
      engineProfile: { engine: 'stable-order', nested: { first: 1, second: 2 } },
    });
    assert.equal(sameReorderedProfile.id, reorderedProfile.id);

    const claimed = await claimNextXiangqiPuzzleMiningShard({
      runId: first.id,
      workerId: 'worker-a',
      claimToken: 'claim-a',
      leaseMs: 60_000,
    });
    assert.equal(claimed?.shardIndex, 0);
    assert.equal(claimed?.nextSelectionIndex, 0);
    assert.equal(claimed?.attemptCount, 1);

    const checkpoint = await checkpointXiangqiPuzzleMiningShard({
      runId: first.id,
      shardIndex: 0,
      claimToken: 'claim-a',
      nextSelectionIndex: 2,
    });
    assert.equal(checkpoint.nextSelectionIndex, 2);
    await assert.rejects(
      checkpointXiangqiPuzzleMiningShard({
        runId: first.id,
        shardIndex: 0,
        claimToken: 'claim-a',
        nextSelectionIndex: 1,
      }),
      /is not claimed/,
    );

    const heartbeat = await heartbeatXiangqiPuzzleMiningShard({
      runId: first.id,
      shardIndex: 0,
      claimToken: 'claim-a',
      leaseMs: 120_000,
    });
    assert.ok((heartbeat.leaseExpiresAt?.getTime() ?? 0) > Date.now());

    const failed = await failXiangqiPuzzleMiningShard({
      runId: first.id,
      shardIndex: 0,
      claimToken: 'claim-a',
      failure: { code: 'test-interruption' },
    });
    assert.equal(failed.status, 'failed');
    assert.equal(failed.nextSelectionIndex, 2);

    const resumed = await claimNextXiangqiPuzzleMiningShard({
      runId: first.id,
      workerId: 'worker-b',
      claimToken: 'claim-b',
      leaseMs: 60_000,
    });
    assert.equal(resumed?.shardIndex, 0);
    assert.equal(resumed?.nextSelectionIndex, 2);
    assert.equal(resumed?.attemptCount, 2);
    await assert.rejects(
      checkpointXiangqiPuzzleMiningShard({
        runId: first.id,
        shardIndex: 0,
        claimToken: 'claim-a',
        nextSelectionIndex: 3,
      }),
      /is not claimed/,
    );
    await assert.rejects(
      completeXiangqiPuzzleMiningShard({
        runId: first.id,
        shardIndex: 0,
        claimToken: 'claim-b',
      }),
      /is not claimed/,
    );
    await checkpointXiangqiPuzzleMiningShard({
      runId: first.id,
      shardIndex: 0,
      claimToken: 'claim-b',
      nextSelectionIndex: 3,
    });
    const completed = await completeXiangqiPuzzleMiningShard({
      runId: first.id,
      shardIndex: 0,
      claimToken: 'claim-b',
    });
    assert.equal(completed.status, 'completed');
    assert.equal(completed.nextSelectionIndex, 3);

    const next = await claimNextXiangqiPuzzleMiningShard({
      runId: first.id,
      workerId: 'worker-c',
      claimToken: 'claim-c',
      leaseMs: 60_000,
    });
    assert.equal(next?.shardIndex, 1);
    await getPool().query(
      `UPDATE xiangqi_puzzle_mining_shards
       SET lease_expires_at = now() - interval '1 second'
       WHERE run_id = $1 AND shard_index = 1`,
      [first.id],
    );
    await assert.rejects(
      heartbeatXiangqiPuzzleMiningShard({
        runId: first.id,
        shardIndex: 1,
        claimToken: 'claim-c',
      }),
      /is not claimed/,
    );
    const reclaimed = await claimNextXiangqiPuzzleMiningShard({
      runId: first.id,
      workerId: 'worker-d',
      claimToken: 'claim-d',
      leaseMs: 60_000,
    });
    assert.equal(reclaimed?.shardIndex, 1);
    assert.equal(reclaimed?.attemptCount, 2);
    await assert.rejects(
      heartbeatXiangqiPuzzleMiningShard({
        runId: first.id,
        shardIndex: 1,
        claimToken: 'claim-c',
      }),
      /is not claimed/,
    );
  });

  test('candidate evidence is idempotent and judgments enforce the review sequence', async () => {
    const games = [
      ...Array.from({ length: 12 }, (_, index) => pilotGame(index)),
      ...Array.from({ length: 4 }, (_, index) => pilotGame(12 + index, true)),
    ];
    await seedEligibleGames(games);
    const manifest = buildElephantChessPilotManifest(games, {
      importBatchId: BATCH_ID,
      seed: 'candidate-pilot-v1',
      targets: { representativeLiveBase: 4, coverageLive: 2, correspondenceMax: 2 },
    });
    const run = await initializeXiangqiPuzzleMiningRun({ manifest, shardSize: 3 });
    const historicalGameId = manifest.games[0]?.historicalGameId as string;
    const candidateInput = {
      runId: run.id,
      historicalGameId,
      postBlunderPly: 17,
      positionKey: 'xiangqi-position-key-1',
      trigger: 'eval-swing',
      scanEvidence: { beforeCp: 420, afterCp: 80, scanNodes: 60_000 },
      artifactSha256: 'c'.repeat(64),
    };
    const candidate = await recordXiangqiPuzzleMiningCandidate(candidateInput);
    assert.deepEqual(await recordXiangqiPuzzleMiningCandidate(candidateInput), candidate);
    assert.equal(candidate.status, 'scanned');
    await assert.rejects(
      recordXiangqiPuzzleMiningCandidate({
        ...candidateInput,
        scanEvidence: { beforeCp: 421, afterCp: 80, scanNodes: 60_000 },
      }),
      /different scan evidence/,
    );

    const engineProfile = { engine: 'pikafish-test', binarySha256: 'd'.repeat(64) };
    await assert.rejects(
      recordXiangqiPuzzleMiningJudgment({
        candidateId: candidate.id,
        stage: 'audit',
        profileVersion: 'audit-v1',
        verdict: 'pass',
        engineProfile,
        evidence: { depth: 22 },
        claimToken: 'not-a-real-claim',
      }),
      /cannot transition/,
    );
    const verification = await recordXiangqiPuzzleMiningJudgment({
      candidateId: candidate.id,
      stage: 'verify',
      profileVersion: 'verify-v1',
      verdict: 'pass',
      engineProfile,
      evidence: { depth: 20, bestCp: 510, secondCp: 120 },
      puzzleData: { initialFen: 'test-fen', solution: ['a0a1'] },
    });
    assert.equal(verification.stage, 'verify');
    assert.equal(
      (await getXiangqiPuzzleMiningCandidate(getPool(), candidate.id)).status,
      'verified',
    );
    assert.deepEqual((await getXiangqiPuzzleMiningCandidate(getPool(), candidate.id)).puzzleData, {
      initialFen: 'test-fen',
      solution: ['a0a1'],
    });
    assert.deepEqual(
      await recordXiangqiPuzzleMiningJudgment({
        candidateId: candidate.id,
        stage: 'verify',
        profileVersion: 'verify-v1',
        verdict: 'pass',
        engineProfile,
        evidence: { depth: 20, bestCp: 510, secondCp: 120 },
        puzzleData: { initialFen: 'test-fen', solution: ['a0a1'] },
      }),
      verification,
    );
    await assert.rejects(
      recordXiangqiPuzzleMiningJudgment({
        candidateId: candidate.id,
        stage: 'verify',
        profileVersion: 'verify-v1',
        verdict: 'pass',
        engineProfile,
        evidence: { depth: 20, bestCp: 511, secondCp: 120 },
        puzzleData: { initialFen: 'test-fen', solution: ['a0a1'] },
      }),
      /different evidence/,
    );
    await getPool().query(
      `UPDATE xiangqi_puzzle_mining_runs SET status = 'verifying' WHERE id = $1`,
      [run.id],
    );
    const auditClaim = await claimNextXiangqiPuzzleMiningAuditCandidate({
      runId: run.id,
      workerId: 'audit-worker-pass',
      claimToken: 'audit-claim-pass',
    });
    assert.equal(auditClaim?.candidate.id, candidate.id);
    await recordXiangqiPuzzleMiningJudgment({
      candidateId: candidate.id,
      stage: 'audit',
      profileVersion: 'audit-v1',
      verdict: 'pass',
      engineProfile,
      evidence: { depth: 22, stable: true },
      claimToken: 'audit-claim-pass',
    });
    assert.equal((await getXiangqiPuzzleMiningCandidate(getPool(), candidate.id)).status, 'review');

    const needsWork = await recordXiangqiPuzzleEditorialReview({
      candidateId: candidate.id,
      verdict: 'needs-work',
      reason: 'unclear',
      notes: 'Improve the prompt.',
    });
    assert.equal(needsWork.verdict, 'needs-work');
    assert.equal((await getXiangqiPuzzleMiningCandidate(getPool(), candidate.id)).status, 'review');
    await recordXiangqiPuzzleEditorialReview({
      candidateId: candidate.id,
      verdict: 'approve',
      reason: 'publishable',
    });
    assert.equal(
      (await getXiangqiPuzzleMiningCandidate(getPool(), candidate.id)).status,
      'approved',
    );
    assert.deepEqual(
      await recordXiangqiPuzzleMiningJudgment({
        candidateId: candidate.id,
        stage: 'verify',
        profileVersion: 'verify-v1',
        verdict: 'pass',
        engineProfile,
        evidence: { depth: 20, bestCp: 510, secondCp: 120 },
        puzzleData: { initialFen: 'test-fen', solution: ['a0a1'] },
      }),
      verification,
    );
    const editorialQueue = await listXiangqiPuzzleEditorialCandidates(getPool(), {
      runId: run.id,
    });
    assert.equal(editorialQueue.length, 1);
    assert.equal(editorialQueue[0]?.candidate.id, candidate.id);
    assert.equal(editorialQueue[0]?.selectionIndex, 0);
    assert.equal(editorialQueue[0]?.verifyJudgment?.verdict, 'pass');
    assert.equal(editorialQueue[0]?.auditJudgment?.verdict, 'pass');
    assert.equal(editorialQueue[0]?.latestReview?.verdict, 'approve');
    assert.equal(editorialQueue[0]?.positionDuplicateCount, 1);

    const rejectedCandidate = await recordXiangqiPuzzleMiningCandidate({
      ...candidateInput,
      historicalGameId: manifest.games[1]?.historicalGameId as string,
      postBlunderPly: 9,
      positionKey: 'xiangqi-position-key-2',
      artifactSha256: null,
    });
    await recordXiangqiPuzzleMiningJudgment({
      candidateId: rejectedCandidate.id,
      stage: 'verify',
      profileVersion: 'verify-v1',
      verdict: 'reject',
      reason: 'non-unique',
      engineProfile,
      evidence: { depth: 20, gapCp: 90 },
    });
    const rejected = await getXiangqiPuzzleMiningCandidate(getPool(), rejectedCandidate.id);
    assert.equal(rejected.status, 'rejected');
    assert.equal(rejected.rejectionReason, 'non-unique');

    const auditFailedCandidate = await recordXiangqiPuzzleMiningCandidate({
      ...candidateInput,
      historicalGameId: manifest.games[2]?.historicalGameId as string,
      postBlunderPly: 11,
      positionKey: 'xiangqi-position-key-3',
      artifactSha256: null,
    });
    await recordXiangqiPuzzleMiningJudgment({
      candidateId: auditFailedCandidate.id,
      stage: 'verify',
      profileVersion: 'verify-v1',
      verdict: 'pass',
      engineProfile,
      evidence: { depth: 20 },
    });
    const auditFailedClaim = await claimNextXiangqiPuzzleMiningAuditCandidate({
      runId: run.id,
      workerId: 'audit-worker-reject',
      claimToken: 'audit-claim-reject',
    });
    assert.equal(auditFailedClaim?.candidate.id, auditFailedCandidate.id);
    await recordXiangqiPuzzleMiningJudgment({
      candidateId: auditFailedCandidate.id,
      stage: 'audit',
      profileVersion: 'audit-v1',
      verdict: 'reject',
      reason: 'near-tie',
      engineProfile,
      evidence: { depth: 22, gapCp: 180 },
      claimToken: 'audit-claim-reject',
    });
    assert.equal(
      (await getXiangqiPuzzleMiningCandidate(getPool(), auditFailedCandidate.id)).status,
      'audit-failed',
    );
  });

  test('worker checkpoints whole games and resumes a failed shard without replaying progress', async () => {
    const games = [
      ...Array.from({ length: 12 }, (_, index) => pilotGame(index)),
      ...Array.from({ length: 4 }, (_, index) => pilotGame(12 + index, true)),
    ];
    await seedEligibleGames(games);
    const manifest = buildElephantChessPilotManifest(games, {
      importBatchId: BATCH_ID,
      seed: 'worker-pilot-v1',
      targets: { representativeLiveBase: 4, coverageLive: 2, correspondenceMax: 2 },
    });
    const run = await initializeXiangqiPuzzleMiningRun({ manifest, shardSize: 3 });
    const firstAttempt: number[] = [];
    await assert.rejects(
      processNextXiangqiPuzzleMiningShard({
        runId: run.id,
        workerId: 'worker-first',
        leaseMs: 5_000,
        processGame: async (game) => {
          firstAttempt.push(game.selectionIndex);
          if (game.selectionIndex === 1) throw new Error('synthetic interruption');
        },
      }),
      /synthetic interruption/,
    );
    assert.deepEqual(firstAttempt, [0, 1]);

    const resumed: number[] = [];
    const firstShard = await processNextXiangqiPuzzleMiningShard({
      runId: run.id,
      workerId: 'worker-resume',
      leaseMs: 5_000,
      processGame: async (game) => {
        resumed.push(game.selectionIndex);
      },
    });
    assert.deepEqual(resumed, [1, 2]);
    assert.equal(firstShard?.shard.status, 'completed');
    assert.equal(firstShard?.processedGames, 2);

    for (let index = 0; index < 2; index += 1) {
      await processNextXiangqiPuzzleMiningShard({
        runId: run.id,
        workerId: `worker-tail-${index}`,
        leaseMs: 5_000,
        processGame: async () => undefined,
      });
    }
    assert.equal((await getXiangqiPuzzleMiningRun(getPool(), run.id)).status, 'verifying');
    assert.equal(
      await processNextXiangqiPuzzleMiningShard({
        runId: run.id,
        workerId: 'worker-empty',
        leaseMs: 5_000,
        processGame: async () => undefined,
      }),
      null,
    );
  });

  test('audit worker retries interruptions and advances resolved candidates to review', async () => {
    const games = [
      ...Array.from({ length: 12 }, (_, index) => pilotGame(index)),
      ...Array.from({ length: 4 }, (_, index) => pilotGame(12 + index, true)),
    ];
    await seedEligibleGames(games);
    const manifest = buildElephantChessPilotManifest(games, {
      importBatchId: BATCH_ID,
      seed: 'audit-worker-pilot-v1',
      targets: { representativeLiveBase: 4, coverageLive: 2, correspondenceMax: 2 },
    });
    const run = await initializeXiangqiPuzzleMiningRun({ manifest, shardSize: 3 });
    const engineProfile = { engine: 'pikafish-audit-test' };
    const candidates: XiangqiPuzzleMiningCandidate[] = [];
    for (let index = 0; index < 2; index += 1) {
      const candidate = await recordXiangqiPuzzleMiningCandidate({
        runId: run.id,
        historicalGameId: manifest.games[index]?.historicalGameId as string,
        postBlunderPly: 20 + index,
        positionKey: `audit-position-${index}`,
        trigger: 'eval-swing',
        scanEvidence: { index },
      });
      await recordXiangqiPuzzleMiningJudgment({
        candidateId: candidate.id,
        stage: 'verify',
        profileVersion: 'verify-v1',
        verdict: 'pass',
        engineProfile,
        evidence: { depth: 20 },
        puzzleData: { id: `puzzle-${index}` },
      });
      candidates.push(candidate);
    }
    await getPool().query(
      `UPDATE xiangqi_puzzle_mining_runs SET status = 'verifying' WHERE id = $1`,
      [run.id],
    );

    await assert.rejects(
      processNextXiangqiPuzzleAuditCandidate({
        runId: run.id,
        workerId: 'audit-interrupted',
        profileVersion: 'audit-v1',
        engineProfile,
        leaseMs: 5_000,
        auditCandidate: async () => {
          throw new Error('synthetic audit interruption');
        },
      }),
      /synthetic audit interruption/,
    );
    assert.equal(
      (await getXiangqiPuzzleMiningCandidate(getPool(), candidates[0]!.id)).status,
      'verified',
    );

    const staleClaim = await claimNextXiangqiPuzzleMiningAuditCandidate({
      runId: run.id,
      workerId: 'audit-stale',
      claimToken: 'audit-stale-token',
      leaseMs: 5_000,
    });
    assert.equal(staleClaim?.candidate.id, candidates[0]!.id);
    await getPool().query(
      `UPDATE xiangqi_puzzle_mining_candidates
       SET audit_lease_expires_at = now() - interval '1 second'
       WHERE id = $1`,
      [candidates[0]!.id],
    );
    const reclaimed = await claimNextXiangqiPuzzleMiningAuditCandidate({
      runId: run.id,
      workerId: 'audit-fenced',
      claimToken: 'audit-fenced-token',
      leaseMs: 5_000,
    });
    assert.equal(reclaimed?.attemptCount, 3);
    await assert.rejects(
      recordXiangqiPuzzleMiningJudgment({
        candidateId: candidates[0]!.id,
        stage: 'audit',
        profileVersion: 'audit-v1',
        verdict: 'pass',
        engineProfile,
        evidence: { depth: 22 },
        claimToken: 'audit-stale-token',
      }),
      /cannot transition/,
    );
    await failXiangqiPuzzleMiningAuditCandidate({
      candidateId: candidates[0]!.id,
      claimToken: 'audit-fenced-token',
      failure: { code: 'release-test-claim' },
    });

    const passed = await processNextXiangqiPuzzleAuditCandidate({
      runId: run.id,
      workerId: 'audit-resumed',
      profileVersion: 'audit-v1',
      engineProfile,
      leaseMs: 5_000,
      auditCandidate: async () => ({ verdict: 'pass', evidence: { depth: 22 } }),
    });
    assert.equal(passed?.candidateId, candidates[0]!.id);
    assert.equal(
      (await getXiangqiPuzzleMiningCandidate(getPool(), candidates[0]!.id)).status,
      'review',
    );

    const rejected = await processNextXiangqiPuzzleAuditCandidate({
      runId: run.id,
      workerId: 'audit-reject',
      profileVersion: 'audit-v1',
      engineProfile,
      leaseMs: 5_000,
      auditCandidate: async () => ({
        verdict: 'reject',
        reason: 'engine-disagrees',
        evidence: { depth: 22 },
      }),
    });
    assert.equal(rejected?.candidateId, candidates[1]!.id);
    assert.equal(rejected?.runAdvancedToReview, true);
    assert.equal(
      (await getXiangqiPuzzleMiningCandidate(getPool(), candidates[1]!.id)).status,
      'audit-failed',
    );
    assert.equal((await getXiangqiPuzzleMiningRun(getPool(), run.id)).status, 'review');
  });

  test('publication atomically promotes every audited survivor and reruns without writes', async () => {
    const games = Array.from({ length: 8 }, (_, index) => pilotGame(index));
    await seedEligibleGames(games);
    const manifest = buildElephantChessPilotManifest(games, {
      importBatchId: BATCH_ID,
      seed: 'publication-pilot-v1',
      targets: { representativeLiveBase: 4, coverageLive: 2, correspondenceMax: 0 },
    });
    const run = await initializeXiangqiPuzzleMiningRun({ manifest, shardSize: 3 });
    const historicalGameId = manifest.games[0]?.historicalGameId as string;
    const postBlunderPly = 17;
    const candidate = await recordXiangqiPuzzleMiningCandidate({
      runId: run.id,
      historicalGameId,
      postBlunderPly,
      positionKey: 'xiangqi-publication-position-key',
      trigger: 'eval-swing',
      scanEvidence: { beforeCp: 420, afterCp: 80, scanNodes: 60_000 },
    });
    const puzzle = publishablePuzzle(
      `xq-mined-publication-${candidate.id}`,
      historicalGameId,
      postBlunderPly,
    );
    const engineProfile = { engine: 'pikafish-test', binarySha256: 'd'.repeat(64) };
    await recordXiangqiPuzzleMiningJudgment({
      candidateId: candidate.id,
      stage: 'verify',
      profileVersion: 'verify-v1',
      verdict: 'pass',
      engineProfile,
      evidence: { depth: 20, bestCp: 510, secondCp: 120 },
      puzzleData: puzzle,
    });
    await getPool().query(
      `UPDATE xiangqi_puzzle_mining_runs SET status = 'verifying' WHERE id = $1`,
      [run.id],
    );
    const auditClaim = await claimNextXiangqiPuzzleMiningAuditCandidate({
      runId: run.id,
      workerId: 'publication-audit-worker',
      claimToken: 'publication-audit-claim',
    });
    assert.equal(auditClaim?.candidate.id, candidate.id);
    await recordXiangqiPuzzleMiningJudgment({
      candidateId: candidate.id,
      stage: 'audit',
      profileVersion: 'audit-v1',
      verdict: 'pass',
      engineProfile,
      evidence: { depth: 22, stable: true },
      claimToken: 'publication-audit-claim',
    });
    await getPool().query(`UPDATE xiangqi_puzzle_mining_runs SET status = 'review' WHERE id = $1`, [
      run.id,
    ]);

    const before = await planXiangqiPuzzlePublication(getPool(), run.id);
    assert.equal(before.totalCandidates, 1);
    assert.equal(before.eligibleCandidates, 1);
    assert.equal(before.alreadyPublished, 0);
    assert.equal(before.sourceLicenseStatus, 'cleared');
    assert.match(before.publicationSha256, /^[0-9a-f]{64}$/);

    await assert.rejects(
      publishXiangqiPuzzlePublication({
        runId: run.id,
        expectedTotal: 1,
        expectedPublicationSha256: '0'.repeat(64),
        operatorNote: 'A stale plan must never publish.',
      }),
      /publication sha changed/,
    );
    assert.equal(
      (
        await getPool().query<{ count: number }>(
          `SELECT count(*)::int AS count FROM puzzles WHERE mining_candidate_id = $1`,
          [candidate.id],
        )
      ).rows[0]?.count,
      0,
    );
    assert.equal((await getXiangqiPuzzleMiningCandidate(getPool(), candidate.id)).status, 'review');

    const published = await publishXiangqiPuzzlePublication({
      runId: run.id,
      expectedTotal: 1,
      expectedPublicationSha256: before.publicationSha256,
      operatorNote: 'Operator authorized publication of every audited survivor.',
    });
    assert.equal(published.publishedNow, 1);
    assert.equal(published.alreadyPublished, 0);
    assert.equal(published.totalPublished, 1);
    assert.equal(published.firstSequence, before.nextSequence);
    assert.equal(published.lastSequence, before.nextSequence);

    const persisted = await getPool().query<{
      id: string;
      seq: number;
      source_kind: string;
      mining_candidate_id: string;
      data: XiangqiPuzzle;
    }>(
      `SELECT id, seq, source_kind, mining_candidate_id, data
       FROM puzzles WHERE mining_candidate_id = $1`,
      [candidate.id],
    );
    assert.equal(persisted.rows[0]?.id, puzzle.id);
    assert.equal(persisted.rows[0]?.seq, before.nextSequence);
    assert.equal(persisted.rows[0]?.source_kind, 'mined');
    assert.equal(persisted.rows[0]?.mining_candidate_id, candidate.id);
    assert.deepEqual(persisted.rows[0]?.data, puzzle);
    assert.equal(
      (await getXiangqiPuzzleMiningCandidate(getPool(), candidate.id)).status,
      'published',
    );
    assert.equal((await getXiangqiPuzzleMiningRun(getPool(), run.id)).status, 'completed');
    const reviews = await getPool().query<{
      verdict: string;
      reason: string;
      notes: string;
    }>(
      `SELECT verdict, reason, notes
       FROM xiangqi_puzzle_editorial_reviews WHERE candidate_id = $1`,
      [candidate.id],
    );
    assert.deepEqual(reviews.rows, [
      {
        verdict: 'approve',
        reason: 'publishable',
        notes: 'Operator authorized publication of every audited survivor.',
      },
    ]);

    const after = await planXiangqiPuzzlePublication(getPool(), run.id);
    assert.equal(after.totalCandidates, 1);
    assert.equal(after.eligibleCandidates, 0);
    assert.equal(after.alreadyPublished, 1);
    assert.equal(after.publicationSha256, before.publicationSha256);
    const rerun = await publishXiangqiPuzzlePublication({
      runId: run.id,
      expectedTotal: 1,
      expectedPublicationSha256: after.publicationSha256,
      operatorNote: 'This note is unused because publication is already complete.',
    });
    assert.equal(rerun.publishedNow, 0);
    assert.equal(rerun.alreadyPublished, 1);
    assert.equal(rerun.totalPublished, 1);
    assert.equal(rerun.firstSequence, null);
    assert.equal(rerun.lastSequence, null);
    assert.equal(
      (
        await getPool().query<{ count: number }>(
          `SELECT count(*)::int AS count
           FROM xiangqi_puzzle_editorial_reviews WHERE candidate_id = $1`,
          [candidate.id],
        )
      ).rows[0]?.count,
      1,
    );
  });

  test('publication refuses a position an earlier run already published', async () => {
    const games = Array.from({ length: 16 }, (_, index) => pilotGame(100 + index));
    await seedEligibleGames(games);
    const engineProfile = { engine: 'pikafish-test', binarySha256: 'e'.repeat(64) };
    // The first run stored its key in the spelling used before 2026-10 (role
    // initials, chariot and cannon both `c`); the second uses the current one.
    // They name the same position, so the guard must still match them.
    const currentKey = positionRepetitionKey(createInitialXiangqiState('crossrun'));
    const legacyKey = legacyPositionRepetitionKey(currentKey);
    assert.notEqual(legacyKey, currentKey);

    const publishOneCandidate = async (
      seed: string,
      gameOffset: number,
      positionKey: string,
    ): Promise<string> => {
      const manifest = buildElephantChessPilotManifest(games.slice(gameOffset, gameOffset + 8), {
        importBatchId: BATCH_ID,
        seed,
        targets: { representativeLiveBase: 4, coverageLive: 2, correspondenceMax: 0 },
      });
      const run = await initializeXiangqiPuzzleMiningRun({ manifest, shardSize: 3 });
      const historicalGameId = manifest.games[0]?.historicalGameId as string;
      const postBlunderPly = 21;
      const candidate = await recordXiangqiPuzzleMiningCandidate({
        runId: run.id,
        historicalGameId,
        postBlunderPly,
        positionKey,
        trigger: 'eval-swing',
        scanEvidence: { beforeCp: 400, afterCp: 60, scanNodes: 60_000 },
      });
      await recordXiangqiPuzzleMiningJudgment({
        candidateId: candidate.id,
        stage: 'verify',
        profileVersion: 'verify-v1',
        verdict: 'pass',
        engineProfile,
        evidence: { depth: 20, bestCp: 520, secondCp: 110 },
        puzzleData: publishablePuzzle(
          `xq-mined-crossrun-${candidate.id}`,
          historicalGameId,
          postBlunderPly,
        ),
      });
      await getPool().query(
        `UPDATE xiangqi_puzzle_mining_runs SET status = 'verifying' WHERE id = $1`,
        [run.id],
      );
      const claim = await claimNextXiangqiPuzzleMiningAuditCandidate({
        runId: run.id,
        workerId: `crossrun-audit-${seed}`,
        claimToken: `crossrun-claim-${seed}`,
      });
      assert.equal(claim?.candidate.id, candidate.id);
      await recordXiangqiPuzzleMiningJudgment({
        candidateId: candidate.id,
        stage: 'audit',
        profileVersion: 'audit-v1',
        verdict: 'pass',
        engineProfile,
        evidence: { depth: 22, stable: true },
        claimToken: `crossrun-claim-${seed}`,
      });
      await getPool().query(
        `UPDATE xiangqi_puzzle_mining_runs SET status = 'review' WHERE id = $1`,
        [run.id],
      );
      return run.id;
    };

    const firstRunId = await publishOneCandidate('crossrun-first-v1', 0, legacyKey);
    const firstPlan = await planXiangqiPuzzlePublication(getPool(), firstRunId);
    assert.equal(firstPlan.eligibleCandidates, 1);
    const firstPublished = await publishXiangqiPuzzlePublication({
      runId: firstRunId,
      expectedTotal: 1,
      expectedPublicationSha256: firstPlan.publicationSha256,
      operatorNote: 'First run publishes the position.',
    });
    assert.equal(firstPublished.publishedNow, 1);

    // Same position, different source game, different run. Run-scoped
    // positionDuplicateCount cannot see the first run, so only the cross-run
    // guard stops this.
    const secondRunId = await publishOneCandidate('crossrun-second-v1', 8, currentKey);
    await assert.rejects(
      planXiangqiPuzzlePublication(getPool(), secondRunId),
      /repeats a position already published as puzzle/,
    );
  });

  test('the run loader never multiplies games by shards', async () => {
    // A correctness assertion cannot catch this. The original loader joined a
    // run to BOTH its games and its shards and de-duplicated with
    // count(DISTINCT ...), so the counts were always right while the row set
    // underneath was games x shards. At pilot scale that was 40k rows and
    // invisible; at 9,469 games it was 3.6M and filled the production disk.
    // So assert the PLAN: no node may see more rows than the larger child.
    const games = Array.from({ length: 12 }, (_, index) => pilotGame(300 + index));
    await seedEligibleGames(games);
    const manifest = buildElephantChessPilotManifest(games, {
      importBatchId: BATCH_ID,
      seed: 'fanout-guard-v1',
      targets: { representativeLiveBase: 8, coverageLive: 4, correspondenceMax: 0 },
    });
    const run = await initializeXiangqiPuzzleMiningRun({ manifest, shardSize: 3 });

    const loaded = await getXiangqiPuzzleMiningRun(getPool(), run.id);
    assert.equal(loaded.selectedGames, 12);
    assert.equal(loaded.shards, 4);

    const explained = await getPool().query<{ 'QUERY PLAN': unknown }>(
      `EXPLAIN (ANALYZE, FORMAT JSON) ${XIANGQI_PUZZLE_MINING_RUN_QUERY}`,
      [run.id],
    );
    const explainRoot = explained.rows[0]?.['QUERY PLAN'] as
      | [{ Plan: Record<string, unknown> }]
      | undefined;
    const plan = explainRoot?.[0]?.Plan;
    assert.ok(plan, 'EXPLAIN returned no plan');
    const rowCounts: number[] = [];
    const walk = (node: Record<string, unknown>): void => {
      const actual = node['Actual Rows'];
      const loops = node['Actual Loops'];
      if (typeof actual === 'number' && typeof loops === 'number') {
        rowCounts.push(actual * loops);
      }
      for (const child of (node.Plans as Record<string, unknown>[]) ?? []) walk(child);
    };
    walk(plan);

    // 12 games and 4 shards: a fan-out plan would surface a 48-row node.
    const widest = Math.max(...rowCounts);
    assert.ok(
      widest <= 12,
      `run loader plan touched ${widest} rows for 12 games and 4 shards; it is multiplying children`,
    );
  });

  test('a candidate that always fails audit parks instead of blocking the run', async () => {
    const games = Array.from({ length: 8 }, (_, index) => pilotGame(500 + index));
    await seedEligibleGames(games);
    const manifest = buildElephantChessPilotManifest(games, {
      importBatchId: BATCH_ID,
      seed: 'poison-pill-v1',
      targets: { representativeLiveBase: 4, coverageLive: 2, correspondenceMax: 0 },
    });
    const run = await initializeXiangqiPuzzleMiningRun({ manifest, shardSize: 3 });
    const historicalGameId = manifest.games[0]?.historicalGameId as string;
    const candidate = await recordXiangqiPuzzleMiningCandidate({
      runId: run.id,
      historicalGameId,
      postBlunderPly: 22,
      positionKey: 'xiangqi-poison-pill-position',
      trigger: 'eval-swing',
      scanEvidence: { beforeCp: 400, afterCp: 40, scanNodes: 60_000 },
    });
    await recordXiangqiPuzzleMiningJudgment({
      candidateId: candidate.id,
      stage: 'verify',
      profileVersion: 'verify-v1',
      verdict: 'pass',
      engineProfile: { engine: 'pikafish-test', binarySha256: 'f'.repeat(64) },
      evidence: { depth: 20 },
      puzzleData: publishablePuzzle(`xq-mined-poison-${candidate.id}`, historicalGameId, 22),
    });
    await getPool().query(
      `UPDATE xiangqi_puzzle_mining_runs SET status = 'verifying' WHERE id = $1`,
      [run.id],
    );

    // Five claim/fail cycles, as a deterministic engine timeout would produce.
    const outcomes: { parked: boolean; attempts: number }[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const claim = await claimNextXiangqiPuzzleMiningAuditCandidate({
        runId: run.id,
        workerId: `poison-worker-${attempt}`,
        claimToken: `poison-claim-${attempt}`,
      });
      assert.equal(
        claim?.candidate.id,
        candidate.id,
        `attempt ${attempt} should still be claimable`,
      );
      outcomes.push(
        await failXiangqiPuzzleMiningAuditCandidate({
          candidateId: candidate.id,
          claimToken: `poison-claim-${attempt}`,
          failure: { code: 'audit-processing-failed', message: 'pikafish request timed out' },
        }),
      );
    }

    // The first four release it for another try; the fifth parks it.
    assert.deepEqual(
      outcomes.map((outcome) => outcome.parked),
      [false, false, false, false, true],
    );
    assert.equal(
      (await getXiangqiPuzzleMiningCandidate(getPool(), candidate.id)).status,
      'audit-failed',
    );

    // Parked, not verified: the run is free to advance and nothing can claim it.
    assert.equal(await advanceXiangqiPuzzleMiningRunAfterAudit(run.id), true);
    assert.equal((await getXiangqiPuzzleMiningRun(getPool(), run.id)).status, 'review');
    assert.equal(
      await claimNextXiangqiPuzzleMiningAuditCandidate({
        runId: run.id,
        workerId: 'poison-worker-after',
        claimToken: 'poison-claim-after',
      }),
      null,
    );
  });
});
