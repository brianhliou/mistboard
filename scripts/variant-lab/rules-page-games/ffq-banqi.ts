// Decided 2026-11-15: build from the supplied masked postgame read, offline.
// node --import tsx scripts/variant-lab/rules-page-games/ffq-banqi.ts --binary FILE --scratch DIR
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  applyFFQBanqiReplayMove,
  createInitialFFQBanqiReplayState,
  FFQ_BANQI_FACE_UP_SQUARES,
  FFQ_BANQI_PUBLIC_REPLAY,
  type FFQBanqiMove,
  type FFQBanqiPlayerView,
  type FFQBanqiReplayIdentity,
  ffqBanqiReplayMoveToUci,
  ffqBanqiStateToFen,
  getFFQBanqiPlayerView,
  isFFQBanqiLegalMove,
  winPercent,
} from '@mistboard/game';
import type { BanqiDecision } from '../../../apps/server/src/banqi-analysis.ts';
import { FFQ_BANQI_ANALYSIS_ENGINE_ID } from '../../../apps/server/src/ffq-banqi-analysis.ts';
import {
  analyzeFFQBanqiDecisions,
  FFQ_BANQI_DECISIONS_ENGINE_ID,
} from '../../../apps/server/src/ffq-banqi-decisions.ts';
import { ffqBanqiMoveToUci, uciToFFQBanqiMove } from '../../../apps/server/src/ffq-banqi-engine.ts';
import { searchFFQPublicFen } from '../../../apps/server/src/ffq-banqi-public-analysis.ts';
import { validateStudyDecisions } from '../../../apps/server/src/study-chapter-decisions.ts';
import { checkCreate, type StudyCreateSpec } from '../../../apps/server/src/study-edit-cli.ts';
import { annotateFromEngine } from '../../study-annotate.ts';
import { checkpoint, isMain, type StudyEval } from './hidden-study.ts';

export type PublicGame = {
  game: {
    roomId: string;
    variant: string;
    result: string;
    termination: string;
    plyCount: number;
    startedAt: string;
    players: { color: string; name: string }[];
  };
  timeline: { type: string; ply: number; color: string; move: FFQBanqiMove }[];
  history: { truth: { ply: number; view: FFQBanqiPlayerView; fen: string }[] };
};
export const inputPath = new URL('inputs/ffq-banqi.export.json', import.meta.url);
export const readFFQGame = (): PublicGame => JSON.parse(readFileSync(inputPath, 'utf8'));
const identity = (piece: FFQBanqiReplayIdentity) => ({ color: piece.color, role: piece.role });

