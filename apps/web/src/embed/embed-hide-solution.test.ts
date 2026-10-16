// A problem framed without its answer: `?solution=hidden` (an article's embed
// block with hideSolution) opens the card on the start position with the score
// sheet, its comments and the result covered; the cover's button, or stepping
// forward, lifts it. Without the flag the card is unchanged.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { embedPathWithSolutionHidden, embedSolutionHiddenFromSearch } from './embed-route.js';
import { mountEmbedStudy } from './embed-study-page.js';

// A two-move chapter whose first move carries a comment that gives the line
// away, the shape of a helpmate chapter's annotated mainline.
const CHAPTER = {
  id: 'Ue0EgpS7',
  name: 'Two checks from one move',
  orientation: 'red',
  tags: { red: 'Red', black: 'Black', result: '1-0' },
  root: {
    root: {
      annotations: {
        comments: [{ text: 'The cannon screens the soldier.' }],
        shapes: [{ orig: 'h3', dest: 'e3', brush: 'green' }],
      },
      children: [
        {
          uci: 'h3e3',
          annotations: { comments: [{ text: 'The only move.' }] },
          children: [{ uci: 'h8e8' }],
        },
      ],
    },
  },
};

async function mount(
  options: { hideSolution?: boolean; startPly?: number | null } = {},
  chapter: object = CHAPTER,
) {
  vi.stubGlobal('fetch', async () => ({
    ok: true,
    status: 200,
    json: async () => ({ study: { id: 's', name: 'Helpmates in xiangqi' }, chapters: [chapter] }),
  }));
  const root = document.createElement('div');
  document.body.append(root);
  await mountEmbedStudy(root, { studyId: 's', chapterId: (chapter as { id: string }).id }, options);
  return root;
}

const q = <T extends Element = HTMLElement>(root: HTMLElement, selector: string) =>
  root.querySelector<T & HTMLElement>(selector);

function expectHidden(root: HTMLElement): void {
  const rail = q(root, '.embed-card-rail');
  const inner = q(root, '.embed-card-rail-inner');
  expect(rail?.classList.contains('embed-card-rail--solution-hidden')).toBe(true);
  expect(inner?.inert).toBe(true);
  expect(inner?.getAttribute('aria-hidden')).toBe('true');
  // The cover is the rail's only visible content: prompt and button.
  const cover = q(root, '.embed-card-solution-cover');
  expect(cover?.querySelector('.embed-card-solution-prompt')?.textContent).toBe('Find the mate.');
  expect(cover?.querySelector('button')?.textContent).toBe('Show the solution');
  // The chapter name says the idea: the frame wears the study's name instead.
  expect(q(root, '.embed-card-header')?.textContent).toBe('Helpmates in xiangqi · chapter 1');
  expect(q(root, '.embed-credit')?.textContent).toBe('Helpmates in xiangqi · mistboard.com');
  expect(document.title).toBe('Helpmates in xiangqi · Mistboard');
  // Nothing outside the inert sheet carries the answer.
  const outside = root.cloneNode(true) as HTMLElement;
  outside.querySelector('.embed-card-rail-inner')?.remove();
  for (const spoiler of ['Two checks', 'The only move', 'The cannon screens', 'Red wins']) {
    expect(outside.textContent, spoiler).not.toContain(spoiler);
  }
}

