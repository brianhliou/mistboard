import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Phone room (600px and under, #576): the seat lines and pocket lines have to
// keep a known height, or the move strip and the action bar fall below the
// fold. Found by the all-variant phone sweep (2026-10-17): at 320px a jieqi
// haul wrapped into a column, and the crazyhouse pockets took 54px lines the
// board's budget did not know about.

const css = readFileSync(resolve(__dirname, 'live-review.css'), 'utf-8');
const phone = css.slice(css.indexOf('@media (max-width: 600px)'));

function rule(selectorStart: string): string {
  const at = phone.indexOf(selectorStart);
  expect(at).toBeGreaterThan(0);
  const body = phone.slice(phone.indexOf('{', at) + 1);
  return body.slice(0, body.indexOf('}'));
}

describe('phone room bands', () => {
  it('keeps captured pieces on the seat line, scrolling sideways', () => {
    const strip = rule(
      '.live-review__cluster .captures-strip-top:not(.drop-mini-reserve-strip),\n  .live-review__cluster .captures-strip-bottom:not(.drop-mini-reserve-strip) {\n    display: flex;',
    );
    expect(strip).toContain('flex-wrap: nowrap;');
    expect(strip).toContain('min-width: 0;');
    expect(strip).toContain('overflow-x: auto;');
  });

  it('gives drop pockets a fixed slot that the board budget gives up', () => {
    const budget = rule('.review-shell__cluster.live-review__cluster:has(.drop-pocket)');
    expect(budget).toContain('--phone-room-pocket: 36px;');
    expect(budget).toContain('--phone-room-extra: calc(2 * (var(--phone-room-pocket) + 6px));');
    expect(rule('.live-review__cluster .drop-pocket .drop-mini-reserve-row')).toContain(
      '--pocket-slot: var(--phone-room-pocket, 36px);',
    );
  });

  it('pins the clock to the right edge of its seat line', () => {
    const clock = rule(
      '.live-review__cluster [data-clock-top],\n  .live-review__cluster [data-clock-bottom] {\n    display: flex;',
    );
    expect(clock).toContain('margin-left: auto;');
  });

  it('ends the screen with the moves strip and the bar (no page scroll)', () => {
    const moves = rule('.live-review__cluster .game-table-moves {\n    margin-top');
    expect(moves).toContain('var(--phone-room-slack)');
    const cluster = rule('.review-shell__cluster.live-review__cluster {\n    --phone-room-band');
    expect(cluster).toContain('--phone-room-board-h: calc(');
    expect(cluster).toContain('var(--uni-board-aspect, 1)');
    expect(cluster).toContain(
      '--phone-room-slack: max(0px, calc(var(--uni-board-h-budget) - var(--phone-room-board-h)));',
    );
    expect(rule('main.shell:has(.live-review__cluster)')).toContain('padding-bottom: 0;');
  });

  it('keeps the game card and chat in a sheet, off the page', () => {
    expect(
      rule('.review-shell__cluster.live-review__cluster > .meta-panel {\n    display: none;'),
    ).toBe('\n    display: none;\n  ');
    const sheet = rule(
      '.review-shell__cluster.live-review__cluster[data-room-sheet="open"] > .meta-panel',
    );
    expect(sheet).toContain('position: fixed;');
    expect(sheet).toContain('overflow-y: auto;');
  });

  it('gives a face-down pool a fixed slot that the board budget gives up', () => {
    expect(rule('.live-review__cluster .hidden-pool:not(:empty)')).toContain(
      'height: var(--phone-room-pool, 96px);',
    );
    expect(rule('.live-review__cluster .hidden-pool:empty')).toContain('display: none;');
    expect(
      rule('.review-shell__cluster.live-review__cluster:has(.hidden-pool:not(:empty)) {'),
    ).toContain('--phone-room-extra: var(--phone-room-pool, 96px);');
  });

  it('keeps the full playing budget with post-game actions in an overlay', () => {
    const budget = rule('.review-shell__cluster.live-review__cluster {\n    --phone-room-band');
    expect(budget).not.toContain('--phone-room-post');
    expect(phone).not.toMatch(/--phone-room-post: (48|96)px/);
    expect(rule('.live-review__cluster .postgame-sheet {')).toContain('position: fixed;');
    expect(rule('.live-review__cluster .room-actions[data-postgame-sheet] {')).toContain(
      'display: contents;',
    );
    expect(rule('.live-review__cluster .move-nav-bar {\n    order: 47;')).toContain(
      'min-width: 60%;',
    );
  });

  it('drops the blank jieqi odds lines once the game is over', () => {
    const odds = readFileSync(resolve(__dirname, 'live-jieqi-reveal-odds.css'), 'utf-8');
    const phoneOdds = odds.slice(odds.indexOf('@media (max-width: 600px)'));
    const at = phoneOdds.indexOf(
      '.review-shell__cluster.live-review__cluster .game-console > .reveal-odds-row[data-over] {',
    );
    expect(at).toBeGreaterThan(0);
    expect(phoneOdds.slice(at, phoneOdds.indexOf('}', at))).toContain('display: none;');
  });

  // Found by Brian on the phone (2026-10-17): the stage snaps down to 8px
  // steps, so the board came out 3-6px short and the bar sat at a different
  // height per variant. The board's block keeps the unsnapped height.
  it('gives the board block its unsnapped height, so every bar ends on the same line', () => {
    expect(
      rule('.live-review__cluster > .review-shell__center {\n    flex-basis: 100%;'),
    ).toContain('height: calc(var(--phone-room-board-h) + var(--uni-board-chrome-h, 0px));');
  });

  it('runs the time bar the full width of the seat line', () => {
    expect(
      rule('.live-review__cluster .clocks.clock-slot div.clock-time-row.has-bar::after'),
    ).toContain('width: 100vw;');
    expect(rule('.live-review__cluster [data-clock-top] div.clock-time-row.has-bar {')).toContain(
      'border-bottom: 3px solid transparent;',
    );
    expect(
      rule('.live-review__cluster [data-clock-bottom] div.clock-time-row.has-bar {'),
    ).toContain('border-top: 3px solid transparent;');
  });

  it('lets a long name give way before the captured pieces', () => {
    const seat = rule(
      '.live-review__cluster .round-table__player--top,\n  .live-review__cluster .round-table__player--bottom {\n    display: flex;',
    );
    expect(seat).toContain('flex-shrink: 10;');
    expect(rule('.live-review__cluster .clock-to-move')).toContain('display: none;');
  });

  it('centres the face-down pool in the room a width-bound board leaves', () => {
    expect(
      rule('.review-shell__cluster.live-review__cluster .hidden-pool:not(:empty) {'),
    ).toContain('margin-top: calc(var(--phone-room-slack) / 2);');
    expect(
      rule(
        '.review-shell__cluster.live-review__cluster:has(.hidden-pool:not(:empty)) .game-table-moves',
      ),
    ).toContain('margin-top: calc(var(--phone-room-slack) / 2);');
  });

  it('lets a drop variant name fill its seat line up to the clock', () => {
    const seat = rule(
      '.review-shell__cluster.live-review__cluster:has(.drop-pocket)\n  :is(.round-table__player--top, .round-table__player--bottom) {',
    );
    expect(seat).toContain('flex-grow: 1;');
    expect(seat).toContain('max-width: none;');
  });

  // Brian, 2026-10-17: banqi's odds take jieqi's one line per side, the
  // viewer's ink first, so the pool gives the board 40px back.
  it('gives banqi odds one 40px line per side, the viewer first', () => {
    expect(
      rule(
        '.live-route--banqi .review-shell__cluster.live-review__cluster:has(.hidden-pool--odds) {\n    --phone-room-pool',
      ),
    ).toContain('--phone-room-pool: 80px;');
    expect(rule('.live-review__cluster .hidden-pool--odds .hidden-pool__row {')).toContain(
      'height: 40px;',
    );
    expect(
      rule('.live-review__cluster .hidden-pool--odds .hidden-pool__row:last-of-type'),
    ).toContain('order: -1;');
    expect(rule('.live-review__cluster .hidden-pool--odds .hidden-pool__caption')).toContain(
      'clip-path: inset(50%);',
    );
  });
});