export function replayFFQGame(source = readFFQGame()) {
  const { game, timeline, history } = source;
  if (
    game.variant !== 'ffq-banqi' ||
    timeline.length !== game.plyCount ||
    history.truth.length !== timeline.length + 1
  )
    throw new Error('incomplete Fanfanqi export');
  const initialRevealed = FFQ_BANQI_FACE_UP_SQUARES.map((i) => {
    const piece = history.truth[0]!.view.board[i];
    if (!piece || piece.faceDown) throw new Error('missing public opening identity');
    return identity(piece);
  });
  const states = [createInitialFFQBanqiReplayState(game.roomId, initialRevealed)];
  const tokens: string[] = [];
  const moves: FFQBanqiMove[] = [];
  const verify = (ply: number) => {
    const state = states[ply]!;
    const frame = history.truth[ply]!;
    const view = getFFQBanqiPlayerView(state, 'observer');
    if (frame.ply !== ply || ffqBanqiStateToFen(state) !== frame.fen)
      throw new Error(`public FEN mismatch at ${ply}`);
    for (const field of [
      'board',
      'captured',
      'pool',
      'hp',
      'status',
      'noProgressClock',
      'chaseCounts',
      'moveNumber',
    ] as const)
      if (!isDeepStrictEqual(view[field], frame.view[field]))
        throw new Error(`public ${field} mismatch at ${ply}`);
  };
  verify(0);
  for (const [i, event] of timeline.entries()) {
    const before = states[i]!;
    if (
      event.type !== 'move-played' ||
      event.ply !== i + 1 ||
      before.status.type !== 'playing' ||
      before.status.turn !== event.color
    )
      throw new Error(`invalid recorded move ${i + 1}`);
    const { from, to } = event.move;
    const after = history.truth[i + 1]!.view;
    const shown = from === to ? after.board[to] : null;
    const victim =
      from !== to && before.board[to]?.faceDown ? after.captured[before.captures.length] : null;
    const move = {
      from,
      to,
      ...(shown && !shown.faceDown ? { revealed: identity(shown) } : {}),
      ...(victim ? { capturedHidden: { color: victim.owner, role: victim.role } } : {}),
    };
    tokens.push(ffqBanqiReplayMoveToUci(move));
    moves.push({ from, to });
    states.push(applyFFQBanqiReplayMove(before, move));
    verify(i + 1);
  }
  const status = states.at(-1)!.status;
  if (
    status.type !== 'finished' ||
    status.reason !== 'hp' ||
    game.termination !== 'points' ||
    game.result !== `${status.winner}-wins`
  )
    throw new Error('kernel result does not match recorded result/termination');
  // Return only the public fields needed downstream, never the raw export.
  return { game, initialRevealed, states, tokens, moves };
}
export type FFQTrack = ReturnType<typeof replayFFQGame>;
export type Provenance = ReturnType<typeof pinnedFFQEngine>;
export function pinnedFFQEngine(binary: string, source = resolve('../misty-ffq-banqi')) {
  const recipe = readFileSync(new URL('../../fetch-release-asset.sh', import.meta.url), 'utf8');
  const section = recipe.split('  ffq-banqi-engine)')[1]?.split(';;')[0];
  const tag = section?.match(/tag=(\S+)/)?.[1];
  const releaseSha256 = section?.match(/sha=([a-f0-9]{64})/)?.[1];
  if (!tag || !releaseSha256) throw new Error('served Fanfanqi pin unavailable');
  const pin = spawnSync('git', ['-C', source, 'rev-parse', `${tag}^{}`], { encoding: 'utf8' });
  if (pin.status !== 0 || !/^[a-f0-9]{40}\s*$/.test(pin.stdout))
    throw new Error('served source pin unavailable');
  const probe = spawnSync(binary, [], { input: 'uci\nquit\n', encoding: 'utf8', timeout: 10_000 });
  if (probe.status !== 0 || !probe.stdout.includes(`id name MistyFFQ ${tag.slice(1)}\n`))
    throw new Error('served Fanfanqi engine unavailable or wrong version');
  process.env.MISTBOARD_FFQ_BANQI_ENGINE_PATH = resolve(binary);
  return {
    recipe: 'scripts/fetch-release-asset.sh (railpack.json)',
    repository: 'brianhliou/misty-ffq-banqi',
    tag,
    sourcePin: pin.stdout.trim(),
    releaseSha256,
    binarySha256: createHash('sha256').update(readFileSync(binary)).digest('hex'),
    platform: `${process.platform}-${process.arch}`,
  };
}

