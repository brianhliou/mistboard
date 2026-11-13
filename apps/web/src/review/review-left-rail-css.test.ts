import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The stylesheet is not applied in this environment, so this pins the CSS
// text, as review-col1-stack.test.ts does.
const css = readFileSync('src/review/review-shell.css', 'utf8').replace(/\s+/g, ' ');

describe('review shell left rail', () => {
  it('holds its sections to the rail width so a long name cannot widen it', () => {
    const rule = css.match(/\.review-shell__left > \.panel-section \{([^}]*)\}/)?.[1];
    expect(rule).toBeDefined();
    expect(rule).toMatch(/grid-template-columns: minmax\(0, 1fr\)/);
  });
});
