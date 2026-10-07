// Article slug -> page meta, for the server (share cards, the shell served for
// drafts, the og route, rules-vs-blog canonical URLs, sitemap indexability).
//
// The per-article half is GENERATED: article-meta.generated.json is rendered
// from apps/web/src/articles-data.ts by apps/web/src/article-server-meta.ts
// (`npm run articles:meta`), because the server cannot import the web article
// modules. Never hand-edit the JSON; apps/web/src/articles-meta-sync.test.ts
// fails when it is stale. `kind` decides the canonical URL space: kind 'rules'
// lives under /rules/<slug>, everything else under /blog/<slug>.
//
// The hand-kept sets below are site policy about slugs, not article data.
import generated from './article-meta.generated.json' with { type: 'json' };

export type ArticleKind = 'rules' | 'article';

type GeneratedArticleMeta = {
  title: string;
  kind: ArticleKind;
  description: string;
  status: 'outline' | 'draft' | 'published';
};

const GENERATED = generated as Record<string, GeneratedArticleMeta>;

// Reachable by URL, deliberately unlisted and unindexed: /rules/shogi4 is
// linked from outside the site and stays up, but is not a Mistboard variant.
// /rules/mahjong is the page for a table that is admin-only and allowlisted
// (apps/web/src/variant-public-surfaces.ts has `mahjong: false`); it leaves
// this set the day the variant goes public, and articles-meta-sync.test.ts
// fails if the two disagree. A public variant's rules page held back for
// polish goes here and in HIDDEN_RULES_SLUGS on the web side, and leaves both
// sets together (/rules/crazyhouse-xiangqi did, 2026-10-02). /rules/atomic-
// xiangqi is here while that variant is unlisted for its rules rework
// (2026-10-06; web side `'atomic-xiangqi': false`).
const NON_INDEXED_ARTICLE_SLUGS = new Set(['shogi4', 'mahjong', 'atomic-xiangqi']);

// Rules pages for retired variants (docs-private/variant-retirement-plan.md,
// #396; the spec side is runtimeStatus 'retired' in packages/game, the web
// side VARIANT_PUBLIC_SURFACE_ENABLED in apps/web/src/variant-public-surfaces.ts).
// The server answers 410 Gone for these paths (server-http.ts): the id is
// known and the page is not coming back, which is what a crawler should hear
// rather than a 404 it will keep retrying. The set also keeps them out of the
// sitemap. The content files go with their variants in Stage 2 of the plan;
// a slug whose variant has been DELETED stays here for good, because without
// it an unknown /rules/<slug> 301s to /blog/<slug> and serves the app shell
// as a soft 404.
//
// This is a second copy of a list the server cannot import, so it is only safe
// because articles-meta-sync.test.ts fails when the two disagree. Do not edit
// one end alone.
const RETIRED_RULES_SLUGS = new Set([
  // deleted (Stage 2)
  'crossroads-chess',
  'dark-crazyhouse',
  'dark-crossroads-chess',
  'dark-mini-xiangqi',
  'dark-shogi',
  'drop-mini-xiangqi',
  'kriegspiel',
  'mini-xiangqi',
  'dark-draft960',
  'reveal-chess',
  'shogi',
]);

/** A rules page whose variant is retired: served as 410 Gone. */
export function articleIsRetired(slug: string): boolean {
  return RETIRED_RULES_SLUGS.has(slug);
}

// Slugs that exist in articles-data but are not published yet. A draft is
// hidden in the production web build (the route 404s client-side), but the
// server still answers /blog/<slug> with a 200 shell and injects its title +
// description, so without this set a crawler sees a live page for an
// unpublished article. Derived from each article's status in the generated
// file, so promoting an article to 'published' (and regenerating) removes it.
const UNPUBLISHED_ARTICLE_SLUGS = new Set(
  Object.entries(GENERATED)
    .filter(([, meta]) => meta.status !== 'published')
    .map(([slug]) => slug),
);

export function articleIsUnpublished(slug: string): boolean {
  return UNPUBLISHED_ARTICLE_SLUGS.has(slug);
}

export function articleIsIndexable(slug: string): boolean {
  return (
    !NON_INDEXED_ARTICLE_SLUGS.has(slug) &&
    !UNPUBLISHED_ARTICLE_SLUGS.has(slug) &&
    !RETIRED_RULES_SLUGS.has(slug)
  );
}

export const ARTICLE_META: Record<
  string,
  { title: string; description: string; kind: ArticleKind }
> = Object.fromEntries(
  Object.entries(GENERATED).map(([slug, { title, description, kind }]) => [
    slug,
    { title, description, kind },
  ]),
);

export function canonicalArticleBase(slug: string): 'blog' | 'rules' {
  return ARTICLE_META[slug]?.kind === 'rules' ? 'rules' : 'blog';
}
