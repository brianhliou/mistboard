// The iframe code a reader pastes to put a Mistboard embed on their own page:
// the frameable route, the site's default frame size (embed-contract.ts, the
// same numbers the oEmbed provider answers with), responsive width.

import { EMBED_DEFAULT_HEIGHT, EMBED_DEFAULT_WIDTH, embedGamePath } from '@mistboard/game';

export function embedIframeCode(path: string, title: string, origin: string): string {
  const safeTitle = title.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return (
    `<iframe src="${origin}${path}" width="${EMBED_DEFAULT_WIDTH}" height="${EMBED_DEFAULT_HEIGHT}" ` +
    `style="max-width:100%;border:0" frameborder="0" loading="lazy" title="${safeTitle}"></iframe>`
  );
}

/** One finished game played here: /embed/game/:roomId. */
export function gameEmbedCode(roomId: string, title: string, origin: string): string {
  return embedIframeCode(embedGamePath(encodeURIComponent(roomId)), title, origin);
}
