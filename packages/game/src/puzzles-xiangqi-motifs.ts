// Named xiangqi kill patterns (杀法) as geometry predicates over a puzzle's
// solution line (#324).
//
// Each detector reads the final mated position plus, where the pattern is a
// sequence, the solver's moves that reached it. The definitions come from
// docs-private/learn-motif-corpus.md (35 named patterns); the ones below are
// the subset that a terminal position and its line can decide. Patterns that
// name a whole method rather than a picture (车马冷着, 借炮使马, 三子归边,
// 三仙炼丹, 双马饮泉's windmill, 海底捞月's technique) are deliberately absent:
// a predicate for them would tag by piece census, which is not the pattern.
// 炮碾丹砂 and 车心马角 were drafted and dropped: neither matched a single
// puzzle in the 965-mate corpus on 2026-09-11, so their predicates had no
// corpus positive to be checked against.
//
// Ids are the Chinese name in pinyin, the hanzi is the display name, the
// English gloss is the label (variant-naming rule, settled 2026-07-27).
//
// Coverage is measured, not assumed: scripts/xiangqi-puzzle-motifs-report.mjs
// runs this over the corpus and prints the count per motif. On 2026-09-11 it
// tagged 589 of 965 mate puzzles (61%), 226 of the 430 served (53%).

import type { XiangqiPuzzle } from './puzzles-xiangqi.js';
import {
  coordOf,
  inBounds,
  inPalace,
  squareOf,
  type XiangqiBoard,
  type XiangqiColor,
  type XiangqiGameState,
  type XiangqiMove,
  type XiangqiPiece,
  type XiangqiPieceRole,
  type XiangqiSquare,
} from './variants-xiangqi.js';
import { applyStandardXiangqiMove } from './variants-xiangqi-standard.js';

export type XiangqiMotifId =
  | 'bai-lian-jiang'
  | 'men-gong'
  | 'men-sha'
  | 'chen-ya-jun'
  | 'chong-pao'
  | 'ma-hou-pao'
  | 'tian-di-pao'
  | 'kong-tou-pao'
  | 'tie-men-shuan'
  | 'wo-cao-ma'
  | 'gua-jiao-ma'
  | 'ba-jiao-ma'
  | 'diao-yu-ma'
  | 'gao-diao-ma'
  | 'ba-huang-ma'
  | 'shuang-ju-cuo'
  | 'da-dan-chuan-xin'
  | 'xiao-dao-wan-xin'
  | 'ju-pao-chou-sha'
  | 'er-gui-pai-men'
  | 'song-fo-gui-dian'
  | 'lao-zu-sou-shan'
  | 'shuang-zhao-jiang';

export type XiangqiMotifTier = 'basic' | 'intermediate' | 'advanced';

export type XiangqiMotif = {
  id: XiangqiMotifId;
  hanzi: string;
  pinyin: string;
  /** English gloss shown as the label; never a name chess players would search for alone. */
  label: string;
  tier: XiangqiMotifTier;
};

