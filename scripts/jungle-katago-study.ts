// Build the companion study for the KataGo-AnimalChess vs MistyJungle match (#429).
//
//   npx tsx scripts/jungle-katago-study.ts --compile <match.jsonl>
//       reads the match records (one JSON line per game from
//       scripts/variant-lab/jungle-katago-match.ts), replays every game through
//       the kernel, picks the chapters, and writes scripts/data/jungle-katago-study.json.
//   npx tsx scripts/jungle-katago-study.ts                        # dry run over the data file
//   npx tsx scripts/jungle-katago-study.ts --create --public --cookie ~/.mistboard-cookie
//   npx tsx scripts/jungle-katago-study.ts --update <studyId> --cookie ~/.mistboard-cookie
//   npx tsx scripts/jungle-katago-study.ts --create --base http://localhost:3041 --dev-login you@example.com
//
// Same shape as banqi-study.ts: the data file is the study's source of truth, the
// cookie is read from a FILE and never printed.
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  applyJungleMove,
  createInitialJungleState,
  type JungleGameState,
  type JungleMove,
  type JungleSquare,
  jungleStateToEngineFen,
} from '@mistboard/game';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name: string): boolean => args.includes(`--${name}`);
const BASE = flag('base') ?? 'https://mistboard.com';
const DATA = resolve('scripts/data/jungle-katago-study.json');

type MatchGame = {
  game: number;
  red: 'katago' | 'misty';
  black: 'katago' | 'misty';
  moves: string[];
  plies: number;
  result: 'red' | 'black' | 'draw';
  reason: string;
  winner: 'katago' | 'misty' | null;
};

type StudyGame = {
  name: string;
  rootFen: string;
  moves: string[];
  intro: string;
  red: string;
  black: string;
  result: string;
  event: string;
  date: string;
  orientation: 'red' | 'black';
  game: number;
};

const NAME = { katago: 'KataGo-AnimalChess', misty: 'MistyJungle 0.0.6' } as const;
const EVENT = 'KataGo-AnimalChess vs MistyJungle, 200 games, 2026-09-21';

function parseMove(uci: string): JungleMove {
  return { from: uci.slice(0, 2) as JungleSquare, to: uci.slice(2, 4) as JungleSquare };
}

// Replay through the kernel: legality, the final status, and the plies on which a
// tiger crossed a lake sideways (the move Mistboard's old rule forbade).
function replay(game: MatchGame) {
  let state: JungleGameState = createInitialJungleState(`katago-${game.game}`);
  const rootFen = jungleStateToEngineFen(state);
  const sideways: { ply: number; uci: string; side: 'katago' | 'misty' }[] = [];
  let captures = 0;
  for (const [i, uci] of game.moves.entries()) {
    const mv = parseMove(uci);
    const piece = state.board[mv.from];
    if (!piece) throw new Error(`game ${game.game}: no piece on ${mv.from} at ply ${i}`);
    if (state.board[mv.to]) captures += 1;
    if (
      piece.role === 'tiger' &&
      mv.from[1] === mv.to[1] &&
      Math.abs(mv.from.charCodeAt(0) - mv.to.charCodeAt(0)) === 3
    ) {
      sideways.push({ ply: i + 1, uci, side: piece.color === 'red' ? game.red : game.black });
    }
    const next = applyJungleMove(state, mv);
    if (!next) throw new Error(`game ${game.game}: illegal ${uci} at ply ${i}`);
    state = next;
  }
  if (state.status.type !== 'finished') throw new Error(`game ${game.game}: not finished`);
  return { rootFen, sideways, captures, status: state.status };
}

const REASON: Record<string, string> = {
  'den-entered': 'den entry',
  repetition: 'threefold repetition',
  'no-progress': '200 plies without a capture',
  'pieces-captured': 'capture of every piece',
  stalemate: 'stalemate',
};

