import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createStepCard, type StepCardGame, type StepCardMotion } from './article-step-card.js';
import type { RawSvgStepperBlock } from './articles/types.js';
import { renderBlock } from './articles.js';
import { type Article, type ArticleBlock, articles } from './articles-data.js';
import { variantDiagramGlides } from './board-anim.js';
import { findPieceSlot, pieceSlot, pieceSlotCentre } from './board-piece-slot.js';

// The article step card glides the piece that moved on a one-step move, from
// the slots the painted board keys (board-piece-slot.ts). A toy board: squares
// a..d in a row, 100 user units apart.
const CENTRE: Record<string, { x: number; y: number }> = {
  a: { x: 50, y: 50 },
  b: { x: 150, y: 50 },
  c: { x: 250, y: 50 },
  d: { x: 350, y: 50 },
};
// Position i's pieces, and the move into it.
const POSITIONS: Array<Record<string, string>> = [
  { a: 'rook', d: 'tile' },
  { b: 'rook', d: 'tile' },
  { c: 'rook', d: 'tile' },
  { c: 'rook', d: 'flipped' },
];
const MOTIONS: Array<StepCardMotion | null> = [
  null,
  { from: 'a', to: 'b' },
  { from: 'b', to: 'c' },
  { from: 'd', to: 'd' },
];

function toyGame(): StepCardGame {
  return {
    count: POSITIONS.length,
    paint(board, index) {
      const pieces = Object.entries(POSITIONS[index]!)
        .map(([sq, name]) => pieceSlot(sq, CENTRE[sq]!, `<text>${name}</text>`))
        .join('');
      board.innerHTML = `<svg viewBox="0 0 400 100">${pieces}</svg>`;
    },
    motion: (index) => MOTIONS[index] ?? null,
  };
}

let animate: ReturnType<typeof vi.fn>;
beforeEach(() => {
  // happy-dom has no WAAPI; glideSvgPiece feature-checks for it.
  animate = vi.fn();
  Object.assign(Element.prototype, { animate, getAnimations: () => [] });
});
afterEach(() => {
  delete (Element.prototype as { animate?: unknown }).animate;
  delete (Element.prototype as { getAnimations?: unknown }).getAnimations;
  document.body.replaceChildren();
});

/** Glide calls on piece slots: the slot's square and the keyframe it starts from. */
const glides = () =>
  animate.mock.contexts
    .map((ctx, i) => ({ ctx: ctx as Element, frames: animate.mock.calls[i]![0] }))
    .filter(({ ctx }) => ctx.hasAttribute('data-piece-square'))
    .map(({ ctx, frames }) => ({
      square: ctx.getAttribute('data-piece-square'),
      from: frames[0].transform,
    }));

const press = (card: HTMLElement, key: string) =>
  card
    .querySelector('.embed-card')!
    .dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

describe('article step card glide', () => {
  test('a step forward glides the mover in from its origin', () => {
    const card = createStepCard({}, toyGame());
    document.body.append(card.el);
    press(card.el, 'ArrowRight');
    // a -> b: the rook settles on b and starts 100 units left of it.
    expect(glides()).toEqual([{ square: 'b', from: 'translate(-100px, 0px)' }]);
  });

  test('a step back runs the move in reverse', () => {
    const card = createStepCard({}, toyGame());
    document.body.append(card.el);
    press(card.el, 'ArrowRight');
    animate.mockClear();
    press(card.el, 'ArrowLeft');
    expect(glides()).toEqual([{ square: 'a', from: 'translate(100px, 0px)' }]);
  });

  test('a jump of more than one step repaints without a glide', () => {
    const card = createStepCard({}, toyGame());
    document.body.append(card.el);
    press(card.el, 'End');
    expect(card.el.querySelector('[data-piece-square="c"]')).not.toBeNull();
    expect(glides()).toEqual([]);
  });

  test('a flip in place does not glide', () => {
    const card = createStepCard({}, { ...toyGame(), start: 2 });
    document.body.append(card.el);
    press(card.el, 'ArrowRight');
    expect(card.el.textContent).toContain('flipped');
    expect(glides()).toEqual([]);
  });

  test('a game without motion only repaints', () => {
    const { motion: _motion, ...still } = toyGame();
    const card = createStepCard({}, still);
    document.body.append(card.el);
    press(card.el, 'ArrowRight');
    expect(glides()).toEqual([]);
  });
});

