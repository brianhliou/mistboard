import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  attemptJunglePuzzleLine,
  attemptStandardXiangqiPuzzleLine,
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
  type XiangqiMotifId,
  type XiangqiMove,
  type XiangqiPuzzle,
  type XiangqiPuzzleSetupMove,
} from '@mistboard/game';
import { currentAccountUser } from '../account-session.js';
import { createAuthRateLimiter } from '../auth-rate-limit.js';
import { isPlayDisabled, isInitialized as persistenceInitialized } from '../persistence.js';
import { getHistoricalXiangqiGameMoves } from '../persistence-historical-xiangqi.js';
import {
  isPuzzleQualitySessionId,
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
  listPuzzleRatingSummaries,
  recordPuzzleAttempt,
} from '../persistence-puzzle-ratings.js';
import { getPuzzleStreak } from '../persistence-puzzle-streak.js';
import {
  currentDailyPuzzleDay,
  getOrCreateDailyPuzzleSelection,
  parseDailyPuzzleSlot,
} from '../persistence-puzzles.js';
import { seedPuzzleRating } from '../puzzle-rating.js';
import { puzzleSetupMove } from '../puzzle-setup-move.js';
import { getPuzzleStore, type PuzzleStoreSnapshot } from '../puzzle-store.js';
import {
  bestPuzzleStreak,
  loadPuzzleStreak,
  orderedPuzzleRamp,
  type StreakRun,
  savePuzzleStreak,
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
  solutionPlyCount: number;
  rating: number;
  ratingProvisional: boolean;
};

type PuzzleDetail = PuzzleSummary & {
  initial: PublicPuzzle['initial'];
  // Denormalized attribution for the "From game" card (standard-xiangqi mined
  // puzzles only). The source game itself is not hosted until license-cleared,
  // so this is display metadata, not a link target.
  sourceGame?: XiangqiPuzzle['sourceGame'];
  // The setup move (initial.lastMove) with the piece it captured, derived from
  // the stored source game; absent when that game is not stored (#664).
  setupMove?: XiangqiPuzzleSetupMove;
};

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
      const ramp = await ratedPuzzleRamp(XIANGQI_SPEC_ID);
      const run = await startPuzzleStreak(
        ramp.map((p) => p.id),
        user?.id ?? null,
      );
      writeJson(response, 200, await streakResponse(run));
      return true;
    }
    if (
      (body.action !== 'move' && body.action !== 'skip') ||
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
    const id = state.ids[state.results.length];
    if (state.finished || id !== body.puzzleId || (body.action === 'skip' && state.skipUsed)) {
      writeJson(response, 409, { error: 'streak_action_unavailable' });
      return true;
    }
    let attempt: PuzzleAttempt | undefined;
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
    writeJson(response, 200, { ...(await streakResponse(run)), ...(attempt ? { attempt } : {}) });
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
    const store = await getPuzzleStore();
    const puzzles = discoverablePuzzles(store).filter(
      (puzzle) =>
        (!variant || puzzle.variant === variant) &&
        (!motif || store.motifsById.get(puzzle.id)?.includes(motif)),
    );
    const ratings = await listPuzzleRatingSummaries(puzzles.map((puzzle) => puzzle.id));
    // Signed-in visitors also get what they have already finished, so rotation
    // survives a cleared browser or a second device. Anonymous visitors get an
    // empty list and fall back to the localStorage seen-set alone.
    const user = await currentAccountUser(request);
    const attemptedIds = user ? await listAttemptedPuzzleIds(user.id, variant ?? undefined) : [];
    writeJson(response, 200, {
      puzzles: puzzles.map((puzzle) =>
        puzzleSummary(
          puzzle,
          ratings.get(puzzle.id) ??
            seededPuzzleRatingSummary(puzzle.solution.length, store.difficultyById.get(puzzle.id)),
          store.motifsById.get(puzzle.id) ?? [],
        ),
      ),
      attemptedIds,
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
        });
      }
    }
    const rating = await recordAttemptRating(request, puzzle, attempt, body.rated !== false);
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
  // the ONLY route that returns solution move data; the detail + attempt routes
  // stay solution-hidden. `mode:'solution'` returns the full line; `mode:'hint'`
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
  const store = await getPuzzleStore();
  const puzzles = discoverablePuzzles(store).filter((p) => p.variant === variant);
  const ratings = await listPuzzleRatingSummaries(puzzles.map((p) => p.id));
  return orderedPuzzleRamp(
    puzzles.map((p) =>
      puzzleSummary(
        p,
        ratings.get(p.id) ??
          seededPuzzleRatingSummary(p.solution.length, store.difficultyById.get(p.id)),
        store.motifsById.get(p.id) ?? [],
      ),
    ),
  );
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
): Promise<PuzzleAttemptRating | null> {
  const outcome = attemptOutcome(attempt);
  if (outcome === null) return null;
  return recordOutcomeRating(request, puzzle, outcome, rated);
}

// Book a single terminal outcome (solved/failed) for a signed-in user. The
// puzzle_attempts primary key makes this idempotent per (user, puzzle): only the
// FIRST terminal outcome moves ratings, so a wrong-move fail followed by a
// reveal, or a reveal followed by a completed line, records once and returns
// firstAttempt=false / ratingChanged=false on the repeat. Anon users and
// persistence-off return null (no rating).
async function recordOutcomeRating(
  request: IncomingMessage,
  puzzle: PublicPuzzle,
  solved: boolean,
  rated: boolean,
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

function puzzleSummary(
  puzzle: PublicPuzzle,
  rating: { rating: number; provisional: boolean },
  motifs: readonly XiangqiMotifId[],
): PuzzleSummary {
  return {
    id: puzzle.id,
    variant: puzzle.variant,
    title: puzzle.title,
    sideToMove: puzzleSideToMove(puzzle),
    goal: puzzle.goal,
    themes: puzzle.themes,
    motifs,
    solutionPlyCount: puzzle.solution.length,
    rating: rating.rating,
    ratingProvisional: rating.provisional,
  };
}

async function puzzleDetail(puzzle: PublicPuzzle): Promise<PuzzleDetail> {
  const stored = await getPuzzleRating(puzzle.id);
  const store = await getPuzzleStore();
  const setupMove = await detailSetupMove(puzzle);
  return {
    ...puzzleSummary(
      puzzle,
      stored
        ? { rating: stored.rating, provisional: stored.provisional }
        : seededPuzzleRatingSummary(puzzle.solution.length, store.difficultyById.get(puzzle.id)),
      store.motifsById.get(puzzle.id) ?? [],
    ),
    initial: puzzle.initial,
    ...(puzzle.variant === XIANGQI_SPEC_ID && puzzle.sourceGame
      ? { sourceGame: puzzle.sourceGame }
      : {}),
    ...(setupMove ? { setupMove } : {}),
  };
}

// The opponent's setup move with what it captured (#664), so the trainer can
// open one move earlier and glide it in. Standard xiangqi only, and only when
// the source game is stored (persistence on); every other case omits the field.
async function detailSetupMove(puzzle: PublicPuzzle): Promise<XiangqiPuzzleSetupMove | null> {
  if (puzzle.variant !== XIANGQI_SPEC_ID || !persistenceInitialized()) return null;
  return puzzleSetupMove(puzzle, getHistoricalXiangqiGameMoves);
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
