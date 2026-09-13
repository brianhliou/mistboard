// Which canonical export formats a finished game of each variant can be served
// in (`GET /api/games/:roomId/export.{pgn,json}`). One table, read by both the
// server route (anything else answers 501) and the review pages (they render one
// download link per listed format), so the two cannot drift.
//
// The split is about honesty, not effort. PGN needs a move notation a reader
// can follow: chess has SAN, xiangqi has WXF/ICCS. Fog xiangqi shares the 9x10
// board and its moves serialize in ICCS coordinates. Hidden-identity and flip
// variants (jieqi, banqi, jungle-flip), drops (fortress), and jungle have no
// notation standard; a "PGN" of coordinate pairs would be JSON wearing a hat, so
// they get the JSON publication only. A shuffled start would need [SetUp]/[FEN] support.
//
// Deliberately an explicit map with no fallback: a variant absent here exports
// nothing, and adding one is a conscious decision about its notation.

import { hasOwnKey } from './js-compat.js';

export type GameExportFormat = 'pgn' | 'json';

export const GAME_EXPORT_FORMATS = {
  'dark-chess': ['pgn', 'json'],
  xiangqi: ['pgn', 'json'],
  'dark-xiangqi': ['pgn', 'json'],
  jieqi: ['json'],
  banqi: ['json'],
  'fortress-xiangqi': ['json'],
  // JSON only, for the same reason as the others: a turn here is a piece move
  // AND a duck placement, and neither WXF nor ICCS has anything to say about the
  // second half. Publishing the xiangqi half as PGN would emit a movetext that
  // does not reconstruct the game.
  'duck-xiangqi': ['json'],
  jungle: ['json'],
  'jungle-flip': ['json'],
} as const satisfies Readonly<Record<string, readonly GameExportFormat[]>>;

export type GameExportVariant = keyof typeof GAME_EXPORT_FORMATS;

export function isGameExportVariant(variant: string): variant is GameExportVariant {
  return hasOwnKey(GAME_EXPORT_FORMATS, variant);
}

/** The formats a variant exports, or an empty list when it exports nothing. */
export function exportFormatsForVariant(variant: string): readonly GameExportFormat[] {
  return isGameExportVariant(variant) ? GAME_EXPORT_FORMATS[variant] : [];
}
