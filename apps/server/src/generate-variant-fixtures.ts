// Random self-play fixture generator for every variant tenant.
//
// Writes one committed JSONL event log per tenant (the self-play core lives in
// variant-postgame-fixtures.ts). These double as postgame-review sample data
// (feed the dev /postgame-sheet via seed-variant-fixtures.ts) and as
// deterministic multi-variant test fixtures. variant-postgame-fixtures.test.ts
// fails when a kernel change moves a committed fixture: rerun this and commit
// the result with the change that moved it.
//
//   tsx src/generate-variant-fixtures.ts [--seed 7] [--max-plies 400] [--out <dir>]
//
// Deterministic: same seed -> byte-identical output. No network, no DB.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import {
  DEFAULT_BASE_SEED,
  DEFAULT_PLY_CAP,
  findFinishedGame,
  fixtureJsonl,
  VARIANTS,
} from './variant-postgame-fixtures.js';
import { createTenantRuntimeRoomFromEvents } from './variant-tenant/runtime.js';

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      seed: { type: 'string', default: String(DEFAULT_BASE_SEED) },
      'max-plies': { type: 'string', default: String(DEFAULT_PLY_CAP) },
      out: { type: 'string', default: 'fixtures/variant-postgame' },
    },
  });
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const baseSeed = Number.parseInt(values.seed, 10);
  const plyCap = Number.parseInt(values['max-plies'], 10);
  const outDir = resolve(repoRoot, 'apps/server', values.out);
  await mkdir(outDir, { recursive: true });

  console.log(`generating ${VARIANTS.length} variant fixtures -> ${relative(repoRoot, outDir)}`);
  let failures = 0;
  for (const spec of VARIANTS) {
    const gameSpecId = spec.tenant.gameSpecId as string;
    const { result, seed } = findFinishedGame(spec, baseSeed, plyCap);

    // Self-verify: the emitted log must replay back through the tenant to the
    // same terminal state. Catches a wrong enumerator / illegal move immediately.
    const hydration = createTenantRuntimeRoomFromEvents(spec.tenant, result.events as never[]);
    const replayOk =
      hydration.ok &&
      (!result.finished || hydration.room.projection.state.status.type === 'finished');

    const filePath = join(outDir, `${gameSpecId}.jsonl`);
    await writeFile(filePath, fixtureJsonl(result.events));

    const flag = result.finished && replayOk ? 'ok' : 'WARN';
    if (flag === 'WARN') failures += 1;
    console.log(
      `  ${flag.padEnd(4)} ${gameSpecId.padEnd(22)} seed=${seed} plies=${result.plies} ${result.status}` +
        (hydration.ok ? '' : ` [replay: ${hydration.error}]`),
    );
  }
  if (failures > 0) {
    console.error(`\n${failures} variant(s) did not produce a clean finished+replayable game.`);
    process.exit(1);
  }
  console.log('\nall variants generated + self-verified.');
}

void main();
