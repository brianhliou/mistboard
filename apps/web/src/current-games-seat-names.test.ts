// "Fairy-Stockfish Level 8" was cut to "Fairy-Stockfish Le..." on a /games
// card (2026-10-21): the seat line has about 130px beside the BOT tag and the
// clock. Just finished cards call the engine FSF and keep the full name in the
// tooltip; Playing now cards show the whole name, wrapping (2026-11-12).
import { describe, expect, it } from 'vitest';
import { buildFinishedTile, buildSeatRow } from './current-games.js';
import type { CurrentGamePlayer } from './current-games-model.js';
import { cardSeatName } from './current-games-model.js';
import { FLAIR_KEYS } from './flair.js';
import type { FeaturedGame, GameParticipant } from './game-display.js';

function player(name: string, isEngine: boolean): CurrentGamePlayer {
  return { color: 'black', name, handle: null, isEngine };
}

function participant(color: GameParticipant['color'], displayName: string): GameParticipant {
  return { color, displayName, subjectType: 'user', subjectId: null, visibility: 'public' };
}

function finishedGame(participants: GameParticipant[], variant = 'xiangqi'): FeaturedGame {
  return {
    roomId: 'finished-room',
    variant,
    result: 'red-wins',
    termination: 'checkmate',
    plyCount: 2,
    whiteName: null,
    blackName: null,
    corpusId: null,
    endedAt: '2026-10-09T12:00:00.000Z',
    participants,
  };
}

describe('cardSeatName', () => {
  it('shortens a Fairy-Stockfish level to FSF', () => {
    expect(cardSeatName('Fairy-Stockfish Level 8')).toBe('FSF Level 8');
    expect(cardSeatName('Fairy-Stockfish Level 2')).toBe('FSF Level 2');
  });

  it('drops the game from Misty only when it is this game', () => {
    expect(cardSeatName('Misty Three Kingdoms Banqi Level 2', 'Three Kingdoms Banqi')).toBe(
      'Misty Level 2',
    );
    expect(cardSeatName('Misty Banqi', 'Banqi')).toBe('Misty');
    for (const name of [
      'Misty Banqi Level 2',
      'Misty Three Kingdoms Banqi fan',
      'Misty Banqiing',
    ]) {
      expect(cardSeatName(name, name.includes('Three') ? 'Three Kingdoms Banqi' : 'Jungle')).toBe(
        name,
      );
    }
  });

  it('leaves every other name alone', () => {
    for (const name of ['Pikafish Level 7', 'Guest', 'Fairy-Stockfish', 'Fairy-Stockfish fan']) {
      expect(cardSeatName(name)).toBe(name);
    }
  });
});

describe('/games seat names', () => {
  it('a live bot seat shows its whole name, with the BOT tag after it', () => {
    const row = buildSeatRow(player('Fairy-Stockfish Level 8', true), {}, 'black');
    const name = row.querySelector<HTMLElement>('.current-game-seat-name');
    expect(name?.textContent).toBe('Fairy-Stockfish Level 8');
    expect(name?.title).toBe('Fairy-Stockfish Level 8');
    const label = row.querySelector('.current-game-seat-label');
    expect(label?.lastElementChild?.classList.contains('current-game-bot')).toBe(true);
    expect(label?.contains(row.querySelector('.current-game-seat-clock'))).toBe(false);
  });

  it('a titled, flaired person shows the badge before and the flair after the name', () => {
    const row = buildSeatRow(
      { ...player('Ann', false), handle: 'ann', title: 'xgm', flair: FLAIR_KEYS[0]! },
      {},
      'black',
    );
    const name = row.querySelector<HTMLElement>('a.current-game-seat-name');
    expect(name?.getAttribute('href')).toBe('/@/ann');
    expect(name?.title).toBe('Ann');
    expect(name?.firstElementChild?.classList.contains('title-badge')).toBe(true);
    expect(name?.querySelector('.player-name-text')?.textContent).toBe('Ann');
    expect(name?.lastElementChild?.classList.contains('flair')).toBe(true);
  });

  it('a person is never renamed, whatever the name', () => {
    const row = buildSeatRow(player('Fairy-Stockfish Level 8', false), {}, 'black');
    expect(row.querySelector('.current-game-seat-name')?.textContent).toBe(
      'Fairy-Stockfish Level 8',
    );
  });

  it('a finished card shows FSF and keeps the full name as its tooltip', () => {
    const tile = buildFinishedTile(
      finishedGame([participant('red', 'Ann'), participant('black', 'Fairy-Stockfish Level 3')]),
    );
    const seat = tile.querySelector<HTMLElement>('.current-game-finished-seat[data-seat="second"]');
    expect(seat?.querySelector('.current-game-finished-seat-name')?.textContent).toBe(
      'FSF Level 3',
    );
    expect(seat?.title).toBe('Fairy-Stockfish Level 3');
    expect(seat?.querySelector<HTMLElement>('.current-game-finished-seat-name')?.title).toBe(
      'Fairy-Stockfish Level 3',
    );
  });

  it('a finished card calls Misty by her level and keeps the game name as its tooltip', () => {
    const fullName = 'Misty Three Kingdoms Banqi Level 7';
    const tile = buildFinishedTile(
      finishedGame(
        [
          participant('red', 'Ann'),
          {
            ...participant('black', 'MistyThreeKingdomsBanqi level 7'),
            subjectType: 'engine-version',
            subjectId: 'misty-three-kingdoms-banqi-level-7',
          },
        ],
        'three-kingdoms-banqi',
      ),
    );
    const name = tile.querySelector<HTMLElement>(
      '.current-game-finished-seat[data-seat="second"] .current-game-finished-seat-name',
    );
    expect(name?.textContent).toBe('Misty Level 7');
    expect(name?.title).toBe(fullName);
  });
});
