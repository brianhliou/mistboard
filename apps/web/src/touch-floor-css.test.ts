// Coarse-pointer touch floor (mobile pass #576): on a touch screen every tap
// target on the swept surfaces is at least 40px and every form field's text is
// at least 16px (iOS Safari zooms the page on focus below that). The rules
// live under `@media (pointer: coarse)` so a mouse-driven desktop does not
// move; these tests read the stylesheets and pin both halves.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type Rule = { media: string | null; selector: string; decls: Map<string, string> };

const COARSE = '(pointer: coarse)';
const TAP_MIN = 40;
const INPUT_FONT_MIN = 16;

// Flat rule list for one stylesheet: top-level rules plus one level of @media.
function parse(file: string): Rule[] {
  const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: Rule[] = [];
  const walk = (text: string, media: string | null): void => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf('{', i);
      if (open < 0) return;
      const head = text.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      while (depth > 0 && j < text.length) {
        if (text[j] === '{') depth += 1;
        else if (text[j] === '}') depth -= 1;
        j += 1;
      }
      const body = text.slice(open + 1, j - 1);
      if (head.startsWith('@media')) walk(body, head.slice('@media'.length).trim());
      else if (!head.startsWith('@')) {
        const decls = new Map<string, string>();
        for (const part of body.split(';')) {
          const colon = part.indexOf(':');
          if (colon > 0) decls.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim());
        }
        for (const selector of head.split(',')) {
          rules.push({ media, selector: selector.replace(/\s+/g, ' ').trim(), decls });
        }
      }
      i = j;
    }
  };
  walk(css, null);
  return rules;
}

function decl(rules: Rule[], selector: string, prop: string, media: string | null): string {
  const hits = rules.filter(
    (r) => r.selector === selector && r.media === media && r.decls.has(prop),
  );
  expect(hits.length, `${selector} { ${prop} } under ${media ?? 'no media'}`).toBeGreaterThan(0);
  return hits[hits.length - 1]?.decls.get(prop) ?? '';
}

const px = (value: string): number => Number.parseFloat(value);

const SIZED: { file: string; selector: string; prop: 'min-height' | 'height' }[] = [
  // Room move tables: tenant rooms, then the chess shell's cells.
  {
    file: 'src/game-shell.css',
    selector: '.round-table__box .move-list button.move-jump',
    prop: 'min-height',
  },
  { file: 'src/styles.css', selector: '.move-list button', prop: 'height' },
  { file: 'src/styles.css', selector: '.move-empty', prop: 'height' },
  // Home play panel (#573 owns the row design; these are sizes only).
  { file: 'src/landing-play-panel.css', selector: '.pp-act', prop: 'height' },
  { file: 'src/landing-play-panel.css', selector: '.pp-tab', prop: 'min-height' },
  { file: 'src/landing-chat.css', selector: '.landing-chat-input', prop: 'min-height' },
  // Broadcast.
  {
    file: 'src/review/analysis-summary.css',
    selector: '.analysis-summary__stat',
    prop: 'min-height',
  },
  {
    file: 'src/review/analysis-summary.css',
    selector: '.analysis-summary__learn',
    prop: 'min-height',
  },
  { file: 'src/xiangqi-broadcast.css', selector: '.xqb-round-select', prop: 'height' },
  { file: 'src/xiangqi-broadcast.css', selector: '.xqb-pager-button', prop: 'height' },
  { file: 'src/xiangqi-broadcast.css', selector: '.xqb-tab', prop: 'min-height' },
  // Feed.
  { file: 'src/news-page.css', selector: '.news-page-months-link', prop: 'min-height' },
  { file: 'src/static-page-shell.css', selector: '.static-page-rail-link', prop: 'min-height' },
  // Games search.
  {
    file: 'src/historical-xiangqi-search.css',
    selector: '.historical-xiangqi-floor-clear',
    prop: 'min-height',
  },
  // Bot page Play and the profile relation buttons (#620).
  {
    file: 'src/account-profile.css',
    selector: '.profile-relation-actions .landing-setup-start',
    prop: 'min-height',
  },
  {
    file: 'src/account-profile.css',
    selector: '.profile-relation-actions .landing-setup-back',
    prop: 'min-height',
  },
  // Article game embeds (#620).
  {
    file: 'src/embed/embed.css',
    selector: '.embed-card-moves .review-move-list__move',
    prop: 'min-height',
  },
  { file: 'src/embed/embed.css', selector: '.embed-card-control', prop: 'min-height' },
];

