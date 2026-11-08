// The scheduled index supplement uses the same listing policy, translations
// and links as the client cards. No request-time import of web modules needed.
import { localizedArticleHref, publishedArticleLang, translateArticle } from './article-i18n.js';
import { articleListable } from './articles/blog-listing.js';
import type { Article } from './articles/types.js';
import { variantNavLabel } from './articles.js';
import { SUPPORTED_LOCALES } from './i18n/locale.js';
import { rulesSlugPublicSurfaceEnabled } from './variant-public-surfaces.js';

export function scheduledArticleIndexEntry(article: Article) {
  if (
    !articleListable(article) ||
    (article.kind === 'rules' && !rulesSlugPublicSurfaceEnabled(article.gameSpecId ?? article.slug))
  )
    return null;
  return {
    kind: article.kind,
    publisher: article.kind === 'article' ? article.publisher : 'mistboard',
    locales: Object.fromEntries(
      SUPPORTED_LOCALES.map((locale) => {
        const lang = publishedArticleLang(article.slug, locale === 'en' ? undefined : locale);
        const localized = lang ? translateArticle(article, lang) : article;
        return [
          locale.toLowerCase(),
          {
            title: article.kind === 'rules' ? variantNavLabel(localized.title) : localized.title,
            summary: article.kind === 'rules' ? '' : localized.summary,
            href: localizedArticleHref(article, locale),
          },
        ];
      }),
    ),
  };
}
