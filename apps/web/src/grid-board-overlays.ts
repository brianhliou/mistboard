// Annotation overlay layers for the cell-grid SVG boards (chess family,
// jungle).
//
// The grid core draws pieces, highlights and targets; user-drawn arrows and
// circles ride ABOVE all of that, so they are appended inside each variant's
// renderPieces rather than handed to the core. Geometry comes from the caller's
// own coordOf, which is the only thing that differs between these boards.

import type { GridGeometry } from '@mistboard/board-render';
import { type SvgBoardArrowStyle, svgBoardArrow } from './svg-board-arrow.js';
import { type SvgBoardMarkerStyle, svgBoardCircleMarker } from './svg-board-marker.js';

export interface GridBoardArrow<S extends string = string> extends SvgBoardArrowStyle {
  from: S;
  to: S;
}

export interface GridBoardMarker<S extends string = string> extends SvgBoardMarkerStyle {
  square: S;
  kind: 'circle';
}

/** Mixed into each variant's render options, parameterised by that board's own
 *  square type so an annotation cannot name a square the board does not have. */
export type GridBoardOverlayOptions<S extends string = string> = {
  arrows?: readonly GridBoardArrow<S>[];
  markers?: readonly GridBoardMarker<S>[];
};

/** The two overlay groups, markers under arrows so an arrow stays readable when
 *  it crosses a circled square. Returns '' when nothing is drawn, so a board
 *  with no annotations emits no extra nodes. */
export function gridBoardOverlays<S extends string>(
  geom: GridGeometry,
  coordOf: (square: S) => { file: number; rank: number },
  options: GridBoardOverlayOptions<S>,
): string {
  const arrows = options.arrows ?? [];
  const markers = options.markers ?? [];
  if (arrows.length === 0 && markers.length === 0) return '';
  const center = (square: S) => {
    const { file, rank } = coordOf(square);
    return geom.center(file, rank);
  };
  const markerSvg = markers
    .map((marker) =>
      svgBoardCircleMarker(marker, center(marker.square), geom.cell * 0.42, {
        baseClassName: 'xq-marker engine-marker',
      }),
    )
    .join('');
  const arrowSvg = arrows
    .map((arrow) =>
      svgBoardArrow(arrow, center(arrow.from), center(arrow.to), {
        baseClassName: 'xq-arrow',
        defaultWidth: geom.cell * 0.13,
        startInset: geom.cell * 0.17,
      }),
    )
    .join('');
  return (
    `<g class="xq-live-markers" aria-hidden="true" pointer-events="none">${markerSvg}</g>` +
    `<g class="xq-live-arrows" aria-hidden="true" pointer-events="none">${arrowSvg}</g>`
  );
}
