import { importXiangqiGame } from '@mistboard/game';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import continuedRecords from '../../../packages/game/fixtures/xiangqi-notation/adjudicated-records.json';
import { mountXiangqiAnalysis } from './xiangqi-analysis.js';
import { mountXiangqiAnalysisPage } from './xiangqi-analysis-page.js';
import { pinXiangqiNotation } from './xiangqi-notation.js';

// DOM coverage for the imported-game analysis surface (everything except the WASM
// engine, which happy-dom can't run — cevalSupported() is false here, so the
// engine panel mounts disabled and never touches SharedArrayBuffer).

const OPENING = [
  { from: 'h3', to: 'e3' } as const,
  { from: 'h8', to: 'e8' } as const,
  { from: 'h1', to: 'g3' } as const,
];

function freshRoot(): HTMLElement {
  const root = document.createElement('div');
  document.body.append(root);
  return root;
}

// This happy-dom build ships no window.localStorage; back it with memory so the
// opening-book preference (#534) can be remembered across mounts.
const storageValues = new Map<string, string>();
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: {
    get length() {
      return storageValues.size;
    },
    clear: () => storageValues.clear(),
    getItem: (key: string) => storageValues.get(key) ?? null,
    key: (index: number) => [...storageValues.keys()][index] ?? null,
    removeItem: (key: string) => void storageValues.delete(key),
    setItem: (key: string, value: string) => void storageValues.set(key, value),
  } satisfies Storage,
});

// These tests locate cells by from-to text; pin coordinate labels so the
// reader's notation default (algebraic) does not become the subject.
beforeEach(() => {
  storageValues.clear();
  pinXiangqiNotation('coordinate');
});
afterEach(() => pinXiangqiNotation(null));

describe('mountXiangqiAnalysis', () => {
  for (const record of continuedRecords.cases) {
    for (const nav of [true, false]) {
      it(`keeps all plies past ${record.reason} on the ${nav ? 'page' : 'embed'}`, () => {
        const imported = importXiangqiGame(record.iccs);
        expect(imported.error).toBeUndefined();
        expect(imported.moves).toHaveLength(record.plies);
        const root = freshRoot();
        mountXiangqiAnalysis(root, imported.moves, { nav });
        // The metadata is driven by the replay used for the client analysis sweep.
        expect(root.querySelector('.game-meta-card')?.textContent).toContain(
          `${record.plies} plies`,
        );
        expect(root.textContent).not.toMatch(/Truncated import/i);
        const last = imported.moves.at(-1)!;
        expect(root.querySelector('.review-move-list__move--current')?.textContent).toContain(
          `${last.from}-${last.to}`,
        );
        // Mounting publishes the tree's mainline, independently of the replay.
        expect(new URLSearchParams(window.location.search).get('moves')?.split(' ')).toHaveLength(
          record.plies,
        );
        root.remove();
      });
    }
  }

  it('renders the board, engine panel, move tree, and navigation from a move list', () => {
    const root = freshRoot();
    mountXiangqiAnalysis(root, [...OPENING]);
    expect(root.querySelector('.xiangqi-live-board')).not.toBeNull();
    expect(root.querySelector('.engine-panel')).not.toBeNull();
    const text = root.textContent ?? '';
    expect(text).toContain('h3-e3');
    expect(text).toContain('h1-g3');
    // Interactive tree UI: a move tree + the playback control bar (below the box).
    expect(root.querySelector('.move-tree')).not.toBeNull();
    expect(root.querySelector('.review-controls')).not.toBeNull();
    // The last seeded move is the current node on mount.
    expect(root.querySelector('.review-move-list__move--current')?.textContent).toContain('h1-g3');
    // whole-game analysis entry point (the client ceval sweep is click-gated, so
    // no engine loads here — only the request button renders)
    expect(root.textContent).toContain('Analyse the whole game');
    // Meta card carries the finalized xiangqi variant marker (site-wide icon
    // language), not just the text glyph.
    expect(
      root.querySelector('.game-meta-card__icon [data-variant-marker-id="xiangqi"]'),
    ).not.toBeNull();
    // The engine-arrow overlay layer mounts empty (engine off).
    expect(root.querySelector('.xq-live-arrows')).not.toBeNull();
    expect(root.querySelectorAll('.xq-live-arrows .xq-arrow')).toHaveLength(0);
    root.remove();
  });

  it('surfaces a truncation notice when the move list goes illegal', () => {
    const root = freshRoot();
    mountXiangqiAnalysis(root, [{ from: 'b1', to: 'b2' }]); // illegal horse move → legal prefix is empty
    expect(root.textContent).toMatch(/Truncated import/i);
    root.remove();
  });

  it('accepts click-to-move for both sides from the start position (red then black)', () => {
    // Regression: the tree adapter projected the view for a fixed 'red'
    // perspective, whose legalMoves are EMPTY on black's turn, so the board
    // rejected every black move after red's first (ply 1 was a dead end).
    const root = freshRoot();
    mountXiangqiAnalysis(root, []);
    const clickSquare = (square: string): void => {
      const hit = root.querySelector(`[data-square="${square}"]`);
      if (!hit) throw new Error(`square ${square} not found`);
      hit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    };
    // Red's first move: cannon h3-e3.
    clickSquare('h3');
    clickSquare('e3');
    expect(root.querySelector('.move-tree')?.textContent).toContain('h3-e3');
    // Black's reply: cannon h8-e8. Must be selectable and land in the tree.
    clickSquare('h8');
    clickSquare('e8');
    expect(root.querySelector('.move-tree')?.textContent).toContain('h8-e8');
    expect(root.querySelector('.review-move-list__move--current')?.textContent).toContain('h8-e8');
    // The line on screen is mirrored into the address bar as it is played.
    expect(new URLSearchParams(window.location.search).get('moves')).toBe('h3-e3 h8-e8');
    root.querySelector<HTMLButtonElement>('[aria-label="First move"]')?.click();
    expect(new URLSearchParams(window.location.search).get('moves')).toBeNull();
    window.history.replaceState(null, '', '/');
    root.remove();
  });
});

