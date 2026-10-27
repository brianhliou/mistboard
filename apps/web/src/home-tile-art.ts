// The phone homepage's six shortcut tiles (landing-phone.ts) each carry a
// small sticker drawing in the house style of the broadcast card's TV
// (landing-event-banners.ts, BROADCAST_ART) and the News marks (news-disc.ts):
// flat fills from one five-colour palette, one uniform near-black outline
// with round joins, a few chunky parts, no gradients, no faces.
//
// Drawn 2026-10-27. The tiles before this carried thin green Lucide line
// glyphs (puzzle, open book, bookmark book, scan, chat, TV); next to the TV
// sticker they read as a different site.
//
// Drawn in a 100-unit box for a 52px slot (landing.css; the TV's own slot on
// the broadcast card is 44px), so one unit is 0.52px: the 4.5-unit outline
// renders near 2.3px, and nothing that has to read is thinner than 4.5 units.
//
// Watch is binoculars, not the TV: the TV stays the broadcast card's mark
// (real-world tournaments, /broadcast/xiangqi/…), while the Watch tile opens
// Mistboard TV (/watch, games on this site). Two places, so two silhouettes
// (Brian, 2026-10-27: the TV tile "is very similar to the broadcast icon").
//
// Dark mode: as with the TV, the navy parts and the black outline sink into
// the dark panel, so each drawing carries a cream sticker border behind it
// (the halo group) that only the dark theme shows (landing.css).

export type HomeTileArt = 'puzzles' | 'rules' | 'study' | 'analysis' | 'forum' | 'watch';

export const HOME_TILE_ARTS: readonly HomeTileArt[] = [
  'puzzles',
  'rules',
  'study',
  'analysis',
  'forum',
  'watch',
];

// The TV's palette: outline, tomato red, slate navy, cream, warm gold.
const INK = '#1a1a1a';
const RED = '#e22b13';
const NAVY = '#3a5a7a';
const CREAM = '#f3e9c4';
const GOLD = '#e8a23a';

// Outline width, and the dark-theme halo's reach past the outline (about
// 1.5px at the slot, the TV's halo width).
const OUTLINE = 4.5;
const HALO = 3.5;

type Drawing = {
  // The outer silhouette, unpainted: painted once as the dark-theme halo.
  silhouette: string;
  art: string;
};

const stroke = `stroke="${INK}" stroke-width="${OUTLINE}" stroke-linejoin="round" stroke-linecap="round"`;

function paint(shape: string, attrs: string): string {
  return shape.replace(/\/>$/, ` ${attrs}/>`);
}

// Puzzles: one red jigsaw piece, knobs up and right, a notch in the bottom,
// with a cream shine in its top-left corner.
const PUZZLE_PIECE =
  '<path d="M23 34 H39 V32 A10 10 0 1 1 49 32 V34 H67 A4 4 0 0 1 71 38 V54 H73 ' +
  'A10 10 0 1 1 73 64 H71 V82 A4 4 0 0 1 67 86 H49 V84 A10 10 0 1 0 39 84 V86 H23 ' +
  'A4 4 0 0 1 19 82 V38 A4 4 0 0 1 23 34 Z"/>';
const puzzles: Drawing = {
  silhouette: PUZZLE_PIECE,
  art:
    paint(PUZZLE_PIECE, `fill="${RED}" ${stroke}`) +
    `<path d="M26 51 V45 Q26 41 30 41 H34" fill="none" stroke="${CREAM}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`,
};

// Rules: an open rulebook, two cream pages on a navy cover, a red heading
// bar and navy lines of text.
const BOOK_COVER =
  '<path d="M12 24 H88 Q92 24 92 28 V76 Q92 80 88 80 H57 L50 85 L43 80 H12 Q8 80 8 76 V28 Q8 24 12 24 Z"/>';
const BOOK_LEFT = '<path d="M50 22 Q33 13 15 18 V71 Q33 66 50 74 Z"/>';
const BOOK_RIGHT = '<path d="M50 22 Q67 13 85 18 V71 Q67 66 50 74 Z"/>';
const rules: Drawing = {
  silhouette: BOOK_COVER + BOOK_LEFT + BOOK_RIGHT,
  art:
    paint(BOOK_COVER, `fill="${NAVY}" ${stroke}`) +
    paint(BOOK_LEFT, `fill="${CREAM}" ${stroke}`) +
    paint(BOOK_RIGHT, `fill="${CREAM}" ${stroke}`) +
    `<rect x="21" y="28" width="22" height="7" rx="3.5" fill="${RED}"/>` +
    `<g fill="${NAVY}">` +
    `<rect x="21" y="41" width="23" height="5.5" rx="2.75"/>` +
    `<rect x="21" y="52" width="23" height="5.5" rx="2.75"/>` +
    `<rect x="56" y="29" width="23" height="5.5" rx="2.75"/>` +
    `<rect x="56" y="40" width="23" height="5.5" rx="2.75"/>` +
    `<rect x="56" y="51" width="15" height="5.5" rx="2.75"/></g>`,
};

