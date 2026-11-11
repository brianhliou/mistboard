// Local-only provider smoke/bridge. Run through npm so tsx loads the TS kit.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { createInitialBanqiState } from '@mistboard/game';
import {
  createBanqiHttpProvider,
  createBanqiUciProvider,
} from '../apps/server/src/banqi-provider.ts';
import { createBanqiProviderBridge } from '../apps/server/src/banqi-provider-bridge.ts';
import { buildBanqiProviderRequest } from '../apps/server/src/banqi-provider-protocol.ts';

function option(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

const mode = process.argv[2];
const bin = option('--bin');
if (!bin || !['probe', 'bridge'].includes(mode)) {
  console.error(
    'Usage: npm run engine:banqi-provider -- probe|bridge --bin /absolute/path/to/engine [--eval-file /absolute/path/to/model] [--port 3217]',
  );
  process.exit(2);
}
const evalFile = option('--eval-file');
const expectedUciName = option('--uci-name');
const engineVersion = option('--version');
const provider = createBanqiUciProvider({
  bin: resolve(bin),
  ...(expectedUciName ? { expectedUciName } : {}),
  ...(evalFile ? { evalFile: resolve(evalFile) } : {}),
});

if (mode === 'bridge') {
  const token = process.env.MISTBOARD_BANQI_PROVIDER_TOKEN;
  if (!token) {
    console.error('Set MISTBOARD_BANQI_PROVIDER_TOKEN in the operator environment.');
    process.exit(2);
  }
  const port = Number(option('--port') ?? 3217);
  if (!Number.isInteger(port) || (port !== 0 && port < 1024) || port > 65535)
    throw new Error('Invalid local port');
  if (
    !engineVersion ||
    !expectedUciName ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_.:+-]{0,119}$/.test(engineVersion)
  )
    throw new Error('Bridge requires --version and --uci-name');
  // Startup canary verifies the pinned handshake and model before declaring health.
  await provider.turn(
    buildBanqiProviderRequest({
      state: createInitialBanqiState('worker-startup', undefined, {
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
  const server = createBanqiProviderBridge(provider, token, engineVersion);
  server.listen(port, '127.0.0.1', () => {
    const actual = server.address().port;
    console.log(`Local Banqi bridge listening on port ${actual}`);
    process.send?.({ ready: true, port: actual });
  });
  const shutdown = () => {
    server.close(() => process.exit(0));
    const deadline = setTimeout(() => {
      server.closeAllConnections();
      process.exit(1);
    }, 9000);
    deadline.unref();
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'disconnect']) process.once(signal, shutdown);
} else {
  // The probe generates its own ephemeral credential; it is never printed.
  const token = randomUUID();
  const server = createBanqiProviderBridge(provider, token);
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  try {
    const address = server.address();
    const remote = createBanqiHttpProvider({
      endpoint: `http://127.0.0.1:${address.port}/turn`,
      token,
      allowLocalhostHttp: true,
    });
    const request = () =>
      buildBanqiProviderRequest({
        state: createInitialBanqiState('provider-probe', undefined, {
          noProgressLimit: 60,
          chaseRule: 'repetition',
        }),
        requestId: randomUUID(),
        engineId: 'operator-test',
        nowMs: Date.now(),
        budgetMs: 3000,
        remainingMs: 300_000,
        incrementMs: 5_000,
        nodes: 64,
      });
    const firstRequest = request();
    const direct = await provider.turn(firstRequest);
    const remoteRequest = request();
    const bridged = await remote.turn(remoteRequest);
    assert.ok(firstRequest.legalMoves.includes(direct.move));
    assert.ok(remoteRequest.legalMoves.includes(bridged.move));
    console.log(
      JSON.stringify({
        protocol: direct.protocol,
        direct: { move: direct.move, analysis: direct.analysis ?? null },
        bridge: { move: bridged.move, analysis: bridged.analysis ?? null },
        legal: true,
      }),
    );
  } finally {
    server.closeAllConnections();
    await new Promise((done, reject) => server.close((error) => (error ? reject(error) : done())));
  }
}