export function makeFFQStudy(
  track: FFQTrack,
  analysis: StudyEval[],
  decisions: BanqiDecision[],
  comments: Record<string, string>,
  provenance: Provenance,
) {
  const { states, moves, tokens, game } = track;
  if (
    analysis.length !== states.length ||
    analysis.some(
      (row, i) => row.ply !== i || (!Number.isFinite(row.cp) && !Number.isFinite(row.mate)),
    )
  )
    throw new Error('incomplete mainline analysis');
  const chancePlies = moves.flatMap((m, i) => (states[i]!.board[m.to]?.faceDown ? [i + 1] : []));
  if (
    !isDeepStrictEqual(
      decisions.map((d) => d.ply),
      chancePlies,
    )
  )
    throw new Error('incomplete chance analysis');
  const notes = Object.entries(comments);
  if (
    notes.length < 5 ||
    notes.length > 8 ||
    notes.some(
      ([p, text]) =>
        !Number.isInteger(Number(p)) ||
        Number(p) < 1 ||
        Number(p) > moves.length ||
        !text.trim() ||
        /[\u3400-\u9fff]|—|\b(king|rook|knight|pawn)\b/i.test(text),
    )
  )
    throw new Error('requires five to eight English mainline notes');
  for (const [p, text] of notes) {
    const observed = new Set(
      states
        .slice(0, Number(p) + 1)
        .flatMap((s) => [
          ...s.board.flatMap((piece) =>
            piece && !piece.faceDown ? [`${piece.color} ${piece.role}`] : [],
          ),
          ...s.captures.map((piece) => `${piece.owner} ${piece.role}`),
        ]),
    );
    for (const named of text
      .toLowerCase()
      .matchAll(/\b(red|black) (general|advisor|elephant|chariot|horse|cannon|soldier)\b/g))
      if (!observed.has(named[0])) throw new Error(`note names an unflipped piece at ${p}`);
  }
  const score = analysis.map((r, i) =>
    i === moves.length
      ? game.result === 'red-wins'
        ? 1
        : 0
      : winPercent(r.cp, r.mate, FFQ_BANQI_ANALYSIS_ENGINE_ID) / 100,
  );
  const byPly = new Map(decisions.map((d) => [d.ply, d]));
  const red = (d: BanqiDecision, value: number) =>
    d.mover === 'red' ? value / 100 : 1 - value / 100;
  const intro =
    "Misty Level 8 (red) beats Level 7 (black) on points. Step through with the arrows; seven moments have a note. The graph shows Red's winning chances, and the die beside a flip shows whether it was lucky.";
  const tree = annotateFromEngine({
    rootFen: '',
    moves: tokens,
    redScore: score.map((s, i) => {
      const d = byPly.get(i + 1);
      return d ? red(d, d.bestWin) : s;
    }),
    moveScore: moves.map((_, i) => {
      const d = byPly.get(i + 1);
      return d ? red(d, d.playedWin) : score[i + 1]!;
    }),
    best: analysis.map((r, i) => {
      const d = byPly.get(i + 1);
      const best = d?.candidates?.[0]?.move ?? r.best;
      return best === (moves[i] && ffqBanqiMoveToUci(moves[i]!)) ? tokens[i]! : best;
    }),
    comments,
    intro,
    sidelines: analysis.slice(0, -1).flatMap((row, i) => {
      const m = row.best && uciToFFQBanqiMove(row.best);
      if (
        !m ||
        m.from === m.to ||
        states[i]!.board[m.to]?.faceDown ||
        !isFFQBanqiLegalMove(states[i]!, m) ||
        row.best === ffqBanqiMoveToUci(moves[i]!)
      )
        return [];
      // Show the review's safe alternative even when the loss is below a
      // move-grade threshold. Never extend it into an unobserved outcome.
      return [{ ply: i, moves: [row.best!], redScoreEnd: null, always: true }];
    }),
  });
  const publicTree = {
    version: 1,
    replay: FFQ_BANQI_PUBLIC_REPLAY,
    initialRevealed: track.initialRevealed,
    root: tree.root,
  };
  const create: StudyCreateSpec = {
    owner: 'mistboard',
    name: 'Fanfanqi: Level 7 versus Level 8, annotated',
    visibility: 'public',
    description:
      'A recorded Fanfanqi engine game. Level 7 review analysis, move grades and public-pool luck. Pieces still face down remain unknown. From mistboard.com/rules/fanfanqi.',
    chapter: {
      name: 'Misty Level 8 vs Misty Level 7',
      variant: 'ffq-banqi',
      orientation: 'red',
      tree: publicTree,
      tags: {
        red: 'Misty Level 8',
        black: 'Misty Level 7',
        result: '1-0',
        date: game.startedAt.slice(0, 10),
        event: 'Mistboard bot settings',
      },
      scoreSeries: { side: 'red', series: [{ name: 'Level 7 review', color: 'a', values: score }] },
    },
  };
  checkCreate(create);
  const luck = validateStudyDecisions('ffq-banqi', publicTree, {
    engineId: FFQ_BANQI_DECISIONS_ENGINE_ID,
    source: 'Site Level 7 public-pool review, top plus played candidate',
    decisions,
  });
  return {
    plan: {
      create,
      ops: [],
      evidence: { decidedAt: '2026-11-15', gameId: game.roomId, ...provenance },
    },
    notes: {
      intro,
      comments,
      evidence: {
        ...provenance,
        engineId: FFQ_BANQI_ANALYSIS_ENGINE_ID,
        nodes: 25_000,
        movetimeCapMs: 3000,
        analysis,
      },
    },
    luck,
  };
}

