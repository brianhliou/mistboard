import { boardCornerRadius } from './board-metrics.js';
// Generic descriptor-driven renderer for cell-based ("checkered square") boards.
//
// This is the Layer-2 platform down-payment: chess (8x8) and a river board (6x8 +
// river) are the same board MODEL — pieces sit on squares, squares alternate
// light/dark — differing only in data (dimensions, an optional river strip,
// palette, and how a piece glyph is drawn). This core owns the model: geometry
// (orientation flip + strip offset), the board furniture (grid, strip, coords,
// clip), and the generic interaction layers (last-move, selection,
// targets, fog, hit). A variant supplies a GridBoardDescriptor + a renderPieces
// callback and gets a byte-stable SVG string back.
// Decorative perimeter frames are intentionally not part of the descriptor API:
// every Mistboard board surface ends at its playable background without an
// additional outer outline.
//
// Intersection-based boards (xiangqi family: pieces on grid NODES, palace
// furniture, mask fog) are a DIFFERENT model and intentionally out of scope —
// a future `placement: 'cell' | 'intersection'` axis, not forced through here.

export type GridStrip = {
  // The strip sits below this many display rows from the top edge (i.e. at the
  // geometric middle), shifting every row at or past it down by `height`.
  afterRow: number;
  height: number;
  fill: string;
  // Optional thin highlight line along the strip's top edge.
  highlightFill?: string;
};

export type GridPalette = {
  lightCell: string;
  darkCell: string;
  coord: string;
  lastMove: string;
  selected: string;
  targetDot: string;
  targetRing: string;
  targetHover?: string;
  fog: string;
  // Colour for annotation arrows. Optional; defaults to a muted green.
  arrow?: string;
  // Fill for "threat" squares (candidate checking squares), drawn OVER
  // the fog so it reads on hidden squares. Optional; defaults to a muted red.
  threat?: string;
};

export type GridBoardDescriptor = {
  files: number;
  ranks: number;
  cell: number;
  strips?: readonly GridStrip[];
  palette: GridPalette;
  // Layout knobs.
  pad?: number;
  boardRadius?: number;
  // Square-colour polarity: when true (the default), (file+rank) even is dark.
  darkWhenEven?: boolean;
  // Coordinate glyphs. Defaults: files -> a,b,c…; ranks -> their number.
  fileLabel?: (file: number) => string;
  svgClass?: string;
};

// file is 0-based (a=0); rank is 1-based to match algebraic squares.
export type GridCellRef = { file: number; rank: number };
export type GridTargetRef = GridCellRef & { occupied: boolean };
export type GridArrowRef = { from: GridCellRef; to: GridCellRef };

export interface GridGeometry {
  cell: number;
  topLeft(file: number, rank: number): { x: number; y: number };
  center(file: number, rank: number): { x: number; y: number };
}

export type GridBoardLayers = {
  // Unique id for this board's <defs> (clip path), so multiple boards on one
  // page don't collide.
  id: string;
  // false: rank 1 at the bottom, file a on the left. true: 180° rotation.
  flip: boolean;
  // The variant draws its pieces here using the supplied geometry.
  renderPieces: (geometry: GridGeometry) => string;
  // Variant-specific <defs> body (gradients etc.), appended after the clip def.
  extraDefs?: string;
  lastMove?: readonly GridCellRef[] | null;
  selected?: GridCellRef | null;
  // Squares to fill with the selection colour (study/diagram emphasis). Like
  // `selected`, but a list; drawn under the pieces. Omit / null for none.
  highlights?: readonly GridCellRef[] | null;
  targets?: readonly GridTargetRef[];
  // Annotation arrows drawn over the board (analysis / didactic). Omit for none.
  arrows?: readonly GridArrowRef[] | null;
  // Squares to fog (hidden). Omit / null to draw no fog overlay.
  fogHidden?: readonly GridCellRef[] | null;
  // Squares to mark as a threat, drawn OVER the fog (so it shows on hidden
  // squares), e.g. the squares a checking piece could occupy. Omit / null for
  // none.
  threats?: readonly GridCellRef[] | null;
  // Names the hit-layer rects (data-square="…") so a host can delegate clicks.
  squareName?: (file: number, rank: number) => string;
  interactive?: boolean;
  // Draw the file/rank coordinate labels. Defaults to true; set false for clean
  // teaching diagrams (rules pages).
  coords?: boolean;
};

const DEFAULT_FILE_LABEL = (file: number): string => String.fromCharCode(97 + file);
export const GRID_INTERACTION_COLORS = {
  selected: 'rgba(31,111,91,0.32)',
  targetDot: 'rgba(31,111,91,0.72)',
  targetRing: 'rgba(31,111,91,0.48)',
  targetHover: 'rgba(31,111,91,0.30)',
} as const;

