// Every Fairy-Stockfish .ini the server hands an engine must draw a quiet game
// on the same ply the kernel does. FSF's `nMoveRule` counts full moves and
// defaults to 50 (100 plies); an .ini that leaves it unset quietly adopts that.
// Duck Xiangqi did (#472): from ply 100 to 119 without a capture the engine
// believed the game was already drawn, scored every move 0, and could hang its
// general while the kernel played on to 120.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { ATOMIC_XIANGQI_RULES, DUCK_XIANGQI_PROGRESS_LIMIT } from '@mistboard/game';

// Resolved from the repo root: tests also run from dist/, where tsc copies no .ini.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const serverDir = resolve(repoRoot, 'apps/server/src');
const webEngineDir = resolve(repoRoot, 'apps/web/public/engine/fairy-stockfish');

function nMoveRule(path: string): number | null {
  const match = readFileSync(path, 'utf8').match(/^nMoveRule\s*=\s*(\d+)\s*$/m);
  return match ? Number(match[1]) : null;
}

// null = the kernel has no no-capture draw, so the rule must be off (0).
const KERNEL_PROGRESS_PLIES: Record<string, number | null> = {
  'duck-xiangqi.ini': DUCK_XIANGQI_PROGRESS_LIMIT,
  'atomic-xiangqi.ini': ATOMIC_XIANGQI_RULES.progressClock,
  // Fortress ends only on mate, stalemate and repetition.
  'fortress-xiangqi.ini': null,
  // crazyhouse-xiangqi.ini is the one exception: its kernel HAS a 60-ply clock,
  // but FSF resets its counter on every drop and the kernel only on a capture,
  // so no nMoveRule matches and it is off. Pinned, with the measurement, in
  // crazyhouse-xiangqi-ini.test.ts.
};

for (const [ini, plies] of Object.entries(KERNEL_PROGRESS_PLIES)) {
  test(`${ini} draws a quiet game on the kernel's ply`, () => {
    const expected = plies === null ? 0 : plies / 2;
    assert.equal(
      nMoveRule(resolve(serverDir, ini)),
      expected,
      `${ini} must set nMoveRule = ${expected} (FSF counts moves, the kernel plies; unset means 50)`,
    );
  });
}

test('the browser copy of fortress-xiangqi.ini keeps the same move rule', () => {
  assert.equal(
    nMoveRule(resolve(webEngineDir, 'fortress-xiangqi.ini')),
    nMoveRule(resolve(serverDir, 'fortress-xiangqi.ini')),
  );
});

// The browser analysis board's copy carries the server's stanza verbatim: the
// header may differ, the variant definition may not, or the analysis board and
// the bot play different games.
test('the browser copy of crazyhouse-xiangqi.ini is the server stanza verbatim', () => {
  const stanza = (path: string) => {
    const text = readFileSync(path, 'utf8');
    return text.slice(text.indexOf('['));
  };
  assert.equal(
    stanza(resolve(webEngineDir, 'crazyhouse-xiangqi.ini')),
    stanza(resolve(serverDir, 'crazyhouse-xiangqi.ini')),
  );
});
