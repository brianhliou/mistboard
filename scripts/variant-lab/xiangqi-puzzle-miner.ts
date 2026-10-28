// Standard-xiangqi (9x10) puzzle miner: lichess-style, mined from REAL games.
//
// Two-phase pipeline over a corpus of historical games (the historical_xiangqi
// DB tables filled by the dpxq importer, or a directory of game files):
//
//   1. SCAN (cheap): walk each game's positions in order, keeping kernel state;
//      MultiPV(2) Pikafish eval at --scan-nodes per position. A candidate
//      moment is a game move that loses >= --swing-cp vs the engine best (mover
//      POV) and leaves the opponent (the solver) winning (>= --win-cp or mate),
//      skipping the opening (--min-ply) and already-decided positions
//      (--decided-cp).
//   2. VERIFY (expensive, candidates only): extend the solution ONE solver ply
//      at a time, re-searching MultiPV(2) at a --verify-depth floor at each
//      solver position. A solver move is kept only if it is uniquely correct by
//      the winning-floor gate (isXiangqiSolverMoveUnique: best keeps a clear win
//      AND the runner-up either loses the win or trails by --material-gap-cp);
//      the defender reply is the engine's best (its uniqueness is not required).
//      The line stops at the first non-unique solver move, at mate, or at the
//      ply cap, always ending on the solver's move — so puzzles are born clean
//      rather than trusting one PV. The whole line is then kernel-replayed and
//      re-validated with validateStandardXiangqiPuzzle before it is accepted.
//
// All decision logic lives in packages/game/src/puzzles-xiangqi-mining.ts
// (engine-free, unit-tested); the Pikafish subprocess driver, UCI parsing, and
// the per-ply gate application are shared with the uniqueness audit via
// scripts/variant-lab/xiangqi-pikafish-uci.ts (#185: one definition, no
// drift). This driver owns the corpus loading, concurrency, and output.
//
// UCI `score cp` / `score mate` are SIDE-TO-MOVE POV. The scan pass exploits
// that: the value of the move played from position i is minus the best eval of
// position i+1, so one MultiPV scan per position covers both sides of the
// swing (see detectXiangqiBlunderCandidates).
//
// Output (#183: puzzle content lives in the DB + committed seed, not TS
// modules):
//   --emit-seed         rewrites the mined (xq-mined-*) section of the seed
//       asset (default packages/game/seed/puzzles/xiangqi.json), preserving
//       any curated non-mined entries. Committing the refreshed seed is the
//       DEPLOY path today: on push, the server's boot-time sync
//       (apps/server/src/puzzle-store.ts) upserts it into the `puzzles` table
//       with zero manual ops. Update the count/hash pins in
//       packages/game/src/puzzles-seed.test.ts (run test:puzzles:corpus first).
//   --insert-db         upserts this run's puzzles straight into the `puzzles`
//       table at --db-url / DATABASE_URL (source_kind='mined', seq appended).
//       Against the local dev DB this is for testing the serving path; the
//       #182 engine-worker flow will run this against prod, making mined
//       batches live WITHOUT a deploy. Seed-owned rows hit by an id collision
//       keep source_kind='seed' (the next seed sync re-reconciles them).
// A JSONL sidecar records per-puzzle mining metadata. Verified lines rejected
// only by --min-solution-plies are retained there as `verified-short` records,
// including the full kernel-validated puzzle, but never enter seed/DB output.
// The LAST stdout line is always a machine-parseable metrics JSON object (the
// calibration deliverable); verifiedShort counts these retained candidates
// separately from verified (accepted puzzles).
//
// Run (fixture smoke, no DB):
//   node_modules/.bin/tsx scripts/variant-lab/xiangqi-puzzle-miner.ts \
//     --source dir --dir apps/server/fixtures/dpxq --scan-nodes 4000 --verify-nodes 20000
//
// Run (1k-game calibration from the historical DB; the lead runs this):
//   node_modules/.bin/tsx scripts/variant-lab/xiangqi-puzzle-miner.ts \
//     --source db --limit 1000 --concurrency 4 --emit-seed
//
// DB mode connects to DATABASE_URL (default: the shared local dev Postgres,
// postgres://mistboard:mistboard@localhost:5435/mistboard) and filters to
// ply_count >= --ply-min (default 20).

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  pikafishXiangqiNetPath,
  pikafishXiangqiPath,
} from '../../apps/server/src/xiangqi-pikafish-engine.ts';
import {
  applyStandardXiangqiMove,
  assembleMinedXiangqiPuzzle,
  createInitialXiangqiState,
  detectXiangqiBlunderCandidates,
  importXiangqiGame,
  isStandardXiangqiLegalMove,
  isXiangqiQuietKeyMove,
  pikafishUciToXiangqiSquares,
  positionRepetitionKey,
  standardXiangqiEngineFen,
  standardXiangqiPuzzleMoveLabel,
  trimXiangqiWinningAdvantageTail,
  type XiangqiBlunderCandidate,
  type XiangqiGameState,
  type XiangqiMove,
  type XiangqiPuzzle,
  type XiangqiVerifyLine,
  xiangqiMoveToPikafishUci,
  xiangqiUciScoreToCp,
} from '../../packages/game/src/index.ts';
import {
  analyzeXiangqiSolverPly,
  PikafishEngine,
  XIANGQI_SOLVER_GATE_DEFAULTS,
} from './xiangqi-pikafish-uci.ts';

