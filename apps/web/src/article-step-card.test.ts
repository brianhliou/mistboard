import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createStepCard,
  type StepCard,
  type StepCardGame,
  type StepCardOptions,
} from './article-step-card.js';
import { installMoveNavKeyboard } from './move-nav-bar.js';

const cards: StepCard[] = [];
const controllers: AbortController[] = [];

afterEach(() => {
  for (const card of cards) card.destroy();
  for (const controller of controllers) controller.abort();
  cards.length = 0;
  controllers.length = 0;
  document.body.replaceChildren();
});

function mount(game: Partial<StepCardGame> = {}, options: StepCardOptions = {}) {
  const paint = vi.fn((board: HTMLElement, index: number) => {
    board.textContent = `Position ${index}`;
  });
  const card = createStepCard(options, { count: 4, paint, ...game });
  cards.push(card);
  document.body.append(card.el);
  const frame = card.el.querySelector<HTMLElement>('.embed-card')!;
  const position = () => card.el.querySelector('.embed-card-status')?.textContent;
  const button = (action: string) =>
    card.el.querySelector<HTMLButtonElement>(`[data-replay="${action}"]`)!;
  return { card, frame, position, button, paint };
}

function key(target: HTMLElement, key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

describe('article step card move bar', () => {
  it('uses the compact shared bar with direct first/previous/next/last controls', () => {
    const { card, position, button } = mount();
    const bar = card.el.querySelector('.move-nav-bar--compact');
    expect(bar).not.toBeNull();
    expect(
      [...bar!.querySelectorAll<HTMLButtonElement>('button')].map((b) => b.dataset.replay),
    ).toEqual(['first', 'prev', 'next', 'latest']);
    expect(bar!.querySelector('[data-move-nav-menu]')).toBeNull();
    expect(button('first').disabled).toBe(true);
    expect(button('prev').disabled).toBe(true);
    expect(button('next').disabled).toBe(false);
    expect(button('latest').disabled).toBe(false);

    button('next').click();
    expect(position()).toBe('1 / 3');
    button('latest').click();
    expect(position()).toBe('3 / 3');
    expect(button('next').disabled).toBe(true);
    expect(button('latest').disabled).toBe(true);
    button('prev').click();
    expect(position()).toBe('2 / 3');
    button('first').click();
    expect(position()).toBe('0 / 3');
    expect(card.el.querySelector('.embed-card-status')?.getAttribute('aria-live')).toBe('polite');
  });

  it('keeps the score sheet, narratives and bounds in sync after switching games', () => {
    const { card, button, position } = mount({
      moves: [{ label: 'a1-a2' }, { label: 'b1-b2' }, { label: 'a2-a3' }],
      result: 'Red wins',
    });
    card.el.querySelector<HTMLButtonElement>('[data-ply="2"]')!.click();
    expect(position()).toBe('2 / 3');
    button('prev').click();
    expect(
      card.el.querySelector('.review-move-list__move--current')?.getAttribute('data-ply'),
    ).toBe('1');
    expect(card.el.querySelector('.embed-card-result')?.textContent).toBe('Red wins');

    card.setGame({ count: 2, start: 20, paint: vi.fn(), narratives: ['Start', 'Finish'] });
    expect(position()).toBe('1 / 1');
    expect(button('latest').disabled).toBe(true);
    expect(button('first').disabled).toBe(false);
    expect(card.el.querySelector('.article-step-card-narrative')?.textContent).toBe('Finish');
    button('first').click();
    expect(card.el.querySelector('.article-step-card-narrative')?.textContent).toBe('Start');
    expect(card.el.querySelector('.embed-card-result')?.textContent).toBe('1 / 2');

    card.setGame({ count: 1, paint: vi.fn() });
    for (const action of ['first', 'prev', 'next', 'latest'])
      expect(button(action).disabled).toBe(true);
  });

  it.each([
    [undefined, ['First move', 'Previous move', 'Next move', 'Last move']],
    ['zh-Hans', ['第一步', '上一步', '下一步', '最后一步']],
    ['zh-Hant', ['第一步', '上一步', '下一步', '最後一步']],
  ] as const)('keeps article-language labels and tooltips (%s)', (lang, labels) => {
    const { button } = mount({}, { lang });
    const buttons = ['first', 'prev', 'next', 'latest'].map(button);
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(labels);
    expect(buttons.map((b) => b.title)).toEqual(labels);
  });
});

describe('article step card keyboard ownership', () => {
  it.each([
    ['ArrowLeft', 0],
    ['ArrowRight', 2],
    ['ArrowUp', 0],
    ['ArrowDown', 3],
    ['Home', 0],
    ['End', 3],
  ])('maps %s through the shared navigation map', (pressed, expected) => {
    const { frame, position } = mount({ start: 1 });
    frame.focus();
    expect(document.activeElement).toBe(frame);
    expect(key(frame, String(pressed)).defaultPrevented).toBe(true);
    expect(position()).toBe(`${expected} / 3`);
  });

  it('steps only the focused card and claims the key before page-wide playback', () => {
    const first = mount();
    const second = mount();
    const controller = new AbortController();
    controllers.push(controller);
    const pageStep = vi.fn();
    installMoveNavKeyboard(
      {
        stepBack: pageStep,
        stepForward: pageStep,
        toStart: pageStep,
        toEnd: pageStep,
      },
      controller.signal,
    );

    second.frame.focus();
    key(second.frame, 'ArrowRight');
    expect(first.position()).toBe('0 / 3');
    expect(second.position()).toBe('1 / 3');
    expect(pageStep).not.toHaveBeenCalled();
    first.frame.focus();
    key(first.frame, 'End');
    key(first.frame, 'ArrowRight');
    expect(first.position()).toBe('3 / 3');
    expect(second.position()).toBe('1 / 3');
    expect(pageStep).not.toHaveBeenCalled();

    key(document.body, 'ArrowRight');
    expect(pageStep).toHaveBeenCalledTimes(1);
    expect(first.position()).toBe('3 / 3');
    expect(second.position()).toBe('1 / 3');
  });

  it.each(['input', 'textarea', 'select', 'div'])('leaves keys in an editable %s alone', (tag) => {
    const { frame, position } = mount({ start: 1 });
    const editor = document.createElement(tag);
    if (tag === 'div') editor.contentEditable = 'true';
    frame.append(editor);
    for (const pressed of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) {
      expect(key(editor, pressed).defaultPrevented).toBe(false);
      expect(position()).toBe('1 / 3');
    }
  });

  it.each(['shiftKey', 'altKey', 'ctrlKey', 'metaKey'])(
    'leaves %s navigation alone',
    (modifier) => {
      const { frame, position } = mount({ start: 1 });
      expect(key(frame, 'ArrowRight', { [modifier]: true }).defaultPrevented).toBe(false);
      expect(position()).toBe('1 / 3');
    },
  );

  it('stands down when a child has already handled the key', () => {
    const { frame, position } = mount({ start: 1 });
    const child = document.createElement('button');
    child.addEventListener('keydown', (event) => event.preventDefault());
    frame.append(child);
    key(child, 'ArrowRight');
    expect(position()).toBe('1 / 3');
  });

  it('releases its keyboard listener on destroy', () => {
    const { card, frame, paint } = mount();
    card.destroy();
    paint.mockClear();
    expect(key(frame, 'ArrowRight').defaultPrevented).toBe(false);
    expect(paint).not.toHaveBeenCalled();
  });
});
