// The lesson player on a phone is one screen with no page scroll, as the
// puzzle page is (puzzles-phone-stack.test.ts): the board flush to the screen
// edges, then one strip holding the prompt, its button and the lesson text.
// The chapter rail is hidden, so the dock's Chapters sheet lists the chapters
// and the Info sheet borrows the rail's like and copy buttons. These pin the
// CSS that makes it so; a layout that scrolls again fails here.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Whitespace collapsed: Biome wraps long selectors over several lines.
const css = readFileSync('src/review/gamebook.css', 'utf8').replace(/\s+/g, ' ');
const phone = css.slice(css.lastIndexOf('@media (max-width: 600px)'));
const scope = '.gamebook:not(.practice)';

function rule(selector: string): string {
  const at = phone.indexOf(`${selector} {`);
  expect(at, `phone rule for ${selector}`).toBeGreaterThan(-1);
  return phone.slice(at, phone.indexOf('}', at));
}

describe('lesson player phone stack', () => {
  it('is the last block in the file, so nothing after it can undo it', () => {
    expect(phone.indexOf('@media', 10)).toBe(-1);
  });

  it('fills exactly the screen between the page chrome and the study dock', () => {
    const root = rule(scope);
    expect(root).toContain(
      '100dvh - var(--gamebook-page-top, 78px) - 60px - env(safe-area-inset-bottom, 0px)',
    );
    expect(root).toContain('height: var(--gamebook-phone-height);');
    expect(root).toContain('overflow: hidden;');
    expect(root).toContain('flex-direction: column;');
  });

  it('puts the board flush to the screen edges, limited only by height', () => {
    const root = rule(scope);
    expect(root).toContain('--gamebook-board-fit: min(100vw,');
    expect(root).toContain('margin: 0;');
    expect(root).toContain('padding: 0;');
  });

  it('hides the chapter rail, the move record and the resize grip', () => {
    expect(phone).toContain(
      `${scope} .gamebook__aside, ${scope} .gamebook__moves, ${scope} .board-resize-grip { display: none; }`,
    );
  });

  it('scrolls a long lesson text inside the strip, never the page', () => {
    const coach = rule(`${scope} .gamebook__coach`);
    expect(coach).toContain('flex: 1 1 0;');
    expect(coach).toContain('min-height: 0;');
    expect(coach).toContain('overflow: hidden;');
    const bubble = rule(`${scope} .gamebook__coach[data-state="end"] .gamebook__bubble`);
    expect(bubble).toContain('overflow-y: auto;');
    expect(bubble).toContain('min-height: 0;');
  });

  it('keeps the strip button a full tap target beside the prompt', () => {
    const button = rule(`${scope} .gamebook__coach .gamebook__btn.gamebook__next`);
    expect(button).toContain('min-height: 44px;');
    expect(button).toContain('width: auto;');
  });

  it('lends the hidden rail’s like and copy buttons to the Info sheet', () => {
    const source = readFileSync('src/study-phone.ts', 'utf8');
    const blocks = source.slice(source.indexOf('const INFO_BLOCKS'), source.indexOf('] as const;'));
    expect(blocks).toContain("'.study-gamebook-rail .study-actions'");
  });
});
