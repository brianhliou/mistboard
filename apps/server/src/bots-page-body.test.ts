import assert from 'node:assert/strict';
import test from 'node:test';
import { botsDirectoryBody } from './bots-page-body.js';
import type { BotDirectoryEntry, BotRatingSnapshot } from './persistence-bots.js';

function rating(gameSpecId: string, value: number): BotRatingSnapshot {
  return {
    gameSpecId,
    timeClass: 'blitz',
    rating: value,
    ratingDeviation: null,
    games: 40,
    source: 'eve-anchor',
    sourceRef: null,
    createdAt: new Date(0),
    provisional: false,
  };
}

function bot(overrides: Partial<BotDirectoryEntry>): BotDirectoryEntry {
  return {
    id: 'fairy-stockfish-level-1',
    displayName: 'Fairy-Stockfish Level 1',
    bio: 'Stored English bio.',
    ownerType: 'system',
    ownerUserId: null,
    activeEngineId: 'fsf',
    defaultGameSpecId: 'xiangqi',
    supportedGameSpecIds: ['xiangqi'],
    play: {
      mode: 'pve',
      gameSpecId: 'xiangqi',
      engineId: 'fsf',
      timeControl: { initialMs: 600_000, incrementMs: 5_000 },
      preferredColor: 'random',
    },
    rating: null,
    ratings: [],
    visibility: 'public',
    createdAt: new Date(0),
    updatedAt: new Date(0),
    gamesTotal: 0,
    record: { games: 0, wins: 0, losses: 0, draws: 0 },
    ...overrides,
  };
}

const roster = async (): Promise<BotDirectoryEntry[]> => [
  bot({
    id: 'fairy-stockfish-level-2',
    ratings: [rating('atomic-xiangqi', 1715), rating('xiangqi', 1713)],
  }),
  bot({ id: 'fairy-stockfish-level-1', ratings: [rating('xiangqi', 1637)] }),
];

// /bots answers "play xiangqi against the computer" in HTML a crawler can read
// without the bundle: the heading, the ladder in level order with the xiangqi
// rating (not the atomic one), start-here on the first-timer level, and links.
test('the bots body carries the heading and the ladder in each locale', async () => {
  const en = await botsDirectoryBody('/bots', roster);
  assert.ok(en);
  assert.match(en, /<h1>Play xiangqi against the computer<\/h1>/);
  assert.ok(en.indexOf('Level 1') < en.indexOf('Level 2'), 'ladder is in level order');
  assert.match(
    en,
    /<a href="\/bot\/fairy-stockfish-level-2">Level 2<\/a> · start here · xiangqi engine rating 1,713/,
  );
  assert.doesNotMatch(en, /1,715/);

  const zh = await botsDirectoryBody('/zh-hans/bots', roster);
  assert.match(zh ?? '', /<h1>和电脑下象棋<\/h1>/);
  assert.match(zh ?? '', />第 1 级<\/a> · 象棋引擎等级分 1,637/);
  assert.doesNotMatch(zh ?? '', /Stored English bio/);
  assert.match((await botsDirectoryBody('/zh-hant/bots', roster)) ?? '', /<h1>和電腦下象棋<\/h1>/);
});

test('the bots body is absent for other routes and when no bot loads', async () => {
  assert.equal(await botsDirectoryBody('/player', roster), null);
  assert.equal(await botsDirectoryBody('/bots', async () => []), null);
});
