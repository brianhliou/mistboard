// Client side of postgame computer analysis (P3.5): POST the request, then turn
// the server's per-ply eval series into everything the UI shows — the advantage
// chart data, per-move judgments (glyphs), and per-player accuracy / ACPL. The
// win%/accuracy/judgment math is the shared, unit-tested code in @mistboard/game.
import {
  accuracyPercent,
  gameAccuracy,
  type MoveJudgment,
  moveJudgment,
  winPercent,
  winPercentK,
} from '@mistboard/game';
import { postAnalysisJob } from './analysis-job-poll.js';

/** One eval point from the server: position AFTER `ply` plies, from Red's POV. */
export type PlyEval = {
  ply: number;
  cp: number | null;
  mate: number | null;
  best: string | null;
  /** Engine principal variation from this position (same dialect as `best`),
   *  capped server-side. Feeds the inline refutation lines at judged moves;
   *  absent on rows cached before PV capture (the line degrades to `best`). */
  pv?: string[];
  /** Runner-up root move at this position (MultiPV rank 2), same POV and dialect
   *  as `best`, from the SAME search as `cp`/`mate` — so `cp` minus this is a real
   *  gap, not two searches differing by noise. Absent on rows cached before the
   *  MultiPV sweep, and at terminal / single-move positions. */
  second?: { move: string; cp: number | null; mate: number | null };
  /** For the move that REACHED this position: the engine's line after the opponent
   *  accepts a piece it offered, when the main line declines it. `pv` starts AFTER
   *  the capture. Present on the handful of plies that offer a declined piece. */
  offerLine?: { capture: string; pv: string[] };
  /** The server could not reconcile this eval with the ply after it: the move played from
   *  here came out BETTER for its mover than this position claimed was available, and a
   *  re-search at a larger budget did not close the gap (see reconcileJieqiSeries). The number
   *  still renders on the chart — it is the best the engine offered — but the two moves that
   *  touch it are graded against a value the engine itself contradicts, so neither is judged. */
  unstable?: boolean;
};

export type XiangqiGameAnalysisResponse = {
  engineId: string;
  depth: number;
  plies: PlyEval[];
  /** Plies whose move was a CHANCE move (a flip, in banqi/jungle-flip): the eval swing there
   *  mixes decision quality with the random reveal, so we can't yet attribute it to the player.
   *  Such moves are left UNJUDGED (no glyph, no "was best", not counted) until the engine can
   *  report per-move expected values (decision-vs-luck decomposition). Empty/absent for
   *  deterministic variants (xiangqi/jungle). */
  chancePlies?: number[];
};

/** Positive glyph: `!!` (a sound piece sacrifice) or `!` (the only good move). Computed by the
 *  variant's own rules from the eval series plus the board (see praiseMove on the engine
 *  presentation); absent for variants without such rules, and never on a judged move. */
export type MovePraise = 'brilliant' | 'great';

export type MoveAnalysis = {
  /** Ply this move lands on (1..N). */
  ply: number;
  mover: 'red' | 'black';
  judgment: MoveJudgment;
  /** This move's accuracy in [0, 100]. */
  accuracy: number;
  praise?: MovePraise;
};

export type PlayerAnalysis = {
  accuracy: number;
  inaccuracies: number;
  mistakes: number;
  blunders: number;
  /** Average centipawn loss. */
  acpl: number;
};

export type GameAnalysis = {
  engineId: string;
  depth: number;
  /** Red-POV eval per ply cursor (0..N). */
  evals: PlyEval[];
  moves: MoveAnalysis[];
  /** 1-based plies whose move was a chance (reveal) move — left unjudged here; graded luck-free by
   *  the decision decomposition (see mergeDecisionAnalysis). Empty for deterministic variants. */
  chancePlies: number[];
  /** 1-based plies whose move is graded against an eval the server flagged `unstable` —
   *  ungraded here, and excluded from accuracy/ACPL. Empty for every variant but jieqi. */
  unstablePlies: number[];
  /** 1-based plies where the move played WAS the engine's own best move for the position before
   *  it (see computeGameAnalysis opts.bestPlayedPlies). Ungraded and scored 100. */
  bestPlayedPlies: number[];
  red: PlayerAnalysis;
  black: PlayerAnalysis;
};

