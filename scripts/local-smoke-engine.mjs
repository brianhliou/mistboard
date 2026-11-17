import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { basename } from 'node:path';

// Only an explicit ENOENT for an absent executable authorizes a worker skip.
// Missing models, imports, timeouts and search failures must fail the stage.
export function missingWorkerBinary(error, exists = existsSync) {
  const message = error.message ?? String(error);
  const path =
    /No such file or directory: ['"](\/[^'"\n]+)['"]/.exec(message)?.[1] ??
    /spawn (\/[^\n]+) ENOENT/.exec(message)?.[1];
  if (
    !path ||
    !/^(?:pikafish|stockfish|python(?:\d+(?:\.\d+)?)?)$/.test(basename(path)) ||
    exists(path)
  ) {
    return null;
  }
  return { variant: 'dark-xiangqi', binary: path };
}

export async function startSmokeEngine() {
  const { getPythonPool, disposeAllPythonPools } = await import(
    '../apps/server/dist/python-pool.js'
  );
  const { DARK_XIANGQI_DEFAULT_ENGINE_ID } = await import('../apps/server/dist/engine-registry.js');
  try {
    // The actual worker performs its real native warmup through the public
    // engine protocol. A healthy HTTP listener alone does not prove readiness.
    await getPythonPool(DARK_XIANGQI_DEFAULT_ENGINE_ID, { defaultSize: 1 });
    const { startEngineHttpService } = await import('../apps/server/dist/engine-service.js');
    const token = randomUUID();
    const service = await startEngineHttpService({
      host: '127.0.0.1',
      port: 0,
      poolSize: 1,
      token,
    });
    return {
      missing: [],
      env: {
        MISTBOARD_INTERNAL_ENGINE_URL: `http://127.0.0.1:${service.port}`,
        MISTBOARD_INTERNAL_ENGINE_TOKEN: token,
      },
      async dispose() {
        try {
          await service.close();
        } finally {
          disposeAllPythonPools();
        }
      },
    };
  } catch (error) {
    disposeAllPythonPools();
    const missing = missingWorkerBinary(error);
    if (!missing) throw error;
    return {
      missing: [missing],
      env: { MISTBOARD_INTERNAL_ENGINE_URL: '', MISTBOARD_INTERNAL_ENGINE_TOKEN: '' },
      async dispose() {},
    };
  }
}
