import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Two side columns pin with `position: sticky`, and both jarred when the
// numbers they are pinned with drifted from the layout around them. The
// stylesheets are not applied in this environment, so this pins the CSS text
// and adds the numbers up, as banqi-rail-material-css.test.ts does.
function readCss(name: string): string {
  const path = [`src/${name}`, `apps/web/src/${name}`]
    .map((candidate) => resolve(process.cwd(), candidate))
    .find((candidate) => existsSync(candidate));
  return readFileSync(path as string, 'utf8');
}

/** The declarations of the first rule whose selector is exactly `selector`. */
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|[}\\n])\\s*${escaped}\\s*\\{([^}]*)\\}`));
  if (!match?.[1]) throw new Error(`no rule for ${selector}`);
  return match[1];
}

function px(body: string, property: string): number {
  const match = body.match(new RegExp(`(?:^|[;\\s])${property}:\\s*(-?\\d+)px`));
  if (!match?.[1]) throw new Error(`no ${property} in px`);
  return Number(match[1]);
}

/** The first length of a `padding` shorthand: its top. */
function paddingTop(body: string): number {
  const match = body.match(/(?:^|[;\s])padding:\s*(\d+)px/);
  if (!match?.[1]) throw new Error('no padding');
  return Number(match[1]);
}

function borderBottomWidth(body: string): number {
  const match = body.match(/border-bottom:\s*(\d+)px/);
  if (!match?.[1]) throw new Error('no border-bottom');
  return Number(match[1]);
}

/**
 * Where the rules rail sits before any scroll: under the sticky nav (its
 * min-height plus its hairline) and .site-section's top padding.
 */
function rulesRailNaturalTop(siteShellCss: string, appBaseCss: string): number {
  const nav = ruleBody(siteShellCss, '.site-nav');
  return (
    px(nav, 'min-height') +
    borderBottomWidth(nav) +
    paddingTop(ruleBody(appBaseCss, '.site-section'))
  );
}

function rulesRailStickyTop(articlesCss: string): number {
  const match = articlesCss.match(
    /\.article-toc-sidebar,\s*\.article-variant-sidebar\s*\{[^}]*position:\s*sticky;[^}]*?top:\s*(\d+)px/,
  );
  if (!match?.[1]) throw new Error('no sticky top on the rules rails');
  return Number(match[1]);
}

describe('rules page rails', () => {
  // A sticky top below the rail's natural offset lets both rails ride up with
  // the page for the first few pixels and then stop: a bob at the top of every
  // rules page and article (98px against a natural 101px once the nav grew).
  it('pin at exactly their natural offset, so they never travel', () => {
    const natural = rulesRailNaturalTop(readCss('site-shell.css'), readCss('app-base.css'));
    expect(rulesRailStickyTop(readCss('articles.css'))).toBe(natural);
  });

  it('catches a planted offset that misses the nav by three pixels', () => {
    const planted = readCss('articles.css').replace(/top: 101px;/, 'top: 98px;');
    const natural = rulesRailNaturalTop(readCss('site-shell.css'), readCss('app-base.css'));
    expect(rulesRailStickyTop(planted)).not.toBe(natural);
  });
});

describe('broadcast event page left column', () => {
  const css = readCss('xiangqi-broadcast.css');

  // The pinned column's grid area is the layout's; anything on the page
  // after the layout lets the layout end above the page's foot, and the
  // column is pushed up by that much at the bottom of the page.
  it('spans the rights note row, so its grid area runs to the foot of the page', () => {
    const layout = ruleBody(css, '.xqb-event-layout-with-rail');
    expect(layout).toMatch(/grid-template-areas:\s*"rail content"\s*"rail foot"/);
    expect(layout).toMatch(/grid-template-rows:\s*auto 1fr/);
    expect(ruleBody(css, '.xqb-event-layout-with-rail > .xqb-rights-note')).toMatch(
      /grid-area:\s*foot/,
    );
  });

  it('ends at least a pixel inside the page bottom padding', () => {
    const shellBottom = Number(
      ruleBody(css, '.xqb-shell').match(/padding:\s*\d+px\s+\d+px\s+(\d+)px/)?.[1],
    );
    const side = ruleBody(css, '.xqb-event-layout-with-rail .xqb-event-side');
    expect(side).toMatch(/position:\s*sticky/);
    const subtracted = Number(
      side.match(/height:\s*calc\(100vh - var\(--xqb-side-top, 12px\) - (\d+)px\)/)?.[1],
    );
    expect(subtracted).toBe(shellBottom + 1);
  });

  it('keeps the phone order: boards, then the list and chat, then the note', () => {
    expect(css).toMatch(
      /@media \(max-width: 900px\) \{\s*\.xqb-event-layout-with-rail \{[^}]*grid-template-areas:\s*"content" "rail" "foot"/,
    );
  });
});
