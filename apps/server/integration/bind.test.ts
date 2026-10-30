import assert from 'node:assert/strict';
import { Server } from 'node:http';
import test, { type TestContext } from 'node:test';
import { startServer } from '../src/index.js';
import { serverConfig } from '../src/server-config.js';
import { startTestServer } from './harness.js';

function stubListener(t: TestContext) {
  // Exercise startup wiring even in sandboxes that prohibit local listeners.
  const listen = t.mock.method(
    Server.prototype,
    'listen',
    function (this: Server, ...args: unknown[]) {
      const ready = args.at(-1);
      assert.ok(typeof ready === 'function');
      queueMicrotask(() => ready());
      return this;
    },
  );
  t.mock.method(Server.prototype, 'close', function (this: Server, done?: (error?: Error) => void) {
    queueMicrotask(() => done?.());
    return this;
  });
  return listen;
}

test('bind option: server forwards the configured HOST to its listener', async (t) => {
  const listen = stubListener(t);
  const previousHost = serverConfig.host;
  serverConfig.host = '127.0.0.1';
  t.after(() => {
    serverConfig.host = previousHost;
  });
  const server = await startServer({ port: 0 });
  t.after(() => server.close());
  assert.deepEqual(listen.mock.calls[0].arguments[0], { port: 0, host: '127.0.0.1' });
});

test('bind option: test harness overrides a wildcard configured HOST', async (t) => {
  const listen = stubListener(t);
  const previousHost = serverConfig.host;
  serverConfig.host = '::';
  t.after(() => {
    serverConfig.host = previousHost;
  });
  const server = await startTestServer();
  t.after(() => server.close());
  assert.deepEqual(listen.mock.calls[0].arguments[0], { port: 0, host: '127.0.0.1' });
});

test('test server binds to the IPv4 loopback used by its clients', async (t) => {
  // Record the real listener so this catches wildcard binds even without a VPN.
  const listen = t.mock.method(Server.prototype, 'listen');
  const server = await startTestServer();
  t.after(() => server.close());

  const listener = listen.mock.calls[0]?.this;
  assert.ok(listener instanceof Server);
  assert.deepEqual(listener.address(), {
    address: '127.0.0.1',
    family: 'IPv4',
    port: server.port,
  });
});
