import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import test from 'node:test';
import { gameSpecForId } from '@mistboard/game';
import { close, getPool, init } from '../persistence-db.js';
import { clearPresence } from '../presence.js';
import { tryHandle } from './engines.js';

const LEVELS = Array.from({ length: 8 }, (_, i) => `misty-ffq-banqi-level-${i + 1}`);
const REAL_ENGINE = process.env.MISTBOARD_FFQ_BANQI_ENGINE_PATH;

test('FFQ playable roster follows hidden and public live admission; missing binary offers only L1 and never leaks into public fields', async (t) => {
  const keys = [
    'MISTBOARD_FFQ_BANQI_ENABLED',
    'MISTBOARD_FFQ_BANQI_ENGINE_PATH',
    'MISTBOARD_EXTRA_PLAYABLE_ENGINES',
  ] as const;
  const spec = gameSpecForId('ffq-banqi');
  const priorSurface = spec.publicSurface;
  const saved = keys.map((key) => process.env[key]);
  init('postgres://mistboard@127.0.0.1:9/never-connect');
  t.after(async () => {
    spec.publicSurface = priorSurface;
    clearPresence();
    await close();
    keys.forEach((key, i) => {
      if (saved[i] === undefined) delete process.env[key];
      else process.env[key] = saved[i];
    });
  });
  t.mock.method(getPool(), 'query', async (sql: string, args: unknown[]) => {
    assert.ok(sql.includes('UPDATE account_sessions'));
    return { rows: [{ id: args[0], handle: 'fixture', account_role: args[0] }] };
  });
  for (const surface of ['hidden', 'casual'] as const)
    for (const flag of ['false', 'true'])
      for (const role of [undefined, 'player', 'admin']) {
        spec.publicSurface = surface;
        const admitted = flag === 'true' && (surface === 'casual' || role === 'admin');
        process.env.MISTBOARD_FFQ_BANQI_ENABLED = flag;
        process.env.MISTBOARD_FFQ_BANQI_ENGINE_PATH = '/nonexistent/ffq-banqi-engine';
        process.env.MISTBOARD_EXTRA_PLAYABLE_ENGINES = LEVELS.join(',');
        const request = {
          method: 'GET',
          headers: role ? { cookie: `mistboard_session=${role}.fixture` } : {},
        } as IncomingMessage;
        let body = '';
        let status = 0;
        const response = {
          writeHead(code: number) {
            status = code;
          },
          end(chunk: string) {
            body += chunk;
          },
        } as unknown as ServerResponse;
        assert.equal(await tryHandle({}, request, response, '/api/engines/playable'), true);
        assert.equal(status, 200);
        const data = JSON.parse(body);
        assert.ok(!data.engines.some((e: { id: string }) => e.id.startsWith('misty-ffq')));
        assert.deepEqual(
          data.ffqBanqiEngines?.map((e: { id: string }) => e.id),
          admitted ? [LEVELS[0]] : undefined,
        );
        if (!admitted) assert.ok(!body.includes('ffq'));
        if (REAL_ENGINE && admitted) {
          process.env.MISTBOARD_FFQ_BANQI_ENGINE_PATH = REAL_ENGINE;
          body = '';
          await tryHandle({}, request, response, '/api/engines/playable');
          const full = JSON.parse(body);
          assert.deepEqual(
            full.ffqBanqiEngines.map((e: { id: string }) => e.id),
            LEVELS,
          );
        }
      }
});
