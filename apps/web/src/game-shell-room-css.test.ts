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
  // 2026-10-02 stretched the clock to the full column (the tab's gap beside the
  // table read as unfinished); 2026-10-03 Brian asked for the lichess tab back
  // ("all the way long to the right ... we want more like lichess").
  it('are a lichess tab beside the rail, sized to their digits', () => {
    const body = rule('.clocks div');
    expect(body).toContain('width: fit-content;');
    expect(body).not.toMatch(/^\s*width: 100%;/m);
  });

  it('take the full column on a phone, where they stack under the board', () => {
    const phone = css.slice(css.indexOf('@media (max-width: 799px) {\n  .clocks div {'));
    expect(phone.length, 'phone clock override missing').toBeLessThan(css.length);
    expect(phone.slice(0, phone.indexOf('}'))).toContain('width: 100%;');
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
