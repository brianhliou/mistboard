// The Share & export tab's rows for a finished game played here (lichess: the
// "Share & export" underboard tab): a Download row with the canonical exports
// (the Game Publishing Track's `/api/games/:roomId/export.{pgn,json}`, the PGN
// with the CC BY header and the versioned JSON (schema_version)) and the game's board image,
// then an Embed row with the iframe code for `/embed/game/:roomId`. Every
// postgame surface hands the result to the tab through `shareExtra`, so these
// live in one place across variants. Which formats a variant offers comes from
// the shared table in @mistboard/game, the same one the server gates on, so a
// link never points at a 501.
//
// Finished games only, by construction: every caller is a postgame page, whose
// payload the server serves only once the game is over and its hidden
// information (fog, face-down pieces) is public. The embed route and the image
// apply the same gate on their own side.

import { exportFormatsForVariant, type GameExportFormat } from '@mistboard/game';
import { gameEmbedCode } from '../embed-code.js';
import { variantDisplayLabel } from '../game-display.js';
import { t } from '../i18n/catalog.js';
import { type DownloadLink, downloadRow, shareRow } from './underboard-tabs.js';

export function gameExportLinks(
  roomId: string,
  formats: readonly GameExportFormat[],
): DownloadLink[] {
  const encoded = encodeURIComponent(roomId);
  return formats.map((format) => ({
    text: format.toUpperCase(),
    href: `/api/games/${encoded}/export.${format}`,
    filename: `mistboard-${roomId}.${format}`,
  }));
}

/** The game's board card (`/og/game/:id.png`, the image its share previews
 *  use), saved as mistboard-<id>.png. */
export function gameImageLink(roomId: string): DownloadLink {
  return {
    text: t('underboard.image'),
    href: `/og/game/${encodeURIComponent(roomId)}.png`,
    filename: `mistboard-${roomId}.png`,
  };
}

/** A Share & export row holding the iframe code for the game's embed. */
export function gameEmbedRow(roomId: string, variant: string, origin: string): HTMLElement {
  const code = document.createElement('textarea');
  code.value = gameEmbedCode(roomId, `${variantDisplayLabel(variant)} · Mistboard`, origin);
  code.rows = 2;
  // Dressed like the Moves field above it: the row is built outside the tab.
  code.className = 'review-share__field review-share__field--moves';
  code.readOnly = true;
  return shareRow(t('underboard.embed'), code);
}

/** The `shareExtra` config for a finished game of `variant`: the Download row
 *  (each exportable format, then the image) and the Embed row. Spread it into
 *  the review config. */
export function gameExportShareExtra(
  variant: string,
  roomId: string,
  origin: string = window.location.origin,
): { shareExtra: HTMLElement[] } {
  const links = [
    ...gameExportLinks(roomId, exportFormatsForVariant(variant)),
    gameImageLink(roomId),
  ];
  return { shareExtra: [downloadRow(links), gameEmbedRow(roomId, variant, origin)] };
}