export type XiangqiPuzzleMinerOptions = {
  source: 'db' | 'dir' | 'json';
  dir: string | null;
  /** --source json: a file of { games: XiangqiPuzzleMinerGame[] } (the shape
   *  scripts/export-unmined-xiangqi-games.mjs writes). */
  gamesFile?: string | null;
  /** --source dir: the historical_xiangqi_sources slug the files come from,
   *  which selects the source's attribution policy. */
  sourceSlug?: string | null;
  dbUrl: string;
  plyMin: number;
  limit: number;
  offset: number;
  seed: number;
  concurrency: number;
  scanNodes: number;
  verifyNodes: number;
  swingCp: number;
  winCp: number;
  decidedCp: number;
  uniqueGapCp: number;
  verifyDepth: number;
  winHi: number;
  winLo: number;
  minGapCp: number;
  materialGapCp: number;
  minPly: number;
  maxSolutionPlies: number;
  minSolutionPlies: number;
  /** #712: refuse a puzzle whose key move captures or checks. */
  quietKey?: boolean;
  /** #712: re-apply minSolutionPlies after the winning-advantage trim. */
  floorAfterTrim?: boolean;
  perGame: number;
  emitSeed: string | null;
  insertDb: boolean;
  jsonl: string;
  binary: string | null;
  net: string | null;
};

export type XiangqiPuzzleMinerGame = {
  id: string;
  moves: XiangqiMove[];
  // Denormalized attribution (db mode only) — copied onto each puzzle's
  // sourceGame so the "From game" card renders without hosting the game.
  meta?: {
    event?: string | null;
    playedOn?: string | null;
    result?: string | null;
    redName?: string | null;
    blackName?: string | null;
    sourceSlug?: string | null;
    sourceUrl?: string | null;
    sourceGameId?: string | null;
  };
};

export type MinedPuzzleRecord = {
  puzzle: XiangqiPuzzle;
  gameId: string;
  blunderPly: number;
  swingCp: number;
  verifyBestCp: number;
  verifySecondCp: number | null;
};

export type VerifiedShortPuzzleRecord = MinedPuzzleRecord & {
  disposition: 'verified-short';
  minSolutionPlies: number;
};

export type XiangqiPuzzleMinerMetrics = {
  gamesRequested: number;
  gamesLoaded: number;
  gamesScanned: number;
  gamesFailed: number;
  gamesIllegalReplay: number;
  positionsEvaluated: number;
  verifyEvals: number;
  candidates: number;
  verified: number;
  rejects: Record<string, number>;
  themes: Record<string, number>;
};

export type XiangqiPuzzleMinerCandidate = {
  gameId: string;
  postBlunderPly: number;
  positionKey: string;
  scan: XiangqiBlunderCandidate;
};

export type XiangqiPuzzleMinerJudgment = XiangqiPuzzleMinerCandidate & {
  verdict: 'pass' | 'reject';
  reason: string | null;
  evidence: Record<string, unknown>;
  puzzle: XiangqiPuzzle | null;
};

export type XiangqiPuzzleMinerHooks = {
  candidateScanned?: (candidate: XiangqiPuzzleMinerCandidate) => Promise<void>;
  candidateJudged?: (judgment: XiangqiPuzzleMinerJudgment) => Promise<void>;
  /** Offline retention only; the normal judgment remains a too-short reject. */
  shortCandidateVerified?: (record: VerifiedShortPuzzleRecord) => Promise<void>;
};

const DEFAULT_DB_URL = 'postgres://mistboard:mistboard@localhost:5435/mistboard';
const DEFAULT_SEED_TARGET = 'packages/game/seed/puzzles/xiangqi.json';

