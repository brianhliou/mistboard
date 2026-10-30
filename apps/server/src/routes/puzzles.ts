import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  attemptJunglePuzzleLine,
  attemptStandardXiangqiPuzzleLine,
  isXiangqiTrainingTagId,
  JUNGLE_SPEC_ID,
  type JungleMove,
  type JunglePuzzle,
  junglePuzzleNextMove,
  junglePuzzleSideToMove,
  resolvePuzzleShortCode,
  standardXiangqiPuzzleNextMove,
  standardXiangqiPuzzleSideToMove,
  XIANGQI_MOTIFS,
  XIANGQI_SPEC_ID,
  XIANGQI_TRAINING_TAGS,
  type XiangqiMotifId,
  type XiangqiMove,
  type XiangqiPuzzle,
  type XiangqiTrainingTagId,
} from '@mistboard/game';
import { currentAccountUser } from '../account-session.js';
import { createAuthRateLimiter } from '../auth-rate-limit.js';
import { isPlayDisabled, isInitialized as persistenceInitialized } from '../persistence.js';
import { getHistoricalXiangqiPuzzleSourceGame } from '../persistence-historical-xiangqi.js';
import {
  isPuzzleQualitySessionId,
  listPuzzleServingEvidence,
  type PuzzleQualityPlayer,
  type PuzzleQualityVote,
  parsePuzzleDeviceId,
  recordPuzzleQualityEvent,
  recordPuzzleQualityVote,
} from '../persistence-puzzle-quality.js';
import {
  getPuzzleRating,
  getUserPuzzleRating,
  listAttemptedPuzzleIds,
  listFailedPuzzleAttempts,
  listPuzzleAttemptHistory,
  listPuzzleRatingSummaries,
  recordPuzzleAttempt,
} from '../persistence-puzzle-ratings.js';
import { getPuzzleStreak } from '../persistence-puzzle-streak.js';
import {
  currentDailyPuzzleDay,
  getOrCreateDailyPuzzleSelection,
  parseDailyPuzzleSlot,
} from '../persistence-puzzles.js';
import {
  type PuzzleServingEvidence,
  puzzleServingRating,
  seedPuzzleRating,
} from '../puzzle-rating.js';
import { type PuzzleDetailSourceFields, puzzleDetailSourceFields } from '../puzzle-setup-move.js';
import { getPuzzleStore, type PuzzleStoreSnapshot } from '../puzzle-store.js';
import {
  bestPuzzleStreak,
  loadPuzzleStreak,
  orderedPuzzleRamp,
  recentStreakPuzzleIds,
  type StreakRun,
  savePuzzleStreak,
  shuffledPuzzleRamp,
  startPuzzleStreak,
} from '../puzzle-streak.js';
import { clientIpForRateLimit } from '../server-policy.js';
import { rememberExcludedDevice } from '../stats-excluded-device.js';
import { type HttpApiContext, readJsonBody, requireMethod, writeJson } from './lib.js';

// High enough for fast play, low enough to prevent unbounded anonymous UUID
// insertion. The IP key stays only in process memory and is never persisted.
const puzzleQualityRateLimiter = createAuthRateLimiter(300, 60_000);
const streakStartRateLimiter = createAuthRateLimiter(30, 60_000);
const streakMoveRateLimiter = createAuthRateLimiter(300, 60_000);

// The public puzzle surface spans the Jungle registry and the standard-xiangqi
// registry. Fortress Xiangqi's registry was deleted with the variant
// (2026-10-11): its ids miss the store, so every route here answers them with
// 404 not_found, and `?variant=fortress-xiangqi` is an invalid filter (400).
// Content comes from the puzzle store (#183: the `puzzles` table, backed by
// the committed seed; the seed alone when persistence is off). Ids are
// prefix-disjoint across registries, so resolution scans one map, but every
// behavioural branch dispatches on `variant` (fail-closed: a new registry
// needs an explicit branch, not a fallthrough — the store already withholds
// unknown variants from serving).
export type PublicPuzzle = JunglePuzzle | XiangqiPuzzle;
type PublicPuzzleVariant = typeof JUNGLE_SPEC_ID | typeof XIANGQI_SPEC_ID;
type PublicPuzzleMove = JungleMove | XiangqiMove;

// Jungle is omitted from the discoverable pool (list + random) while its
// puzzle surface is parked. Its puzzles stay resolvable by id/short-code below
// (puzzleById scans the whole store), so existing links do not hard-404.
// Remove a variant from this filter to surface it again.
const UNDISCOVERABLE_PUZZLE_VARIANTS: ReadonlySet<string> = new Set([JUNGLE_SPEC_ID]);

function discoverablePuzzles(store: PuzzleStoreSnapshot): PublicPuzzle[] {
  return store.puzzles.filter((puzzle) => !UNDISCOVERABLE_PUZZLE_VARIANTS.has(puzzle.variant));
}

