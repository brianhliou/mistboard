import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The room's right column (game-table.ts) is styled by game-shell.css for every
// room stack. The stylesheet is not applied in this environment, so these pin
// the CSS text (same approach as articles-replay-css.test.ts). Both rules come
// from Brian's 2026-10-02 playtest of a variant room.
const cssPath = ['src/game-shell.css', 'apps/web/src/game-shell.css']
  .map((candidate) => resolve(process.cwd(), candidate))
  .find((candidate) => existsSync(candidate));
const css = readFileSync(cssPath as string, 'utf8');

/** The body of the first top-level rule whose selector list is exactly `selector`. */
function rule(selector: string): string {
  const needle = `\n${selector} {`;
  let start = css.indexOf(needle);
  // Skip grouped selectors (`.game-info div,\n.clocks div {`): the line before
  // a rule of its own does not end in a comma.
  while (start > -1 && css.slice(0, start).trimEnd().endsWith(',')) {
    start = css.indexOf(needle, start + 1);
  }
  expect(start, `rule not found: ${selector}`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('}', start));
}

describe('room clocks', () => {
  it('span the full column, the width of the boxed table they join', () => {
    // A `fit-content` tab left ~40% of the column empty beside the clock.
    const body = rule('.clocks div');
    expect(body).toContain('width: 100%;');
    expect(body).not.toContain('fit-content');
  });
});

describe('in-game action row', () => {
  it('stretches every action across the column like the postgame actions', () => {
    // Resign was a small centred button above full-width postgame rows.
    const body = rule('.game-controls button');
    expect(body).toContain('flex: 1 1 0;');
    expect(body).toContain('text-transform: uppercase;');
    expect(body).not.toContain('width: auto');
    expect(rule('.game-controls')).not.toContain('justify-content: center');
  });
});