/** Lichess-style move glyph for a judgment: ?! inaccuracy, ? mistake, ?? blunder.
 *  Returns null for a fine move (no glyph). `suffixClass` matches the
 *  .review-move--<class> colour hooks in move-list.css. */
export function judgmentGlyph(
  judgment: MoveJudgment,
): { suffix: string; suffixClass: string } | null {
  switch (judgment) {
    case 'blunder':
      return { suffix: '??', suffixClass: 'blunder' };
    case 'mistake':
      return { suffix: '?', suffixClass: 'mistake' };
    case 'inaccuracy':
      return { suffix: '?!', suffixClass: 'inaccuracy' };
    default:
      return null;
  }
}

/** Move glyph for a positive verdict: !! brilliant, ! great. `suffixClass` matches the
 *  .review-move--<class> colour hooks in move-list.css. */
export function praiseGlyph(
  praise: MovePraise | undefined,
): { suffix: string; suffixClass: string } | null {
  switch (praise) {
    case 'brilliant':
      return { suffix: '!!', suffixClass: 'brilliant' };
    case 'great':
      return { suffix: '!', suffixClass: 'great' };
    default:
      return null;
  }
}

/** Attach positive verdicts to an analysis. A judged move (an error by the engine's own
 *  reckoning) is never praised, whatever the map says. Returns the same object when the map is
 *  empty. */
export function withPraise(
  analysis: GameAnalysis,
  praiseByPly: ReadonlyMap<number, MovePraise>,
): GameAnalysis {
  if (praiseByPly.size === 0) return analysis;
  return {
    ...analysis,
    moves: analysis.moves.map((move) => {
      const praise = move.judgment === null ? praiseByPly.get(move.ply) : undefined;
      return praise ? { ...move, praise } : move;
    }),
  };
}

const ACPL_CAP = 1000;

/** Centipawns from a side's POV, capped so a decisive eval / mate can't blow up ACPL. */
function moverCp(cpRed: number | null, mate: number | null, mover: 'red' | 'black'): number {
  const sign = mover === 'red' ? 1 : -1;
  if (mate != null) return mate * sign >= 0 ? ACPL_CAP : -ACPL_CAP;
  return sign * Math.max(-ACPL_CAP, Math.min(ACPL_CAP, cpRed ?? 0));
}

/** Turn the Red-POV eval series into per-move judgments + per-player aggregates.
 *  `firstMover` attributes ply parity — a FEN-seeded composition can open with
 *  black to move, flipping which side owns each ply (default red, ply 1).
 *  `bestPlayedPlies` marks plies where the player found the engine's OWN best move (see the
 *  guard below); callers that can't resolve the engine's UCI dialect omit it. */
