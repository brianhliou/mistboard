// /games puts the same colour circle beside each player's name that /watch does
// (#540): the shared seat disc, coloured by the ink the seat plays. Flip variants
// (Banqi, Flip Jungle) bind that ink on the opening flip, so a seat's disc follows
// `firstColor` rather than the seat id, and stays a dashed ring until the flip.
import {
  BANQI_SPEC_ID,
  DARK_CHESS_SPEC_ID,
  JUNGLE_FLIP_SPEC_ID,
  JUNGLE_SPEC_ID,
  XIANGQI_MAHJONG_SPEC_ID,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { buildFinishedTile, buildSeatRow, paintSeatDiscs } from './current-games.js';
import type { CurrentGamePlayer } from './current-games-model.js';
import { payloadFirstColor, variantSeatsHaveInk } from './flip-seat-ink.js';
import type { FeaturedGame, GameParticipant } from './game-display.js';

function participant(color: GameParticipant['color'], displayName: string): GameParticipant {
  return { color, displayName, subjectType: 'user', subjectId: null, visibility: 'public' };
}

function finishedGame(overrides: Partial<FeaturedGame>): FeaturedGame {
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
    ...overrides,
  };
}

function player(color: string, name: string): CurrentGamePlayer {
  return { color, name, handle: null, isEngine: false };
}

// The disc's ink modifier in a seat row ("red", "black", "unbound"), or null
// when the row has no disc.
function discInk(row: Element | null): string | null {
  const disc = row?.querySelector('.seat-disc');
  if (!disc) return null;
  const modifier = [...disc.classList].find((name) => name.startsWith('seat-disc--'));
  return modifier ? modifier.slice('seat-disc--'.length) : null;
}

function finishedDisc(tile: HTMLElement, seat: 'first' | 'second'): string | null {
  return discInk(tile.querySelector(`.current-game-finished-seat[data-seat="${seat}"]`));
}

describe('just-finished tiles', () => {
  it('puts a red and a black disc beside a xiangqi game', () => {
    const tile = buildFinishedTile(
      finishedGame({ participants: [participant('red', 'Ann'), participant('black', 'Bo')] }),
    );
    expect(finishedDisc(tile, 'first')).toBe('red');
    expect(finishedDisc(tile, 'second')).toBe('black');
    // The name is still the row's text, with the circle in front of it.
    const row = tile.querySelector('.current-game-finished-seat[data-seat="first"]');
    expect(row?.textContent).toBe('Ann');
    expect(row?.firstElementChild?.classList.contains('seat-disc')).toBe(true);
  });

  it("uses the variant's own colours for a chess-board game", () => {
    const tile = buildFinishedTile(
      finishedGame({
        variant: DARK_CHESS_SPEC_ID,
        result: 'white-wins',
        participants: [participant('white', 'Ann'), participant('black', 'Bo')],
      }),
    );
    expect(finishedDisc(tile, 'first')).toBe('white');
    expect(finishedDisc(tile, 'second')).toBe('black');
  });

  it('follows the opening flip in Banqi, not the seat', () => {
    const tile = buildFinishedTile(
      finishedGame({
        variant: BANQI_SPEC_ID,
        firstColor: 'black',
        participants: [participant('red', 'Ann'), participant('black', 'Bo')],
      }),
    );
    expect(finishedDisc(tile, 'first')).toBe('black');
    expect(finishedDisc(tile, 'second')).toBe('red');
  });

  it('draws a dashed ring for a Banqi game whose flip is unknown', () => {
    const tile = buildFinishedTile(
      finishedGame({
        variant: BANQI_SPEC_ID,
        participants: [participant('red', 'Ann'), participant('black', 'Bo')],
      }),
    );
    expect(finishedDisc(tile, 'first')).toBe('unbound');
  });

  it('marks a Jungle tile so its second ink paints blue', () => {
    const tile = buildFinishedTile(
      finishedGame({
        variant: JUNGLE_SPEC_ID,
        participants: [participant('red', 'Ann'), participant('black', 'Bo')],
      }),
    );
    expect(tile.dataset.seatInkFamily).toBe('jungle');
    const xiangqi = buildFinishedTile(finishedGame({}));
    expect(xiangqi.dataset.seatInkFamily).toBeUndefined();
  });
});

describe('live and correspondence seat rows', () => {
  it('puts the disc before the name', () => {
    const row = buildSeatRow(player('red', 'Ann'), {}, 'red');
    const who = row.querySelector('.current-game-seat-who');
    expect(discInk(row)).toBe('red');
    expect(who?.firstElementChild?.classList.contains('seat-disc')).toBe(true);
    expect(who?.children[1]?.classList.contains('current-game-seat-name')).toBe(true);
  });

  it('draws a dashed ring while the ink is unbound', () => {
    expect(discInk(buildSeatRow(player('red', 'Ann'), {}, null))).toBe('unbound');
  });

  it('leaves an empty seat without a disc', () => {
    expect(discInk(buildSeatRow(null, {}, null))).toBeNull();
  });

  it('repaints a live flip card once the board payload says who flipped what', () => {
    const card = document.createElement('article');
    card.append(
      buildSeatRow(player('black', 'Bo'), {}, null),
      buildSeatRow(player('red', 'Ann'), {}, null),
    );
    paintSeatDiscs(card, JUNGLE_FLIP_SPEC_ID, 'black');
    expect(discInk(card.querySelector('[data-color="red"]'))).toBe('black');
    expect(discInk(card.querySelector('[data-color="black"]'))).toBe('red');
    expect(card.dataset.seatInkFamily).toBe('jungle');
  });
});

// Xiangqi Mahjong seats players by wind and has no colours, so an ink disc is
// an empty grey circle that claims a colour the game does not have.
describe('a variant with colourless seats', () => {
  it('reads Xiangqi Mahjong (and only the mahjong family) as having no seat ink', () => {
    expect(variantSeatsHaveInk(XIANGQI_MAHJONG_SPEC_ID)).toBe(false);
    expect(variantSeatsHaveInk('xiangqi')).toBe(true);
    expect(variantSeatsHaveInk(JUNGLE_FLIP_SPEC_ID)).toBe(true);
  });

  it('draws no disc on a just-finished Xiangqi Mahjong tile, names kept', () => {
    const tile = buildFinishedTile(
      finishedGame({
        variant: XIANGQI_MAHJONG_SPEC_ID,
        result: 'east-wins',
        termination: 'points',
        participants: [participant('east', 'Ann'), participant('west', 'Bo')],
      }),
    );
    expect(tile.querySelector('.seat-disc')).toBeNull();
    const names = [...tile.querySelectorAll('.current-game-finished-seat-name')].map(
      (el) => el.textContent,
    );
    expect(names.sort()).toEqual(['Ann', 'Bo']);
  });

  it('draws no disc on a live seat row whose variant has no ink', () => {
    const row = buildSeatRow(player('east', 'Ann'), {}, false);
    expect(row.querySelector('.seat-disc')).toBeNull();
    expect(row.querySelector('.current-game-seat-name')?.textContent).toContain('Ann');
  });
});

describe('payloadFirstColor', () => {
  it("reads the bound ink from a live payload's view", () => {
    expect(payloadFirstColor({ view: { firstColor: 'black' } })).toBe('black');
  });

  it('reads anything else as unbound', () => {
    expect(payloadFirstColor({ view: { firstColor: 'green' } })).toBeNull();
    expect(payloadFirstColor({ view: {} })).toBeNull();
    expect(payloadFirstColor({})).toBeNull();
    expect(payloadFirstColor(undefined)).toBeNull();
  });
});
