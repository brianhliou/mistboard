import './variant-markers.css';
import { hasOwnKey } from '@mistboard/game';
import { type VariantMiniId, variantMiniForId } from './variant-mini-boards.js';

// Final one-colour variant markers: white-on-transparent PNG masks painted with
// `currentColor` by variant-markers.css. Every VariantMiniId has one. There is
// no fallback picture: the `satisfies Record<…>` below makes a new variant id
// without art a type error, and variant-markers.test.ts fails if a path has no
// file on disk or a live game spec has no marker. Fail closed, like variant
// dispatch.
//
// How they are made: the first set came from an image model and was cut to
// alpha masks (2d64bbbb); later ones are drawn as 1254x1254 masks with PIL on a
// 4x canvas (atomic, 96981921) or cut from piece art (duck, 4e38852e), scaled
// to fill ~93-97% of the box.
export const FINAL_VARIANT_MARKERS = {
  // Five stones on a diagonal, with the grid cleared around each stone.
  gomoku: {
    path: '/variant-markers/final/gomoku.png',
  },
  xiangqi: {
    path: '/variant-markers/final/elephant-chess.png',
  },
  'fortress-xiangqi': {
    path: '/variant-markers/final/fortress.png',
  },
  jieqi: {
    path: '/variant-markers/final/flip-elephant-chess.png',
  },
  'jungle-flip': {
    path: '/variant-markers/final/flip-jungle.png',
  },
  // Four pieces inside the squares of a frame: banqi plays in the squares. Its
  // twin, Three Kingdoms banqi, puts four pieces on the points of a grid.
  banqi: {
    path: '/variant-markers/final/banqi.png',
  },
  'three-kingdoms-banqi': {
    path: '/variant-markers/final/three-kingdoms-banqi.png',
  },
  // Banqi's frame with its top and bottom edges drawn as HP bars, each partly
  // drained: FFQ plays banqi for HP.
  'ffq-banqi': {
    path: '/variant-markers/final/ffq-banqi.png',
  },
  jungle: {
    path: '/variant-markers/final/jungle-chess.png',
  },
  'dark-xiangqi': {
    path: '/variant-markers/final/fog-elephant-chess.png',
  },
  'duck-xiangqi': {
    path: '/variant-markers/final/duck-elephant-chess.png',
  },
  'atomic-xiangqi': {
    path: '/variant-markers/final/atomic.png',
  },
  'crazyhouse-xiangqi': {
    path: '/variant-markers/final/crazyhouse-xiangqi.png',
  },
  'dark-chess': {
    path: '/variant-markers/final/fog-chess.png',
  },
  // Two mahjong tiles standing on one baseline, the front one carrying the
  // xiangqi elephant: xiangqi pieces played as tiles.
  'xiangqi-mahjong': {
    path: '/variant-markers/final/xiangqi-mahjong.png',
  },
} as const satisfies Record<VariantMiniId, { path: string }>;

/** Narrows an untyped variant string (a stored study variant, a wire field) to a marker id. */
export function isVariantMarkerId(value: string): value is VariantMiniId {
  // Own keys only: `in` would also find 'toString'.
  return hasOwnKey(FINAL_VARIANT_MARKERS, value);
}

export function renderVariantMarker(
  id: VariantMiniId,
  opts: {
    className?: string;
    label?: string;
    size?: number;
  } = {},
): string {
  // The type already says this cannot miss; the throw covers a cast at a call
  // site, so a bad id breaks loudly instead of painting an empty mask.
  if (!isVariantMarkerId(id)) throw new Error(`No variant marker for ${String(id)}`);
  const marker = FINAL_VARIANT_MARKERS[id];
  const def = variantMiniForId(id);
  const size = opts.size ?? 64;
  const label = opts.label ?? `${def.label} marker`;
  const className = opts.className ? `variant-marker ${opts.className}` : 'variant-marker';
  const dataClass = opts.className
    ? ` data-variant-marker-class="${escapeAttr(opts.className)}"`
    : '';
  const path = variantMarkerPath(marker.path, size);
  return `<span class="${escapeAttr(className)}" role="img" aria-label="${escapeAttr(label)}" data-variant-marker-id="${id}" data-variant-marker-size="${size}"${dataClass} style="--variant-marker-mask: url('${escapeAttr(path)}'); --variant-marker-size: ${size}px"></span>`;
}

// Every mask is 1254px, about 100 KB each and 1.4 MB for the set, and the
// homepage shows a dozen of them at 24 to 40px. On a slow connection they
// downloaded ahead of the board's piece art, so the pieces sat blank for
// seconds (2026-11-25). A marker drawn at 64px or less reads a 128px copy
// beside the original (made with `sips -Z 128`, 2x the largest such size); a
// larger one keeps the full mask. A caller passes the size it is drawn at.
export const SMALL_VARIANT_MARKER_MAX_SIZE = 64;
export const SMALL_VARIANT_MARKER_DIR = '/variant-markers/final/128/';

export function variantMarkerPath(path: string, size: number): string {
  if (size > SMALL_VARIANT_MARKER_MAX_SIZE) return path;
  return `${SMALL_VARIANT_MARKER_DIR}${path.slice(path.lastIndexOf('/') + 1)}`;
}

// A neutral question-mark marker for a rules page whose variant has no art yet.
// Same box and mask paint as a final marker, so a rail or tile never falls back
// to a board picture; replace it by adding the variant to FINAL_VARIANT_MARKERS.
export function renderPlaceholderVariantMarker(
  opts: { label?: string; size?: number } = {},
): string {
  const size = opts.size ?? 64;
  const label = opts.label ?? 'Variant marker coming soon';
  return `<span class="variant-marker" role="img" aria-label="${escapeAttr(label)}" data-variant-marker-placeholder data-variant-marker-size="${size}" style="--variant-marker-mask: url('/variant-markers/placeholder.svg'); --variant-marker-size: ${size}px"></span>`;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