export function computeGameAnalysis(
  response: XiangqiGameAnalysisResponse,
  opts?: { firstMover?: 'red' | 'black'; bestPlayedPlies?: ReadonlySet<number> },
): GameAnalysis {
  const firstMover = opts?.firstMover ?? 'red';
  const evals = [...response.plies].sort((a, b) => a.ply - b.ply);
  const moves: MoveAnalysis[] = [];
  // Stored cp are on the analysing engine's own scale (AB-JChess's are steeper than
  // PikaJieQi's), so they become win% on that engine's curve, named by the stored engineId.
  const winK = winPercentK(response.engineId);
  const redWinPercents = evals.map((entry) => winPercent(entry.cp, entry.mate, winK));
  // A move that IS the engine's best move for the position before it can never be an error
  // BY THAT ENGINE, whatever the realized swing says. The swing can still be negative: the
  // pre-move eval and the post-move eval come from two INDEPENDENT searches, so a horizon
  // shift between them shows up as a "loss" the player had no way to avoid. Judging it
  // produces the self-contradiction "Mistake. b1-b2 was best." on the move b1-b2. So these
  // plies are ungraded (no glyph, no advice), scored 100, and cost no centipawns.
  // CHANCE moves (flips) are left unjudged: their eval swing conflates decision quality with
  // the random reveal, so grading them on outcome would blame the player for variance. Until
  // the engine reports per-move expected values, we neither glyph nor count them.
  const chancePlies = new Set(response.chancePlies ?? []);
  // An eval the server flagged as irreconcilable with its neighbour taints BOTH moves that
  // touch it: the move that landed on it (graded on it as the "after") and the move played
  // from it (graded on it as the "before"). Neither swing is the player's doing, so both go
  // unjudged — the same treatment, for the same reason, that a chance ply already gets. This
  // is the residual the server could not fix by searching harder; the common case (a horizon
  // that a bigger budget resolves) never reaches here.
  const unstablePlies = new Set<number>();
  evals.forEach((evaluation, index) => {
    if (!evaluation.unstable) return;
    if (index >= 1) unstablePlies.add(index);
    if (index + 1 < evals.length) unstablePlies.add(index + 1);
  });
  // A chance ply stays chance-graded even if the reveal it chose was the engine's pick — its
  // decomposition (mergeDecisionAnalysis) owns that grade, and a flat 100 would overwrite it.
  const bestPlayed = new Set(
    [...(opts?.bestPlayedPlies ?? [])].filter((ply) => !chancePlies.has(ply)),
  );
  const acc: Record<'red' | 'black', { losses: number[]; i: number; m: number; b: number }> = {
    red: { losses: [], i: 0, m: 0, b: 0 },
    black: { losses: [], i: 0, m: 0, b: 0 },
  };

  for (let ply = 1; ply < evals.length; ply += 1) {
    const before = evals[ply - 1]!;
    const after = evals[ply]!;
    const mover: 'red' | 'black' =
      ply % 2 === 1 ? firstMover : firstMover === 'red' ? 'black' : 'red';
    // Win% from the mover's POV: Red POV as-is, Black POV is its complement.
    const redBefore = redWinPercents[ply - 1]!;
    const redAfter = redWinPercents[ply]!;
    const winBefore = mover === 'red' ? redBefore : 100 - redBefore;
    const winAfter = mover === 'red' ? redAfter : 100 - redAfter;
    const isChance = chancePlies.has(ply);
    const isUnstable = unstablePlies.has(ply);
    const isBestPlayed = bestPlayed.has(ply);
    const judgment =
      isChance || isUnstable || isBestPlayed ? null : moveJudgment(winBefore, winAfter);
    const accuracy = isBestPlayed ? 100 : accuracyPercent(winBefore, winAfter);
    moves.push({ ply, mover, judgment, accuracy });

    // A chance move doesn't contribute to a player's mistake counts or ACPL — we can't say the
    // swing was their fault (or credit).
    if (isChance || isUnstable) continue;
    const bucket = acc[mover];
    bucket.losses.push(
      isBestPlayed
        ? 0
        : Math.max(
            0,
            moverCp(before.cp, before.mate, mover) - moverCp(after.cp, after.mate, mover),
          ),
    );
    if (judgment === 'inaccuracy') bucket.i += 1;
    else if (judgment === 'mistake') bucket.m += 1;
    else if (judgment === 'blunder') bucket.b += 1;
  }

  // Whole-game accuracy is lila's volatility-weighted + harmonic blend — NOT a
  // plain mean of per-move accuracies (which reads flatteringly high). CHANCE (reveal) plies are
  // dropped here so this base grades only the moves a player fully controls — a reveal's swing is
  // luck. For chance variants this base is provisional: mergeDecisionAnalysis re-grades the reveals
  // luck-free once the decomposition loads. Empty map for deterministic variants (unchanged).
  // Best-played plies are pinned to 100 in the same override map (a move that matched the
  // engine's own choice is 100% accurate by definition, whatever the two-search drift says).
  const accuracyOverride = new Map<number, number | null>([
    ...[...chancePlies].map((ply): [number, number | null] => [ply, null]),
    ...[...unstablePlies].map((ply): [number, number | null] => [ply, null]),
    ...[...bestPlayed].map((ply): [number, number | null] => [ply, 100]),
  ]);
  const accuracies = gameAccuracy(
    redWinPercents,
    accuracyOverride.size ? accuracyOverride : undefined,
  );

  const summarize = (side: 'red' | 'black'): PlayerAnalysis => {
    const b = acc[side];
    return {
      accuracy: side === firstMover ? accuracies.first : accuracies.second,
      inaccuracies: b.i,
      mistakes: b.m,
      blunders: b.b,
      acpl: Math.round(mean(b.losses)),
    };
  };

  return {
    engineId: response.engineId,
    depth: response.depth,
    evals,
    moves,
    chancePlies: [...chancePlies].sort((a, b) => a - b),
    unstablePlies: [...unstablePlies].sort((a, b) => a - b),
    bestPlayedPlies: [...bestPlayed].sort((a, b) => a - b),
    red: summarize('red'),
    black: summarize('black'),
  };
}

