import assert from 'node:assert/strict';
import test from 'node:test';
import { buildJunglePositionCommand, JUNGLE_RUST_TIER_LIST } from './jungle-engine.js';
import {
  isJungleEngineClientId,
  isJunglePlayableEngineClientId,
  JUNGLE_PLAYABLE_ENGINE_ID,
  JUNGLE_PLAYABLE_ENGINE_IDS,
  JUNGLE_RETIRED_ENGINE_IDS,
} from './server-jungle-engine.js';

test('Jungle position command carries semicolon-delimited repetition seeds', () => {
  const current = '7/7/7/7/7/7/7/7/R5e b 11 45';
  const seeds = ['7/7/7/7/7/7/7/7/R5e r 3 41', '7/7/7/7/7/7/7/7/1R4e b 4 41'];
  assert.equal(
    buildJunglePositionCommand(current, seeds),
    `position fen ${current} reps ${seeds.join(';')}`,
  );
  assert.equal(buildJunglePositionCommand(current), `position fen ${current}`);
});

// Jungle ships one bot, and it is meant to be the strongest one defined. A retired tier
// carrying a bigger node budget than the playable one would mean the bot players get is
// deliberately weaker than code that no longer serves anybody — the exact inversion the
// single-bot collapse was meant to remove.
test('the playable Jungle tier out-searches every retired one', () => {
  const playable = JUNGLE_RUST_TIER_LIST.find((tier) => tier.id === JUNGLE_PLAYABLE_ENGINE_ID);
  assert.ok(playable, `no Rust tier defined for the playable id ${JUNGLE_PLAYABLE_ENGINE_ID}`);
  for (const tier of JUNGLE_RUST_TIER_LIST) {
    if (tier.id === playable.id) continue;
    assert.ok(
      playable.nodes >= tier.nodes,
      `retired ${tier.id} (${tier.nodes} nodes) out-searches the playable ${playable.id} (${playable.nodes} nodes)`,
    );
  }
});

// The two predicates must NOT agree. Create-time admits one id; the runtime recognises
// every id ever seated, because finished games persist theirs. If a refactor collapses
// them, one of two silent failures follows: retired ids become creatable again, or old
// PvE games stop being recognised as PvE (their engine seat reads as a human).
test('retired Jungle engine ids stay recognisable but are not creatable', () => {
  assert.ok(isJunglePlayableEngineClientId(JUNGLE_PLAYABLE_ENGINE_ID));
  assert.ok(isJungleEngineClientId(JUNGLE_PLAYABLE_ENGINE_ID));
  assert.ok(JUNGLE_RETIRED_ENGINE_IDS.length > 0);
  for (const id of JUNGLE_RETIRED_ENGINE_IDS) {
    assert.equal(isJunglePlayableEngineClientId(id), false, `${id} must not be creatable`);
    assert.equal(isJungleEngineClientId(id), true, `${id} must still read as an engine seat`);
  }
  assert.equal(isJunglePlayableEngineClientId('misty-jungle-level-9'), false);
  assert.equal(isJungleEngineClientId('misty-jungle-level-9'), false);

  // Every defined tier is accounted for as either the bot or a retirement. A tier that
  // is neither is an id the runtime honours but nothing describes — the state this
  // whole split exists to keep out of the codebase.
  const accounted = new Set([...JUNGLE_PLAYABLE_ENGINE_IDS, ...JUNGLE_RETIRED_ENGINE_IDS]);
  for (const tier of JUNGLE_RUST_TIER_LIST) {
    assert.ok(accounted.has(tier.id), `${tier.id} is neither the playable bot nor retired`);
  }
});
