import { describe, expect, it } from 'vitest';
import {
  DUCK_INTRO_GAMES,
  DUCK_INTRO_PLACEMENTS,
  duckPlacementCue,
  enterDuckGame,
} from './duck-xiangqi-intro.js';

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

describe('the new-player placement card', () => {
  it(`explains the duck in the first ${DUCK_INTRO_GAMES} games on this browser, then stops`, () => {
    const storage = memoryStorage();
    const rooms = Array.from({ length: DUCK_INTRO_GAMES + 2 }, (_, i) => `dkx_${i}`);
    const intro = rooms.map((room) => enterDuckGame(room, storage));
    expect(intro).toEqual([...Array(DUCK_INTRO_GAMES).fill(true), false, false]);
  });

  it('counts a reload or reconnect of the same room once', () => {
    const storage = memoryStorage();
    for (let i = 0; i < 5; i++) expect(enterDuckGame('dkx_same', storage)).toBe(true);
    expect(enterDuckGame('dkx_b', storage)).toBe(true);
    expect(enterDuckGame('dkx_c', storage)).toBe(true);
    expect(enterDuckGame('dkx_d', storage)).toBe(false);
    // A room that was an intro game stays one.
    expect(enterDuckGame('dkx_same', storage)).toBe(true);
  });

  it('explains every game when storage is unavailable or broken', () => {
    expect(enterDuckGame('dkx_a', null)).toBe(true);
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(enterDuckGame('dkx_a', throwing)).toBe(true);
    const garbage = { getItem: () => '{not json', setItem: () => {} };
    expect(enterDuckGame('dkx_a', garbage)).toBe(true);
  });

  it(`shows the card for the first ${DUCK_INTRO_PLACEMENTS} placements of an intro game, then the chip`, () => {
    const cues = Array.from({ length: DUCK_INTRO_PLACEMENTS + 2 }, (_, placementIndex) =>
      duckPlacementCue({ introGame: true, placementIndex }),
    );
    expect(cues).toEqual([...Array(DUCK_INTRO_PLACEMENTS).fill('card'), 'chip', 'chip']);
  });

  it('shows only the chip once the player is past the intro games', () => {
    expect(duckPlacementCue({ introGame: false, placementIndex: 0 })).toBe('chip');
  });
});
