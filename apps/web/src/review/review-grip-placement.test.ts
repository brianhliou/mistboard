import { afterEach, describe, expect, it } from 'vitest';
import { placeReviewGrip } from './review-layout.js';

// happy-dom has no layout, so each box is stubbed with what a 1440x900 review
// measured: the stage runs 28px past the board into the seat-label margin.

function rect(left: number, top: number, right: number, bottom: number): DOMRect {
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    x: left,
    y: top,
  } as DOMRect;
}

function stageWith(slotBox: DOMRect): { stage: HTMLElement; slot: HTMLElement; grip: HTMLElement } {
  const stage = document.createElement('div');
  const slot = document.createElement('div');
  slot.className = 'review-stage__slot review-stage__slot--primary';
  const grip = document.createElement('button');
  grip.className = 'board-resize-grip board-resize-grip--unplaced';
  stage.append(slot, grip);
  document.body.append(stage);
  stage.getBoundingClientRect = () => rect(400, 80, 960, 730);
  slot.getBoundingClientRect = () => slotBox;
  return { stage, slot, grip };
}

describe('placeReviewGrip', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('puts the grip in the board corner, not the seat-label margin under it', () => {
    const { stage, grip } = stageWith(rect(400, 105, 956, 702));
    placeReviewGrip(stage, grip);
    expect(grip.style.right).toBe('4px');
    // 702 - 80 - 20: the grip's bottom edge on the board's, not the stage's 730.
    expect(grip.style.top).toBe('602px');
    expect(grip.classList.contains('board-resize-grip--unplaced')).toBe(false);
  });

  it('stays hidden until the slot has a laid-out box (a fresh chapter stage)', () => {
    const { stage, grip } = stageWith(rect(0, 0, 0, 0));
    placeReviewGrip(stage, grip);
    expect(grip.classList.contains('board-resize-grip--unplaced')).toBe(true);
    expect(grip.style.top).toBe('');
  });

  it('sits on the board above the fog "viewing as" row, not on its button', () => {
    const { stage, slot, grip } = stageWith(rect(400, 105, 956, 704));
    const board = document.createElement('div');
    board.getBoundingClientRect = () => rect(400, 105, 956, 662);
    const pov = document.createElement('div');
    pov.className = 'review-pov';
    pov.getBoundingClientRect = () => rect(400, 668, 956, 704);
    slot.append(board, pov);
    placeReviewGrip(stage, grip);
    // 662 - 80 - 20: the board's bottom, not the row's 704.
    expect(grip.style.top).toBe('562px');
  });
});
