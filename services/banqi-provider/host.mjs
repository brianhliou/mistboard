import { rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { loadModel, modelPin } from './model.mjs';

export { loadModel } from './model.mjs';

import { randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createInitialBanqiState } from '@mistboard/game';
import {
  createBanqiUciProvider,
  readBanqiProviderBody,
} from '../../apps/server/src/banqi-provider.ts';
import { createBanqiProviderBridge } from '../../apps/server/src/banqi-provider-bridge.ts';
import {
  BANQI_PROVIDER_MAX_BYTES,
  BanqiProviderError,
  buildBanqiProviderRequest,
} from '../../apps/server/src/banqi-provider-protocol.ts';

const MAX_TURN_MS = 8000;
const UCI_NAME = `MistyBanqi ${modelPin()?.engineTag.slice(1) ?? '0.3.0'}`;
const BIN = '/opt/banqi/banqi-engine';
function validToken(token) {
  return (
    typeof token === 'string' &&
    token.length >= 16 &&
    token.length <= 512 &&
    !/[\r\n\0]/.test(token)
  );
}
function authorized(header, token) {
  const expected = Buffer.from(`Bearer ${token}`),
    actual = Buffer.from(header ?? '');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Separate external listener; its upstream is always this process's loopback bridge. */
export async function startHost({ provider, token, version, port = 8080, host = '0.0.0.0' }) {
  if (!validToken(token) || !/^[a-zA-Z0-9][a-zA-Z0-9_.:+-]{0,119}$/.test(version ?? ''))
    throw new Error('host-configuration');
  let stopping = false,
    failed = false,
    admitted = 0,
    healthInFlight;
  const guarded = {
    async turn(turn, signal) {
      if (turn.limits.deadlineUnixMs <= Date.now()) throw new BanqiProviderError('deadline');
      if (
        stopping ||
        failed ||
        turn.limits.deadlineUnixMs - turn.limits.requestedAtUnixMs > MAX_TURN_MS ||
        turn.limits.deadlineUnixMs - Date.now() > MAX_TURN_MS
      )
        throw new BanqiProviderError('invalid-request');
      try {
        return await provider.turn(turn, signal);
      } catch (error) {
        if (!['deadline', 'cancelled', 'invalid-request'].includes(error.code)) failed = true;
        throw error;
      }
    },
  };
  // No listener is exposed until the native handshake/model actually searches.
  await guarded.turn(
    buildBanqiProviderRequest({
      state: createInitialBanqiState('host-startup', undefined, {
        noProgressLimit: 60,
        chaseRule: 'repetition',
      }),
      requestId: randomUUID(),
      engineId: 'private-banqi-worker',
      nowMs: Date.now(),
      budgetMs: 3000,
      remainingMs: null,
      incrementMs: 0,
      nodes: 64,
    }),
  );
  const bridge = createBanqiProviderBridge(guarded, token, version);
  await new Promise((done, reject) => {
    bridge.once('error', reject);
    bridge.listen(0, '127.0.0.1', done);
  });
  const upstream = `http://127.0.0.1:${bridge.address().port}`;
  const controllers = new Set();
  async function healthy() {
    if (stopping || failed) return false;
    if (!healthInFlight)
      healthInFlight = (async () => {
        try {
          const res = await fetch(`${upstream}/health`, {
            headers: { authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(500),
            redirect: 'manual',
          });
          if (!res.ok) {
            await res.body?.cancel();
            return false;
          }
          const value = await readBanqiProviderBody(res);
          return value.protocol === 'mistboard-banqi/1' && value.engineVersion === version;
        } catch {
          return false;
        }
      })().finally(() => {
        healthInFlight = undefined;
      });
    return healthInFlight;
  }
  const server = createServer({ maxHeaderSize: 8192 }, async (req, res) => {
    const send = (status, body) => {
      if (!res.destroyed) {
        res.writeHead(status, {
          'content-type': 'application/json',
          'cache-control': 'no-store',
          connection: 'close',
        });
        res.end(JSON.stringify(body));
      }
    };
    if (req.method === 'GET' && req.url === '/readyz') {
      const ready = await healthy();
      send(ready ? 200 : 503, { status: ready ? 'ready' : 'unavailable' });
      return;
    }
    if (
      !(
        (req.method === 'POST' && req.url === '/turn') ||
        (req.method === 'GET' && req.url === '/health')
      )
    ) {
      send(404, { error: 'not-found' });
      return;
    }
    if (!authorized(req.headers.authorization, token)) {
      send(401, { error: 'unauthorized' });
      return;
    }
    if (stopping || failed) {
      send(503, { error: 'unavailable' });
      return;
    }
    if (req.url === '/health') {
      if (!(await healthy())) {
        send(503, { error: 'unavailable' });
        return;
      }
      send(200, { protocol: 'mistboard-banqi/1', engineVersion: version });
      return;
    }
    if (admitted >= 2) {
      send(429, { error: 'busy' });
      return;
    }
    if (!req.headers['content-type']?.startsWith('application/json')) {
      send(415, { error: 'invalid-request' });
      return;
    }
    if (Number(req.headers['content-length']) > BANQI_PROVIDER_MAX_BYTES) {
      send(413, { error: 'oversized' });
      return;
    }
    admitted++;
    const controller = new AbortController();
    controllers.add(controller);
    const disconnect = () => {
      if (!res.writableEnded) controller.abort();
    };
    req.once('aborted', disconnect);
    res.once('close', disconnect);
    let bodyTimer;
    try {
      const chunks = [];
      let size = 0;
      const body = new Promise((done, reject) => {
        bodyTimer = setTimeout(() => reject(new BanqiProviderError('deadline')), 1000);
        req.on('data', (chunk) => {
          size += chunk.length;
          if (size > BANQI_PROVIDER_MAX_BYTES) reject(new BanqiProviderError('oversized'));
          else chunks.push(chunk);
        });
        req.once('end', () => done(Buffer.concat(chunks)));
        req.once('error', () => reject(new BanqiProviderError('transport')));
        controller.signal.addEventListener(
          'abort',
          () => reject(new BanqiProviderError('cancelled')),
          { once: true },
        );
      });
      const payload = await body;
      clearTimeout(bodyTimer);
      const response = await fetch(`${upstream}/turn`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: payload,
        redirect: 'manual',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(MAX_TURN_MS + 500)]),
      });
      const value = await readBanqiProviderBody(response);
      send(response.status, value);
    } catch (error) {
      send(error.code === 'oversized' ? 413 : error.code === 'deadline' ? 504 : 502, {
        error: error instanceof BanqiProviderError ? error.code : 'transport',
      });
      // Bound slow/chunked request lifetime after sending the sanitized error.
      res.once('finish', () => {
        if (!req.complete) req.destroy();
      });
    } finally {
      clearTimeout(bodyTimer);
      controller.abort();
      controllers.delete(controller);
      req.off('aborted', disconnect);
      res.off('close', disconnect);
      admitted--;
    }
  });
  server.maxConnections = 64;
  server.headersTimeout = 5000;
  server.requestTimeout = 1000;
  server.keepAliveTimeout = 1000;
  try {
    await new Promise((done, reject) => {
      server.once('error', reject);
      server.listen(port, host, done);
    });
  } catch (error) {
    bridge.closeAllConnections();
    await new Promise((done) => bridge.close(done));
    throw error;
  }
  return {
    port: server.address().port,
    async close() {
      stopping = true;
      const deadline = setTimeout(() => {
        for (const controller of controllers) controller.abort();
        server.closeAllConnections();
        bridge.closeAllConnections();
      }, 9000);
      deadline.unref();
      try {
        await new Promise((done) => server.close(done));
        await new Promise((done) => bridge.close(done));
      } finally {
        clearTimeout(deadline);
      }
    },
  };
}

