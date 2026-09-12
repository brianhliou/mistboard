// Shared Fog-of-War vision walks for the xiangqi-family boards: full Xiangqi
// and Dark Mini Xiangqi. The cannon screen-walk, the horse blocked-leg walk,
// and the rook/slider ray walk were byte-identical across the variant kernels
// except for the board geometry — so a fog-leak fix in one copy had to be
// hand-replicated into the others. This is the single geometry-parameterized
// source for those three walks.
//
// Pieces whose vision rules genuinely differ per variant (general/advisor/
// elephant/soldier/pawn — palace, river, facing-general, two-square-pawn) stay
// in their own variant kernel. Only the shared walks live here.

// What the dispatch layer accumulates while computing one color's vision.
// `Sq` is the variant's square-string type (XiangqiSquare, MiniXiangqiSquare),
// so the sets stay strongly typed per variant.
export type VisionAccum<Sq extends string> = {
  directlyVisible: Set<Sq>;
  shroudedBlockers: Set<Sq>;
  cannonScreens: Set<Sq>;
  cannonTargets: Set<Sq>;
  // Empty squares between a cannon's screen and its target. Tracked for
  // diagnostics/markers; player views keep them fogged because the cannon
  // cannot legally land there.
  cannonPath: Set<Sq>;
};

export function emptyVision<Sq extends string>(): VisionAccum<Sq> {
  return {
    directlyVisible: new Set(),
    shroudedBlockers: new Set(),
    cannonScreens: new Set(),
    cannonTargets: new Set(),
    cannonPath: new Set(),
  };
}

// The board geometry the shared walks need, built once per computeVision pass
// and bound to the concrete board + the moving color. Keeping the walks behind
// this probe is what makes them geometry- and color-agnostic.
export type VisionProbe<Sq extends string> = {
  inBounds(file: number, rank: number): boolean;
  squareOf(file: number, rank: number): Sq;
  // On-board and holding any piece.
  isOccupied(file: number, rank: number): boolean;
  // On-board and holding an enemy of the moving piece.
  isEnemyAt(file: number, rank: number): boolean;
};

type Step = readonly [number, number];
type HorseLeg = readonly [number, number, number, number];

// The 8 horse/knight L-jumps, each with its blocking leg: [df, dr, legDf, legDr].
export const HORSE_JUMPS: readonly HorseLeg[] = [
  [1, 2, 0, 1],
  [1, -2, 0, -1],
  [-1, 2, 0, 1],
  [-1, -2, 0, -1],
  [2, 1, 1, 0],
  [2, -1, 1, 0],
  [-2, 1, -1, 0],
  [-2, -1, -1, 0],
];

// The 4 orthogonal rays the cannon (and a chariot) walk.
export const ORTHOGONAL_STEPS: readonly Step[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

// Rook-like ray walk: include each square along each direction, stopping after
// the first occupied square (which is itself included).
export function slideVisionInto<Sq extends string>(
  set: Set<Sq>,
  probe: VisionProbe<Sq>,
  directions: readonly Step[],
  file: number,
  rank: number,
): void {
  for (const [df, dr] of directions) {
    let f = file + df;
    let r = rank + dr;
    while (probe.inBounds(f, r)) {
      set.add(probe.squareOf(f, r));
      if (probe.isOccupied(f, r)) break;
      f += df;
      r += dr;
    }
  }
}

// Horse/knight with the Chinese-chess blocked-leg rule: a blocked leg hides the
// destinations it controls and surfaces the leg square as occupied-but-unknown.
export function horseVisionInto<Sq extends string>(
  accum: VisionAccum<Sq>,
  probe: VisionProbe<Sq>,
  file: number,
  rank: number,
): void {
  for (const [df, dr, legDf, legDr] of HORSE_JUMPS) {
    const legF = file + legDf;
    const legR = rank + legDr;
    const destF = file + df;
    const destR = rank + dr;
    if (!probe.inBounds(destF, destR) || !probe.inBounds(legF, legR)) continue;
    if (probe.isOccupied(legF, legR)) {
      accum.shroudedBlockers.add(probe.squareOf(legF, legR));
    } else {
      accum.directlyVisible.add(probe.squareOf(destF, destR));
    }
  }
}

// Cannon screen-walk along each orthogonal ray:
//   1. empty squares up to the first piece -> quiet-move targets, visible.
//   2. the first piece is the SCREEN, always visible.
//   3. empty squares past the screen are capture-path candidates (kept fogged).
//   4. an ENEMY past the screen is a capture target, and promotes the candidates.
//   5. no enemy target (own piece, or off board) -> vision ends at the screen.
export function cannonVisionInto<Sq extends string>(
  accum: VisionAccum<Sq>,
  probe: VisionProbe<Sq>,
  file: number,
  rank: number,
): void {
  for (const [df, dr] of ORTHOGONAL_STEPS) {
    let f = file + df;
    let r = rank + dr;
    // Phase 1: empty squares up to the screen.
    while (probe.inBounds(f, r) && !probe.isOccupied(f, r)) {
      accum.directlyVisible.add(probe.squareOf(f, r));
      f += df;
      r += dr;
    }
    if (!probe.inBounds(f, r)) continue;
    // Phase 2: the screen.
    accum.cannonScreens.add(probe.squareOf(f, r));
    f += df;
    r += dr;
    // Phase 3: collect empty squares past the screen as candidates.
    const candidates: Sq[] = [];
    while (probe.inBounds(f, r) && !probe.isOccupied(f, r)) {
      candidates.push(probe.squareOf(f, r));
      f += df;
      r += dr;
    }
    if (!probe.inBounds(f, r)) continue;
    // Phase 4: only an enemy target counts (and promotes the candidates).
    if (!probe.isEnemyAt(f, r)) continue;
    for (const sq of candidates) accum.cannonPath.add(sq);
    accum.cannonTargets.add(probe.squareOf(f, r));
  }
}
