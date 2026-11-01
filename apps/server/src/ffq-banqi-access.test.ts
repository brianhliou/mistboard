import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import test from 'node:test';
import type { WebSocket } from 'ws';
import { ffqBanqiEnabled } from './feature-flags.js';
import { FFQ_BANQI_ROOM_ID_PREFIX, ffqBanqiAdmits } from './ffq-banqi-access.js';
import { ffqBanqiTenant } from './ffq-banqi-tenant.js';
import { close, getPool, init } from './persistence-db.js';
import { clearPresence } from './presence.js';
import type { HttpApiContext } from './routes/lib.js';
import { tryHandle as lobbyRoute } from './routes/lobby.js';
import { tryHandle as roomsRoute } from './routes/rooms.js';
import {
  handleWebSocketConnection,
  type WebSocketConnectionContext,
} from './server-ws-connection.js';
import './variant-tenant/register-tenants.js';
import { registeredVariantTenants } from './variant-tenant/registry.js';

const FLAG = 'MISTBOARD_FFQ_BANQI_ENABLED';
const SELECTORS: Record<string, string>[] = [
  { gameSpecId: 'ffq-banqi' },
  { variant: 'ffq-banqi' },
  { gameSpecId: 'dark-chess', variant: 'ffq-banqi' },
  { gameSpecId: 'ffq-banqi', variant: 'dark-chess' },
  { gameSpecId: 'banqi', variant: 'ffq-banqi' },
  { gameSpecId: 'unknown', variant: 'ffq-banqi' },
  { gameSpecId: 'ffq-banqi', botId: 'misty', mode: 'pve' },
];

for (const flag of [undefined, 'false', 'true']) {
  for (const accountRole of [null, 'player', 'admin'] as const) {
    test(`FFQ network gates: flag=${flag}, account=${accountRole ?? 'guest'}`, async (t) => {
      const before = process.env[FLAG];
      if (flag === undefined) delete process.env[FLAG];
      else process.env[FLAG] = flag;
      t.after(() => {
        if (before === undefined) delete process.env[FLAG];
        else process.env[FLAG] = before;
        clearPresence();
      });

      // Exercise real session resolution without a socket or a database.
      init('postgres://mistboard@127.0.0.1:9/never-connect');
      t.after(() => close());
      t.mock.method(getPool(), 'connect', () => assert.fail('unexpected database connection'));
      t.mock.method(getPool(), 'query', async (sql: string) => {
        assert.ok(sql.includes('UPDATE account_sessions'), 'only session reads are allowed');
        return {
          rows: accountRole
            ? [{ id: 'fixture-user', handle: 'fixture', account_role: accountRole }]
            : [],
        };
      });
      const headers = accountRole ? { cookie: 'mistboard_session=fixture.token' } : {};
      const admitted = flag === 'true' && accountRole === 'admin';
      assert.equal(ffqBanqiEnabled(), flag === 'true');
      assert.equal(ffqBanqiAdmits(accountRole ? { accountRole } : null), admitted);
      assert.equal(ffqBanqiTenant.roomIdPrefix, FFQ_BANQI_ROOM_ID_PREFIX);
      assert.equal(
        registeredVariantTenants().some(
          (entry) =>
            entry.gameSpecId === 'ffq-banqi' || entry.roomIdPrefix === FFQ_BANQI_ROOM_ID_PREFIX,
        ),
        false,
        'the access policy must not register FFQ rooms',
      );

      // No creation, engine reservation, lobby ticket or room lookup may run.
      const context = new Proxy({} as HttpApiContext, {
        get: (_target, key) => assert.fail(`FFQ request reached runtime context: ${String(key)}`),
      });
      for (const [path, route] of [
        ['/api/rooms', roomsRoute],
        ['/api/lobby', lobbyRoute],
      ] as const) {
        for (const selectors of SELECTORS) {
          const payload = JSON.stringify({ mode: 'pvp', ...selectors });
          const request = Readable.from([payload]) as unknown as IncomingMessage;
          request.method = 'POST';
          request.headers = headers;
          let status = 0;
          let body = '';
          const response = {
            writeHead: (code: number) => {
              status = code;
            },
            end: (chunk: string) => {
              body += chunk;
            },
          } as unknown as ServerResponse;
          assert.equal(await route(context, request, response, path), true);
          assert.equal(status, admitted ? 501 : 404, `${path}: ${JSON.stringify(selectors)}`);
          assert.deepEqual(JSON.parse(body), {
            error: admitted ? 'ffq_banqi_not_integrated' : 'ffq_banqi_disabled',
          });
        }
      }

      // Selectors must be checked before another registered room can claim
      // the connection. A bare reserved prefix must also fail before chess.
      for (const selectors of SELECTORS) {
        for (const room of ['room-chess', 'bq_reserved']) {
          await refusedSocket(
            new URLSearchParams({ ...selectors, room }),
            headers,
            admitted ? 'game spec not integrated' : 'game spec disabled',
          );
        }
      }
      await refusedSocket(
        new URLSearchParams({ room: `${FFQ_BANQI_ROOM_ID_PREFIX}reserved` }),
        headers,
        admitted ? 'room unavailable' : 'game spec disabled',
      );
    });
  }
}

async function refusedSocket(
  params: URLSearchParams,
  headers: IncomingMessage['headers'],
  reason: string,
): Promise<void> {
  const closes: unknown[] = [];
  const socket = {
    close: (code: number, message: string) => closes.push([code, message]),
    send: () => assert.fail('refused FFQ connection sent a payload'),
  } as unknown as WebSocket;
  const request = { url: `/?${params}`, headers } as IncomingMessage;
  await handleWebSocketConnection({} as WebSocketConnectionContext, socket, request);
  assert.deepEqual(closes, [[1008, reason]]);
}
