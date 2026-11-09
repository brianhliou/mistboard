import type { XiangqiBoardLayout } from './xiangqi-appearance-storage.js';

type CaptureTargetStyle = 'ring' | 'fill' | 'corners' | 'legacy';

function readCaptureTargetOverride(): CaptureTargetStyle | null {
  // Temporary comparison switch: ?captureTargetStyle=ring|fill|corners|legacy.
  // Read once per page; remove once a capture-target style is chosen.
  if (typeof location === 'undefined') return null;
  const value = new URLSearchParams(location.search).get('captureTargetStyle');
  return value === 'ring' || value === 'fill' || value === 'corners' || value === 'legacy'
    ? value
    : null;
}

const override = readCaptureTargetOverride();

export function captureTargetStyle(layout: XiangqiBoardLayout): CaptureTargetStyle {
  return override ?? (layout === 'cell' ? 'fill' : 'ring');
}

/** Flat capture marks only; raised pieces keep their face and side tints. */
export function captureTargetSvg(
  className: string,
  center: { x: number; y: number },
  cell: number,
  layout: XiangqiBoardLayout,
  ringRadius: number,
  legacyRadius: number,
): string {
  const style = captureTargetStyle(layout);
  const { x, y } = center;
  if (style === 'ring') {
    return `<circle class="${className}" cx="${x}" cy="${y}" r="${ringRadius}"/>`;
  }
  if (style === 'legacy') {
    return `<circle class="${className} ${className}-legacy" cx="${x}" cy="${y}" r="${legacyRadius}" style="fill: none; stroke: rgba(31, 111, 91, 0.48); stroke-width: 3; pointer-events: none;"/>`;
  }
  const paint =
    'fill: var(--board-move-hint, rgba(31, 111, 91, 0.72)); stroke: none; pointer-events: none;';
  const left = x - cell / 2;
  const top = y - cell / 2;
  if (style === 'fill') {
    return `<rect class="${className}-fill" x="${left}" y="${top}" width="${cell}" height="${cell}" style="${paint} opacity: 0.36;"/>`;
  }
  const right = x + cell / 2;
  const bottom = y + cell / 2;
  const size = cell * 0.18;
  const triangles = [
    `${left},${top} ${left + size},${top} ${left},${top + size}`,
    `${right},${top} ${right - size},${top} ${right},${top + size}`,
    `${left},${bottom} ${left + size},${bottom} ${left},${bottom - size}`,
    `${right},${bottom} ${right - size},${bottom} ${right},${bottom - size}`,
  ];
  return `<g class="${className}-corners" style="${paint}">${triangles.map((points) => `<polygon points="${points}"/>`).join('')}</g>`;
}
