// The /games "Just finished" card: a Xiangqi Mahjong card draws both final
// hands (never the misty tile), the board box takes its board's own ratio so
// it runs edge to edge, the winner's name
// reads first, and the finish time sits after the result in the bottom row.
import type { XmjTile } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { buildFinishedTile } from './current-games.js';
import { type XmjFinalView, xmjFinalHandsSvg } from './current-games-xmj-card.js';
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

const XMJ_GAME = finishedGame({
  roomId: 'xmj_942676f6',
  variant: 'xiangqi-mahjong',
  result: 'east-wins',
  termination: 'timeout',
  participants: [participant('east', 'Misty'), participant('west', 'rebirthfox333')],
});

function board(tile: HTMLElement): HTMLElement {
  const el = tile.querySelector<HTMLElement>(':scope > .current-game-board');
  if (!el) throw new Error('no board box');
  return el;
}

describe('buildFinishedTile', () => {
  it('gives a Xiangqi Mahjong card a hands tile, not the misty one, at any move count', () => {
    for (const plyCount of [0, 2, 194]) {
      const tile = buildFinishedTile({ ...XMJ_GAME, plyCount });
      expect(tile.dataset.tileKind).toBe('hands');
      expect(tile.querySelector('.current-game-fog')).toBeNull();
      expect(board(tile).classList.contains('is-loading')).toBe(true);
    }
  });

  it('keeps the misty tile for a concealed variant with no public final view', () => {
    const tile = buildFinishedTile(finishedGame({ variant: 'no-such-variant' }));
    expect(tile.dataset.tileKind).toBe('fog');
    expect(tile.querySelector('.current-game-fog')).not.toBeNull();
  });

  it("sizes the board box to the board's own ratio, banqi in a xiangqi-shaped box", () => {
    const aspect = (variant: string) =>
      Number(
        board(buildFinishedTile(finishedGame({ variant }))).style.getPropertyValue(
          '--finished-board-aspect',
        ),
      );
    expect(aspect('xiangqi')).toBeCloseTo(552 / 612, 3);
    expect(aspect('banqi')).toBeCloseTo(552 / 612, 3);
    expect(aspect('chess')).toBe(1);
  });

  it('keeps a banqi card one cell, the same size as the rest', () => {
    expect(
      buildFinishedTile(finishedGame({ variant: 'banqi' })).classList.contains('is-wide'),
    ).toBe(false);
  });

  it('ends with the result, then the finish time in the corner', () => {
    const tile = buildFinishedTile(XMJ_GAME);
    const line = tile.lastElementChild as HTMLElement;
    expect(line.className).toBe('current-game-finished-line');
    const [result, when] = [...line.children] as HTMLElement[];
    expect(result?.className).toBe('current-game-result');
    expect(result?.textContent).toBe('Misty wins');
    expect(when?.tagName).toBe('TIME');
    expect(when?.className).toBe('current-game-finished-when');
    expect(when?.getAttribute('datetime')).toBe('2026-10-09T12:00:00.000Z');
  });

  it("marks the winner's and loser's names, and neither on a draw", () => {
    const outcomes = (game: FeaturedGame) =>
      Object.fromEntries(
        [
          ...buildFinishedTile(game).querySelectorAll<HTMLElement>('.current-game-finished-seat'),
        ].map((row) => [row.dataset.color, row.dataset.outcome ?? null]),
      );
    expect(outcomes(XMJ_GAME)).toEqual({ east: 'won', west: 'lost' });
    expect(outcomes(finishedGame({ result: 'black-wins' }))).toEqual({
      red: 'lost',
      black: 'won',
    });
    expect(outcomes(finishedGame({ result: 'draw' }))).toEqual({ red: null, black: null });
  });
});

