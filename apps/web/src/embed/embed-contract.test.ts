import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EMBED_DEFAULT_HEIGHT, EMBED_DEFAULT_WIDTH } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { embedNotationFromSearch, embedThemeFromSearch } from './embed-route.js';

// The default size is not a taste question, it is a claim about a layout that
// lives in a stylesheet, and the two drifted apart: the replay stacks its move
// list under the board at max-width 720px, and the default width was exactly
// 720. Every consumer taking the default got the narrow layout inside a box
// proportioned for the wide one, which is where the second scrollbar came from.
//
// So the test reads the breakpoint out of the CSS instead of restating it. Move
// the breakpoint and this fails until the default moves with it.
const cssPath = ['src/articles.css', 'apps/web/src/articles.css']
  .map((candidate) => resolve(process.cwd(), candidate))
  .find((candidate) => existsSync(candidate));
const css = readFileSync(cssPath as string, 'utf8');

function stackingBreakpoint(): number {
  // The narrow rule that drops the move column under the board.
  const marker = css.indexOf('.xq-replay-annotated .xq-replay-move-col');
  const media = css.lastIndexOf('@media (max-width:', marker);
  expect(media, 'no narrow media query governs the move column').toBeGreaterThan(-1);
  const px = /@media \(max-width:\s*(\d+)px\)/.exec(css.slice(media, media + 60));
  expect(px, 'could not read the breakpoint').not.toBeNull();
  return Number(px?.[1]);
}

describe('the embed default size', () => {
  it('clears the layout breakpoint it is measured against', () => {
    const breakpoint = stackingBreakpoint();
    expect(
      EMBED_DEFAULT_WIDTH,
      `default width ${EMBED_DEFAULT_WIDTH} is inside the narrow layout (<= ${breakpoint})`,
    ).toBeGreaterThan(breakpoint);
  });

  it('is proportioned like the widget it frames', () => {
    // Natural height ran ~0.88x width across 721-1000px, measured in a browser
    // against the deployed embed. A default far off that ratio is a frame the
    // content cannot sit in, whichever way the error goes.
    const ratio = EMBED_DEFAULT_HEIGHT / EMBED_DEFAULT_WIDTH;
    expect(ratio).toBeGreaterThan(0.8);
    expect(ratio).toBeLessThan(1.05);
  });
});

// The puzzle embed's two columns are sized against the FRAME, and both halves
// of that are load-bearing in a way nothing else checks. The sidebar column was
// floored at a flat 160px while .puzzle-actions (four 48px buttons plus a
// clamped gap) needs 222-264px, and because .puzzle-side-panel hides its
// overflow the shortfall produced no scrollbar and no error -- just a move list
// reading "d10-e" and a "NEXT PUZZL" button, on any host that framed the widget
// tall and narrow. Both regressions below are silent at runtime, so they are
// asserted here rather than left to a screenshot nobody takes.
const embedCssPath = ['src/embed/embed.css', 'apps/web/src/embed/embed.css']
  .map((candidate) => resolve(process.cwd(), candidate))
  .find((candidate) => existsSync(candidate));
