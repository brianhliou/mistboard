/**
 * Every variant that offers PvE in production must have a prod smoke that asks
 * its engine for a move.
 *
 * This exists because the list was silently incomplete. On 2026-09-02 the jieqi
 * live engine stopped answering and resigned six real games in four minutes;
 * the release gate had smoked fog chess, fortress, DXQ and DMX, and had never
 * once asked the jieqi bot for a move. The gap was invisible because nothing
 * compared the smoke roster against the bot roster.
 *
 * `first-party-bots.ts` is the source of truth for which specs have an engine
 * behind them, so a new PvE variant fails this test until it either gets a
 * smoke or is written into EXEMPT with a reason.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { FIRST_PARTY_BOT_PROFILES } from '../apps/server/src/first-party-bots.js';
import { VARIANT_SMOKE_CONFIGS } from './lib/variant-smoke-configs.mjs';

/** Specs with a first-party engine but deliberately no variant smoke. */
const EXEMPT: Readonly<Record<string, string>> = {
  // Covered by prod:smoke:engines, which plays the fog-chess engine directly.
  'dark-chess': 'prod:smoke:engines',
  // Same engine and same code path as dark-chess; Draft960 is a pregame option
  // inside Fog of War, not a separate surface.
  'dark-draft960': 'prod:smoke:engines (same engine and path as dark-chess)',
  // Flag-gated and not live in production; /api/bots offers it no PvE.
  'crossroads-chess': 'flag-gated, no PvE offered in production',
  // Retired under #306: puzzles are live, games 501.
  'drop-mini-xiangqi': 'retired (#306), games 501',
  'mini-xiangqi': 'reserved in the gate, never built; every request 501s (#306)',
};

function pveGameSpecIds(): string[] {
  const specs = new Set<string>();
  for (const bot of FIRST_PARTY_BOT_PROFILES) {
    for (const spec of Object.keys(bot.engines)) specs.add(spec);
  }
  return [...specs].sort();
}

function smokedGameSpecIds(): Set<string> {
  return new Set(Object.values(VARIANT_SMOKE_CONFIGS).map((config) => config.gameSpecId));
}

test('the bot roster is readable and non-trivial', () => {
  // Guards the assertion below: an import that silently yielded nothing would
  // make the coverage test pass by measuring an empty set.
  const specs = pveGameSpecIds();
  assert.ok(specs.length >= 9, `expected the PvE roster, got ${specs.length}: ${specs.join(', ')}`);
  assert.ok(specs.includes('jieqi'), 'jieqi should be in the PvE roster');
  assert.ok(smokedGameSpecIds().size >= 5, 'expected the variant smoke configs to load');
});

test('every PvE variant has a prod smoke, or a written reason it does not', () => {
  const smoked = smokedGameSpecIds();
  const uncovered = pveGameSpecIds().filter((spec) => !smoked.has(spec) && !(spec in EXEMPT));
  assert.deepEqual(
    uncovered,
    [],
    `PvE variants with no prod smoke: ${uncovered.join(', ')}. Add a config row to ` +
      'scripts/lib/variant-smoke-configs.mjs and a row to the release smoke list in ' +
      'scripts/release-prod.mjs, or add it to EXEMPT here with the reason.',
  );
});

test('every smoked variant is wired into the release gate', async () => {
  const { readFile } = await import('node:fs/promises');
  const releaseSource = await readFile(new URL('./release-prod.mjs', import.meta.url), 'utf8');
  // A config row that no release row invokes is coverage that never runs — the
  // exact shape of the original gap, one level down.
  for (const config of Object.values(VARIANT_SMOKE_CONFIGS)) {
    assert.ok(
      releaseSource.includes(`'prod:smoke:${config.name}'`),
      `prod:smoke:${config.name} is configured but not run by the release smoke tier`,
    );
  }
});

test('EXEMPT does not drift: every exemption still names a real PvE spec', () => {
  const specs = new Set(pveGameSpecIds());
  const stale = Object.keys(EXEMPT).filter((spec) => !specs.has(spec));
  assert.deepEqual(
    stale,
    [],
    `EXEMPT lists specs that no longer have an engine: ${stale.join(', ')}`,
  );
});
