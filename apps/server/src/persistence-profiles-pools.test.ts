import assert from 'node:assert/strict';
import test from 'node:test';
import { GAME_SPECS, ratingPoolForSpec } from '@mistboard/game';
import { GAME_VARIANTS_BY_RATING_POOL } from './persistence-profiles.js';

// The profile rail counts a player's games per rating pool with a SQL CASE built
// from GAME_VARIANTS_BY_RATING_POOL. A rated spec whose stored variant is not
// listed under its own pool counts as Fog Chess (the CASE's default).
test('every rated spec counts its profile games in its own pool', () => {
  for (const spec of GAME_SPECS) {
    const pool = spec.rated ? ratingPoolForSpec(spec.id) : null;
    if (!pool) continue;
    const variants: readonly string[] = GAME_VARIANTS_BY_RATING_POOL[pool];
    assert.ok(variants.includes(spec.id), `${spec.id}: not counted in pool ${pool}`);
  }
  assert.deepEqual(GAME_VARIANTS_BY_RATING_POOL.xiangqi_mahjong, ['xiangqi-mahjong']);
});

test('no stored variant is counted in two pools', () => {
  const seen = new Map<string, string>();
  for (const [pool, variants] of Object.entries(GAME_VARIANTS_BY_RATING_POOL)) {
    for (const variant of variants) {
      assert.equal(seen.get(variant), undefined, `${variant}: in ${seen.get(variant)} and ${pool}`);
      seen.set(variant, pool);
    }
  }
});