export const XIANGQI_MOTIFS: readonly XiangqiMotif[] = [
  {
    id: 'bai-lian-jiang',
    hanzi: '白脸将',
    pinyin: 'báiliǎn jiàng',
    label: 'Facing generals',
    tier: 'basic',
  },
  { id: 'men-gong', hanzi: '闷宫', pinyin: 'mèn gōng', label: 'Sealed palace', tier: 'basic' },
  {
    id: 'men-sha',
    hanzi: '闷杀',
    pinyin: 'mèn shā',
    label: 'Smothered mate',
    tier: 'intermediate',
  },
  {
    id: 'chen-ya-jun',
    hanzi: '臣压君',
    pinyin: 'chén yā jūn',
    label: 'Buried by its own piece',
    tier: 'intermediate',
  },
  { id: 'chong-pao', hanzi: '重炮', pinyin: 'chóng pào', label: 'Doubled cannons', tier: 'basic' },
  {
    id: 'ma-hou-pao',
    hanzi: '马后炮',
    pinyin: 'mǎ hòu pào',
    label: 'Cannon behind the horse',
    tier: 'basic',
  },
  {
    id: 'tian-di-pao',
    hanzi: '天地炮',
    pinyin: 'tiāndì pào',
    label: 'Heaven and earth cannons',
    tier: 'intermediate',
  },
  {
    id: 'kong-tou-pao',
    hanzi: '空头炮',
    pinyin: 'kōngtóu pào',
    label: 'Empty-headed cannon',
    tier: 'intermediate',
  },
  {
    id: 'tie-men-shuan',
    hanzi: '铁门栓',
    pinyin: 'tiěménshuān',
    label: 'Iron bolt',
    tier: 'basic',
  },
  { id: 'wo-cao-ma', hanzi: '卧槽马', pinyin: 'wòcáo mǎ', label: 'Trough horse', tier: 'basic' },
  {
    id: 'gua-jiao-ma',
    hanzi: '挂角马',
    pinyin: 'guàjiǎo mǎ',
    label: 'Corner horse',
    tier: 'basic',
  },
  {
    id: 'ba-jiao-ma',
    hanzi: '八角马',
    pinyin: 'bājiǎo mǎ',
    label: 'Eight-corner horse',
    tier: 'intermediate',
  },
  { id: 'diao-yu-ma', hanzi: '钓鱼马', pinyin: 'diàoyú mǎ', label: 'Fishing horse', tier: 'basic' },
  {
    id: 'gao-diao-ma',
    hanzi: '高钓马',
    pinyin: 'gāo diào mǎ',
    label: 'High fishing horse',
    tier: 'intermediate',
  },
  {
    id: 'ba-huang-ma',
    hanzi: '拔簧马',
    pinyin: 'bá huáng mǎ',
    label: 'Spring-loaded horse',
    tier: 'intermediate',
  },
  {
    id: 'shuang-ju-cuo',
    hanzi: '双车错',
    pinyin: 'shuāng jū cuò',
    label: 'Scissoring chariots',
    tier: 'basic',
  },
  {
    id: 'da-dan-chuan-xin',
    hanzi: '大胆穿心',
    pinyin: 'dàdǎn chuānxīn',
    label: 'Chariot through the heart',
    tier: 'basic',
  },
  {
    id: 'xiao-dao-wan-xin',
    hanzi: '小刀剜心',
    pinyin: 'xiǎodāo wān xīn',
    label: 'Soldier cuts the heart',
    tier: 'intermediate',
  },
  {
    id: 'ju-pao-chou-sha',
    hanzi: '车炮抽杀',
    pinyin: 'jū pào chōu shā',
    label: 'Chariot-cannon battery',
    tier: 'intermediate',
  },
  {
    id: 'er-gui-pai-men',
    hanzi: '二鬼拍门',
    pinyin: 'èr guǐ pāi mén',
    label: 'Two ghosts at the gate',
    tier: 'basic',
  },
  {
    id: 'song-fo-gui-dian',
    hanzi: '送佛归殿',
    pinyin: 'sòng fó guī diàn',
    label: 'Soldier drives the general home',
    tier: 'intermediate',
  },
  {
    id: 'lao-zu-sou-shan',
    hanzi: '老卒搜山',
    pinyin: 'lǎo zú sōu shān',
    label: 'Old soldier on the back rank',
    tier: 'intermediate',
  },
  {
    id: 'shuang-zhao-jiang',
    hanzi: '双照将',
    pinyin: 'shuāng zhào jiàng',
    label: 'Double check',
    tier: 'intermediate',
  },
];

export const XIANGQI_MOTIF_BY_ID: ReadonlyMap<XiangqiMotifId, XiangqiMotif> = new Map(
  XIANGQI_MOTIFS.map((motif) => [motif.id, motif]),
);

// ── Geometry ─────────────────────────────────────────────────────────────────

const other = (color: XiangqiColor): XiangqiColor => (color === 'red' ? 'black' : 'red');

/** Rank counted from `color`'s own back edge: rank 1 is the back rank. */
function rankFromBack(color: XiangqiColor, k: number): number {
  return color === 'red' ? k : 11 - k;
}

function sq(file: number, rank: number): XiangqiSquare | null {
  return inBounds(file, rank) ? squareOf(file, rank) : null;
}