function layout(descriptor: GridBoardDescriptor) {
  const { files, ranks, cell } = descriptor;
  const stripTotal = (descriptor.strips ?? []).reduce((sum, s) => sum + s.height, 0);
  const boardW = files * cell;
  const boardH = ranks * cell + stripTotal;
  const pad = descriptor.pad ?? 6;
  return { boardW, boardH, pad };
}

// Total strip shift applied to a display row (sum of every strip it sits past).
function stripOffsetForRow(strips: readonly GridStrip[], row: number): number {
  let offset = 0;
  for (const strip of strips) if (row >= strip.afterRow) offset += strip.height;
  return offset;
}

export function createGridGeometry(descriptor: GridBoardDescriptor, flip: boolean): GridGeometry {
  const { files, ranks, cell } = descriptor;
  const strips = descriptor.strips ?? [];
  const fileToCol = (file: number): number => (flip ? files - 1 - file : file);
  const rankToRow = (rank: number): number => (flip ? rank - 1 : ranks - rank);
  const topLeft = (file: number, rank: number) => {
    const row = rankToRow(rank);
    return { x: fileToCol(file) * cell, y: row * cell + stripOffsetForRow(strips, row) };
  };
  return {
    cell,
    topLeft,
    center: (file, rank) => {
      const { x, y } = topLeft(file, rank);
      return { x: x + cell / 2, y: y + cell / 2 };
    },
  };
}

