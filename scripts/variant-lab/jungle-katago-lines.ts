// KataGo's line from a position in a 2026-09-21 match game, for the KataGo
// post's study sidelines: an optional first move, then KataGo's own choice for
// BOTH sides, every position searched fresh (two-stage genmove at the config's
// visits), until the game ends or --plies moves are played. Each ply records
// KataGo's expected score for black before the move. The kernel checks every
// move.
//
//   npx tsx scripts/variant-lab/jungle-katago-lines.ts --game 94 --ply 99 \
//     [--first d6d7] [--plies 12] --out lines-g94.jsonl
//
// `--ply` is the number of plies played before the line starts (the position
// the side to move faces). Appends one JSON line to --out.

import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyJungleMove,
  createInitialJungleState,
  engineUciToJungleMove,
  type JungleGameState,
  jungleStateToEngineFen,
} from '@mistboard/game';
import { Kata } from './jungle-katago-bridge.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOME = process.env.HOME ?? '';
const argv = process.argv.slice(2);
const arg = (k: string, d: string): string => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1]! : d;
};
const GAMES_FILE = resolve(
  arg(
    '--games-file',
    `${HOME}/projects/brianhliou.com/assets/jungle-games/katago-vs-misty-2026-09-21.jsonl`,
  ),
);
const GAME = Number(arg('--game', '94'));
const PLY = Number(arg('--ply', '0'));
const FIRST = arg('--first', '');
const PLIES = Number(arg('--plies', '12'));
const OUT = resolve(arg('--out', 'jungle-katago-lines.jsonl'));

async function main(): Promise<void> {
  const rec = readFileSync(GAMES_FILE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { game: number; moves: string[] })
    .find((r) => r.game === GAME);
  if (!rec) throw new Error(`no game ${GAME}`);
  let state: JungleGameState = createInitialJungleState(`lines-${GAME}`);
  for (const uci of rec.moves.slice(0, PLY))
    state = applyJungleMove(state, engineUciToJungleMove(uci)!)!;
  const startFen = jungleStateToEngineFen(state);

  const kata = new Kata(
    arg('--katago', `${HOME}/projects/tools/KataGomo-animalchess/cpp/build/katago`),
    arg(
      '--model',
      `${HOME}/projects/mistboard-engine/lab/jungle-katago-2026-09-21/b10c384nbt.bin.gz`,
    ),
    arg('--config', resolve(HERE, 'jungle-katago-analysis.cfg')),
  );
  const line: string[] = [];
  const kataBlack: number[] = [];
  while (line.length < PLIES && state.status.type === 'playing') {
    const t = Date.now();
    const { move, infos } = await kata.genmove(jungleStateToEngineFen(state));
    kataBlack.push(infos[0]?.winrateBlack ?? Number.NaN);
    const uci = line.length === 0 && FIRST ? FIRST : move;
    const next = applyJungleMove(state, engineUciToJungleMove(uci)!);
    if (!next) throw new Error(`illegal ${uci} after ${line.join(' ')}`);
    line.push(uci);
    state = next;
    console.log(
      `${line.length}: ${uci} (kata ${move}) black ${kataBlack.at(-1)?.toFixed(3)} ${(Date.now() - t) / 1000}s`,
    );
  }
  const end =
    state.status.type === 'playing'
      ? (await kata.genmove(jungleStateToEngineFen(state))).infos[0]
      : null;
  const row = {
    game: GAME,
    ply: PLY,
    startFen,
    line,
    kataBlackBefore: kataBlack,
    kataBlackEnd: end ? end.winrateBlack : null,
    status: state.status,
  };
  appendFileSync(OUT, `${JSON.stringify(row)}\n`);
  kata.p.quit('quit');
  console.log(JSON.stringify({ line, end: row.kataBlackEnd, status: state.status.type }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
