#!/usr/bin/env node
// Local teaching-kit orchestration. Candidate rankings are evidence for the
// editor; selection.json is deliberately empty until that editor chooses.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { MOMENT_RULES } from './lib/player-kit-moments.mjs';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const MAX_GAMES = 12;
export const DEFAULT_DATABASE = 'postgres://mistboard:mistboard@localhost:5435/mistboard';
export const BUDGETS = Object.freeze({
  annotationNodes: 60_000,
  // The miner's own defaults: at a tenth of them it finds no swings in a
  // master game, so a kit came back with no puzzles.
  scanNodes: 60_000,
  verifyNodes: 600_000,
  verifyDepth: 20,
  maxPlies: 400,
  concurrency: 1,
});

class KitError extends Error {}

export function assertLocalDatabase(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    /* Use the same redacted error for malformed targets. */
  }
  if (
    !url ||
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.search ||
    url.hash ||
    !url.pathname ||
    url.pathname === '/'
  ) {
    throw new KitError(
      'kit requires a local PostgreSQL URL with a database and no connection overrides',
    );
  }
  return `${url.hostname}:${url.port || '5432'}${url.pathname}`;
}

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const writeJson = async (file, value) => writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
const outcomeScore = { win: 3, draw: 2, loss: 1 };

function rankBoards(boards, missing) {
  return boards
    .filter((board) => {
      if (board.level !== 'A' || !['1-0', '0-1', '1/2-1/2'].includes(board.result)) return false;
      if (
        !board.moves?.length ||
        board.moves.length !== board.plyCount ||
        board.moves.length > BUDGETS.maxPlies
      ) {
        missing.push({
          kind: 'game-record',
          boardId: board.boardId,
          detail: 'Missing, incomplete, or over-budget move record',
        });
        return false;
      }
      return true;
    })
    .sort(
      (a, b) =>
        (outcomeScore[b.outcome] ?? 0) - (outcomeScore[a.outcome] ?? 0) ||
        a.boardId.localeCompare(b.boardId),
    )
    .map((board, index) => ({
      ...board,
      rank: index + 1,
      reasons: [
        'Finished A-level game',
        `Player result: ${board.outcome}`,
        `${board.moves.length} recorded plies; ties ordered by board id`,
      ],
      preview: false,
    }));
}

