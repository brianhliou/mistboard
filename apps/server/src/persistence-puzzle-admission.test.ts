import { readFile } from 'node:fs/promises';
import { assert, pg, TEST_DATABASE_URL, test } from './persistence-test-support.js';

test('persistence mate-speed migration backfills audit facts without changing serving data', {
  skip: !TEST_DATABASE_URL,
}, async () => {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    // Shadow the real tables so the migration can be tested on a pre-176 schema
    // even after the test database has already applied it.
    await client.query(`CREATE TEMP TABLE puzzles (
      id text PRIMARY KEY, variant text DEFAULT 'xiangqi', goal_type text DEFAULT 'checkmate',
      seq int DEFAULT 0, mining_candidate_id text, hidden_reason text, data json
    ) ON COMMIT DROP`);
    await client.query(`CREATE TEMP TABLE xiangqi_puzzle_mining_judgments (
      id bigint, candidate_id text, stage text, verdict text, created_at timestamptz, evidence jsonb
    ) ON COMMIT DROP`);
    const fixtures = [
      {
        id: 'later-ply',
        plies: [
          { bestMate: 5, secondMate: null },
          { bestMate: 3, secondMate: 5 },
        ],
        expected: true,
      },
      { id: 'immediate', plies: [{ bestMate: 1, secondMate: 1 }], expected: false },
      { id: 'losing-alternative', plies: [{ bestMate: 3, secondMate: -5 }], expected: false },
      { id: 'unique-mate', plies: [{ bestMate: 3, secondMate: null }], expected: false },
      { id: 'missing-scores', plies: [{ bestCp: 29997, secondCp: 29995 }], expected: null },
      { id: 'empty', plies: [], expected: null },
      { id: 'missing-plies', expected: null },
      { id: 'no-audit', expected: null },
      { id: 'latest-pass', plies: [{ bestMate: 3, secondMate: null }], expected: false },
      { id: 'material', plies: [{ bestMate: 3, secondMate: 5 }], expected: null },
    ];
    let judgmentId = 1;
    for (const fixture of fixtures) {
      await client.query(
        `INSERT INTO puzzles (id, mining_candidate_id, goal_type, hidden_reason, data)
        VALUES ($1, $1, $2, $3, $4::json)`,
        [
          fixture.id,
          fixture.id === 'material' ? 'win-material' : 'checkmate',
          fixture.id === 'later-ply' ? 'existing-withheld-reason' : null,
          JSON.stringify({ id: fixture.id }),
        ],
      );
      if (fixture.id === 'no-audit') continue;
      await client.query(
        `INSERT INTO xiangqi_puzzle_mining_judgments
        VALUES ($1, $2, 'audit', 'pass', '2026-10-23', $3::jsonb)`,
        [judgmentId++, fixture.id, JSON.stringify({ plies: fixture.plies })],
      );
    }
    // Neither verify evidence, a failed audit, nor an older passing profile
    // may replace the latest passing audit. IDs deliberately disagree with time.
    await client.query(`INSERT INTO xiangqi_puzzle_mining_judgments
      (id, candidate_id, stage, verdict, created_at, evidence) VALUES
      (100, 'latest-pass', 'audit', 'pass', '2026-10-22', '{"plies":[{"bestMate":3,"secondMate":5}]}'),
      (101, 'latest-pass', 'audit', 'reject', '2026-10-24', '{"plies":[{"bestMate":3,"secondMate":5}]}'),
      (102, 'no-audit', 'verify', 'pass', '2026-10-24', '{"plies":[{"bestMate":3,"secondMate":5}]}')`);
    const before = (await client.query('SELECT id, hidden_reason, data FROM puzzles ORDER BY id'))
      .rows;
    const migration = await readFile(
      new URL('../migrations/176_puzzles_mate_speed_only.sql', import.meta.url),
      'utf8',
    );
    await client.query(migration);
    const { rows } = await client.query<{ id: string; mate_speed_only: boolean | null }>(
      'SELECT id, mate_speed_only FROM puzzles ORDER BY id',
    );
    for (const fixture of fixtures) {
      assert.equal(
        rows.find((row) => row.id === fixture.id)?.mate_speed_only,
        fixture.expected,
        fixture.id,
      );
    }
    assert.deepEqual(
      (await client.query('SELECT id, hidden_reason, data FROM puzzles ORDER BY id')).rows,
      before,
    );
    assert.deepEqual(
      (await client.query('SELECT id FROM puzzles WHERE mate_speed_only IS TRUE')).rows,
      [{ id: 'later-ply' }],
    );
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
});
