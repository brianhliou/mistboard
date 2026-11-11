// The homepage News box marks each row with a small sticker drawing, one per
// announcement kind, in the house sticker style of the broadcast card's TV
// (landing-event-banners.ts, BROADCAST_ART) and the Dobutsu piece set it was
// drawn after: flat fills from one five-colour palette, one uniform near-black
// outline with round joins, a few chunky parts, no gradients, no faces.
//
// Redrawn 2026-10-27 (#711). The marks before this were filled ink glyphs on a
// cream disc (a document, a red four-point spark, a wrench, a horn); next to
// the TV they read as blurry and rough. These are vector, so they stay crisp
// at every pixel ratio, where the TV needs @2x/@3x rasters.
//
// Drawn in a 100-unit box for a 36px slot, so one unit is about 0.36px: the
// 4.5-unit outline renders near 1.6px, the TV's weight at its 44px size, and
// nothing that has to read (a text line, a tooth, a sound dash) is thinner
// than 5 units. Each drawing is centred on x = 50, where the timeline's rail
// runs, so the rail meets it top and bottom.
//
// Dark mode: as with the TV, the navy parts and the black outline sink into
// the dark panel, so each drawing carries a cream sticker border behind it
// (the halo group) that only the dark theme shows (landing-announcements.css).

import type { AnnouncementKind } from './announcements.js';

export type NewsDiscMark = 'page' | 'sparkle' | 'gear' | 'megaphone';

// The TV's palette (scratchpad style sheet of 2026-10-26, sampled back from
// the shipped art): outline, tomato red, slate navy, cream, warm gold.
const INK = '#1a1a1a';
const RED = '#e22b13';
const NAVY = '#3a5a7a';
const CREAM = '#f3e9c4';
const GOLD = '#e8a23a';

// Outline width, and the dark-theme halo's reach past the outline (1.25px at
// the slot, the TV's halo width).
const OUTLINE = 4.5;
const HALO = 3.5;

export function newsDiscMarkForKind(kind: AnnouncementKind): NewsDiscMark {
  switch (kind) {
    case 'release':
      return 'sparkle';
    case 'article':
      return 'page';
    case 'update':
      return 'gear';
    case 'status':
      return 'megaphone';
  }
}

type Drawing = {
  // The outer silhouette, unpainted: painted once as the dark-theme halo.
  silhouette: string;
  // How far the drawing's outline reaches past the silhouette's edge.
  outlineReach: number;
  art: string;
};

const stroke = `stroke="${INK}" stroke-width="${OUTLINE}" stroke-linejoin="round" stroke-linecap="round"`;

// A sheet of paper with a folded corner: a red title bar over three navy
// lines of text.
const PAGE_SHEET =
  'M26 9 H62 L78 25 V87 A4 4 0 0 1 74 91 H26 A4 4 0 0 1 22 87 V13 A4 4 0 0 1 26 9 Z';
const page: Drawing = {
  silhouette: `<path d="${PAGE_SHEET}"/>`,
  outlineReach: OUTLINE / 2,
  art:
    `<path d="${PAGE_SHEET}" fill="${CREAM}" ${stroke}/>` +
    `<path d="M62 9 V21 A4 4 0 0 0 66 25 H78" fill="none" ${stroke}/>` +
    `<rect x="31" y="32" width="26" height="9" rx="4.5" fill="${RED}"/>` +
    `<rect x="31" y="48" width="38" height="7" rx="3.5" fill="${NAVY}"/>` +
    `<rect x="31" y="61" width="38" height="7" rx="3.5" fill="${NAVY}"/>` +
    `<rect x="31" y="74" width="24" height="7" rx="3.5" fill="${NAVY}"/>`,
};

// Something new: one red four-point star with a small gold companion and a
// gold dot.
function star(cx: number, cy: number, r: number, waist: number): string {
  const w = waist;
  return (
    `M${cx} ${cy - r} Q${cx + w} ${cy - w} ${cx + r} ${cy} Q${cx + w} ${cy + w} ${cx} ${cy + r} ` +
    `Q${cx - w} ${cy + w} ${cx - r} ${cy} Q${cx - w} ${cy - w} ${cx} ${cy - r} Z`
  );
}
const SPARKLE_MAIN = star(50, 55, 36, 9);
const SPARKLE_SMALL = star(80, 20, 13, 3.5);
const sparkle: Drawing = {
  silhouette: `<path d="${SPARKLE_MAIN}"/><path d="${SPARKLE_SMALL}"/><circle cx="20" cy="22" r="5.5"/>`,
  outlineReach: OUTLINE / 2,
  art:
    `<path d="${SPARKLE_MAIN}" fill="${RED}" ${stroke}/>` +
    `<path d="${SPARKLE_SMALL}" fill="${GOLD}" ${stroke}/>` +
    `<circle cx="20" cy="22" r="5.5" fill="${GOLD}" ${stroke}/>`,
};

