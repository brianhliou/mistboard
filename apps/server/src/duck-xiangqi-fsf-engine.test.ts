// The Duck Xiangqi engine ladder: tier resolution, the shape of the rungs, and
// the binary resolver's refusal to fall back to stock Fairy-Stockfish.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DUCK_XIANGQI_DEFAULT_ENGINE_ID,
  DUCK_XIANGQI_FSF_ENGINE_VERSION,
  DUCK_XIANGQI_PLAYABLE_ENGINES,
  duckXiangqiEngineDisplayName,
  duckXiangqiEngineTierFor,
  duckXiangqiEngineVersion,
  duckXiangqiFsfPath,
  duckXiangqiVariantIniPath,
  isDuckXiangqiEngineClientId,
} from './duck-xiangqi-fsf-engine.js';

test('every playable rung resolves to itself, and nothing else resolves', () => {
  assert.equal(DUCK_XIANGQI_PLAYABLE_ENGINES.length, 8);
  for (const tier of DUCK_XIANGQI_PLAYABLE_ENGINES) {
    assert.equal(duckXiangqiEngineTierFor(tier.id), tier, tier.id);
    assert.equal(isDuckXiangqiEngineClientId(tier.id), true, tier.id);
    assert.equal(duckXiangqiEngineDisplayName(tier.id), tier.name, tier.id);
    assert.equal(duckXiangqiEngineVersion(tier.id), DUCK_XIANGQI_FSF_ENGINE_VERSION, tier.id);
  }

  // Fail-closed: a neighbouring variant's engine id must never resolve here, or
  // a Duck room would seat an engine that cannot play the game.
  for (const stranger of [
    undefined,
    '',
    'fairy-stockfish-fortress-xiangqi-level-4',
    'fairy-stockfish-xiangqi-level-8',
    'fairy-stockfish-duck-xiangqi-level-9',
    'fairy-stockfish-duck-xiangqi',
    'pikafish-xiangqi-level-8',
  ]) {
    assert.equal(duckXiangqiEngineTierFor(stranger), null, String(stranger));
    assert.equal(isDuckXiangqiEngineClientId(stranger), false, String(stranger));
    assert.equal(duckXiangqiEngineVersion(stranger), null, String(stranger));
  }
  // An unknown id still prints as something rather than throwing on a live page.
  assert.equal(duckXiangqiEngineDisplayName('mystery-engine'), 'mystery-engine');
});

test('the default rung is a playable one', () => {
  const tier = duckXiangqiEngineTierFor(DUCK_XIANGQI_DEFAULT_ENGINE_ID);
  assert.ok(tier, 'the default engine id must resolve');
  assert.ok(
    DUCK_XIANGQI_PLAYABLE_ENGINES.includes(tier),
    'the default engine id must be offered in the picker',
  );
});

test('the ladder is monotonic and every rung is node-anchored', () => {
  DUCK_XIANGQI_PLAYABLE_ENGINES.forEach((tier, index) => {
    const level = index + 1;
    assert.equal(tier.id, `fairy-stockfish-duck-xiangqi-level-${level}`);
    assert.equal(tier.name, `Fairy-Stockfish Level ${level}`);
    // A movetime-only rung would take its strength from whatever the deploy box
    // delivers that day; the node budget is the CPU-independent anchor.
    assert.ok(tier.nodes > 0, `${tier.id}: no node budget`);
    assert.ok(tier.movetimeMs > 0, `${tier.id}: no movetime ceiling`);
    assert.ok(tier.skill >= -20 && tier.skill <= 20, `${tier.id}: skill out of UCI range`);
    if (index === 0) return;
    const below = DUCK_XIANGQI_PLAYABLE_ENGINES[index - 1]!;
    assert.ok(tier.skill > below.skill, `${tier.id}: skill does not exceed the rung below`);
    assert.ok(tier.nodes > below.nodes, `${tier.id}: nodes do not exceed the rung below`);
    assert.ok(
      tier.movetimeMs >= below.movetimeMs,
      `${tier.id}: ceiling falls below the rung below`,
    );
  });
  // The top rung is measured, not aspirational: ~300k nodes is ~2.1 s on a
  // laptop and an estimated ~5 s on prod's vCPU, so the ceiling is what keeps a
  // bullet-paced game solvent rather than what sets the strength.
  const top = DUCK_XIANGQI_PLAYABLE_ENGINES[DUCK_XIANGQI_PLAYABLE_ENGINES.length - 1]!;
  assert.equal(top.skill, 20);
  assert.ok(top.movetimeMs >= 6_000, 'the top rung needs room for its node budget to bind');
});

test('the variant ini resolves and is the duck one', () => {
  assert.match(duckXiangqiVariantIniPath(), /duck-xiangqi\.ini$/);
});

test('the binary resolver refuses to fall back to stock Fairy-Stockfish', () => {
  const saved = process.env.MISTBOARD_FSF_DUCK_XIANGQI_PATH;
  const savedShared = process.env.MISTBOARD_FSF_PATH;
  try {
    // An env override that names a file which is not there is an error, never a
    // quiet fallback.
    process.env.MISTBOARD_FSF_DUCK_XIANGQI_PATH = '/nonexistent/fairy-stockfish-duck-xiangqi';
    assert.throws(() => duckXiangqiFsfPath(), /does not exist/);

    // And with no duck binary anywhere, it throws rather than resolving the
    // shared FSF build: that binary compiles MAX_MOVES = 1024 against this
    // variant's 4,901-turn peak, so "fall back" means stack-smash, not "weaker".
    delete process.env.MISTBOARD_FSF_DUCK_XIANGQI_PATH;
    process.env.MISTBOARD_FSF_PATH = '/nonexistent/fairy-stockfish';
    try {
      const resolved = duckXiangqiFsfPath();
      // A real duck binary is present on this box (a dev checkout, or CI after
      // the railpack build): then it must be the duck one, never the shared one.
      assert.match(resolved, /fairy-stockfish-duck-xiangqi$/);
    } catch (error) {
      assert.match((error as Error).message, /NOT a substitute/);
    }
  } finally {
    if (saved === undefined) delete process.env.MISTBOARD_FSF_DUCK_XIANGQI_PATH;
    else process.env.MISTBOARD_FSF_DUCK_XIANGQI_PATH = saved;
    if (savedShared === undefined) delete process.env.MISTBOARD_FSF_PATH;
    else process.env.MISTBOARD_FSF_PATH = savedShared;
  }
});
