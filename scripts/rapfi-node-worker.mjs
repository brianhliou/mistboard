// Run the unchanged classic browser worker; adapt only its asset I/O to Node.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { parentPort, workerData } from 'node:worker_threads';

const context = vm.createContext({
  require: createRequire(import.meta.url),
  process,
  console,
  performance,
  TextDecoder,
  TextEncoder,
  setTimeout,
  clearTimeout,
  URL,
  __dirname: workerData,
  __filename: join(workerData, 'rapfi-single-simd128.js'),
});
context.self = context;
context.location = pathToFileURL(join(workerData, 'worker.js'));
context.postMessage = (message) => parentPort.postMessage(message);
context.importScripts = (url) => {
  vm.runInContext(readFileSync(new URL(url), 'utf8'), context);
  const factory = context.Rapfi;
  context.Rapfi = (options) =>
    factory({
      ...options,
      // CLI arguments otherwise override the engine config and disable its NN.
      arguments: [],
      locateFile: (file) => fileURLToPath(options.locateFile(file)),
    });
};
vm.runInContext(readFileSync(join(workerData, 'worker.js'), 'utf8'), context);
parentPort.on('message', (data) => context.onmessage({ data }));
