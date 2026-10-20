import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_PLY_CAP,
  fixtureJsonl,
  fixtureRoomId,
  playRandomGame,
  VARIANTS,
} from './variant-postgame-fixtures.js';
import { createTenantRuntimeRoomFromEvents } from './variant-tenant/runtime.js';

// #401: two committed fixtures stopped matching their seeds after kernel changes
// and nobody noticed until a regeneration turned up a 600-line diff. Each
// committed file must be exactly what the current kernel plays from the seed in
// its room id, so the commit that moves a kernel also moves its fixture.
const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/variant-postgame');
const REGENERATE = 'npm run generate:variant-fixtures --workspace @mistboard/server';

// Fixtures a kernel change has already moved, with the change that moved them.
// The test asserts they still drift, so regenerating one fails here until its
// entry is deleted: the list can only shrink.
const AWAITING_REGENERATION: Record<string, string> = {
  'crazyhouse-xiangqi': 'd06dfd2fe (soldiers drop on any empty point) moved it at ply 61',
};

function committedSeed(roomId: string): number {
  const match = /sample_(\d+)$/.exec(roomId);
  assert.ok(match, `fixture room id ${roomId} does not carry a seed`);
  return Number.parseInt(match[1]!, 10);
}

test('every committed variant-postgame fixture has a generator entry', () => {
  const committed = readdirSync(FIXTURES)
    .filter((file) => file.endsWith('.jsonl'))
    .map((file) => file.replace(/\.jsonl$/, ''))
    .sort();
  const generated = VARIANTS.map((spec) => spec.tenant.gameSpecId as string).sort();
  assert.deepEqual(committed, generated);
});

for (const spec of VARIANTS) {
  const gameSpecId = spec.tenant.gameSpecId as string;

  test(`${gameSpecId} fixture is what the current kernel plays from its seed`, () => {
    const raw = readFileSync(resolve(FIXTURES, `${gameSpecId}.jsonl`), 'utf8');
    const lines = raw.split('\n').filter((line) => line.length > 0);
    const first = JSON.parse(lines[0]!) as { roomId: string };
    const seed = committedSeed(first.roomId);
    assert.equal(first.roomId, fixtureRoomId(spec, seed));

    const result = playRandomGame(spec, seed, DEFAULT_PLY_CAP);
    const regenerated = fixtureJsonl(result.events);
    const awaiting = AWAITING_REGENERATION[gameSpecId];
    if (awaiting) {
      assert.notEqual(
        regenerated,
        raw,
        `${gameSpecId}.jsonl reproduces again: delete its AWAITING_REGENERATION entry`,
      );
      return;
    }
    if (regenerated !== raw) {
      const fresh = regenerated.split('\n').filter((line) => line.length > 0);
      const diverges = fresh.findIndex((line, index) => line !== lines[index]);
      assert.fail(
        `${gameSpecId}.jsonl no longer reproduces from seed ${seed}: committed ${lines.length - 1} ` +
          `plies, the kernel now plays ${result.plies} (${result.status}); first difference at ` +
          `event ${diverges === -1 ? Math.min(fresh.length, lines.length) : diverges}. ` +
          `Run \`${REGENERATE}\` and commit the fixture with the rule change that moved it.`,
      );
    }

    // The committed log is a clean finished game the seeder can replay.
    assert.ok(result.finished, `${gameSpecId} seed ${seed} did not finish: ${result.status}`);
    const hydration = createTenantRuntimeRoomFromEvents(spec.tenant, result.events as never[]);
    assert.ok(hydration.ok, hydration.ok ? '' : hydration.error);
    assert.equal(hydration.room.projection.state.status.type, 'finished');
  });
}
