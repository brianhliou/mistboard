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
  banqi: {
    path: '/variant-markers/final/half-flip-chess.png',
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
  return `<span class="${escapeAttr(className)}" role="img" aria-label="${escapeAttr(label)}" data-variant-marker-id="${id}" data-variant-marker-size="${size}"${dataClass} style="--variant-marker-mask: url('${escapeAttr(marker.path)}'); --variant-marker-size: ${size}px"></span>`;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
