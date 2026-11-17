// The Flip Jungle rules page's sample game: game 6 of the MistyJungleFlip self-play run
// (seed 302, 7.5M nodes a move), the one the page narrates (the cats trade on move 10,
// a red rat takes Blue's elephant on move 24, the lions trade on move 28 and Blue has no
// move). Read again by MistyJungleFlip 0.6.0 on the r6 net with its 4-piece tablebase,
// at the game's own 7.5M nodes, through the site's engine wrapper; flips are graded on
// the site's pool mean (apps/server/src/jungle-flip-analysis.ts), not on the tile.
//
//   ENV="MISTBOARD_JUNGLE_FLIP_ENGINE_PATH=… MISTBOARD_JUNGLE_FLIP_NET=… JUNGLE_FLIP_TB=…"
//   env $ENV npx tsx scripts/variant-lab/rules-page-games/jungle-flip.ts sweep
//   env $ENV npx tsx scripts/variant-lab/rules-page-games/jungle-flip.ts decisions
//   env $ENV npx tsx scripts/variant-lab/rules-page-games/jungle-flip.ts confirm
//   npx tsx scripts/variant-lab/rules-page-games/jungle-flip.ts build
//   npx biome check --write scripts/variant-lab/rules-page-games/plans/jungle-flip.*.json
//
// The engine reads only the redacted FEN, so no evaluation sees a face-down tile.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ALL_JUNGLE_FLIP_SQUARES,
  applyJungleFlipMove,
  createInitialJungleFlipState,
  engineUciToJungleFlipMove,
  getJungleFlipLegalMoves,
  type JungleFlipDeal,
  type JungleFlipGameState,
  type JungleFlipMove,
  jungleFlipRepSeedFens,
  jungleFlipStateToEngineFen,
  parseJungleFlipFen,
  winPercent,
} from '@mistboard/game';
import {
  analyzeJungleFlipDecisions,
  JUNGLE_FLIP_ANALYSIS_ENGINE_ID,
  JUNGLE_FLIP_DECISIONS_ENGINE_ID,
  type JungleFlipDecision,
} from '../../../apps/server/src/jungle-flip-analysis.ts';
import { evaluateJungleFlipFenNodes } from '../../../apps/server/src/jungle-flip-engine.ts';
import {
  annotateFromEngine,
  type EngineAnnotationInput,
  type EngineSideline,
  judgedMoves,
  moveGlyphFor,
} from '../../study-annotate.ts';
import { cli, noted, PLANS, readNotes, report, writePlan } from './common.ts';

const GAME = 6;
const NODES = 7_500_000;
const { mode } = cli();

const study = JSON.parse(
  readFileSync(new URL('../../data/jungle-flip-study.json', import.meta.url), 'utf8'),
) as {
  games: { name: string; rootFen: string; moves: string[]; red: string; black: string }[];
};
const game = study.games[GAME - 1]!;
const parsed = parseJungleFlipFen(game.rootFen, { gameId: 'rules-jungle-flip' } as never);
if (!parsed.ok || parsed.sampled) throw new Error('game 6 needs its dealt root FEN');
const deal: JungleFlipDeal = ALL_JUNGLE_FLIP_SQUARES.map((sq) => {
  const p = parsed.state.board[sq]!;
  return { color: p.color, role: p.role };
});
const moves: JungleFlipMove[] = game.moves.map((t) => ({
  from: t.slice(0, 2) as JungleFlipMove['from'],
  to: t.slice(2, 4) as JungleFlipMove['to'],
}));
const states: JungleFlipGameState[] = [createInitialJungleFlipState('rules-jungle-flip', deal)];
for (const [i, m] of moves.entries()) {
  const next = applyJungleFlipMove(states[i]!, m);
  if (next === states[i]) throw new Error(`ply ${i + 1}: ${game.moves[i]} refused`);
  states.push(next);
}
const final = states.at(-1)!.status;
if (final.type !== 'finished' || final.winner !== 'red')
  throw new Error('game 6 is a first-seat win');

