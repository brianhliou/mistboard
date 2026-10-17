import { afterEach, describe, expect, it } from 'vitest';
import type { CtaBlock } from './articles/types.js';
import { renderBlock } from './articles.js';
import { setResolvedVariantGrants } from './signed-in-state.js';
import { variantPublicSurfaceEnabled } from './variant-public-surfaces.js';

// The Xiangqi Mahjong rules page's own CTA block. Its Play buttons open the play
// dialog on a playtest variant; for a visitor without a grant the dialog has no
// such variant and silently set up xiangqi instead (2026-10-16).
const XMJ_CTA: CtaBlock = {
  kind: 'cta',
  buttons: [
    {
      label: 'Play vs computer',
      href: '/?play=computer&gameSpecId=xiangqi-mahjong',
      emphasis: 'primary',
    },
    {
      label: 'Challenge a friend',
      href: '/?play=friend&gameSpecId=xiangqi-mahjong',
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
    expect(variantPublicSurfaceEnabled('xiangqi-mahjong')).toBe(false);
  });

  it('shows a visitor without a grant a note, not buttons into a xiangqi setup', () => {
    setResolvedVariantGrants([]);
    const row = renderBlock(XMJ_CTA);
    expect(links(row)).toEqual([]);
    const note = row.querySelector('.article-cta-playtest-note');
    expect(note?.textContent).toContain('in testing');
    expect(note?.querySelector('a')?.getAttribute('href')).toBe('/forum/feedback');
  });

  it('keeps the buttons for a granted account', () => {
    setResolvedVariantGrants(['xiangqi-mahjong']);
    const row = renderBlock(XMJ_CTA);
    expect(links(row)).toEqual(XMJ_CTA.buttons.map((b) => b.href));
    expect(row.querySelector('.article-cta-playtest-note')).toBeNull();
  });

  it('redraws with the buttons once a grant made since the last visit resolves', () => {
    const row = renderBlock(XMJ_CTA);
    document.body.append(row);
    expect(links(row)).toEqual([]);
    setResolvedVariantGrants(['xiangqi-mahjong']);
    const redrawn = document.body.querySelector('.article-cta-row') as HTMLElement;
    expect(links(redrawn)).toEqual(XMJ_CTA.buttons.map((b) => b.href));
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