function describe(game: MatchGame, why: string): StudyGame {
  const r = replay(game);
  const kata = game.red === 'katago' ? 'red' : 'black';
  const ending =
    game.result === 'draw'
      ? `Drawn by ${REASON[game.reason] ?? game.reason} after ${game.plies} plies.`
      : `${NAME[game.winner!]} (${game.result}) wins by ${REASON[game.reason] ?? game.reason} on ply ${game.plies}.`;
  const jumps = r.sideways.length
    ? ` Sideways tiger jumps, the move the old rule forbade: ${r.sideways
        .map((j) => `${j.uci} (ply ${j.ply}, ${j.side === 'katago' ? 'KataGo' : 'Misty'})`)
        .join(', ')}.`
    : ' No sideways tiger jump in this game.';
  return {
    name: `Game ${game.game}: ${why}`,
    rootFen: r.rootFen,
    moves: game.moves,
    intro: `${why}. KataGo-AnimalChess plays ${kata}, MistyJungle ${kata === 'red' ? 'black' : 'red'}. ${ending} ${r.captures} captures.${jumps}`,
    red: NAME[game.red],
    black: NAME[game.black],
    result: game.result === 'draw' ? '1/2-1/2' : game.result === 'red' ? '1-0' : '0-1',
    event: EVENT,
    date: '2026-09-21',
    orientation: 'red',
    game: game.game,
  };
}

function compile(file: string): void {
  const games = readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as MatchGame)
    .filter((g) => g.result);
  const wins = games.filter((g) => g.winner === 'katago');
  const draws = games.filter((g) => g.winner === null);
  const byPlies = (a: MatchGame, b: MatchGame) => a.plies - b.plies;
  const pick: [MatchGame, string][] = [];
  const used = new Set<number>();
  const take = (g: MatchGame | undefined, why: string) => {
    if (g && !used.has(g.game)) {
      used.add(g.game);
      pick.push([g, why]);
    }
  };
  const withKataSideways = (g: MatchGame) => replay(g).sideways.some((j) => j.side === 'katago');
  take(
    games.find((g) => g.game === 67),
    "the tiger's sideways jump, then the den",
  );
  take([...wins].filter((g) => g.red === 'katago').sort(byPlies)[0], 'the shortest win as red');
  take([...wins].filter((g) => g.red === 'misty').sort(byPlies)[0], 'the shortest win as black');
  take(
    [...wins].filter((g) => g.red === 'katago' && withKataSideways(g)).sort(byPlies)[0],
    'a sideways jump as red',
  );
  take([...wins].sort(byPlies).at(-1), 'the longest win');
  take([...draws].sort(byPlies)[0], 'the shortest draw');
  take([...draws].sort(byPlies).at(-1), 'the longest draw, a repetition grind');
  take(
    [...wins].filter((g) => g.red === 'misty').sort(byPlies)[1],
    'the second-shortest win as black',
  );
  // The eight named games lead; every other game follows, decisive first and
  // shortest first within each, so the whole match is on record.
  const rest = games
    .filter((g) => !used.has(g.game))
    .sort((a, b) => Number(a.winner === null) - Number(b.winner === null) || byPlies(a, b));
  for (const g of rest) {
    const who =
      g.winner === null ? 'draw' : `KataGo wins as ${g.red === 'katago' ? 'red' : 'black'}`;
    pick.push([g, `${who}, ${g.plies} plies`]);
  }
  const data = {
    name: 'KataGo-AnimalChess vs MistyJungle',
    description:
      "All 200 games in which KataGo-AnimalChess (hzyhhzy, Kouza), a self-play net for Dou Shou Qi, beat MistyJungle 82-0 with 118 draws at matched time per move, right after Mistboard gave the tiger the lion's sideways river jump. Eight named games first, then the rest, decisive games before draws. The harness and the records are linked from the post on brianhliou.com.",
    games: pick.map(([g, why]) => describe(g, why)),
  };
  writeFileSync(DATA, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`${data.games.length} chapters -> ${DATA}`);
}