describe('mountXiangqiAnalysisPage', () => {
  // The page reads window.location.search; a prior test's import pushes ?moves=...,
  // which would otherwise leak into the next test's URL.
  beforeEach(() => {
    window.history.pushState({}, '', '/analysis/xiangqi');
  });

  it('opens the empty board at the start position when the URL carries no moves', () => {
    const root = freshRoot();
    mountXiangqiAnalysisPage(root);
    // Lichess-style: the interactive board opens directly (no paste-form gate).
    expect(root.querySelector('.xiangqi-live-board')).not.toBeNull();
    expect(root.querySelector('.move-tree')).not.toBeNull();
    expect(root.querySelector('.dxq-postgame__actions')).toBeNull();
    // Scoped past the nav on purpose: "Import game" is now a Tools menu entry on
    // every page, so an unscoped text check would match the chrome rather than
    // the paste-form gate this is actually guarding against.
    const board = [...root.children].filter((el) => !el.classList.contains('site-nav'));
    expect(board.map((el) => el.textContent).join('')).not.toContain('Import game');
    expect(root.textContent).not.toContain('Save as study');
    expect(root.textContent).not.toContain('Back home');
    root.remove();
  });

  it('seeds the board from a ?moves= link', () => {
    window.history.pushState({}, '', '/analysis/xiangqi?moves=h3e3,h8e8');
    const root = freshRoot();
    mountXiangqiAnalysisPage(root);
    expect(root.querySelector('.xiangqi-live-board')).not.toBeNull();
    expect(root.textContent).toContain('h3-e3');
    root.remove();
  });

  it('seeds a hand-set position from a ?fen= link (composition ingress)', () => {
    // Red cannon + soldier vs bare general — nothing like this is reachable
    // from the start, so the pieces below prove the FEN actually rooted the tree.
    const fen = encodeURIComponent('3k5/4P4/9/9/9/9/9/4C4/9/4K4 r - - 0 1');
    window.history.pushState({}, '', `/analysis/xiangqi?fen=${fen}`);
    const root = freshRoot();
    mountXiangqiAnalysisPage(root);
    expect(root.querySelector('.xiangqi-live-board')).not.toBeNull();
    // 5 pieces on the board, not the 32-piece start.
    expect(root.querySelectorAll('[data-square] .xq-piece, .xq-piece').length).toBeLessThan(10);
    expect(root.textContent).toContain('Custom position');
    // The FEN box is editable on the analysis surface (Set position affordance).
    const fenInput = root.querySelector<HTMLInputElement>('.review-import input');
    expect(fenInput?.readOnly).toBe(false);
    expect(root.textContent).toContain('Set position');
    root.remove();
  });

  it('reads ?moves= as coordinate moves from the ?fen= position', () => {
    const fen = encodeURIComponent('3k5/4P4/9/9/9/9/9/4C4/9/4K4 r - - 0 1');
    // e9-e10 is the winning soldier push in that position; legal only from the FEN root.
    window.history.pushState({}, '', `/analysis/xiangqi?fen=${fen}&moves=e9e10`);
    const root = freshRoot();
    mountXiangqiAnalysisPage(root);
    expect(root.querySelector('.move-tree')?.textContent).toContain('e9-e10');
    expect(root.textContent).not.toMatch(/Truncated import/i);
    root.remove();
  });

  // A problem link (the /x/ short links) carries ply=0 so the reader lands on
  // the problem, not on the solution's final move; without it the line's end
  // is where the board opens.
  it('opens at the root of a ?fen= + ?moves= line on ?ply=0', () => {
    const fen = encodeURIComponent('3k5/4P4/9/9/9/9/9/4C4/9/4K4 r - - 0 1');
    window.history.pushState({}, '', `/analysis/xiangqi?fen=${fen}&moves=e9e10`);
    const atEnd = freshRoot();
    mountXiangqiAnalysisPage(atEnd);
    expect(atEnd.querySelector('.review-move-list__move--current')?.textContent).toContain(
      'e9-e10',
    );
    atEnd.remove();

    window.history.pushState({}, '', `/analysis/xiangqi?fen=${fen}&moves=e9e10&ply=0`);
    const atStart = freshRoot();
    mountXiangqiAnalysisPage(atStart);
    expect(atStart.querySelector('.move-tree')?.textContent).toContain('e9-e10');
    expect(atStart.querySelector('.review-move-list__move--current')).toBeNull();
    atStart.remove();
  });

  it('degrades an invalid ?fen= to the standard start', () => {
    window.history.pushState({}, '', '/analysis/xiangqi?fen=not-a-fen');
    const root = freshRoot();
    mountXiangqiAnalysisPage(root);
    expect(root.querySelector('.xiangqi-live-board')).not.toBeNull();
    expect(root.textContent).toContain('Start position');
    root.remove();
  });

  it('offers only menu actions that are actually wired', () => {
    // The muted placeholders (Learn from your mistakes / Continue from here /
    // Settings) were cut; Board editor came back WITH its route. What is
    // listed must be live.
    const root = freshRoot();
    mountXiangqiAnalysis(root, [...OPENING]);
    const items = [...root.querySelectorAll<HTMLButtonElement>('.move-nav-menu__item')];
    expect(items.map((b) => b.textContent?.trim())).toEqual([
      'Flip board',
      'Opening explorer',
      'Study',
      'Clear moves',
      'Board editor',
    ]);
    expect(items.every((b) => !b.disabled)).toBe(true);
    root.remove();
  });

  it('mounts the phone bar on the page and not in the embed (#576)', () => {
    const root = freshRoot();
    mountXiangqiAnalysis(root, [...OPENING]);
    const bar = root.querySelector('.analysis-phone-bar');
    expect(
      [...(bar?.querySelectorAll<HTMLButtonElement>('[data-analysis-bar]') ?? [])].map(
        (b) => b.dataset.analysisBar,
      ),
    ).toEqual(['tools', 'engine', 'flip', 'back', 'next']);
    // happy-dom cannot run the engine, so the Engine button is hidden, as the
    // engine card is.
    expect(root.querySelector<HTMLButtonElement>('[data-analysis-bar="engine"]')?.hidden).toBe(
      true,
    );
    // The last seeded move is current: Next is at the end, Back is live.
    expect(root.querySelector<HTMLButtonElement>('[data-analysis-bar="next"]')?.disabled).toBe(
      true,
    );
    expect(root.querySelector<HTMLButtonElement>('[data-analysis-bar="back"]')?.disabled).toBe(
      false,
    );
    expect(root.querySelector('.analysis-phone-info')?.textContent).toContain('Black to move');
    // Tools carries every menu item but Flip, which has its own button.
    root.querySelector<HTMLButtonElement>('[data-analysis-bar="tools"]')?.click();
    expect(
      [...root.querySelectorAll('.analysis-tools-sheet__item')].map((b) => b.textContent?.trim()),
    ).toEqual(['Opening explorer', 'Study', 'Clear moves', 'Board editor']);
    // The FEN and moves boxes ride in the sheet while it is open.
    expect(root.querySelector('.analysis-tools-sheet .review-import')).not.toBeNull();
    root.remove();

    const embed = freshRoot();
    mountXiangqiAnalysis(embed, [...OPENING], { nav: false });
    expect(embed.querySelector('.analysis-phone-bar')).toBeNull();
    embed.remove();
  });

  it('Board editor hands the current position to /editor/xiangqi', () => {
    const root = freshRoot();
    mountXiangqiAnalysis(root, [...OPENING]);
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
    const editor = [...root.querySelectorAll<HTMLButtonElement>('.move-nav-menu__item')].find((b) =>
      b.textContent?.includes('Board editor'),
    );
    editor?.click();
    const href = String(assign.mock.calls.at(-1)?.[0]);
    expect(href.startsWith('/editor/xiangqi?fen=')).toBe(true);
    // The current node is the last seeded move, so the fen is not the start.
    const fen = new URL(href, 'http://x').searchParams.get('fen')!;
    expect(fen).not.toContain('rnbakabnr/9/1c5c1');
    expect(fen).toContain('1c2c4');
    assign.mockRestore();
    root.remove();
  });

  it('carries no dead toolbar buttons, and the book starts closed', () => {
    // The rule: a control bar never shows a button with nothing behind it. The
    // bar is the five move-nav columns; the opening book is a menu row (#523),
    // closed by default for a first-time reader (#534), and toggling it opens
    // and closes the pane.
    const root = freshRoot();
    mountXiangqiAnalysis(root, [...OPENING]);
    const bar = root.querySelector('.review-controls.move-nav-bar');
    expect(bar).not.toBeNull();
    const columns = [...(bar?.querySelectorAll<HTMLButtonElement>(':scope > button') ?? [])];
    expect(columns.map((b) => b.dataset.replay ?? 'menu')).toEqual([
      'first',
      'prev',
      'next',
      'latest',
      'menu',
    ]);
    expect(bar?.hasAttribute('data-live-glow')).toBe(false);
    const book = root.querySelector<HTMLButtonElement>('[data-review-explorer]');
    const pane = root.querySelector<HTMLElement>('.opening-explorer');
    expect(pane?.hidden).toBe(true);
    root.querySelector<HTMLButtonElement>('.move-nav-bar__menu-button')?.click();
    expect(book?.getAttribute('aria-pressed')).toBe('false');
    book?.click();
    expect(pane?.hidden).toBe(false);
    root.querySelector<HTMLButtonElement>('.move-nav-bar__menu-button')?.click();
    expect(book?.getAttribute('aria-pressed')).toBe('true');
    book?.click();
    expect(pane?.hidden).toBe(true);
    root.remove();
  });

  it('remembers the book choice across boards (#534)', () => {
    // Every review surface shares the one bar, so the reader's last choice is
    // the next board's starting state: opened stays open, closed stays closed.
    const mount = () => {
      const root = freshRoot();
      mountXiangqiAnalysis(root, [...OPENING]);
      const pane = root.querySelector<HTMLElement>('.opening-explorer');
      const book = root.querySelector<HTMLButtonElement>('[data-review-explorer]');
      const openMenu = () =>
        root.querySelector<HTMLButtonElement>('.move-nav-bar__menu-button')?.click();
      return { root, pane, book, openMenu };
    };

    const first = mount();
    expect(first.pane?.hidden).toBe(true);
    first.openMenu();
    first.book?.click();
    expect(first.pane?.hidden).toBe(false);
    first.root.remove();

    const second = mount();
    expect(second.pane?.hidden).toBe(false);
    second.openMenu();
    expect(second.book?.getAttribute('aria-pressed')).toBe('true');
    second.book?.click();
    expect(second.pane?.hidden).toBe(true);
    second.root.remove();

    const third = mount();
    expect(third.pane?.hidden).toBe(true);
    third.root.remove();
  });

  it('Clear moves wipes the tree back to the start position', () => {
    const root = freshRoot();
    mountXiangqiAnalysis(root, [...OPENING]);
    expect(root.querySelector('.move-tree')?.textContent).toContain('h3-e3');
    const clear = [...root.querySelectorAll<HTMLButtonElement>('.move-nav-menu__item')].find((b) =>
      b.textContent?.includes('Clear moves'),
    );
    clear?.click();
    const moveText = root.querySelector('.move-tree')?.textContent ?? '';
    expect(moveText).not.toContain('h3-e3');
    expect(moveText).not.toContain('h1-g3');
    // The board is still mounted at the root position, not torn down.
    expect(root.querySelector('.xiangqi-live-board')).not.toBeNull();
    root.remove();
  });

  it('sizes the review shell for the square-grid river gutter', () => {
    window.history.pushState({}, '', '/analysis/xiangqi?xqLayout=cell');
    const root = freshRoot();
    mountXiangqiAnalysisPage(root);
    expect(
      root
        .querySelector<HTMLElement>('.review-shell__cluster')
        ?.style.getPropertyValue('--uni-board-aspect'),
    ).toBe((538.8 / 610.8).toFixed(4));
    root.remove();
  });
});