describe('which variants glide', () => {
  test('open and hidden-identity glide; fog, concealed hands and unknown ids do not', () => {
    expect(variantDiagramGlides('xiangqi')).toBe(true);
    expect(variantDiagramGlides('banqi')).toBe(true);
    expect(variantDiagramGlides('jieqi')).toBe(true);
    expect(variantDiagramGlides('dark-xiangqi')).toBe(false);
    expect(variantDiagramGlides('dark-chess')).toBe(false);
    expect(variantDiagramGlides('mahjong')).toBe(false);
    expect(variantDiagramGlides('not-a-variant')).toBe(false);
    expect(variantDiagramGlides(undefined)).toBe(false);
  });
});

function articleBlocks(article: Article): ArticleBlock[] {
  return [...(article.intro ?? []), ...article.sections.flatMap((section) => section.blocks ?? [])];
}

const steppers = articles.flatMap((article) =>
  articleBlocks(article)
    .filter((block): block is RawSvgStepperBlock => block.kind === 'raw-svg-stepper')
    .map((block, i) => ({ label: `${article.slug}:stepper:${i}`, block })),
);

const stepSvg = (block: RawSvgStepperBlock, i: number): string => {
  const svg = block.steps[i]!.svg;
  return typeof svg === 'function' ? svg() : svg;
};

describe('raw-svg-stepper blocks', () => {
  test('every stepper whose steps carry motion names its variant', () => {
    const missing = steppers
      .filter(({ block }) => block.steps.some((step) => step.motion) && !block.gameSpecId)
      .map(({ label }) => label);
    expect(missing).toEqual([]);
  });

  test("every motion's squares are keyed slots in the boards before and after it", () => {
    const host = document.createElement('div');
    const problems: string[] = [];
    let checked = 0;
    for (const { label, block } of steppers) {
      block.steps.forEach((step, i) => {
        if (!step.motion || i === 0) return;
        checked += 1;
        host.innerHTML = stepSvg(block, i - 1);
        if (!pieceSlotCentre(findPieceSlot(host, step.motion.from)))
          problems.push(`${label}:${i} no slot on ${step.motion.from} before`);
        host.innerHTML = stepSvg(block, i);
        if (!pieceSlotCentre(findPieceSlot(host, step.motion.to)))
          problems.push(`${label}:${i} no slot on ${step.motion.to} after`);
      });
    }
    expect(problems).toEqual([]);
    expect(checked).toBeGreaterThan(0);
  });

  test('the banqi chase steppers glide one step', () => {
    const chase = steppers.filter(({ label }) => label.startsWith('banqi-perpetual-chase:'));
    expect(chase.length).toBe(2);
    for (const { block } of chase) {
      expect(block.gameSpecId).toBe('banqi');
      animate.mockClear();
      const figure = renderBlock(block);
      document.body.append(figure);
      press(figure, 'ArrowRight');
      expect(glides().map((g) => g.square)).toEqual([block.steps[1]!.motion!.to]);
      figure.remove();
    }
  });

  test('a stepper that is fog, or names no variant, stays static', () => {
    // The banqi chase glides (above); the same steps under a fog id, an unknown
    // id or none must not, though every slot and motion is in place.
    const chase = steppers.find(({ label }) => label.startsWith('banqi-perpetual-chase:'))!.block;
    for (const gameSpecId of ['dark-xiangqi', 'dark-chess', 'mahjong', 'nope', undefined]) {
      const figure = renderBlock({ ...chase, gameSpecId } as RawSvgStepperBlock);
      document.body.append(figure);
      press(figure, 'ArrowRight');
      figure.remove();
    }
    // The article's own fog steppers declare their variant and stay static.
    const fog = steppers.filter(({ block }) => block.gameSpecId === 'dark-xiangqi');
    expect(fog.length).toBe(2);
    for (const { block } of fog) {
      const figure = renderBlock(block);
      document.body.append(figure);
      press(figure, 'ArrowRight');
      figure.remove();
    }
    expect(glides()).toEqual([]);
  });
});