type SweepRow = {
  ply: number;
  cp: number | null;
  mate: number | null;
  best: string | null;
  pv: string[];
};
const SWEEP = resolve(PLANS, 'jungle-flip.sweep.json');
const DECISIONS = resolve(PLANS, 'jungle-flip.decisions.json');
const legal = (s: JungleFlipGameState, m: JungleFlipMove) =>
  getJungleFlipLegalMoves(s).some((x) => x.from === m.from && x.to === m.to);

export type JungleFlipConfirmation = {
  ply: number;
  /** Mover-POV expected scores from a fresh, longer search; never draw luck. */
  before: number;
  after: number;
  best: string | null;
};

/** Every proposed glyph needs a second search. Disagreement wider than the
 * narrowest five-point grading band, or a changed grade, suppresses the mark. */
export function jungleFlipGrading(input: {
  rootFen: string;
  moves: readonly string[];
  redScore: readonly number[];
  best: readonly (string | null)[];
  decisions: readonly JungleFlipDecision[];
  confirmations?: readonly JungleFlipConfirmation[];
  requireConfirmation?: boolean;
}): EngineAnnotationInput {
  const { rootFen, moves, redScore } = input;
  const best = [...input.best];
  const moveScore = redScore.slice(1);
  const scoreByMover = { red: [...redScore], black: [...redScore] };
  for (const decision of input.decisions) {
    const i = decision.ply - 1;
    const redOf = (win: number) => (decision.mover === 'red' ? win / 100 : 1 - win / 100);
    scoreByMover[decision.mover][i] = redOf(decision.bestWin);
    moveScore[i] = redOf(decision.playedWin);
    const preferred = decision.candidates?.[0]?.move;
    const move = preferred ? engineUciToJungleFlipMove(preferred) : null;
    if (!move) throw new Error(`flip ${decision.ply} needs its preferred pool-mean move`);
    best[i] = `${move.from}${move.to}`;
  }
  const base = { rootFen, moves, redScore, best, moveScore, scoreByMover };
  if (input.requireConfirmation === false) return base;
  for (const mark of judgedMoves(base)) {
    const confirmation = input.confirmations?.find((row) => row.ply === mark.ply);
    if (!confirmation)
      throw new Error(`confirm required for ply ${mark.ply}; run confirm before build`);
    if (
      ![confirmation.before, confirmation.after].every(
        (value) => Number.isFinite(value) && value >= 0 && value <= 1,
      )
    )
      throw new Error(`invalid confirmation at ply ${mark.ply}`);
    const i = mark.ply - 1;
    const stable =
      moveGlyphFor(confirmation.before, confirmation.after) === mark.glyph &&
      Math.abs(mark.before - mark.after - (confirmation.before - confirmation.after)) <= 0.05;
    const redOf = (value: number) => (mark.mover === 'red' ? value : 1 - value);
    scoreByMover[mark.mover][i] = redOf(confirmation.before);
    moveScore[i] = redOf(stable ? confirmation.after : confirmation.before);
    best[i] = confirmation.best;
  }
  return base;
}

