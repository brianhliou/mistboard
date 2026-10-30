/**
 * One line icon per puzzle theme (Brian, 2026-10-29: "Yeah, let's build
 * these"), drawn in the family the group icons set: a shared ring, a 5-unit
 * round stroke for what acts, the ring's 2.5 for the board, no text, no
 * hanzi, no numerals. A group's own icon stays as the fallback for an id
 * with no drawing; `missingThemeIcons` is how a test makes that fallback
 * fail loudly instead of passing silently.
 *
 * The mate patterns are drawn as their picture: the defending general and the
 * pieces that make the pattern, on the points of the palace and the files
 * below it, with the defender's palace at the top as a player sees the
 * opponent's. Filled means the defender (the general large, its own men
 * small); a ring means the attacker; a line ending at the general is a check
 * or a hold, a line with a head is a move in the solution, a dotted line is
 * an open file, a small circle is a point a piece has just left and a cross
 * is a point the general may not step to.
 */
import type {
  XiangqiMotifId,
  XiangqiPuzzleTrainingTag,
  XiangqiTrainingTagGroup,
  XiangqiTrainingTagId,
} from '@mistboard/game';

const LINE =
  'fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"';
const THIN =
  'fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"';

const n = (value: number) => String(Math.round(value * 10) / 10);

// ── The board ────────────────────────────────────────────────────────────────

/** A point: file from the centre file (−2 to 2), rank from the defender's back (1 to 5). */
type Pt = readonly [file: number, rank: number];
type Xy = readonly [x: number, y: number];
type Projection = (point: Pt) => Xy;

/** A piece of a picture: the points it uses and how to draw it once they are placed. */
interface Part {
  readonly points: readonly Pt[];
  readonly draw: (xy: Projection) => string;
}

const at = ([x, y]: Xy) => `${n(x)} ${n(y)}`;

/** Outer radii, so a line stops short of the piece it meets, and the gap it leaves. */
const R = { general: 7, own: 4.5, foe: 7.5, vacated: 4.5, none: 0 } as const;
const GAP = 3;
const edge = (radius: number) => (radius > 0 ? radius + GAP : 0);

/** The widest a point step gets, and how far from the centre any point may land. */
const MAX_STEP = 20;
const REACH = 35;

const PALACE: readonly Pt[] = [
  [-1, 1],
  [1, 1],
  [1, 3],
  [-1, 3],
];

/**
 * Places a picture in the ring: centred on its points' box, scaled so the
 * point farthest from that centre sits `REACH` out, never wider than
 * `MAX_STEP` a point. The palace is always drawn.
 */
function scene(...parts: Part[]): string {
  const points = [...PALACE, ...parts.flatMap((part) => part.points)];
  const files = points.map(([file]) => file);
  const ranks = points.map(([, rank]) => rank);
  const centreFile = (Math.min(...files) + Math.max(...files)) / 2;
  const centreRank = (Math.min(...ranks) + Math.max(...ranks)) / 2;
  const far = Math.max(
    ...points.map(([file, rank]) => Math.hypot(file - centreFile, rank - centreRank)),
  );
  const step = Math.min(MAX_STEP, REACH / far);
  const xy: Projection = ([file, rank]) => [
    50 + step * (file - centreFile),
    50 + step * (rank - centreRank),
  ];
  const [a, b, c, d] = PALACE.map(xy) as [Xy, Xy, Xy, Xy];
  const palace = `<path ${THIN} d="M${at(a)} L${at(b)} L${at(c)} L${at(d)} Z M${at(a)} L${at(c)} M${at(b)} L${at(d)}"/>`;
  return palace + parts.map((part) => part.draw(xy)).join('');
}

const disc = (p: Pt, radius: number): Part => ({
  points: [p],
  draw: (xy) => {
    const [x, y] = xy(p);
    return `<circle cx="${n(x)}" cy="${n(y)}" r="${radius}" fill="currentColor"/>`;
  },
});