function parseCliOptions(): XiangqiPuzzleMinerOptions {
  const { values } = parseArgs({
    allowPositionals: false,
    options: {
      source: { type: 'string', default: 'db' },
      dir: { type: 'string' },
      games: { type: 'string' },
      'source-slug': { type: 'string' },
      'db-url': { type: 'string' },
      'ply-min': { type: 'string', default: '20' },
      limit: { type: 'string', default: '50' },
      offset: { type: 'string', default: '0' },
      seed: { type: 'string', default: '0' },
      concurrency: { type: 'string', default: '4' },
      'scan-nodes': { type: 'string', default: '60000' },
      'verify-nodes': { type: 'string', default: '600000' },
      'swing-cp': { type: 'string', default: '250' },
      'win-cp': { type: 'string', default: '250' },
      'decided-cp': { type: 'string', default: '800' },
      'unique-gap-cp': { type: 'string', default: '150' },
      'verify-depth': { type: 'string', default: '20' },
      // Winning-floor gate knobs: defaults come from the module shared with the
      // audit tool, so the two CLIs cannot drift apart on what "unique" means.
      'win-hi': { type: 'string', default: String(XIANGQI_SOLVER_GATE_DEFAULTS.winHi) },
      'win-lo': { type: 'string', default: String(XIANGQI_SOLVER_GATE_DEFAULTS.winLo) },
      'min-gap-cp': {
        type: 'string',
        default: String(XIANGQI_SOLVER_GATE_DEFAULTS.minGapCp),
      },
      'material-gap-cp': {
        type: 'string',
        default: String(XIANGQI_SOLVER_GATE_DEFAULTS.materialGapCp),
      },
      'min-ply': { type: 'string', default: '8' },
      'max-solution-plies': { type: 'string', default: '7' },
      'min-solution-plies': { type: 'string', default: '3' },
      'per-game': { type: 'string', default: '3' },
      // #712 harder puzzles: a quiet key and a floor that survives the trim.
      'quiet-key': { type: 'boolean', default: false },
      'floor-after-trim': { type: 'boolean', default: false },
      'emit-seed': { type: 'boolean', default: false },
      'seed-path': { type: 'string' },
      'insert-db': { type: 'boolean', default: false },
      // Retired by #183 (puzzle content lives in the seed + DB, not a TS
      // module); parsed only to fail loudly with guidance instead of silently
      // resurrecting the deleted module.
      'emit-module': { type: 'string' },
      jsonl: { type: 'string' },
      binary: { type: 'string' },
      net: { type: 'string' },
      help: { type: 'boolean', default: false, short: 'h' },
    },
  });

  if (values.help) {
    printUsage();
    process.exit(0);
  }

  const options: XiangqiPuzzleMinerOptions = {
    source: values.source === 'dir' ? 'dir' : values.source === 'json' ? 'json' : 'db',
    dir: values.dir ?? null,
    gamesFile: values.games ?? null,
    sourceSlug: values['source-slug'] ?? null,
    dbUrl: values['db-url'] ?? process.env.DATABASE_URL ?? DEFAULT_DB_URL,
    plyMin: parseNonNegativeInt(values['ply-min'], 20),
    limit: parseNonNegativeInt(values.limit, 50),
    offset: parseNonNegativeInt(values.offset, 0),
    seed: parseNonNegativeInt(values.seed, 0),
    concurrency: parsePositiveInt(values.concurrency, 4),
    scanNodes: parsePositiveInt(values['scan-nodes'], 60_000),
    verifyNodes: parsePositiveInt(values['verify-nodes'], 600_000),
    swingCp: parsePositiveInt(values['swing-cp'], 250),
    winCp: parsePositiveInt(values['win-cp'], 250),
    decidedCp: parsePositiveInt(values['decided-cp'], 800),
    uniqueGapCp: parsePositiveInt(values['unique-gap-cp'], 150),
    verifyDepth: parsePositiveInt(values['verify-depth'], 20),
    winHi: Number.parseFloat(values['win-hi'] ?? String(XIANGQI_SOLVER_GATE_DEFAULTS.winHi)),
    winLo: Number.parseFloat(values['win-lo'] ?? String(XIANGQI_SOLVER_GATE_DEFAULTS.winLo)),
    minGapCp: parsePositiveInt(values['min-gap-cp'], XIANGQI_SOLVER_GATE_DEFAULTS.minGapCp),
    materialGapCp: parsePositiveInt(
      values['material-gap-cp'],
      XIANGQI_SOLVER_GATE_DEFAULTS.materialGapCp,
    ),
    minPly: parseNonNegativeInt(values['min-ply'], 8),
    maxSolutionPlies: parsePositiveInt(values['max-solution-plies'], 7),
    minSolutionPlies: parsePositiveInt(values['min-solution-plies'], 3),
    quietKey: values['quiet-key'] === true,
    floorAfterTrim: values['floor-after-trim'] === true,
    perGame: parsePositiveInt(values['per-game'], 3),
    emitSeed: values['emit-seed'] === true ? (values['seed-path'] ?? DEFAULT_SEED_TARGET) : null,
    insertDb: values['insert-db'] === true,
    jsonl: values.jsonl ?? resolve('scripts/variant-lab/out/xiangqi-puzzle-mine.jsonl'),
    binary: values.binary ?? null,
    net: values.net ?? null,
  };

  if (options.source === 'dir' && !options.dir) {
    console.error('--source dir requires --dir <path>');
    process.exit(1);
  }
  if (options.source === 'json' && !options.gamesFile) {
    console.error('--source json requires --games <file.json>');
    process.exit(1);
  }

  if (values['emit-module'] !== undefined) {
    console.error(
      '--emit-module is retired (#183: the mined TS module was deleted; content lives in the seed + DB).\n' +
        'Use --emit-seed to refresh packages/game/seed/puzzles/xiangqi.json, and/or --insert-db.',
    );
    process.exit(1);
  }
  return options;
}

// ── Corpus loading ───────────────────────────────────────────────────────────

async function loadDbGames(opts: XiangqiPuzzleMinerOptions): Promise<XiangqiPuzzleMinerGame[]> {
  const { init, close } = await import('../../apps/server/src/persistence-db.ts');
  const { getHistoricalXiangqiGame, getHistoricalXiangqiSource, queryHistoricalXiangqiGames } =
    await import('../../apps/server/src/persistence-historical-xiangqi.ts');
  init(opts.dbUrl);
  try {
    const ids: string[] = [];
    let offset = 0;
    let total = Number.POSITIVE_INFINITY;
    while (offset < total) {
      const page = await queryHistoricalXiangqiGames({ plyMin: opts.plyMin, limit: 200, offset });
      total = page.total;
      if (page.games.length === 0) break;
      ids.push(...page.games.map((game) => game.id));
      offset += page.games.length;
    }
    // The query orders by played_on, which shifts as the importer adds games;
    // sort by id for a stable base order, then optionally seed-shuffle.
    ids.sort();
    const ordered = opts.seed > 0 ? seededShuffle(ids, opts.seed) : ids;
    const window = ordered.slice(
      opts.offset,
      opts.limit > 0 ? opts.offset + opts.limit : undefined,
    );
    const games: XiangqiPuzzleMinerGame[] = [];
    const slugBySource = new Map<string, string | null>();
    for (const id of window) {
      const row = await getHistoricalXiangqiGame(id);
      if (row && row.moves.length >= opts.plyMin) {
        if (!slugBySource.has(row.sourceId)) {
          slugBySource.set(
            row.sourceId,
            (await getHistoricalXiangqiSource(row.sourceId))?.slug ?? null,
          );
        }
        games.push({
          id: row.id,
          moves: row.moves,
          meta: {
            event: row.eventName ?? null,
            playedOn: row.playedOn ?? null,
            result: row.result ?? null,
            redName: row.redNameRaw ?? null,
            blackName: row.blackNameRaw ?? null,
            sourceSlug: slugBySource.get(row.sourceId) ?? null,
            sourceUrl: row.sourceUrl ?? null,
            sourceGameId: row.sourceGameId ?? null,
          },
        });
      }
    }
    return games;
  } finally {
    await close();
  }
}

