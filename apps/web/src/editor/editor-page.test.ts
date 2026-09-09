import { afterEach, describe, expect, it } from 'vitest';
import { EDITOR_VARIANTS, type EditorVariantId } from './editor-catalog.js';
import { mountEditorPage } from './editor-page.js';

// End-to-end wiring (happy-dom): every EDITOR variant mounts a working editor
// (picker, board, FEN field, analysis-board link), and the xiangqi / banqi /
// jieqi flows exercise the brushes, the FEN seed, and the dealt-variant rules
// the editor enforces itself. The editor's list is a subset of the analysis
// catalog (editor-catalog.ts), and its dropdown shows that shorter list: an
// analysis variant with no editor must not be offered a route that 404s.

let root: HTMLElement | null = null;

function mount(variant: EditorVariantId, fen?: string): HTMLElement {
  root = document.createElement('div');
  document.body.append(root);
  mountEditorPage(root, variant, { fen: fen ?? null });
  return root;
}

afterEach(() => {
  root?.remove();
  root = null;
  // The editor writes ?fen= into the address bar; a leftover would seed the
  // next test's mount.
  window.history.replaceState(null, '', '/');
});

function fenField(el: HTMLElement): HTMLInputElement {
  return el.querySelector<HTMLInputElement>('.editor-fen__field')!;
}

function square(el: HTMLElement, name: string): HTMLButtonElement {
  return el.querySelector<HTMLButtonElement>(`.editor-square[data-square="${name}"]`)!;
}

function palette(el: HTMLElement, color: string, role: string): HTMLButtonElement {
  return el.querySelector<HTMLButtonElement>(
    `.editor-palette__piece[data-color="${color}"][data-role="${role}"]`,
  )!;
}

function brush(el: HTMLElement, kind: string): HTMLButtonElement {
  return el.querySelector<HTMLButtonElement>(`.editor-brush[data-brush="${kind}"]`)!;
}

function buttonNamed(el: HTMLElement, text: string): HTMLButtonElement {
  const found = [...el.querySelectorAll<HTMLButtonElement>('button.editor-btn')].find(
    (button) => button.textContent === text,
  );
  if (!found) throw new Error(`no button "${text}"`);
  return found;
}