// Comments are stripped first: these rules are DOCUMENTED in comments that
// quote the very tokens being matched ("the old @media rule"), so a scan over
// the raw text matches the prose instead of the declaration.
const embedCss = readFileSync(embedCssPath as string, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

describe('the puzzle embed grid', () => {
  it('splits its columns the way the study card does, with the sheet floored at 226px', () => {
    // Beside a study replay in an article the two cards must show the same
    // board width and the same sheet width, so the split is the study card's
    // (articles.css .xq-replay-annotated .xq-replay-grid), not a board track
    // sized from the frame's height with the sheet taking what is left.
    const grid = /\.embed-puzzle\s*\{[\s\S]*?grid-template-columns:([\s\S]*?);/.exec(embedCss);
    expect(grid, 'no grid-template-columns on .embed-puzzle').not.toBeNull();
    expect((grid?.[1] ?? '').replace(/\s+/g, ' ').trim()).toBe(
      'minmax(0, 2.85fr) minmax(226px, 1fr)',
    );
  });

  it('keeps the stepper row fluid so a fixed sheet width cannot clip it', () => {
    // The sheet used to be floored at its own min-content because the trainer's
    // .puzzle-actions is four 48px buttons plus a clamped gap (222-264px), and a
    // narrower track clipped the row with no scrollbar and no other symptom.
    // With a 226px floor the row has to give instead: four fluid tracks, no gap.
    const actions = /\.embed-puzzle \.puzzle-actions\s*\{([\s\S]*?)\}/.exec(embedCss);
    expect(actions, 'no .embed-puzzle .puzzle-actions rule').not.toBeNull();
    expect(actions?.[1]).toContain('grid-template-columns: repeat(4, 1fr)');
    expect(actions?.[1]).toContain('gap: 0');
  });

  it('stacks on the frame width, not on the reader viewport', () => {
    // Inside an iframe a viewport query happens to measure the frame, which is
    // why the old @media rule worked. It stops being true the moment the widget
    // is mounted in a sized element, and then the narrow layout never fires.
    const narrow =
      /@(media|container)([^{]*)\{\s*\.embed-puzzle\s*\{\s*grid-template-columns:\s*1fr/.exec(
        embedCss,
      );
    expect(narrow, 'no narrow rule drops .embed-puzzle to one column').not.toBeNull();
    expect(narrow?.[1], 'the narrow puzzle layout is still a viewport query').toBe('container');
    expect(narrow?.[2], 'the narrow rule does not name the embed frame container').toContain(
      'embed-frame',
    );
  });

  it('declares the container the narrow rule queries', () => {
    // An @container rule whose container does not exist never matches, and the
    // layout silently reverts to one column at every width.
    const frame =
      /\.embed-frame\s*\{[\s\S]*?container-type:\s*inline-size;[\s\S]*?container-name:\s*embed-frame;/.exec(
        embedCss,
      );
    expect(frame, '.embed-frame does not declare the named inline-size container').not.toBeNull();
  });
});

describe('the stacked puzzle embed', () => {
  // Stacking is correct for a narrow box and wrong for a narrow FRAME unless the
  // board is re-budgeted: the panel moves from beside the board to under it, and
  // at the two-column budget the pair came to ~1046px inside a 720px frame.
  // body.embed-body hides the overflow on purpose, so that excess is not
  // scrolled past, it is unreachable -- a wheel event moved scrollTop by 0, and
  // a post-solve focus scroll then parked the board's top edge at -294px with no
  // way back. Both halves are asserted because either alone leaves it broken.
  function stackedBlock(): string {
    const at = embedCss.indexOf('@container embed-frame');
    expect(at, 'no stacked @container block').toBeGreaterThan(-1);
    let depth = 0;
    for (let i = embedCss.indexOf('{', at); i < embedCss.length; i += 1) {
      if (embedCss[i] === '{') depth += 1;
      if (embedCss[i] === '}') {
        depth -= 1;
        if (depth === 0) return embedCss.slice(at, i + 1);
      }
    }
    throw new Error('unterminated @container block');
  }

  it('re-budgets the board against the height the panel also needs', () => {
    expect(stackedBlock(), 'the stacked board still takes the two-column height budget').toContain(
      '--puzzle-surface-fit',
    );
  });

  it('bounds the panel to its track instead of its content', () => {
    // .embed-puzzle sets align-items:start, so a height:auto panel takes its
    // content height and overflows the row it was given.
    expect(stackedBlock()).toContain('align-self: stretch');
  });
});

describe('embedThemeFromSearch', () => {
  // An embed inherits the READER's OS theme by default, which is wrong for a
  // host page that has only one theme: a light-only blog framing this showed a
  // dark board to every dark-mode reader, and nothing on the embedder's side can
  // fix it (prefers-color-scheme inside the frame is the browser's, and
  // color-scheme on the <iframe> does not reach the framed document).
  it('reads a pinned theme off the query string', () => {
    expect(embedThemeFromSearch('?theme=light')).toBe('light');
    expect(embedThemeFromSearch('?theme=dark')).toBe('dark');
    expect(embedThemeFromSearch('?ply=12&theme=light')).toBe('light');
  });

  it('follows the reader when the embedder says nothing, or says nonsense', () => {
    expect(embedThemeFromSearch('')).toBeNull();
    expect(embedThemeFromSearch('?ply=12')).toBeNull();
    expect(embedThemeFromSearch('?theme=')).toBeNull();
    expect(embedThemeFromSearch('?theme=系统')).toBeNull();
    // 'system' is the default already; naming it must not pin anything, or the
    // OS-change listener would stop updating a document that asked to follow.
    expect(embedThemeFromSearch('?theme=system')).toBeNull();
  });
});

describe('embedNotationFromSearch', () => {
  // Same problem as theme, one layer down: an embed's reader is on the
  // embedder's page and has no stored Mistboard preference, so every embed
  // renders the site's coordinate default. Fine for a visitor, wrong for an
  // endgame article, where the manuals are written in WXF and Chinese.
  it('reads a pinned notation off the query string', () => {
    expect(embedNotationFromSearch('?notation=wxf')).toBe('wxf');
    expect(embedNotationFromSearch('?notation=chinese')).toBe('chinese');
    expect(embedNotationFromSearch('?notation=iccs')).toBe('iccs');
    expect(embedNotationFromSearch('?notation=coordinate')).toBe('coordinate');
    expect(embedNotationFromSearch('?theme=light&notation=wxf')).toBe('wxf');
  });

  it('follows the reader when the embedder says nothing, or says nonsense', () => {
    expect(embedNotationFromSearch('')).toBeNull();
    expect(embedNotationFromSearch('?theme=light')).toBeNull();
    expect(embedNotationFromSearch('?notation=')).toBeNull();
    expect(embedNotationFromSearch('?notation=WXF')).toBeNull();
    expect(embedNotationFromSearch('?notation=中文')).toBeNull();
  });
});