function loadDirGames(opts: XiangqiPuzzleMinerOptions): XiangqiPuzzleMinerGame[] {
  const dir = resolve(opts.dir as string);
  const entries = readdirSync(dir)
    .filter((name) => {
      try {
        return statSync(resolve(dir, name)).isFile();
      } catch {
        return false;
      }
    })
    .sort();
  const games: XiangqiPuzzleMinerGame[] = [];
  for (const name of entries) {
    const raw = readFileSync(resolve(dir, name), 'utf8');
    const imported = importXiangqiGame(extractGameText(raw));
    if (imported.error || imported.moves.length < opts.plyMin) {
      console.error(`skip ${name}: ${imported.error ?? `only ${imported.moves.length} plies`}`);
      continue;
    }
    const id = gameIdForFile(name);
    games.push({ id, moves: imported.moves, meta: dhtmlxqMeta(raw, id, opts.sourceSlug ?? null) });
  }
  const ordered = opts.seed > 0 ? seededShuffle(games, opts.seed) : games;
  return ordered.slice(opts.offset, opts.limit > 0 ? opts.offset + opts.limit : undefined);
}

// --source json: games exported with their real ids and attribution (e.g. the
// unmined ElephantChess games, scripts/export-unmined-xiangqi-games.mjs).
export function loadJsonGames(
  opts: Pick<XiangqiPuzzleMinerOptions, 'gamesFile' | 'plyMin' | 'seed' | 'offset' | 'limit'>,
): XiangqiPuzzleMinerGame[] {
  const parsed = JSON.parse(readFileSync(resolve(opts.gamesFile as string), 'utf8')) as {
    games?: XiangqiPuzzleMinerGame[];
  };
  const games = (parsed.games ?? []).filter(
    (game) =>
      typeof game.id === 'string' && Array.isArray(game.moves) && game.moves.length >= opts.plyMin,
  );
  const ordered = opts.seed > 0 ? seededShuffle(games, opts.seed) : games;
  return ordered.slice(opts.offset, opts.limit > 0 ? opts.offset + opts.limit : undefined);
}

// DhtmlXQ files (the DPXQ archive) carry their own metadata as
// [DhtmlXQ_<tag>]value[/DhtmlXQ_<tag>] pairs, including the game's page in
// the archive, which the source's attribution policy needs.
export function dhtmlxqMeta(
  raw: string,
  sourceGameId: string,
  sourceSlug: string | null,
): NonNullable<XiangqiPuzzleMinerGame['meta']> {
  const tag = (name: string): string | null => {
    const match = new RegExp(`\\[DhtmlXQ_${name}\\]([^\\[]*)\\[/DhtmlXQ_${name}\\]`, 'i').exec(raw);
    const value = match?.[1]?.trim();
    return value ? value : null;
  };
  const rawDate = tag('date');
  const date = rawDate ? /^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/.exec(rawDate) : null;
  const rawResult = tag('result') ?? '';
  const result = /红胜|1-0/.test(rawResult)
    ? '1-0'
    : /黑胜|0-1/.test(rawResult)
      ? '0-1'
      : /和|1\/2/.test(rawResult)
        ? '1/2-1/2'
        : null;
  return {
    event: tag('event') ?? tag('title'),
    playedOn: date
      ? `${date[1]}-${(date[2] as string).padStart(2, '0')}-${(date[3] as string).padStart(2, '0')}`
      : null,
    result,
    redName: tag('red'),
    blackName: tag('black'),
    sourceSlug,
    sourceUrl: tag('source_url'),
    sourceGameId,
  };
}

// dpxq HTML pages carry the record as `[DhtmlXQ_movelist]<digits>` inside a JS
// var (often preceded by an EMPTY [DhtmlXQ_movelist][/...] template tag that
// would win a naive first-match). Prefer the longest digit run; fall back to
// the raw text (plain movelist files import as-is via the codec sniffer).
function extractGameText(raw: string): string {
  const runs = [...raw.matchAll(/\[DhtmlXQ_movelist\](\d+)/gi)].map((match) => match[1] as string);
  if (runs.length === 0) return raw;
  return runs.reduce((longest, run) => (run.length > longest.length ? run : longest), '');
}

function gameIdForFile(name: string): string {
  return basename(name)
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]/g, '-');
}

function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const rng = createRng(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}

function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
}

// ── Mining ───────────────────────────────────────────────────────────────────

