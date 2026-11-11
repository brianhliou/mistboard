// Guard against the :has() shape that made each review step cost ~21 ms of style
// recalc on a long game (#608). `.review-shell:has(.review-rail-pocketbox)
// .review-stage__slot--primary > :first-child` put the :has() on the shell and a
// combinator after it, so every node inserted anywhere under the shell (the board
// SVG rebuilt each step) invalidated the shell's whole subtree, 14,644 elements on
// xq_e4ff1ac2. A plain modifier class (`review-shell--pocket`) replaced it.
//
// Two checks over every stylesheet under apps/web/src:
//  1. No :has() whose subject is a page-sized ancestor (html, body, main, :root,
//     .review-shell, .shell, a *-shell / *-page / *-route block class) with a
//     combinator after it. A :has() on that ancestor with nothing after it only
//     restyles the ancestor itself and is allowed.
//  2. No :has() followed by a combinator whose rightmost compound has no class,
//     id, attribute or tag to narrow it (e.g. `> :first-child`, `*`): Blink then
//     invalidates the anchor's entire subtree, whatever the anchor is.
//
// Blind spots: it reads .css files only (no styles injected from TypeScript, no
// inline `style` text); `:not(...)` and `:is(...)` contents count as narrowing
// features even where Blink may not narrow by them; "page-sized" is the name
// list above, so a big container with another name (`.review-shell__cluster`,
// `.review-shell__right`, `.move-list`) passes check 1 and is caught only by
// check 2; nested CSS (`&:has(...)`) is not resolved against its parent rule.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createReviewScaffold, type ReviewScaffoldConfig } from './review-layout.js';

// Vitest runs from apps/web (the other review CSS tests read 'src/...' the same way).
const SRC = join(process.cwd(), 'src');

/** Split on a top-level separator set, ignoring anything inside parentheses or
 *  brackets. */
function splitTopLevel(text: string, isSeparator: (ch: string) => boolean): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(' || ch === '[') depth += 1;
    if (ch === ')' || ch === ']') depth -= 1;
    if (depth === 0 && isSeparator(ch)) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

/** Compounds of one complex selector, left to right. */
function compounds(selector: string): string[] {
  const spaced = selector.replace(/\s*([>+~])\s*/g, ' ').trim();
  return splitTopLevel(spaced, (ch) => ch === ' ').filter(Boolean);
}

const PAGE_SIZED =
  /^(?:html|body|main|:root)(?![\w-])|\.(?:review-shell|shell|[\w-]+-shell|[\w-]+-page|[\w-]+-route)(?![\w-])/;

function hasNarrowingFeature(compound: string): boolean {
  // Drop pseudo-elements and argument-free structural pseudo-classes, then look
  // for a class, id, attribute or leading tag.
  const stripped = compound.replace(/::?[\w-]+(?:\([^()]*\))?/g, (m) =>
    /^:(?:is|where|not|has)\(/.test(m) ? m : '',
  );
  // A tag counts at the start or as an :is()/:where() argument (`:is(th, td)`).
  return /[.#[]/.test(stripped) || /(?:^|[(,]\s*)[a-z]/i.test(stripped);
}

type HasViolation = { selector: string; reason: string };

function findCostlyHas(css: string): HasViolation[] {
  const out: HasViolation[] = [];
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const match of body.matchAll(/([^{};]+)\{/g)) {
    const prelude = (match[1] ?? '').trim().replace(/\s+/g, ' ');
    if (prelude.startsWith('@') || !prelude.includes(':has(')) continue;
    for (const raw of splitTopLevel(prelude, (ch) => ch === ',')) {
      const selector = raw.trim();
      const parts = compounds(selector);
      const last = parts.length - 1;
      parts.forEach((compound, index) => {
        if (!compound.includes(':has(') || index === last) return;
        const subject = compound.slice(0, compound.indexOf(':has('));
        if (PAGE_SIZED.test(subject)) {
          out.push({
            selector,
            reason: `page-sized :has() subject "${subject}" with a combinator after it`,
          });
        } else if (!hasNarrowingFeature(parts[last] ?? '')) {
          out.push({
            selector,
            reason: `rightmost "${parts[last]}" has nothing to narrow invalidation`,
          });
        }
      });
    }
  }
  return out;
}

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((name) => name.endsWith('.css'))
    .map((name) => join(dir, name));
}

describe('costly :has() guard (#608)', () => {
  it('flags the rule that caused #608 (planted failure)', () => {
    const old = `.review-shell:has(.review-rail-pocketbox) .review-stage__slot--primary > :first-child,
.review-shell:has(.review-rail-pocketbox) .review-stage__slot--primary > :first-child > svg {
  border-start-end-radius: 0;
}`;
    const found = findCostlyHas(old);
    expect(found).toHaveLength(2);
    expect(found[0]?.reason).toContain('page-sized');
  });

  it('flags a page-sized subject with a child combinator and a whole-subtree tail', () => {
    expect(findCostlyHas('body:has(.x) > .y { color: red; }')).toHaveLength(1);
    expect(findCostlyHas('.panel:has(.x) > :first-child { color: red; }')).toHaveLength(1);
    expect(
      findCostlyHas('@media (min-width: 1px) { main:has(.x) * { color: red; } }'),
    ).toHaveLength(1);
  });

  it('allows a :has() on a leaf, or on a page-sized ancestor with nothing after it', () => {
    const fine = `
      body:has(.puzzles-shell) { background: red; }
      .review-shell__cluster:has(.reveal-odds-row)::before { content: ''; }
      .study-chapters__row:has(.study-chapters__drag) .study-chapters__link { color: red; }
      .review-shell--pocket .review-stage__slot--primary > :first-child { color: red; }
    `;
    expect(findCostlyHas(fine)).toEqual([]);
  });

  it('finds no costly :has() in any web stylesheet', () => {
    const violations = cssFiles(SRC).flatMap((file) =>
      findCostlyHas(readFileSync(file, 'utf8')).map(
        (v) => `${relative(SRC, file)}: ${v.selector} (${v.reason})`,
      ),
    );
    expect(violations).toEqual([]);
  });
});

function el(className: string): HTMLElement {
  const node = document.createElement('div');
  node.className = className;
  return node;
}

function mount(overrides: Partial<ReviewScaffoldConfig> = {}): HTMLElement {
  const root = document.createElement('div');
  document.body.append(root);
  createReviewScaffold(root, {
    reviewSurface: 'analysis',
    ariaLabel: 'Analysis',
    title: 'Test',
    summary: '',
    boards: [{ key: 'truth', tier: 'primary', el: el('test-board') }],
    boardAspect: 10 / 9,
    moves: el('test-moves'),
    navigation: el('review-controls'),
    ...overrides,
  });
  const shell = root.querySelector<HTMLElement>('.review-shell');
  if (!shell) throw new Error('no shell');
  return shell;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('review-shell--pocket', () => {
  it('is set on the shell when the scaffold mounts a pocket box', () => {
    const shell = mount({ showBoardMaterial: true, materialTop: el('test-pocket-top') });
    expect(shell.querySelector('.review-rail-pocketbox')).not.toBeNull();
    expect(shell.classList.contains('review-shell--pocket')).toBe(true);
  });

  it('is absent when there is no pocket, including material passed but switched off', () => {
    expect(mount().classList.contains('review-shell--pocket')).toBe(false);
    const off = mount({ materialTop: el('test-pocket-top') });
    expect(off.querySelector('.review-rail-pocketbox')).toBeNull();
    expect(off.classList.contains('review-shell--pocket')).toBe(false);
  });
});
