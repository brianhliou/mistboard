// Shared Fog of War overlay for every xiangqi board (Dark Mini 7x7, full 9x10,
// and the dev spike). Unlike chess — which paints fog per square via CSS tiles —
// xiangqi fog is ONE masked SVG region. So each fog skin reduces to a flat tint
// (--xq-fog-fill) plus an optional texture layer, mapped to the same global
// assets chess uses:
//   - drift:    fog.webp tiled ONE PER SQUARE via a <pattern> at cell size, not
//               stretched, so it reads like the chess drift overlay.
//   - mistveil: the reassembled full mistveil.webp laid across the region once
//               (the 64 chess tiles restitched by scripts/assemble-fog.py).
// CSS in app-base.css (.xq-fog-tex visibility + --xq-fog-fill) shows at most one
// texture per skin and toggles live on data-fog-theme; flat skins keep the tint.

export type XiangqiFogGeometry = {
  /** Top-left of the fogged region; the square grid starts half a cell in. */
  x?: number;
  y?: number;
  width: number;
  height: number;
  cell: number;
  margin: number;
  /** Corner radius of the board, applied to the mask so every layer clips to it. */
  rx: number;
};

// Builds the full fog region: the inverse mask (white board minus the visible
// cutouts), the per-square drift pattern, and the tint + texture layers grouped
// under that mask. Callers pass a unique maskId (multiple boards can share a
// document) and the pre-built black cutout rects for their visible squares.
export function xiangqiFogRegion(
  geo: XiangqiFogGeometry,
  maskId: string,
  tintClass: string,
  cutouts: string,
): string {
  // Cutouts are CELL-sized boxes centered on intersections, so offsetting the
  // tile origin half a cell before the first intersection drops exactly one
  // smoke tile into each fog square.
  const off = geo.margin - geo.cell / 2;
  const x = geo.x ?? 0;
  const y = geo.y ?? 0;
  // Drift is a <foreignObject> HTML div rather than an SVG <image>: an animated
  // WebP only animates as a CSS background, not inside an SVG <image> (which
  // freezes on the first frame). background-size + repeat keeps the one-tile-per-
  // square look; the same mask clips it to the fog region. A failed mask on some
  // browser is only cosmetic — hidden pieces are omitted from the view entirely,
  // so the drift layer never leaks information.
  const driftStyle = [
    'width:100%',
    'height:100%',
    "background-image:url('/fog/fog.webp')",
    'background-repeat:repeat',
    `background-size:${geo.cell}px ${geo.cell}px`,
    `background-position:${off - x}px ${off - y}px`,
  ].join(';');
  return `
    <defs>
      <mask id="${maskId}">
        <rect x="${x}" y="${y}" width="${geo.width}" height="${geo.height}" rx="${geo.rx}" fill="white"/>
        ${cutouts}
      </mask>
    </defs>
    <g mask="url(#${maskId})">
      <rect class="${tintClass}" x="${x}" y="${y}" width="${geo.width}" height="${geo.height}"/>
      <foreignObject class="xq-fog-tex xq-fog-tex-drift" x="${x}" y="${y}" width="${geo.width}" height="${geo.height}" mask="url(#${maskId})">
        <div xmlns="http://www.w3.org/1999/xhtml" style="${driftStyle}"></div>
      </foreignObject>
      <image class="xq-fog-tex xq-fog-tex-mist" href="/fog/mistveil.webp" x="${x}" y="${y}" width="${geo.width}" height="${geo.height}" preserveAspectRatio="xMidYMid slice"/>
    </g>
  `;
}
