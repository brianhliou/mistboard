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
      reason: 'resignation',
      generalSquare: (color) => GENERALS[color],
    });
    expect(badges).toEqual([
      { square: 'e1', kind: 'winner', icon: 'crown', label: 'Winner' },
      { square: 'd10', kind: 'loser', icon: 'resign', label: 'Resignation' },
    ]);
  });

  it('slashes only the mated general on a checkmate: no crown, no pill', () => {
    for (const winner of COLORS) {
      const badges = finishBadgesForResult({
        colors: COLORS,
        winner,
        reason: 'checkmate',
        generalSquare: (color) => GENERALS[color],
      });
      const mated = winner === 'red' ? 'd10' : 'e1';
      expect(badges).toEqual([{ square: mated, kind: 'mated', icon: 'slash', label: '' }]);
    }
  });

  it('keeps both badges on a timeout', () => {
    const badges = finishBadgesForResult({
      colors: COLORS,
      winner: 'black',
      reason: 'timeout',
      generalSquare: (color) => GENERALS[color],
    });
    expect(badges).toEqual([
      { square: 'e1', kind: 'loser', icon: 'timeout', label: 'Timeout' },
      { square: 'd10', kind: 'winner', icon: 'crown', label: 'Winner' },
    ]);
  });

  it('keeps the badges for a captured general (duck, atomic)', () => {
    const badges = finishBadgesForResult({
      colors: COLORS,
      winner: 'red',
      reason: 'general-captured',
      generalSquare: (color) => GENERALS[color],
    });
    expect(badges.map((badge) => [badge.kind, badge.icon])).toEqual([
      ['winner', 'crown'],
      ['loser', 'loss'],
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
    expect(badges).toEqual([
      { square: 'e1', kind: 'draw', icon: 'draw', label: 'Repetition' },
      { square: 'd10', kind: 'draw', icon: 'draw', label: 'Repetition' },
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

  it('plays again from the start each time the viewer steps back onto the final position', () => {
    const { stage, badges, layer } = setup();
    badges.play('game-1', played);
    const first = layer();
    badges.sync('game-1', false);
    expect(layer()).toBeNull();
    badges.sync('game-1', true);
    expect(layer()).not.toBeNull();
    expect(layer()).not.toBe(first);
    expect(stage.querySelectorAll('.finish-badge')).toHaveLength(2);
  });

  it('keeps exactly one layer when the viewer steps on and off quickly', () => {
    const { stage, badges } = setup();
    badges.play('game-1', played);
    for (let i = 0; i < 20; i += 1) {
      badges.sync('game-1', i % 2 === 0);
      badges.sync('game-1', true);
    }
    expect(stage.querySelectorAll('.finish-badges')).toHaveLength(1);
    expect(stage.querySelectorAll('.finish-badge')).toHaveLength(2);
  });

  it('never plays for a game it did not see finish, and forgets a game once another is in the room', () => {
    const { badges, layer } = setup();
    badges.sync('game-1', true);
    expect(layer()).toBeNull();
    badges.play('game-1', played);
    badges.sync('game-2', true);
    badges.sync('game-1', true);
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

  const mated = finishBadgesForResult({
    colors: COLORS,
    winner: 'red',
    reason: 'checkmate',
    generalSquare: (color) => GENERALS[color],
  });

  it('draws the checkmate slash alone: one mark on the mated general, no disc fill, no pill', () => {
    const { stage, badges } = setup();
    badges.play('game-1', mated);
    const els = [...stage.querySelectorAll<HTMLElement>('.finish-badge')];
    expect(els.map((el) => el.dataset.finishSquare)).toEqual(['d10']);
    expect(els[0]?.classList.contains('finish-badge--mated')).toBe(true);
    expect(els[0]?.getAttribute('aria-hidden')).toBe('true');
    expect(stage.querySelector('.finish-badge__pill')).toBeNull();
    // Two half-strokes from the centre, each with a light under-stroke.
    const halves = [...stage.querySelectorAll('.finish-badge__slash')];
    expect(halves.map((path) => path.getAttribute('d'))).toEqual([
      'M12 12 19 5',
      'M12 12 5 19',
      'M12 12 19 5',
      'M12 12 5 19',
    ]);
    expect(halves.every((path) => path.getAttribute('pathLength') === '1')).toBe(true);
  });

  it('replays the slash from the start each time the viewer steps back onto the final position', () => {
    const { stage, badges, layer } = setup();
    badges.play('game-1', mated);
    const first = layer();
    for (let i = 0; i < 10; i += 1) {
      badges.sync('game-1', false);
      expect(layer()).toBeNull();
      badges.sync('game-1', true);
    }
    expect(layer()).not.toBe(first);
    expect(stage.querySelectorAll('.finish-badges')).toHaveLength(1);
    const els = [...stage.querySelectorAll<HTMLElement>('.finish-badge')];
    expect(els.map((el) => [el.dataset.finishSquare, el.className])).toEqual([
      ['d10', 'finish-badge finish-badge--mated'],
    ]);
  });

  it('draws nothing until played', () => {
    const { badges, layer } = setup();
    badges.sync('game-1', true);
    expect(layer()).toBeNull();
  });
});