/** Re-grade an already-computed analysis once the caller knows which plies played the engine's
 *  own best move. The review surface only learns this after the move tree exists (the engine's
 *  UCI dialect has to be decoded against each position), so the analysis is computed first and
 *  regraded here rather than threading the moves through the fetch. */
export function regradeBestPlayed(
  analysis: GameAnalysis,
  bestPlayedPlies: ReadonlySet<number>,
): GameAnalysis {
  if (bestPlayedPlies.size === 0) return analysis;
  return computeGameAnalysis(
    {
      engineId: analysis.engineId,
      depth: analysis.depth,
      plies: analysis.evals,
      chancePlies: analysis.chancePlies,
    },
    { firstMover: analysis.moves[0]?.mover ?? 'red', bestPlayedPlies },
  );
}

/** Game-phase boundaries as MOVE plies: `middle` = the first middlegame move,
 *  `end` = the first endgame move. Absent field = the game never reached that
 *  phase. Computed per variant (see xiangqi-phases.ts); drives the advantage
 *  chart's dividers and the summary's per-phase accuracy. */
export type GamePhases = { middle?: number; end?: number };

export type PhaseAccuracies = { opening?: number; middlegame?: number; endgame?: number };

/** Plain-mean accuracy of one player's moves inside each phase (chance/reveal
 *  plies excluded — their realized swing is luck). A phase the player never moved
 *  in is absent. This is the summary's "96% Opening" column, not the headline
 *  accuracy (which stays lila's volatility-weighted blend). */
export function playerPhaseAccuracies(
  analysis: GameAnalysis,
  phases: GamePhases,
  mover: 'red' | 'black',
): PhaseAccuracies {
  const chance = new Set(analysis.chancePlies);
  const lastPly = analysis.moves.at(-1)?.ply ?? 0;
  const segment = (from: number, to: number): number | undefined => {
    const accs = analysis.moves
      .filter((m) => m.mover === mover && m.ply >= from && m.ply <= to && !chance.has(m.ply))
      .map((m) => m.accuracy);
    if (accs.length === 0) return undefined;
    return accs.reduce((sum, a) => sum + a, 0) / accs.length;
  };
  const { middle, end } = phases;
  if (!middle) return { opening: segment(1, lastPly) };
  if (!end) return { opening: segment(1, middle - 1), middlegame: segment(middle, lastPly) };
  return {
    opening: segment(1, middle - 1),
    middlegame: segment(middle, end - 1),
    endgame: segment(end, lastPly),
  };
}

/** A reveal ply's luck-free decision grade, from the decomposition (see review/jieqi-decisions). */
export type PlyDecision = {
  /** Accuracy in [0, 100] of the CHOICE (best-vs-played pool means), luck stripped. */
  accuracy: number;
  /** Judgment of the choice (?!/?/??), already deadband-guarded. null = a fine choice. */
  judgment: MoveJudgment;
};