// Study: a notepad with a navy binding, a red ribbon and ruled lines, and a
// gold pencil laid across its corner.
const PAD_SHEET = '<rect x="12" y="14" width="52" height="74" rx="5"/>';
const PAD_BINDING = '<path d="M17 14 H59 A5 5 0 0 1 64 19 V28 H12 V19 A5 5 0 0 1 17 14 Z"/>';
const PENCIL_AT = 'translate(46 84) rotate(-45)';
const PENCIL_BODY = `<path d="M0 0 L10 -6 H44 A6 6 0 0 1 50 0 A6 6 0 0 1 44 6 H10 Z" transform="${PENCIL_AT}"/>`;
const study: Drawing = {
  silhouette: PAD_SHEET + PENCIL_BODY,
  art:
    paint(PAD_SHEET, `fill="${CREAM}" ${stroke}`) +
    paint(PAD_BINDING, `fill="${NAVY}" ${stroke}`) +
    `<path d="M47 28 V44 L51.5 40 L56 44 V28 Z" fill="${RED}" ${stroke}/>` +
    `<g fill="${NAVY}">` +
    `<rect x="19" y="36" width="22" height="5" rx="2.5"/>` +
    `<rect x="19" y="48" width="36" height="5" rx="2.5"/>` +
    `<rect x="19" y="60" width="30" height="5" rx="2.5"/>` +
    `<rect x="19" y="72" width="18" height="5" rx="2.5"/></g>` +
    `<g transform="${PENCIL_AT}">` +
    `<path d="M10 -6 H44 A6 6 0 0 1 50 0 A6 6 0 0 1 44 6 H10 Z" fill="${GOLD}" ${stroke}/>` +
    `<path d="M40 -6 H44 A6 6 0 0 1 50 0 A6 6 0 0 1 44 6 H40 Z" fill="${RED}" ${stroke}/>` +
    `<path d="M0 0 L10 -6 V6 Z" fill="${CREAM}" ${stroke}/>` +
    `<path d="M0 0 L4 -2.4 V2.4 Z" fill="${INK}" ${stroke}/></g>`,
};

// Analysis: a magnifier over a corner of a xiangqi board, a red piece on the
// board and the same piece, larger, in the lens.
const BOARD = '<rect x="12" y="12" width="50" height="50" rx="5"/>';
const LENS_RING = '<circle cx="58" cy="56" r="20"/>';
const LENS_HANDLE =
  '<rect x="17" y="-6.5" width="22" height="13" rx="6.5" transform="translate(58 56) rotate(45)"/>';
const analysis: Drawing = {
  silhouette: BOARD + LENS_HANDLE + LENS_RING,
  art:
    paint(BOARD, `fill="${CREAM}" ${stroke}`) +
    `<g stroke="${NAVY}" stroke-width="4.5" stroke-linecap="round">` +
    `<path d="M29 14.5 V59.5"/><path d="M14.5 29 H59.5"/><path d="M45 14.5 V36"/><path d="M14.5 45 H38"/></g>` +
    `<circle cx="29" cy="29" r="6.5" fill="${RED}" ${stroke}/>` +
    paint(LENS_HANDLE, `fill="${NAVY}" ${stroke}`) +
    paint(LENS_RING, `fill="${GOLD}" ${stroke}`) +
    `<circle cx="58" cy="56" r="12.5" fill="${CREAM}" ${stroke}/>` +
    `<circle cx="58" cy="56" r="6" fill="${RED}" ${stroke}/>`,
};

// Forum: two speech bubbles, a red one behind and a cream one in front with
// three navy dots.
const BUBBLE_BACK =
  '<path d="M42 14 H76 A12 12 0 0 1 88 26 V40 A12 12 0 0 1 76 52 L84 63 L64 52 H42 A12 12 0 0 1 30 40 V26 A12 12 0 0 1 42 14 Z"/>';
