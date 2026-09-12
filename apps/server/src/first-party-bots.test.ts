import assert from 'node:assert/strict';
import test from 'node:test';
import { DUCK_XIANGQI_PLAYABLE_ENGINES } from './duck-xiangqi-fsf-engine.js';
import {
  FIRST_PARTY_BOT_PROFILES,
  firstPartyBotEngineFor,
  firstPartyBotForEngine,
  firstPartyBotForId,
} from './first-party-bots.js';
import { FORTRESS_XIANGQI_PLAYABLE_ENGINES } from './fortress-xiangqi-fsf-engine.js';
import { XIANGQI_PLAYABLE_ENGINES } from './xiangqi-engine-catalog.js';

test('the merged Misty identity fronts every house variant', () => {
  const misty = firstPartyBotForId('misty');
  assert.ok(misty);
  assert.equal(misty.displayName, 'Misty');
  assert.equal(firstPartyBotEngineFor('misty', 'dark-chess'), 'python-v2-v1.6');
  assert.equal(firstPartyBotEngineFor('misty', 'dark-xiangqi'), 'python-fdx-v1.2');
  assert.equal(firstPartyBotEngineFor('misty', 'banqi'), 'misty-banqi');
  assert.equal(firstPartyBotEngineFor('misty', 'jungle'), 'misty-jungle-level-2');
  assert.equal(firstPartyBotEngineFor('misty', 'jungle-flip'), 'misty-jungle-flip');
  // A variant Misty does not play resolves to null, never a guess.
  assert.equal(firstPartyBotEngineFor('misty', 'xiangqi'), null);

  // Pre-consolidation bot ids and retired engine versions keep resolving.
  for (const legacyId of ['misty-dark-chess', 'misty-dmx', 'misty-banqi']) {
    assert.equal(firstPartyBotForId(legacyId)?.id, 'misty', legacyId);
  }
  for (const engineId of [
    'python-v2-v1.0',
    'python-dmx-v1.0',
    // Superseded fog-xiangqi builds. Every finished dxq game was played on one
    // of these, so dropping either would strand its record on the bot profile.
    'python-fdx-v1.0',
    'python-fdx-v1.1',
    'misty-jungle-level-1',
    'misty-jungle-level-3',
  ]) {
    assert.equal(firstPartyBotForEngine(engineId)?.id, 'misty', engineId);
  }
});

test('the merged Pikafish identity fronts xiangqi and jieqi', () => {
  assert.equal(firstPartyBotEngineFor('pikafish', 'xiangqi'), 'pikafish-xiangqi-level-8');
  assert.equal(firstPartyBotEngineFor('pikafish', 'jieqi'), 'pikafish-jieqi-strongest');

  // Every retired Pikafish bot id and engine id lands on the merged identity.
  for (const legacyId of [
    'pika-jieqi',
    'pika-jieqi-amateur',
    'pika-jieqi-strongest',
    'pikafish-xiangqi',
    'pikafish-xiangqi-amateur',
    'pikafish-xiangqi-strongest',
    'pikafish-xiangqi-level-3',
  ]) {
    assert.equal(firstPartyBotForId(legacyId)?.id, 'pikafish', legacyId);
  }
  for (const engineId of [
    'pikafish-jieqi-amateur',
    'pikafish-jieqi-strongest',
    'pikafish-xiangqi-level-1',
    'pikafish-xiangqi-strongest',
  ]) {
    assert.equal(firstPartyBotForEngine(engineId)?.id, 'pikafish', engineId);
  }
});

test('each Fairy-Stockfish level plays xiangqi, fortress and duck through one identity', () => {
  for (let level = 1; level <= 8; level += 1) {
    const botId = `fairy-stockfish-level-${level}`;
    const bot = firstPartyBotForId(botId);
    assert.ok(bot, botId);
    assert.equal(bot.displayName, `Fairy-Stockfish Level ${level}`);
    assert.equal(
      firstPartyBotEngineFor(botId, 'xiangqi'),
      `fairy-stockfish-xiangqi-level-${level}`,
    );
    assert.equal(
      firstPartyBotEngineFor(botId, 'fortress-xiangqi'),
      `fairy-stockfish-fortress-xiangqi-level-${level}`,
    );
    assert.equal(
      firstPartyBotEngineFor(botId, 'duck-xiangqi'),
      `fairy-stockfish-duck-xiangqi-level-${level}`,
    );
    // The old per-variant bot id keeps resolving.
    assert.equal(firstPartyBotForId(`fairy-stockfish-xiangqi-level-${level}`)?.id, botId);
  }
  // The retired fortress tiers absorbed by ordinal position.
  assert.equal(
    firstPartyBotForId('fairy-stockfish-fortress-xiangqi-amateur')?.id,
    'fairy-stockfish-level-2',
  );
  assert.equal(
    firstPartyBotForId('fairy-stockfish-fortress-xiangqi')?.id,
    'fairy-stockfish-level-5',
  );
  assert.equal(
    firstPartyBotForEngine('fairy-stockfish-fortress-xiangqi-very-strong')?.id,
    'fairy-stockfish-level-8',
  );
});

test('every public xiangqi, fortress and duck engine resolves to a first-party bot', () => {
  for (const tier of XIANGQI_PLAYABLE_ENGINES) {
    const bot = firstPartyBotForEngine(tier.id);
    assert.ok(bot, `${tier.id}: no first-party bot profile claims this engine id`);
  }
  for (const tier of FORTRESS_XIANGQI_PLAYABLE_ENGINES) {
    const bot = firstPartyBotForEngine(tier.id);
    assert.ok(bot, `${tier.id}: no first-party bot profile claims this engine id`);
    assert.equal(firstPartyBotEngineFor(bot.id, 'fortress-xiangqi'), tier.id);
  }
  for (const tier of DUCK_XIANGQI_PLAYABLE_ENGINES) {
    const bot = firstPartyBotForEngine(tier.id);
    assert.ok(bot, `${tier.id}: no first-party bot profile claims this engine id`);
    assert.equal(firstPartyBotEngineFor(bot.id, 'duck-xiangqi'), tier.id);
  }
});

test('dormant retired-family profiles keep their names for history', () => {
  assert.equal(
    firstPartyBotForId('fairy-stockfish-drop-mini-xiangqi')?.displayName,
    'Fairy Stockfish - Strong',
  );
  assert.equal(
    firstPartyBotForEngine('fairy-stockfish-drop-mini-xiangqi-very-strong')?.id,
    'fairy-stockfish-drop-mini-xiangqi-strongest',
  );
});

test('no engine id is claimed by two profiles with different identities', () => {
  const owners = new Map<string, string>();
  for (const bot of FIRST_PARTY_BOT_PROFILES) {
    for (const engineId of [...Object.values(bot.engines), ...(bot.attributionEngineIds ?? [])]) {
      const existing = owners.get(engineId);
      assert.ok(
        existing === undefined || existing === bot.id,
        `${engineId} claimed by both ${existing} and ${bot.id}`,
      );
      owners.set(engineId, bot.id);
    }
  }
});
