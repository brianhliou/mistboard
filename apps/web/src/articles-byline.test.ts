import { describe, expect, it, vi } from 'vitest';
// Static, not `await import()` inside each test. vi.mock is hoisted above the
// imports, so the mock below still applies, and the module graph behind
// articles.js (~850ms cold) is paid at load time instead of being charged to
// the first test's 5s timeout. Under a loaded machine that cost blew the
// budget and failed a release; the second and third tests passed on the warm
// cache, which is what made it look like one flaky test rather than a pattern.
import { isArticleTranslationPublished } from './article-i18n.js';
import { articleJsonLdAuthor, hasSiteByline, SITE_AUTHOR } from './articles/site-author.js';
import { buildArticlePage } from './articles.js';
import { type Article, articles } from './articles-data.js';

// A guest article does not exist in the shipped catalog yet, so the byline path
// is driven through a synthetic one resolved by the real render code.
const GUEST: Article = {
  slug: 'guest-piece',
  kind: 'article',
  publisher: 'community',
  title: 'A guest annotates the Riverbank Cannon',
  summary: 'One master on one opening.',
  status: 'published',
  audience: 'Club players',
  publishedAt: '2026-08-27',
  author: { displayName: 'Wei Chen', handle: 'weichen', title: 'xgm' },
  sections: [{ heading: 'Opening', blocks: [{ kind: 'paragraph', text: 'A move.' }] }],
};

const ANONYMOUS: Article = { ...GUEST, slug: 'house-piece', author: undefined };

// Table cells rendered through textContent until 2026-08-27, so inline markdown
// in a cell printed its own brackets.
const TABLED: Article = {
  ...GUEST,
  slug: 'tabled-piece',
  sections: [
    {
      heading: 'Numbers',
      blocks: [
        {
          kind: 'table',
          headers: ['Surface', 'What you get'],
          rows: [['Coaching', 'Publish at [/coach](/coach), **no commission**.']],
        },
      ],
    },
  ],
};

// A Mistboard-published article with every trust field set, plus its rules
// and Vietnamese counterparts, which must each leave something out.
const SITE: Article = {
  slug: 'site-piece',
  kind: 'article',
  publisher: 'mistboard',
  title: 'How often the bot blunders',
  summary: 'A measured post.',
  status: 'published',
  audience: 'Club players',
  publishedAt: '2026-09-01',
  updatedAt: '2026-09-10',
  updateNote: 'Corrected the second table.',
  tldr: ['The bot blunders less than it seems.'],
  method: ['200 games at one million nodes a move.', 'Every game replayed by the rule kernel.'],
  sections: [{ heading: 'Results', blocks: [{ kind: 'paragraph', text: 'A finding.' }] }],
};
const SITE_SAME_DAY: Article = {
  ...SITE,
  slug: 'site-same-day',
  updatedAt: '2026-09-01',
};
const RULES: Article = {
  slug: 'rules-piece',
  kind: 'rules',
  title: 'Rules of a game',
  summary: 'How it plays.',
  status: 'published',
  audience: 'Players',
  publishedAt: '2026-09-01',
  sections: [{ heading: 'Setup', blocks: [{ kind: 'paragraph', text: 'Set it up.' }] }],
} as Article;
const VI: Article = { ...SITE, slug: 'vi-piece', sourceLang: 'vi' };

vi.mock('./articles-data.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./articles-data.js')>();
  return {
    ...actual,
    findArticle: (slug: string) => {
      if (slug === 'guest-piece') return GUEST;
      if (slug === 'house-piece') return ANONYMOUS;
      if (slug === 'tabled-piece') return TABLED;
      if (slug === 'site-piece') return SITE;
      if (slug === 'site-same-day') return SITE_SAME_DAY;
      if (slug === 'rules-piece') return RULES;
      if (slug === 'vi-piece') return VI;
      return actual.findArticle(slug);
    },
  };
});

describe('guest article byline', () => {
  it('renders the author with their verified title, linked to their profile', () => {
    const page = buildArticlePage('guest-piece');

    const byline = page.querySelector('.article-meta-byline');
    expect(byline?.textContent).toContain('By');
    expect(byline?.querySelector('.article-meta-author-name')?.textContent).toBe('Wei Chen');

    const badge = byline?.querySelector('.title-badge');
    expect(badge?.textContent).toBe('XGM');
    expect(badge?.getAttribute('title')).toBe('Xiangqi Grandmaster');

    const link = byline?.querySelector<HTMLAnchorElement>('a.article-meta-author');
    expect(link?.getAttribute('href')).toBe('/@/weichen');
    // The byline leads the meta row, ahead of the dates.
    expect(page.querySelector('.article-meta-row')?.firstElementChild).toBe(byline);
  });

  it('renders no byline for an article Mistboard wrote itself', () => {
    const page = buildArticlePage('house-piece');

    expect(page.querySelector('.article-meta-byline')).toBeNull();
    // The dates still render, so the meta row is not simply empty.
    expect(page.querySelector('.article-meta-dates')?.textContent).toContain('Published');
  });
});

