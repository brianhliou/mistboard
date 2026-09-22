import assert from 'node:assert/strict';
import test from 'node:test';
import { type BotPageSource, botPageMeta } from './bot-page-meta.js';

const pikafish: BotPageSource = {
  id: 'pikafish',
  displayName: 'Pikafish',
  bio: "Mistboard's elite challenge, backed by mainline Pikafish.",
  supportedGameSpecIds: ['xiangqi', 'jieqi'],
};
const lookup = async (id: string) => (id === 'pikafish' ? pikafish : null);

test('a bot profile page names its bot and games in the title and its bio in the description', async () => {
  const meta = await botPageMeta('/bot/pikafish', lookup);
  assert.ok(meta);
  assert.equal(meta.title, 'Play Pikafish · xiangqi and jieqi bot | Mistboard');
  assert.equal(
    meta.description,
    "Mistboard's elite challenge, backed by mainline Pikafish. Free, in the browser, no account needed.",
  );
  assert.equal(meta.urlPath, '/bot/pikafish');
});

test('an unknown bot, a deeper path, or another route yields nothing', async () => {
  assert.equal(await botPageMeta('/bot/nobody', lookup), null);
  assert.equal(await botPageMeta('/bot/pikafish/games', lookup), null);
  assert.equal(await botPageMeta('/bots', lookup), null);
  assert.equal(await botPageMeta('/jieqi/game/jq_x', lookup), null);
});

test('a bot with no bio still gets a description that says what it is for', async () => {
  const meta = await botPageMeta('/bot/misty', async () => ({
    id: 'misty',
    displayName: 'Misty',
    bio: '',
    supportedGameSpecIds: ['dark-chess'],
  }));
  assert.equal(meta?.title, 'Play Misty · fog chess bot | Mistboard');
  assert.match(meta?.description ?? '', /^Play fog chess against Misty on Mistboard\./);
});
