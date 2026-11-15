import type { Article, ArticleSection } from './articles/types.js';
import type { Locale } from './i18n/locale.js';

/** Local study IDs never become published links. Production promotion is a
 * separate step after both studies have been created and reviewed there. */
export function withRulesGamePreview(article: Article, locale: Locale): Article {
  if (!import.meta.env.DEV || locale !== 'en') return article;
  const path =
    article.slug === 'banqi'
      ? import.meta.env.VITE_BANQI_RULES_GAME
      : article.slug === 'three-kingdoms-banqi'
        ? import.meta.env.VITE_THREE_KINGDOMS_BANQI_RULES_GAME
        : undefined;
  if (typeof path !== 'string' || !/^\/embed\/study\/[A-Za-z0-9]{8}\/[A-Za-z0-9]{8}$/.test(path))
    return article;

  if (article.slug === 'banqi') {
    return {
      ...article,
      sections: article.sections.map((section) =>
        section.heading !== 'An engine game'
          ? section
          : {
              ...section,
              blocks: section.blocks?.map((block, index) => {
                if (index === 0 && block.kind === 'paragraph')
                  return {
                    ...block,
                    text: '[MistyBanqi](/blog/mistybanqi), Level 7 against Level 8. Level 7 plays black and Level 8 plays red; Level 8 wins when Level 7 has no legal move left. Step through the notes with the arrows. The graph shows Level 7’s winning chances, move grades judge the choice before a flip, and the die shows the luck of the draw.',
                  };
                return block.kind === 'embed'
                  ? { ...block, path, title: 'Banqi: Level 7 versus Level 8, annotated' }
                  : block;
              }),
            },
      ),
    };
  }

  const game: ArticleSection = {
    heading: 'An engine game',
    blocks: [
      {
        kind: 'paragraph',
        text: 'Misty Level 8 plays red; Level 7 plays black. Level 7 wins 100 to 45 after 78 plies. Step through the notes with the arrows. The graph shows Level 8’s winning chances, move grades judge the choice before a flip, and the die shows the luck of the draw. The seven pieces still face down at the end stay unknown.',
      },
      {
        kind: 'embed',
        path,
        title: 'Three Kingdoms Banqi: Level 7 versus Level 8, annotated',
        aspect: [702, 480],
      },
    ],
  };
  return {
    ...article,
    sections: article.sections.flatMap((section) =>
      section.heading === 'Play on Mistboard' ? [game, section] : [section],
    ),
  };
}
