import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import net from 'node:net';
import test from 'node:test';
import { checkLoopback } from './lib/loopback-check.mjs';

// Socket doubles let the timeout and cleanup paths run without changing VPN
// state or requiring network access in an agent sandbox.
function sockets(t, { listenError, connectError, silent = false } = {}) {
  const server = new EventEmitter();
  const client = new EventEmitter();
  const accepted = new EventEmitter();
  server.address = () => ({ port: 12345 });
  server.close = t.mock.fn();
  client.destroy = t.mock.fn();
  accepted.destroy = t.mock.fn();
  accepted.end = t.mock.fn();
  server.listen = t.mock.fn((_port, _host, onListen) => {
    queueMicrotask(() => {
      if (listenError) server.emit('error', listenError);
      else onListen();
    });
  });
  const createServer = t.mock.method(net, 'createServer', (onConnection) => {
    server.onConnection = onConnection;
    return server;
  });
  const connect = t.mock.method(net, 'createConnection', () => {
    queueMicrotask(() => {
      if (connectError) client.emit('error', connectError);
      else if (!silent) {
        server.onConnection(accepted);
        client.emit('data', Buffer.from('ok'));
      }
    });
    return client;
  });
  return { server, client, accepted, createServer, connect };
}

test('loopback preflight uses IPv4 on both ends and cleans up after success', async (t) => {
  const { server, client, accepted, connect } = sockets(t);
  await checkLoopback();
  assert.deepEqual(server.listen.mock.calls[0].arguments.slice(0, 2), [0, '127.0.0.1']);
  assert.deepEqual(connect.mock.calls[0].arguments, [{ port: 12345, host: '127.0.0.1' }]);
  assert.equal(client.destroy.mock.callCount(), 1);
  assert.equal(accepted.destroy.mock.callCount(), 1);
  assert.equal(server.close.mock.callCount(), 1);
});

test('loopback preflight reports bind failures before starting a client', async (t) => {
  const { server, connect } = sockets(t, { listenError: new Error('EPERM') });
  await assert.rejects(checkLoopback(), /loopback unreachable: 127\.0\.0\.1.*EPERM/);
  assert.equal(connect.mock.callCount(), 0);
  assert.equal(server.close.mock.callCount(), 1);
});

test('loopback preflight reports connection errors and closes both ends', async (t) => {
  const { server, client } = sockets(t, { connectError: new Error('ECONNREFUSED') });
  await assert.rejects(checkLoopback(), /loopback unreachable: 127\.0\.0\.1.*ECONNREFUSED/);
  assert.equal(client.destroy.mock.callCount(), 1);
  assert.equal(server.close.mock.callCount(), 1);
});

test('loopback preflight bounds a stalled connection instead of hanging the suite', async (t) => {
  const { server, client } = sockets(t, { silent: true });
  await assert.rejects(checkLoopback({ timeoutMs: 10 }), /loopback unreachable:.*timed out/);
  assert.equal(client.destroy.mock.callCount(), 1);
  assert.equal(server.close.mock.callCount(), 1);
  // A late event must not repeat cleanup or leave an unhandled error.
  client.emit('error', new Error('late socket error'));
  assert.equal(server.close.mock.callCount(), 1);
});