const HORSE: readonly (readonly [number, number, number, number])[] = [
  [1, 2, 0, 1],
  [1, -2, 0, -1],
  [-1, 2, 0, 1],
  [-1, -2, 0, -1],
  [2, 1, 1, 0],
  [2, -1, 1, 0],
  [-2, 1, -1, 0],
  [-2, -1, -1, 0],
];
const ORTHO: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

type Attack = { from: XiangqiSquare; role: XiangqiPieceRole; screen: XiangqiSquare | null };

/** Every square each piece of `color` could capture on, given the board. A
 *  cannon's entry carries the screen it jumps. Generals attack their adjacent
 *  palace squares only; the facing rule is handled by flightCovered. */
function attacksBy(board: XiangqiBoard, color: XiangqiColor): Map<XiangqiSquare, Attack[]> {
  const out = new Map<XiangqiSquare, Attack[]>();
  const add = (target: XiangqiSquare, attack: Attack) => {
    const list = out.get(target) ?? [];
    list.push(attack);
    out.set(target, list);
  };
  for (const [from, piece] of Object.entries(board) as [XiangqiSquare, XiangqiPiece][]) {
    if (piece.color !== color) continue;
    const { file, rank } = coordOf(from);
    const attack = (target: XiangqiSquare, screen: XiangqiSquare | null = null) =>
      add(target, { from, role: piece.role, screen });
    switch (piece.role) {
      case 'chariot':
        for (const [df, dr] of ORTHO) {
          for (let step = 1; ; step += 1) {
            const target = sq(file + df * step, rank + dr * step);
            if (!target) break;
            attack(target);
            if (board[target]) break;
          }
        }
        break;
      case 'cannon':
        for (const [df, dr] of ORTHO) {
          let screen: XiangqiSquare | null = null;
          for (let step = 1; ; step += 1) {
            const target = sq(file + df * step, rank + dr * step);
            if (!target) break;
            if (!screen) {
              if (board[target]) screen = target;
              continue;
            }
            attack(target, screen);
            if (board[target]) break;
          }
        }
        break;
      case 'horse':
        for (const [df, dr, lf, lr] of HORSE) {
          const leg = sq(file + lf, rank + lr);
          if (!leg || board[leg]) continue;
          const target = sq(file + df, rank + dr);
          if (target) attack(target);
        }
        break;
      case 'soldier': {
        const forward = color === 'red' ? 1 : -1;
        const ahead = sq(file, rank + forward);
        if (ahead) attack(ahead);
        const crossed = color === 'red' ? rank >= 6 : rank <= 5;
        if (crossed) {
          for (const df of [-1, 1]) {
            const side = sq(file + df, rank);
            if (side) attack(side);
          }
        }
        break;
      }
      case 'general':
        for (const [df, dr] of ORTHO) {
          const target = sq(file + df, rank + dr);
          if (target && inPalace(color, file + df, rank + dr)) attack(target);
        }
        break;
      case 'advisor':
        for (const df of [-1, 1]) {
          for (const dr of [-1, 1]) {
            const target = sq(file + df, rank + dr);
            if (target && inPalace(color, file + df, rank + dr)) attack(target);
          }
        }
        break;
      case 'elephant':
        for (const df of [-2, 2]) {
          for (const dr of [-2, 2]) {
            const eye = sq(file + df / 2, rank + dr / 2);
            const target = sq(file + df, rank + dr);
            if (!eye || !target || board[eye]) continue;
            const ownHalf = color === 'red' ? rank + dr <= 5 : rank + dr >= 6;
            if (ownHalf) attack(target);
          }
        }
        break;
    }
  }
  return out;
}

function findGeneral(board: XiangqiBoard, color: XiangqiColor): XiangqiSquare | null {
  for (const [square, piece] of Object.entries(board) as [XiangqiSquare, XiangqiPiece][]) {
    if (piece.color === color && piece.role === 'general') return square;
  }
  return null;
}

/** The squares between two squares on a shared file or rank, exclusive. */
function between(a: XiangqiSquare, b: XiangqiSquare): XiangqiSquare[] | null {
  const ca = coordOf(a);
  const cb = coordOf(b);
  if (ca.file !== cb.file && ca.rank !== cb.rank) return null;
  const df = Math.sign(cb.file - ca.file);
  const dr = Math.sign(cb.rank - ca.rank);
  const out: XiangqiSquare[] = [];
  let f = ca.file + df;
  let r = ca.rank + dr;
  while (f !== cb.file || r !== cb.rank) {
    out.push(squareOf(f, r));
    f += df;
    r += dr;
  }
  return out;
}