export function renderGridBoardSvg(
  descriptor: GridBoardDescriptor,
  layers: GridBoardLayers,
): string {
  const { files, ranks, cell, palette } = descriptor;
  const darkWhenEven = descriptor.darkWhenEven ?? true;
  const fileLabel = descriptor.fileLabel ?? DEFAULT_FILE_LABEL;
  const strips = descriptor.strips ?? [];
  const { boardW, boardH, pad } = layout(descriptor);
  const geom = createGridGeometry(descriptor, layers.flip);
  const id = layers.id;
  // Default off the shared ratio rather than a magic 5, so a descriptor that says nothing
  // rounds like every other board at its own width.
  const boardRadius = descriptor.boardRadius ?? boardCornerRadius(boardW);

  // ── Furniture + interaction layers ──────────────

  const gridLayer = (): string => {
    const parts: string[] = [];
    for (let file = 0; file < files; file += 1) {
      for (let rank = 1; rank <= ranks; rank += 1) {
        const { x, y } = geom.topLeft(file, rank);
        const even = (file + rank) % 2 === 0;
        const fill = (darkWhenEven ? even : !even) ? palette.darkCell : palette.lightCell;
        parts.push(`<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="${fill}"/>`);
      }
    }
    return parts.join('');
  };

  const stripLayer = (): string =>
    strips
      .map((strip) => {
        const y = strip.afterRow * cell + stripOffsetForRow(strips, strip.afterRow - 1);
        const band = `<rect x="0" y="${y}" width="${boardW}" height="${strip.height}" fill="${strip.fill}"/>`;
        const line = strip.highlightFill
          ? `<rect x="0" y="${y}" width="${boardW}" height="1" fill="${strip.highlightFill}"/>`
          : '';
        return band + line;
      })
      .join('');

  const cellRect = (ref: GridCellRef, fill: string): string => {
    const { x, y } = geom.topLeft(ref.file, ref.rank);
    return `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="${fill}"/>`;
  };

  const lastMoveLayer = (): string =>
    (layers.lastMove ?? []).map((ref) => cellRect(ref, palette.lastMove)).join('');

  const selectionLayer = (): string =>
    layers.selected ? cellRect(layers.selected, palette.selected) : '';

  const highlightLayer = (): string =>
    (layers.highlights ?? []).map((ref) => cellRect(ref, palette.selected)).join('');

  const coordsLayer = (): string => {
    const parts: string[] = [];
    const bottomRank = layers.flip ? ranks : 1;
    for (let file = 0; file < files; file += 1) {
      const { x, y } = geom.topLeft(file, bottomRank);
      parts.push(
        `<text x="${x + cell - 4}" y="${y + cell - 4}" font-size="9" fill="${palette.coord}" text-anchor="end">${fileLabel(file)}</text>`,
      );
    }
    const leftFile = layers.flip ? files - 1 : 0;
    for (let rank = 1; rank <= ranks; rank += 1) {
      const { x, y } = geom.topLeft(leftFile, rank);
      parts.push(
        `<text x="${x + 3}" y="${y + 11}" font-size="9" fill="${palette.coord}">${rank}</text>`,
      );
    }
    return parts.join('');
  };

  const targetLayer = (): string =>
    layers.interactive
      ? ''
      : (layers.targets ?? [])
          .map((ref) => {
            const { x, y } = geom.center(ref.file, ref.rank);
            if (ref.occupied) {
              return `<circle class="mb-grid-target-ring" cx="${x}" cy="${y}" r="${cell * 0.43}" fill="none" stroke="${palette.targetRing}" stroke-width="3.5" pointer-events="none"/>`;
            }
            return `<circle class="mb-grid-target-dot" cx="${x}" cy="${y}" r="${cell * 0.15}" fill="${palette.targetDot}" pointer-events="none"/>`;
          })
          .join('');

  const fogLayer = (): string =>
    (layers.fogHidden ?? []).map((ref) => cellRect(ref, palette.fog)).join('');

  const threatColor = palette.threat ?? 'rgba(200,48,48,0.34)';
  const threatLayer = (): string =>
    (layers.threats ?? []).map((ref) => cellRect(ref, threatColor)).join('');

  const arrowColor = palette.arrow ?? '#2f7d2f';
  const arrows = layers.arrows ?? [];
  const arrowMarkerDef =
    arrows.length > 0
      ? `<marker id="${id}-arrow" markerWidth="4" markerHeight="4" refX="2.05" refY="2" orient="auto" markerUnits="strokeWidth"><path d="M0,0 V4 L3,2 Z" fill="${arrowColor}"/></marker>`
      : '';
  const arrowLayer = (): string =>
    arrows
      .map((arrow) => {
        const a = geom.center(arrow.from.file, arrow.from.rank);
        const b = geom.center(arrow.to.file, arrow.to.rank);
        return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${arrowColor}" stroke-width="5" stroke-linecap="round" opacity="0.55" marker-end="url(#${id}-arrow)"/>`;
      })
      .join('');

  const hitLayer = (): string => {
    const name = layers.squareName ?? ((f, r) => `${fileLabel(f)}${r}`);
    const targetByCell = new Map<string, GridTargetRef>();
    for (const ref of layers.targets ?? []) targetByCell.set(`${ref.file}:${ref.rank}`, ref);
    const parts: string[] = [];
    for (let file = 0; file < files; file += 1) {
      for (let rank = 1; rank <= ranks; rank += 1) {
        const { x, y } = geom.topLeft(file, rank);
        const target = targetByCell.get(`${file}:${rank}`);
        const center = geom.center(file, rank);
        const targetMarker = target
          ? target.occupied
            ? `<circle class="mb-grid-target-ring" cx="${center.x}" cy="${center.y}" r="${cell * 0.43}" fill="none" stroke="${palette.targetRing}" stroke-width="3.5" pointer-events="none"/>`
            : `<circle class="mb-grid-target-dot" cx="${center.x}" cy="${center.y}" r="${cell * 0.15}" fill="${palette.targetDot}" pointer-events="none"/>`
          : '';
        const hover = target
          ? `<rect class="mb-grid-target-hover" x="${x}" y="${y}" width="${cell}" height="${cell}" fill="${palette.targetHover ?? GRID_INTERACTION_COLORS.targetHover}" pointer-events="none"/>`
          : '';
        parts.push(
          `<g class="mb-grid-hit${target ? ' mb-grid-hit--target' : ''}" data-square="${name(file, rank)}">${hover}${targetMarker}<rect class="mb-grid-hit-zone" x="${x}" y="${y}" width="${cell}" height="${cell}"/></g>`,
        );
      }
    }
    return parts.join('');
  };

  const clipDef = `<clipPath id="${id}-clip"><rect x="0" y="0" width="${boardW}" height="${boardH}" rx="${boardRadius}"/></clipPath>`;
  const clipped = [
    gridLayer(),
    stripLayer(),
    lastMoveLayer(),
    selectionLayer(),
    highlightLayer(),
    layers.coords === false ? '' : coordsLayer(),
    layers.renderPieces(geom),
    targetLayer(),
    fogLayer(),
    // Threat squares ride OVER the fog — the checker is on a hidden square, so
    // the mark must show through the shroud.
    threatLayer(),
    layers.interactive ? hitLayer() : '',
  ].join('');

  return [
    // data-board="grid" (kept at the tag's end so callers that regex on the
    // leading `class="…" viewBox="…"` — still
    // match) lets one CSS rule round every grid board to the shared corner token.
    `<svg${descriptor.svgClass ? ` class="${descriptor.svgClass}"` : ''} viewBox="0 0 ${boardW + pad * 2} ${boardH + pad * 2}" role="img" xmlns="http://www.w3.org/2000/svg" data-board="grid">`,
    `<defs>${clipDef}${arrowMarkerDef}${layers.extraDefs ?? ''}</defs>`,
    `<g transform="translate(${pad} ${pad})">`,
    `<g clip-path="url(#${id}-clip)">${clipped}</g>`,
    // Arrows ride over the board as an analysis overlay.
    arrowLayer(),
    `</g></svg>`,
  ].join('');
}
