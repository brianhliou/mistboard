// Reduce the raw evaluation runs (jungle-katago-evals.ts, and the game-67 run
// from docs-private/videos/jungle-katago-01/eval-g67.ts) to the compact data the
// KataGo post reads: apps/web/src/articles/content/katago-jungle-evals.json.
//
//   npx tsx scripts/variant-lab/jungle-katago-evals-reduce.ts \
//     --g67 <raw-g67.jsonl> --game <g94.jsonl> [--game …] \
//     --variations <variations.json> --line67 56:b1b2 [--line67 …] \
//     --lines <lines-g94.jsonl>
//
// Also writes content/katago-jungle-lines.json, KataGo's lines for the study
// sidelines and the post's line boards: game 67's from the September video
// work (docs-private/videos/jungle-katago-01/variations.json, every ply searched
// fresh at 10,000 visits), picked by `<plies before>:<first move>`, and the
// rest from jungle-katago-lines.ts runs (1,000 visits a ply).
//
// Scores are turned to black's point of view here: KataGo's winrate already is
// black's (the analysis config reports winrates as KataGo's WHITE = our black);
// Misty's centipawns are for the side to move and are flipped when red moves.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  EvalsData,
  EvaluatedGame,
  MatchResult,
} from '../../apps/web/src/articles/katago-jungle-analysis.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOME = process.env.HOME ?? '';
const argv = process.argv.slice(2);
const all = (k: string): string[] => argv.flatMap((a, i) => (a === k ? [argv[i + 1]!] : []));
const one = (k: string, d: string): string => all(k)[0] ?? d;

const GAMES_FILE = resolve(
  one(
    '--games-file',
    `${HOME}/projects/brianhliou.com/assets/jungle-games/katago-vs-misty-2026-09-21.jsonl`,
  ),
);
const OUT = resolve(
  one('--out', resolve(HERE, '../../apps/web/src/articles/content/katago-jungle-evals.json')),
);

type Rec = {
  game: number;
  red: 'katago' | 'misty';
  moves: string[];
  plies: number;
  result: MatchResult;
};
const records = new Map<number, Rec>(
  readFileSync(GAMES_FILE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Rec)
    .map((r) => [r.game, r]),
);

const lines = (file: string): Array<Record<string, any>> =>
  readFileSync(resolve(file), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));

const round3 = (x: number): number => Math.round(x * 1000) / 1000;
const blackCp = (cpStm: number | null, ply: number): number | null =>
  cpStm == null ? null : ply % 2 === 0 ? -cpStm : cpStm;

function evaluated(
  gameNo: number,
  rows: Array<Record<string, any>>,
  format: 'g67' | 'evals',
): EvaluatedGame {
  const rec = records.get(gameNo);
  if (!rec) throw new Error(`no record for game ${gameNo}`);
  const byPly = new Map<number, Record<string, any>>(rows.map((r) => [r.ply as number, r]));
  const kata: number[] = [];
  const kataBest: string[] = [];
  const misty: Array<number | null> = [];
  for (let ply = 0; ply < rec.plies; ply += 1) {
    const r = byPly.get(ply);
    if (!r) throw new Error(`game ${gameNo}: no evaluation at ply ${ply}`);
    if (format === 'g67') {
      const top = [...r.kata.stage1].sort((a: any, b: any) => b.visits - a.visits)[0];
      kata.push(round3(top.winrateBlack));
      kataBest.push(`${top.pv[0]}${top.pv[1]}`);
      misty.push(blackCp(r.misty.scoreStm, ply));
    } else {
      kata.push(round3(r.kata.winrateBlack));
      kataBest.push(r.kata.best);
      misty.push(blackCp(r.misty.cpStm, ply));
    }
  }
  return {
    game: gameNo,
    red: rec.red,
    result: rec.result,
    plies: rec.plies,
    moves: rec.moves,
    kata,
    kataBest,
    misty,
  };
}

const games: EvaluatedGame[] = [];
const g67 = all('--g67')[0];
if (g67) games.push(evaluated(67, lines(g67), 'g67'));
for (const file of all('--game')) {
  const rows = lines(file);
  games.push(evaluated(rows[0]!.game as number, rows, 'evals'));
}

const data: EvalsData = { games };
writeFileSync(OUT, `${JSON.stringify(data)}\n`);
console.log(`wrote ${OUT}: ${games.length} games`);

const lines67 = all('--line67');
const variationsFile = all('--variations')[0];
const sidelines: KatagoLine[] = [];
if (variationsFile && lines67.length > 0) {
  const v = JSON.parse(readFileSync(resolve(variationsFile), 'utf8')) as {
    moments: Array<{
      ply: number;
      alts: Array<{
        uci: string;
        line: string[];
        start?: { kata?: { winrateBlack: number } | null } | null;
        end?: { kata?: { winrateBlack: number } | null } | null;
      }>;
    }>;
  };
  for (const pick of lines67) {
    const [plyText, first] = pick.split(':');
    const moment = v.moments.find((m) => m.ply === Number(plyText));
    const alt = moment?.alts.find((a) => a.uci === first);
    if (!alt) throw new Error(`variations: no ${pick}`);
    sidelines.push({
      game: 67,
      ply: Number(plyText),
      line: alt.line,
      visits: 10000,
      kataBlackStart: alt.start?.kata?.winrateBlack ?? null,
      kataBlackEnd: alt.end?.kata?.winrateBlack ?? null,
    });
  }
}
for (const file of all('--lines')) {
  for (const r of lines(file)) {
    sidelines.push({
      game: r.game,
      ply: r.ply,
      line: r.line,
      visits: 1000,
      // After the line's first move, as variations.json's `start` is.
      kataBlackStart: r.kataBlackBefore[1] ?? null,
      kataBlackEnd: r.kataBlackEnd,
    });
  }
}
if (sidelines.length > 0) {
  const linesOut = resolve(dirname(OUT), 'katago-jungle-lines.json');
  writeFileSync(linesOut, `${JSON.stringify(sidelines)}\n`);
  console.log(`wrote ${linesOut}: ${sidelines.length} lines`);
}
