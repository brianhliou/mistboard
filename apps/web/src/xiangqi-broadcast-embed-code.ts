// The iframe code a creator pastes to put one broadcast game on their own page
// (#454): the embed route, the site's default frame size, responsive width.

import {
  EMBED_DEFAULT_HEIGHT,
  EMBED_DEFAULT_WIDTH,
  embedBroadcastBoardPath,
} from '@mistboard/game';

export function broadcastEmbedCode(boardId: string, title: string, origin: string): string {
  const src = `${origin}${embedBroadcastBoardPath(encodeURIComponent(boardId))}`;
  const safeTitle = title.replace(/"/g, '&quot;');
  return (
    `<iframe src="${src}" width="${EMBED_DEFAULT_WIDTH}" height="${EMBED_DEFAULT_HEIGHT}" ` +
    `style="max-width:100%;border:0" frameborder="0" loading="lazy" title="${safeTitle}"></iframe>`
  );
}
