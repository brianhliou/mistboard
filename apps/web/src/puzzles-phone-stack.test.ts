// The puzzle page's phone stack: board, arrows, a one-line move strip, then the
// prompt strip (mobile pass #576; the review boards' order from e4823b2b). In
// portrait it is exactly one screen with no page scroll (Brian, 2026-10-20:
// "the whole scrolling, vertically scrolling is just still ugly"); what used to
// follow the prompt waits in the bar's ☰ menu. puzzles.css orders and sizes the
// rows; keepActivePuzzleMoveInView keeps the scrubbed-to ply visible inside the
// strip. The arrows are the review boards' shared move-nav bar
// (puzzlePhoneMoveNav); desktop keeps .puzzle-actions. These pin all of it, and
// the post-solve focus that must not centre the CTA.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PuzzleSummary } from './puzzles/adapter.js';
import { keepActivePuzzleMoveInView } from './puzzles/move-list.js';
import { puzzlePhoneMenuHead, puzzlePhoneMenuRows } from './puzzles/phone-menu.js';
import type { QueuePanelProps } from './puzzles/queue-panel.js';
import {
  focusPuzzleNext,
  type PuzzleScrub,
  puzzleEvalChip,
  puzzlePhoneMoveNav,
} from './puzzles.js';

// Whitespace collapsed: Biome wraps long selectors over several lines.
const css = readFileSync('src/puzzles.css', 'utf8').replace(/\s+/g, ' ');
const phone = css.slice(css.indexOf('@media (max-width: 980px)'));
const phoneBlock = phone.slice(0, phone.indexOf('@media', 10));
const desktop = css.slice(0, css.indexOf('@media (max-width: 980px)'));

afterEach(() => {
  document.body.innerHTML = '';
});

