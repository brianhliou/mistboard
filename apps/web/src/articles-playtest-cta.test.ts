import { afterEach, describe, expect, it } from 'vitest';
import type { CtaBlock } from './articles/types.js';
import { renderBlock } from './articles.js';
import { setResolvedVariantGrants } from './signed-in-state.js';
import {
  articleIsNoindex,
  rulesHrefForGameSpec,
  variantPublicSurfaceEnabled,
} from './variant-public-surfaces.js';

// HK mahjong remains a playtest after XMJ launches. A visitor without its
// grant must not get buttons into a dialog that cannot offer that variant.
const PLAYTEST_CTA: CtaBlock = {
  kind: 'cta',
  buttons: [
    {
      label: 'Play vs computer',
      href: '/?play=computer&gameSpecId=mahjong',
      emphasis: 'primary',
    },
    {
      label: 'Challenge a friend',
      href: '/?play=friend&gameSpecId=mahjong',
      emphasis: 'secondary',
    },
  ],
};

function links(row: HTMLElement): string[] {
  return [...row.querySelectorAll('a.article-cta')].map((a) => a.getAttribute('href') ?? '');
}

describe('play CTAs for a playtest variant', () => {
  afterEach(() => {
    setResolvedVariantGrants(undefined);
    document.body.replaceChildren();
  });

  it('is a playtest variant while this holds', () => {
    expect(variantPublicSurfaceEnabled('mahjong')).toBe(false);
  });

  it('shows a visitor without a grant a note, not buttons into a xiangqi setup', () => {
    setResolvedVariantGrants([]);
    const row = renderBlock(PLAYTEST_CTA);
    expect(links(row)).toEqual([]);
    const note = row.querySelector('.article-cta-playtest-note');
    expect(note?.textContent).toContain('in testing');
    expect(note?.querySelector('a')?.getAttribute('href')).toBe('/forum/feedback');
  });

  it('keeps the buttons for a granted account', () => {
    setResolvedVariantGrants(['mahjong']);
    const row = renderBlock(PLAYTEST_CTA);
    expect(links(row)).toEqual(PLAYTEST_CTA.buttons.map((b) => b.href));
    expect(row.querySelector('.article-cta-playtest-note')).toBeNull();
  });

  it('redraws with the buttons once a grant made since the last visit resolves', () => {
    const row = renderBlock(PLAYTEST_CTA);
    document.body.append(row);
    expect(links(row)).toEqual([]);
    setResolvedVariantGrants(['mahjong']);
    const redrawn = document.body.querySelector('.article-cta-row') as HTMLElement;
    expect(links(redrawn)).toEqual(PLAYTEST_CTA.buttons.map((b) => b.href));
  });

  it('offers launched XMJ play buttons without a grant', () => {
    expect(variantPublicSurfaceEnabled('xiangqi-mahjong')).toBe(true);
    expect(articleIsNoindex({ kind: 'rules', slug: 'xiangqi-mahjong-32' })).toBe(false);
    expect(rulesHrefForGameSpec('xiangqi-mahjong')).toBe('/rules/xiangqi-mahjong-32');
    setResolvedVariantGrants([]);
    const cta: CtaBlock = {
      ...PLAYTEST_CTA,
      buttons: PLAYTEST_CTA.buttons.map((button) => ({
        ...button,
        href: button.href.replace('gameSpecId=mahjong', 'gameSpecId=xiangqi-mahjong'),
      })),
    };
    const row = renderBlock(cta);
    expect(links(row)).toEqual(cta.buttons.map((button) => button.href));
    expect(row.querySelector('.article-cta-playtest-note')).toBeNull();
  });

  it('leaves a public variant and plain links alone', () => {
    setResolvedVariantGrants([]);
    const row = renderBlock({
      kind: 'cta',
      buttons: [
        { label: 'Play', href: '/?play=computer&gameSpecId=xiangqi', emphasis: 'primary' },
        { label: 'All rules', href: '/rules', emphasis: 'secondary' },
      ],
    });
    expect(links(row)).toEqual(['/?play=computer&gameSpecId=xiangqi', '/rules']);
    expect(row.querySelector('.article-cta-playtest-note')).toBeNull();
  });
});