// A change to something that exists: a navy cog with a cream hub. The body
// is a disc plus eight teeth, so it is outlined as one union: a double-width
// outline under an unstroked fill leaves only the outer half showing.
const GEAR_BODY =
  `<circle cx="50" cy="50" r="30"/>` +
  Array.from(
    { length: 8 },
    (_, i) =>
      `<rect x="42.5" y="9" width="15" height="22" rx="3.5" transform="rotate(${i * 45} 50 50)"/>`,
  ).join('');
const gear: Drawing = {
  silhouette: GEAR_BODY,
  outlineReach: OUTLINE,
  art:
    `<g fill="${INK}" stroke="${INK}" stroke-width="${OUTLINE * 2}" stroke-linejoin="round">${GEAR_BODY}</g>` +
    `<g fill="${NAVY}">${GEAR_BODY}</g>` +
    `<circle cx="50" cy="50" r="12" fill="${CREAM}" ${stroke}/>`,
};

// A notice: the Dobutsu sheet's megaphone, red cone, navy cap and handle,
// cream mouth, three gold sound dashes. The handle hangs on x = 50 so the
// rail runs into it.
const MEGA_HANDLE = '<rect x="43.5" y="58" width="14" height="29" rx="6.5"/>';
const MEGA_CAP = '<rect x="7" y="37" width="19" height="30" rx="9"/>';
const MEGA_CONE = '<path d="M22 41 L66 20 Q71 18 71 24 V80 Q71 86 66 83 L22 63 Z"/>';
const MEGA_MOUTH = '<ellipse cx="71" cy="52" rx="9" ry="31"/>';
function paint(shape: string, attrs: string): string {
  return shape.replace(/\/>$/, ` ${attrs}/>`);
}
const megaphone: Drawing = {
  silhouette: MEGA_HANDLE + MEGA_CAP + MEGA_CONE + MEGA_MOUTH,
  outlineReach: OUTLINE / 2,
  art:
    paint(MEGA_HANDLE, `fill="${NAVY}" ${stroke}`) +
    paint(MEGA_CAP, `fill="${NAVY}" ${stroke}`) +
    paint(MEGA_CONE, `fill="${RED}" ${stroke}`) +
    paint(MEGA_MOUTH, `fill="${CREAM}" ${stroke}`) +
    `<g stroke="${GOLD}" stroke-width="5.5" stroke-linecap="round">` +
    `<path d="M87 29 L93 23"/><path d="M89 52 H96"/><path d="M87 75 L93 81"/></g>`,
};

// The timeline's terminal, the row that leads to the full archive on /feed:
// a cream button with three dots.
const MORE_BUTTON = '<circle cx="50" cy="50" r="33"/>';
const more: Drawing = {
  silhouette: MORE_BUTTON,
  outlineReach: OUTLINE / 2,
  art:
    paint(MORE_BUTTON, `fill="${CREAM}" ${stroke}`) +
    `<g fill="${INK}"><circle cx="34" cy="50" r="6"/><circle cx="50" cy="50" r="6"/><circle cx="66" cy="50" r="6"/></g>`,
};

const DRAWINGS: Record<NewsDiscMark | 'more', Drawing> = { page, sparkle, gear, megaphone, more };

function drawingContents(mark: NewsDiscMark | 'more'): string {
  const { silhouette, outlineReach, art } = DRAWINGS[mark];
  const haloWidth = 2 * (outlineReach + HALO);
  return (
    `<g class="landing-news-disc-halo" fill="${CREAM}" stroke="${CREAM}" stroke-width="${haloWidth}" stroke-linejoin="round">${silhouette}</g>` +
    art
  );
}

function discAttributes(mark: NewsDiscMark | 'more'): Record<string, string> {
  return {
    class: `landing-news-disc landing-news-disc-${mark}`,
    viewBox: '0 0 100 100',
    'aria-hidden': 'true',
    focusable: 'false',
    'data-mark': mark,
  };
}

function discSvg(mark: NewsDiscMark | 'more'): string {
  const attrs = Object.entries(discAttributes(mark))
    .map(([name, value]) => `${name}="${value}"`)
    .join(' ');
  return `<svg ${attrs}>${drawingContents(mark)}</svg>`;
}

export function newsDiscSvg(kind: AnnouncementKind): string {
  return discSvg(newsDiscMarkForKind(kind));
}

export function newsMoreDiscSvg(): string {
  return discSvg('more');
}

function buildDisc(mark: NewsDiscMark | 'more'): SVGSVGElement {
  // Create the root in the SVG namespace directly. Parsing an HTML template
  // then checking its constructor made a decorative icon abort the entire
  // homepage in two Chrome sessions. No constructor identity check is needed.
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [name, value] of Object.entries(discAttributes(mark))) svg.setAttribute(name, value);
  // All children are constant authored shapes, with no user input.
  svg.innerHTML = drawingContents(mark);
  return svg;
}

export function buildNewsDisc(kind: AnnouncementKind): SVGSVGElement {
  return buildDisc(newsDiscMarkForKind(kind));
}

export function buildNewsMoreDisc(): SVGSVGElement {
  return buildDisc('more');
}