type PuzzleSummary = {
  id: string;
  variant: PublicPuzzleVariant;
  title: string;
  sideToMove: ReturnType<typeof standardXiangqiPuzzleSideToMove>;
  goal: PublicPuzzle['goal'];
  themes: readonly string[];
  /** Named kill patterns (杀法) by id; empty outside standard-xiangqi mates. */
  motifs: readonly XiangqiMotifId[];
  /**
   * Every trainer tag, derived at load: the motifs plus mate-in-N, phase,
   * goal and length. Empty outside standard xiangqi.
   */
  tags: readonly XiangqiTrainingTagId[];
  solutionPlyCount: number;
  rating: number;
  ratingProvisional: boolean;
  /** What the queue matches a player against (#712): the rating folded with
   *  solution length and observed outcomes. List responses only. */
  servingRating?: number;
};

type PuzzleDetail = PuzzleSummary & {
  initial: PublicPuzzle['initial'];
  // The "From game" card's attribution (standard-xiangqi mined puzzles only),
  // and, from the stored source game: the setup move with what it captured
  // (#664) and the game's moves before it. See puzzle-setup-move.ts.
} & PuzzleDetailSourceFields;

export async function tryHandle(
  _ctx: HttpApiContext,
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  parsedUrl: URL,
): Promise<boolean> {
  if (pathname === '/api/puzzles/ramp') {
    if (!requireMethod(request, response, 'GET')) return true;
    const variant = parsePuzzleVariant(parsedUrl.searchParams.get('variant')) ?? XIANGQI_SPEC_ID;
    if (variant === 'invalid') {
      writeJson(response, 400, { error: 'invalid_variant' });
      return true;
    }
    writeJson(response, 200, { puzzles: await ratedPuzzleRamp(variant) });
    return true;
  }

  if (pathname === '/api/puzzles/streak') {
    if (!requireMethod(request, response, 'POST')) return true;
    if (await refusedForPlayLock(request, response)) return true;
    const body = await readJsonBody(request);
    const user = await currentAccountUser(request);
    if (body.action === 'start') {
      if (!streakStartRateLimiter.check(clientIpForRateLimit(request))) {
        writeJson(response, 429, { error: 'rate_limited' });
        return true;
      }
      // Each run draws its own climb, away from the player's recent runs: an
      // account's from the database, a guest's as the browser lists them.
      const avoid = await recentStreakPuzzleIds(user?.id ?? null);
      for (const id of parseRecentPuzzleIds(body.recent)) avoid.add(id);
      const ramp = shuffledPuzzleRamp(await rampPool(XIANGQI_SPEC_ID), { avoid });
      const run = await startPuzzleStreak(
        ramp.map((p) => p.id),
        user?.id ?? null,
      );
      writeJson(response, 200, await streakResponse(run));
      return true;
    }
    if (
      (body.action !== 'move' && body.action !== 'skip' && body.action !== 'resume') ||
      !isPuzzleQualitySessionId(body.runId)
    ) {
      writeJson(response, 400, { error: 'invalid_streak_action' });
      return true;
    }
    if (!streakMoveRateLimiter.check(clientIpForRateLimit(request))) {
      writeJson(response, 429, { error: 'rate_limited' });
      return true;
    }
    const run = await loadPuzzleStreak(body.runId);
    // An anonymous run is usable only anonymously; signing in starts a new
    // owned run. Never accept a user id or score supplied by the browser.
    if (!run || run.userId !== (user?.id ?? null)) {
      writeJson(response, 404, { error: 'streak_not_found' });
      return true;
    }
    const state = run.state;
    // A reload or back/forward picks the tab's open run up again rather than
    // starting another. The board comes back at the puzzle's start, so a line
    // half played is dropped and the player plays it again from move one.
    if (body.action === 'resume') {
      if (state.finished) {
        writeJson(response, 409, { error: 'streak_action_unavailable' });
        return true;
      }
      if (state.moves.length) {
        state.moves = [];
        if (!(await savePuzzleStreak(run))) {
          writeJson(response, 409, { error: 'streak_action_unavailable' });
          return true;
        }
      }
      writeJson(response, 200, await streakResponse(run));
      return true;
    }
    const id = state.ids[state.results.length];
    if (state.finished || id !== body.puzzleId || (body.action === 'skip' && state.skipUsed)) {
      writeJson(response, 409, { error: 'streak_action_unavailable' });
      return true;
    }
    let attempt: PuzzleAttempt | undefined;
    // The line that ended the run, sent once the run can no longer change, so
    // the end screen plays it out on the board without a separate reveal call
    // (which would book a quality 'reveal' the player never asked for).
    let solution: readonly unknown[] | undefined;
    if (body.action === 'skip') {
      state.skipUsed = true;
      state.results.push({ id, outcome: 'skipped' });
      state.moves = [];
    } else {
      const moves = parsePuzzleMoves([body.move]);
      const qualitySessionId = parseOptionalQualitySessionId(body.qualitySessionId);
      if (!moves || qualitySessionId === 'invalid') {
        writeJson(response, 400, { error: 'invalid_moves' });
        return true;
      }
      const puzzle = await puzzleById(id);
      if (!puzzle) {
        writeJson(response, 404, { error: 'not_found' });
        return true;
      }
      attempt = attemptPuzzle(puzzle, [...state.moves, ...moves]);
      // Only a wrong answer ends a run. Checker errors neither change the
      // canonical run nor count as wrong quality events, as on /attempt.
      if (!attempt.ok && attempt.code !== 'incorrect-move') {
        writeJson(response, 200, { ...(await streakResponse(run)), attempt });
        return true;
      }
      if (!attempt.ok) {
        state.finished = true;
        state.results.push({ id, outcome: 'failed' });
        solution = puzzle.solution;
      } else if (attempt.complete) {
        state.score++;
        state.results.push({ id, outcome: 'solved' });
        state.moves = [];
      } else {
        state.moves = [...state.moves, ...moves] as XiangqiMove[];
      }
    }
    state.finished ||= state.results.length >= state.ids.length;
    if (!(await savePuzzleStreak(run))) {
      writeJson(response, 409, { error: 'streak_action_unavailable' });
      return true;
    }
    if (attempt && isPuzzleQualitySessionId(body.qualitySessionId)) {
      await recordPuzzleQualityEvent({
        puzzleId: id,
        sessionId: body.qualitySessionId,
        variant: XIANGQI_SPEC_ID,
        event: !attempt.ok ? 'wrong' : attempt.complete ? 'solve' : 'start',
      }).catch(() => {});
    }
    // Streak deliberately never calls recordOutcomeRating: these attempts do
    // not change puzzle/user ratings or the separate daily-solve streak.
    writeJson(response, 200, {
      ...(await streakResponse(run)),
      ...(attempt ? { attempt } : {}),
      ...(solution ? { solution } : {}),
    });
    return true;
  }

  if (pathname === '/api/puzzles') {
    if (!requireMethod(request, response, 'GET')) return true;
    const variant = parsePuzzleVariant(parsedUrl.searchParams.get('variant'));
    if (variant === 'invalid') {
      writeJson(response, 400, { error: 'invalid_variant' });
      return true;
    }
    const motif = parsePuzzleMotif(parsedUrl.searchParams.get('motif'));
    if (motif === 'invalid') {
      writeJson(response, 400, { error: 'invalid_motif' });
      return true;
    }
    // `theme` takes any trainer tag (a kill pattern, mate-in-N, phase, goal or
    // length); `motif` stays for the kill patterns alone. Both intersect.
    const theme = parsePuzzleTrainingTag(parsedUrl.searchParams.get('theme'));
    if (theme === 'invalid') {
      writeJson(response, 400, { error: 'invalid_theme' });
      return true;
    }
    const store = await getPuzzleStore();
    const discoverable = discoverablePuzzles(store);
    const variantPuzzles = variant
      ? discoverable.filter((puzzle) => puzzle.variant === variant)
      : discoverable;
    const puzzles = variantPuzzles.filter(
      (puzzle) =>
        (!motif || store.motifsById.get(puzzle.id)?.includes(motif)) &&
        (!theme || store.tagsById.get(puzzle.id)?.includes(theme)),
    );
    // Counts describe the variant's whole discoverable pool, so selecting one
    // theme does not erase the other choices. Hidden/withheld puzzles never count.
    const counts = new Map<XiangqiMotifId, number>();
    const tagCounts: Partial<Record<XiangqiTrainingTagId, number>> = {};
    for (const id of XIANGQI_MOTIFS.map((m) => m.id)) tagCounts[id] = 0;
    for (const tag of XIANGQI_TRAINING_TAGS) tagCounts[tag.id] = 0;
    for (const puzzle of variantPuzzles) {
      for (const id of store.motifsById.get(puzzle.id) ?? []) {
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
      for (const id of store.tagsById.get(puzzle.id) ?? []) {
        tagCounts[id] = (tagCounts[id] ?? 0) + 1;
      }
    }
    const ratings = await listPuzzleRatingSummaries(puzzles.map((puzzle) => puzzle.id));
    const evidence = await servingEvidence();
    // Signed-in visitors also get what they have already finished, so rotation
    // survives a cleared browser or a second device. Anonymous visitors get an
    // empty list and fall back to the localStorage seen-set alone.
    const user = await currentAccountUser(request);
    const attemptedIds = user ? await listAttemptedPuzzleIds(user.id, variant ?? undefined) : [];
    writeJson(response, 200, {
      puzzles: puzzles.map((puzzle) => {
        const rating =
          ratings.get(puzzle.id) ??
          seededPuzzleRatingSummary(puzzle.solution.length, store.difficultyById.get(puzzle.id));
        return {
          ...puzzleSummary(puzzle, rating, store),
          servingRating: puzzleServingRating({
            prior: rating.rating,
            solutionPlyCount: puzzle.solution.length,
            evidence: evidence.get(puzzle.id),
          }),
        };
      }),
      attemptedIds,
      themes: XIANGQI_MOTIFS.map((motif) => ({ ...motif, count: counts.get(motif.id) ?? 0 })),
      tagCounts,
    });
    return true;
  }

  if (pathname === '/api/puzzles/daily') {
    if (!requireMethod(request, response, 'GET')) return true;
    const slot = parseDailyPuzzleSlot(parsedUrl.searchParams.get('slot'));
    if (!slot) {
      writeJson(response, 400, { error: 'invalid_slot' });
      return true;
    }
    const daily = await getOrCreateDailyPuzzleSelection(currentDailyPuzzleDay(), slot);
    writeJson(response, 200, {
      daily: {
        day: daily.day,
        persisted: daily.persisted,
        selectedAt: daily.selectedAt,
        slot: daily.slot,
        source: daily.source,
      },
      puzzle: await puzzleDetail(daily.puzzle),
    });
    return true;
  }

  // The signed-in user's puzzle rating for a variant (null when unrated / anon).
  // Checked before the `:id` detail route so "rating" is not read as a puzzle id.
  if (pathname === '/api/puzzles/rating') {
    if (!requireMethod(request, response, 'GET')) return true;
    const variant = parsePuzzleVariant(parsedUrl.searchParams.get('variant'));
    if (variant === 'invalid' || variant === null) {
      writeJson(response, 400, { error: 'invalid_variant' });
      return true;
    }
    const user = await currentAccountUser(request);
    const rating = user ? await getUserPuzzleRating(user.id, variant) : null;
    writeJson(response, 200, {
      rating: rating
        ? {
            rating: rating.rating,
            provisional: rating.provisional,
            solved: rating.solved,
            attempts: rating.attempts,
          }
        : null,
    });
    return true;
  }

  // Private history and progress for the session owner. Claim the literal
  // before :id, and never accept an account selector from the client.
  if (pathname === '/api/puzzles/history') {
    if (!requireMethod(request, response, 'GET')) return true;
    const headers = { 'cache-control': 'private, no-store' };
    const user = await currentAccountUser(request);
    if (!user) {
      writeJson(response, 401, { error: 'authentication_required' }, headers);
      return true;
    }
    const variant = parsePuzzleVariant(parsedUrl.searchParams.get('variant'));
    if (variant === 'invalid' || variant === null) {
      writeJson(response, 400, { error: 'invalid_variant' }, headers);
      return true;
    }
    const limitText = parsedUrl.searchParams.get('limit') ?? '50';
    const offsetText = parsedUrl.searchParams.get('offset') ?? '0';
    const limit = Number(limitText);
    const offset = Number(offsetText);
    if (
      !/^\d+$/.test(limitText) ||
      !/^\d+$/.test(offsetText) ||
      !Number.isSafeInteger(offset + limit + 1) ||
      limit < 1 ||
      limit > 100
    ) {
      writeJson(response, 400, { error: 'invalid_pagination' }, headers);
      return true;
    }
    const history = await listPuzzleAttemptHistory(user.id, variant, limit, offset);
    const rating = await getUserPuzzleRating(user.id, variant);
    writeJson(
      response,
      200,
      {
        ...history,
        progress: rating
          ? {
              rating: rating.rating,
              provisional: rating.provisional,
              solved: rating.solved,
              attempts: rating.attempts,
            }
          : null,
      },
      headers,
    );
    return true;
  }

  // Private retry queue. By default only unresolved failures are returned;
  // ?repaired=true reads repaired failures. The account comes only from the
  // session, never a caller-supplied user id. No solution data is exposed.
  if (pathname === '/api/puzzles/failed') {
    if (!requireMethod(request, response, 'GET')) return true;
    const user = await currentAccountUser(request);
    if (!user) {
      writeJson(response, 401, { error: 'not_signed_in' });
      return true;
    }
    const variant = parsePuzzleVariant(parsedUrl.searchParams.get('variant'));
    if (variant === 'invalid') {
      writeJson(response, 400, { error: 'invalid_variant' });
      return true;
    }
    const repaired = parsedUrl.searchParams.get('repaired');
    if (repaired !== null && repaired !== 'true' && repaired !== 'false') {
      writeJson(response, 400, { error: 'invalid_repaired' });
      return true;
    }
    const failures = await listFailedPuzzleAttempts(user.id, {
      variant: variant ?? undefined,
      repaired: repaired === 'true',
    });
    const store = await getPuzzleStore();
    writeJson(response, 200, {
      failures: failures.filter((failure) => store.byId.has(failure.puzzleId)),
    });
    return true;
  }

  const qualityMatch = pathname.match(/^\/api\/puzzles\/([^/]+)\/quality$/);
  if (qualityMatch) {
    if (!requireMethod(request, response, 'POST')) return true;
    const puzzle = await puzzleById(decodeURIComponent(qualityMatch[1]!));
    if (!puzzle) {
      writeJson(response, 404, { error: 'not_found' });
      return true;
    }
    const body = await readJsonBody(request);
    if (!isPuzzleQualitySessionId(body.sessionId)) {
      writeJson(response, 400, { error: 'invalid_quality_session' });
      return true;
    }
    if (!puzzleQualityRateLimiter.check(clientIpForRateLimit(request))) {
      writeJson(response, 429, { error: 'rate_limited' });
      return true;
    }
    // Who opened it, for /metrics' puzzle players (migration 177). The account
    // comes from the session cookie only, never the body; the device id is the
    // browser's own. A stats-excluded account marks its browser here as live
    // rooms do, so the operator's signed-out puzzles leave the counts too.
    const accountUser = persistenceInitialized() ? await currentAccountUser(request) : null;
    const deviceId = parsePuzzleDeviceId(body.deviceId);
    rememberExcludedDevice(deviceId, accountUser);
    const player: PuzzleQualityPlayer = { userId: accountUser?.id ?? null, deviceId };
    if (body.event === 'vote') {
      const vote = parsePuzzleQualityVote(body.vote);
      if (vote === 'invalid') {
        writeJson(response, 400, { error: 'invalid_vote' });
        return true;
      }
      await recordPuzzleQualityVote({
        puzzleId: puzzle.id,
        sessionId: body.sessionId,
        variant: puzzle.variant,
        vote,
        player,
      });
    } else if (body.event === 'view' || body.event === 'start' || body.event === 'abandon') {
      await recordPuzzleQualityEvent({
        puzzleId: puzzle.id,
        sessionId: body.sessionId,
        variant: puzzle.variant,
        event: body.event,
        player,
      });
    } else {
      writeJson(response, 400, { error: 'invalid_quality_event' });
      return true;
    }
    response.writeHead(204).end();
    return true;
  }

  const attemptMatch = pathname.match(/^\/api\/puzzles\/([^/]+)\/attempt$/);
  if (attemptMatch) {
    if (!requireMethod(request, response, 'POST')) return true;
    if (await refusedForPlayLock(request, response)) return true;
    const puzzle = await puzzleById(decodeURIComponent(attemptMatch[1]!));
    if (!puzzle) {
      writeJson(response, 404, { error: 'not_found' });
      return true;
    }
    const body = await readJsonBody(request);
    const qualitySessionId = parseOptionalQualitySessionId(body.qualitySessionId);
    if (qualitySessionId === 'invalid') {
      writeJson(response, 400, { error: 'invalid_quality_session' });
      return true;
    }
    const moves = parsePuzzleMoves(body.moves);
    if (!moves) {
      writeJson(response, 400, { error: 'invalid_moves' });
      return true;
    }
    const attempt = attemptPuzzle(puzzle, moves);
    if (qualitySessionId && puzzleQualityRateLimiter.check(clientIpForRateLimit(request))) {
      const qualityEvent = attempt.ok
        ? attempt.complete
          ? 'solve'
          : 'start'
        : attempt.code === 'incorrect-move'
          ? 'wrong'
          : null;
      if (qualityEvent) {
        await recordPuzzleQualityEvent({
          puzzleId: puzzle.id,
          sessionId: qualitySessionId,
          variant: puzzle.variant,
          event: qualityEvent,
          player: { userId: (await currentAccountUser(request))?.id ?? null, deviceId: null },
        });
      }
    }
    const rating = await recordAttemptRating(
      request,
      puzzle,
      attempt,
      body.rated !== false,
      qualitySessionId,
    );
    // A completed solve answers with the solver's puzzle streak, read after the
    // attempt row landed so today counts. Days follow the browser's calendar
    // (`timeZone` in the body, play-streak.ts); anonymous solvers get none.
    const streak =
      attempt.ok && attempt.complete ? await solverPuzzleStreak(request, body.timeZone) : null;
    writeJson(response, 200, {
      attempt,
      ...(rating ? { rating } : {}),
      ...(streak ? { streak } : {}),
    });
    return true;
  }

  // Solution-exposure endpoint (lichess "view solution" / "get a hint"). This is
  // the only route that returns solution move data on request; the detail +
  // attempt routes stay solution-hidden. (The streak route sends one puzzle's
  // line only with the miss that has already locked its run.) `mode:'solution'` returns the full line; `mode:'hint'`
  // returns just the next correct move for the given played-ply count. Either
  // action books a FAILED rated attempt for the user (idempotent per user+puzzle
  // via ON CONFLICT DO NOTHING, so a prior wrong-move fail or a later solve is a
  // rating no-op — first terminal action wins, matching lichess).
  const revealMatch = pathname.match(/^\/api\/puzzles\/([^/]+)\/reveal$/);
  if (revealMatch) {
    if (!requireMethod(request, response, 'POST')) return true;
    if (await refusedForPlayLock(request, response)) return true;
    const puzzle = await puzzleById(decodeURIComponent(revealMatch[1]!));
    if (!puzzle) {
      writeJson(response, 404, { error: 'not_found' });
      return true;
    }
    const body = await readJsonBody(request);
    const qualitySessionId = parseOptionalQualitySessionId(body.qualitySessionId);
    if (qualitySessionId === 'invalid') {
      writeJson(response, 400, { error: 'invalid_quality_session' });
      return true;
    }
    const rated = body.rated !== false;
    const rating = await recordOutcomeRating(request, puzzle, false, rated);
    if (body.mode === 'hint') {
      const move = puzzleNextMove(puzzle, parsePlayedPlyCount(body.playedPlyCount));
      if (
        qualitySessionId &&
        move &&
        puzzleQualityRateLimiter.check(clientIpForRateLimit(request))
      ) {
        await recordPuzzleQualityEvent({
          puzzleId: puzzle.id,
          sessionId: qualitySessionId,
          variant: puzzle.variant,
          event: 'hint',
        });
      }
      writeJson(response, 200, { move, ...(rating ? { rating } : {}) });
      return true;
    }
    if (qualitySessionId && puzzleQualityRateLimiter.check(clientIpForRateLimit(request))) {
      await recordPuzzleQualityEvent({
        puzzleId: puzzle.id,
        sessionId: qualitySessionId,
        variant: puzzle.variant,
        event: 'reveal',
      });
    }
    writeJson(response, 200, { solution: puzzle.solution, ...(rating ? { rating } : {}) });
    return true;
  }

  const detailMatch = pathname.match(/^\/api\/puzzles\/([^/]+)$/);
  if (!detailMatch) return false;
  if (!requireMethod(request, response, 'GET')) return true;

  const puzzle = await puzzleById(decodeURIComponent(detailMatch[1]!));
  if (!puzzle) {
    writeJson(response, 404, { error: 'not_found' });
    return true;
  }
  writeJson(response, 200, { puzzle: await puzzleDetail(puzzle) });
  return true;
}

async function ratedPuzzleRamp(variant: PublicPuzzleVariant): Promise<PuzzleSummary[]> {
  return orderedPuzzleRamp(await rampPool(variant));
}

async function rampPool(variant: PublicPuzzleVariant): Promise<PuzzleSummary[]> {
  const store = await getPuzzleStore();
  const puzzles = discoverablePuzzles(store).filter((p) => p.variant === variant);
  const ratings = await listPuzzleRatingSummaries(puzzles.map((p) => p.id));
  return puzzles.map((p) =>
    puzzleSummary(
      p,
      ratings.get(p.id) ??
        seededPuzzleRatingSummary(p.solution.length, store.difficultyById.get(p.id)),
      store,
    ),
  );
}

// A guest's recent puzzles as the browser sends them: only a preference for
// the draw, so anything malformed is ignored rather than refused.
function parseRecentPuzzleIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(-200)
    .filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 200);
}