function readAnalysis() {
  const sweep = JSON.parse(readFileSync(SWEEP, 'utf8')) as { rows: SweepRow[] };
  const dec = JSON.parse(readFileSync(DECISIONS, 'utf8')) as { items: JungleFlipDecision[] };
  const flips = moves.filter((m) => m.from === m.to).length;
  if (dec.items.length !== flips) throw new Error(`${dec.items.length} of ${flips} flips graded`);
  if (sweep.rows.length !== states.length) throw new Error('incomplete position sweep');
  const redScore = sweep.rows.map((r, ply) => {
    const s = states[ply]!;
    if (s.status.type === 'finished')
      return s.status.winner === 'red' ? 1 : s.status.winner ? 0 : 0.5;
    return winPercent(r.cp, r.mate, JUNGLE_FLIP_ANALYSIS_ENGINE_ID) / 100;
  });
  const best = sweep.rows.slice(0, moves.length).map((row) => {
    const move = row.best ? engineUciToJungleFlipMove(row.best) : null;
    return move ? `${move.from}${move.to}` : null;
  });
  const key = createHash('sha256')
    .update(
      JSON.stringify({ rootFen: game.rootFen, moves: game.moves, sweep, dec, nodes: NODES * 3 }),
    )
    .digest('hex');
  return { sweep, dec, redScore, best, key };
}
const CONFIRMATIONS = resolve(PLANS, 'jungle-flip.confirmations.json');

