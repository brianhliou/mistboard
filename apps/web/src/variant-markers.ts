import './variant-markers.css';
import {
  renderVariantMiniBoard,
  type VariantMiniId,
  variantMiniForId,
} from './variant-mini-boards.js';

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
  'dark-chess': {
    path: '/variant-markers/final/fog-chess.png',
  },
} as const satisfies Partial<Record<VariantMiniId, { path: string }>>;

export function hasFinalVariantMarker(id: VariantMiniId): boolean {
  return id in FINAL_VARIANT_MARKERS;
}

export function renderVariantMarker(
  id: VariantMiniId,
  opts: {
    className?: string;
    label?: string;
    size?: number;
  } = {},
): string {
  const marker = FINAL_VARIANT_MARKERS[id as keyof typeof FINAL_VARIANT_MARKERS];
  const def = variantMiniForId(id);
  const size = opts.size ?? 64;
  const label = opts.label ?? `${def.label} marker`;
  const className = opts.className ? `variant-marker ${opts.className}` : 'variant-marker';
  if (!marker) {
    return renderVariantMiniBoard(id, { className: opts.className, label, size });
  }
  const dataClass = opts.className
    ? ` data-variant-marker-class="${escapeAttr(opts.className)}"`
    : '';
  return `<span class="${escapeAttr(className)}" role="img" aria-label="${escapeAttr(label)}" data-variant-marker-id="${id}" data-variant-marker-size="${size}"${dataClass} style="--variant-marker-mask: url('${escapeAttr(marker.path)}'); --variant-marker-size: ${size}px"></span>`;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