type Final = {
  board: XiangqiBoard;
  defender: XiangqiColor;
  attacker: XiangqiColor;
  general: XiangqiSquare;
  attackerGeneral: XiangqiSquare | null;
  attacks: Map<XiangqiSquare, Attack[]>;
  checkers: Attack[];
  /** Adjacent palace squares of the mated general, with what stops each one. */
  flights: Flight[];
};

type Flight = {
  square: XiangqiSquare;
  /** A piece of the defender's own colour stands here. */
  ownBlock: XiangqiPiece | null;
  /** An attacker piece stands here (capturable only if unprotected). */
  enemyPiece: XiangqiPiece | null;
  /** Attacked by an attacker piece once the general steps there. */
  attacked: boolean;
  /** Illegal only because it would face the attacker's general on an open file. */
  facingOnly: boolean;
};

function analyzeFinal(state: XiangqiGameState, defender: XiangqiColor): Final | null {
  const board = state.board;
  const general = findGeneral(board, defender);
  if (!general) return null;
  const attacker = other(defender);
  const attacks = attacksBy(board, attacker);
  const checkers = attacks.get(general) ?? [];
  const attackerGeneral = findGeneral(board, attacker);
  const { file, rank } = coordOf(general);
  const flights: Flight[] = [];
  for (const [df, dr] of ORTHO) {
    const f = file + df;
    const r = rank + dr;
    if (!inBounds(f, r) || !inPalace(defender, f, r)) continue;
    const square = squareOf(f, r);
    const occupant = board[square] ?? null;
    // Recompute attacks with the general moved: a chariot or cannon ray that
    // stopped at the general continues once it steps aside.
    const moved: XiangqiBoard = { ...board };
    delete moved[general];
    moved[square] = { color: defender, role: 'general' };
    const attackedThere = (attacksBy(moved, attacker).get(square) ?? []).length > 0;
    let facingOnly = false;
    if (!attackedThere && attackerGeneral && coordOf(attackerGeneral).file === f) {
      const gap = between(square, attackerGeneral) ?? [];
      facingOnly = gap.every((s) => !moved[s]);
    }
    flights.push({
      square,
      ownBlock: occupant && occupant.color === defender ? occupant : null,
      enemyPiece: occupant && occupant.color === attacker ? occupant : null,
      attacked: attackedThere,
      facingOnly,
    });
  }
  return { board, defender, attacker, general, attackerGeneral, attacks, checkers, flights };
}

// ── Line replay ──────────────────────────────────────────────────────────────

type Ply = {
  index: number;
  solver: boolean;
  move: XiangqiMove;
  piece: XiangqiPiece;
  captured: XiangqiPiece | null;
  before: XiangqiGameState;
  after: XiangqiGameState;
  /** Attacker pieces checking the defender's general after this ply. */
  checkersAfter: Attack[];
};

function replay(puzzle: XiangqiPuzzle): { plies: Ply[]; final: XiangqiGameState } | null {
  if (puzzle.initial.status.type !== 'playing') return null;
  const solverColor = puzzle.initial.status.turn;
  const defender = other(solverColor);
  const plies: Ply[] = [];
  let state = puzzle.initial;
  for (const [index, move] of puzzle.solution.entries()) {
    if (state.status.type !== 'playing') return null;
    const piece = state.board[move.from];
    if (!piece) return null;
    const captured = state.board[move.to] ?? null;
    const after = applyStandardXiangqiMove(state, move);
    if (after === state) return null;
    const general = findGeneral(after.board, defender);
    const checkersAfter = general ? (attacksBy(after.board, solverColor).get(general) ?? []) : [];
    plies.push({
      index,
      solver: state.status.turn === solverColor,
      move,
      piece,
      captured,
      before: state,
      after,
      checkersAfter,
    });
    state = after;
  }
  return { plies, final: state };
}

// ── Detectors ────────────────────────────────────────────────────────────────

type Context = { final: Final; plies: Ply[]; puzzle: XiangqiPuzzle };

type Detector = (ctx: Context) => boolean;