export async function buildFFQ(binary: string, scratch: string, analyseOnly = false) {
  mkdirSync(scratch, { recursive: true });
  const provenance = pinnedFFQEngine(binary);
  const track = replayFFQGame();
  const frames = track.states.map((s) => ({ fen: ffqBanqiStateToFen(s) }));
  const key = createHash('sha256')
    .update(
      JSON.stringify({
        frames,
        moves: track.moves,
        provenance,
        engine: FFQ_BANQI_ANALYSIS_ENGINE_ID,
        luck: FFQ_BANQI_DECISIONS_ENGINE_ID,
      }),
    )
    .digest('hex');
  const store = checkpoint<StudyEval>(resolve(scratch, `${key}.analysis.json`));
  const analysis = (await store.load())?.items ?? [];
  for (let ply = analysis.length; ply < frames.length; ply++) {
    const state = track.states[ply]!;
    const sign = state.status.type === 'playing' && state.status.turn === 'black' ? -1 : 1;
    const result =
      state.status.type === 'finished'
        ? { cp: state.status.winner === 'red' ? 30_000 : -30_000, mate: null, best: null }
        : await searchFFQPublicFen(frames[ply]!.fen);
    analysis.push({
      ply,
      cp: result.cp === null ? null : result.cp * sign,
      mate: result.mate === null ? null : result.mate * sign,
      best: result.best,
      pv: [],
    });
    await store.save({ nextIndex: ply + 1, items: analysis });
    console.log(`Level 7 position ${ply}/${track.moves.length}`);
  }
  const decisions = await analyzeFFQBanqiDecisions(
    { frames, moves: track.moves },
    undefined,
    checkpoint(resolve(scratch, `${key}.decisions.json`)),
  );
  writeFileSync(
    resolve(scratch, 'evidence.json'),
    JSON.stringify({ provenance, analysis, decisions }, null, 2),
  );
  if (analyseOnly) return;
  const comments = JSON.parse(
    readFileSync(new URL('plans/ffq-banqi.notes.json', import.meta.url), 'utf8'),
  ).comments;
  const output = makeFFQStudy(track, analysis, decisions, comments, provenance);
  for (const kind of ['plan', 'notes', 'luck'] as const)
    writeFileSync(
      new URL(`plans/ffq-banqi.${kind}.json`, import.meta.url),
      `${JSON.stringify(output[kind], null, 2)}\n`,
    );
  return output;
}
if (isMain(import.meta.url)) {
  const arg = (name: string) => {
    const i = process.argv.indexOf(name);
    if (i < 0 || !process.argv[i + 1]) throw new Error(`missing ${name}`);
    return resolve(process.argv[i + 1]!);
  };
  await buildFFQ(arg('--binary'), arg('--scratch'), process.argv.includes('--analyse-only'));
}
