import { describe, expect, it } from 'vitest';
import type { FeaturedGame } from './game-display.js';
import { type ProfileBoardThumb, profileBoardSvg } from './profile-game-board.js';
import { buildProfileGameRow } from './profile-ui.js';

const XIANGQI_END: ProfileBoardThumb = {
  shape: 'intersection',
  files: 9,
  ranks: 10,
  river: [5, 6],
  palaces: [
    [3, 1, 5, 3],
    [3, 8, 5, 10],
  ],
  pieces: [
    [4, 1, 'red'],
    [4, 10, 'black'],
    [0, 4, 'red-down'],
    [8, 7, 'black-down'],
  ],
};

function game(overrides: Partial<FeaturedGame> = {}): FeaturedGame {
  return {
    roomId: 'xq_1',
    variant: 'xiangqi',
    mode: 'pvp',
    rated: false,
    result: 'red-wins',
    termination: 'resignation',
    plyCount: 40,
    whiteName: 'Alice',
    blackName: 'Bob',
    corpusId: null,
    endedAt: '2026-10-20T12:00:00.000Z',
    playerColor: 'red',
    ...overrides,
  };
}

describe('profile game board thumbnail', () => {
  it('draws one disc per piece, by side, red at the bottom', () => {
    const svg = profileBoardSvg(XIANGQI_END) ?? '';
    const host = document.createElement('div');
    host.innerHTML = svg;
    const discs = [...host.querySelectorAll('circle')];
    expect(discs.map((disc) => disc.getAttribute('class'))).toEqual([
      'profile-game-board__red',
      'profile-game-board__black',
      'profile-game-board__red-down',
      'profile-game-board__black-down',
    ]);
    const [redGeneral, blackGeneral] = discs;
    expect(Number(redGeneral?.getAttribute('cy'))).toBeGreaterThan(
      Number(blackGeneral?.getAttribute('cy')),
    );
    expect(host.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 90 100');
  });

  it('draws cell boards, with the jungle lakes and chess squares', () => {
    const jungle = profileBoardSvg({
      shape: 'jungle',
      files: 7,
      ranks: 9,
      pieces: [[0, 1, 'red']],
    });
    expect(jungle?.match(/profile-game-board__water/g)).toHaveLength(12);
    const chess = profileBoardSvg({ shape: 'chess', files: 8, ranks: 8, pieces: [] });
    expect(chess?.match(/profile-game-board__dark/g)).toHaveLength(32);
  });

  it('draws a1 and h8 dark, and h1 and a8 light', () => {
    const host = document.createElement('div');
    host.innerHTML = profileBoardSvg({ shape: 'chess', files: 8, ranks: 8, pieces: [] }) ?? '';
    const darkSquare = (x: number, y: number) =>
      host.querySelector(`rect.profile-game-board__dark[x="${x}"][y="${y}"]`);
    expect(darkSquare(0, 70)).not.toBeNull(); // a1
    expect(darkSquare(70, 0)).not.toBeNull(); // h8
    expect(darkSquare(70, 70)).toBeNull(); // h1
    expect(darkSquare(0, 0)).toBeNull(); // a8
  });

  it('skips what it cannot place instead of drawing it off the board', () => {
    const svg = profileBoardSvg({
      shape: 'grid',
      files: 8,
      ranks: 4,
      pieces: [
        [0, 1, 'hidden'],
        [8, 1, 'red'],
        [0, 5, 'red'],
        [1, 1, 'king' as never],
      ],
    });
    expect(svg?.match(/<circle/g)).toHaveLength(1);
    expect(profileBoardSvg({ shape: 'grid', files: 400, ranks: 4, pieces: [] })).toBeNull();
    expect(profileBoardSvg({ shape: 'jungle', files: 8, ranks: 9, pieces: [] })).toBeNull();
  });
});

describe('profile game row with boards', () => {
  it('puts the final position between the result and the body', () => {
    const row = buildProfileGameRow(game({ finalBoard: XIANGQI_END }), { boards: true });
    const grid = row.querySelector('.profile-game-row');
    expect(grid?.classList.contains('profile-game-row-board')).toBe(true);
    const cells = [...(grid?.children ?? [])].map((el) => el.className.split(' ')[0]);
    expect(cells).toEqual([
      'profile-game-row-open',
      'profile-game-outcome',
      'profile-game-board',
      'profile-game-body',
      'profile-game-date',
    ]);
    expect(row.querySelectorAll('.profile-game-board circle')).toHaveLength(4);
  });

  it('keeps an empty cell for a game with no board, so the columns line up', () => {
    const row = buildProfileGameRow(game({ finalBoard: null }), { boards: true });
    const cell = row.querySelector('.profile-game-board');
    expect(cell?.classList.contains('profile-game-board-empty')).toBe(true);
    expect(cell?.childElementCount).toBe(0);
  });

  it('leaves the plain list as it was', () => {
    const row = buildProfileGameRow(game({ finalBoard: XIANGQI_END }));
    expect(row.querySelector('.profile-game-board')).toBeNull();
    expect(row.querySelector('.profile-game-row-board')).toBeNull();
  });
});
