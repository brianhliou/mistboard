// @vitest-environment happy-dom
import { createInitialJieqiState, getJieqiPlayerView, type JieqiMove } from '@mistboard/game';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeAccountPreference } from './account-preferences.js';
import type { RepetitionWarning } from './jieqi-repetition-warning.js';
import { renderJieqiBoardSvg } from './live-jieqi-render.js';
import { createJieqiRepetitionWarningUi } from './live-jieqi-repetition-warning.js';

const move: JieqiMove = { from: 'a2', to: 'b2' };
const analysis: RepetitionWarning = {
  losingMoves: [{ move, loser: 'red', reason: 'perpetual-chase' }],
};
const base = getJieqiPlayerView(createInitialJieqiState('ui'), 'red');
const view = { ...base, board: { ...base.board, a2: base.board.a1 }, legalMoves: [move] };
let board: HTMLElement;
let ui: ReturnType<typeof createJieqiRepetitionWarningUi>;
beforeEach(() => {
  document.body.innerHTML = '<div class="board-stage"><div class="board"></div></div>';
  board = document.querySelector('.board')!;
  board.innerHTML = '<svg><g data-square="b2"><rect/></g><g data-square="a2"><rect/></g></svg>';
  writeAccountPreference('confirmGameActions', true);
  if (!HTMLDialogElement.prototype.showModal)
    HTMLDialogElement.prototype.showModal = function () {
      this.open = true;
    };
  ui = createJieqiRepetitionWarningUi(board, vi.fn());
  ui.update(view, analysis, true);
});
afterEach(() => {
  ui.destroy();
  document.body.replaceChildren();
});

function button(which: 'confirm' | 'cancel') {
  return document.querySelector<HTMLButtonElement>(`.confirm-dialog-${which}`)!;
}

describe('Jieqi repetition loss dialog', () => {
  it.each(['perpetual-check', 'perpetual-chase'] as const)('labels and confirms %s', (reason) => {
    ui.update(view, { losingMoves: [{ move, loser: 'red', reason }] }, true);
    ui.select('a2', [move]);
    expect(document.querySelector('[data-repetition-label=b2]')?.textContent).toBe(
      `Loses: ${reason.replace('-', ' ')}`,
    );
    const play = vi.fn();
    expect(ui.allowMove(move, play)).toBe(false);
    expect(document.querySelector('.confirm-dialog-title')?.textContent).toBe(
      `Lose by ${reason.replace('-', ' ')}?`,
    );
    expect(document.querySelector('.confirm-dialog-body')?.textContent).toBe(
      'This move repeats the position a third time, and you lose the game.',
    );
    expect(button('confirm').textContent).toBe('Play move');
    expect(button('confirm').classList.contains('danger')).toBe(true);
    expect(ui.preview(view).board.b2).toEqual(view.board.a2);
    expect(ui.preview(view).board.a2).toBeUndefined();
    expect(view.board.a2).toBeDefined();
    ui.update(view, analysis, true); // a clock render preserves the pending move
    expect(play).not.toHaveBeenCalled();
    button('confirm').click();
    expect(play).toHaveBeenCalledOnce();
    expect(ui.preview(view)).toBe(view);
  });

  it('Cancel and Escape restore the origin without playing', () => {
    const play = vi.fn();
    for (const dismissWithEscape of [false, true]) {
      ui.allowMove(move, play);
      if (dismissWithEscape) document.querySelector<HTMLDialogElement>('dialog')!.close();
      else button('cancel').click();
      expect(ui.preview(view)).toBe(view);
      expect(document.querySelector('dialog')).toBeNull();
    }
    expect(play).not.toHaveBeenCalled();
  });

  it('preference off plays immediately while keeping labels', () => {
    writeAccountPreference('confirmGameActions', false);
    ui.select('a2', [move]);
    expect(ui.allowMove(move, vi.fn())).toBe(true);
    expect(document.querySelector('dialog')).toBeNull();
    expect([...ui.losingDestinations('a2')]).toEqual(['b2']);
    expect(document.querySelector('[data-repetition-label=b2]')).not.toBeNull();
  });

  it('a changed position, replay, disconnect, finish or destroy dismisses without playing', () => {
    const play = vi.fn();
    for (const change of ['move', 'board', 'inactive', 'finish', 'destroy']) {
      ui.update(view, analysis, true);
      ui.allowMove(move, play);
      const old = button('confirm');
      if (change === 'destroy') ui.destroy();
      else
        ui.update(
          change === 'move'
            ? { ...view, moveNumber: view.moveNumber + 1 }
            : change === 'board'
              ? { ...view, board: { ...view.board, a2: undefined } }
              : change === 'finish'
                ? { ...view, status: { type: 'finished', winner: 'black', reason: 'resignation' } }
                : view,
          analysis,
          change !== 'inactive',
        );
      expect(document.querySelector('dialog')).toBeNull();
      old.click(); // stale close handlers must never send a move
      expect(play).not.toHaveBeenCalled();
      expect(ui.preview(view)).toBe(view);
    }
  });

  it('labels only the selected piece and clears on deselect', () => {
    ui.select('b4', [move]);
    expect(document.querySelector('[data-repetition-label]')).toBeNull();
    ui.select('a2', [move]);
    expect(document.querySelector('[data-repetition-label]')).not.toBeNull();
    ui.select(null, [move]);
    expect(document.querySelector('[data-repetition-label]')).toBeNull();
  });
  it('replaces the normal dot with an edged red ring in either orientation and board layout', () => {
    for (const orientation of ['red', 'black'] as const)
      for (const layout of ['intersection', 'cell'] as const) {
        board.innerHTML = renderJieqiBoardSvg(view, orientation, {
          interactive: true,
          layout,
          selectedSquare: 'a2',
          legalMoves: [move],
          repetitionLossPoints: new Set(['b2']),
        });
        const target = board.querySelector('[data-square=b2]')!;
        expect(target.querySelector('.jieqi-hint')).toBeNull();
        expect(target.querySelector('.jieqi-repetition-ring')).not.toBeNull();
        expect(target.querySelector('.jieqi-repetition-ring-edge')).not.toBeNull();
        expect(target.querySelector('.jieqi-target-hover--loss')).not.toBeNull();
        const hit = target.querySelector('rect')!.outerHTML;
        board.innerHTML = renderJieqiBoardSvg(view, orientation, {
          interactive: true,
          layout,
          selectedSquare: 'a2',
          legalMoves: [move],
        });
        expect(board.querySelector('[data-repetition-loss]')).toBeNull();
        expect(board.querySelector('[data-square=b2] .jieqi-hint')).not.toBeNull();
        expect(board.querySelector('[data-square=b2] rect')!.outerHTML).toBe(hit);
      }
  });
});
