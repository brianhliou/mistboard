import type { XiangqiBoardLayout } from './xiangqi-appearance-storage.js';

/** Flat capture marks only; raised pieces keep their face and side tints. */
export function captureTargetSvg(
  className: string,
  center: { x: number; y: number },
  cell: number,
  layout: XiangqiBoardLayout,
  ringRadius: number,
): string {
  const { x, y } = center;
  if (layout === 'intersection') {
    return `<circle class="${className}" cx="${x}" cy="${y}" r="${ringRadius}"/>`;
  }
  const paint =
    'fill: var(--board-move-hint, rgba(31, 111, 91, 0.72)); stroke: none; pointer-events: none;';
  const left = x - cell / 2;
  const top = y - cell / 2;
  return `<rect class="${className}-fill" x="${left}" y="${top}" width="${cell}" height="${cell}" style="${paint} opacity: 0.36;"/>`;
}

/** The selected piece's mark: the whole cell on a square grid, a disc on points. */
export function selectionMarkSvg(
  className: string,
  center: { x: number; y: number },
  cell: number,
  layout: XiangqiBoardLayout,
  radius: number,
): string {
  const { x, y } = center;
  if (layout === 'cell') {
    return `<rect class="${className}" x="${x - cell / 2}" y="${y - cell / 2}" width="${cell}" height="${cell}"/>`;
  }
  return `<circle class="${className}" cx="${x}" cy="${y}" r="${radius}"/>`;
}
