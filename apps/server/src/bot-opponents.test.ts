// The opponent map (packages/game bot-opponents.ts) groups the first-party bots
// for /bots and the /data filter. It is an explicit list, so this is the check
// that it stays complete: a bot added to the registry without a place in the
// map would vanish from the directory.
import assert from 'node:assert/strict';
import test from 'node:test';
import { BOT_OPPONENTS, botOpponentById, botOpponentForBotId } from '@mistboard/game';
import { FIRST_PARTY_BOT_PROFILES } from './first-party-bots.js';

const memberIds = BOT_OPPONENTS.flatMap((opponent) => opponent.members.map((m) => m.botId));

test('bot opponents: every first-party bot sits in exactly one opponent', () => {
  const registry = FIRST_PARTY_BOT_PROFILES.map((bot) => bot.id);
  assert.deepEqual([...memberIds].sort(), [...registry].sort());
  assert.equal(new Set(memberIds).size, memberIds.length);
});

test('bot opponents: General Blunder is apart from the Fairy-Stockfish ladder it runs on', () => {
  assert.equal(botOpponentForBotId('general-blunder')?.opponent.id, 'general-blunder');
  assert.ok(
    !botOpponentById('fairy-stockfish')
      ?.members.map((m) => m.botId)
      .includes('general-blunder'),
  );
});

test('bot opponents: each ladder is numbered 1 to N, Pikafish at level 8', () => {
  for (const opponent of BOT_OPPONENTS) {
    if (opponent.members.length === 1) {
      assert.equal(opponent.members[0]?.level, null, opponent.id);
      continue;
    }
    assert.deepEqual(
      opponent.members.map((m) => m.level),
      opponent.members.map((_, index) => index + 1),
      opponent.id,
    );
  }
  assert.equal(botOpponentForBotId('pikafish')?.opponent.id, 'pikafish');
  assert.equal(botOpponentForBotId('pikafish')?.member.level, 8);
});

test('bot opponents: ids are safe in a /data file path', () => {
  for (const opponent of BOT_OPPONENTS) assert.match(opponent.id, /^[a-z0-9][a-z0-9-]{0,79}$/);
});