describe('editor page', () => {
  for (const variant of EDITOR_VARIANTS) {
    it(`mounts the ${variant.id} editor`, () => {
      const el = mount(variant.id);
      const select = el.querySelector<HTMLSelectElement>('.analysis-variant-picker select');
      expect(select, 'variant picker').not.toBeNull();
      expect(select!.value).toBe(variant.id);
      expect(select!.options.length).toBe(EDITOR_VARIANTS.length);
      expect(el.querySelector('.editor-board__svg svg'), 'board svg').not.toBeNull();
      expect(el.querySelectorAll('.editor-square').length).toBeGreaterThan(0);
      expect(fenField(el).value).not.toBe('');
      const link = el.querySelector<HTMLAnchorElement>('.editor-analysis-link')!;
      expect(link.getAttribute('href')).toMatch(new RegExp(`^/analysis/${variant.id}\\?fen=`));
      // Both palettes carry the two colours' pieces.
      expect(
        el.querySelectorAll('.editor-palette--top .editor-palette__piece').length,
      ).toBeGreaterThan(0);
      expect(
        el.querySelectorAll('.editor-palette--bottom .editor-palette__piece').length,
      ).toBeGreaterThan(0);
    });
  }

  it('xiangqi: the start position is valid and the analysis link is live', () => {
    const el = mount('xiangqi');
    const link = el.querySelector<HTMLAnchorElement>('.editor-analysis-link')!;
    expect(link.getAttribute('aria-disabled')).toBe('false');
    expect(el.querySelector<HTMLElement>('.editor-validation')!.hidden).toBe(true);
    expect(fenField(el).value).toBe(
      'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR r - - 0 1',
    );
    expect(decodeURIComponent(link.getAttribute('href')!.split('?fen=')[1]!)).toBe(
      fenField(el).value,
    );
  });

  it('xiangqi: a palette piece then a square places it and the FEN changes', () => {
    const el = mount('xiangqi');
    const before = fenField(el).value;
    palette(el, 'red', 'cannon').click();
    expect(palette(el, 'red', 'cannon').getAttribute('aria-pressed')).toBe('true');
    square(el, 'e5').click();
    const after = fenField(el).value;
    expect(after).not.toBe(before);
    expect(after.split(' ')[0]!.split('/')[5]).toBe('4C4');
    // The brush stays selected: a second square gets the same piece.
    square(el, 'a5').click();
    expect(fenField(el).value.split(' ')[0]!.split('/')[5]).toBe('C3C4');
  });

  it('xiangqi: the delete brush removes a piece', () => {
    const el = mount('xiangqi');
    brush(el, 'delete').click();
    square(el, 'a1').click();
    expect(fenField(el).value.split(' ')[0]!.split('/')[9]).toBe('1NBAKABNR');
    expect(square(el, 'a1').classList.contains('has-piece')).toBe(false);
  });

  it('xiangqi: pointer click-then-click moves a piece', () => {
    const el = mount('xiangqi');
    square(el, 'b3').click();
    expect(square(el, 'b3').classList.contains('is-selected')).toBe(true);
    square(el, 'b5').click();
    const rows = fenField(el).value.split(' ')[0]!.split('/');
    expect(rows[7]).toBe('7C1');
    expect(rows[5]).toBe('1C7');
  });

  it('xiangqi: clear board empties the position and flags it invalid', () => {
    const el = mount('xiangqi');
    buttonNamed(el, 'Clear board').click();
    expect(fenField(el).value).toBe('9/9/9/9/9/9/9/9/9/9 r - - 0 1');
    const link = el.querySelector<HTMLAnchorElement>('.editor-analysis-link')!;
    expect(link.getAttribute('aria-disabled')).toBe('true');
    expect(el.querySelector<HTMLElement>('.editor-validation')!.hidden).toBe(false);
    buttonNamed(el, 'Start position').click();
    expect(link.getAttribute('aria-disabled')).toBe('false');
  });

  it('xiangqi: side to move is written into the FEN', () => {
    const el = mount('xiangqi');
    const black = el.querySelector<HTMLInputElement>('input[name="editor-turn"][value="black"]')!;
    black.checked = true;
    black.dispatchEvent(new Event('change'));
    expect(fenField(el).value.endsWith(' b - - 0 1')).toBe(true);
  });

  it('xiangqi: ?fen= seeds the editor', () => {
    const seed = '4k4/9/9/9/9/9/9/9/9/4K4 b - - 0 1';
    const el = mount('xiangqi', seed);
    expect(fenField(el).value).toBe(seed);
    expect(
      el.querySelector<HTMLInputElement>('input[name="editor-turn"][value="black"]')!.checked,
    ).toBe(true);
  });

  it('xiangqi: an unreadable ?fen= falls back to the start position', () => {
    const el = mount('xiangqi', 'not a fen');
    expect(fenField(el).value).toBe(
      'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR r - - 0 1',
    );
  });

  it('xiangqi: the FEN field loads a typed position on Enter and reports garbage inline', () => {
    const el = mount('xiangqi');
    const field = fenField(el);
    field.value = '4k4/9/9/9/9/9/9/9/9/4K4 r - - 0 1';
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(el.querySelectorAll('.editor-square.has-piece').length).toBe(2);
    field.value = 'garbage';
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    const error = el.querySelector<HTMLElement>('.editor-fen__error')!;
    expect(error.hidden).toBe(false);
    expect(error.textContent).toContain('Could not read');
    // The board is untouched by a failed load.
    expect(el.querySelectorAll('.editor-square.has-piece').length).toBe(2);
  });

  it('banqi: placing a face-down tile updates the status line and the pool in the FEN', () => {
    const el = mount('banqi');
    const status = el.querySelector<HTMLElement>('.editor-pool__status')!;
    expect(status.textContent).toBe('32 face-down tiles on board, pool has 32 pieces');
    expect(fenField(el).value).toBe(
      'XXXXXXXX/XXXXXXXX/XXXXXXXX/XXXXXXXX - G1A2E2R2H2C2S5g1a2e2r2h2c2s5 0 1',
    );

    buttonNamed(el, 'Clear board').click();
    expect(status.textContent).toBe('0 face-down tiles on board, pool has 32 pieces');
    expect(status.classList.contains('is-error')).toBe(true);

    // A revealed general leaves the pool; the opening turn is no longer offered.
    palette(el, 'red', 'general').click();
    square(el, 'a1').click();
    expect(fenField(el).value).toBe('8/8/8/G7 r A2E2R2H2C2S5g1a2e2r2h2c2s5 0 1');
    expect(
      el.querySelector<HTMLInputElement>('input[name="editor-turn"][value="-"]')!.disabled,
    ).toBe(true);

    // A face-down tile goes on the board and the count moves toward the pool.
    palette(el, 'none', 'face-down').click();
    square(el, 'b1').click();
    expect(status.textContent).toBe('1 face-down tiles on board, pool has 31 pieces');
    expect(fenField(el).value).toBe('8/8/8/GX6 r A2E2R2H2C2S5g1a2e2r2h2c2s5 0 1');

    // Marking a black soldier captured shrinks the pool.
    const plus = el.querySelector<HTMLButtonElement>(
      '.editor-pool__group[data-color="black"] .editor-pool__row[data-role="soldier"] .editor-stepper__button[aria-label="One more captured"]',
    )!;
    plus.click();
    expect(status.textContent).toBe('1 face-down tiles on board, pool has 30 pieces');
    expect(fenField(el).value).toBe('8/8/8/GX6 r A2E2R2H2C2S5g1a2e2r2h2c2s4 0 1');
  });

  it('banqi: the board never flips', () => {
    const el = mount('banqi');
    expect(buttonNamed(el, 'Flip board').disabled).toBe(true);
  });

  it('jieqi: a dark piece on a non-home square is rejected', () => {
    const el = mount('jieqi');
    const before = fenField(el).value;
    palette(el, 'red', 'face-down').click();
    square(el, 'e5').click();
    expect(fenField(el).value).toBe(before);
    const notice = el.querySelector<HTMLElement>('.editor-notice')!;
    expect(notice.hidden).toBe(false);
    expect(notice.textContent).toContain('home square');
    // The same brush on a home square is fine (after the delete brush frees it).
    brush(el, 'delete').click();
    square(el, 'a1').click();
    palette(el, 'red', 'face-down').click();
    square(el, 'a1').click();
    expect(fenField(el).value).toBe(before);
    expect(notice.hidden).toBe(true);
  });

  it('dark-chess: the castling card follows the board and writes the FEN', () => {
    const el = mount('dark-chess');
    const box = (right: string) =>
      el.querySelector<HTMLInputElement>(`.editor-chess input[data-castling="${right}"]`)!;
    for (const right of ['K', 'Q', 'k', 'q']) {
      expect(box(right).checked, right).toBe(true);
      expect(box(right).disabled, right).toBe(false);
    }
    expect(fenField(el).value).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    // Unticking a right drops it from the FEN.
    box('K').checked = false;
    box('K').dispatchEvent(new Event('change'));
    expect(fenField(el).value.split(' ')[2]).toBe('Qkq');
    expect(box('K').checked).toBe(false);
    // Moving the white king off e1 disables and clears both white rights.
    square(el, 'e1').click();
    square(el, 'e2').click();
    expect(box('K').disabled).toBe(true);
    expect(box('Q').disabled).toBe(true);
    expect(box('K').checked).toBe(false);
    expect(box('Q').checked).toBe(false);
    expect(box('k').disabled).toBe(false);
    expect(box('k').checked).toBe(true);
    expect(fenField(el).value.split(' ')[2]).toBe('kq');
    // The start position offers no en passant square: the select is inert.
    const select = el.querySelector<HTMLSelectElement>('.editor-chess select.editor-ep')!;
    expect(select.disabled).toBe(true);
    expect([...select.options].map((option) => option.value)).toEqual(['']);
  });

  it('dark-chess: the en passant select offers exactly the legal squares', () => {
    const el = mount('dark-chess', '4k3/8/8/8/4P3/8/8/4K3 b - - 0 1');
    const select = el.querySelector<HTMLSelectElement>('.editor-chess select.editor-ep')!;
    expect(select.disabled).toBe(false);
    expect([...select.options].map((option) => option.value)).toEqual(['', 'e3']);
    select.value = 'e3';
    select.dispatchEvent(new Event('change'));
    expect(fenField(el).value).toBe('4k3/8/8/8/4P3/8/8/4K3 b - e3 0 1');
    const link = el.querySelector<HTMLAnchorElement>('.editor-analysis-link')!;
    expect(link.getAttribute('aria-disabled')).toBe('false');
    // Handing the move to white makes e3 impossible: the square is dropped.
    const white = el.querySelector<HTMLInputElement>('input[name="editor-turn"][value="white"]')!;
    white.checked = true;
    white.dispatchEvent(new Event('change'));
    expect(fenField(el).value).toBe('4k3/8/8/8/4P3/8/8/4K3 w - - 0 1');
    expect(
      [...el.querySelector<HTMLSelectElement>('.editor-chess select.editor-ep')!.options].map(
        (option) => option.value,
      ),
    ).toEqual(['']);
  });

  it('xiangqi: no castling card on a variant without extras', () => {
    const el = mount('xiangqi');
    expect(el.querySelector('.editor-chess')).toBeNull();
    expect(el.querySelector<HTMLElement>('.editor-extras')!.hidden).toBe(true);
  });

  it('the address bar follows the position and a reload restores it', () => {
    window.history.replaceState(null, '', '/editor/xiangqi');
    const el = mount('xiangqi');
    // The start position keeps the URL clean.
    expect(window.location.search).toBe('');
    palette(el, 'red', 'cannon').click();
    square(el, 'e5').click();
    const fen = fenField(el).value;
    expect(new URLSearchParams(window.location.search).get('fen')).toBe(fen);
    expect(window.location.pathname).toBe('/editor/xiangqi');
    // Slashes stay readable in the share link.
    expect(window.location.search).toContain('4C4/');
    buttonNamed(el, 'Start position').click();
    expect(window.location.search).toBe('');
    // Back to the edited position (the cannon brush is still active), then a
    // fresh mount from the bar.
    square(el, 'e5').click();
    expect(fenField(el).value).toBe(fen);
    const url = window.location.href;
    root!.remove();
    window.history.replaceState(null, '', url);
    const again = mount('xiangqi');
    expect(fenField(again).value).toBe(fen);
    expect(
      again.querySelector('.editor-square[data-square="e5"]')!.classList.contains('has-piece'),
    ).toBe(true);
  });

  it('the address bar is replaced, never pushed', () => {
    window.history.replaceState(null, '', '/editor/xiangqi');
    const before = window.history.length;
    const el = mount('xiangqi');
    palette(el, 'red', 'cannon').click();
    square(el, 'e5').click();
    square(el, 'a5').click();
    expect(window.history.length).toBe(before);
  });

  it('jieqi: the palette has no dark general', () => {
    const el = mount('jieqi');
    expect(palette(el, 'red', 'general')).not.toBeNull();
    expect(
      el.querySelectorAll('.editor-palette--bottom .editor-palette__piece[data-role="face-down"]')
        .length,
    ).toBe(1);
  });
});
