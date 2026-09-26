// A player page's share card (#458): the settled board card (og-card-board.ts)
// without seats, the player's English name as its headline (the rasterizer has
// no CJK face) and the current CXA standing (else the team) under it, beside
// the final position of
// the player's latest game. The URL carries a key of exactly that content
// (player-pages.ts playerCardKey), so the immutable image changes when a new
// game lands or a new points list is baked.

import type { ServerResponse } from 'node:http';
import { broadcastFinalFen } from './og-broadcast.js';
import { loadCardArt, renderBoardCard } from './og-card-board.js';
import { resolvePositionOg } from './og-position.js';
import { createPngCache, redirectToDefault, svgToPng, writePng } from './og-raster.js';
import * as persistence from './persistence.js';
import {
  livePlayerSources,
  PLAYER_OG_IMAGE_VERSION,
  playerCardContent,
  playerCardKey,
} from './player-pages.js';

const cache = createPngCache(64);

/** /og/player/:slug.png */
export async function servePlayerOgImage(
  slug: string,
  response: ServerResponse,
  staticDir: string,
): Promise<void> {
  const sources = livePlayerSources(staticDir);
  const players = await sources.listPlayers();
  const player = players.find((entry) => entry.slug === slug);
  if (!player) {
    redirectToDefault(response);
    return;
  }
  const [boards, reference] = await Promise.all([
    sources.listBoards(player, players),
    sources.reference(),
  ]);
  const content = playerCardContent(player, boards, reference);
  const key = `player:v${PLAYER_OG_IMAGE_VERSION}:${slug}:${playerCardKey(content)}`;
  const cached = cache.get(key);
  if (cached) {
    writePng(response, cached, 'HIT');
    return;
  }
  const board = content.boardId
    ? await persistence.getXiangqiBroadcastBoard(content.boardId)
    : null;
  // No stored game to draw (should not happen: a page needs one) starts from
  // the opening rather than dropping to the site card.
  const resolved = resolvePositionOg('xiangqi', broadcastFinalFen(board?.moves ?? []));
  if (!resolved) {
    redirectToDefault(response);
    return;
  }
  const art = await loadCardArt(staticDir);
  const svg = renderBoardCard(resolved.board, art, {
    title: content.title,
    subtitle: content.subtitle,
  });
  const png = await svgToPng(svg);
  cache.set(key, png);
  writePng(response, png, 'MISS');
}
