// The score sheet folds the stored analysis's marks into its entries: the glyph after the
// move, the advice under it, a study's own note kept ahead of the advice.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMoveList } from '../review/move-list.js';
import {
  annotateEntries,
  EMBED_HEIGHT_MESSAGE,
  fitBoardWidth,
  mountEmbedCard,
  naturalBoxHeight,
} from './embed-card.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('annotateEntries', () => {
  const entries = [
    { ply: 1, label: 'h3-e3' },
    { ply: 2, label: 'h8-e8', note: 'The usual reply.' },
    { ply: 3, label: 'b3-e3' },
  ];

  it('adds the glyph and the advice to the marked moves only', () => {
    const marked = annotateEntries(
      entries,
      new Map([
        [2, { suffix: '?', suffixClass: 'mistake', note: 'Mistake. b8-e8 was best.' }],
        [3, { suffix: '??', suffixClass: 'blunder', note: 'Blunder. h2-e2 was best.' }],
      ]),
    );
    expect(marked[0]).toEqual(entries[0]);
    expect(marked[1]).toEqual({
      ply: 2,
      label: 'h8-e8',
      suffix: '?',
      suffixClass: 'mistake',
      note: 'The usual reply. Mistake. b8-e8 was best.',
    });
    expect(marked[2]).toMatchObject({ suffix: '??', note: 'Blunder. h2-e2 was best.' });
  });

  it('renders on the sheet as a coloured glyph and a note under the row', () => {
    const list = createMoveList(
      annotateEntries(
        entries,
        new Map([[3, { suffix: '??', suffixClass: 'blunder', note: 'Blunder. h2-e2 was best.' }]]),
      ),
    );
    const glyph = list.el.querySelector('[data-ply="3"] .review-move-list__suffix');
    expect(glyph?.textContent).toBe(' ??');
    expect(glyph?.classList.contains('review-move--blunder')).toBe(true);
    const notes = [...list.el.querySelectorAll('.review-move-list__note')].map(
      (el) => el.textContent,
    );
    expect(notes).toContain('Blunder. h2-e2 was best.');
  });
});