async function streakResponse(run: StreakRun) {
  const id = run.state.ids[run.state.results.length];
  const puzzle = !run.state.finished && id ? await puzzleById(id) : null;
  return {
    runId: run.id,
    score: run.state.score,
    best: await bestPuzzleStreak(run.userId),
    skipUsed: run.state.skipUsed,
    finished: run.state.finished,
    results: run.state.results,
    puzzle: puzzle ? await puzzleDetail(puzzle) : null,
  };
}

// Accepts either a full puzzle id (the URL slug today) or a lichess-style short
// code (e.g. "bMpKA", shown in the puzzle info card). Full ids resolve directly
// against the store's id map (every stored puzzle, including hidden variants);
// only when that misses do we invert a short code — resolvePuzzleShortCode
// short-circuits on anything that is not code-shaped, so this stays cheap for
// the common full-id path.
export async function puzzleById(id: string): Promise<PublicPuzzle | null> {
  const store = await getPuzzleStore();
  const direct = store.byId.get(id);
  if (direct) return direct;
  const fullId = resolvePuzzleShortCode(id, store.byId.keys());
  return fullId ? (store.byId.get(fullId) ?? null) : null;
}

function puzzleSideToMove(
  puzzle: PublicPuzzle,
): ReturnType<typeof standardXiangqiPuzzleSideToMove> {
  if (puzzle.variant === JUNGLE_SPEC_ID) return junglePuzzleSideToMove(puzzle);
  return standardXiangqiPuzzleSideToMove(puzzle);
}

