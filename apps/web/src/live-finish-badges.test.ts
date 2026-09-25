import { describe, expect, it } from 'vitest';
import {
  createLiveFinishBadges,
  finishBadgesForResult,
  generalSquareIn,
  generalSquareOn,
  jungleFinishBadges,
} from './live-finish-badges.js';

const COLORS = ['red', 'black'] as const;
const GENERALS: Record<string, string> = { red: 'e1', black: 'd10' };

describe('finishBadgesForResult', () => {
  it('marks the loser with the reason and the winner with a crown', () => {
    const badges = finishBadgesForResult({
      colors: COLORS,
      winner: 'red',
      reason: 'checkmate',
      generalSquare: (color) => GENERALS[color],
    });
    expect(badges).toEqual([
      { square: 'e1', kind: 'winner', icon: 'crown', label: 'Winner' },
      { square: 'd10', kind: 'loser', icon: 'mate', label: 'Checkmate' },
    ]);
  });

  it('picks the loser icon by reason, with a generic one for the rest', () => {
    const icon = (reason: string) =>
      finishBadgesForResult({
        colors: COLORS,
        winner: 'black',
        reason,
        generalSquare: (color) => GENERALS[color],
      }).find((badge) => badge.kind === 'loser')?.icon;
    expect(icon('resignation')).toBe('resign');
    expect(icon('timeout')).toBe('timeout');
    expect(icon('stalemate')).toBe('loss');
    expect(icon('chasing')).toBe('loss');
  });

  it('marks both generals grey on a draw', () => {
    const badges = finishBadgesForResult({
      colors: COLORS,
      winner: null,
      reason: 'repetition',
      generalSquare: (color) => GENERALS[color],
    });
    expect(badges.map((badge) => [badge.kind, badge.icon])).toEqual([
      ['draw', 'draw'],
      ['draw', 'draw'],
    ]);
  });

  it('skips a general that is off the board', () => {
    const badges = finishBadgesForResult({
      colors: COLORS,
      winner: 'red',
      reason: 'general-captured',
      generalSquare: (color) => (color === 'red' ? 'e1' : null),
    });
    expect(badges.map((badge) => badge.kind)).toEqual(['winner']);
  });
});

describe('generalSquareOn', () => {
  it('finds the general and ignores face-down pieces', () => {
    const board = {
      a1: { color: 'red', faceDown: true },
      e1: { color: 'red', role: 'general' },
      e10: { color: 'black', role: 'general' },
    };
    expect(generalSquareOn(board, 'red')).toBe('e1');
    expect(generalSquareOn(board, 'black')).toBe('e10');
    expect(generalSquareOn({}, 'red')).toBeNull();
  });
});

describe('generalSquareIn', () => {
  it('falls back to the previous board for a general the last move captured', () => {
    const final = { e1: { color: 'red', role: 'general' } };
    const previous = {
      e1: { color: 'red', role: 'general' },
      e10: { color: 'black', role: 'general' },
    };
    expect(generalSquareIn([final, previous], 'black')).toBe('e10');
    expect(generalSquareIn([final, undefined], 'black')).toBeNull();
  });

  it('labels a captured general and a jungle den ending', () => {
    const label = (reason: string) =>
      finishBadgesForResult({
        colors: COLORS,
        winner: 'red',
        reason,
        generalSquare: (color) => GENERALS[color],
      }).find((badge) => badge.kind === 'loser')?.label;
    expect(label('general-captured')).toBe('General captured');
    expect(label('den-entered')).toBe('Den entered');
    expect(label('pieces-captured')).toBe('All pieces captured');
  });
});

describe('jungleFinishBadges', () => {
  it('crowns only the animal in the den on a den entry', () => {
    expect(
      jungleFinishBadges({ winner: 'red', reason: 'den-entered', lastMove: { to: 'd9' } }),
    ).toEqual([{ square: 'd9', kind: 'winner', icon: 'crown', label: 'Den entered' }]);
  });

  it('marks the pieces of the last repeated moves on a repetition', () => {
    const badges = jungleFinishBadges({
      winner: null,
      reason: 'repetition',
      lastMove: { to: 'b3' },
      previousLastMove: { to: 'f7' },
    });
    expect(badges.map((badge) => [badge.square, badge.kind])).toEqual([
      ['b3', 'draw'],
      ['f7', 'draw'],
    ]);
  });

  it('shows nothing for the other endings', () => {
    for (const reason of [
      'resignation',
      'timeout',
      'pieces-captured',
      'stalemate',
      'no-progress',
    ]) {
      expect(jungleFinishBadges({ winner: 'red', reason, lastMove: { to: 'd9' } })).toEqual([]);
    }
  });
});

describe('createLiveFinishBadges', () => {
  function setup() {
    const stage = document.createElement('div');
    const board = document.createElement('div');
    board.innerHTML = '<svg><g data-piece-square="e1"></g><g data-piece-square="d10"></g></svg>';
    stage.append(board);
    document.body.append(stage);
    const badges = createLiveFinishBadges(stage, board);
    const layer = () => stage.querySelector('.finish-badges');
    return { stage, badges, layer };
  }

  const played = finishBadgesForResult({
    colors: COLORS,
    winner: 'red',
    reason: 'resignation',
    generalSquare: (color) => GENERALS[color],
  });

  it('adds one badge per general with its pill label', () => {
    const { stage, badges } = setup();
    badges.play('game-1', played);
    const els = [...stage.querySelectorAll<HTMLElement>('.finish-badge')];
    expect(els.map((el) => el.dataset.finishSquare)).toEqual(['e1', 'd10']);
    expect(els[1]?.classList.contains('finish-badge--loser')).toBe(true);
    expect(els[1]?.querySelector('.finish-badge__pill')?.textContent).toBe('Resignation');
  });

  it('keeps the badges while the final position is shown and clears them after', () => {
    const { badges, layer } = setup();
    badges.play('game-1', played);
    badges.sync('game-1', true);
    expect(layer()).not.toBeNull();
    badges.sync('game-1', false);
    expect(layer()).toBeNull();
  });

  it('clears when a different game is in the room', () => {
    const { badges, layer } = setup();
    badges.play('game-1', played);
    badges.sync('game-2', true);
    expect(layer()).toBeNull();
  });

  it('anchors an empty square to its board cell', () => {
    const stage = document.createElement('div');
    const board = document.createElement('div');
    board.innerHTML = '<svg><g data-square="d9"></g></svg>';
    stage.append(board);
    document.body.append(stage);
    createLiveFinishBadges(stage, board).play('game-1', [
      { square: 'd9', kind: 'loser', icon: 'loss', label: 'Den entered' },
    ]);
    const badge = stage.querySelector<HTMLElement>('.finish-badge');
    expect(badge?.dataset.finishSquare).toBe('d9');
    // happy-dom lays nothing out, so a zero-size anchor hides; the lookup is what is under test.
    expect(badge?.hidden).toBe(true);
  });

  it('holds the animation back when asked', () => {
    const { stage, badges } = setup();
    badges.play('game-1', played, { delayMs: 650 });
    const layer = stage.querySelector<HTMLElement>('.finish-badges');
    expect(layer?.style.getPropertyValue('--finish-badge-delay')).toBe('650ms');
  });

  it('draws nothing until played', () => {
    const { badges, layer } = setup();
    badges.sync('game-1', true);
    expect(layer()).toBeNull();
  });
});