/** The defending general: the largest filled point. */
const general = (p: Pt) => disc(p, R.general);
/** One of the defender's own men. */
const own = (p: Pt) => disc(p, R.own);
/** An attacking piece. */
const foe = (p: Pt): Part => ({
  points: [p],
  draw: (xy) => {
    const [x, y] = xy(p);
    return `<circle cx="${n(x)}" cy="${n(y)}" r="5.5" fill="none" stroke="currentColor" stroke-width="4"/>`;
  },
});
/** The attacker's own general: a ring with its centre filled. */
const foeGeneral = (p: Pt): Part => ({
  points: [p],
  draw: (xy) => {
    const [x, y] = xy(p);
    return `${foe(p).draw(xy)}<circle cx="${n(x)}" cy="${n(y)}" r="2" fill="currentColor"/>`;
  },
});
/** A point left empty, where a piece stood a move ago. */
const vacated = (p: Pt): Part => ({
  points: [p],
  draw: (xy) => {
    const [x, y] = xy(p);
    return `<circle cx="${n(x)}" cy="${n(y)}" r="3.5" ${THIN}/>`;
  },
});
/** A point the general may not step to. */
const shut = (p: Pt): Part => ({
  points: [p],
  draw: (xy) => {
    const [x, y] = xy(p);
    const d = 4;
    return `<path ${THIN} d="M${n(x - d)} ${n(y - d)} L${n(x + d)} ${n(y + d)} M${n(x + d)} ${n(y - d)} L${n(x - d)} ${n(y + d)}"/>`;
  },
});

/** A footprint: a soldier's step toward the general, one per point it passed. */
const step = (p: Pt): Part => ({
  points: [p],
  draw: (xy) => {
    const [x, y] = xy(p);
    return `<path ${LINE} d="M${n(x - 6)} ${n(y + 3)} L${n(x)} ${n(y - 3)} L${n(x + 6)} ${n(y + 3)}"/>`;
  },
});

/** Move `from` toward `to` by `by` units. */
function toward(from: Xy, to: Xy, by: number): Xy {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy);
  return [from[0] + (dx / length) * by, from[1] + (dy / length) * by];
}

/** Placed points, trimmed at each end so the line meets a piece's edge. */
function trimmed(xy: Projection, points: readonly Pt[], start: number, end: number): Xy[] {
  const out = points.map(xy);
  if (start > 0) out[0] = toward(out[0] as Xy, out[1] as Xy, start);
  const last = out.length - 1;
  if (end > 0) out[last] = toward(out[last] as Xy, out[last - 1] as Xy, end);
  return out;
}

const polyline = (points: readonly Xy[]) => `M${points.map(at).join(' L')}`;

/** A check or a hold: a line from the piece to what it reaches. */
const reach = (points: readonly Pt[], from: number = R.foe, to: number = R.general): Part => ({
  points,
  draw: (xy) => `<path ${LINE} d="${polyline(trimmed(xy, points, edge(from), edge(to)))}"/>`,
});

/** A move in the line: a stroke with a head at its end. */
const move = (points: readonly Pt[], from: number = R.vacated, to: number = R.foe): Part => ({
  points,
  draw: (xy) => {
    const line = trimmed(xy, points, edge(from), edge(to));
    const tip = line[line.length - 1] as Xy;
    const back = line[line.length - 2] as Xy;
    const angle = Math.atan2(tip[1] - back[1], tip[0] - back[0]);
    const head = (turn: number): Xy => [
      tip[0] - 7 * Math.cos(angle + turn),
      tip[1] - 7 * Math.sin(angle + turn),
    ];
    return `<path ${LINE} d="${polyline(line)} M${at(head(0.75))} L${at(tip)} L${at(head(-0.75))}"/>`;
  },
});

/** An open file: dots, nothing standing on it. */
const open = (
  from: Pt,
  to: Pt,
  fromRadius: number = R.foe,
  toRadius: number = R.general,
): Part => ({
  points: [from, to],
  draw: (xy) =>
    `<path fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-dasharray="0 9" d="${polyline(trimmed(xy, [from, to], edge(fromRadius) + 2, edge(toRadius) + 2))}"/>`,
});

const icon = (...parts: string[]) => parts.join('');

// ── Mate patterns ────────────────────────────────────────────────────────────

