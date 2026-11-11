// Where the patched xiangqi Pikafish and its CC0 net live, for the server and
// for the offline scripts alike (#989). Node built-ins only, so a plain
// `node scripts/x.mjs` can import this source file directly (Node strips the
// types) without a server build or the engine harness it would pull in.
//
// The build is upstream Pikafish at the pikafish.ref pin with
// pikafish-cc0-net.patch applied; it reads only the Fairy-Stockfish CC0 net.
// There is deliberately no fallback to the January 2026 official release or the
// unpatched pin build: those use a different net and a different cp scale.

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Source pin, applied patch sha256 prefix and net identity from the engine recipe.
// bot-engine-versions.test.ts checks them against the actual build inputs.
export const PIKAFISH_XIANGQI_REF = '6a59ee2f';
export const PIKAFISH_XIANGQI_NNUE_NET = 'xiangqi-c07e94a5c7cb.nnue';
// scripts/engine-assets.sh PIKAFISH_NET_SHA256; scripts/xiangqi-pikafish-offline.test.mjs
// keeps the two equal.
export const PIKAFISH_XIANGQI_NNUE_SHA256 =
  'c07e94a5c7cbeae443ed79a8fa412875d833a7f8e04333815e39729c59d52e11';
export const PIKAFISH_XIANGQI_VERSION = `${PIKAFISH_XIANGQI_REF} · cc0-790609318c02 · ${PIKAFISH_XIANGQI_NNUE_NET.replace(/\.nnue$/, '')}`;

// The local patched checkout: ~/projects/tools/pikafish-<pin>-cc0 (git HEAD at
// the pin, the patch applied, `src/pikafish` built, the CC0 net beside it).
export function pikafishXiangqiDevSourceDir(home: string): string {
  return resolve(home, 'projects', 'tools', `pikafish-${PIKAFISH_XIANGQI_REF}-cc0`);
}

// Resolve the patched Pikafish binary: explicit env override, else the known dev
// location, else the prod (railpack-baked) / system locations. Throws rather than
// silently falling back to a first-legal move or another build.
export function pikafishXiangqiPath(): string {
  const explicit = process.env.MISTBOARD_PIKAFISH_XIANGQI_PATH;
  if (explicit) {
    const resolved = resolve(explicit);
    if (!existsSync(resolved)) {
      throw new Error(
        `MISTBOARD_PIKAFISH_XIANGQI_PATH points at ${resolved} but the binary does not exist`,
      );
    }
    return resolved;
  }
  const home = process.env.HOME;
  if (home) {
    const dev = resolve(pikafishXiangqiDevSourceDir(home), 'src', 'pikafish');
    if (existsSync(dev)) return dev;
  }
  for (const candidate of [
    resolve(process.cwd(), 'bin', 'pikafish'),
    '/app/bin/pikafish',
    '/usr/local/bin/pikafish',
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    'Patched Pikafish (xiangqi) binary not found. Set MISTBOARD_PIKAFISH_XIANGQI_PATH.',
  );
}

// Resolve the CC0 net (absolute EvalFile): explicit override, else the pinned
// filename beside the binary or one directory up. No upstream-net fallback.
export function pikafishXiangqiNetPath(binPath: string): string {
  const explicit = process.env.MISTBOARD_PIKAFISH_XIANGQI_NET;
  if (explicit) {
    const resolved = resolve(explicit);
    if (!existsSync(resolved)) {
      throw new Error(
        `MISTBOARD_PIKAFISH_XIANGQI_NET points at ${resolved} but the file does not exist`,
      );
    }
    return resolved;
  }
  const binDir = dirname(binPath);
  for (const candidate of [
    resolve(binDir, PIKAFISH_XIANGQI_NNUE_NET),
    resolve(binDir, '..', PIKAFISH_XIANGQI_NNUE_NET),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `Pikafish CC0 NNUE net (${PIKAFISH_XIANGQI_NNUE_NET}) not found beside the binary. Set MISTBOARD_PIKAFISH_XIANGQI_NET.`,
  );
}
