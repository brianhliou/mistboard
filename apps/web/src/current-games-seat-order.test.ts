// A live Xiangqi Mahjong card on /games drew its seats swapped (2026-10-27):
// the feed listed west (Misty) before east (the guest), and the card took the
// first listed seat as the bottom one because only red and white counted as a
// first mover. The table under it draws east at the bottom for a spectator, so
// the name rows disagreed with the racks, and the names handed to the board
// ("first" is east to it) put "Misty to discard." on the guest's turn.
import { describe, expect, it } from 'vitest';
import { namesFor, seatOrder } from './current-games.js';
import type { CurrentGamePlayer } from './current-games-model.js';

function player(color: string, name: string | null, isEngine = false): CurrentGamePlayer {
  return { color, name, handle: null, isEngine };
}

describe('/games live card seat order', () => {
  it('puts Xiangqi Mahjong east at the bottom even when the feed lists west first', () => {
    const misty = player('west', 'Misty', true);
    const guest = player('east', null);
    const [top, bottom] = seatOrder({ players: [misty, guest], gameSpecId: 'xiangqi-mahjong' });
    expect(top?.color).toBe('west');
    expect(bottom?.color).toBe('east');
  });

  it('hands the board east as the first name, so the table names the right seat', () => {
    const names = namesFor({
      players: [player('west', 'Misty', true), player('east', 'Ann')],
      gameSpecId: 'xiangqi-mahjong',
    });
    expect(names).toEqual({ first: 'Ann', second: 'Misty' });
  });

  it('keeps red and white at the bottom whatever the list order', () => {
    const red = seatOrder({
      players: [player('black', 'Bo'), player('red', 'Ann')],
      gameSpecId: 'xiangqi',
    });
    expect(red[1]?.color).toBe('red');
    const white = seatOrder({
      players: [player('black', 'Bo'), player('white', 'Ann')],
      gameSpecId: 'chess',
    });
    expect(white[1]?.color).toBe('white');
  });

  // A live Gomoku game (2026-11-10): black moves first, but white counted as the
  // first mover, so the bot's name sat on the guest's running black clock.
  it('puts Gomoku black at the bottom and names it first', () => {
    const players = [player('white', 'Rapfi Level 4', true), player('black', null)];
    expect(seatOrder({ players, gameSpecId: 'gomoku' })[1]?.color).toBe('black');
    expect(namesFor({ players, gameSpecId: 'gomoku' })).toEqual({
      first: 'Guest',
      second: 'Rapfi Level 4',
    });
  });
});
