import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The homepage hover grammar (hover-grammar.css): text links, cards and list
// rows, one green. These read the stylesheets as text, so they guard the two
// ways the grammar broke before it was written down: a zebra rule that
// outranked the row hover tint, and focus outlines suppressed on hover targets.

type Rule = { selector: string; body: string };

function rules(css: string): Rule[] {
  const out: Rule[] = [];
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const match of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push({ selector: (match[1] ?? '').trim(), body: match[2] ?? '' });
  }
  return out;
}

// A zebra stripe that paints `background` competes with the hover tint on
// specificity and wins on the striped rows; stripes set --site-box-row-bg.
function zebraRulesPaintingBackground(css: string): string[] {
  return rules(css)
    .filter((rule) => /site-box-row[^,]*:nth-child/.test(rule.selector))
    .filter((rule) => /(^|;|\s)background(-color)?\s*:/.test(rule.body))
    .map((rule) => rule.selector);
}

describe('hover grammar', () => {
  it('catches a zebra stripe that paints background (planted)', () => {
    const planted = `.site-box-body > .site-box-row:nth-child(even) {
      background: var(--site-zebra);
    }`;
    expect(zebraRulesPaintingBackground(planted)).toHaveLength(1);
  });

  it('keeps every row stripe off the background property', () => {
    for (const file of [
      'site-box.css',
      'landing-community-widgets.css',
      'landing-forum-preview.css',
    ]) {
      const css = readFileSync(`src/${file}`, 'utf8');
      expect(zebraRulesPaintingBackground(css), file).toEqual([]);
    }
  });

  it('turns hover text one green, --site-link', () => {
    const css = readFileSync('src/hover-grammar.css', 'utf8');
    const colors = rules(css).flatMap((rule) =>
      [...rule.body.matchAll(/(?:^|;|\s)color\s*:\s*([^;]+);/g)].map((m) => (m[1] ?? '').trim()),
    );
    expect(colors.length).toBeGreaterThan(0);
    for (const color of colors) expect(['var(--site-link)', 'inherit']).toContain(color);
  });

  it('does not suppress the focus ring on homepage hover targets', () => {
    for (const file of [
      'hover-grammar.css',
      'landing-event-banners.css',
      'landing-announcements.css',
      'site-box.css',
    ]) {
      const css = readFileSync(`src/${file}`, 'utf8');
      expect(css, file).not.toMatch(/outline\s*:\s*(none|0)\b/);
    }
  });
});