export async function mineXiangqiPuzzleGame(
  engine: PikafishEngine,
  game: XiangqiPuzzleMinerGame,
  opts: XiangqiPuzzleMinerOptions,
  metrics: XiangqiPuzzleMinerMetrics,
  seenPositions: Set<string>,
  hooks: XiangqiPuzzleMinerHooks = {},
): Promise<MinedPuzzleRecord[]> {
  await engine.newGame();

  // Stop at the live kernel's ending, including adjudicated draws. The puzzle
  // solver uses that same kernel and must not inherit an already drawn history.
  // An illegal recorded move truncates the walk (the legal prefix still mines).
  let state = createInitialXiangqiState(game.id);
  const states: XiangqiGameState[] = [state];
  const uciMoves: string[] = [];
  for (const move of game.moves) {
    if (state.status.type !== 'playing') break;
    if (!isStandardXiangqiLegalMove(state, move)) {
      metrics.gamesIllegalReplay += 1;
      break;
    }
    uciMoves.push(xiangqiMoveToPikafishUci(move));
    state = applyStandardXiangqiMove(state, move);
    states.push(state);
  }
  const moveCount = states.length - 1;

  // Phase 1: one cheap MultiPV(2) scan per position from --min-ply on.
  const scans: (number | null)[] = [];
  for (let i = 0; i <= moveCount; i += 1) {
    const positionState = states[i] as XiangqiGameState;
    if (i < opts.minPly || positionState.status.type !== 'playing') {
      scans.push(null);
      continue;
    }
    const lines = await engine.analyzeMoves(uciMoves.slice(0, i), { nodes: opts.scanNodes }, 2);
    metrics.positionsEvaluated += 1;
    const best = lines[0] ? xiangqiUciScoreToCp(lines[0].score) : null;
    scans.push(best);
  }

  const candidates = detectXiangqiBlunderCandidates(scans, moveCount, opts);
  metrics.candidates += candidates.length;

  // Phase 2: deep verify on candidates only, extending the solution one solver
  // ply at a time and stopping at the first non-unique move (born-clean lines).
  const records: MinedPuzzleRecord[] = [];
  for (const candidate of candidates) {
    if (records.length >= opts.perGame) break;
    const postBlunderState = states[candidate.ply + 1] as XiangqiGameState;
    const candidateIdentity: XiangqiPuzzleMinerCandidate = {
      gameId: game.id,
      postBlunderPly: candidate.ply + 1,
      positionKey: positionRepetitionKey(postBlunderState),
      scan: candidate,
    };
    await hooks.candidateScanned?.(candidateIdentity);
    const built = await buildGatedLine(engine, postBlunderState, opts);
    metrics.verifyEvals += built.evals;
    if (!built.ok) {
      bumpReject(metrics, built.reason);
      await hooks.candidateJudged?.({
        ...candidateIdentity,
        verdict: 'reject',
        reason: built.reason,
        evidence: { phase: 'gated-line', evals: built.evals },
        puzzle: null,
      });
      continue;
    }
    const assemblyInput = {
      gameId: game.id,
      blunderPly: candidate.ply,
      postBlunderState,
      pv: built.pv,
      verifyScore: built.verifyScore,
      swingCp: candidate.swingCp,
      sourceMeta: game.meta,
    };
    const result = assembleMinedXiangqiPuzzle(assemblyInput, {
      maxSolutionPlies: opts.maxSolutionPlies,
      minSolutionPlies: opts.minSolutionPlies,
      quietKey: opts.quietKey === true,
      floorAfterTrim: opts.floorAfterTrim === true,
    });
    if (!result.ok) {
      bumpReject(metrics, result.reason);
      await hooks.candidateJudged?.({
        ...candidateIdentity,
        verdict: 'reject',
        reason: result.reason,
        evidence: {
          phase: 'assembly',
          evals: built.evals,
          verifyBestCp: built.verifyScore.scoreCp,
          verifySecondCp: built.secondScoreCp,
        },
        puzzle: null,
      });
      if (result.reason === 'too-short' && hooks.shortCandidateVerified) {
        // Relax only the length floor, after every retained solver move has
        // passed the shared uniqueness gate. Assembly still kernel-replays,
        // requires an expected mate to finish and validates the whole puzzle.
        const short = assembleMinedXiangqiPuzzle(assemblyInput, {
          maxSolutionPlies: opts.maxSolutionPlies,
          minSolutionPlies: 1,
          quietKey: opts.quietKey === true,
        });
        if (short.ok) {
          await hooks.shortCandidateVerified({
            disposition: 'verified-short',
            minSolutionPlies: opts.minSolutionPlies,
            puzzle: short.puzzle,
            gameId: game.id,
            blunderPly: candidate.ply,
            swingCp: candidate.swingCp,
            verifyBestCp: built.verifyScore.scoreCp,
            verifySecondCp: built.secondScoreCp,
          });
        }
      }
      continue;
    }
    await hooks.candidateJudged?.({
      ...candidateIdentity,
      verdict: 'pass',
      reason: null,
      evidence: {
        phase: 'verify',
        evals: built.evals,
        verifyBestCp: built.verifyScore.scoreCp,
        verifySecondCp: built.secondScoreCp,
        solutionPlies: result.puzzle.solution.length,
      },
      puzzle: result.puzzle,
    });
    const positionKey = positionRepetitionKey(result.puzzle.initial);
    if (seenPositions.has(positionKey)) {
      bumpReject(metrics, 'duplicate-position');
      continue;
    }
    seenPositions.add(positionKey);
    metrics.verified += 1;
    for (const theme of result.puzzle.themes) {
      metrics.themes[theme] = (metrics.themes[theme] ?? 0) + 1;
    }
    records.push({
      puzzle: result.puzzle,
      gameId: game.id,
      blunderPly: candidate.ply,
      swingCp: candidate.swingCp,
      verifyBestCp: built.verifyScore.scoreCp,
      verifySecondCp: built.secondScoreCp,
    });
  }
  return records;
}

type GatedLineResult =
  | {
      ok: true;
      pv: XiangqiMove[];
      verifyScore: XiangqiVerifyLine;
      secondScoreCp: number | null;
      evals: number;
    }
  | { ok: false; reason: string; evals: number };

