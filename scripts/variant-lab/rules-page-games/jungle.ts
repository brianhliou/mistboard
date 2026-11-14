// The jungle rules page's sample game: game 0 of the 2026-09-21 match, KataGo-AnimalChess
// (Red) against MistyJungle 0.0.6 (Blue), the game the page already narrates (the
// sideways tiger jump on move 11, the rat taking the elephant on move 40, the den on
// move 47). Read by KataGo on this Mac and annotated by the pipeline.
//
//   npx tsx scripts/variant-lab/jungle-katago-evals.ts --games 0 --misty MISTY --out rows.jsonl
//   npx tsx scripts/variant-lab/rules-page-games/jungle.ts build --rows rows.jsonl
//   npx biome check --write scripts/variant-lab/rules-page-games/plans/jungle.plan.json
//
// KataGo is the 2026-09-21 match's net (b10c384nbt) at 1,000 visits a position; the
// rows are kept beside the plan (plans/jungle.rows.jsonl).
import { readFileSync } from 'node:fs';
import {
  applyJungleMove,
  createInitialJungleState,
  engineUciToJungleMove,
  type JungleGameState,
  jungleStateToEngineFen,
} from '@mistboard/game';
import { annotateFromEngine, type EngineSideline, judgedMoves } from '../../study-annotate.ts';
import { cli, noted, readNotes, report, writePlan } from './common.ts';

type EvalRow = {
  game: number;
  ply: number;
  played: string | null;
  kata: { winrateBlack: number; best: string; pv?: string[] } | null;
};

const { mode, arg } = cli();
if (mode !== 'build') throw new Error('mode: build');

const rows = readFileSync(arg('--rows'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l) as EvalRow)
  .filter((r) => r.game === 0)
  .sort((a, b) => a.ply - b.ply);
const study = JSON.parse(
  readFileSync(new URL('../../data/jungle-katago-study.json', import.meta.url), 'utf8'),
) as { games: { name: string; moves: string[]; rootFen: string }[] };
const game = study.games.find((g) => g.name.startsWith('Game 0:'));
if (!game) throw new Error('no game 0');
const moves = game.moves;

const states: JungleGameState[] = [createInitialJungleState('rules-jungle')];
for (const [i, u] of moves.entries()) {
  const next = applyJungleMove(states[i]!, engineUciToJungleMove(u)!);
  if (!next) throw new Error(`ply ${i + 1}: ${u} is illegal`);
  states.push(next);
}
const final = states.at(-1)!.status;
if (final.type !== 'finished' || final.winner !== 'red') throw new Error('game 0 is a Red win');
if (rows.length !== moves.length) throw new Error(`${rows.length} rows for ${moves.length} plies`);

/** KataGo's expected score for Red (a draw counts half); Red reached the den. */
const redScore = rows.map((r) => 1 - r.kata!.winrateBlack);
redScore.push(1);
const best = rows.map((r) => r.kata!.best);
const base = { rootFen: jungleStateToEngineFen(states[0]!), moves, redScore, best };
const marks = judgedMoves(base);

const sidelines: EngineSideline[] = [];
for (const m of marks) {
  const i = m.ply - 1;
  const pv = rows[i]!.kata!.pv ?? [];
  let s = states[i]!;
  const line: string[] = [];
  for (let k = 0; k + 1 < pv.length && line.length < 6; k += 2) {
    const u = `${pv[k]}${pv[k + 1]}`;
    const mv = engineUciToJungleMove(u);
    const next = mv && applyJungleMove(s, mv);
    if (!next) break;
    line.push(u);
    s = next;
  }
  // The line's verdict is KataGo's score for it: the position before the move.
  if (line.length) sidelines.push({ ply: i, moves: line, redScoreEnd: redScore[i]! });
}

const notes = readNotes('jungle');
const tree = annotateFromEngine({ ...base, sidelines, ...noted(notes, sidelines) });
writePlan('jungle', 'plan', {
  create: {
    owner: 'mistboard',
    name: 'Jungle: a sample game, annotated',
    description:
      'KataGo-AnimalChess against MistyJungle, game 0 of their 200-game match, read by KataGo. From the Jungle rules page at mistboard.com/rules/jungle.',
    visibility: 'public',
    chapter: {
      name: notes.title ?? 'KataGo-AnimalChess vs MistyJungle, read by KataGo',
      variant: 'jungle',
      orientation: 'red',
      tree,
      tags: {
        red: 'KataGo-AnimalChess',
        black: 'MistyJungle 0.0.6',
        result: '1-0',
        event: 'KataGo-AnimalChess vs MistyJungle, 200 games, 2026-09-21',
        date: '2026-09-21',
      },
      scoreSeries: {
        side: 'red',
        series: [{ name: 'KataGo', color: 'a', values: redScore }],
      },
    },
  },
  ops: [],
});
report(marks, sidelines);