/*
 * Each picture is the pattern's defining relation as its detector in
 * packages/game/src/puzzles-xiangqi-motifs.ts reads it, not a full legal
 * position: the general, the pieces the predicate names, and the lines
 * between them. Distances are shortened (an attacker three ranks down stands
 * for one anywhere down the file).
 */
const MOTIF_ICON: Record<XiangqiMotifId, string> = {
  // The general's one free point is shut only by the other general looking
  // up the open file; a horse checks from outside the palace.
  'bai-lian-jiang': scene(
    open([0, 4], [0, 1], R.foe, R.none),
    shut([0, 1]),
    foeGeneral([0, 4]),
    reach([
      [-2, 3],
      [-2, 2],
      [-1, 1],
    ]),
    foe([-2, 3]),
    general([-1, 1]),
  ),
  // A lone cannon from below; every neighbouring point is the general's own
  // man, an advisor on each side and the screen in front.
  'men-gong': scene(
    reach(
      [
        [0, 4],
        [0, 2],
      ],
      R.foe,
      R.own,
    ),
    foe([0, 4]),
    own([-1, 1]),
    own([1, 1]),
    own([0, 2]),
    general([0, 1]),
  ),
  // The same cage, and a horse is the piece that reaches into it, over the
  // empty corner beside it.
  'men-sha': scene(
    reach([
      [-2, 2],
      [-1, 2],
      [0, 1],
    ]),
    foe([-2, 2]),
    own([-1, 1]),
    own([1, 1]),
    own([0, 2]),
    general([0, 1]),
  ),
  // The general's own man has just moved onto its free point; the chariot's
  // check up the file is mate.
  'chen-ya-jun': scene(
    move(
      [
        [0, 3],
        [0, 1.25],
      ],
      R.none,
      R.own,
    ),
    own([0, 1]),
    reach([
      [-1, 4],
      [-1, 1],
    ]),
    foe([-1, 4]),
    general([-1, 1]),
  ),
  // Two cannons on one file, the front one the rear one's screen.
  'chong-pao': scene(
    reach(
      [
        [0, 5],
        [0, 3],
      ],
      R.foe,
      R.foe,
    ),
    reach([
      [0, 3],
      [0, 1],
    ]),
    foe([0, 5]),
    foe([0, 3]),
    general([0, 1]),
  ),
  // The horse is the cannon's screen on the general's file, and its two legs
  // reach the points the general could step to: a check and a fork.
  'ma-hou-pao': scene(
    reach(
      [
        [-1, 5],
        [-1, 3],
      ],
      R.foe,
      R.foe,
    ),
    reach([
      [-1, 3],
      [-1, 1],
    ]),
    reach(
      [
        [-1, 3],
        [-1, 2],
        [0, 1],
      ],
      R.foe,
      R.none,
    ),
    reach(
      [
        [-1, 3],
        [0, 3],
        [1, 2],
      ],
      R.foe,
      R.none,
    ),
    foe([-1, 5]),
    foe([-1, 3]),
    general([-1, 1]),
  ),
  // One cannon up the centre file, one along the back rank: the general is
  // held on two lines at right angles.
  'tian-di-pao': scene(
    reach([
      [0, 4],
      [0, 1],
    ]),
    reach([
      [2, 1],
      [0, 1],
    ]),
    foe([0, 4]),
    foe([2, 1]),
    general([0, 1]),
  ),
  // A cannon looks straight up the general's file with nothing between.
  'kong-tou-pao': scene(open([0, 4], [0, 1]), foe([0, 4]), general([0, 1])),
  // The cannon holds the centre file shut; the chariot is the bolt, checking
  // up the rib file the general stands on.
  'tie-men-shuan': scene(
    reach(
      [
        [0, 4],
        [0, 1],
      ],
      R.foe,
      R.none,
    ),
    reach([
      [-1, 4],
      [-1, 1],
    ]),
    foe([0, 4]),
    foe([-1, 4]),
    general([-1, 1]),
  ),
  // The horse lies in the trough beside the palace, one rank in, and checks
  // the general on its home point.
  'wo-cao-ma': scene(
    reach([
      [2, 2],
      [1, 2],
      [0, 1],
    ]),
    foe([2, 2]),
    general([0, 1]),
  ),
  // The horse hangs on a palace corner and checks from there.
  'gua-jiao-ma': scene(
    reach([
      [1, 3],
      [1, 2],
      [0, 1],
    ]),
    foe([1, 3]),
    general([0, 1]),
  ),
  // Horse and general on opposite corners of the palace; the horse covers
  // both of the general's points and a chariot checks along the back rank.
  'ba-jiao-ma': scene(
    reach(
      [
        [1, 3],
        [1, 2],
        [0, 1],
      ],
      R.foe,
      R.none,
    ),
    reach(
      [
        [1, 3],
        [0, 3],
        [-1, 2],
      ],
      R.foe,
      R.none,
    ),
    reach([
      [-2.5, 1],
      [-1, 1],
    ]),
    foe([1, 3]),
    foe([-2.5, 1]),
    general([-1, 1]),
  ),
  // The fishing horse, two files out on the third rank, covers both points
  // beside the general's home; a chariot checks along the back rank.
  'diao-yu-ma': scene(
    reach(
      [
        [2, 3],
        [2, 2],
        [1, 1],
      ],
      R.foe,
      R.none,
    ),
    reach(
      [
        [2, 3],
        [1, 3],
        [0, 2],
      ],
      R.foe,
      R.none,
    ),
    reach([
      [-2.25, 1],
      [0, 1],
    ]),
    foe([2, 3]),
    foe([-2.25, 1]),
    general([0, 1]),
  ),
  // The same horse a rank higher, closing the points in front of the
  // general; a chariot checks down the file.
  'gao-diao-ma': scene(
    reach(
      [
        [-2, 4],
        [-2, 3],
        [-1, 2],
      ],
      R.foe,
      R.none,
    ),
    reach(
      [
        [-2, 4],
        [-1, 4],
        [0, 3],
      ],
      R.foe,
      R.none,
    ),
    reach([
      [1, 4],
      [1, 1],
    ]),
    foe([-2, 4]),
    foe([1, 4]),
    general([1, 1]),
  ),
  // The horse jumps off the file and the chariot behind it checks.
  'ba-huang-ma': scene(
    reach([
      [0, 5],
      [0, 1],
    ]),
    vacated([0, 3]),
    move([
      [0, 3],
      [1, 3],
      [2, 2],
    ]),
    foe([2, 2]),
    foe([0, 5]),
    general([0, 1]),
  ),
  // Two chariots on neighbouring ranks: one checks along the general's rank,
  // the other holds the rank in front of it.
  'shuang-ju-cuo': scene(
    reach([
      [2.25, 1],
      [-1, 1],
    ]),
    reach(
      [
        [2.25, 2],
        [-1, 2],
      ],
      R.foe,
      R.none,
    ),
    foe([2.25, 1]),
    foe([2.25, 2]),
    general([-1, 1]),
  ),
  // The chariot drives up the file into the palace centre, taking the advisor
  // there.
  'da-dan-chuan-xin': scene(
    vacated([0, 5]),
    move([
      [0, 5],
      [0, 2],
    ]),
    foe([0, 2]),
    general([0, 1]),
  ),
  // The soldier steps in from the side to take the advisor on the centre.
  'xiao-dao-wan-xin': scene(
    move(
      [
        [-1, 2],
        [0, 2],
      ],
      R.none,
    ),
    foe([0, 2]),
    general([0, 1]),
  ),
  // The chariot steps aside and the cannon behind it checks over a screen.
  'ju-pao-chou-sha': scene(
    reach(
      [
        [0, 5],
        [0, 2],
      ],
      R.foe,
      R.own,
    ),
    vacated([0, 4]),
    move([
      [0, 4],
      [-2, 4],
    ]),
    foe([-2, 4]),
    foe([0, 5]),
    own([0, 2]),
    general([0, 1]),
  ),
  // Two soldiers at the door: one checks from beside the general, the other
  // stands in the palace and covers the points it could step to.
  'er-gui-pai-men': scene(foe([-1, 1]), foe([1, 2]), general([0, 1])),
  // A soldier checks step after step, walking the general back home.
  'song-fo-gui-dian': scene(step([0, 4]), step([0, 3]), foe([0, 2]), general([0, 1])),
  // A soldier on the back rank checks along it.
  'lao-zu-sou-shan': scene(
    move(
      [
        [-2, 1],
        [-1, 1],
      ],
      R.none,
    ),
    foe([-1, 1]),
    general([0, 1]),
  ),
  // One move, two checks: the chariot up the file and the horse from the side.
  'shuang-zhao-jiang': scene(
    reach([
      [0, 4],
      [0, 1],
    ]),
    reach([
      [2, 2],
      [1, 2],
      [0, 1],
    ]),
    foe([0, 4]),
    foe([2, 2]),
    general([0, 1]),
  ),
};

