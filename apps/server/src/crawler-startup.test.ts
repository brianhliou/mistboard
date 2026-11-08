import assert from 'node:assert/strict';
import { Server } from 'node:http';
import test from 'node:test';
import { startServer, stopServer } from './index.js';

test('a strict-port conflict rejects startup without an unhandled ws error', {
  timeout: 5_000,
}, async (t) => {
  const error = Object.assign(new Error('fixture: address already in use'), { code: 'EADDRINUSE' });
  t.mock.method(Server.prototype, 'listen', function (this: Server) {
    queueMicrotask(() => this.emit('error', error));
    return this;
  });
  t.after(() => stopServer().catch(() => {}));
  await assert.rejects(startServer({ port: 3197, host: '127.0.0.1' }), { code: 'EADDRINUSE' });
});
