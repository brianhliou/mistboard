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
    const [top, bottom] = seatOrder({ players: [misty, guest] });
    expect(top?.color).toBe('west');
    expect(bottom?.color).toBe('east');
  });

  it('hands the board east as the first name, so the table names the right seat', () => {
    const names = namesFor({ players: [player('west', 'Misty', true), player('east', 'Ann')] });
    expect(names).toEqual({ first: 'Ann', second: 'Misty' });
  });

  it('keeps red and white at the bottom whatever the list order', () => {
    expect(seatOrder({ players: [player('black', 'Bo'), player('red', 'Ann')] })[1]?.color).toBe(
      'red',
    );
    expect(seatOrder({ players: [player('black', 'Bo'), player('white', 'Ann')] })[1]?.color).toBe(
      'white',
    );
  });
});