const BUBBLE_FRONT =
  '<path d="M24 40 H58 A12 12 0 0 1 70 52 V68 A12 12 0 0 1 58 80 H35 L19 90 L24 80 A12 12 0 0 1 12 68 V52 A12 12 0 0 1 24 40 Z"/>';
const forum: Drawing = {
  silhouette: BUBBLE_BACK + BUBBLE_FRONT,
  art:
    paint(BUBBLE_BACK, `fill="${RED}" ${stroke}`) +
    paint(BUBBLE_FRONT, `fill="${CREAM}" ${stroke}`) +
    `<g fill="${NAVY}"><circle cx="27" cy="60" r="5"/><circle cx="41" cy="60" r="5"/><circle cx="55" cy="60" r="5"/></g>`,
};

// Watch: a pair of binoculars, front on. Navy eyepieces, red barrels joined
// by a gold bridge and hinge, two big gold-rimmed lenses of navy glass with a
// cream glint. Upright and two-lensed, so it reads apart from the broadcast
// TV's wide box and from Analysis's single magnifier with a handle.
const BINO_EYEPIECES =
  '<rect x="19" y="12" width="18" height="16" rx="4"/><rect x="63" y="12" width="18" height="16" rx="4"/>';
const BINO_BRIDGE = '<rect x="38" y="34" width="24" height="13" rx="4"/>';
const BINO_HINGE = '<circle cx="50" cy="31" r="6.5"/>';
const BINO_BARRELS =
  '<rect x="12" y="23" width="32" height="46" rx="9"/><rect x="56" y="23" width="32" height="46" rx="9"/>';
const BINO_RIMS = '<circle cx="28" cy="70" r="18"/><circle cx="72" cy="70" r="18"/>';
const watch: Drawing = {
  silhouette: BINO_EYEPIECES + BINO_BRIDGE + BINO_HINGE + BINO_BARRELS + BINO_RIMS,
  art:
    `<g fill="${NAVY}" ${stroke}>${BINO_EYEPIECES}</g>` +
    paint(BINO_BRIDGE, `fill="${GOLD}" ${stroke}`) +
    paint(BINO_HINGE, `fill="${GOLD}" ${stroke}`) +
    `<g fill="${RED}" ${stroke}>${BINO_BARRELS}</g>` +
    `<g fill="${GOLD}" ${stroke}>${BINO_RIMS}</g>` +
    `<g fill="${NAVY}" ${stroke}><circle cx="28" cy="70" r="10.5"/><circle cx="72" cy="70" r="10.5"/></g>` +
    `<g fill="none" stroke="${CREAM}" stroke-width="4" stroke-linecap="round">` +
    '<path d="M22.1 67.1 A6.5 6.5 0 0 1 26.3 63.7"/><path d="M66.1 67.1 A6.5 6.5 0 0 1 70.3 63.7"/></g>',
};

const DRAWINGS: Record<HomeTileArt, Drawing> = { puzzles, rules, study, analysis, forum, watch };

// Every silhouette's outline reaches 2.25 units past its edge.
const HALO_WIDTH = 2 * (OUTLINE / 2 + HALO);

function drawingContents(name: HomeTileArt): string {
  const { silhouette, art } = DRAWINGS[name];
  return (
    `<g class="landing-phone-tile-halo" fill="${CREAM}" stroke="${CREAM}" stroke-width="${HALO_WIDTH}" stroke-linejoin="round" stroke-linecap="round">${silhouette}</g>` +
    art
  );
}

function artAttributes(name: HomeTileArt): Record<string, string> {
  return {
    class: 'landing-phone-tile-art',
    viewBox: '0 0 100 100',
    'aria-hidden': 'true',
    focusable: 'false',
    'data-art': name,
  };
}

export function homeTileArtSvg(name: HomeTileArt): string {
  const attrs = Object.entries(artAttributes(name))
    .map(([attr, value]) => `${attr}="${value}"`)
    .join(' ');
  return `<svg ${attrs}>${drawingContents(name)}</svg>`;
}

export function buildHomeTileArt(name: HomeTileArt): SVGSVGElement {
  // Created in the SVG namespace directly, as news-disc.ts does: no
  // constructor identity check that could abort the homepage.
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [attr, value] of Object.entries(artAttributes(name))) svg.setAttribute(attr, value);
  // All children are constant authored shapes, with no user input.
  svg.innerHTML = drawingContents(name);
  return svg;
}
