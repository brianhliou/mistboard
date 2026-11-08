// @vitest-environment happy-dom
import { createInitialJieqiState, getJieqiPlayerView, type JieqiMove } from '@mistboard/game';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepetitionWarning } from './jieqi-repetition-warning.js';
import { noticeReadMs } from './live-banqi-chase-bubble.js';
import { renderJieqiBoardSvg } from './live-jieqi-render.js';
import { createJieqiRepetitionWarningUi } from './live-jieqi-repetition-warning.js';

const move: JieqiMove = { from: 'a2', to: 'b2' };
const analysis: RepetitionWarning = {
  headsUp: { loser: 'red', reason: 'perpetual-chase' },
  losingMoves: [{ move, loser: 'red', reason: 'perpetual-chase' }],
};
const view = {
  ...getJieqiPlayerView(createInitialJieqiState('ui'), 'red'),
  lastMove: { from: 'a6', to: 'b4' } as JieqiMove,
};
let board: HTMLElement;
let ui: ReturnType<typeof createJieqiRepetitionWarningUi>;
beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div class="board-stage"><div class="board"></div></div>';
  board = document.querySelector('.board')!;
  board.innerHTML =
    '<svg><g data-square="b2"><rect/></g><g data-square="a2"><rect/></g><g data-square="b4"><rect/></g></svg>';
});
afterEach(() => {
  ui?.destroy();
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('?repwarn UI', () => {
  it.each(['mouse', 'touch'])(
    'label-confirm arms with %s copy, survives rendering and confirms without a bubble',
    (pointerType) => {
      ui = createJieqiRepetitionWarningUi(board, 'label-confirm');
      ui.update(view, analysis, true);
      board.innerHTML = renderJieqiBoardSvg(view, 'red', {
        interactive: true,
        selectedSquare: 'a2',
        legalMoves: [move],
        repetitionLossPoints: ui.losingDestinations('a2'),
      });
      ui.select('a2', [move]);
      const pointDown = (point: string) =>
        board
          .querySelector(`[data-square=${point}] rect`)!
          .dispatchEvent(
            new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType }),
          );
      pointDown('b2');
      expect(ui.allowMove(move)).toBe(false);
      ui.update(view, analysis, true);
      ui.select('a2', [move]);
      expect(document.querySelector('.jieqi-repetition-label')?.textContent).toBe(
        pointerType === 'touch' ? 'Tap again to lose' : 'Click again to lose',
      );
      expect(
        board
          .querySelector('[data-repetition-loss=b2]')
          ?.classList.contains('jieqi-repetition-ring--armed'),
      ).toBe(true);
      expect(document.querySelector('.jieqi-repetition-bubble')).toBeNull();
      vi.advanceTimersByTime(60_000); // this mode has no notice expiry
      pointDown('b2');
      expect(ui.allowMove(move)).toBe(true);
      expect(document.querySelector('.jieqi-repetition-label')).toBeNull();
    },
  );
  it('label-confirm keeps selection/confirmation for a second drop, but resets on other interactions', () => {
    ui = createJieqiRepetitionWarningUi(board, 'label-confirm');
    ui.update(view, analysis, true);
    ui.select('a2', [move]);
    ui.dragStart('a2');
    expect(ui.allowMove(move)).toBe(false);
    ui.select('a2', [move]); // first drop snaps back to selected origin
    board
      .querySelector('[data-square=a2] rect')!
      .dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }),
      );
    ui.dragStart('a2');
    ui.select('a2', [move]);
    expect(ui.allowMove(move)).toBe(true);
    ui.select('a2', [move]);
    expect(ui.allowMove(move)).toBe(false);
    board
      .querySelector('[data-square=b4] rect')!
      .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    expect(document.querySelector('.jieqi-repetition-label')?.textContent).toBe(
      'Loses: perpetual chase',
    );
    expect(ui.allowMove(move)).toBe(false);
    ui.cancel();
    expect(document.querySelector('.jieqi-repetition-label')?.textContent).toBe(
      'Loses: perpetual chase',
    );
    expect(ui.allowMove(move)).toBe(false);
    ui.update({ ...view, moveNumber: view.moveNumber + 1 }, analysis, true);
    ui.select('a2', [move]);
    expect(document.querySelector('.jieqi-repetition-label')?.textContent).toBe(
      'Loses: perpetual chase',
    );
    expect(ui.allowMove(move)).toBe(false);
    ui.select(null, [move]);
    expect(document.querySelector('.jieqi-repetition-label')).toBeNull();
  });
  it.each(['heads-up', 'mark', 'label'] as const)(
    '%s plays immediately and only heads-up shows the notice',
    (mode) => {
      ui = createJieqiRepetitionWarningUi(board, mode);
      ui.update(view, analysis, true);
      expect(document.querySelector('[role=status]')?.textContent ?? null).toBe(
        mode === 'heads-up' ? 'One more repeat and Red loses by perpetual chase.' : null,
      );
      expect([...ui.losingDestinations('a2')]).toEqual(mode === 'heads-up' ? [] : ['b2']);
      expect(ui.allowMove(move)).toBe(true);
    },
  );
  it.each(['perpetual-check', 'perpetual-chase'] as const)(
    'labels only selected losing points for %s and clears on deselect or move',
    (reason) => {
      ui = createJieqiRepetitionWarningUi(board, 'label');
      ui.update(
        view,
        {
          ...analysis,
          losingMoves: [{ move, loser: 'red', reason }],
        },
        true,
      );
      expect(document.querySelector('.jieqi-repetition-label')).toBeNull();
      ui.select('b4', [move]);
      expect(document.querySelector('.jieqi-repetition-label')).toBeNull();
      ui.select('a2', [move]);
      const label = document.querySelector('[data-repetition-label=b2]')!;
      expect(label.textContent).toBe(`Loses: ${reason.replace('-', ' ')}`);
      expect(label.parentElement).toBe(board.parentElement);
      expect(document.querySelector('.jieqi-repetition-bubble')).toBeNull();
      ui.select(null, [move]);
      expect(document.querySelector('.jieqi-repetition-label')).toBeNull();
      ui.select('a2', [move]);
      expect(ui.allowMove(move)).toBe(true);
      expect(document.querySelector('.jieqi-repetition-label')).toBeNull();
    },
  );
  it('labels every losing point, survives a render, and clears on changed or inactive views', () => {
    ui = createJieqiRepetitionWarningUi(board, 'label');
    const next = {
      ...analysis,
      losingMoves: [
        ...analysis.losingMoves,
        { ...analysis.losingMoves[0]!, move: { from: 'a2', to: 'b4' } as JieqiMove },
      ],
    };
    for (const inactive of [false, true]) {
      ui.update(view, next, true);
      ui.select('a2', [move, { from: 'a2', to: 'b4' }]);
      ui.update(view, next, true);
      ui.sync();
      expect(document.querySelectorAll('.jieqi-repetition-label')).toHaveLength(2);
      ui.update({ ...view, moveNumber: view.moveNumber + 1 }, next, !inactive);
      expect(document.querySelectorAll('.jieqi-repetition-label')).toHaveLength(0);
      if (inactive) {
        ui.select('a2', [move]);
        expect(document.querySelectorAll('.jieqi-repetition-label')).toHaveLength(0);
      }
    }
  });
  it('confirm waits once, retains the ring and allows the same point on the second tap', () => {
    ui = createJieqiRepetitionWarningUi(board, 'confirm');
    ui.update(view, analysis, true);
    expect(document.querySelector('[role=status]')).toBeNull();
    expect(ui.allowMove(move)).toBe(false);
    expect(document.querySelector('[role=status]')?.textContent).toContain(
      'Perpetual chase loses.',
    );
    expect([...ui.losingDestinations('a2')]).toEqual(['b2']);
    board
      .querySelector('[data-square=b2] rect')!
      .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    ui.update(view, analysis, true); // a re-render must not erase confirmation
    expect(ui.allowMove(move)).toBe(true);
    expect(document.querySelector('[role=status]')).toBeNull();
  });
  it.each(['other-point', 'outside', 'annotation', 'keyboard', 'scroll', 'wheel', 'drag'])(
    '%s cancels the pending confirmation',
    (interaction) => {
      ui = createJieqiRepetitionWarningUi(board, 'confirm');
      ui.update(view, analysis, true);
      ui.allowMove(move);
      if (interaction === 'drag') ui.cancel();
      else if (interaction === 'keyboard')
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      else if (interaction === 'scroll' || interaction === 'wheel')
        document.dispatchEvent(new Event(interaction));
      else {
        const target =
          interaction === 'outside'
            ? document.body
            : board.querySelector(
                `[data-square=${interaction === 'annotation' ? 'b2' : 'a2'}] rect`,
              )!;
        target.dispatchEvent(
          new PointerEvent('pointerdown', {
            bubbles: true,
            button: interaction === 'annotation' ? 2 : 0,
          }),
        );
      }
      expect(ui.allowMove(move)).toBe(false);
    },
  );
  it('expires a heads-up after read time and does not reshow it on a clock render', () => {
    ui = createJieqiRepetitionWarningUi(board, 'heads-up');
    ui.update(view, analysis, true);
    const text = document.querySelector('[role=status]')!.textContent!;
    ui.update(view, analysis, true);
    expect(document.querySelector('[role=status]')?.textContent).toBe(text);
    vi.advanceTimersByTime(noticeReadMs(text));
    ui.update(view, analysis, true);
    expect(document.querySelector('[role=status]')).toBeNull();
  });
  it('expires a pending confirmation after read time', () => {
    ui = createJieqiRepetitionWarningUi(board, 'confirm');
    ui.update(view, analysis, true);
    vi.advanceTimersByTime(10_000);
    ui.update(view, analysis, true);
    expect(document.querySelector('[role=status]')).toBeNull();
    ui.allowMove(move);
    const text = document.querySelector('[role=status]')!.textContent!;
    vi.advanceTimersByTime(noticeReadMs(text));
    expect(ui.allowMove(move)).toBe(false);
  });
  it('clears on a new position, replay, disconnect, or finish', () => {
    ui = createJieqiRepetitionWarningUi(board, 'confirm');
    ui.update(view, analysis, true);
    ui.allowMove(move);
    ui.update({ ...view, moveNumber: view.moveNumber + 1 }, analysis, true);
    expect(ui.allowMove(move)).toBe(false);
    ui.update(view, analysis, false);
    expect(document.querySelector('[role=status]')).toBeNull();
    expect([...ui.losingDestinations('a2')]).toEqual([]);
    ui.update(
      { ...view, status: { type: 'finished', winner: 'black', reason: 'perpetual-chase' } },
      analysis,
      true,
    );
    expect(document.querySelector('[role=status]')).toBeNull();
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