// ── Counts, phases, goals, lengths ───────────────────────────────────────────

/** `count` dots in a centred row: what a mate-in-N or a length counts. */
function dots(count: number, y: number, spacing = 14): string {
  const left = 50 - ((count - 1) * spacing) / 2;
  return Array.from(
    { length: count },
    (_, i) => `<circle cx="${n(left + i * spacing)}" cy="${y}" r="4.5" fill="currentColor"/>`,
  ).join('');
}

/** Mate in N: the group's sight, N moves under it. */
const mateIn = (count: number) =>
  icon(
    `<circle cx="50" cy="39" r="12" ${LINE}/>`,
    `<path ${LINE} d="M50 19 V25 M50 53 V59 M30 39 H36 M64 39 H70"/>`,
    `<circle cx="50" cy="39" r="4" fill="currentColor"/>`,
    dots(count, 73),
  );

/** The hourglass of the phase group, with its sand where the game is. */
function hourglass(sand: 'top' | 'middle' | 'bottom'): string {
  const frame = `<path ${LINE} d="M33 26 H67 M33 74 H67"/><path ${LINE} d="M38 26 C38 41 46 45 46 50 C46 55 38 59 38 74 M62 26 C62 41 54 45 54 50 C54 55 62 59 62 74"/>`;
  const top =
    sand === 'top'
      ? '<path d="M42 33 H58 C58 41 52 44 50 47 C48 44 42 41 42 33 Z" fill="currentColor"/>'
      : sand === 'middle'
        ? '<path d="M45 40 H55 C54 43 51 45 50 47 C49 45 46 43 45 40 Z" fill="currentColor"/>'
        : '';
  const stream = sand === 'middle' ? `<path ${THIN} d="M50 49 V62"/>` : '';
  const bottom =
    sand === 'bottom'
      ? '<path d="M41 68 C42 60 47 56 50 54 C53 56 58 60 59 68 Z" fill="currentColor"/>'
      : sand === 'middle'
        ? '<path d="M43 68 C45 64 48 62 50 61 C52 62 55 64 57 68 Z" fill="currentColor"/>'
        : '';
  return frame + top + stream + bottom;
}

