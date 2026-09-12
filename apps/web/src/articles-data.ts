// Thin barrel for the articles content modules. The articles array, schema
// types, and snapshot artifacts were split out of this file into
// ./articles/{types,diagrams,content/*}; this barrel preserves the exact public
// export surface so no other file needs to change.

export * from './articles/types.js';
export { withXiangqiBoardLayout, withXiangqiPieceSet } from './articles/diagrams.js';

import type { Article } from './articles/types.js';
import { SERVER_FOG_SNAPSHOT_JSON_TEXT } from './articles/diagrams.js';
import { banqiArticle } from './articles/content/banqi.js';
import { banqiEngineArticle } from './articles/content/banqi-engine.js';
import { banqiLuckArticle } from './articles/content/banqi-luck.js';
import { chessArticle } from './articles/content/chess.js';
import { coUpArticle } from './articles/content/co-up.js';
import { luatCoUpArticle } from './articles/content/luat-co-up.js';
import { jieqiPlatformArticle } from './articles/content/jieqi-platform.js';
import { darkChessArticle } from './articles/content/dark-chess.js';
import { darkChessConceptsArticle } from './articles/content/fog-chess-concepts.js';
import { fogOpeningsArticle } from './articles/content/fog-openings.js';
import { jieqiOpeningsArticle } from './articles/content/jieqi-openings.js';
import { khaiCuocCoUpArticle } from './articles/content/khai-cuoc-co-up.js';
import { darkCrazyhouseArticle } from './articles/content/dark-crazyhouse.js';
import { darkDraft960Article } from './articles/content/dark-draft960.js';
import { darkXiangqiArticle } from './articles/content/dark-xiangqi.js';
import { duckXiangqiBuildArticle } from './articles/content/duck-xiangqi-build.js';
import { duckXiangqiArticle } from './articles/content/duck-xiangqi.js';
import { fortressXiangqiArticle } from './articles/content/fortress-xiangqi.js';
import { jieqiArticle } from './articles/content/jieqi.js';
import { jungleArticle } from './articles/content/jungle.js';
import { jungleFlipArticle } from './articles/content/jungle-flip.js';
import { puzzleMiningArticle } from './articles/content/puzzle-mining.js';
import { puzzleTwoAnswersArticle } from './articles/content/puzzles-with-more-than-one-solution.js';
import { kriegspielArticle } from './articles/content/kriegspiel.js';
import { mistyArticle } from './articles/content/misty.js';
import { revealChessArticle } from './articles/content/reveal-chess.js';
import { riverbankCannonArticle } from './articles/content/riverbank-cannon.js';
import { titledPlayersArticle } from './articles/content/titled-players.js';
import { serverEnforcedFogArticle } from './articles/content/server-enforced-fog.js';
import { shogi4Article } from './articles/content/shogi4.js';
import { xiangqiChampionsArticle } from './articles/content/xiangqi-champions.js';
import { xiangqiMatchFixingArticle } from './articles/content/xiangqi-match-fixing.js';
import { xiangqiWorldChampionshipArticle } from './articles/content/xiangqi-world-championship.js';
import { xiangqiArticle } from './articles/content/xiangqi.js';
import articleSnapshotFog from './article-snapshot-fog.json' with { type: 'json' };

export const articles: Article[] = [
  jieqiPlatformArticle,
  coUpArticle,
  luatCoUpArticle,
  mistyArticle,
  chessArticle,
  darkChessArticle,
  darkChessConceptsArticle,
  fogOpeningsArticle,
  jieqiOpeningsArticle,
  khaiCuocCoUpArticle,
  darkDraft960Article,
  xiangqiArticle,
  xiangqiChampionsArticle,
  xiangqiMatchFixingArticle,
  xiangqiWorldChampionshipArticle,
  darkXiangqiArticle,
  fortressXiangqiArticle,
  duckXiangqiArticle,
  duckXiangqiBuildArticle,
  serverEnforcedFogArticle,
  shogi4Article,
  darkCrazyhouseArticle,
  kriegspielArticle,
  jieqiArticle,
  jungleArticle,
  jungleFlipArticle,
  banqiArticle,
  banqiEngineArticle,
  banqiLuckArticle,
  puzzleMiningArticle,
  puzzleTwoAnswersArticle,
  riverbankCannonArticle,
  titledPlayersArticle,
  revealChessArticle,
];

const ARTICLE_SLUG_ALIASES: Record<string, string> = {
  'dark-chess-concepts': 'fog-chess-concepts',
  'flip-xiangqi': 'banqi',
  'dark-chess': 'fog-chess',
  'dark-xiangqi': 'fog-xiangqi',
  'reveal-xiangqi': 'jieqi',
};

export function findArticle(slug: string): Article | undefined {
  const canonicalSlug = ARTICLE_SLUG_ALIASES[slug] ?? slug;
  return articles.find((a) => a.slug === canonicalSlug);
}

// Real WebSocket snapshot frame captured from a live PvP dark-chess room
// via apps/server/scripts/capture-snapshot.mjs and anonymized. Embedded as
// a verbatim artifact for the server-enforced-fog article. Re-run the
// capture script after wire-format changes.
export const SERVER_FOG_SNAPSHOT_ARTIFACT = articleSnapshotFog as unknown as Record<string, unknown>;
export const SERVER_FOG_SNAPSHOT_JSON = SERVER_FOG_SNAPSHOT_JSON_TEXT;