describe('coarse-pointer touch floor', () => {
  it.each(SIZED)('$selector is at least 40px on touch', ({ file, selector, prop }) => {
    expect(px(decl(parse(file), selector, prop, COARSE))).toBeGreaterThanOrEqual(TAP_MIN);
  });

  it('pads the account fair-play disclosure to a 40px target', () => {
    const rules = parse('src/account-profile.css');
    const selector = '.account-auth-principles summary';
    // 13px text at line-height 1.4 is an 18px line.
    const line =
      px(decl(rules, selector, 'font-size', null)) * px(decl(rules, selector, 'line-height', null));
    const pad = px(decl(rules, selector, 'padding-block', COARSE));
    expect(Math.round(line + 2 * pad)).toBeGreaterThanOrEqual(TAP_MIN);
  });

  // A switch or stepper keeps its drawn size; a transparent border around the
  // padding box makes the target, and a negative margin returns the space.
  it.each([
    { file: 'src/review/engine/engine-panel.css', selector: '.engine-panel__switch' },
    { file: 'src/xiangqi-broadcast.css', selector: '.xqb-gauge-toggle input' },
    { file: 'src/landing-play-panel.css', selector: '.pp-step-btn' },
  ])('$selector grows its target, not its drawing or its row', ({ file, selector }) => {
    const rules = parse(file);
    const coarse = rules.filter((r) => r.selector === selector && r.media === COARSE);
    const get = (prop: string): string | undefined =>
      coarse.find((r) => r.decls.has(prop))?.decls.get(prop);
    expect(get('box-sizing')).toBe('content-box');
    expect(get('background-clip')).toBe('padding-box');
    const border = get('border') ?? `${get('border-width')} ${get('border-color')}`;
    expect(border).toContain('transparent');
    const [borderY = 0, borderX = borderY] = border.match(/\d+px/g)?.map(px) ?? [];
    const [marginY = 0, marginX = marginY] =
      get('margin')
        ?.match(/-?\d+px/g)
        ?.map(px) ?? [];
    expect(marginY).toBe(-borderY);
    expect(marginX).toBe(-borderX);
    const height = px(decl(rules, selector, 'height', null));
    // The narrowest width any viewport gives it (the play panel narrows its
    // stepper at 640px).
    const widths = rules
      .filter((r) => r.selector === selector && r.media !== COARSE && r.decls.has('width'))
      .map((r) => px(r.decls.get('width') ?? ''));
    expect(height + 2 * borderY).toBeGreaterThanOrEqual(TAP_MIN);
    expect(Math.min(...widths) + 2 * borderX).toBeGreaterThanOrEqual(TAP_MIN);
  });

  it('keeps the embed result rule level with the taller control bar', () => {
    const rules = parse('src/embed/embed.css');
    // The bar adds a 1px top rule; the result's min-height includes its own.
    for (const media of [null, COARSE]) {
      expect(px(decl(rules, '.embed-card-result', 'min-height', media))).toBe(
        px(decl(rules, '.embed-card-control', 'min-height', media)) + 1,
      );
    }
  });

  // Drawn controls whose size is set by their content (#620): the drawn box is
  // the audit's measurement, and the transparent border makes up the rest.
  it.each([
    {
      file: 'src/account-profile.css',
      selector: '.profile-chart-range',
      media: COARSE,
      drawn: { w: 28, h: 23 },
      marginX: 0,
    },
    {
      file: 'src/site-shell.css',
      selector: '.site-nav-quick-button',
      media: `${COARSE} and (max-width: 600px)`,
      drawn: { w: 38, h: 44 },
      marginX: -1,
    },
  ])(
    '$selector grows a 40px target around its drawn box',
    ({ file, selector, media, drawn, marginX: expectedMarginX }) => {
      const rules = parse(file);
      expect(decl(rules, selector, 'box-sizing', media)).toBe('content-box');
      expect(decl(rules, selector, 'background-clip', media)).toBe('padding-box');
      expect(decl(rules, selector, 'border-color', media)).toBe('transparent');
      const [borderY = 0, borderX = borderY] = decl(rules, selector, 'border-width', media)
        .split(/\s+/)
        .map(px);
      const [marginY = 0, marginX = marginY] = decl(rules, selector, 'margin', media)
        .split(/\s+/)
        .map(px);
      expect(marginY + borderY).toBe(0);
      expect(marginX).toBe(expectedMarginX);
      expect(drawn.w + 2 * borderX).toBeGreaterThanOrEqual(TAP_MIN);
      expect(drawn.h + 2 * borderY).toBeGreaterThanOrEqual(TAP_MIN);
    },
  );

  it('keeps adjacent chart range touch targets from overlapping', () => {
    const rules = parse('src/account-profile.css');
    const gap = px(decl(rules, '.profile-chart-ranges', 'gap', null));
    const [marginY = 0, marginX = marginY] = decl(rules, '.profile-chart-range', 'margin', COARSE)
      .split(/\s+/)
      .map(px);
    // Flex gap separates margin boxes; negative side margins consume it and
    // let a neighbour intercept the edge of an otherwise 40px-wide target.
    expect(gap + 2 * marginX).toBeGreaterThanOrEqual(0);
  });

  it('pads the logo-only brand to 40px and gives the width back', () => {
    const rules = parse('src/site-shell.css');
    const media = `${COARSE} and (max-width: 389px)`;
    const logo = px(decl(rules, '.site-nav-logo', 'width', '(max-width: 600px)'));
    const phonePad = px(decl(rules, '.site-nav-brand', 'padding-inline', '(max-width: 600px)'));
    const pad = px(decl(rules, '.site-nav-brand', 'padding-inline', media));
    const margin = px(decl(rules, '.site-nav-brand', 'margin-inline', media));
    expect(logo + 2 * pad).toBeGreaterThanOrEqual(TAP_MIN);
    expect(pad + margin).toBe(phonePad);
  });

  it.each([
    { file: 'src/xiangqi-broadcast.css', selector: '.xqb-round-select' },
    { file: 'src/historical-xiangqi-search.css', selector: '.historical-xiangqi-input' },
    { file: 'src/historical-xiangqi-search.css', selector: '.historical-xiangqi-select' },
    { file: 'src/landing-chat.css', selector: '.landing-chat-input' },
  ])('$selector text is 16px on touch so iOS does not zoom', ({ file, selector }) => {
    expect(px(decl(parse(file), selector, 'font-size', COARSE))).toBeGreaterThanOrEqual(
      INPUT_FONT_MIN,
    );
  });

  it('leaves the desktop sizes where they were', () => {
    expect(
      decl(parse('src/review/engine/engine-panel.css'), '.engine-panel__switch', 'height', null),
    ).toBe('24px');
    expect(decl(parse('src/landing-play-panel.css'), '.pp-step-btn', 'height', null)).toBe('24px');
    expect(decl(parse('src/landing-play-panel.css'), '.pp-act', 'height', null)).toBe('30px');
    expect(decl(parse('src/styles.css'), '.move-list button', 'height', null)).toBe('30px');
    expect(decl(parse('src/xiangqi-broadcast.css'), '.xqb-round-select', 'font-size', null)).toBe(
      '13px',
    );
    expect(
      decl(
        parse('src/historical-xiangqi-search.css'),
        '.historical-xiangqi-input',
        'font-size',
        null,
      ),
    ).toBe('0.88rem');
    const profile = parse('src/account-profile.css');
    expect(decl(profile, '.profile-chart-range', 'padding', null)).toBe('3px 6px');
    expect(
      decl(profile, '.profile-relation-actions .landing-setup-start', 'min-height', null),
    ).toBe('32px');
    const embed = parse('src/embed/embed.css');
    expect(decl(embed, '.embed-card-control', 'min-height', null)).toBe('38px');
    expect(decl(embed, '.embed-card-result', 'min-height', null)).toBe('39px');
    expect(
      decl(parse('src/site-shell.css'), '.site-nav-quick-button', 'width', '(max-width: 600px)'),
    ).toBe('38px');
  });
});