/**
 * A length: the solver's moves as dots along a rising path that ends in a
 * head. One dot for one move, up to four for four or more.
 */
function lengthPath(count: number): string {
  const start: Xy = [28, 68];
  const end: Xy = [72, 32];
  const points: Xy[] = [];
  for (let i = 0; i <= count; i += 1) {
    const t = i / count;
    const wobble = i === 0 || i === count ? 0 : i % 2 === 1 ? -7 : 7;
    points.push([
      start[0] + (end[0] - start[0]) * t + wobble * 0.6,
      start[1] + (end[1] - start[1]) * t + wobble,
    ]);
  }
  const tip = points[points.length - 1] as Xy;
  const back = points[points.length - 2] as Xy;
  const angle = Math.atan2(tip[1] - back[1], tip[0] - back[0]);
  const head = (turn: number): Xy => [
    tip[0] - 9 * Math.cos(angle + turn),
    tip[1] - 9 * Math.sin(angle + turn),
  ];
  const marks = points
    .slice(0, count)
    .map(([x, y]) => `<circle cx="${n(x)}" cy="${n(y)}" r="4.5" fill="currentColor"/>`)
    .join('');
  return `<path ${LINE} d="${polyline(points)} M${at(head(0.6))} L${at(tip)} L${at(head(-0.6))}"/>${marks}`;
}

