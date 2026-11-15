import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { type TestContext, test } from 'node:test';
import {
  BANQI_SPEC_ID,
  JIEQI_SPEC_ID,
  JUNGLE_FLIP_SPEC_ID,
  THREE_KINGDOMS_BANQI_PUBLIC_REPLAY,
  THREE_KINGDOMS_BANQI_SPEC_ID,
  XIANGQI_SPEC_ID,
} from '@mistboard/game';
import { close, getPool, init } from '../persistence-db.js';
import {
  ensureDealtRoot,
  isSerializedTree,
  setAdminOnlyStudyGateForTests,
  tryHandle,
} from './studies.js';

// The bug this exists for: studies gained the dealt variants, the create-study
// flow minted a deal, and the ADD-CHAPTER flow did not. So a jieqi study opened
// fine and its second chapter reported "this study uses a variant that is not
// supported yet" — a chapter with no deal has nothing to replay from. Found in
// production by adding a chapter, not by any test.
const EMPTY = { version: 1, root: { children: [] } };
const PUBLIC_REPLAY = { ...EMPTY, replay: THREE_KINGDOMS_BANQI_PUBLIC_REPLAY };
const REPLAY_VARIANTS = [
  BANQI_SPEC_ID,
  JIEQI_SPEC_ID,
  JUNGLE_FLIP_SPEC_ID,
  THREE_KINGDOMS_BANQI_SPEC_ID,
];

// Keep the real route, session lookup and persistence serializers; replace only
// SQL so every endpoint runs without a database or a listening server.
function studyRoutes(t: TestContext) {
  init('postgres://mistboard@127.0.0.1:9/never');
  t.after(close);
  setAdminOnlyStudyGateForTests(async () => true);
  t.after(() => setAdminOnlyStudyGateForTests(null));
  const now = new Date('2026-11-14T12:00:00Z');
  const study = {
    id: 'study1',
    owner_id: 'owner',
    name: 'Replay lesson',
    description: '',
    visibility: 'private',
    featured_at: null,
    created_at: now,
    updated_at: now,
  };
  let chapters: Record<string, unknown>[] = [];
  let writes = 0;
  const query = async (sql: string, values: unknown[] = []) => {
    if (sql.includes('UPDATE account_sessions')) {
      return { rows: [{ id: 'owner', handle: 'owner', account_role: 'admin' }] };
    }
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
    if (sql.includes('INSERT INTO studies')) {
      writes++;
      study.id = values[0] as string;
      chapters = [];
      return { rows: [] };
    }
    if (sql.includes('INSERT INTO study_chapters')) {
      writes++;
      const chapter = {
        id: values[0],
        study_id: values[1],
        name: values[2],
        variant: values[4],
        orientation: values[5],
        root: JSON.parse(values[6] as string),
        version: 1,
      };
      chapters.push(chapter);
      return { rows: [chapter] };
    }
    if (sql.includes('UPDATE study_chapters')) {
      writes++;
      const chapter = chapters.find((row) => row.id === values[3]);
      assert.ok(chapter);
      chapter.root = JSON.parse(values[0] as string);
      chapter.version = Number(chapter.version) + 1;
      return { rows: [chapter] };
    }
    if (sql.startsWith('UPDATE studies') || sql.startsWith('DELETE FROM study_chapter_')) {
      return { rows: [] };
    }
    if (sql.includes('LEFT JOIN study_chapters')) return { rows: chapters };
    if (sql.includes('FROM studies')) return { rows: [study] };
    if (sql.includes('FROM study_chapters')) {
      return {
        rows: chapters
          .filter((row) => !sql.includes('WHERE c.id') || row.id === values[0])
          .map((row) => ({ ...row, owner_id: study.owner_id })),
      };
    }
    assert.fail(`Unexpected study query: ${sql}`);
  };
  t.mock.method(getPool(), 'query', query);
  t.mock.method(getPool(), 'connect', async () => ({ query, release() {} }));

  return {
    seed(variant: string) {
      chapters = [{ id: 'chapter1', study_id: study.id, variant, root: EMPTY, version: 1 }];
    },
    writes: () => writes,
    async request(method: string, pathname: string, body: unknown) {
      const request = Readable.from([JSON.stringify(body)]) as IncomingMessage;
      request.method = method;
      request.headers = { cookie: 'mistboard_session=owner.test-token' };
      const response = {
        status: 0,
        body: '',
        writeHead(status: number) {
          this.status = status;
          return this;
        },
        end(body: string) {
          this.body = body;
          return this;
        },
      };
      assert.equal(
        await tryHandle({}, request, response as unknown as ServerResponse, pathname),
        true,
      );
      return { status: response.status, body: JSON.parse(response.body) };
    },
  };
}

