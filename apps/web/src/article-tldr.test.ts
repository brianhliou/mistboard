import { describe, expect, it } from 'vitest';
import { playClosing, relatedClosing } from './articles/diagrams.js';
import type { Article } from './articles/types.js';
import { articles } from './articles-data.js';

// Keep #1149's destination pins alongside the contract for every published page.
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

// Xiangqi Mahjong keeps its existing hand-building introduction and ending.
// Drafts are checked when published; age, visibility and playability do not exempt rules.
function coveredRules(list: readonly Article[]): Article[] {
  return list.filter(
    (a) => a.kind === 'rules' && a.status === 'published' && a.slug !== 'xiangqi-mahjong-32',
  );
}

function rulesTemplateFailures(list: readonly Article[]) {
  return coveredRules(list).flatMap((article) => {
    const missing: string[] = [];
    const lines = article.tldr ?? [];
    if (lines.length < 2 || lines.length > 4 || lines.some((line) => !line.trim())) {
      missing.push('summary');
    }
    // Both shared helpers produce an optional lead and a final button row.
    // Reference pages keep relatedClosing; a play link is not required.
    const closing = article.sections.at(-1);
    const blocks = closing?.blocks ?? [];
    const cta = blocks.at(-1);
    if (
      !closing?.heading.trim() ||
      blocks.length < 1 ||
      blocks.length > 2 ||
      blocks.slice(0, -1).some((block) => block.kind !== 'paragraph' || !block.text.trim()) ||
      cta?.kind !== 'cta' ||
      cta.buttons.length === 0 ||
      cta.buttons.some(
        (button, index) =>
          !button.label.trim() ||
          !button.href.trim() ||
          button.emphasis !== (index === 0 ? 'primary' : 'secondary'),
      )
    ) {
      missing.push('closing');
    }
    return missing.length ? [{ slug: article.slug, missing }] : [];
  });
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

describe('published rules summaries and final closings', () => {
  it('every published rules page follows the template, apart from Xiangqi Mahjong', () => {
    expect(rulesTemplateFailures(articles)).toEqual([]);
  });

  it.each(coveredRules(articles))('$slug keeps its summary about the rules', (article) => {
    for (const line of article.tldr ?? []) {
      expect(line).not.toMatch(/Mistboard|play (?:now|online)|no account/i);
    }
  });

  it('catches a planted rules page missing both requirements and isolates each failure', () => {
    const base = articles.find((a) => a.slug === 'banqi')!;
    const broken: Article = { ...base, slug: 'rules-missing-both', tldr: undefined, sections: [] };
    const play = playClosing({ heading: 'Play', playLabel: 'Play', playHref: '/?play=friend' });
    const related = relatedClosing({
      heading: 'Related rules',
      lead: 'Read another rules page.',
      links: [{ label: 'Rules', href: '/rules', emphasis: 'primary' }],
    });
    const valid: Article = {
      ...broken,
      tldr: ['A turn rule.', 'A winning rule.'],
      sections: [play],
    };
    expect(
      rulesTemplateFailures([
        broken,
        { ...valid, slug: 'rules-blank-line', tldr: ['A turn rule.', ' '] },
        { ...valid, slug: 'rules-no-closing', sections: [] },
        {
          ...valid,
          slug: 'rules-prose-after-buttons',
          sections: [
            {
              ...play,
              blocks: [...play.blocks!, { kind: 'paragraph', text: 'After the buttons.' }],
            },
          ],
        },
        { ...valid, slug: 'rules-with-play-closing' },
        { ...valid, slug: 'rules-with-related-closing', sections: [related] },
        { ...broken, slug: 'draft-rules', status: 'draft' },
        { ...broken, slug: 'outline-rules', status: 'outline' },
        { ...broken, slug: 'old-article', kind: 'article', publisher: 'mistboard' },
        { ...broken, slug: 'xiangqi-mahjong-32' },
      ]),
    ).toEqual([
      { slug: 'rules-missing-both', missing: ['summary', 'closing'] },
      { slug: 'rules-blank-line', missing: ['summary'] },
      { slug: 'rules-no-closing', missing: ['closing'] },
      { slug: 'rules-prose-after-buttons', missing: ['closing'] },
    ]);
  });
});

describe('normalized rules closing destinations (#1149)', () => {
  const bySlug = (slug: string) => articles.find((a) => a.slug === slug)!;

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