describe('article table cells', () => {
  it('renders inline markdown rather than printing its brackets', () => {
    const page = buildArticlePage('tabled-piece');

    const cell = page.querySelector('.article-table tbody td:last-child');
    expect(cell?.textContent).not.toContain('[/coach]');
    expect(cell?.querySelector<HTMLAnchorElement>('a')?.getAttribute('href')).toBe('/coach');
    expect(cell?.querySelector('strong')?.textContent).toBe('no commission');
  });
});

describe('site author byline and drafted note', () => {
  it('signs a Mistboard article with the site author, linked to About', () => {
    const page = buildArticlePage('site-piece');
    const link = page.querySelector<HTMLAnchorElement>(
      '.article-meta-byline a.article-meta-author',
    );
    expect(link?.textContent).toBe('Brian H. Liou');
    expect(link?.getAttribute('href')).toBe('/about#who');
    expect(page.querySelector('.article-meta-drafted')?.textContent).toBe('Drafted with Claude');
    // The note sits with the name it describes, not on the date line.
    expect(page.querySelector('.article-meta-byline .article-meta-drafted')).not.toBeNull();
    expect(page.querySelector('.article-meta-dates .article-meta-drafted')).toBeNull();
  });

  it('says a zh rendering is a machine translation of the English', () => {
    const slug = articles.find(
      (a) => a.status === 'published' && hasSiteByline(a) && isArticleTranslationPublished(a.slug),
    )?.slug;
    expect(slug, 'a translated Mistboard article to render').toBeTruthy();
    const hans = buildArticlePage(slug as string, 'zh-Hans');
    expect(hans.querySelector('.article-meta-drafted')?.textContent).toBe(
      '与 Claude 合写 · 由英文机器翻译',
    );
    expect(hans.querySelector('.article-meta-author-name')?.textContent).toBe('Brian H. Liou');
    const hant = buildArticlePage(slug as string, 'zh-Hant');
    expect(hant.querySelector('.article-meta-drafted')?.textContent).toBe(
      '與 Claude 合寫 · 由英文機器翻譯',
    );
  });

  it('leaves rules pages unsigned and without the note', () => {
    const page = buildArticlePage('rules-piece');
    expect(page.querySelector('.article-meta-byline')).toBeNull();
    expect(page.querySelector('.article-meta-drafted')).toBeNull();
  });

  it('gives a Vietnamese page the byline but no drafted note', () => {
    const page = buildArticlePage('vi-piece');
    expect(page.querySelector('.article-meta-author-name')?.textContent).toBe('Brian H. Liou');
    expect(page.querySelector('.article-meta-drafted')).toBeNull();
  });

  it('keeps the guest byline and gives a guest piece no drafted note', () => {
    const page = buildArticlePage('guest-piece');
    expect(page.querySelector('.article-meta-author-name')?.textContent).toBe('Wei Chen');
    expect(page.querySelector('.article-meta-drafted')).toBeNull();
  });
});

describe('update note and method box', () => {
  it('says what changed when the updated date differs from the publish date', () => {
    const page = buildArticlePage('site-piece');
    const note = page.querySelector('.article-update-note');
    expect(note?.textContent).toContain('What changed:');
    expect(note?.textContent).toContain('Corrected the second table.');
  });

  it('shows no update note when the updated date is the publish date', () => {
    expect(buildArticlePage('site-same-day').querySelector('.article-update-note')).toBeNull();
  });

  it('renders the method box after the TL;DR, one item per line', () => {
    const page = buildArticlePage('site-piece');
    const method = page.querySelector('.article-method');
    expect(method?.querySelector('.article-method-heading')?.textContent).toBe(
      'How we measured this',
    );
    expect(
      Array.from(method?.querySelectorAll('.article-method-list li') ?? []).map(
        (li) => li.textContent,
      ),
    ).toEqual(SITE.method);
    expect(method?.previousElementSibling?.classList.contains('article-tldr')).toBe(true);
  });
});

describe('article JSON-LD author', () => {
  it('names the site author as a Person, a guest as a Person, and falls back to Mistboard', () => {
    expect(articleJsonLdAuthor(SITE)).toEqual({
      '@type': 'Person',
      name: SITE_AUTHOR.name,
      url: 'https://mistboard.com/about',
      sameAs: ['https://brianhliou.com'],
    });
    expect(articleJsonLdAuthor(GUEST)).toEqual({
      '@type': 'Person',
      name: 'Wei Chen',
      url: 'https://mistboard.com/@/weichen',
    });
    expect(articleJsonLdAuthor(RULES)).toEqual({ '@type': 'Organization', name: 'Mistboard' });
  });
});
