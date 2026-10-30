// Three Kingdoms banqi studies (#628) are admin-only until the public launch:
// a non-admin or a guest cannot create one, open one, act on one or find one
// in any list, and every refusal reads exactly as a missing study does. The
// gate is planted open once to prove these assertions catch a leak.
//
// The hidden-info half: what a reader's payloads carry of the deal under the
// face-down tiles. The chapter root keeps it (the study's own material, as in
// banqi); nothing else does.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { initialStartFen } from '@mistboard/game';
import {
  type AccountSession,
  createAccountSession,
  createUser,
  listTopPublicStudies,
} from './persistence.js';
import {
  assert,
  definePersistenceTests,
  pg,
  sha256,
  TEST_DATABASE_URL,
  test,
} from './persistence-test-support.js';
import { setAdminOnlyStudyGateForTests, tryHandle } from './routes/studies.js';

type ResponseCapture = { body: string; status: number | null };

const TK = 'three-kingdoms-banqi';
const FLAG = 'MISTBOARD_THREE_KINGDOMS_BANQI_ENABLED';

definePersistenceTests('study-admin-only', () => {
  test('a Three Kingdoms study is refused to a non-admin and a guest, and shown to an admin', async (t) => {
    const savedFlag = process.env[FLAG];
    delete process.env[FLAG];
    t.after(() => {
      if (savedFlag === undefined) delete process.env[FLAG];
      else process.env[FLAG] = savedFlag;
      setAdminOnlyStudyGateForTests(null);
    });

    const now = new Date('2026-10-29T00:00:00Z');
    await makeUser('tks_admin', 'tksadmin', now);
    await makeUser('tks_member', 'tksmember', now);
    await runSql(`UPDATE users SET account_role = 'admin' WHERE id = 'tks_admin'`);
    const admin = await makeSessionCookie('tks_admin');
    const member = await makeSessionCookie('tks_member');

    const rootFen = initialStartFen(TK, () => 0.3);
    assert.ok(rootFen, 'a dealt start for the study');
    const deal = rootFen.split(' ')[5];
    assert.ok(deal && deal.length === 32, 'the sixth field pins all 32 face-down tiles');

    // The admin creates a public Three Kingdoms study; a public xiangqi study
    // is the control that proves the lists are not simply empty.
    const created = await callJson(
      'POST',
      '/api/studies',
      {
        name: 'Three Kingdoms openings',
        visibility: 'public',
        chapter: { name: 'Deal one', variant: TK, root: emptyTree(rootFen) },
      },
      admin,
    );
    assert.equal(created.status, 201, created.body);
    const tkStudy = JSON.parse(created.body) as {
      study: { id: string };
      chapters: { id: string }[];
    };
    const studyId = tkStudy.study.id;
    const chapterId = tkStudy.chapters[0]!.id;
    const control = await callJson(
      'POST',
      '/api/studies',
      {
        name: 'Cannon openings',
        visibility: 'public',
        chapter: { name: 'One', variant: 'xiangqi', root: emptyTree(null) },
      },
      admin,
    );
    assert.equal(control.status, 201, control.body);
    const controlId = (JSON.parse(control.body) as { study: { id: string } }).study.id;

    // Featured, and liked by both accounts (the member's like written straight
    // to the table, since the route refuses it), so the staff and favorites
    // lists have a row to leak.
    await runSql(`UPDATE studies SET featured_at = now() WHERE id IN ($1, $2)`, [
      studyId,
      controlId,
    ]);
    await runSql(
      `INSERT INTO study_likes (study_id, user_id) VALUES ($1, 'tks_admin'), ($1, 'tks_member'), ($2, 'tks_member')`,
      [studyId, controlId],
    );

    async function assertRefused(cookie: string | undefined, who: string): Promise<void> {
      const missing = (r: ResponseCapture, what: string) => {
        assert.equal(r.status, 404, `${who}: ${what} -> ${r.status} ${r.body}`);
        assert.deepEqual(JSON.parse(r.body), { error: 'not_found' }, `${who}: ${what}`);
      };
      missing(await call('GET', `/api/studies/${studyId}`, cookie), 'read');
      missing(
        await call('GET', `/api/studies/${studyId}/chapters/${chapterId}/analysis`, cookie),
        'analysis',
      );
      missing(
        await callJson('POST', `/api/studies/${studyId}/like`, { liked: true }, cookie),
        'like',
      );
      missing(await call('POST', `/api/studies/${studyId}/clone`, cookie), 'clone');
      missing(await callJson('PATCH', `/api/studies/${studyId}`, { name: 'x' }, cookie), 'edit');
      missing(
        await callJson('POST', `/api/studies/${studyId}/chapters`, { name: 'x' }, cookie),
        'add chapter',
      );

      for (const list of ['/api/studies/public', '/api/studies/staff']) {
        const r = await call('GET', list, cookie);
        assert.equal(r.status, 200, `${who}: ${list}`);
        assert.ok(r.body.includes(controlId), `${who}: ${list} lists the control`);
        assert.ok(!r.body.includes(studyId), `${who}: ${list} lists the TK study`);
      }

      if (cookie) {
        const favorites = await call('GET', '/api/studies/favorites', cookie);
        assert.equal(favorites.status, 200);
        assert.ok(favorites.body.includes(controlId), `${who}: favorites lists the control`);
        assert.ok(!favorites.body.includes(studyId), `${who}: favorites lists the TK study`);

        // Create answers exactly as an unknown variant does.
        const create = await callJson(
          'POST',
          '/api/studies',
          {
            name: 'Mine',
            visibility: 'public',
            chapter: { name: 'One', variant: TK, root: emptyTree(rootFen) },
          },
          cookie,
        );
        assert.equal(create.status, 400, `${who}: create -> ${create.status}`);
        assert.deepEqual(JSON.parse(create.body), { error: 'unsupported_variant' });
      }
    }

    await assertRefused(member, 'member');
    await assertRefused(undefined, 'guest');

    // Planted failure: an open gate must fail the very same assertions.
    setAdminOnlyStudyGateForTests(async () => true);
    await assert.rejects(assertRefused(member, 'member'), 'an open gate passed the member check');
    await assert.rejects(assertRefused(undefined, 'guest'), 'an open gate passed the guest check');
    setAdminOnlyStudyGateForTests(null);
    // The planted pass created a study as the member; it must not survive.
    await runSql(`DELETE FROM studies WHERE owner_id = 'tks_member'`);
    await assertRefused(member, 'member, gate restored');

    // The admin sees it everywhere.
    const read = await call('GET', `/api/studies/${studyId}`, admin);
    assert.equal(read.status, 200, read.body);
    for (const list of ['/api/studies/public', '/api/studies/staff', '/api/studies/favorites']) {
      const r = await call('GET', list, admin);
      assert.ok(r.body.includes(studyId), `admin: ${list} lists the TK study`);
    }

    // Hidden info. The study payload carries the deal once, in the chapter
    // root (the author's material, the same model as banqi); the list payload,
    // which feeds cards, the homepage and the sitemap, never carries it and
    // draws every face-down tile as a colourless disc.
    assert.equal(read.body.split(deal).length - 1, 1, 'the deal appears exactly once');
    const payload = JSON.parse(read.body) as {
      chapters: { variant: string; root: { rootFen?: string } }[];
    };
    assert.equal(payload.chapters[0]?.variant, TK);
    assert.equal(payload.chapters[0]?.root.rootFen, rootFen);

    const listed = await call('GET', '/api/studies/public', admin);
    assert.ok(!listed.body.includes(deal), 'the list payload carries the deal');
    const card = (
      JSON.parse(listed.body) as {
        studies: { id: string; previewBoard: { fen: unknown; grid: { cells: string } } }[];
      }
    ).studies.find((study) => study.id === studyId);
    assert.ok(card, 'the admin list has the card');
    assert.equal(card.previewBoard.fen, null, 'no FEN, so no sixth field');
    assert.match(card.previewBoard.grid.cells, /^[.?]+$/, 'only empty points and face-down discs');
    assert.equal(card.previewBoard.grid.cells.replaceAll('.', '').length, 32);

    // The sitemap and the analysis CLI read the list with the default access:
    // fail-closed, so the TK study is not there.
    const everyPublic = await listTopPublicStudies(50);
    assert.ok(everyPublic.some((study) => study.id === controlId));
    assert.ok(!everyPublic.some((study) => study.id === studyId), 'default access lists TK');
  });
});

