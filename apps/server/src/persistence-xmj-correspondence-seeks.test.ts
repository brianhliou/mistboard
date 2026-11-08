/**
 * Xiangqi mahjong is held out of correspondence at launch (Brian, 2026-10-25:
 * "let's not support correspondence for this variant yet"): with every flag
 * on, an open seek and a directed challenge are both refused. Reopening it is
 * one line in CORRESPONDENCE_PLAYABLE_SPEC_IDS; the seek, challenge and accept
 * tests it had while open are in this file at a32cdd604^.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { XIANGQI_MAHJONG_SPEC_ID } from '@mistboard/game';
import { type AccountSession, createAccountSession, createUser } from './persistence.js';
import { assert, definePersistenceTests, sha256, test } from './persistence-test-support.js';
import { tryHandle as tryHandleSeekRoute } from './routes/correspondence-seeks.js';
import type { HttpApiContext } from './routes/lib.js';
// Side-effect import: every tenant registers, so an accept can seat a game.
import './variant-tenant/register-tenants.js';

definePersistenceTests('xiangqi mahjong correspondence seeks', () => {
  const at = new Date('2026-10-15T12:00:00Z');
  const seedUser = (id: string) =>
    createUser({
      id,
      email: `${id}@example.com`,
      emailVerifiedAt: at,
      handle: id.replace(/[^a-z0-9]/g, ''),
      displayName: id,
      now: at,
    });
  const xmjSeek = { gameSpecId: XIANGQI_MAHJONG_SPEC_ID, daysPerMove: 3, preferredColor: 'random' };

  test('an XMJ seek and an XMJ challenge are both refused while it is held', async () => {
    await withFlags(async () => {
      const ann = await seedUser('xmj-ann');
      const bob = await seedUser('xmj-bob');
      const cookie = await makeSessionCookie(ann.id);
      for (const body of [xmjSeek, { ...xmjSeek, targetUserId: bob.id }]) {
        const posted = await callSeekRoute('POST', '/api/correspondence/seeks', cookie, body);
        assert.equal(posted.status, 501, JSON.stringify(posted.json));
        assert.equal(posted.json.error, 'correspondence_unsupported_spec');
      }
      const listed = await callSeekRoute('GET', '/api/correspondence/seeks', '');
      assert.deepEqual(
        (listed.json.seeks as Array<{ gameSpecId: string }>).filter(
          (seek) => seek.gameSpecId === XIANGQI_MAHJONG_SPEC_ID,
        ),
        [],
      );
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
