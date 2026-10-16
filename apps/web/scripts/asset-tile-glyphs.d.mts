// Types for asset-tile-glyphs.mjs, so the test that re-derives its outputs
// can import it.
type Parser = { parseFromString(source: string, type: string): Document };
type Serializer = { serializeToString(node: Node): string };
type Builder = (
  set: string,
  name: string,
  source: string,
  parser: Parser,
  serializer: Serializer,
) => string;

export const ASSET_TILE_GLYPH_SETS: readonly string[];
export const ASSET_TILE_GLYPH_COLORS: readonly string[];
export const ASSET_TILE_GLYPH_ROLES: readonly string[];
export function extractTileGlyph(
  set: string,
  source: string,
  parser: Parser,
  serializer: Serializer,
): string;
export function extractTileFace(
  set: string,
  source: string,
  parser: Parser,
  serializer: Serializer,
): string;
export const tileGlyphFile: Builder;
export const tileFaceFile: Builder;
export function tileLayerFiles(): [string, string, string, Builder][];
export function piecesDir(webRoot: string): string;
