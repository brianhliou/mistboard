import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import test from 'node:test';
import { pingCorsAllowOrigin } from '../server-policy.js';
import type { HttpApiContext } from './lib.js';
import { tryHandle } from './meta.js';

async function ping(headers: Record<string, string>): Promise<Record<string, unknown>> {
  let written: Record<string, unknown> = {};
  const request = { method: 'GET', headers } as unknown as IncomingMessage;
  const response = {
    writeHead(_status: number, h: Record<string, unknown>) {
      written = h;
      return this;
    },
    end() {},
  } as unknown as ServerResponse;
  const url = new URL('https://socket.mistboard.com/api/ping');
  const handled = await tryHandle({} as HttpApiContext, request, response, '/api/ping', url);
  assert.equal(handled, true);
  return written;
}

// The account dropdown times /api/ping on the socket host (socket.mistboard.com)
// from a page on mistboard.com, so the site must be able to read it cross-origin.
test('/api/ping lets the site read it cross-origin, and only the site', async () => {
  for (const origin of ['https://mistboard.com', 'https://www.mistboard.com']) {
    const headers = await ping({ origin, host: 'socket.mistboard.com' });
    assert.equal(headers['access-control-allow-origin'], origin);
    assert.equal(headers['access-control-allow-credentials'], undefined);
    assert.equal(headers['cache-control'], 'no-store');
  }
  const foreign = await ping({ origin: 'https://evil.example', host: 'socket.mistboard.com' });
  assert.equal(foreign['access-control-allow-origin'], undefined);
  assert.equal(foreign['cache-control'], 'no-store');
  const sameOrigin = await ping({ host: 'mistboard.com' });
  assert.equal(sameOrigin['access-control-allow-origin'], undefined);
});

test('pingCorsAllowOrigin also accepts the origins the socket is configured for', () => {
  const env = { MISTBOARD_ALLOWED_ORIGINS: 'https://staging.mistboard.com' };
  assert.equal(
    pingCorsAllowOrigin('https://staging.mistboard.com', 'socket.mistboard.com', env),
    'https://staging.mistboard.com',
  );
  assert.equal(pingCorsAllowOrigin('https://mistboard.com', 'x', env), 'https://mistboard.com');
  assert.equal(pingCorsAllowOrigin('https://evil.example', 'socket.mistboard.com', env), null);
  assert.equal(pingCorsAllowOrigin(undefined, 'socket.mistboard.com', env), null);
});
