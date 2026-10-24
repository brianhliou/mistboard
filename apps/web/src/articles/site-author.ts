import type { Article } from './types';

// The person behind every article Mistboard publishes under its own name. One
// constant so the visible byline, the About anchor it links to and the JSON-LD
// author cannot drift apart. Guest pieces (`author` set) keep their own byline;
// rules pages are reference documents and carry no byline at all.
export const SITE_AUTHOR = {
  name: 'Brian H. Liou',
  href: '/about#who',
  url: 'https://mistboard.com/about',
  // His own site, for the About bio link and the JSON-LD sameAs.
  sameAs: 'https://brianhliou.com',
} as const;

/** True when the page is a Mistboard-published article with no guest author. */
export function hasSiteByline(article: Article): boolean {
  return article.kind === 'article' && article.publisher === 'mistboard' && !article.author;
}

/**
 * The note in the byline saying how the text was made. English articles by
 * the site author say they were drafted with Claude; their zh renderings add
 * that they are machine translations of the English. Guest pieces, rules pages
 * and Vietnamese pages (`sourceLang`) get none.
 */
export function articleMadeWithNote(
  article: Article,
  articleLang: string | undefined,
): 'drafted' | 'drafted-translated' | null {
  if (!hasSiteByline(article) || article.sourceLang) return null;
  return articleLang ? 'drafted-translated' : 'drafted';
}

type JsonLdAuthor =
  | { '@type': 'Person'; name: string; url?: string; sameAs?: string[] }
  | { '@type': 'Organization'; name: string };

/** The schema.org author for an article page's JSON-LD. */
export function articleJsonLdAuthor(article: Article): JsonLdAuthor {
  if (hasSiteByline(article)) {
    return {
      '@type': 'Person',
      name: SITE_AUTHOR.name,
      url: SITE_AUTHOR.url,
      sameAs: [SITE_AUTHOR.sameAs],
    };
  }
  if (article.author) {
    const handle = article.author.handle;
    return {
      '@type': 'Person',
      name: article.author.displayName,
      ...(handle ? { url: `https://mistboard.com/@/${encodeURIComponent(handle)}` } : {}),
    };
  }
  return { '@type': 'Organization', name: 'Mistboard' };
}
