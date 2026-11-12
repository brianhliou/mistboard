// A bot may play an admin-playtest spec (publicSurface 'hidden') for an admin,
// but a visitor's bot profile must not name it, count it per variant, list its
// games, or offer it as a play option. A retired spec (Fortress Xiangqi,
// 2026-10-11) is hidden the same way.
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
  supportedGameSpecIds: ['xiangqi', 'duck-xiangqi', 'fortress-xiangqi', 'mahjong'],
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
  assert.deepEqual(visible.supportedGameSpecIds, ['xiangqi', 'duck-xiangqi']);
  assert.deepEqual(
    visible.games.map((g) => g.variant),
    ['xiangqi'],
  );
  assert.deepEqual(Object.keys(visible.recordsByGameSpecId), ['xiangqi']);
  assert.deepEqual(Object.keys(visible.gamesByGameSpecId), ['xiangqi']);
  assert.ok(botPlayOptions(visible).every((option) => option.gameSpecId !== 'mahjong'));
  assert.ok(botPlayOptions(visible).every((option) => option.gameSpecId !== 'fortress-xiangqi'));
  // The source row is untouched: the play path still reads the full list.
  assert.ok(bot.supportedGameSpecIds.includes('mahjong'));
});

// A box without Misty's Flip Jungle engine (every dev box without the private
// build) must still list the variant, unplayable, so /bots shows Flip Jungle the
// way it shows AB-JChess and KataGo there; the play path still refuses it.
test('a missing Flip Jungle engine lists the variant as unplayable, not missing', () => {
  const saved = process.env.MISTBOARD_JUNGLE_FLIP_ENGINE_PATH;
  process.env.MISTBOARD_JUNGLE_FLIP_ENGINE_PATH = '/nonexistent/jungle-flip-engine';
  try {
    const misty = {
      id: 'misty',
      defaultGameSpecId: 'dark-chess',
      activeEngineId: 'misty',
      supportedGameSpecIds: ['dark-chess', 'jungle-flip'],
    };
    const flip = botPlayOptions(misty).find((option) => option.gameSpecId === 'jungle-flip');
    assert.ok(flip, 'jungle-flip must stay listed');
    assert.equal(flip.playable, false);
  } finally {
    if (saved === undefined) delete process.env.MISTBOARD_JUNGLE_FLIP_ENGINE_PATH;
    else process.env.MISTBOARD_JUNGLE_FLIP_ENGINE_PATH = saved;
  }
});