test('create study accepts a public replay only for Three Kingdoms Banqi', async (t) => {
  const routes = studyRoutes(t);
  const results = [];
  for (const variant of REPLAY_VARIANTS) {
    const before = routes.writes();
    const response = await routes.request('POST', '/api/studies', {
      name: 'Replay lesson',
      chapter: { variant, root: PUBLIC_REPLAY },
    });
    results.push({
      variant,
      status: response.status,
      error: response.body.error,
      wrote: routes.writes() > before,
    });
    if (variant === THREE_KINGDOMS_BANQI_SPEC_ID) {
      assert.deepEqual(response.body.chapters[0].root, PUBLIC_REPLAY);
    }
  }
  assert.deepEqual(results, replayResults());
});

test('add chapter accepts a public replay only for Three Kingdoms Banqi', async (t) => {
  const routes = studyRoutes(t);
  const results = [];
  for (const variant of REPLAY_VARIANTS) {
    routes.seed(variant);
    const before = routes.writes();
    // Omit variant: the new chapter must use the stored study variant.
    const response = await routes.request('POST', '/api/studies/study1/chapters', {
      root: PUBLIC_REPLAY,
    });
    results.push({
      variant,
      status: response.status,
      error: response.body.error,
      wrote: routes.writes() > before,
    });
    if (variant === THREE_KINGDOMS_BANQI_SPEC_ID) {
      assert.deepEqual(response.body.chapter.root, PUBLIC_REPLAY);
    }
  }
  assert.deepEqual(results, replayResults());
});

function replayResults() {
  return REPLAY_VARIANTS.map((variant) => {
    const accepted = variant === THREE_KINGDOMS_BANQI_SPEC_ID;
    return {
      variant,
      status: accepted ? 201 : 400,
      error: accepted ? undefined : 'invalid_tree',
      wrote: accepted,
    };
  });
}

test('update chapter rejects a public replay using the stored Banqi variant', async (t) => {
  const routes = studyRoutes(t);
  routes.seed(BANQI_SPEC_ID);
  const response = await routes.request('PATCH', '/api/studies/study1/chapters/chapter1', {
    // A caller-supplied variant cannot authorize the marker.
    variant: THREE_KINGDOMS_BANQI_SPEC_ID,
    root: PUBLIC_REPLAY,
    baseVersion: 1,
  });
  assert.deepEqual(response, { status: 400, body: { error: 'invalid_tree' } });
  assert.equal(routes.writes(), 0);
});

test('a public Three Kingdoms replay never acquires a sampled dealt root', () => {
  const recorded = { ...EMPTY, replay: 'three-kingdoms-banqi-public-v1' };
  assert.equal(isSerializedTree(recorded, THREE_KINGDOMS_BANQI_SPEC_ID), true);
  const stored = {
    id: 'chapter',
    variant: 'three-kingdoms-banqi',
    root: ensureDealtRoot('three-kingdoms-banqi', recorded),
  };
  assert.deepEqual(JSON.parse(JSON.stringify(stored)), {
    id: 'chapter',
    variant: 'three-kingdoms-banqi',
    root: recorded,
  });
});

test('public replay roots reject unknown formats and any accompanying deal', () => {
  assert.equal(
    isSerializedTree({ ...EMPTY, replay: 'unknown-v1' }, THREE_KINGDOMS_BANQI_SPEC_ID),
    false,
  );
  assert.equal(
    isSerializedTree(
      {
        ...EMPTY,
        replay: 'three-kingdoms-banqi-public-v1',
        rootFen: 'secret-deal',
      },
      THREE_KINGDOMS_BANQI_SPEC_ID,
    ),
    false,
  );
});

test('a dealt variant always comes back with a root position', () => {
  for (const spec of [BANQI_SPEC_ID, JIEQI_SPEC_ID, JUNGLE_FLIP_SPEC_ID]) {
    const out = ensureDealtRoot(spec, EMPTY) as { rootFen?: string };
    assert.equal(typeof out.rootFen, 'string', `${spec} chapter was left without a deal`);
    assert.ok(out.rootFen && out.rootFen.trim().length > 0);
  }
});

test('an author-supplied deal is never replaced', () => {
  const supplied = { ...EMPTY, rootFen: 'author-chosen-position' };
  const out = ensureDealtRoot(JIEQI_SPEC_ID, supplied) as { rootFen?: string };
  assert.equal(out.rootFen, 'author-chosen-position');
});

test('two dealt chapters get two different deals', () => {
  // Each chapter is its own game. Minting once and reusing it would make every
  // chapter of a study the same position.
  const a = ensureDealtRoot(JIEQI_SPEC_ID, EMPTY) as { rootFen?: string };
  const b = ensureDealtRoot(JIEQI_SPEC_ID, EMPTY) as { rootFen?: string };
  assert.notEqual(a.rootFen, b.rootFen);
});

test('a deterministic variant is left exactly as it was', () => {
  // Xiangqi replays from its standard opening, so injecting a root here would
  // pin every chapter to one position for no reason.
  const out = ensureDealtRoot(XIANGQI_SPEC_ID, EMPTY);
  assert.deepEqual(out, EMPTY);
});