// Extend a solution line from the post-blunder position, verifying uniqueness at
// EVERY solver ply instead of trusting one PV. Each ply is judged by the shared
// analyzeXiangqiSolverPly (history-free FEN, MultiPV 2 at a depth floor, the
// winning-floor gate) — the SAME call the audit tool makes, so audit verdicts
// are definitionally consistent with what this gate enforced (#185). The
// defender reply is the engine's best (its uniqueness is not required). The
// line stops at the first non-unique solver move, at mate, or at the ply cap,
// and always ends on the solver's move.
async function buildGatedLine(
  engine: PikafishEngine,
  postBlunderState: XiangqiGameState,
  opts: XiangqiPuzzleMinerOptions,
): Promise<GatedLineResult> {
  const gate = {
    winHi: opts.winHi,
    winLo: opts.winLo,
    minGapCp: opts.minGapCp,
    materialGapCp: opts.materialGapCp,
  };
  const limits = { depth: opts.verifyDepth, nodes: opts.verifyNodes };
  const pv: XiangqiMove[] = [];
  let cur: XiangqiGameState = postBlunderState;
  let firstScore: XiangqiVerifyLine | null = null;
  let firstSecondCp: number | null = null;
  let evals = 0;
  while (pv.length < opts.maxSolutionPlies) {
    if (cur.status.type !== 'playing') break;
    const ply = await analyzeXiangqiSolverPly(engine, cur, limits, gate);
    evals += 1;
    const firstSolverPly = pv.length === 0;
    if (firstSolverPly) {
      firstScore = ply.best ?? null;
      firstSecondCp = ply.second?.scoreCp ?? null;
    }
    if (!ply.unique) {
      if (firstSolverPly) {
        return {
          ok: false,
          reason: ply.reason === 'near-tie' ? 'near-tie' : 'not-unique-or-not-winning',
          evals,
        };
      }
      break; // line ends on the last committed solver move
    }
    const solverTok = ply.lines[0]?.pvUci[0];
    const sq = solverTok ? pikafishUciToXiangqiSquares(solverTok) : null;
    if (!sq || !solverTok) return { ok: false, reason: 'pv-parse', evals };
    const solverMove: XiangqiMove = { from: sq.from, to: sq.to };
    if (!isStandardXiangqiLegalMove(cur, solverMove))
      return { ok: false, reason: 'pv-illegal', evals };
    // A loud key fails assembly anyway; stop before spending the line's evals.
    if (firstSolverPly && opts.quietKey && !isXiangqiQuietKeyMove(cur, solverMove)) {
      return { ok: false, reason: 'loud-key', evals };
    }
    pv.push(solverMove);
    cur = applyStandardXiangqiMove(cur, solverMove);
    if (cur.status.type !== 'playing') break; // mate: line ends on the solver move
    if (pv.length >= opts.maxSolutionPlies) break;
    // Defender reply: the engine's best defense (uniqueness not required of it).
    await engine.newGame();
    const replyLines = await engine.analyzeFen(standardXiangqiEngineFen(cur), limits, 1);
    evals += 1;
    const replyTok = replyLines[0]?.pvUci[0];
    const rsq = replyTok ? pikafishUciToXiangqiSquares(replyTok) : null;
    if (!rsq || !replyTok) break;
    const replyMove: XiangqiMove = { from: rsq.from, to: rsq.to };
    if (!isStandardXiangqiLegalMove(cur, replyMove)) break;
    pv.push(replyMove);
    cur = applyStandardXiangqiMove(cur, replyMove);
    if (cur.status.type !== 'playing') {
      pv.pop(); // a defender move that ends the game is not a puzzle ply
      break;
    }
  }
  if (pv.length % 2 === 0) pv.pop(); // guarantee the line ends on the solver's move
  if (pv.length < 1 || !firstScore) return { ok: false, reason: 'too-short', evals };
  return { ok: true, pv, verifyScore: firstScore, secondScoreCp: firstSecondCp, evals };
}

function bumpReject(metrics: XiangqiPuzzleMinerMetrics, reason: string): void {
  metrics.rejects[reason] = (metrics.rejects[reason] ?? 0) + 1;
}

// ── Output ───────────────────────────────────────────────────────────────────

// One puzzle per line: compact but diffable/mergeable. Must stay format-
// compatible with the loader in packages/game/src/puzzle-seed.ts.
export function renderXiangqiSeedFile(puzzles: readonly XiangqiPuzzle[]): string {
  const lines = puzzles.map((puzzle) => `    ${JSON.stringify(puzzle)}`);
  return `{\n  "format": "mistboard-puzzle-seed-v1",\n  "registry": "xiangqi",\n  "puzzles": [\n${lines.join(
    ',\n',
  )}\n  ]\n}\n`;
}

// Rewrite the seed's mined (xq-mined-*) section wholesale with this run's
// output — the same replace-the-corpus semantics the old --emit-module had —
// while preserving curated (non-mined-id) entries in their existing order.
function emitSeed(target: string, mined: readonly XiangqiPuzzle[]): void {
  let curated: XiangqiPuzzle[] = [];
  if (existsSync(target)) {
    const existing = JSON.parse(readFileSync(target, 'utf-8')) as { puzzles?: XiangqiPuzzle[] };
    curated = (existing.puzzles ?? []).filter((puzzle) => !puzzle.id.startsWith('xq-mined-'));
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, renderXiangqiSeedFile([...curated, ...mined]));
}

// Upsert this run's puzzles into the `puzzles` table (migration 105) as
// miner-owned rows: source_kind='mined' so the seed sync never reconciles them
// away, seq appended after the current max so serving order stays stable. An
// id that already exists keeps its seq (and, if seed-owned, its source_kind).
async function insertDbPuzzles(dbUrl: string, puzzles: readonly XiangqiPuzzle[]): Promise<void> {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ next: string }>(
      'SELECT COALESCE(max(seq) + 1, 0)::text AS next FROM puzzles',
    );
    let seq = Number.parseInt(rows[0]?.next ?? '0', 10);
    for (const puzzle of puzzles) {
      await client.query(
        `INSERT INTO puzzles (id, variant, title, seq, goal_type, themes, solution_plies, data, source_kind, mined_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'mined', now())
         ON CONFLICT (id) DO UPDATE SET
           variant = EXCLUDED.variant,
           title = EXCLUDED.title,
           goal_type = EXCLUDED.goal_type,
           themes = EXCLUDED.themes,
           solution_plies = EXCLUDED.solution_plies,
           data = EXCLUDED.data,
           mined_at = now()`,
        [
          puzzle.id,
          puzzle.variant,
          puzzle.title,
          seq,
          puzzle.goal.type,
          [...puzzle.themes],
          puzzle.solution.length,
          JSON.stringify(puzzle),
        ],
      );
      seq += 1;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await client.end();
  }
}

