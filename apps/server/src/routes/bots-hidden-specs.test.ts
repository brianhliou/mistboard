// A bot may play an admin-playtest spec (publicSurface 'hidden') for an admin,
// but a visitor's bot profile must not name it, count it per variant, list its
// games, or offer it as a play option.
import assert from 'node:assert/strict';
import test from 'node:test';
import type { BotProfilePage } from '../persistence-bots.js';
import { botPlayOptions, withoutHiddenSpecs } from './bots.js';

function game(variant: string) {
  return { roomId: `${variant}-1`, variant } as BotProfilePage['games'][number];
}

const bot = {
  id: 'fairy-stockfish-level-1',
  defaultGameSpecId: 'xiangqi',
  activeEngineId: 'fairy-stockfish-xiangqi-level-1',
  supportedGameSpecIds: ['xiangqi', 'fortress-xiangqi', 'mahjong'],
  games: [game('xiangqi'), game('mahjong')],
  recordsByGameSpecId: {
    xiangqi: { games: 1, wins: 0, losses: 1, draws: 0 },
    mahjong: { games: 1, wins: 1, losses: 0, draws: 0 },
  },
  gamesByGameSpecId: {
    xiangqi: [game('xiangqi')],
    mahjong: [game('mahjong')],
  },
} as unknown as BotProfilePage;

test('a hidden spec leaves every public bot field', () => {
  const visible = withoutHiddenSpecs(bot);
  assert.deepEqual(visible.supportedGameSpecIds, ['xiangqi', 'fortress-xiangqi']);
  assert.deepEqual(
    visible.games.map((g) => g.variant),
    ['xiangqi'],
  );
  assert.deepEqual(Object.keys(visible.recordsByGameSpecId), ['xiangqi']);
  assert.deepEqual(Object.keys(visible.gamesByGameSpecId), ['xiangqi']);
  assert.ok(botPlayOptions(visible).every((option) => option.gameSpecId !== 'mahjong'));
  // The source row is untouched: the play path still reads the full list.
  assert.ok(bot.supportedGameSpecIds.includes('mahjong'));
});
