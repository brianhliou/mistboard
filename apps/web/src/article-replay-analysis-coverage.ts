// Which article boards owe an advantage chart, and where it comes from. Shared by
// the coverage test and scripts/article-chart-analysis.mjs, which writes the
// files; never imported by the client.
//
// Every xiangqi game record on an article is charted: from the broadcast
// archive when the spec has a `boardId`, else from a precomputed file. Two kinds
// of board are not games and owe nothing:
// - a board that starts from a FEN (a puzzle, a study position, an endgame):
//   the chart is a whole-game picture and there is no game;
// - the articles listed below, whose boards are not standard xiangqi at all.

import type { Article } from './articles/types.js';
import type { XiangqiReplaySpec } from './xiangqi-replay.js';

/** Articles whose xiangqi boards are another game's lines, with the reason. */
export const ARTICLE_ANALYSIS_EXEMPT_SLUGS: Readonly<Record<string, string>> = {
  'riverbank-cannon': 'Fog xiangqi (Misty) lines: generals are captured, no standard engine eval',
};

export type ArticleReplayRecord = {
  slug: string;
  spec: XiangqiReplaySpec;
  /** archive: boardId; static: a precomputed file; none: not a game. */
  chart: 'archive' | 'static' | 'none';
};

type ReplayBlock = { kind?: string; spec?: XiangqiReplaySpec };

/** Every `xq-replay` board on every article, with where its chart comes from. */
export function articleReplayRecords(articles: readonly Article[]): ArticleReplayRecord[] {
  return articles.flatMap((article) =>
    [...(article.intro ?? []), ...(article.sections ?? []).flatMap((s) => s.blocks ?? [])]
      .map((block) => block as unknown as ReplayBlock)
      .filter((block) => block?.kind === 'xq-replay' && block.spec)
      .map((block) => {
        const spec = block.spec as XiangqiReplaySpec;
        const chart: ArticleReplayRecord['chart'] = spec.boardId
          ? 'archive'
          : spec.startFen || article.slug in ARTICLE_ANALYSIS_EXEMPT_SLUGS
            ? 'none'
            : 'static';
        return { slug: article.slug, spec, chart };
      }),
  );
}
