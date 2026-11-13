import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The Three Kingdoms and Fanfanqi seat panel (banqi-seat-panel.css). The
// stylesheet is not applied in this environment, so this pins the CSS text, as
// banqi-rail-material-css.test.ts does.
const cssPath = ['src/banqi-seat-panel.css', 'apps/web/src/banqi-seat-panel.css']
  .map((candidate) => resolve(process.cwd(), candidate))
  .find((candidate) => existsSync(candidate));
const css = readFileSync(cssPath as string, 'utf8');

describe('banqi seat panel captured discs', () => {
  it('wraps the discs inside the captures row, not only the rows', () => {
    const rule = css.match(/\.tk-seat__pieces\s+\.captures-row\s*\{([^}]*)\}/)?.[1];
    expect(rule).toBeDefined();
    expect(rule).toMatch(/flex-wrap:\s*wrap/);
  });

  it('lines up the two Three Kingdoms seats row for row when side by side', () => {
    const flat = css.replace(/\s+/g, ' ');
    const seat = flat.match(
      /\.hidden-pool \.tk-seat \{([^}]*grid-template-rows: subgrid[^}]*)\}/,
    )?.[1];
    expect(seat).toMatch(/grid-row: span 5/);
    const withNote = flat.match(/\.tk-seat:has\(\.hidden-pool__note\) \{([^}]*)\}/)?.[1];
    expect(withNote).toMatch(/grid-row: span 6/);
  });
});