describe('puzzle phone stack', () => {
  it('swaps in the shared move-nav bar right under the board on the phone', () => {
    expect(phoneBlock).toContain(
      '.puzzles-shell .puzzle-side-panel > .puzzle-actions { display: none; }',
    );
    expect(phoneBlock).toMatch(
      /\.puzzles-shell \.puzzle-side-panel > \.puzzle-move-nav \{ display: grid; order: -1;/,
    );
    expect(phoneBlock).toMatch(/\.puzzle-board \{ order: 1; \}/);
    expect(phoneBlock).toMatch(/\.puzzle-side-panel \{ order: 2;/);
  });

  it('hides the shared bar on desktop with a selector that outranks move-nav-bar.css', () => {
    // move-nav-bar.css sets `.move-nav-bar { display: grid }` (one class); the
    // hide needs two so bundle order cannot decide it.
    expect(desktop).toContain('.puzzle-side-panel > .puzzle-move-nav { display: none; }');
    expect(desktop).not.toMatch(/\.puzzle-actions \{[^}]*display: none/);
  });

  it('turns the move list into one sideways-scrolling line on the phone only', () => {
    expect(phoneBlock).toMatch(
      /\.puzzles-shell \.puzzle-moves \{ display: flex; align-items: center; height: 34px;/,
    );
    expect(phoneBlock).toMatch(
      /\.puzzles-shell \.puzzle-move-list \{ display: flex;[^}]*max-height: none;[^}]*overflow-x: auto; overflow-y: hidden;/,
    );
    expect(phoneBlock).toMatch(
      /\.puzzles-shell \.puzzle-move-empty, \.puzzles-shell \.puzzle-move-item \{ display: flex; flex: none;[^}]*white-space: nowrap;/,
    );
    expect(phoneBlock).not.toContain('max-height: 140px');
    expect(desktop).not.toContain('.puzzle-side-panel > .puzzle-actions');
  });

  it('keeps the details, settings and post-solve engine out of the page, behind the menu', () => {
    expect(phoneBlock).toContain(
      '.puzzles-shell .puzzle-trainer-panel > .engine-panel, .puzzles-shell .puzzle-side-panel > .puzzle-analysis-open-link, .puzzles-shell .puzzles-layout > .puzzles-sidebar { display: none; }',
    );
    // A page with no puzzle (an empty variant) has no bar, so it keeps the column.
    expect(phoneBlock).toMatch(
      /\.puzzles-layout:has\(> \.puzzle-detail > \.puzzles-status\) > \.puzzles-sidebar \{ display: grid;/,
    );
    // The column is rebuilt as the sheet's own rows, never lent in as cards.
    expect(phoneBlock).not.toContain('.puzzle-phone-menu > .puzzles-sidebar');
    // The chip shows only on the phone strip.
    expect(desktop).toContain('.puzzle-eval-chip { display: none; }');
    expect(phoneBlock).toMatch(
      /\.puzzles-shell \.puzzle-eval-chip:not\(\[hidden\]\) \{ display: inline-flex;/,
    );
  });

  it('styles the menu as a bottom sheet of 48px one-line rows flush on the bar', () => {
    expect(phoneBlock).toMatch(
      /\.puzzles-shell \.puzzle-move-nav \.move-nav-menu \{ bottom: 100%; border: 0;[^}]*border-radius: 14px 14px 0 0;/,
    );
    expect(phoneBlock).toMatch(
      /\.puzzles-shell \.puzzle-phone-menu \.puzzle-pm-row \{ display: flex; align-items: center; gap: 12px; min-height: 48px;[^}]*border-bottom: 1px solid var\(--site-border\);/,
    );
    // The engine panel is one row: its lines leave the sheet, its settings
    // drop into the flow, and the gear's sub-view hides the rows under it.
    expect(phoneBlock).toMatch(
      /\.puzzle-phone-menu > \.engine-panel \.engine-panel__lines \{ display: none; \}/,
    );
    expect(phoneBlock).toMatch(
      /\.puzzle-phone-menu > \.engine-panel \.engine-panel__settings \{ position: static;/,
    );
    expect(phoneBlock).toMatch(
      /\.puzzle-phone-menu:has\(> \.engine-panel \.engine-panel__gear\[aria-expanded="true"\]\) > :is\(\.puzzle-analysis-open-link, \.puzzle-pm-rows\) \{ display: none; \}/,
    );
    // No card styling survives inside the sheet.
    expect(phoneBlock).not.toContain('.puzzle-phone-menu .puzzle-rating-card');
  });

  it('scopes the stack to the page so the embed card keeps its own layout', () => {
    for (const rule of phoneBlock.matchAll(/([^{}]*\.puzzle-(?:actions|move-nav)[^{}]*)\{/g)) {
      expect(rule[1]).toContain('.puzzles-shell');
    }
  });
});

// The first screen (Brian, 2026-10-20: "We could try it"): Lichess's phone
// shape, where the board sits under the site bar and the arrows and the prompt
// strip (task, feedback, Hint and Solution, Next puzzle) sit under it, so a
// player never scrolls to solve.
describe('puzzle phone first screen', () => {
  const portrait = css.slice(css.indexOf('@media (max-width: 980px) and (orientation: portrait)'));
  const portraitBlock = portrait.slice(0, portrait.indexOf('@media', 10));
  const narrow = css.slice(css.indexOf('@media (max-width: 520px)'));
  const narrowBlock = narrow.slice(0, narrow.indexOf('@media', 10));

  it('keeps the page heading visually hidden on the phone, with no top padding over the board', () => {
    expect(desktop).toMatch(/\.puzzles-header \{ position: absolute;[^}]*clip-path: inset\(50%\)/);
    expect(phoneBlock).not.toMatch(/\.puzzles-header \{/);
    expect(phoneBlock).toMatch(/\.puzzles-shell \{[^}]*padding: 0 0 56px;/);
    expect(narrowBlock).not.toMatch(/\.puzzles-shell \{[^}]*padding-top/);
  });

  it('puts the prompt strip last, under the move strip', () => {
    const rule = phoneBlock.match(
      /\.puzzles-shell \.puzzle-trainer-panel > \.puzzle-feedback, \.puzzles-shell \.puzzle-trainer-panel > \.puzzle-solved-panel \{([^}]*)\}/,
    )?.[1];
    expect(rule).toBeDefined();
    expect(rule).not.toMatch(/(^|[ ;])order:/);
    expect(rule).toContain('border-top: 1px solid');
  });

  it('keeps Hint, Solution and Skip on one row so a miss does not grow the strip', () => {
    expect(phoneBlock).toMatch(/\.puzzles-shell \.puzzle-assist-row \{[^}]*flex-wrap: nowrap;/);
    expect(phoneBlock).toMatch(
      /\.puzzles-shell \.puzzle-assist-row > \.puzzle-feedback-skip \{ flex: 1 1 0; min-width: 0;/,
    );
  });

  it('makes the portrait page one screen that never scrolls', () => {
    expect(portraitBlock).toContain(
      '.puzzles-page { display: flex; flex-direction: column; height: 100dvh; overflow: hidden; }',
    );
    expect(portraitBlock).toMatch(
      /\.puzzles-page > \.puzzles-shell \{[^}]*display: flex; flex: 1 1 0; flex-direction: column; min-height: 0;[^}]*padding: 0; overflow: hidden;/,
    );
    expect(portraitBlock).toMatch(
      /\.puzzles-shell \.puzzle-board \{ flex: 1 1 0;[^}]*min-height: 0; container-type: size;/,
    );
    // The board sizes from the box it is given, never from the viewport.
    expect(portraitBlock).toContain('width: min(100cqw, calc(100cqh * 552 / 612));');
    expect(portraitBlock).toContain('width: min(100cqw, calc(100cqh * 576 / 636));');
    expect(portraitBlock).toMatch(
      /> \.puzzle-solved-panel \{ box-sizing: border-box; height: var\(--puzzle-prompt-height\); min-height: 0; overflow: hidden;/,
    );
  });

  // The session row (this visit's ✓/✗ chips) must not take height from the
  // board: on an iPhone 13 it drew the board 352px wide instead of 390. It
  // gets no chrome budget of its own, and its negative margin cancels its
  // height, so it follows the controls and the board keeps main's width.
  it('gives the session row none of the board budget', () => {
    expect(portraitBlock.match(/--puzzle-stack-chrome: \d+px;/g)).toHaveLength(1);
    expect(portraitBlock).toMatch(
      /\.puzzles-shell \.puzzle-session-chips \{ --puzzle-session-row-height: 42px; flex: none; flex-wrap: nowrap; box-sizing: border-box; height: var\(--puzzle-session-row-height\); margin-bottom: calc\(-1 \* var\(--puzzle-session-row-height\)\);/,
    );
  });

  // Measured in the browser on 2026-10-20 (unsolved, after a miss with Skip,
  // solved with the thumbs, solution revealed; scrollHeight == innerHeight in
  // all 16): site bar 52px, arrows 46px, move strip 34px, prompt strip 100px.
  const NAV = 52;
  const ARROWS = 46;
  const MOVES = 34;
  it.each([
    [390, 664, 390],
    [375, 667, 375],
    [320, 568, 303],
    [430, 932, 430],
  ])('fits board, arrows, strip and prompt in a %ix%i portrait screen', (vw, vh, width) => {
    const prompt = Number(portraitBlock.match(/--puzzle-prompt-height: (\d+)px;/)?.[1]);
    const chrome = Number(portraitBlock.match(/--puzzle-stack-chrome: (\d+)px;/)?.[1]);
    expect(chrome).toBe(ARROWS + MOVES + prompt);
    const boardBox = vh - NAV - chrome; // what flex leaves the board
    const boardWidth = Math.min(vw, (boardBox * 552) / 612); // xiangqi 552:612
    expect(Math.round(boardWidth)).toBe(width);
    expect(NAV + (boardWidth * 612) / 552 + chrome).toBeLessThanOrEqual(vh);
  });
});

describe('keepActivePuzzleMoveInView', () => {
  function column(activeRow: number): { list: HTMLOListElement; root: HTMLElement } {
    const root = document.createElement('div');
    const list = document.createElement('ol');
    list.className = 'puzzle-move-list';
    for (let i = 0; i < 5; i += 1) {
      const row = document.createElement('li');
      row.className = 'puzzle-move-item';
      const cell = document.createElement('span');
      if (i === activeRow) cell.className = 'puzzle-move-cell--active';
      row.append(cell);
      // 38px rows laid out from the list's top, shifted by its scroll.
      const box = () =>
        ({
          top: i * 38 - list.scrollTop,
          bottom: (i + 1) * 38 - list.scrollTop,
          left: 0,
          right: 100,
        }) as DOMRect;
      row.getBoundingClientRect = box;
      cell.getBoundingClientRect = box;
      list.append(row);
    }
    list.getBoundingClientRect = () => ({ top: 0, bottom: 140, left: 0, right: 300 }) as DOMRect;
    root.append(list);
    document.body.append(root);
    return { list, root };
  }

  // The phone's one-line strip: 90px moves side by side in a 320px strip.
  function line(activeMove: number): { list: HTMLOListElement; root: HTMLElement } {
    const root = document.createElement('div');
    const list = document.createElement('ol');
    list.className = 'puzzle-move-list';
    for (let i = 0; i < 6; i += 1) {
      const row = document.createElement('li');
      row.className = 'puzzle-move-item';
      const cell = document.createElement('span');
      if (i === activeMove) cell.className = 'puzzle-move-cell--active';
      row.append(cell);
      const box = () =>
        ({
          top: 0,
          bottom: 34,
          left: i * 90 - list.scrollLeft,
          right: (i + 1) * 90 - list.scrollLeft,
        }) as DOMRect;
      row.getBoundingClientRect = () => ({ ...box(), top: 0, bottom: 34 }) as DOMRect;
      cell.getBoundingClientRect = box;
      list.append(row);
    }
    list.getBoundingClientRect = () => ({ top: 0, bottom: 34, left: 0, right: 320 }) as DOMRect;
    root.append(list);
    document.body.append(root);
    return { list, root };
  }

  it('scrolls a ply below the column into view', () => {
    const { list, root } = column(4);
    keepActivePuzzleMoveInView(root);
    expect(list.scrollTop).toBe(5 * 38 - 140);
  });

  it('leaves the column alone when the ply is already visible', () => {
    const { list, root } = column(1);
    keepActivePuzzleMoveInView(root);
    expect(list.scrollTop).toBe(0);
    expect(list.scrollLeft).toBe(0);
  });

  it('scrolls the one-line strip sideways so the last ply is not clipped at the right', () => {
    const { list, root } = line(5);
    keepActivePuzzleMoveInView(root);
    expect(list.scrollLeft).toBe(6 * 90 - 320 + 12);
    expect(list.scrollTop).toBe(0);
  });

  it('scrolls back when the active ply is off the left edge', () => {
    const { list, root } = line(2);
    list.scrollLeft = 200; // the ply sits at -20..70, clipped at the left
    keepActivePuzzleMoveInView(root);
    expect(list.scrollLeft).toBe(200 - (20 + 12));
  });
});

describe('puzzlePhoneMoveNav', () => {
  const noMenu = { blocks: () => [] };

  it('is the shared bar with a fifth ☰, wired to the puzzle scrub', () => {
    const calls: PuzzleScrub[] = [];
    const { el } = puzzlePhoneMoveNav(
      { atStart: false, atEnd: false },
      (a) => calls.push(a),
      noMenu,
    );
    expect(el.classList.contains('move-nav-bar')).toBe(true);
    expect(el.classList.contains('puzzle-move-nav')).toBe(true);
    const menuButton = el.querySelector<HTMLButtonElement>('.move-nav-bar__menu-button');
    expect(menuButton).not.toBeNull();
    // No rows of its own, but the lent blocks count: the button stays live.
    expect(menuButton?.disabled).toBe(false);
    const buttons = [...el.querySelectorAll<HTMLButtonElement>('[data-replay]')];
    expect(buttons.map((b) => b.dataset.replay)).toEqual(['first', 'prev', 'next', 'latest']);
    for (const button of buttons) button.click();
    expect(calls).toEqual(['first', 'previous', 'next', 'last']);
  });

  it('disables the ends it is at', () => {
    const { el } = puzzlePhoneMoveNav({ atStart: true, atEnd: false }, () => {}, noMenu);
    const disabled = (step: string) =>
      el.querySelector<HTMLButtonElement>(`[data-replay="${step}"]`)?.disabled;
    expect([disabled('first'), disabled('prev'), disabled('next'), disabled('latest')]).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });

  it('lends the engine and the link between the header and the rows, and puts them back', () => {
    const layout = document.createElement('div');
    layout.className = 'puzzles-layout';
    const trainer = document.createElement('div');
    const engine = document.createElement('section');
    engine.className = 'engine-panel';
    const moves = document.createElement('div');
    trainer.append(engine, moves);
    const hidden = document.createElement('a');
    hidden.hidden = true;
    layout.append(trainer);
    document.body.append(layout);
    const head = document.createElement('div');
    head.className = 'test-head';
    const row = document.createElement('label');
    row.className = 'test-row';

    const bar = puzzlePhoneMoveNav({ atStart: true, atEnd: true }, () => {}, {
      blocks: () => [engine, null, hidden],
      head: () => head,
      rows: () => [row],
    });
    trainer.append(bar.el);
    const content = bar.el.querySelector('.puzzle-phone-menu');
    expect(content?.parentElement).toBe(bar.menu);
    expect(content?.getAttribute('role')).toBe('dialog');

    bar.menuButton?.click();
    expect(bar.menu?.hidden).toBe(false);
    const order = [...(content?.children ?? [])].map((child) => child.className);
    expect(order).toEqual(['puzzle-pm-head-slot', 'engine-panel', 'puzzle-pm-rows']);
    expect(content?.querySelector('.puzzle-pm-head-slot')?.firstElementChild).toBe(head);
    expect(content?.querySelector('.puzzle-pm-rows')?.firstElementChild).toBe(row);
    expect(hidden.isConnected).toBe(false);

    bar.menuButton?.click();
    expect(bar.menu?.hidden).toBe(true);
    // Emptied on close: built rows go, lent blocks go home in place.
    expect(content?.querySelector('.puzzle-pm-rows')?.children.length).toBe(0);
    expect(row.isConnected).toBe(false);
    expect(trainer.firstElementChild).toBe(engine);
    expect(engine.nextElementSibling).toBe(moves);
    expect([...trainer.childNodes].some((n) => n.nodeType === Node.COMMENT_NODE)).toBe(false);
  });

  it('moves focus into the sheet on open and back to ☰ when Escape closes it', () => {
    const bar = puzzlePhoneMoveNav({ atStart: true, atEnd: true }, () => {}, {
      blocks: () => [],
      rows: () => [document.createElement('label')],
    });
    document.body.append(bar.el);
    bar.menuButton?.focus();
    bar.menuButton?.click();
    const content = bar.el.querySelector('.puzzle-phone-menu');
    expect(document.activeElement).toBe(content);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(bar.menu?.hidden).toBe(true);
    expect(document.activeElement).toBe(bar.menuButton);
  });

  it('closes on a tap outside the bar, not on one inside the sheet', () => {
    const bar = puzzlePhoneMoveNav({ atStart: true, atEnd: true }, () => {}, {
      blocks: () => [],
      rows: () => [document.createElement('label')],
    });
    const board = document.createElement('div');
    document.body.append(board, bar.el);
    bar.openMenu();
    bar.el
      .querySelector('.puzzle-pm-rows > label')
      ?.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(bar.menu?.hidden).toBe(false);
    board.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(bar.menu?.hidden).toBe(true);
  });

  it('closes on Escape and drops its page listeners when the signal aborts', () => {
    const abort = new AbortController();
    const bar = puzzlePhoneMoveNav({ atStart: true, atEnd: true }, () => {}, {
      blocks: () => [],
      signal: abort.signal,
    });
    document.body.append(bar.el);
    bar.openMenu();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(bar.menu?.hidden).toBe(true);
    abort.abort();
    bar.openMenu();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(bar.menu?.hidden).toBe(false);
  });
});

describe('puzzle phone menu rows', () => {
  const puzzle: PuzzleSummary = {
    id: 'xiangqi-test-puzzle-1',
    variant: 'xiangqi',
    title: 'Test',
    sideToMove: 'red',
    goal: { type: 'checkmate' },
    themes: ['sacrifice'],
    motifs: [],
    solutionPlyCount: 3,
    rating: 1600,
    ratingProvisional: false,
  } as PuzzleSummary;
  const props = (over: Partial<QueuePanelProps> = {}): QueuePanelProps => ({
    queue: [puzzle],
    selectedId: puzzle.id,
    solvedIds: new Set(),
    variantFilter: 'xiangqi',
    variantFilters: ['xiangqi'],
    autoNext: false,
    ratedEnabled: true,
    userRating: null,
    ratingDelta: null,
    onVariantChange: async () => {},
    onAutoNextChange: () => {},
    onRatedChange: () => {},
    ...over,
  });
  const keys = (rows: HTMLElement[]) => rows.map((row) => row.dataset.puzzleMenuRow);

  it('shows Rated and auto-next while solving, and hides the goal and themes', () => {
    const rows = puzzlePhoneMenuRows(props());
    expect(keys(rows)).toEqual(['rated', 'autoNext']);
    const head = puzzlePhoneMenuHead(props());
    expect(head?.querySelector('[data-puzzle-code]')).not.toBeNull();
    expect(head?.textContent).toContain('Played locally');
    expect(head?.textContent).toContain('to move');
    expect(head?.textContent).not.toContain('Mate in');
  });

  it('adds the themes row and the goal once solved', () => {
    const solved = props({ solvedIds: new Set([puzzle.id]) });
    expect(keys(puzzlePhoneMenuRows(solved))).toEqual(['rated', 'autoNext', 'themes']);
    expect(puzzlePhoneMenuHead(solved)?.textContent).toContain('Mate in 2');
  });

  it('carries the rating as small text on the Rated row', () => {
    const sub = (p: QueuePanelProps) =>
      puzzlePhoneMenuRows(p)[0]?.querySelector('.puzzle-pm-row__sub')?.textContent ?? null;
    expect(sub(props())).toContain('Unrated');
    expect(
      sub(props({ userRating: { rating: 1512, provisional: true, solved: 3, attempts: 4 } })),
    ).toContain('1512?');
    // Practice mode: no rating line, the explanation moves to the tooltip.
    expect(sub(props({ ratedEnabled: false }))).toBeNull();
  });

  it('wires each switch to its setting, with the switch on the right', () => {
    const onRatedChange = vi.fn();
    const onAutoNextChange = vi.fn();
    const rows = puzzlePhoneMenuRows(props({ onRatedChange, onAutoNextChange }));
    document.body.append(...rows);
    const rated = rows[0]?.querySelector<HTMLInputElement>('[data-puzzle-menu="rated"]');
    const autoNext = rows[1]?.querySelector<HTMLInputElement>('[data-puzzle-menu="autoNext"]');
    expect(rows[0]?.lastElementChild?.classList.contains('puzzle-toggle-switch')).toBe(true);
    rated?.click();
    autoNext?.click();
    expect(onRatedChange).toHaveBeenCalledWith(false);
    expect(onAutoNextChange).toHaveBeenCalledWith(true);
    // Never the sidebar's hooks, so a page selector finds one control.
    expect(rows[0]?.querySelector('[data-puzzle-rated]')).toBeNull();
  });
});

describe('puzzleEvalChip', () => {
  it("mirrors the engine panel's score and shows only while the engine runs", async () => {
    const engine = document.createElement('section');
    engine.className = 'engine-panel';
    const evalLabel = document.createElement('span');
    evalLabel.className = 'engine-panel__eval';
    evalLabel.textContent = '+0.3';
    engine.append(evalLabel);
    document.body.append(engine);

    const chip = puzzleEvalChip(engine);
    expect(chip.className).toBe('puzzle-eval-chip');
    expect(chip.hidden).toBe(true);

    engine.classList.add('engine-panel--on');
    evalLabel.textContent = '+6.0';
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(chip.hidden).toBe(false);
    expect(chip.textContent).toBe('+6.0');

    engine.classList.remove('engine-panel--on');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(chip.hidden).toBe(true);
  });
});

describe('focusPuzzleNext', () => {
  it('focuses without the centring scroll and scrolls only to the nearest edge', () => {
    const button = document.createElement('button');
    document.body.append(button);
    const focus = vi.spyOn(button, 'focus');
    const scroll = vi.fn();
    button.scrollIntoView = scroll;
    focusPuzzleNext(button, false);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
    expect(document.activeElement).toBe(button);
  });

  it('never scrolls inside an embed', () => {
    const button = document.createElement('button');
    document.body.append(button);
    const scroll = vi.fn();
    button.scrollIntoView = scroll;
    focusPuzzleNext(button, true);
    expect(scroll).not.toHaveBeenCalled();
  });
});