/**
 * Fold the decision-vs-luck decomposition into the headline per-player analysis for a chance
 * variant (jieqi). The base computeGameAnalysis leaves reveal plies unjudged (their realized swing
 * is luck); here we grade EVERY move luck-free — reveals via their pool-mean decision grade, quiet
 * moves via the realized swing — so the accuracy and the inaccuracy/mistake/blunder counts finally
 * reflect how the player actually chose. ACPL is intentionally dropped (centipawn loss can't be
 * luck-stripped and reads as noise here). A reveal with no decision entry is left ungraded.
 */
export function mergeDecisionAnalysis(
  analysis: GameAnalysis,
  decisionByPly: ReadonlyMap<number, PlyDecision>,
): { red: PlayerAnalysis; black: PlayerAnalysis } {
  const winK = winPercentK(analysis.engineId);
  const redWinPercents = analysis.evals.map((e) => winPercent(e.cp, e.mate, winK));
  const chance = new Set(analysis.chancePlies);
  const override = new Map<number, number | null>();
  const counts: Record<'red' | 'black', { i: number; m: number; b: number }> = {
    red: { i: 0, m: 0, b: 0 },
    black: { i: 0, m: 0, b: 0 },
  };
  const bump = (side: 'red' | 'black', judgment: MoveJudgment): void => {
    if (judgment === 'inaccuracy') counts[side].i += 1;
    else if (judgment === 'mistake') counts[side].m += 1;
    else if (judgment === 'blunder') counts[side].b += 1;
  };
  for (const move of analysis.moves) {
    if (chance.has(move.ply)) {
      const decision = decisionByPly.get(move.ply);
      if (!decision) {
        override.set(move.ply, null); // a reveal we couldn't decompose — leave it ungraded
        continue;
      }
      override.set(move.ply, decision.accuracy);
      bump(move.mover, decision.judgment);
    } else {
      // Quiet (fully-controlled) move: its realized judgment already stands.
      bump(move.mover, move.judgment);
    }
  }
  const accuracies = gameAccuracy(redWinPercents, override);
  const build = (side: 'red' | 'black', accuracy: number): PlayerAnalysis => ({
    accuracy,
    inaccuracies: counts[side].i,
    mistakes: counts[side].m,
    blunders: counts[side].b,
    acpl: 0, // not shown for chance variants (see AnalysisSummaryOptions.hideAcpl)
  });
  return { red: build('red', accuracies.first), black: build('black', accuracies.second) };
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

// The analysis endpoint is per-variant (`/api/<variant>/games/:id/analysis`); the
// wire shape + all derived-view math are variant-neutral, so only the URL segment
// differs. Callers pass the game-spec route id ('xiangqi', 'fortress-xiangqi', …).
function analysisUrl(variant: string, roomId: string): string {
  return new URL(
    `/api/${variant}/games/${encodeURIComponent(roomId)}/analysis`,
    window.location.href,
  ).pathname;
}

/** POST the analysis request for a finished game and compute the derived view.
 *  A cached game answers immediately (200); otherwise the server enqueues a
 *  background job (202) and this polls it to completion (see analysis-job-poll). */
export async function requestGameAnalysis(variant: string, roomId: string): Promise<GameAnalysis> {
  const body = await postAnalysisJob<XiangqiGameAnalysisResponse>(analysisUrl(variant, roomId));
  return computeGameAnalysis(body);
}

/** GET the already-cached analysis, or null if it hasn't been computed yet (204).
 *  Never triggers an engine pass, so the postgame can auto-load on open. */
export async function fetchCachedGameAnalysis(
  variant: string,
  roomId: string,
): Promise<GameAnalysis | null> {
  const response = await fetch(analysisUrl(variant, roomId), { method: 'GET' });
  if (response.status === 204 || !response.ok) return null;
  return computeGameAnalysis((await response.json()) as XiangqiGameAnalysisResponse);
}