function attemptPuzzle(puzzle: PublicPuzzle, moves: PublicPuzzleMove[]) {
  if (puzzle.variant === JUNGLE_SPEC_ID) {
    return attemptJunglePuzzleLine(puzzle, moves as JungleMove[]);
  }
  return attemptStandardXiangqiPuzzleLine(puzzle, moves as XiangqiMove[]);
}

// The next scripted move for a played-ply count (solver move on even plies,
// scripted defender reply on odd). Reads `puzzle.solution` generically via the
// per-variant helpers. Fail-closed: a new registry needs an explicit branch.
function puzzleNextMove(puzzle: PublicPuzzle, playedPlyCount: number): PublicPuzzleMove | null {
  if (puzzle.variant === JUNGLE_SPEC_ID) {
    return junglePuzzleNextMove(puzzle, playedPlyCount);
  }
  return standardXiangqiPuzzleNextMove(puzzle, playedPlyCount);
}

// Non-negative ply count the client has already played (used to pick the hint's
// target move). Malformed/negative/out-of-range values fall back to 0 (the
// puzzle's first move), never an exception.
function parsePlayedPlyCount(value: unknown): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 64) {
    return value;
  }
  return 0;
}

type PuzzleAttempt = ReturnType<typeof attemptPuzzle>;