function emptyTree(rootFen: string | null): Record<string, unknown> {
  return {
    version: 1,
    root: { children: [] },
    ...(rootFen ? { rootFen } : {}),
  };
}

async function makeUser(id: string, handle: string, now: Date): Promise<void> {
  await createUser({
    id,
    email: `${handle}@example.com`,
    emailVerifiedAt: now,
    handle,
    displayName: handle,
    now,
  });
}

async function makeSessionCookie(userId: string): Promise<string> {
  const sessionId = `sess_${userId}`;
  const token = `tok_${userId}`;
  const session: AccountSession = {
    id: sessionId,
    userId,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  };
  await createAccountSession(session);
  return `mistboard_session=${sessionId}.${token}`;
}

async function call(method: string, path: string, cookie?: string): Promise<ResponseCapture> {
  return dispatch(
    {
      method,
      url: path,
      headers: cookie ? { cookie } : {},
      async *[Symbol.asyncIterator]() {},
    } as unknown as IncomingMessage,
    path,
  );
}

async function callJson(
  method: string,
  path: string,
  body: unknown,
  cookie?: string,
): Promise<ResponseCapture> {
  const chunks = [Buffer.from(JSON.stringify(body))];
  return dispatch(
    {
      method,
      url: path,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      async *[Symbol.asyncIterator]() {
        yield* chunks;
      },
    } as unknown as IncomingMessage,
    path,
  );
}

async function dispatch(request: IncomingMessage, path: string): Promise<ResponseCapture> {
  const capture = {
    body: '',
    status: null as number | null,
    statusCode: 200,
    setHeader() {
      return capture;
    },
    writeHead(status: number) {
      capture.status = status;
      return capture;
    },
    end(chunk?: string) {
      capture.body += chunk ?? '';
      return capture;
    },
  };
  const handled = await tryHandle({}, request, capture as unknown as ServerResponse, path);
  assert.equal(handled, true, `expected ${request.method} ${path} to be handled`);
  return capture;
}

async function runSql(sql: string, params: unknown[] = []): Promise<void> {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    await client.query(sql, params);
  } finally {
    await client.end();
  }
}
