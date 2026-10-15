import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// Text that clips its overflow (an ellipsis, a line clamp, overflow: hidden)
// shows only its line box, so a line-height shorter than the font's glyph box
// cuts the bottom of g, j, p, q, y (#543, the homepage correspondence card).
// Noto Sans's glyph box is 1.36 em; measured in Chromium and WebKit, its ink
// fits from 1.3 up, and 1.1-1.25 cut descenders by 0.4-1.6px. This guard reads
// every stylesheet, merges each selector's declarations, and fails a clipping
// rule that sets its own line-height under the bar with no vertical padding to
// hold the ink. A clipping rule that inherits a tight line-height from a parent
// is out of its reach: `node scripts/descender-clip-check.mjs` measures the
// rendered pages for those.

const BAR = 1.3;

// Selector -> why its tight line box is safe.
const ALLOWED: Record<string, string> = {
  '.captures-row': 'holds piece icons, not text',
  '.opening-explorer__bar-part': 'percent figures in a bar segment: digits, no descenders',
  '.articles-index-card-title': 'Roboto, whose glyph box is 1.17 em, so 1.28 holds the ink',
};

type Rule = { file: string; decls: Record<string, string> };

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return cssFiles(path);
    return entry.name.endsWith('.css') ? [path] : [];
  });
}

function mergedRules(): Map<string, Rule> {
  const rules = new Map<string, Rule>();
  for (const file of cssFiles('src')) {
    const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const decls: Record<string, string> = {};
      for (const decl of match[2].split(';')) {
        const colon = decl.indexOf(':');
        if (colon > 0) decls[decl.slice(0, colon).trim()] = decl.slice(colon + 1).trim();
      }
      for (const raw of match[1].split(',')) {
        const selector = raw.trim().replace(/\s+/g, ' ');
        if (!selector || selector.startsWith('@') || /^(from|to|[\d.]+%)$/.test(selector)) continue;
        const rule = rules.get(selector) ?? { file, decls: {} };
        Object.assign(rule.decls, decls);
        rules.set(selector, rule);
      }
    }
  }
  return rules;
}

function clips(decls: Record<string, string>): boolean {
  const overflow = [decls.overflow, decls['overflow-y'], decls['overflow-x']].join(' ');
  return (
    /\b(hidden|clip)\b/.test(overflow) ||
    decls['text-overflow'] === 'ellipsis' ||
    '-webkit-line-clamp' in decls ||
    'line-clamp' in decls
  );
}

function lineHeightRatio(decls: Record<string, string>): number | null {
  const value = decls['line-height'];
  if (!value) return null;
  if (/^[\d.]+$/.test(value)) return Number(value);
  const px = value.match(/^([\d.]+)px$/)?.[1];
  const fontPx = decls['font-size']?.match(/^([\d.]+)px$/)?.[1];
  return px && fontPx ? Number(px) / Number(fontPx) : null;
}

function hasVerticalPadding(decls: Record<string, string>): boolean {
  const values = [
    decls.padding,
    decls['padding-block'],
    decls['padding-top'],
    decls['padding-bottom'],
  ].filter(Boolean);
  return values.some((value) => /[1-9]/.test(value.split(/\s+/)[0] ?? ''));
}

describe('clipped text keeps its descenders', () => {
  const rules = mergedRules();

  it('finds the stylesheets', () => {
    expect(rules.size).toBeGreaterThan(1000);
  });

  it(`gives every clipping rule a line box of at least ${BAR} em`, () => {
    const offenders: string[] = [];
    for (const [selector, { file, decls }] of rules) {
      if (selector in ALLOWED || !clips(decls) || hasVerticalPadding(decls)) continue;
      const ratio = lineHeightRatio(decls);
      if (ratio !== null && ratio < BAR) {
        offenders.push(`${file}: ${selector} (line-height ${decls['line-height']})`);
      }
    }
    expect(offenders).toEqual([]);
  });

  // These clipped with an inherited tight line-height, which the scan above
  // cannot see, so each must keep setting its own.
  it.each(['.landing-corr-title', '.pp-step-main', '.pp-step-sub', '.xqb-card-seat-name'])(
    '%s sets its own line box',
    (selector) => {
      const decls = rules.get(selector)?.decls ?? {};
      expect(lineHeightRatio(decls) ?? 0).toBeGreaterThanOrEqual(BAR);
    },
  );

  it('keeps the allowlist current', () => {
    for (const selector of Object.keys(ALLOWED)) {
      expect(rules.has(selector), selector).toBe(true);
    }
  });
});