describe('study note height budgeting', () => {
  it.each([false, true])(
    'keeps a long root note and full-width board in a short window (framed: %s)',
    async (framed) => {
      const width = 300;
      const height = 400;
      const noteHeight = 277;
      const rootNote = 'Explain the opening position in full. '.repeat(30);
      const postMessage = vi.fn();
      vi.stubGlobal('innerHeight', height);
      if (framed) vi.stubGlobal('parent', { postMessage });
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
        this: HTMLElement,
      ) {
        return this.classList.contains('embed-frame')
          ? new DOMRect(0, 0, width, height)
          : new DOMRect();
      });
      vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
        this: HTMLElement,
      ) {
        return this.classList.contains('embed-card-current-note') && !this.hidden ? noteHeight : 0;
      });
      const card = await mountEmbedCard(document.createElement('div'), {
        header: 'Study',
        seats: { first: { name: 'Red', ink: 'red' }, second: { name: 'Black', ink: 'black' } },
        result: '',
        credit: { href: '/study/example', text: 'Study' },
        aspect: 1,
        startPly: 0,
        mobileNotes: { rootNote },
        mountBoard: async (_host, hooks) => ({
          destroy: vi.fn(),
          jumpToPly: (ply) => hooks.onPlyChange(ply, 0),
          plyCount: () => 0,
          moveEntries: () => [],
        }),
      });
      expect(card.frame.querySelector<HTMLElement>('.embed-card-board')!.style.width).toBe('298px');
      const note = card.frame.querySelector<HTMLElement>('.embed-card-current-note')!;
      expect(note.hidden).toBe(false);
      expect(note.textContent).toBe(rootNote);
      if (framed) {
        const readingHeight = naturalBoxHeight(width, 1, true) + 12 + 126 + noteHeight;
        expect(readingHeight).toBeGreaterThan(height);
        expect(postMessage).toHaveBeenLastCalledWith(
          { type: EMBED_HEIGHT_MESSAGE, height: readingHeight, fullReadingHeight: true },
          '*',
        );
      }
    },
  );

  it('restores the mainline note when a renderer suppresses a duplicate ply notification', async () => {
    let ply = -1;
    const card = await mountEmbedCard(document.createElement('div'), {
      header: 'Study',
      seats: { first: { name: 'Red', ink: 'red' }, second: { name: 'Black', ink: 'black' } },
      result: '',
      credit: { href: '/study/example', text: 'Study' },
      aspect: 1,
      startPly: 1,
      mobileNotes: {},
      mountBoard: async (_host, hooks) => ({
        destroy: vi.fn(),
        jumpToPly: (next) => {
          if (next === ply) return;
          ply = next;
          hooks.onPlyChange(ply, 2);
        },
        jumpToLine: vi.fn(),
        plyCount: () => 2,
        moveEntries: () => [
          { ply: 1, label: 'h3-e3', note: 'Mainline note.' },
          { ply: 2, label: 'h8-e8', line: { moves: ['b8-e8'], note: 'Alternative note.' } },
        ],
      }),
    });
    const note = card.frame.querySelector('.embed-card-current-note')!;
    card.jumpToLine(2, 1);
    expect(note.textContent).toBe('Alternative note.');
    card.jumpToPly(1);
    expect(note.textContent).toBe('Mainline note.');
    card.setAnnotations(new Map([[1, { note: 'Stored analysis.' }]]));
    expect(note.textContent).toBe('Mainline note. Stored analysis.');
  });

  it.each([360, 800])(
    'fits the board and reports the complete reading height at %ipx',
    async (width) => {
      const stacked = width < 480;
      const chartHeight = stacked ? 88 : 140;
      const frameHeight = window.innerHeight;
      const parentDescriptor = Object.getOwnPropertyDescriptor(window, 'parent');
      const postMessage = vi.fn();
      Object.defineProperty(window, 'parent', { configurable: true, value: { postMessage } });
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
        this: HTMLElement,
      ) {
        return new DOMRect(
          0,
          0,
          this.classList.contains('embed-frame') ? width : 0,
          this.classList.contains('embed-frame') ? frameHeight : 0,
        );
      });
      vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
        this: HTMLElement,
      ) {
        if (this.classList.contains('embed-score-chart')) return chartHeight;
        if (!stacked || this.hidden || !this.classList.contains('embed-card-current-note'))
          return 0;
        return this.textContent!.length > 80 ? 1000 : 48;
      });
      try {
        const chart = document.createElement('div');
        chart.className = 'embed-score-chart';
        const card = await mountEmbedCard(document.createElement('div'), {
          header: 'Annotated study',
          seats: { first: { name: 'Red', ink: 'red' }, second: { name: 'Black', ink: 'black' } },
          result: '',
          credit: { href: '/study/example', text: 'Study' },
          aspect: 1,
          startPly: 0,
          underBoard: chart,
          mobileNotes: { rootNote: 'Opening note.' },
          mountBoard: async (_host, hooks) => ({
            destroy: vi.fn(),
            jumpToPly: (ply) => hooks.onPlyChange(ply, 1),
            plyCount: () => 1,
            moveEntries: () => [{ ply: 1, label: 'h3-e3', note: 'A very long note. '.repeat(50) }],
          }),
        });
        const readingHeight = (noteHeight: number) =>
          naturalBoxHeight(width, 1, stacked) + chartHeight + 12 + (stacked ? 126 + noteHeight : 0);
        expect(postMessage).toHaveBeenLastCalledWith(
          { type: EMBED_HEIGHT_MESSAGE, height: readingHeight(48), fullReadingHeight: true },
          '*',
        );
        const expectedWidth = stacked
          ? width - 2
          : fitBoardWidth({ width, height: frameHeight - chartHeight - 12 }, 1, false);
        expect(card.frame.querySelector<HTMLElement>('.embed-card-board')!.style.width).toBe(
          `${expectedWidth}px`,
        );
        card.jumpToPly(1);
        // Even a note taller than the placeholder frame must ask the parent for
        // its full height. Desktop keeps the original board and chart geometry.
        expect(postMessage).toHaveBeenLastCalledWith(
          { type: EMBED_HEIGHT_MESSAGE, height: readingHeight(1000), fullReadingHeight: true },
          '*',
        );
        expect(card.frame.querySelector<HTMLElement>('.embed-card-board')!.style.width).toBe(
          `${expectedWidth}px`,
        );
      } finally {
        if (parentDescriptor) Object.defineProperty(window, 'parent', parentDescriptor);
        else Reflect.deleteProperty(window, 'parent');
      }
    },
  );
});