async function main() {
  if (mode === 'sweep') {
    const rows: SweepRow[] = [];
    for (const [ply, s] of states.entries()) {
      if (s.status.type !== 'playing') {
        rows.push({ ply, cp: null, mate: null, best: null, pv: [] });
        continue;
      }
      // Side-to-move POV in, red-seat POV out.
      const sign = s.status.turn === 'red' ? 1 : -1;
      const e = await evaluateJungleFlipFenNodes(jungleFlipStateToEngineFen(s), {
        nodes: NODES,
        movetimeCapMs: 120_000,
        repSeedFens: jungleFlipRepSeedFens(states.slice(0, ply + 1)),
      });
      rows.push({
        ply,
        cp: e.cp == null ? null : e.cp * sign,
        mate: e.mate == null ? null : e.mate * sign,
        best: e.best,
        pv: (e as { pv?: string[] }).pv ?? [],
      });
      console.log(ply, e.cp, e.mate, e.best);
    }
    writeFileSync(SWEEP, `${JSON.stringify({ game: GAME, nodes: NODES, rows })}\n`);
    process.exit(0);
  } else if (mode === 'decisions') {
    const items = await analyzeJungleFlipDecisions(moves, deal, undefined, {
      load: async () =>
        existsSync(DECISIONS) ? JSON.parse(readFileSync(DECISIONS, 'utf8')) : null,
      save: async (progress) => {
        writeFileSync(DECISIONS, `${JSON.stringify({ game: GAME, ...progress })}\n`);
        console.log(`flip ${progress.items.at(-1)?.ply}`);
      },
    });
    console.log(`DONE ${items.length} flips`);
    process.exit(0);
  } else if (mode === 'confirm') {
    const { dec, redScore, best, key } = readAnalysis();
    const marks = judgedMoves(
      jungleFlipGrading({
        rootFen: game.rootFen,
        moves: game.moves,
        redScore,
        best,
        decisions: dec.items,
        requireConfirmation: false,
      }),
    );
    const confirmations: JungleFlipConfirmation[] = [];
    const evaluate = (fen: string, repSeedFens?: readonly string[]) =>
      evaluateJungleFlipFenNodes(fen, { nodes: NODES * 3, movetimeCapMs: 120_000, repSeedFens });
    for (const mark of marks) {
      const i = mark.ply - 1;
      if (moves[i]!.from === moves[i]!.to) {
        // Replay the prefix without re-evaluating earlier flips. The analyzer
        // searches every public pool outcome, never just the recorded tile.
        const [decision] = await analyzeJungleFlipDecisions(
          moves.slice(0, i + 1),
          deal,
          { evalPosition: evaluate },
          {
            load: async () => ({ nextIndex: i, items: [] }),
            save: async () => {},
          },
        );
        const preferred = engineUciToJungleFlipMove(decision!.candidates![0]!.move)!;
        confirmations.push({
          ply: mark.ply,
          before: decision!.bestWin / 100,
          after: decision!.playedWin / 100,
          best: `${preferred.from}${preferred.to}`,
        });
      } else {
        const search = async (ply: number) => {
          const state = states[ply]!;
          if (state.status.type === 'finished')
            return {
              win: state.status.winner === mark.mover ? 1 : state.status.winner ? 0 : 0.5,
              best: null,
            };
          const result = await evaluate(
            jungleFlipStateToEngineFen(state),
            jungleFlipRepSeedFens(states.slice(0, ply + 1)),
          );
          const win = winPercent(result.cp, result.mate, JUNGLE_FLIP_ANALYSIS_ENGINE_ID) / 100;
          const move = result.best ? engineUciToJungleFlipMove(result.best) : null;
          return {
            win: state.status.turn === mark.mover ? win : 1 - win,
            best: move ? `${move.from}${move.to}` : null,
          };
        };
        const before = await search(i);
        const after = await search(i + 1);
        confirmations.push({
          ply: mark.ply,
          before: before.win,
          after: after.win,
          best: before.best,
        });
      }
    }
    if (confirmations.length)
      writeFileSync(CONFIRMATIONS, `${JSON.stringify({ key, rows: confirmations }, null, 2)}\n`);
    console.log(`${marks.length} proposed marks searched again at ${NODES * 3} nodes`);
  } else if (mode === 'build') {
    const { sweep, dec, redScore, best, key } = readAnalysis();
    const saved = existsSync(CONFIRMATIONS)
      ? (JSON.parse(readFileSync(CONFIRMATIONS, 'utf8')) as {
          key: string;
          rows: JungleFlipConfirmation[];
        })
      : null;
    if (saved && saved.key !== key) throw new Error('stale confirmations; run confirm again');
    const confirmations = saved?.rows ?? [];
    const base = jungleFlipGrading({
      rootFen: game.rootFen,
      moves: game.moves,
      redScore,
      best,
      decisions: dec.items,
      confirmations,
    });
    const marks = judgedMoves(base);
    const sidelines: EngineSideline[] = [];
    for (const m of marks) {
      const i = m.ply - 1;
      let s = states[i]!;
      const line: string[] = [];
      for (const u of sweep.rows[i]!.pv) {
        const mv = engineUciToJungleFlipMove(u);
        // Stop before a flip: no line turns over a tile the game did not.
        if (!mv || mv.from === mv.to || !legal(s, mv)) break;
        line.push(`${mv.from}${mv.to}`);
        s = applyJungleFlipMove(s, mv);
        if (s.status.type !== 'playing' || line.length === 6) break;
      }
      if (line.length) sidelines.push({ ply: i, moves: line, redScoreEnd: redScore[i]! });
    }
    const notes = readNotes('jungle-flip');
    const tree = annotateFromEngine({ ...base, sidelines, ...noted(notes, sidelines) });
    writePlan('jungle-flip', 'plan', {
      create: {
        owner: 'mistboard',
        name: 'Flip Jungle: a sample game, annotated',
        description:
          'MistyJungleFlip against itself at 7.5 million nodes a move, read again by MistyJungleFlip. From the Flip Jungle rules page at mistboard.com/rules/jungle-flip.',
        visibility: 'public',
        chapter: {
          name: notes.title ?? 'MistyJungleFlip against itself',
          variant: 'jungle-flip',
          orientation: 'red',
          tree,
          tags: {
            red: game.red,
            black: game.black,
            result: '1-0',
            event: 'Flip Jungle, engine self-play',
            date: '2026-09-25',
          },
          scoreSeries: {
            side: 'red',
            series: [{ name: 'MistyJungleFlip', color: 'a', values: redScore }],
          },
        },
      },
      ops: [],
    });
    writePlan('jungle-flip', 'luck', {
      engineId: 'jungle-flip-engine',
      source: `offline pool sweep (${JUNGLE_FLIP_DECISIONS_ENGINE_ID})`,
      decisions: dec.items,
    });
    report(marks, sidelines);
  } else {
    throw new Error('mode: sweep | decisions | confirm | build');
  }
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