type PuzzleAttemptRating = {
  userRating: number;
  delta: number;
  provisional: boolean;
  ratingChanged: boolean;
  firstAttempt: boolean;
  repairedAt: string | null;
};

// true = solved, false = a genuine wrong answer, null = not a terminal outcome
// (a correct-but-incomplete move on a multi-move puzzle, or a malformed submit).
function attemptOutcome(attempt: PuzzleAttempt): boolean | null {
  if (attempt.ok) return attempt.complete ? true : null;
  return attempt.code === 'incorrect-move' ? false : null;
}

// The per-account play lock (126) on the two routes that write a puzzle_attempts
// row. Refused outright rather than silently unrated: an account that is an
// identity rather than a player should be told, not left solving puzzles that
// quietly do not count. A signed-out solver is never locked.
async function refusedForPlayLock(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<boolean> {
  if (!isPlayDisabled(await currentAccountUser(request))) return false;
  writeJson(response, 403, { error: 'play_disabled' });
  return true;
}

// The signed-in solver's puzzle streak (current and best days), or null for a
// guest. Read from puzzle_attempts, so it reflects the row the attempt route
// just wrote.
async function solverPuzzleStreak(
  request: IncomingMessage,
  timeZone: unknown,
): Promise<{ current: number; best: number } | null> {
  const user = await currentAccountUser(request);
  if (!user || !persistenceInitialized()) return null;
  const streak = await getPuzzleStreak(user.id, {
    timeZone: typeof timeZone === 'string' ? timeZone : null,
  });
  return { current: streak.current, best: streak.best };
}

// Record + rate the outcome for a signed-in user, once per (user, puzzle). Anon
// users, non-terminal moves, and persistence-off all return null (no rating).
async function recordAttemptRating(
  request: IncomingMessage,
  puzzle: PublicPuzzle,
  attempt: PuzzleAttempt,
  rated: boolean,
  qualitySessionId: string | null,
): Promise<PuzzleAttemptRating | null> {
  const outcome = attemptOutcome(attempt);
  if (outcome === null) return null;
  return recordOutcomeRating(request, puzzle, outcome, rated, qualitySessionId);
}

// Book a single terminal outcome (solved/failed) for a signed-in user. The
// puzzle_attempts primary key makes this idempotent per (user, puzzle): only the
// FIRST terminal outcome moves ratings, so a wrong-move fail followed by a
// reveal, or a reveal followed by a completed line, records once and returns
// firstAttempt=false / ratingChanged=false on the repeat. A completed retry
// on a clean later visit records a separate repairedAt for a prior failure.
// The per-visit quality session supplies that evidence. Anon users and
// persistence-off return null (no rating).
async function recordOutcomeRating(
  request: IncomingMessage,
  puzzle: PublicPuzzle,
  solved: boolean,
  rated: boolean,
  qualitySessionId?: string | null,
): Promise<PuzzleAttemptRating | null> {
  const user = await currentAccountUser(request);
  if (!user) return null;
  // Second line of defence behind refusedForPlayLock: no caller may book an
  // attempt against a locked account, whatever route it arrives on.
  if (isPlayDisabled(user)) return null;
  const result = await recordPuzzleAttempt({
    userId: user.id,
    puzzleId: puzzle.id,
    variant: puzzle.variant,
    solved,
    rated,
    qualitySessionId,
    seedRating: seedPuzzleRating(
      puzzle.solution.length,
      (await getPuzzleStore()).difficultyById.get(puzzle.id),
    ),
  });
  if (!result) return null;
  return {
    userRating: result.userRating,
    delta: result.userRatingDelta,
    provisional: result.provisional,
    ratingChanged: result.ratingChanged,
    firstAttempt: result.firstAttempt,
    repairedAt: result.repairedAt,
  };
}

function parsePuzzleVariant(value: string | null): PublicPuzzleVariant | null | 'invalid' {
  if (value === null || value === '') return null;
  if (value === JUNGLE_SPEC_ID || value === XIANGQI_SPEC_ID) return value;
  return 'invalid';
}

function parsePuzzleMotif(value: string | null): XiangqiMotifId | null | 'invalid' {
  if (value === null || value === '') return null;
  return XIANGQI_MOTIFS.find((motif) => motif.id === value)?.id ?? 'invalid';
}

function parsePuzzleTrainingTag(value: string | null): XiangqiTrainingTagId | null | 'invalid' {
  if (value === null || value === '') return null;
  return isXiangqiTrainingTagId(value) ? value : 'invalid';
}

function puzzleSummary(
  puzzle: PublicPuzzle,
  rating: { rating: number; provisional: boolean },
  store: Pick<PuzzleStoreSnapshot, 'motifsById' | 'tagsById'>,
): PuzzleSummary {
  return {
    id: puzzle.id,
    variant: puzzle.variant,
    title: puzzle.title,
    sideToMove: puzzleSideToMove(puzzle),
    goal: puzzle.goal,
    themes: puzzle.themes,
    motifs: store.motifsById.get(puzzle.id) ?? [],
    tags: store.tagsById.get(puzzle.id) ?? [],
    solutionPlyCount: puzzle.solution.length,
    rating: rating.rating,
    ratingProvisional: rating.provisional,
  };
}

async function puzzleDetail(puzzle: PublicPuzzle): Promise<PuzzleDetail> {
  const stored = await getPuzzleRating(puzzle.id);
  const store = await getPuzzleStore();
  const source = await detailSourceFields(puzzle);
  return {
    ...puzzleSummary(
      puzzle,
      stored
        ? { rating: stored.rating, provisional: stored.provisional }
        : seededPuzzleRatingSummary(puzzle.solution.length, store.difficultyById.get(puzzle.id)),
      store,
    ),
    initial: puzzle.initial,
    ...source,
  };
}

// Standard xiangqi only. With persistence on, the stored source game adds the
// setup move, the moves before it and the row's player names; off, the stored
// attribution goes out unlinked.
async function detailSourceFields(puzzle: PublicPuzzle): Promise<PuzzleDetailSourceFields> {
  if (puzzle.variant !== XIANGQI_SPEC_ID) return {};
  return puzzleDetailSourceFields(
    puzzle,
    persistenceInitialized() ? getHistoricalXiangqiPuzzleSourceGame : null,
  );
}

// Outcome counts move slowly next to list traffic, so the list reads them at
// most once per TTL per process. A failed read serves the last good counts
// (or none): ordering degrades to the prior, the list never fails over it.
const SERVING_EVIDENCE_TTL_MS = 5 * 60_000;
let servingEvidenceCache: {
  at: number;
  evidence: Map<string, PuzzleServingEvidence>;
} | null = null;

async function servingEvidence(): Promise<Map<string, PuzzleServingEvidence>> {
  const now = Date.now();
  if (servingEvidenceCache && now - servingEvidenceCache.at < SERVING_EVIDENCE_TTL_MS) {
    return servingEvidenceCache.evidence;
  }
  try {
    servingEvidenceCache = { at: now, evidence: await listPuzzleServingEvidence() };
  } catch (error) {
    console.error('puzzle serving evidence read failed', error);
    servingEvidenceCache = { at: now, evidence: servingEvidenceCache?.evidence ?? new Map() };
  }
  return servingEvidenceCache.evidence;
}

/** Test seam: forget cached outcome counts. */
export function resetPuzzleServingEvidenceCacheForTests(): void {
  servingEvidenceCache = null;
}

function seededPuzzleRatingSummary(
  solutionPlyCount: number,
  derivedDifficulty?: number,
): {
  rating: number;
  provisional: boolean;
} {
  return {
    rating: Math.round(seedPuzzleRating(solutionPlyCount, derivedDifficulty).rating),
    provisional: true,
  };
}

function parseOptionalQualitySessionId(value: unknown): string | null | 'invalid' {
  if (value === undefined || value === null) return null;
  return isPuzzleQualitySessionId(value) ? value : 'invalid';
}

function parsePuzzleQualityVote(value: unknown): PuzzleQualityVote | 'invalid' {
  if (value === 'up' || value === 'down' || value === null) return value;
  return 'invalid';
}

function parsePuzzleMoves(value: unknown): PublicPuzzleMove[] | null {
  if (!Array.isArray(value) || value.length > 64) return null;
  const moves: PublicPuzzleMove[] = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) return null;
    const move = raw as Record<string, unknown>;
    if (typeof move.from === 'string' && typeof move.to === 'string') {
      moves.push({ from: move.from, to: move.to } as PublicPuzzleMove);
      continue;
    }
    return null;
  }
  return moves;
}