const isRole = (attack: Attack, role: XiangqiPieceRole) => attack.role === role;

function screenPiece(final: Final, attack: Attack): XiangqiPiece | null {
  return attack.screen ? (final.board[attack.screen] ?? null) : null;
}

function pieces(board: XiangqiBoard, color: XiangqiColor, role: XiangqiPieceRole): XiangqiSquare[] {
  return (Object.entries(board) as [XiangqiSquare, XiangqiPiece][])
    .filter(([, piece]) => piece.color === color && piece.role === role)
    .map(([square]) => square);
}

/** Palace points relative to the defender: home e1/e10, centre e2/e9. */
function palace(defender: XiangqiColor) {
  const back = rankFromBack(defender, 1);
  const mid = rankFromBack(defender, 2);
  const front = rankFromBack(defender, 3);
  return {
    home: squareOf(4, back),
    centre: squareOf(4, mid),
    corners: [squareOf(3, back), squareOf(5, back), squareOf(3, front), squareOf(5, front)],
    frontCorners: [squareOf(3, front), squareOf(5, front)],
    backRank: back,
    /** 卧槽: the point in front of the edge elephants, one rank in from the back. */
    trough: [squareOf(2, mid), squareOf(6, mid)],
    /** 钓鱼: third file and third rank from the defender's edge. */
    fishing: [squareOf(2, front), squareOf(6, front)],
    /** 高钓: one rank higher than the fishing horse. */
    highFishing: [squareOf(2, rankFromBack(defender, 4)), squareOf(6, rankFromBack(defender, 4))],
  };
}

function oppositeCorner(defender: XiangqiColor, corner: XiangqiSquare): XiangqiSquare {
  const { file, rank } = coordOf(corner);
  const back = rankFromBack(defender, 1);
  const front = rankFromBack(defender, 3);
  return squareOf(file === 3 ? 5 : 3, rank === back ? front : back);
}

const emptyFlights = (final: Final) => final.flights.filter((f) => !f.ownBlock && !f.enemyPiece);