const PLAIN_ICON: Record<XiangqiPuzzleTrainingTag, string> = {
  matein1: mateIn(1),
  matein2: mateIn(2),
  matein3: mateIn(3),
  matein4: mateIn(4),
  opening: hourglass('top'),
  middlegame: hourglass('middle'),
  endgame: hourglass('bottom'),
  // A check up the file and both points beside the general shut.
  checkmate: icon(
    `<path ${LINE} d="M50 64 V51"/>`,
    `<circle cx="50" cy="73" r="6" fill="none" stroke="currentColor" stroke-width="4"/>`,
    `<circle cx="50" cy="39" r="9" fill="currentColor"/>`,
    `<path ${LINE} d="M27 34 L35 44 M35 34 L27 44 M65 34 L73 44 M73 34 L65 44"/>`,
  ),
  // The advantage chart: level, then up and held there.
  winning: icon(
    `<path ${THIN} d="M24 58 H76"/>`,
    `<path ${LINE} d="M24 58 C34 58 36 56 42 48 C49 38 54 32 76 31"/>`,
    `<circle cx="76" cy="31" r="4.5" fill="currentColor"/>`,
  ),
  'one-move': lengthPath(1),
  short: lengthPath(2),
  long: lengthPath(3),
  'very-long': lengthPath(4),
};

/*
 * The group icons: the fallback for an id with no drawing of its own, and the
 * mix row's icon.
 */
export const GROUP_ICON: Record<XiangqiTrainingTagGroup | 'mix', string> = {
  // Two crossing arrows: everything, shuffled.
  mix: `<path ${LINE} d="M28 39 H38 C51 39 49 61 62 61 H70 M28 61 H38 C51 61 49 39 62 39 H70 M64 33 L70 39 L64 45 M64 55 L70 61 L64 67"/>`,
  // The palace, its diagonals and the general caught at its centre.
  motif: `<path ${LINE} d="M32 32 H68 V68 H32 Z M32 32 L68 68 M68 32 L32 68"/><circle cx="50" cy="50" r="8" fill="currentColor"/>`,
  // A sight on the general: forced mate.
  mate: `<circle cx="50" cy="50" r="15" ${LINE}/><path ${LINE} d="M50 25 V35 M50 65 V75 M25 50 H35 M65 50 H75"/><circle cx="50" cy="50" r="5" fill="currentColor"/>`,
  // An hourglass: where the game is.
  phase: `<path ${LINE} d="M36 30 H64 M36 70 H64 M39 30 C39 45 61 53 61 70 M61 30 C61 45 39 53 39 70"/>`,
  // A flag on its pole: what the line wins.
  goal: `<path ${LINE} d="M37 72 V28 M37 31 C47 25 55 37 66 31 V51 C55 57 47 45 37 51"/>`,
  // Moves along a path to an arrow: how long the line is.
  length: `<path ${LINE} d="M29 63 L43 49 L56 58 L70 41 M60 40 H71 V51"/><circle cx="29" cy="63" r="4" fill="currentColor"/><circle cx="43" cy="49" r="4" fill="currentColor"/><circle cx="56" cy="58" r="4" fill="currentColor"/>`,
};

/** Every theme's own drawing, by id. */
export const THEME_ICON: Readonly<Record<XiangqiTrainingTagId, string>> = {
  ...MOTIF_ICON,
  ...PLAIN_ICON,
};

/** The ids in `ids` that have no drawing of their own and would wear their group's. */
export function missingThemeIcons(ids: readonly string[]): string[] {
  const own = THEME_ICON as Readonly<Record<string, string | undefined>>;
  return ids.filter((id) => !own[id]);
}

/** The icon's inner markup: the theme's own, or its group's for an id without one. */
export function themeIconMarkup(
  key: string,
  group: XiangqiTrainingTagGroup | 'mix',
): { markup: string; own: boolean } {
  const drawn = (THEME_ICON as Readonly<Record<string, string | undefined>>)[key];
  return drawn ? { markup: drawn, own: true } : { markup: GROUP_ICON[group], own: false };
}

/** The whole SVG, ring included. */
export function themeIconSvg(inner: string): string {
  return `<svg viewBox="0 0 100 100" focusable="false"><circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" stroke-width="2.5"/>${inner}</svg>`;
}
