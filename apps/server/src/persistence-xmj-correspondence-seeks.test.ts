/**
 * Xiangqi mahjong correspondence seeks and challenges: offered only between
 * accounts holding the per-account grant, and never rated. An account without
 * the grant cannot post one, accept one, be challenged to one, see one on the
 * seek board, or open a challenge link to one.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { XIANGQI_MAHJONG_SPEC_ID } from '@mistboard/game';
import {
  type AccountSession,
  createAccountSession,
  createUser,
  getCorrespondenceSeek,
} from './persistence.js';
import { assert, definePersistenceTests, sha256, test } from './persistence-test-support.js';
import { grantVariantAccess } from './persistence-variant-access.js';
import { tryHandle as tryHandleSeekRoute } from './routes/correspondence-seeks.js';
import type { HttpApiContext } from './routes/lib.js';
// Side-effect import: every tenant registers, so an accept can seat a game.
import './variant-tenant/register-tenants.js';
import { correspondenceTenantForSpecId } from './variant-tenant/registry.js';

definePersistenceTests('xiangqi mahjong correspondence seeks', () => {
  const at = new Date('2026-10-15T12:00:00Z');
  const seedUser = (id: string, granted: boolean) =>
    createUser({
      id,
      email: `${id}@example.com`,
      emailVerifiedAt: at,
      handle: id.replace(/[^a-z0-9]/g, ''),
      displayName: id,
      now: at,
    }).then(async (user) => {
      if (granted) await grantVariantAccess(user.id, XIANGQI_MAHJONG_SPEC_ID, 'test');
      return user;
    });
  const xmjSeek = { gameSpecId: XIANGQI_MAHJONG_SPEC_ID, daysPerMove: 3, preferredColor: 'random' };

  test('an account without the grant can neither post nor accept, and never sees the seek', async () => {
    await withFlags(async () => {
      const ann = await seedUser('xmj-ann', true);
      const bob = await seedUser('xmj-bob', false);
      const annCookie = await makeSessionCookie(ann.id);
      const bobCookie = await makeSessionCookie(bob.id);

      const refused = await callSeekRoute('POST', '/api/correspondence/seeks', bobCookie, xmjSeek);
      assert.equal(refused.status, 403);
      assert.equal(refused.json.error, 'variant_not_granted');

      const posted = await callSeekRoute('POST', '/api/correspondence/seeks', annCookie, xmjSeek);
      assert.equal(posted.status, 201, JSON.stringify(posted.json));
      const seekId = (posted.json.seek as { id: string }).id;

      const listed = (json: Record<string, unknown>) =>
        (json.seeks as Array<{ id: string }>).map((seek) => seek.id);
      assert.ok(
        listed((await callSeekRoute('GET', '/api/correspondence/seeks', annCookie)).json).includes(
          seekId,
        ),
      );
      assert.ok(
        !listed((await callSeekRoute('GET', '/api/correspondence/seeks', bobCookie)).json).includes(
          seekId,
        ),
      );
      assert.ok(
        !listed((await callSeekRoute('GET', '/api/correspondence/seeks', '')).json).includes(
          seekId,
        ),
      );

      const view = await callSeekRoute('GET', `/api/correspondence/seeks/${seekId}`, bobCookie);
      assert.equal(view.status, 404, 'the challenge link does not exist for him');

      const accept = await callSeekRoute(
        'POST',
        `/api/correspondence/seeks/${seekId}/accept`,
        bobCookie,
      );
      assert.equal(accept.status, 403);
      assert.equal(accept.json.error, 'variant_not_granted');
      assert.notEqual(
        await getCorrespondenceSeek(seekId),
        null,
        'a refused accept consumes nothing',
      );
    });
  });

  test('a challenge to an account without the grant is refused; rated is refused', async () => {
    await withFlags(async () => {
      const cal = await seedUser('xmj-cal', true);
      const dee = await seedUser('xmj-dee', false);
      const cookie = await makeSessionCookie(cal.id);
      const directed = await callSeekRoute('POST', '/api/correspondence/seeks', cookie, {
        ...xmjSeek,
        targetUserId: dee.id,
      });
      assert.equal(directed.status, 403);
      assert.equal(directed.json.error, 'target_variant_not_granted');

      const rated = await callSeekRoute('POST', '/api/correspondence/seeks', cookie, {
        ...xmjSeek,
        rated: true,
      });
      assert.ok(rated.status !== null && rated.status >= 400, 'never a rated seek');
    });
  });

  test('two granted accounts start a casual game from a seek', async () => {
    await withFlags(async () => {
      const eve = await seedUser('xmj-eve', true);
      const fay = await seedUser('xmj-fay', true);
      const posted = await callSeekRoute(
        'POST',
        '/api/correspondence/seeks',
        await makeSessionCookie(eve.id),
        xmjSeek,
      );
      assert.equal(posted.status, 201);
      const seekId = (posted.json.seek as { id: string }).id;
      try {
        const accept = await callSeekRoute(
          'POST',
          `/api/correspondence/seeks/${seekId}/accept`,
          await makeSessionCookie(fay.id),
        );
        assert.equal(accept.status, 201, JSON.stringify(accept.json));
        assert.equal(accept.json.gameSpecId, XIANGQI_MAHJONG_SPEC_ID);
        assert.equal(accept.json.rated, false);
        assert.ok(String(accept.json.roomId).startsWith('xmj_'));
      } finally {
        correspondenceTenantForSpecId(XIANGQI_MAHJONG_SPEC_ID)?.clearRooms();
      }
    });
  });
});

async function withFlags(run: () => Promise<void>): Promise<void> {
  const names = ['MISTBOARD_CORRESPONDENCE_ENABLED', 'MISTBOARD_XIANGQI_MAHJONG_ENABLED'];
  const prior = names.map((name) => [name, process.env[name]] as const);
  for (const name of names) process.env[name] = 'true';
  try {
    await run();
  } finally {
    for (const [name, value] of prior) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
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

const notDraining = {
  refusesCreate: () => false,
  drainDeadlineMs: () => null,
} as unknown as HttpApiContext;

async function callSeekRoute(
  method: string,
  path: string,
  cookie: string,
  body?: Record<string, unknown>,
): Promise<{ status: number | null; json: Record<string, unknown> }> {
  const request = Object.assign(Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []), {
    method,
    headers: cookie ? { cookie } : {},
  }) as unknown as IncomingMessage;
  const capture = {
    body: '',
    status: null as number | null,
    writeHead(status: number) {
      capture.status = status;
      return capture;
    },
    end(chunk?: string) {
      capture.body += chunk ?? '';
      return capture;
    },
  };
  const handled = await tryHandleSeekRoute(
    notDraining,
    request,
    capture as unknown as ServerResponse,
    path,
  );
  assert.equal(handled, true, `${method} ${path} should be claimed`);
  return { status: capture.status, json: JSON.parse(capture.body || '{}') };
}