describe('xmjFinalHandsSvg', () => {
  const view: XmjFinalView = {
    hands: { east: ['rR', 'rP', 'bP', 'bP'], west: ['rH', 'rH', 'bP', 'bP', 'bP'] },
    melds: { east: [], west: [{ kind: 'triplet', tiles: ['bC', 'bC', 'bC'], claimed: 'bC' }] },
    scores: { east: 3, west: 6 },
  };

  function seatTiles(svg: string, cls: string, seat: string): number {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const group = doc.querySelector(`g.${cls}[data-seat="${seat}"]`);
    if (!group) return 0;
    // Each tile draws one face rect with the ivory fill.
    return group.querySelectorAll('rect[fill="#fbf7ec"]').length;
  }

  it('draws every tile in both hands and melds, and no discards', () => {
    const svg = xmjFinalHandsSvg(view, 'east', 'west', 'international', 'Both final hands');
    expect(seatTiles(svg, 'xmj-card-hand', 'east')).toBe(4);
    expect(seatTiles(svg, 'xmj-card-hand', 'west')).toBe(5 + 3);
    expect(svg).not.toContain('xmj-card-pond');
  });

  it("puts each seat's match points in its own half, the winner's lit", () => {
    const doc = new DOMParser().parseFromString(
      xmjFinalHandsSvg(view, 'east', 'west', 'international', 't', 'Timeout'),
      'image/svg+xml',
    );
    const score = (seat: string) => doc.querySelector(`text.xmj-card-score[data-seat="${seat}"]`);
    expect(score('west')?.textContent).toBe('6');
    expect(score('east')?.textContent).toBe('3');
    // West sits on top when east is the bottom seat; the centre line is at half height.
    const half = Number(doc.querySelector('svg')?.getAttribute('viewBox')?.split(' ')[3]) / 2;
    expect(Number(score('west')?.getAttribute('y'))).toBeLessThan(half);
    expect(Number(score('east')?.getAttribute('y'))).toBeGreaterThan(half);
    expect(score('west')?.getAttribute('fill')).not.toBe(score('east')?.getAttribute('fill'));
  });

  it('names how the match ended on the centre line, and draws no pill without a label', () => {
    const svg = xmjFinalHandsSvg(view, 'east', 'west', 'international', 't', 'On <points>');
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(doc.querySelector('g.xmj-card-ending text')?.textContent).toBe('On <points>');
    expect(xmjFinalHandsSvg(view, 'east', 'west', 'international', 't')).not.toContain(
      'xmj-card-ending',
    );
  });

  it('lights neither score when there is no winner', () => {
    const svg = xmjFinalHandsSvg(view, 'east', null, 'international', 't', 'Draw');
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const fills = [...doc.querySelectorAll('text.xmj-card-score')].map((n) =>
      n.getAttribute('fill'),
    );
    expect(new Set(fills).size).toBe(1);
  });

  it("puts the bottom seat's hand below the top seat's", () => {
    const svg = xmjFinalHandsSvg(view, 'east', null, 'international', 't');
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const y = (seat: string) => {
      const transform =
        doc.querySelector(`g.xmj-card-hand[data-seat="${seat}"]`)?.getAttribute('transform') ?? '';
      return Number(/translate\([\d.]+ ([\d.]+)\)/.exec(transform)?.[1]);
    };
    expect(y('east')).toBeGreaterThan(y('west'));
    const flipped = new DOMParser().parseFromString(
      xmjFinalHandsSvg(view, 'west', null, 'international', 't'),
      'image/svg+xml',
    );
    const yFlipped = (seat: string) =>
      Number(
        /translate\([\d.]+ ([\d.]+)\)/.exec(
          flipped
            .querySelector(`g.xmj-card-hand[data-seat="${seat}"]`)
            ?.getAttribute('transform') ?? '',
        )?.[1],
      );
    expect(yFlipped('west')).toBeGreaterThan(yFlipped('east'));
  });

  it('dims only the losing hand, and neither when there is no winner', () => {
    const won = xmjFinalHandsSvg(view, 'east', 'west', 'international', 't');
    expect(won).toMatch(/opacity="0\.78" data-result="lost" data-seat="east"/);
    expect(won).toMatch(/data-result="won" data-seat="west"/);
    const none = xmjFinalHandsSvg(view, 'east', null, 'international', 't');
    expect(none).not.toContain('data-result="lost"');
  });

  it('draws nothing for a hand it was not given', () => {
    const hidden: XmjFinalView = {
      ...view,
      hands: { east: null, west: null } as unknown as Record<'east' | 'west', XmjTile[]>,
      melds: { east: [], west: [] },
    };
    const svg = xmjFinalHandsSvg(hidden, 'east', null, 'international', 't');
    expect(svg).not.toContain('xmj-card-hand');
  });

  it('escapes its accessible title', () => {
    expect(xmjFinalHandsSvg(view, 'east', null, 'international', 'a <b> & c')).toContain(
      'aria-label="a &lt;b&gt; &amp; c"',
    );
  });
});