export async function runKit(options, services) {
  const {
    slug,
    dbUrl,
    apply = false,
    dryRun = false,
    root = REPO_ROOT,
    maxGames = 3,
    boardIds = [],
  } = options;
  const target = assertLocalDatabase(dbUrl);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug ?? '')) throw new KitError('invalid player slug');
  if (!Number.isInteger(maxGames) || maxGames < 1 || maxGames > MAX_GAMES)
    throw new KitError(`maxGames must be 1 through ${MAX_GAMES}`);
  if (apply && dryRun) throw new KitError('--apply and --dry-run cannot be combined');
  const directory = join(root, 'docs-private/players/kits', slug);
  if (apply) return applyKit({ directory, slug, target, dbUrl }, services);
  await mkdir(directory, { recursive: true });
  const missing = [];
  const data = await services.loadPlayer(slug, dbUrl);
  if (!data.player)
    missing.push({ kind: 'player', detail: 'Player page does not resolve in the local archive' });
  if (data.player && !data.names[data.player.name])
    missing.push({ kind: 'name-map', detail: 'Player has no translated name' });
  for (const board of data.boards) {
    for (const name of [board.red?.name, board.black?.name].filter(Boolean)) {
      if (
        !data.names[name] &&
        !missing.some((item) => item.kind === 'name-map' && item.name === name)
      )
        missing.push({ kind: 'name-map', name, boardId: board.boardId });
    }
  }
  const candidates = data.player ? rankBoards(data.boards, missing) : [];
  if (data.player && !candidates.length)
    missing.push({ kind: 'games', detail: 'No complete finished A-level games' });
  let engine = null;
  if (candidates.length) {
    try {
      engine = await services.engine();
    } catch {
      missing.push({
        kind: 'engine',
        detail: 'Pinned local Pikafish binary or net unavailable; no fallback used',
      });
    }
  }
  if (
    !Array.isArray(boardIds) ||
    boardIds.length > maxGames ||
    new Set(boardIds).size !== boardIds.length
  )
    throw new KitError('Choose at most maxGames distinct board ids');
  const previewBoards = boardIds.length
    ? boardIds.map((id) => {
        const board = candidates.find((candidate) => candidate.boardId === id);
        if (!board) throw new KitError('preview board is not an eligible candidate');
        return board;
      })
    : candidates.slice(0, maxGames);
  const puzzles = [];
  const annotations = [];
  for (const board of engine ? previewBoards : []) {
    try {
      const prepared = await services.prepareGame(board, {
        directory,
        engine,
        budgets: BUDGETS,
        dbUrl,
      });
      if (!prepared.annotation?.rows?.length) throw new KitError('missing annotation rows');
      annotations.push({ board, annotation: prepared.annotation });
      board.preview = true;
      const accuracy =
        prepared.annotation.accuracy?.[board.colour === 'black' ? 'second' : 'first'];
      if (Number.isFinite(accuracy))
        board.reasons.push(`Local engine accuracy: ${accuracy.toFixed(1)}%`);
      for (const puzzle of prepared.puzzles)
        puzzles.push({ ...puzzle, tags: [...new Set([...(puzzle.tags ?? []), `player:${slug}`])] });
    } catch {
      missing.push({
        kind: 'preparation',
        boardId: board.boardId,
        detail: 'Local annotation or mining failed; see local inputs and retry',
      });
    }
  }
  if (candidates.length > maxGames)
    missing.push({
      kind: 'budget',
      detail: `Preview limited to ${maxGames} ranked games; final selections remain open`,
    });
  let moments = [];
  if (annotations.length) {
    try {
      moments = await services.findMoments({
        annotations,
        names: data.names,
        engine,
        budgets: BUDGETS,
      });
    } catch {
      missing.push({
        kind: 'moments',
        detail: 'Local moment verification failed; retry preparation',
      });
    }
  }
  if (moments.length < MOMENT_RULES.minExpected)
    missing.push({
      kind: 'moments',
      detail: `Only ${moments.length} critical moments passed; fewer than ${MOMENT_RULES.minExpected}`,
    });
  const gamePlan = annotations.length
    ? await services.buildStudy({
        directory,
        player: data.player,
        names: data.names,
        boards: annotations.map((a) => a.board),
        annotations,
      })
    : { create: null, ops: [] };
  const plan = appendMoments(gamePlan, moments);
  const momentManifest = moments.map(({ chapter: _chapter, ...moment }) => moment);
  const artifacts = { plan, puzzles, annotations, moments: momentManifest };
  const manifest = {
    version: 1,
    slug,
    player: data.player,
    generatedAt: new Date().toISOString(),
    mode: 'dry-run',
    playerPage: {
      path: `/players/${slug}`,
      resolved: Boolean(data.player),
      linkedBoards: data.boards.length,
    },
    nameMap: data.names,
    missing,
    engine,
    budgets: { ...BUDGETS, maxGames },
    moments: momentManifest,
    candidates: candidates.map(({ moves: _moves, ...candidate }) => candidate),
    selection: { boardIds: [], puzzleIds: [], momentIds: [] },
    artifacts: {
      studyDraft: 'study-draft.json',
      puzzles: 'candidate-puzzles.json',
      annotations: 'annotations.json',
      selection: 'selection.json',
    },
    artifactsSha256: digest(artifacts),
  };
  await writeJson(join(directory, 'study-draft.json'), plan);
  await writeJson(join(directory, 'candidate-puzzles.json'), puzzles);
  await writeJson(join(directory, 'annotations.json'), annotations);
  // Never overwrite an editor's selections on a fresh dry run.
  await writeFile(
    join(directory, 'selection.json'),
    `${JSON.stringify(manifest.selection, null, 2)}\n`,
    { flag: 'wx' },
  ).catch((error) => {
    if (error.code !== 'EEXIST') throw error;
  });
  await writeJson(join(directory, 'manifest.json'), manifest);
  return manifest;
}

function appendMoments(plan, moments) {
  for (const { id, chapter } of moments) {
    const add = { op: 'add', ref: `moment:${id}`, ...chapter };
    if (plan.create.chapter) plan.ops.push(add);
    else plan.create.chapter = { variant: 'xiangqi', ...chapter };
  }
  return plan;
}

