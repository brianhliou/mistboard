import type { PlayerView } from '@mistboard/game';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { track } from './analytics.js';
import { createGameTable } from './game-table.js';
import { renderRoomActions } from './live-room-actions.js';
import { liveState } from './live-state.js';
import { renderGameResult, renderPostGameActions } from './postgame-panel.js';

vi.mock('./analytics.js', () => ({ track: vi.fn() }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  document.body.replaceChildren();
  liveState.state = null;
  liveState.seat = 'spectator';
  liveState.roomMode = 'pvp';
});

function room(width: number, mode: 'pve' | 'pvp' = 'pve', seated = true) {
  const media = new EventTarget() as MediaQueryList;
  Object.defineProperty(media, 'matches', { value: width <= 600, writable: true });
  vi.spyOn(window, 'matchMedia').mockReturnValue(media);
  const table = createGameTable();
  const cluster = document.createElement('div');
  cluster.className = 'live-review__cluster';
  cluster.append(table.el);
  document.body.replaceChildren(cluster);
  liveState.room = 'phone-postgame';
  liveState.roomMode = mode;
  liveState.seat = seated ? 'white' : 'spectator';
  liveState.events = [];
  liveState.state = {
    id: liveState.room,
    variant: 'dark-chess',
    board: {},
    visibleSquares: [],
    legalMoves: [],
    status: { type: 'finished', winner: 'white', reason: 'king-captured' },
    perspective: 'white',
    moveNumber: 4,
  } as PlayerView;
  const render = () => renderRoomActions(table.refs, { sendSocket: vi.fn(() => true) });
  renderGameResult(table.refs.actionSection, { score: '1-0', summary: 'White wins' });
  render();
  const sheet = () => cluster.querySelector<HTMLDialogElement>('.postgame-sheet');
  const trigger = () => cluster.querySelector<HTMLButtonElement>('.postgame-sheet-toggle');
  return { table, cluster, sheet, trigger, render, media };
}

