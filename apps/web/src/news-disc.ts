// The homepage News box marks each row with a xiangqi-style disc: the
// international piece set's cream disc and its one dark ring (xiangqi-piece-sets.ts,
// INTERNATIONAL_RING_STROKE; both sides share it since the piece look of
// 2026-10-14) carrying a filled ink mark instead of a character.
//
// The marks are a house set drawn for a 36px disc, in the same 100-unit box
// the piece art uses: filled silhouettes, no strokes thinner than 4 units, so
// they still read once the box halves them. Line icons at this size are what
// the box shipped with before, and they read as a ring with a smudge in it.
//
// One mark per kind, and the ink alternates so a run of releases does not
// read as one long red column: red for things to use (release, update),
// black for things to read (article, status). Remapped 2026-09-20: the horn
// (a notice) moved from release to status, the spark (something new) took
// release, update got a wrench (a change to something that exists), and the
// lantern went: at 36px it read as a plug, and nothing about a lantern says
// "status".

import type { AnnouncementKind } from './announcements.js';

export type NewsDiscMark = 'horn' | 'scroll' | 'spark' | 'wrench';
export type NewsDiscInk = 'red' | 'black';

// Same hexes as the international set's disc and ring, so a marker beside a
// board on the homepage is visibly the same object. The ring is dark on every
// disc, as on the pieces; the ink colours only the mark inside it.
const CREAM = '#fef0d7';
const RING = '#202427';
const INK: Record<NewsDiscInk, string> = { red: '#c30d0d', black: '#202427' };

export function newsDiscMarkForKind(kind: AnnouncementKind): NewsDiscMark {
  switch (kind) {
    case 'release':
      return 'spark';
    case 'article':
      return 'scroll';
    case 'update':
      return 'wrench';
    case 'status':
      return 'horn';
  }
}

export function newsDiscInkForKind(kind: AnnouncementKind): NewsDiscInk {
  switch (kind) {
    case 'release':
    case 'update':
      return 'red';
    case 'article':
    case 'status':
      return 'black';
  }
}

const MARKS: Record<NewsDiscMark, (ink: string) => string> = {
  // A horn: flared bell, mouthpiece, and two sound arcs.
  horn: (ink) =>
    `<path d="M30 42 L58 30 L58 70 L30 58 Z" fill="${ink}"/>` +
    `<rect x="22" y="43" width="9" height="14" rx="2.5" fill="${ink}"/>` +
    `<rect x="34" y="57" width="10" height="14" rx="2" fill="${ink}"/>` +
    `<path d="M64 38 A16 16 0 0 1 64 62" fill="none" stroke="${ink}" stroke-width="5" stroke-linecap="round"/>` +
    `<path d="M72 31 A26 26 0 0 1 72 69" fill="none" stroke="${ink}" stroke-width="4" stroke-linecap="round"/>`,
  // A scroll: rolled edge on the left, three lines of text cut out.
  scroll: (ink) =>
    `<rect x="28" y="26" width="44" height="48" rx="5" fill="${ink}"/>` +
    `<rect x="24" y="26" width="10" height="48" rx="5" fill="${ink}"/>` +
    `<rect x="42" y="38" width="22" height="5" rx="2.5" fill="${CREAM}"/>` +
    `<rect x="42" y="49" width="22" height="5" rx="2.5" fill="${CREAM}"/>` +
    `<rect x="42" y="60" width="14" height="5" rx="2.5" fill="${CREAM}"/>`,
  // A spark: one four-point star and a smaller companion.
  spark: (ink) =>
    `<path d="M46 22 C48 40 52 44 70 46 C52 48 48 52 46 70 C44 52 40 48 22 46 C40 44 44 40 46 22 Z" fill="${ink}"/>` +
    `<path d="M70 60 C71 66 72 67 78 68 C72 69 71 70 70 76 C69 70 68 69 62 68 C68 67 69 66 70 60 Z" fill="${ink}"/>`,
  // A wrench, diagonal: an open jaw at the top right (a round head with a
  // cream notch cut out of it) and a straight handle to the bottom left, drawn
  // as one rotated group so the silhouette stays a single filled shape.
  wrench: (ink) =>
    `<g transform="rotate(45 50 50)">` +
    `<circle cx="50" cy="30" r="15" fill="${ink}"/>` +
    `<rect x="45" y="12" width="10" height="20" fill="${CREAM}"/>` +
    `<rect x="42" y="38" width="16" height="42" rx="6" fill="${ink}"/>` +
    `</g>`,
};

function discBackground(): string {
  return `<circle cx="50" cy="50" r="46" fill="${CREAM}" stroke="${RING}" stroke-width="2.8"/>`;
}

function discContents(kind: AnnouncementKind): string {
  const mark = newsDiscMarkForKind(kind);
  const ink = INK[newsDiscInkForKind(kind)];
  return discBackground() + MARKS[mark](ink);
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

function discSvg(mark: NewsDiscMark | 'more', contents: string): string {
  const attrs = Object.entries(discAttributes(mark))
    .map(([name, value]) => `${name}="${value}"`)
    .join(' ');
  return `<svg ${attrs}>${contents}</svg>`;
}

export function newsDiscSvg(kind: AnnouncementKind): string {
  return discSvg(newsDiscMarkForKind(kind), discContents(kind));
}

// The timeline's terminal disc: three dots in black ink, the row that leads
// to the full archive on /feed.
function moreDiscContents(): string {
  const ink = INK.black;
  return (
    discBackground() +
    `<circle cx="30" cy="50" r="6.5" fill="${ink}"/><circle cx="50" cy="50" r="6.5" fill="${ink}"/><circle cx="70" cy="50" r="6.5" fill="${ink}"/>`
  );
}

export function newsMoreDiscSvg(): string {
  return discSvg('more', moreDiscContents());
}

function buildDisc(mark: NewsDiscMark | 'more', contents: string): SVGSVGElement {
  // Create the root in the SVG namespace directly. Parsing an HTML template
  // then checking its constructor made a decorative icon abort the entire
  // homepage in two Chrome sessions. No constructor identity check is needed.
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [name, value] of Object.entries(discAttributes(mark))) svg.setAttribute(name, value);
  // All children are constant authored shapes, with no user input.
  svg.innerHTML = contents;
  return svg;
}

export function buildNewsDisc(kind: AnnouncementKind): SVGSVGElement {
  return buildDisc(newsDiscMarkForKind(kind), discContents(kind));
}

export function buildNewsMoreDisc(): SVGSVGElement {
  return buildDisc('more', moreDiscContents());
}