const DETECTORS: Record<XiangqiMotifId, Detector> = {
  // The general's only way out is a square nothing attacks, and it still cannot
  // go there because the attacker's general looks down that file.
  'bai-lian-jiang': ({ final }) =>
    final.checkers.length > 0 &&
    final.flights.some((f) => !f.ownBlock && !f.attacked && f.facingOnly),

  // A cannon checks and every neighbouring palace point is one of the
  // defender's own pieces, at least one of them an advisor.
  'men-gong': ({ final }) =>
    final.checkers.length === 1 &&
    isRole(final.checkers[0] as Attack, 'cannon') &&
    final.flights.length > 0 &&
    final.flights.every((f) => f.ownBlock !== null) &&
    final.flights.some((f) => f.ownBlock?.role === 'advisor'),

  // Same cage, any other checker.
  'men-sha': ({ final }) =>
    final.checkers.length > 0 &&
    !final.checkers.every((c) => isRole(c, 'cannon')) &&
    final.flights.length > 0 &&
    final.flights.every((f) => f.ownBlock !== null),

  // A flight square that nothing attacks is filled by a defender piece that
  // arrived there during the line: the defence walled its own general in.
  'chen-ya-jun': ({ final, plies }) => {
    if (final.checkers.length === 0) return false;
    const arrivals = new Set(plies.filter((p) => !p.solver).map((p) => p.move.to));
    return final.flights.some(
      (f) => f.ownBlock && !f.attacked && !f.facingOnly && arrivals.has(f.square),
    );
  },

  'chong-pao': ({ final }) =>
    final.checkers.some((c) => {
      const screen = screenPiece(final, c);
      return isRole(c, 'cannon') && screen?.color === final.attacker && screen.role === 'cannon';
    }),

  'ma-hou-pao': ({ final }) =>
    final.checkers.some((c) => {
      const screen = screenPiece(final, c);
      return isRole(c, 'cannon') && screen?.color === final.attacker && screen.role === 'horse';
    }),

  // One cannon on the centre file, another on the defender's back rank.
  'tian-di-pao': ({ final }) => {
    const cannons = pieces(final.board, final.attacker, 'cannon');
    const onCentre = cannons.filter((s) => coordOf(s).file === 4);
    const onBack = cannons.filter((s) => coordOf(s).rank === palace(final.defender).backRank);
    return onCentre.some((c) => onBack.some((b) => b !== c));
  },

  // A cannon on the general's file, at a distance, with nothing between them.
  // Not a check, and not the screen of one: an adjacent cannon that a rear
  // cannon jumps is 重炮, not this.
  'kong-tou-pao': ({ final }) =>
    pieces(final.board, final.attacker, 'cannon').some((cannon) => {
      if (final.checkers.some((c) => c.screen === cannon)) return false;
      const gap = between(cannon, final.general);
      return (
        gap !== null &&
        gap.length >= 1 &&
        coordOf(cannon).file === coordOf(final.general).file &&
        gap.every((s) => !final.board[s])
      );
    }),

  // A cannon holds the centre file (its ray, through one screen, reaches the
  // palace centre points), the general has been denied it, and a chariot or
  // soldier on the general's rib file delivers the check.
  'tie-men-shuan': ({ final }) => {
    const gFile = coordOf(final.general).file;
    if (gFile !== 3 && gFile !== 5) return false;
    const { home, centre } = palace(final.defender);
    const centreHeld = [home, centre].some((point) =>
      (final.attacks.get(point) ?? []).some(
        (a) => a.role === 'cannon' && coordOf(a.from).file === 4,
      ),
    );
    if (!centreHeld) return false;
    return final.checkers.some(
      (c) => (c.role === 'chariot' || c.role === 'soldier') && coordOf(c.from).file === gFile,
    );
  },

  'wo-cao-ma': ({ final }) => {
    const { home, trough } = palace(final.defender);
    return (
      final.general === home &&
      final.checkers.some((c) => c.role === 'horse' && trough.includes(c.from))
    );
  },

  'gua-jiao-ma': ({ final }) =>
    final.checkers.some(
      (c) => c.role === 'horse' && palace(final.defender).corners.includes(c.from),
    ),

  // A horse on one palace corner, the general frozen on the opposite corner,
  // someone else delivers the check.
  'ba-jiao-ma': ({ final }) => {
    const { corners } = palace(final.defender);
    if (!corners.includes(final.general)) return false;
    const opposite = oppositeCorner(final.defender, final.general);
    const horseThere = final.board[opposite];
    if (!horseThere || horseThere.color !== final.attacker || horseThere.role !== 'horse')
      return false;
    return final.checkers.length > 0 && !final.checkers.some((c) => c.from === opposite);
  },

  'diao-yu-ma': ({ final }) =>
    pieces(final.board, final.attacker, 'horse').some((h) =>
      palace(final.defender).fishing.includes(h),
    ) && final.checkers.some((c) => c.role === 'chariot'),

  'gao-diao-ma': ({ final }) =>
    pieces(final.board, final.attacker, 'horse').some((h) =>
      palace(final.defender).highFishing.includes(h),
    ) && final.checkers.some((c) => c.role === 'chariot'),

  // A solver horse move uncovers a chariot check along the line it left.
  'ba-huang-ma': ({ plies }) => plies.some((p) => discoveredCheck(p, 'horse', 'chariot')),

  // Two chariots on adjacent lines shear the general between them: the last
  // two solver moves are checks by different chariots, the second of them mate.
  'shuang-ju-cuo': ({ final, plies }) => {
    const solverPlies = plies.filter((p) => p.solver);
    const last = solverPlies.at(-1);
    const prev = solverPlies.at(-2);
    if (!last || !prev) return false;
    const chariotCheck = (p: Ply) =>
      p.piece.role === 'chariot' && p.checkersAfter.some((c) => c.from === p.move.to);
    if (!chariotCheck(last) || !chariotCheck(prev)) return false;
    const a = coordOf(last.move.to);
    const b = final.board[prev.move.to]?.role === 'chariot' ? coordOf(prev.move.to) : null;
    if (!b) return false;
    return (
      (a.file === b.file && Math.abs(a.rank - b.rank) === 1) ||
      (a.rank === b.rank && Math.abs(a.file - b.file) === 1) ||
      Math.abs(a.rank - b.rank) === 1 ||
      Math.abs(a.file - b.file) === 1
    );
  },

  'da-dan-chuan-xin': ({ final, plies }) =>
    plies.some(
      (p) =>
        p.solver &&
        p.piece.role === 'chariot' &&
        p.move.to === palace(final.defender).centre &&
        p.captured?.role === 'advisor',
    ),

  // The soldier takes the advisor on the palace centre. Merely stepping onto
  // an empty centre is not counted: that is every soldier mate via e9.
  'xiao-dao-wan-xin': ({ final, plies }) =>
    plies.some(
      (p) =>
        p.solver &&
        p.piece.role === 'soldier' &&
        p.move.to === palace(final.defender).centre &&
        p.captured?.role === 'advisor',
    ),

  // A solver chariot move uncovers a cannon check along the line it left.
  'ju-pao-chou-sha': ({ plies }) => plies.some((p) => discoveredCheck(p, 'chariot', 'cannon')),

  // A soldier checks with a second attacker soldier already in or on the
  // front of the palace.
  'er-gui-pai-men': ({ final }) => {
    const checkingSoldiers = final.checkers.filter((c) => c.role === 'soldier');
    if (checkingSoldiers.length === 0) return false;
    const { frontCorners } = palace(final.defender);
    return pieces(final.board, final.attacker, 'soldier').some((s) => {
      if (checkingSoldiers.some((c) => c.from === s)) return false;
      const { file, rank } = coordOf(s);
      return inPalace(final.defender, file, rank) || frontCorners.includes(s);
    });
  },

  // At least two solver soldier checks, the last of them the mate.
  'song-fo-gui-dian': ({ final, plies }) => {
    const soldierChecks = plies.filter(
      (p) =>
        p.solver && p.piece.role === 'soldier' && p.checkersAfter.some((c) => c.from === p.move.to),
    );
    return soldierChecks.length >= 2 && final.checkers.some((c) => c.role === 'soldier');
  },

  'lao-zu-sou-shan': ({ final }) =>
    final.checkers.some(
      (c) => c.role === 'soldier' && coordOf(c.from).rank === palace(final.defender).backRank,
    ),

  'shuang-zhao-jiang': ({ final }) => final.checkers.length >= 2,
};

