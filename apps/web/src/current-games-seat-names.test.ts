// "Fairy-Stockfish Level 8" was cut to "Fairy-Stockfish Le..." on a /games
// card (2026-10-21): the seat line has about 130px beside the BOT tag and the
// clock. The cards call the engine FSF and keep the full name in the tooltip.
import { describe, expect, it } from 'vitest';
import { buildFinishedTile, buildSeatRow } from './current-games.js';
import type { CurrentGamePlayer } from './current-games-model.js';
import { cardSeatName } from './current-games-model.js';
import type { FeaturedGame, GameParticipant } from './game-display.js';

function player(name: string, isEngine: boolean): CurrentGamePlayer {
  return { color: 'black', name, handle: null, isEngine };
}

function participant(color: GameParticipant['color'], displayName: string): GameParticipant {
  return { color, displayName, subjectType: 'user', subjectId: null, visibility: 'public' };
}

function finishedGame(participants: GameParticipant[]): FeaturedGame {
  return {
    roomId: 'finished-room',
    variant: 'xiangqi',
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

  it('leaves every other name alone', () => {
    for (const name of ['Pikafish Level 7', 'Guest', 'Fairy-Stockfish', 'Fairy-Stockfish fan']) {
      expect(cardSeatName(name)).toBe(name);
    }
  });
});

describe('/games seat names', () => {
  it('a live bot seat shows FSF and keeps the full name as its tooltip', () => {
    const row = buildSeatRow(player('Fairy-Stockfish Level 8', true), {}, 'black');
    const name = row.querySelector<HTMLElement>('.current-game-seat-name');
    expect(name?.textContent).toBe('FSF Level 8');
    expect(name?.title).toBe('Fairy-Stockfish Level 8');
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
  });
});