describe('phone post-game sheet', () => {
  it.each([360, 390])('opens the result and every seated bot action at %ipx', (width) => {
    const { sheet, trigger } = room(width);
    expect(sheet()?.open).toBe(true);
    expect(sheet()?.textContent).toContain('White wins');
    expect(sheet()?.textContent).toContain('1-0');
    expect(
      [...sheet()!.querySelectorAll('.postgame-actions > *')].map((el) => el.textContent),
    ).toEqual(['Rematch', 'New game', 'Review game', 'Challenge a friend']);
    expect(trigger()?.hidden).toBe(false);
    expect(trigger()?.getAttribute('aria-expanded')).toBe('true');
  });

  it('stays dismissed across snapshots and reopens from the bar', () => {
    const { sheet, trigger, render } = room(390);
    sheet()?.querySelector<HTMLButtonElement>('.postgame-sheet__close')?.click();
    expect(sheet()?.open).toBe(false);
    render();
    expect(sheet()?.open).toBe(false);
    expect(trigger()?.getAttribute('aria-expanded')).toBe('false');
    trigger()?.click();
    expect(sheet()?.open).toBe(true);
  });

  it('keeps the PvP offer and its current controls in the sheet', () => {
    const { sheet, render } = room(360, 'pvp');
    expect(sheet()?.querySelector('.room-rematch')).not.toBeNull();
    expect(sheet()?.textContent).toContain('New opponent');
    render();
    expect(sheet()?.querySelectorAll('.room-rematch')).toHaveLength(1);
    expect(sheet()?.textContent).not.toContain('Challenge a friend');
  });

  it('uses the original review handler and analytics name after reopening', () => {
    const { sheet, trigger } = room(390);
    sheet()?.close();
    trigger()?.click();
    const review = sheet()?.querySelector<HTMLAnchorElement>('a[href="/game/phone-postgame"]');
    review?.addEventListener('click', (event) => event.preventDefault());
    review?.click();
    expect(track).toHaveBeenCalledWith('postgame_action', {
      action: 'review',
      variant: 'dark-chess',
      mode: 'pve',
    });
  });

  it('retains every action name and the rematch callback', () => {
    const { table, sheet } = room(390);
    const rematch = document.createElement('button');
    const onRematch = vi.fn();
    rematch.addEventListener('click', onRematch);
    renderPostGameActions(table.refs.roomActions, {
      variant: 'dark-chess',
      mode: 'pve',
      seated: true,
      rematch,
      reviewHref: '/game/test',
    });
    sheet()?.addEventListener('click', (event) => event.preventDefault());
    const actions = sheet()!.querySelectorAll<HTMLElement>('.postgame-actions > *');
    for (const [index, action] of [
      'rematch',
      'new_opponent',
      'review',
      'challenge_friend',
    ].entries()) {
      actions[index].click();
      expect(track).toHaveBeenLastCalledWith('postgame_action', {
        action,
        variant: 'dark-chess',
        mode: 'pve',
      });
    }
    expect(onRematch).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledTimes(4);
  });

  it('dismisses with a downward swipe or Escape, but ignores canceled and sideways drags', () => {
    const { sheet, trigger } = room(390);
    const header = sheet()!.querySelector<HTMLElement>('.postgame-sheet__header')!;
    header.setPointerCapture = vi.fn();
    const pointer = (type: string, x: number, y: number) =>
      header.dispatchEvent(
        new PointerEvent(type, { pointerId: 1, button: 0, clientX: x, clientY: y }),
      );
    pointer('pointerdown', 150, 200);
    pointer('pointerup', 250, 210);
    expect(sheet()?.open).toBe(true);
    pointer('pointerdown', 150, 200);
    pointer('pointercancel', 150, 280);
    pointer('pointerup', 150, 290);
    expect(sheet()?.open).toBe(true);
    pointer('pointerdown', 150, 200);
    pointer('pointerup', 150, 280);
    expect(sheet()?.open).toBe(false);
    trigger()?.click();
    sheet()?.dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(sheet()?.open).toBe(false);
  });

  it('restores inline controls on desktop and preserves dismissal when returning to a phone', () => {
    const { table, sheet, media, trigger } = room(390);
    sheet()?.querySelector<HTMLButtonElement>('.postgame-sheet__close')?.click();
    Object.assign(media, { matches: false });
    media.dispatchEvent(new Event('change'));
    expect(table.refs.roomActions.querySelector(':scope > .postgame-actions')).not.toBeNull();
    expect(trigger()?.hidden).toBe(true);
    Object.assign(media, { matches: true });
    media.dispatchEvent(new Event('change'));
    expect(sheet()?.open).toBe(false);
    trigger()?.click();
    expect(sheet()?.open).toBe(true);
  });

  it('updates a late result and clears the sheet when play resumes', () => {
    const { table, sheet, render, trigger } = room(390);
    renderGameResult(table.refs.actionSection, { score: '½-½', summary: 'Draw' });
    expect(sheet()?.querySelector('.postgame-sheet__result')?.textContent).toBe('½-½Draw');
    liveState.state!.status = { type: 'playing', turn: 'white' };
    render();
    expect(sheet()).toBeNull();
    expect(trigger()).toBeNull();
    expect(table.refs.roomActions.dataset.postgameSheet).toBeUndefined();
  });

  it('leaves desktop actions inline and keeps the spectator review shortcut', () => {
    const desktop = room(1200);
    expect(desktop.sheet()?.open ?? false).toBe(false);
    expect(
      desktop.table.refs.roomActions.querySelector(':scope > .postgame-actions'),
    ).not.toBeNull();
    expect(desktop.trigger()?.hidden ?? true).toBe(true);
    const spectator = room(390, 'pve', false);
    expect(spectator.sheet()).toBeNull();
    expect(
      spectator.table.refs.roomActions.querySelector('.postgame-actions--solo'),
    ).not.toBeNull();
  });
});
