import { describe, expect, it } from 'vitest';
import type { Article } from './articles/types.js';
import { articles } from './articles-data.js';

// #1149 is a six-page migration, not a new requirement for every older rule page.
const NORMALIZED_RULES = [
  'atomic-xiangqi',
  'banqi',
  'chess',
  'gomoku',
  'shogi4',
  'three-kingdoms-banqi',
] as const;

// Every article published from 2026-10-10 on opens with an "In short" block
// (the `tldr` field): a few plain findings above the first section. The
// cutoff keeps older articles out of it; drafts are checked when they publish.
const TLDR_FROM = '2026-10-10';

function missingTldr(list: readonly Article[]): string[] {
  return list
    .filter(
      (a) =>
        a.kind === 'article' &&
        a.status === 'published' &&
        (a.publishedAt ?? '') >= TLDR_FROM &&
        !(a.tldr ?? []).some((line) => line.trim().length > 0),
    )
    .map((a) => a.slug);
}

describe('article In short (tldr)', () => {
  it(`every article published on or after ${TLDR_FROM} has one`, () => {
    expect(missingTldr(articles)).toEqual([]);
  });

  it('catches a published article without one, and leaves drafts and older ones alone', () => {
    const base = articles.find((a) => a.kind === 'article')!;
    const fixture: Article[] = [
      {
        ...base,
        slug: 'new-no-tldr',
        status: 'published',
        publishedAt: TLDR_FROM,
        tldr: undefined,
      },
      { ...base, slug: 'new-blank-tldr', status: 'published', publishedAt: TLDR_FROM, tldr: [' '] },
      {
        ...base,
        slug: 'new-with-tldr',
        status: 'published',
        publishedAt: TLDR_FROM,
        tldr: ['A finding.'],
      },
      {
        ...base,
        slug: 'old-no-tldr',
        status: 'published',
        publishedAt: '2026-10-09',
        tldr: undefined,
      },
      { ...base, slug: 'draft-no-tldr', status: 'draft', publishedAt: TLDR_FROM, tldr: undefined },
    ];
    expect(missingTldr(fixture)).toEqual(['new-no-tldr', 'new-blank-tldr']);
  });
});

describe('normalized rules summaries and closings (#1149)', () => {
  const bySlug = (slug: string) => articles.find((a) => a.slug === slug)!;

  it.each(NORMALIZED_RULES)('%s opens with two to four rule-based summary lines', (slug) => {
    const lines = bySlug(slug).tldr ?? [];
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines.length).toBeLessThanOrEqual(4);
    for (const line of lines) {
      expect(line.trim()).not.toBe('');
      expect(line).not.toMatch(/Mistboard|play (?:now|online)|no account/i);
    }
  });

  const destinations = {
    'atomic-xiangqi': ['/study/dPKhvJKb'],
    banqi: ['/?play=computer&gameSpecId=banqi', '/?play=friend&gameSpecId=banqi'],
    chess: ['/rules/fog-chess', '/rules'],
    gomoku: ['/?play=computer&gameSpecId=gomoku', '/?play=friend&gameSpecId=gomoku'],
    shogi4: ['/rules', '/rules/chess', '/rules/xiangqi'],
    'three-kingdoms-banqi': [
      '/?play=friend&gameSpecId=three-kingdoms-banqi',
      '/?play=computer&gameSpecId=three-kingdoms-banqi',
    ],
  };

  it.each(NORMALIZED_RULES)('%s preserves the closing destinations and primary action', (slug) => {
    const closing = bySlug(slug).sections.at(-1)!;
    const blocks = closing.blocks ?? [];
    const cta = blocks.at(-1);
    expect(cta?.kind).toBe('cta');
    if (cta?.kind !== 'cta') throw new Error(`${slug} must end with buttons`);
    expect(cta.buttons.map((button) => button.href)).toEqual(destinations[slug]);
    expect(cta.buttons.map((button) => button.emphasis)).toEqual([
      'primary',
      ...cta.buttons.slice(1).map(() => 'secondary'),
    ]);
    expect(blocks.slice(0, -1).map((block) => block.kind)).toEqual(
      slug === 'gomoku' || slug === 'three-kingdoms-banqi' ? [] : ['paragraph'],
    );
  });

  it('keeps the unavailable and retired games reference-only', () => {
    expect(bySlug('atomic-xiangqi').playableOnMistboard).toBe(false);
    for (const slug of ['chess', 'shogi4']) expect(bySlug(slug).showInIndex).toBe(false);
    expect(JSON.stringify(bySlug('atomic-xiangqi').sections.at(-1))).toContain('no longer open');
    expect(JSON.stringify(bySlug('shogi4').sections.at(-1))).toContain("isn't playable");
  });
});