function buildTree(game: StudyGame) {
  const root: { annotations: object; children: unknown[] } = { annotations: {}, children: [] };
  if (game.intro) root.annotations = { comments: [{ text: game.intro }] };
  let cursor = root;
  for (const uci of game.moves) {
    const node = { uci, children: [] as unknown[] };
    cursor.children.push(node);
    cursor = node as typeof root;
  }
  return { version: 1, rootFen: game.rootFen, root };
}

function chapterFor(game: StudyGame) {
  return {
    name: game.name,
    variant: 'jungle',
    orientation: game.orientation,
    root: buildTree(game),
    tags: {
      red: game.red,
      black: game.black,
      result: game.result,
      event: game.event,
      date: game.date,
    },
  };
}

async function send(method: string, path: string, body?: unknown, cookie?: string) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 160)}`);
  return { json: text ? JSON.parse(text) : null, headers: res.headers };
}

async function devLogin(email: string): Promise<string> {
  const start = await send('POST', '/api/auth/email/start', { email });
  const { loginId, devCode } = start.json;
  if (!devCode) throw new Error('no devCode in the start response: not a dev server');
  const confirm = await send('POST', '/api/auth/email/confirm', { loginId, code: devCode });
  const setCookie = confirm.headers.get('set-cookie') ?? '';
  const cookie = setCookie
    .split(/,(?=[^;]+=)/)
    .map((c) => c.split(';')[0]!.trim())
    .filter(Boolean)
    .join('; ');
  if (!cookie) throw new Error('dev login returned no session cookie');
  return cookie;
}

async function main(): Promise<void> {
  const compileFile = flag('compile');
  if (compileFile) {
    compile(compileFile);
    return;
  }
  const data = JSON.parse(readFileSync(DATA, 'utf8')) as {
    name: string;
    description: string;
    games: StudyGame[];
  };
  for (const game of data.games) {
    replay({
      game: game.game,
      red: 'katago',
      black: 'misty',
      moves: game.moves,
      plies: game.moves.length,
      result: 'draw',
      reason: '',
      winner: null,
    });
    console.log(
      `${game.name.padEnd(52)} ${String(game.moves.length).padStart(3)} plies, ${game.result}`,
    );
  }
  if (!has('create') && !has('update')) return;
  const devEmail = flag('dev-login');
  const cookieFile = flag('cookie') ?? join(homedir(), '.mistboard-cookie');
  const cookie = devEmail ? await devLogin(devEmail) : readFileSync(cookieFile, 'utf8').trim();
  const update = flag('update');
  if (update) {
    const current = (await send('GET', `/api/studies/${update}`)).json;
    const existing = new Map<string, { id: string }>();
    for (const ch of current.chapters ?? current.study?.chapters ?? []) existing.set(ch.name, ch);
    for (const game of data.games) {
      const payload = chapterFor(game);
      const ch = existing.get(game.name);
      if (!ch) {
        await send('POST', `/api/studies/${update}/chapters`, payload, cookie);
        console.log(`  + ${game.name}`);
      } else {
        await send('PATCH', `/api/studies/${update}/chapters/${ch.id}`, payload, cookie);
        console.log(`  ~ ${game.name}`);
      }
    }
    await send(
      'PATCH',
      `/api/studies/${update}`,
      { name: data.name, description: data.description },
      cookie,
    );
    console.log(`${BASE}/study/${update}`);
    return;
  }
  const [first, ...rest] = data.games;
  const created = (
    await send(
      'POST',
      '/api/studies',
      {
        name: data.name,
        description: data.description,
        visibility: has('public') ? 'public' : 'unlisted',
        chapter: chapterFor(first!),
      },
      cookie,
    )
  ).json;
  const studyId = created.study?.id ?? created.id;
  console.log(`\ncreated study ${studyId}`);
  for (const game of rest) {
    await send('POST', `/api/studies/${studyId}/chapters`, chapterFor(game), cookie);
    console.log(`  + ${game.name}`);
  }
  console.log(`\n${BASE}/study/${studyId}`);
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
