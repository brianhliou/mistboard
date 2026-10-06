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

// The triage commands are repo-root scripts (scripts/feedback-{inbox,mark}.mjs),
// so the test runs them the way a session does: a child process with
// DATABASE_URL pointed at the test database. Compiled to apps/server/dist.
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

definePersistenceTests('feedback triage', () => {
  test('migration 162 backfills every row to new', async () => {
    await seed();
    const rows = await getPool().query<{ triage_status: string }>(
      `SELECT triage_status FROM feedback_submissions`,
    );
    assert.deepEqual(
      rows.rows.map((row) => row.triage_status),
      ['new', 'new'],
    );
  });

  test('the inbox lists untriaged rows newest first with the address masked', async () => {
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

    const since = JSON.parse(
      runScript('feedback-inbox.mjs', ['--json', '--since', '2026-10-01']).stdout,
    );
    assert.deepEqual(
      since.map((row: { id: string }) => row.id),
      [NEWER],
    );
    const text = runScript('feedback-inbox.mjs', ['--limit', '1']);
    assert.match(
      text.stdout,
      /1 feedback submission \(untriaged, newest first, capped at --limit 1\)/,
    );
    assert.match(text.stdout, /\| The board flips when I open the game\./);
  });

  test('mark is the one write: it records the decision and prints the row', async () => {
    await seed();
    const marked = runScript('feedback-mark.mjs', [
      NEWER,
      '--status',
      'triaged',
      '--class',
      'bug',
      '--note',
      'board flip fixed in f529d184, parked for ship',
    ]);
    assert.equal(marked.status, 0, marked.stderr);
    assert.match(marked.stdout, /status triaged, class bug, triaged 20\d\d-/);
    assert.match(marked.stdout, /note: board flip fixed in f529d184/);
    assert.doesNotMatch(marked.stdout, /jane\.doe/);

    // A second mark keeps the class and note it was not given.
    assert.equal(runScript('feedback-mark.mjs', [NEWER, '--status', 'done']).status, 0);
    const stored = await getPool().query<{
      triage_status: string;
      triage_class: string;
      triage_note: string;
      triaged_at: Date | null;
    }>(
      `SELECT triage_status, triage_class, triage_note, triaged_at FROM feedback_submissions WHERE id = $1`,
      [NEWER],
    );
    assert.equal(stored.rows[0]!.triage_status, 'done');
    assert.equal(stored.rows[0]!.triage_class, 'bug');
    assert.match(stored.rows[0]!.triage_note, /f529d184/);
    assert.ok(stored.rows[0]!.triaged_at);

    const untriaged = JSON.parse(runScript('feedback-inbox.mjs', ['--json']).stdout);
    assert.deepEqual(
      untriaged.map((row: { id: string }) => row.id),
      [OLDER],
    );
    const all = JSON.parse(runScript('feedback-inbox.mjs', ['--json', '--all']).stdout);
    assert.equal(all.length, 2);

    const missing = runScript('feedback-mark.mjs', [
      '22222222-2222-4222-8222-222222222222',
      '--status',
      'spam',
    ]);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /No feedback submission/);
    const withAddress = runScript('feedback-mark.mjs', [
      OLDER,
      '--status',
      'triaged',
      '--note',
      'reply to jane.doe@protonmail.com',
    ]);
    assert.equal(withAddress.status, 1);
    const unchanged = await getPool().query<{ triage_status: string }>(
      `SELECT triage_status FROM feedback_submissions WHERE id = $1`,
      [OLDER],
    );
    assert.equal(unchanged.rows[0]!.triage_status, 'new');
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
      untriaged: 2,
      recentPaths: ['/zh-hans/blog/cao-yanlei', '/play'],
    });
    assert.equal(first.report.actions[0]?.code, 'feedback-new');

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
      '1 new feedback message since the last readout (`/contact`); 3 untriaged in all. Triage with npm run feedback:inbox.',
    );
    const serialized = JSON.stringify(second.report);
    assert.doesNotMatch(serialized, /Partnership\?|someone@example\.com|jane\.doe/);
  });
});
