// The study-chapter analysis store and its read path: what the study page
// fetches, who may read it, and that a chapter going away takes its analysis.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createUser } from './persistence.js';
import { getPool } from './persistence-db.js';
import { addChapter, createStudy, deleteChapter } from './persistence-studies.js';
import {
  analysedStudyChapterIds,
  getStudyChapterAnalysis,
  saveStudyChapterAnalysis,
} from './persistence-study-analysis.js';
import { assert, definePersistenceTests, test } from './persistence-test-support.js';
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

async function get(pathname: string): Promise<Capture> {
  const response = captureResponse();
  const request = {
    method: 'GET',
    url: pathname,
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as IncomingMessage;
  const handled = await tryHandle({}, request, response, pathname);
  assert.equal(handled, true);
  return response;
}

definePersistenceTests('study chapter analysis', () => {
  const now = new Date('2026-10-06T12:00:00.000Z');
  const LINE = ['h3e3', 'h10g8', 'h1g3'];
  const tree = {
    version: 1,
    root: {
      children: [
        { uci: 'h3e3', children: [{ uci: 'h10g8', children: [{ uci: 'h1g3', children: [] }] }] },
      ],
    },
  };
  const plies = [0, 1, 2, 3].map((ply) => ({ ply, cp: 20 * ply, mate: null, best: 'b3e3' }));

  async function setup(suffix: string, visibility: 'public' | 'private') {
    const owner = await createUser({
      id: `user_sa_${suffix}`,
      email: `sa-${suffix}@example.com`,
      emailVerifiedAt: now,
      handle: `sa-${suffix}`,
      displayName: `SA ${suffix}`,
      now,
    });
    const study = await createStudy({
      ownerId: owner.id,
      name: 'Analysed games',
      description: '',
      visibility,
      chapter: { name: 'Game 1', variant: 'xiangqi', orientation: 'red', root: tree },
    });
    assert.ok(study);
    const second = await addChapter(study.id, owner.id, {
      name: 'Game 2',
      variant: 'xiangqi',
      orientation: 'red',
      root: tree,
    });
    assert.ok(second.ok);
    return { owner, study, first: study.chapters[0]!.id, second: second.chapter.id };
  }

  test('serves the stored analysis with the line it ran on; 204 without one', async () => {
    const { study, first, second } = await setup('read', 'public');
    await saveStudyChapterAnalysis({
      chapterId: first,
      engineId: 'pikafish-xiangqi-analysis@5',
      depth: 12,
      rootFen: null,
      moves: LINE,
      plies,
      source: 'engine',
    });

    const hit = await get(`/api/studies/${study.id}/chapters/${first}/analysis`);
    assert.equal(hit.status, 200);
    assert.deepEqual(JSON.parse(hit.body), {
      engineId: 'pikafish-xiangqi-analysis@5',
      depth: 12,
      rootFen: null,
      moves: LINE,
      plies,
    });

    const miss = await get(`/api/studies/${study.id}/chapters/${second}/analysis`);
    assert.equal(miss.status, 204);
    assert.equal(miss.body, '');

    // The study read marks which chapters have one, so the page fetches only those.
    const read = await get(`/api/studies/${study.id}`);
    assert.equal(read.status, 200);
    const chapters = (
      JSON.parse(read.body) as { chapters: Array<{ id: string; hasAnalysis?: boolean }> }
    ).chapters;
    assert.equal(chapters.find((c) => c.id === first)?.hasAnalysis, true);
    assert.equal(chapters.find((c) => c.id === second)?.hasAnalysis, undefined);
  });

  test('a private study or a chapter of another study is a 404', async () => {
    const priv = await setup('private', 'private');
    await saveStudyChapterAnalysis({
      chapterId: priv.first,
      engineId: 'e',
      depth: 12,
      rootFen: null,
      moves: LINE,
      plies,
      source: 'engine',
    });
    const anon = await get(`/api/studies/${priv.study.id}/chapters/${priv.first}/analysis`);
    assert.equal(anon.status, 404);

    const pub = await setup('other', 'public');
    const crossed = await get(`/api/studies/${pub.study.id}/chapters/${priv.first}/analysis`);
    assert.equal(crossed.status, 404);
  });

  test('a re-run replaces the row; deleting the chapter deletes its analysis', async () => {
    const { owner, study, first, second } = await setup('replace', 'public');
    const base = { engineId: 'e', depth: 12, rootFen: null, plies, source: 'engine' };
    await saveStudyChapterAnalysis({ ...base, chapterId: first, moves: LINE });
    await saveStudyChapterAnalysis({
      ...base,
      chapterId: first,
      moves: LINE.slice(0, 2),
      plies: plies.slice(0, 3),
      source: 'broadcast:b1',
    });
    const stored = await getStudyChapterAnalysis(first);
    assert.deepEqual(stored?.moves, LINE.slice(0, 2));
    assert.equal(stored?.source, 'broadcast:b1');
    assert.deepEqual(await analysedStudyChapterIds([first, second]), new Set([first]));

    const removed = await deleteChapter(first, owner.id);
    assert.ok(removed.ok);
    const { rows } = await getPool().query(
      `SELECT 1 FROM study_chapter_analysis WHERE chapter_id = $1`,
      [first],
    );
    assert.equal(rows.length, 0);
    assert.ok(study);
  });
});
