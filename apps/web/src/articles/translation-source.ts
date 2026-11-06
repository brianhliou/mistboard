// #666 is an English review pass. Keep the published translation on its
// existing source until the expanded copy is signed off. Remove this override
// with the translation update.
import { jieqiTranslationSource } from './content/jieqi-translation-source.js';
import type { Article } from './types.js';

export function articleTranslationSource(article: Article): Article {
  if (article.slug === 'jieqi') return jieqiTranslationSource;
  return article;
}