async function applyKit({ directory, slug, target, dbUrl }, services) {
  const manifest = await readJson(join(directory, 'manifest.json'));
  const plan = await readJson(join(directory, 'study-draft.json'));
  const puzzles = await readJson(join(directory, 'candidate-puzzles.json'));
  const annotations = await readJson(join(directory, 'annotations.json'));
  if (
    manifest.version !== 1 ||
    manifest.slug !== slug ||
    !Array.isArray(manifest.moments) ||
    digest({ plan, puzzles, annotations, moments: manifest.moments }) !== manifest.artifactsSha256
  )
    throw new KitError('kit artifacts changed; run a fresh dry run');
  const selection = await readJson(join(directory, 'selection.json'));
  // Existing selection files remain usable after a fresh preview adds moments.
  if (selection.momentIds === undefined) selection.momentIds = [];
  if (
    !Array.isArray(selection.boardIds) ||
    !Array.isArray(selection.puzzleIds) ||
    !Array.isArray(selection.momentIds) ||
    (!selection.boardIds.length && !selection.puzzleIds.length && !selection.momentIds.length)
  )
    throw new KitError(
      'Select boardIds, puzzleIds and/or momentIds in selection.json before --apply',
    );
  const boards = selection.boardIds.map((id) => {
    const entry = annotations.find((a) => a.board.boardId === id);
    if (!entry) throw new KitError('selected board is not a prepared candidate');
    return entry;
  });
  const selectedPuzzles = selection.puzzleIds.map((id) => {
    const puzzle = puzzles.find((p) => p.id === id);
    if (!puzzle?.tags?.includes(`player:${slug}`))
      throw new KitError('selected puzzle is not a tagged candidate');
    return puzzle;
  });
  const selectedMoments = selection.momentIds.map((id) => {
    const moment = manifest.moments.find((m) => m.id === id);
    const chapter = plan.ops.find((op) => op.op === 'add' && op.ref === `moment:${id}`);
    if (!moment || !chapter?.gamebook)
      throw new KitError('selected moment is not a prepared candidate');
    const { op: _op, ref: _ref, ...content } = chapter;
    return { ...moment, chapter: content };
  });
  if (
    new Set(selection.boardIds).size !== boards.length ||
    new Set(selection.puzzleIds).size !== selectedPuzzles.length ||
    new Set(selection.momentIds).size !== selectedMoments.length
  )
    throw new KitError('duplicate selections');
  const fingerprint = digest({ artifacts: manifest.artifactsSha256, selection, target });
  const receiptPath = join(directory, 'applied.json');
  let previous;
  try {
    previous = await readJson(receiptPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (previous) {
    if (previous.fingerprint !== fingerprint)
      throw new KitError(
        'kit already applied with different selections or target; use a new dry-run directory',
      );
    return previous;
  }
  const selectedPlan = boards.length
    ? await services.buildStudy({
        directory,
        player: manifest.player,
        names: manifest.nameMap,
        boards: boards.map((a) => a.board),
        annotations: boards,
        selected: true,
      })
    : selectedMoments.length
      ? { create: { ...plan.create, chapter: null }, ops: [] }
      : null;
  if (selectedPlan) appendMoments(selectedPlan, selectedMoments);
  const result = await services.publish({ dbUrl, plan: selectedPlan, puzzles: selectedPuzzles });
  const receipt = { ...result, fingerprint, target, appliedAt: new Date().toISOString() };
  await writeJson(receiptPath, receipt);
  return receipt;
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      'dry-run': { type: 'boolean' },
      apply: { type: 'boolean' },
      'max-games': { type: 'string', default: '3' },
      board: { type: 'string', multiple: true },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log('npm run kit -- <slug> [--dry-run | --apply] [--max-games 1..12] [--board <id> …]');
    return;
  }
  if (positionals.length !== 1) throw new KitError('kit requires one player slug');
  const dbUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE;
  assertLocalDatabase(dbUrl);
  const { localKitServices } = await import('./lib/player-kit-local.mjs');
  const result = await runKit(
    {
      slug: positionals[0],
      dbUrl,
      dryRun: values['dry-run'],
      apply: values.apply,
      maxGames: Number(values['max-games']),
      boardIds: values.board,
    },
    localKitServices,
  );
  console.log(
    JSON.stringify({
      slug: positionals[0],
      mode: values.apply ? 'applied-local' : 'dry-run',
      candidates: result.candidates?.length,
      missing: result.missing,
      studyId: result.studyId,
      directory: `docs-private/players/kits/${positionals[0]}/`,
    }),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)
  main().catch((error) => {
    console.error(
      error instanceof KitError
        ? error.message
        : 'kit failed; check the local database and generated artifacts (no remote fallback)',
    );
    process.exitCode = 1;
  });