function expectRevealed(root: HTMLElement): void {
  expect(q(root, '.embed-card-solution-cover')).toBeNull();
  const inner = q(root, '.embed-card-rail-inner');
  expect(q(root, '.embed-card-rail')?.classList.contains('embed-card-rail--solution-hidden')).toBe(
    false,
  );
  expect(inner?.inert).toBe(false);
  expect(inner?.hasAttribute('aria-hidden')).toBe(false);
  expect(q(root, '.embed-card-result')?.textContent).toBe('Red wins');
  expect(root.querySelector('.review-move-list__note')?.textContent).toBe('The only move.');
  expect(q(root, '.embed-card-header')?.textContent).toBe('Two checks from one move');
  expect(q(root, '.embed-credit')?.textContent).toBe('Two checks from one move · mistboard.com');
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('study embed with the solution hidden', () => {
  it('opens on the start position with the sheet, comments and result covered', async () => {
    // Even a deep link to the end opens on the problem.
    const root = await mount({ hideSolution: true, startPly: 2 });
    expectHidden(root);
    expect(q(root, '.embed-card-status')?.textContent).toBe('0 / 2');
  });

  it('reveals everything on the button and stays at the start', async () => {
    const root = await mount({ hideSolution: true });
    q<HTMLButtonElement>(root, '.embed-card-solution-show')?.click();
    expectRevealed(root);
    expect(q(root, '.embed-card-status')?.textContent).toBe('0 / 2');
  });

  it('reveals on the first step forward', async () => {
    const root = await mount({ hideSolution: true });
    // Back from the start is not asking for the answer.
    q<HTMLButtonElement>(root, '[aria-label="Previous move"]')?.click();
    expectHidden(root);
    q<HTMLButtonElement>(root, '[aria-label="Next move"]')?.click();
    expectRevealed(root);
    expect(q(root, '.embed-card-status')?.textContent).toBe('1 / 2');
  });

  it('reveals on the arrow key and on jump to the end', async () => {
    const arrow = await mount({ hideSolution: true });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expectRevealed(arrow);
    document.body.replaceChildren();

    const end = await mount({ hideSolution: true });
    const items = Array.from(end.querySelectorAll<HTMLButtonElement>('.embed-card-menu-item'));
    items.find((b) => b.textContent === 'Jump to the end')?.click();
    expectRevealed(end);
    expect(q(end, '.embed-card-status')?.textContent).toBe('2 / 2');
  });

  it('leaves the card as it was without the flag', async () => {
    const root = await mount({ startPly: 2 });
    expect(q(root, '.embed-card-solution-cover')).toBeNull();
    expectRevealed(root);
    // The deep link is honoured when nothing is hidden.
    expect(q(root, '.embed-card-status')?.textContent).toBe('2 / 2');
  });
});

// A jungle chapter with an arrow drawn on its start position: the jungle and
// jieqi embeds draw a chapter's shapes, and one on the start is a hint.
const ARROW_CHAPTER = {
  id: 'Jngl5678',
  name: 'The rat swims',
  orientation: 'red',
  variant: 'jungle',
  tags: {},
  root: {
    rootFen: 't5l/1c3d1/e1w1p1r/7/7/7/R1P1W1E/1D3C1/L5T r 0 1',
    root: {
      annotations: { shapes: [{ kind: 'arrow', brush: 'green', orig: 'b1', dest: 'c1' }] },
      children: [{ uci: 'a1b1', children: [{ uci: 'a9b9' }] }],
    },
  },
};

describe('a start-position arrow', () => {
  it('is not drawn while the solution is hidden', async () => {
    const hidden = await mount({ hideSolution: true }, ARROW_CHAPTER);
    expect(hidden.querySelector('.xq-shape--green')).toBeNull();
    document.body.replaceChildren();
    const shown = await mount({}, ARROW_CHAPTER);
    expect(shown.querySelector('.xq-shape--green')).not.toBeNull();
  });
});

describe('solution=hidden on the URL', () => {
  it('reads only the exact value', () => {
    expect(embedSolutionHiddenFromSearch('?solution=hidden')).toBe(true);
    expect(embedSolutionHiddenFromSearch('?ply=3&solution=hidden')).toBe(true);
    for (const search of ['', '?solution=shown', '?solution', '?hideSolution=1']) {
      expect(embedSolutionHiddenFromSearch(search), search).toBe(false);
    }
  });

  it('is added to an article block path, keeping its query and hash', () => {
    expect(embedPathWithSolutionHidden('/embed/study/a/b')).toBe(
      '/embed/study/a/b?solution=hidden',
    );
    expect(embedPathWithSolutionHidden('/embed/study/a/b?notation=wxf#x')).toBe(
      '/embed/study/a/b?notation=wxf&solution=hidden#x',
    );
  });
});