export function hostConfiguration(env = process.env, pin = modelPin()) {
  const port = Number(env.PORT ?? 8080),
    version = env.MISTBOARD_BANQI_TEST_PROVIDER_VERSION,
    token = env.MISTBOARD_BANQI_PROVIDER_TOKEN;
  if (
    !Number.isInteger(port) ||
    port < 1024 ||
    port > 65535 ||
    !/^MistyBanqi-0\.3\.0-[a-zA-Z0-9][a-zA-Z0-9_.:+-]{0,79}$/.test(version ?? '') ||
    !validToken(token)
  )
    throw new Error('host-configuration');
  if (pin && version !== `MistyBanqi-${pin.engineTag.slice(1)}-${pin.tag.replace(/^banqi-/, '')}`)
    throw new Error('host-configuration');
  return { port, version, token };
}
export function runtimeEnvironment(config, model, sha) {
  return {
    PATH: '/usr/bin:/bin',
    NODE_ENV: 'production',
    PORT: String(config.port),
    MISTBOARD_BANQI_PROVIDER_TOKEN: config.token,
    MISTBOARD_BANQI_TEST_PROVIDER_VERSION: config.version,
    MISTBOARD_BANQI_MODEL_PATH: model.path,
    MISTBOARD_BANQI_MODEL_SHA256: sha,
    ...(model.ownedDir ? { MISTBOARD_BANQI_MODEL_TEMP_DIR: model.ownedDir } : {}),
  };
}
let startupStage = 'configuration';
export async function main() {
  const config = hostConfiguration();
  if (process.argv[2] !== '--runtime') {
    startupStage = 'model';
    const model = await loadModel();
    try {
      if (typeof process.execve !== 'function') throw new Error('exec-boundary-unavailable');
      // Replace the bootstrap's Linux environment, including /proc/self/environ.
      // Deleting JS env keys alone would leave the original asset credential there.
      startupStage = 'exec';
      process.execve(
        process.execPath,
        [process.execPath, '--max-old-space-size=256', process.argv[1], '--runtime'],
        runtimeEnvironment(config, model, process.env.MISTBOARD_BANQI_MODEL_SHA256),
      );
      throw new Error('exec-boundary-failed');
    } catch (error) {
      await model.close();
      throw error;
    }
  }
  startupStage = 'runtime-environment';
  const allowed = new Set([
    'PATH',
    'NODE_ENV',
    'PORT',
    'MISTBOARD_BANQI_PROVIDER_TOKEN',
    'MISTBOARD_BANQI_TEST_PROVIDER_VERSION',
    'MISTBOARD_BANQI_MODEL_PATH',
    'MISTBOARD_BANQI_MODEL_SHA256',
    'MISTBOARD_BANQI_MODEL_TEMP_DIR',
    'UV_USE_IO_URING',
  ]);
  if (Object.keys(process.env).some((key) => !allowed.has(key)))
    throw new Error('runtime-environment');
  startupStage = 'runtime-model';
  const model = await loadModel();
  const owned = process.env.MISTBOARD_BANQI_MODEL_TEMP_DIR;
  if (owned && (!owned.startsWith('/tmp/banqi-model-') || dirname(model.path) !== owned))
    throw new Error('runtime-model-directory');
  const dispose = async () => {
    await model.close();
    if (owned) await rm(owned, { recursive: true, force: true });
  };
  process.env.MISTBOARD_BANQI_PROVIDER_MAX_CONCURRENT = '1';
  process.env.MISTBOARD_ENGINE_MAX_PROCESSES = '1';
  try {
    startupStage = 'native-startup';
    const provider = createBanqiUciProvider({
      bin: BIN,
      evalFile: model.path,
      expectedUciName: UCI_NAME,
      concurrency: 1,
    });
    const running = await startHost({ provider, ...config });
    console.log(JSON.stringify({ kind: 'banqi_host_ready', port: running.port }));
    const stop = () => {
      void running
        .close()
        .then(dispose)
        .then(
          () => process.exit(0),
          () => process.exit(1),
        );
    };
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
  } catch (error) {
    await dispose();
    throw error;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => {
    console.error(JSON.stringify({ kind: 'banqi_host_startup_failed', stage: startupStage }));
    process.exit(1);
  });
