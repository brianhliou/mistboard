import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The Fanfanqi review seat row (live-ffq-banqi.css). The stylesheet is not
// applied in this environment, so this pins the CSS text, as
// banqi-seat-panel-css.test.ts does.
const cssPath = ['src/live-ffq-banqi.css', 'apps/web/src/live-ffq-banqi.css']
  .map((candidate) => resolve(process.cwd(), candidate))
  .find((candidate) => existsSync(candidate));
const css = readFileSync(cssPath as string, 'utf8').replace(/\s+/g, ' ');

function rule(selector: string): string | undefined {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`(?:^|\\}) ?${escaped} \\{([^}]*)\\}`))?.[1];
}

describe('Fanfanqi review seat row HP', () => {
  // A seat can take pieces of both inks, so its captures can fill the row; a
  // bar that stretched with the row took that room from them and the name.
  it('is a fixed readout at the row end, not a bar that grows with the row', () => {
    const meter = rule('.review-seat__material > .ffq-banqi-hp-meter');
    expect(meter).toMatch(/flex: 0 0 auto/);
    expect(meter).toMatch(/margin-left: auto/);
    expect(meter).toMatch(/flex-direction: column/);
    const bar = rule('.review-seat__material > .ffq-banqi-hp-meter progress');
    expect(bar).toMatch(/width: 100%/);
    expect(bar).not.toMatch(/min-width|max-width/);
  });

  it('keeps the readout inside the one-line seat row', () => {
    const bar = rule('.review-seat__material > .ffq-banqi-hp-meter progress');
    const height = Number(bar?.match(/height: (\d+)px/)?.[1]);
    // The value line (11px at line-height 1), the 2px gap and the bar fit the
    // row's 24px material strip (review/seat-labels.css).
    expect(11 + 2 + height).toBeLessThanOrEqual(24);
  });
});
