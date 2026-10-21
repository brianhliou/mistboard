// Content-language pairs: an English article and its page in a language the
// interface does not speak (Vietnamese today). The zh renderings are
// URL-prefixed copies of ONE article, so their relation is derived; a
// Vietnamese page is a SEPARATE article at its own slug, so nothing derives
// the relation between /blog/jieqi-platform and /blog/co-up. It has to be
// declared, or the two pages compete instead of reinforcing each other.
//
// One list, two readers: prerender-articles.mjs turns each pair into the
// hreflang alternates of the whole group, and articles.ts draws a visible
// link between the partners. The visible link is the only crawlable path to a
// Vietnamese page, which the blog index leaves out by design
// (isArticleListedInThisEnv): until 2026-10-21 nothing linked to
// /blog/lai-ly-huynh-co-tuong but its own hreflang tags.

export type ContentLanguage = 'vi';

export type CrossLanguagePair = { en: string } & Partial<Record<ContentLanguage, string>>;

export const CROSS_LANGUAGE_PAIRS: readonly CrossLanguagePair[] = [
  { en: 'jieqi-platform', vi: 'co-up' },
  { en: 'jieqi-openings', vi: 'khai-cuoc-co-up' },
  { en: 'jieqi', vi: 'luat-co-up' },
  { en: 'pikafish', vi: 'choi-co-tuong-voi-may' },
  { en: 'lai-ly-huynh', vi: 'lai-ly-huynh-co-tuong' },
];

/** Each language's own name for itself: the label a reader of that language
 *  looks for, so it is never translated. */
export const LANGUAGE_ENDONYMS: Record<'en' | ContentLanguage, string> = {
  en: 'English',
  vi: 'Tiếng Việt',
};

export type LanguagePartner = { lang: 'en' | ContentLanguage; slug: string };

/** The other pages of `slug`'s pair, English first; empty when it has none. */
export function languagePartnersOf(slug: string): LanguagePartner[] {
  const pair = CROSS_LANGUAGE_PAIRS.find((p) => Object.values(p).includes(slug));
  if (!pair) return [];
  return (Object.entries(pair) as [LanguagePartner['lang'], string][])
    .filter(([, partnerSlug]) => partnerSlug !== slug)
    .map(([lang, partnerSlug]) => ({ lang, slug: partnerSlug }));
}