/** The moving piece (`mover`) steps off a line and a `rear` piece behind it
 *  now checks along that line. */
function discoveredCheck(ply: Ply, mover: XiangqiPieceRole, rear: XiangqiPieceRole): boolean {
  if (!ply.solver || ply.piece.role !== mover) return false;
  const defender = other(ply.piece.color);
  const general = findGeneral(ply.after.board, defender);
  if (!general) return false;
  const before = attacksBy(ply.before.board, ply.piece.color).get(general) ?? [];
  return ply.checkersAfter.some((c) => {
    if (c.role !== rear || c.from === ply.move.to) return false;
    if (before.some((b) => b.from === c.from)) return false;
    const line = between(c.from, general);
    return line !== null && line.includes(ply.move.from);
  });
}

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * Named kill patterns a checkmate puzzle exhibits, in catalogue order. Empty
 * for winning-advantage puzzles and for a line that does not end in mate.
 */
export function detectXiangqiPuzzleMotifs(puzzle: XiangqiPuzzle): XiangqiMotifId[] {
  if (puzzle.goal.type !== 'checkmate') return [];
  const replayed = replay(puzzle);
  if (!replayed) return [];
  const { plies, final: state } = replayed;
  if (state.status.type !== 'finished') return [];
  if (state.status.reason !== 'checkmate' && state.status.reason !== 'stalemate') return [];
  if (puzzle.initial.status.type !== 'playing') return [];
  const defender = other(puzzle.initial.status.turn);
  const final = analyzeFinal(state, defender);
  if (!final) return [];
  const ctx: Context = { final, plies, puzzle };
  return XIANGQI_MOTIFS.filter((motif) => DETECTORS[motif.id](ctx)).map((motif) => motif.id);
}

/** Exposed for tests and the coverage report: the final-position analysis. */
export function analyzeXiangqiMatePosition(
  state: XiangqiGameState,
  defender: XiangqiColor,
): { general: XiangqiSquare; checkers: Attack[]; flights: Flight[] } | null {
  const final = analyzeFinal(state, defender);
  return final
    ? { general: final.general, checkers: final.checkers, flights: final.flights }
    : null;
}
