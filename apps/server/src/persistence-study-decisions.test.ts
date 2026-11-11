import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
// The study-chapter analysis store and its read path: what the study page
// fetches, who may read it, and that a chapter going away takes its analysis.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createAccountSession, createUser } from './persistence.js';
import { getPool } from './persistence-db.js';
import { addChapter, createStudy, deleteChapter } from './persistence-studies.js';
import {
  decidedStudyChapterIds,
  getStudyChapterDecisions,
  saveStudyChapterDecisions,
} from './persistence-study-decisions.js';
import {
  assert,
  definePersistenceTests,
  sha256,
  TEST_DATABASE_URL,
  test,
} from './persistence-test-support.js';
import { tryHandle } from './routes/studies.js';

type Capture = { body: string; status: number | null };

function captureResponse(): ServerResponse & Capture {
  const capture = {
    body: '',
    status: null as number | null,
    writeHead(status: number) {
      capture.status = status;
      return capture;
    },
    setHeader() {
      return capture;
    },
    end(chunk?: string) {
      capture.body += chunk ?? '';
      return capture;
    },
  };
  return capture as unknown as ServerResponse & Capture;
}

async function get(pathname: string, cookie?: string): Promise<Capture> {
  const response = captureResponse();
  const request = {
    method: 'GET',
    url: pathname,
    headers: cookie ? { cookie } : {},
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as IncomingMessage;
  const handled = await tryHandle({}, request, response, pathname);
  assert.equal(handled, true);
  return response;
}

definePersistenceTests('study chapter decisions', () => {
  const now = new Date('2026-11-01T12:00:00Z');
  const tree = {
    version: 1,
    rootFen:
      'xxxxkxxxx/9/1x5x1/x1x1x1x1x/9/9/X1X1X1X1X/1X5X1/9/XXXXKXXXX w R2A2C2P5N2B2r2a2c2p5n2b2 0 1 prnabpbrccppanpCNPNAPAPBRPPRCB',
    root: { children: [{ uci: 'i4i5', children: [] }] },
  };
  const decisions = [{ ply: 1, mover: 'red' as const, playedWin: 50, realizedWin: 62 }];
  const input = { engineId: 'offline', source: 'match', decisions };
  async function setup(
    suffix: string,
    visibility: 'public' | 'private' | 'unlisted' = 'public',
    variant = 'jieqi',
  ) {
    const owner = await createUser({
      id: `luck_${suffix}`,
      email: `luck-${suffix}@example.com`,
      emailVerifiedAt: now,
      handle: `luck-${suffix}`,
      displayName: 'Luck',
      now,
    });
    const study = await createStudy({
      ownerId: owner.id,
      name: 'Luck',
      description: '',
      visibility,
      chapter: { name: 'Game', variant, orientation: 'red', root: tree },
    });
    assert.ok(study);
    return { owner, study, chapter: study.chapters[0]!.id };
  }
  test('saves, reads and replaces luck; payload marks chapters; deletion cascades', async () => {
    const { owner, study, chapter } = await setup('read');
    const path = `/api/studies/${study.id}/chapters/${chapter}/decisions`;
    assert.equal((await get(path)).status, 204);
    await saveStudyChapterDecisions({ ...input, chapterId: chapter });
    const hit = await get(path);
    assert.equal(hit.status, 200);
    // Serialize the entire new payload: no identity-bearing fields can ride alongside luck.
    assert.deepEqual(JSON.parse(hit.body), input);
    const payload = JSON.parse((await get(`/api/studies/${study.id}`)).body);
    assert.equal(payload.chapters[0].hasDecisions, true);
    await saveStudyChapterDecisions({ ...input, source: 'replacement', chapterId: chapter });
    assert.equal((await getStudyChapterDecisions(chapter))?.source, 'replacement');
    assert.deepEqual(await decidedStudyChapterIds([chapter]), new Set([chapter]));
    const second = await addChapter(study.id, owner.id, {
      name: 'Other',
      variant: 'jieqi',
      orientation: 'red',
      root: tree,
    });
    assert.ok(second.ok);
    assert.ok((await deleteChapter(chapter, owner.id)).ok);
    assert.equal(await getStudyChapterDecisions(chapter), null);
    assert.equal(
      (
        await getPool().query('SELECT 1 FROM study_chapter_decisions WHERE chapter_id=$1', [
          chapter,
        ])
      ).rows.length,
      0,
    );
  });
  test('CLI dry-run shows the diff without writing; apply imports and invalid data cannot replace it', async () => {
    const { study, chapter } = await setup('cli');
    const dir = await mkdtemp(join(tmpdir(), 'study-luck-'));
    const file = join(dir, 'luck.json');
    const args = [
      new URL('../../../scripts/study-chapter-decisions.mjs', import.meta.url).pathname,
      '--study',
      study.id,
      '--chapter',
      chapter,
      '--file',
      file,
    ];
    const run = (extra: string[] = []) =>
      promisify(execFile)(process.execPath, [...args, ...extra], {
        env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL! },
      });
    try {
      await writeFile(file, JSON.stringify(input));
      const dry = JSON.parse((await run()).stdout);
      assert.equal(dry.mode, 'dry-run');
      assert.equal(dry.before, null);
      assert.deepEqual(dry.after, input);
      assert.equal(await getStudyChapterDecisions(chapter), null);
      assert.equal(JSON.parse((await run(['--apply'])).stdout).mode, 'apply');
      assert.deepEqual((await getStudyChapterDecisions(chapter))?.decisions, decisions);
      await writeFile(file, JSON.stringify({ ...input, decisions: [{ ...decisions[0], ply: 0 }] }));
      await assert.rejects(run(['--apply']));
      assert.deepEqual((await getStudyChapterDecisions(chapter))?.decisions, decisions);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  test('private and crossed-study chapters are 404; unlisted is readable', async () => {
    const priv = await setup('private', 'private');
    const pub = await setup('unlisted', 'unlisted');
    await saveStudyChapterDecisions({ ...input, chapterId: priv.chapter });
    await saveStudyChapterDecisions({ ...input, chapterId: pub.chapter });
    const privatePath = `/api/studies/${priv.study.id}/chapters/${priv.chapter}/decisions`;
    assert.equal((await get(privatePath)).status, 404);
    const sessionId = 'luck_owner_session';
    const token = 'luck_test_token';
    await createAccountSession({
      id: sessionId,
      userId: priv.owner.id,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + 60000),
    });
    assert.equal((await get(privatePath, `mistboard_session=${sessionId}.${token}`)).status, 200);
    assert.equal(
      (await get(`/api/studies/${pub.study.id}/chapters/${priv.chapter}/decisions`)).status,
      404,
    );
    assert.equal(
      (await get(`/api/studies/${pub.study.id}/chapters/${pub.chapter}/decisions`)).status,
      200,
    );
  });
  test('rejects non-jieqi writes, ignores unsafe direct rows, and invalidates edited trees', async () => {
    const other = await setup('other', 'public', 'xiangqi');
    await assert.rejects(saveStudyChapterDecisions({ ...input, chapterId: other.chapter }));
    await getPool().query(
      'INSERT INTO study_chapter_decisions (chapter_id, engine_id, source, decisions) VALUES ($1, $2, $3, $4)',
      [other.chapter, 'e', 'direct', JSON.stringify(decisions)],
    );
    assert.equal(
      (await get(`/api/studies/${other.study.id}/chapters/${other.chapter}/decisions`)).status,
      204,
    );
    assert.equal(
      JSON.parse((await get(`/api/studies/${other.study.id}`)).body).chapters[0].hasDecisions,
      undefined,
    );
    const jieqi = await setup('safe');
    await getPool().query(
      'INSERT INTO study_chapter_decisions (chapter_id, engine_id, source, decisions) VALUES ($1, $2, $3, $4)',
      [jieqi.chapter, 'e', 'direct', JSON.stringify([{ ...decisions[0], capturedRole: 'horse' }])],
    );
    const unsafe = await get(`/api/studies/${jieqi.study.id}/chapters/${jieqi.chapter}/decisions`);
    assert.equal(unsafe.status, 204);
    assert.equal(unsafe.body, '');
    await saveStudyChapterDecisions({ ...input, chapterId: jieqi.chapter });
    await getPool().query('UPDATE study_chapters SET root=$2::jsonb WHERE id=$1', [
      jieqi.chapter,
      JSON.stringify({ ...tree, root: { children: [] } }),
    ]);
    assert.equal(await getStudyChapterDecisions(jieqi.chapter), null);
  });
});
