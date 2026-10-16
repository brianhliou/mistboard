import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getPool } from './persistence-db.js';
import { insertFeedbackSubmission } from './persistence-feedback.js';
import { generateMistboardReadout } from './persistence-mistboard-readout.js';
import {
  assert,
  definePersistenceTests,
  TEST_DATABASE_URL,
  test,
} from './persistence-test-support.js';

// The inbox is a repo-root script (scripts/feedback-inbox.mjs), so the test
// runs it the way a session does: a child process with DATABASE_URL pointed
// at the test database. Compiled to apps/server/dist.
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

function runScript(script: string, args: string[]) {
  const result = spawnSync(process.execPath, [`scripts/${script}`, ...args], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const OLDER = '11111111-1111-4111-8111-111111111111';
const NEWER = '0717761d-6536-4b09-b0df-83edc90621d9';

async function seed(): Promise<void> {
  await insertFeedbackSubmission({
    id: OLDER,
    message: 'Love the jieqi bot.',
    email: null,
    path: '/play',
    userId: null,
    userAgent: 'test',
    ipHash: 'a'.repeat(64),
  });
  await insertFeedbackSubmission({
    id: NEWER,
    message: 'The board flips when I open the game.',
    email: 'jane.doe@protonmail.com',
    path: '/zh-hans/blog/cao-yanlei',
    userId: null,
    userAgent: 'test',
    ipHash: 'b'.repeat(64),
  });
  await getPool().query(`UPDATE feedback_submissions SET created_at = $2 WHERE id = $1`, [
    OLDER,
    '2026-09-20T10:00:00Z',
  ]);
  await getPool().query(`UPDATE feedback_submissions SET created_at = $2 WHERE id = $1`, [
    NEWER,
    '2026-10-06T03:00:00Z',
  ]);
}

definePersistenceTests('feedback inbox', () => {
  test('the inbox lists submissions newest first with the address masked', async () => {
    await seed();
    const listed = runScript('feedback-inbox.mjs', ['--json']);
    assert.equal(listed.status, 0, listed.stderr);
    const rows = JSON.parse(listed.stdout) as Array<Record<string, unknown>>;
    assert.deepEqual(
      rows.map((row) => row.id),
      [NEWER, OLDER],
    );
    assert.equal(rows[0]!.path, '/zh-hans/blog/cao-yanlei');
    assert.equal(rows[0]!.email, 'j***@protonmail.com');
    assert.equal(rows[1]!.emailLeft, false);
    assert.doesNotMatch(listed.stdout, /jane\.doe/);

    const shown = JSON.parse(runScript('feedback-inbox.mjs', ['--json', '--show-email']).stdout);
    assert.equal(shown[0].email, 'jane.doe@protonmail.com');

    const since = JSON.parse(
      runScript('feedback-inbox.mjs', ['--json', '--since', '2026-10-01']).stdout,
    );
    assert.deepEqual(
      since.map((row: { id: string }) => row.id),
      [NEWER],
    );
    const text = runScript('feedback-inbox.mjs', ['--limit', '1']);
    assert.match(text.stdout, /1 feedback submission \(newest first, capped at --limit 1\)/);
    assert.match(text.stdout, /\| The board flips when I open the game\./);
  });

  test('a signed-in submission is stored and listed under its handle', async () => {
    // Account ids are 'user_<uuid>' text, not UUIDs; a UUID user_id column
    // rejected every signed-in insert.
    await getPool().query(
      `INSERT INTO users (id, email, email_verified_at, handle, display_name, profile_visibility)
       VALUES ('user_0ec1c2b4-9a51-4bb6-9e0e-0d3f1c6a7b21', 'fox@example.com', now(),
               'fox_player', 'Fox', 'public')`,
    );
    await insertFeedbackSubmission({
      id: '44444444-4444-4444-8444-444444444444',
      message: 'Fog xiangqi bot missed a capture.',
      email: null,
      path: '/play/fog-xiangqi',
      userId: 'user_0ec1c2b4-9a51-4bb6-9e0e-0d3f1c6a7b21',
      userAgent: 'test',
      ipHash: null,
    });
    const listed = runScript('feedback-inbox.mjs', ['--json']);
    assert.equal(listed.status, 0, listed.stderr);
    const rows = JSON.parse(listed.stdout) as Array<Record<string, unknown>>;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.from, '@fox_player');
  });

  test('the readout counts feedback and names new arrivals by path only', async () => {
    const runtime = {
      revision: 'r',
      activeGames: 0,
      databaseRequired: true,
      persistence: 'enabled' as const,
      persistenceErrors: { count1m: 0, lastAt: null },
    };
    await seed();
    const first = await generateMistboardReadout({
      trigger: 'daily',
      now: new Date('2026-10-06T17:23:00Z'),
      runtime,
      db: getPool(),
    });
    assert.deepEqual(first.report.feedback, {
      received: 2,
      recentPaths: ['/zh-hans/blog/cao-yanlei', '/play'],
    });
    // No earlier snapshot: nothing to call new.
    assert.equal(
      first.report.actions.some((entry) => entry.code === 'feedback-new'),
      false,
    );

    await insertFeedbackSubmission({
      id: '33333333-3333-4333-8333-333333333333',
      message: 'Partnership?',
      email: 'someone@example.com',
      path: '/contact',
      userId: null,
      userAgent: 'test',
      ipHash: 'c'.repeat(64),
    });
    const second = await generateMistboardReadout({
      trigger: 'daily',
      now: new Date('2026-10-07T17:23:00Z'),
      runtime,
      db: getPool(),
    });
    const action = second.report.actions.find((entry) => entry.code === 'feedback-new');
    assert.equal(
      action?.text,
      '1 new feedback message since the last readout (`/contact`). Read with npm run feedback:inbox.',
    );
    const serialized = JSON.stringify(second.report);
    assert.doesNotMatch(serialized, /Partnership\?|someone@example\.com|jane\.doe/);
  });
});