function jsonlLine(record: MinedPuzzleRecord | VerifiedShortPuzzleRecord): string {
  const { puzzle } = record;
  const key = puzzle.solution[0];
  return JSON.stringify({
    id: puzzle.id,
    gameId: record.gameId,
    // The start position and whether the key move is quiet (no capture, no
    // check) ride on every record, so a run mined without --quiet-key can be
    // cut to its quiet subset afterwards without re-mining (#712).
    fen: standardXiangqiEngineFen(puzzle.initial),
    quietKey: key ? isXiangqiQuietKeyMove(puzzle.initial, key) : false,
    sourceUrl: puzzle.sourceGame?.attribution?.url ?? null,
    ply: record.blunderPly + 1,
    solver: puzzle.goal.winner ?? null,
    goal: puzzle.goal.type,
    centipawns: puzzle.goal.type === 'winning-advantage' ? (puzzle.goal.centipawns ?? null) : null,
    swingCp: record.swingCp,
    verifyBestCp: record.verifyBestCp,
    verifySecondCp: record.verifySecondCp,
    themes: puzzle.themes,
    solutionPlyCount: puzzle.solution.length,
    solution: puzzle.solution.map(standardXiangqiPuzzleMoveLabel),
    title: puzzle.title,
    ...('disposition' in record
      ? {
          disposition: record.disposition,
          minSolutionPlies: record.minSolutionPlies,
          puzzle,
        }
      : {}),
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(options: XiangqiPuzzleMinerOptions): Promise<void> {
  const startedAt = Date.now();
  const binary = options.binary ? resolve(options.binary) : pikafishXiangqiPath();
  const net = options.net ? resolve(options.net) : pikafishXiangqiNetPath(binary);

  const games =
    options.source === 'db'
      ? await loadDbGames(options)
      : options.source === 'json'
        ? loadJsonGames(options)
        : loadDirGames(options);
  const metrics: XiangqiPuzzleMinerMetrics = {
    gamesRequested: options.limit,
    gamesLoaded: games.length,
    gamesScanned: 0,
    gamesFailed: 0,
    gamesIllegalReplay: 0,
    positionsEvaluated: 0,
    verifyEvals: 0,
    candidates: 0,
    verified: 0,
    rejects: {},
    themes: {},
  };
  const seenPositions = new Set<string>();
  const records: MinedPuzzleRecord[] = [];
  const shortRecords: VerifiedShortPuzzleRecord[] = [];

  let cursor = 0;
  const workerCount = Math.max(1, Math.min(options.concurrency, Math.max(games.length, 1)));
  const workers = Array.from({ length: workerCount }, async () => {
    let engine = new PikafishEngine(binary, net);
    await engine.init();
    try {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= games.length) break;
        const game = games[index] as XiangqiPuzzleMinerGame;
        try {
          const mined = await mineXiangqiPuzzleGame(engine, game, options, metrics, seenPositions, {
            shortCandidateVerified: async (record) => {
              shortRecords.push(record);
            },
          });
          records.push(...mined);
          metrics.gamesScanned += 1;
        } catch (err) {
          metrics.gamesFailed += 1;
          console.error(`game ${game.id} failed: ${(err as Error).message}`);
          engine.kill();
          engine = new PikafishEngine(binary, net);
          await engine.init();
        }
        if ((index + 1) % 10 === 0 || index + 1 === games.length) {
          console.error(
            `progress: ${index + 1}/${games.length} games, ${metrics.verified} puzzles`,
          );
        }
      }
    } finally {
      engine.quit();
    }
  });
  await Promise.all(workers);

  // Deterministic output order regardless of worker interleaving.
  records.sort((a, b) => a.puzzle.id.localeCompare(b.puzzle.id));

  // Serving normal form: winning-advantage lines end on the payoff capture
  // (the pre-#183 aggregator applied this trim before serving; the seed and DB
  // carry records already in normal form, and validation rejects filler tails).
  const servedPuzzles = records.map((record) => trimXiangqiWinningAdvantageTail(record.puzzle));

  if (options.emitSeed) {
    const target = resolve(options.emitSeed);
    emitSeed(target, servedPuzzles);
    console.error(
      `wrote ${servedPuzzles.length} mined puzzles to ${target} — update the pins in packages/game/src/puzzles-seed.test.ts`,
    );
  }
  if (options.insertDb) {
    await insertDbPuzzles(options.dbUrl, servedPuzzles);
    console.error(
      `upserted ${servedPuzzles.length} mined puzzles into ${options.dbUrl.replace(/\/\/.*@/, '//<redacted>@')}`,
    );
  }
  mkdirSync(dirname(resolve(options.jsonl)), { recursive: true });
  const offlineRecords = [...records, ...shortRecords].sort((a, b) =>
    a.puzzle.id.localeCompare(b.puzzle.id),
  );
  writeFileSync(resolve(options.jsonl), offlineRecords.map((r) => `${jsonlLine(r)}\n`).join(''));
  console.error(`wrote sidecar ${resolve(options.jsonl)} (${offlineRecords.length} lines)`);

  const wallClockMs = Date.now() - startedAt;
  const summary = {
    kind: 'xiangqi-puzzle-mine-metrics',
    source: options.source,
    games: {
      requested: metrics.gamesRequested,
      loaded: metrics.gamesLoaded,
      scanned: metrics.gamesScanned,
      failed: metrics.gamesFailed,
      illegalReplayTruncated: metrics.gamesIllegalReplay,
    },
    positionsEvaluated: metrics.positionsEvaluated,
    verifyEvals: metrics.verifyEvals,
    candidates: metrics.candidates,
    verified: metrics.verified,
    verifiedShort: shortRecords.length,
    yieldPuzzlesPerGamePct:
      metrics.gamesScanned > 0
        ? Math.round((metrics.verified / metrics.gamesScanned) * 10000) / 100
        : 0,
    yieldVerifiedPerCandidatePct:
      metrics.candidates > 0
        ? Math.round((metrics.verified / metrics.candidates) * 10000) / 100
        : 0,
    rejects: metrics.rejects,
    themes: metrics.themes,
    wallClockMs,
    secPerGame:
      metrics.gamesScanned > 0 ? Math.round(wallClockMs / metrics.gamesScanned / 10) / 100 : null,
    budgets: { scanNodes: options.scanNodes, verifyNodes: options.verifyNodes },
    thresholds: {
      swingCp: options.swingCp,
      winCp: options.winCp,
      decidedCp: options.decidedCp,
      uniqueGapCp: options.uniqueGapCp,
      winHi: options.winHi,
      winLo: options.winLo,
      minGapCp: options.minGapCp,
      materialGapCp: options.materialGapCp,
      minPly: options.minPly,
      maxSolutionPlies: options.maxSolutionPlies,
      minSolutionPlies: options.minSolutionPlies,
      quietKey: options.quietKey === true,
      floorAfterTrim: options.floorAfterTrim === true,
      perGame: options.perGame,
    },
    concurrency: workerCount,
    seed: options.seed,
    offset: options.offset,
  };
  // The LAST stdout line is the machine-parseable metrics object.
  console.log(JSON.stringify(summary));
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function printUsage(): void {
  console.log(`usage: node_modules/.bin/tsx scripts/variant-lab/xiangqi-puzzle-miner.ts [options]

Mines lichess-style standard-xiangqi puzzles from real games with Pikafish.

Corpus:
  --source db|dir         db = historical_xiangqi_games via DATABASE_URL; dir = game files. Default: db.
  --dir PATH              Directory of game files (dir mode). dpxq HTML or any importXiangqiGame notation.
  --db-url URL            Postgres URL. Default: $DATABASE_URL or the local dev database.
  --ply-min N             Minimum game plies. Default: 20.
  --limit N               Games to mine (0 = all). Default: 50.
  --offset N              Skip the first N games of the ordered corpus. Default: 0.
  --seed N                Deterministic corpus shuffle before offset/limit (0 = no shuffle). Default: 0.

Engine:
  --concurrency N         Parallel engine workers (per-game granularity). Default: 4.
  --scan-nodes N          Phase-1 node budget per position (MultiPV 2). Default: 60000.
  --verify-nodes N        Phase-2 node budget per verify search (MultiPV 2). Default: 600000.
  --verify-depth N        Phase-2 depth floor per solver ply (stable ordering). Default: 20.
  --binary PATH           Pikafish binary override (default: pikafishXiangqiPath()).
  --net PATH              NNUE net override (default: pikafish.nnue beside the binary).

Detection:
  --swing-cp N            Min eval the game move lost vs the engine best. Default: 250.
  --win-cp N              Min post-blunder eval for the solver (or mate). Default: 250.
  --decided-cp N          Skip positions already at |eval| >= N pre-blunder. Default: 800.
  --unique-gap-cp N       (legacy) Min best-vs-second gap; the per-ply gate below supersedes it. Default: 150.
  --win-hi F              Per-ply gate: min win prob for the best solver line. Default: 0.80.
  --win-lo F              Per-ply gate: a runner-up at/below this win prob has lost the win. Default: 0.60.
  --min-gap-cp N          Hard near-tie rejection floor for non-mate alternatives. Default: 200.
  --material-gap-cp N     Per-ply gate: a runner-up trailing best by >= N cp is wrong even if winning. Default: 250.
  --min-ply N             Skip game plies before N (opening filter). Default: 8.
  --max-solution-plies N  Solution-line cap (normalized to odd). Default: 7.
  --min-solution-plies N  Minimum solution plies for seed/DB output. Default: 3.
  --per-game N            Max puzzles mined per game. Default: 3.

Output:
  --emit-seed             Rewrite the mined section of the committed seed asset
                          (packages/game/seed/puzzles/xiangqi.json; override with --seed-path).
                          Curated (non-mined-id) entries are kept.
  --seed-path PATH        Seed asset target for --emit-seed.
  --insert-db             Upsert this run's puzzles into the puzzles table at --db-url
                          (source_kind='mined'; the boot-time seed sync never touches them).
  --jsonl PATH            Sidecar path. Default: scripts/variant-lab/out/xiangqi-puzzle-mine.jsonl.
                          Also retains verified-short candidates with full puzzle data;
                          these remain rejected for seed/DB output and live workers.

The last stdout line is always a metrics JSON object (kind=xiangqi-puzzle-mine-metrics).`);
}

// Only run when invoked directly (tsx scripts/.../xiangqi-puzzle-miner.ts), not
// when imported for its exports (e.g. renderXiangqiSeedFile in a backfill script).
if (import.meta.url === `file://${process.argv[1]}`) {
  await main(parseCliOptions());
}
