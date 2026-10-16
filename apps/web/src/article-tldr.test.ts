import { describe, expect, it } from 'vitest';
import type { Article } from './articles/types.js';
import { articles } from './articles-data.js';

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
