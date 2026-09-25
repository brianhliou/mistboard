// Build the Flip Jungle companion study from MistyJungleFlip self-play.
// Same shape as scripts/banqi-study.ts, on the jungle-flip kernel.
//
//   modal run scripts/modal/misty_selfplay.py::batch --variant jungle-flip \
//       --nodes 7500000 --seed 300 --games 20 --out tmp/jungle-flip-study
//   npx tsx scripts/jungle-flip-study.ts --compile tmp/jungle-flip-study/game-*.json
//       reads the self-play output, replays every game through the kernel,
//       and writes scripts/data/jungle-flip-study.json: one chapter per game with a
//       dealt root FEN (so the chapter opens into ITS deal, not a fresh one),
//       the moves, and a note the replay can state without an eval: length,
//       captures, who bound which ink, what ended it, and where the material
//       balance last changed hands. Games are ordered decisive first.
//   npx tsx scripts/jungle-flip-study.ts                       # dry run over the data file
//   npx tsx scripts/jungle-flip-study.ts --create --public --cookie ~/.mistboard-cookie
//   npx tsx scripts/jungle-flip-study.ts --update <studyId> --cookie ~/.mistboard-cookie
//   npx tsx scripts/jungle-flip-study.ts --create --base http://localhost:3041 --dev-login you@example.com
//
// The cookie is read from a FILE and used as a header; it is never printed.
// The data file is the study's source of truth, like the atomic one.
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  applyJungleFlipMove,
  createInitialJungleFlipState,
  type JungleFlipDeal,
  type JungleFlipGameState,
  type JungleFlipMove,
  type JungleFlipPieceRole,
  type JungleFlipSquare,
  jungleFlipStateToDealtFen,
} from '@mistboard/game';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name: string): boolean => args.includes(`--${name}`);
const BASE = flag('base') ?? 'https://mistboard.com';
const DATA = resolve('scripts/data/jungle-flip-study.json');

type SelfPlayGame = {
  nodes: number;
  seed: number;
  moves: string;
  plies: number;
  status: { type: string; winner?: 'red' | 'black' | null; reason?: string };
  deal: JungleFlipDeal;
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
  seed: number;
  nodes: number;
};

// Material by rank, elephant 8 down to rat 1: a rough balance for the note,
// not an evaluation (the rat's elephant capture makes no ladder exact).
const ROLE_VALUE: Record<JungleFlipPieceRole, number> = {
  elephant: 8,
  lion: 7,
  tiger: 6,
  leopard: 5,
  wolf: 4,
  dog: 3,
  cat: 2,
  rat: 1,
};

// The kernel's second ink is 'black'; the board and the rules page draw it blue.
const inkName = (ink: 'red' | 'black'): string => (ink === 'red' ? 'red' : 'blue');

function parseMove(token: string): JungleFlipMove {
  return {
    from: token.slice(0, 2) as JungleFlipSquare,
    to: token.slice(2, 4) as JungleFlipSquare,
  };
}

/** Replay a game and describe it from what the kernel reports. */
function describe(game: SelfPlayGame, index: number): StudyGame {
  const start = createInitialJungleFlipState(`study-${game.seed}`, game.deal);
  let state: JungleFlipGameState = start;
  const tokens = game.moves.trim().split(/\s+/);
  let captures = 0;
  let flips = 0;
  let firstCaptureMove = 0;
  // Material by ink, from the captures list: who took what.
  const taken: Record<'red' | 'black', number> = { red: 0, black: 0 };
  let lastSwing = 0;
  let leader: 'red' | 'black' | null = null;
  let biggest: { ply: number; text: string } | null = null;
  for (const [i, token] of tokens.entries()) {
    const move = parseMove(token);
    const before = state.captures.length;
    const next = applyJungleFlipMove(state, move);
    if (next === state)
      throw new Error(`seed ${game.seed}: ply ${i + 1} ${token} refused by the kernel`);
    state = next;
    if (move.from === move.to) flips += 1;
    if (state.captures.length > before) {
      captures += 1;
      if (!firstCaptureMove) firstCaptureMove = Math.floor(i / 2) + 1;
      const fresh = state.captures.slice(before);
      for (const c of fresh) taken[c.owner === 'red' ? 'black' : 'red'] += ROLE_VALUE[c.role];
      const cap = fresh[fresh.length - 1]!;
      const diff = taken.red - taken.black;
      const nowLeads = diff > 0 ? 'red' : diff < 0 ? 'black' : null;
      if (nowLeads !== leader && nowLeads !== null) {
        lastSwing = Math.floor(i / 2) + 1;
        leader = nowLeads;
      }
      const value = ROLE_VALUE[cap.role];
      if (
        !biggest ||
        value > ROLE_VALUE[(biggest as { role?: JungleFlipPieceRole }).role ?? 'rat']
      ) {
        biggest = {
          ply: i + 1,
          text: `${fresh.length > 1 ? 'the two' : inkName(cap.owner)} ${cap.role}${fresh.length > 1 ? 's traded' : ' taken'} at move ${Math.floor(i / 2) + 1}`,
          ...({ role: cap.role } as object),
        };
      }
    }
  }
  const status = state.status;
  const winnerSeat = status.type === 'finished' ? status.winner : null;
  const firstColor = state.firstColor ?? 'red';
  const inkOf = (seat: 'red' | 'black'): 'red' | 'black' =>
    seat === 'red' ? firstColor : firstColor === 'red' ? 'black' : 'red';
  const reason = status.type === 'finished' ? status.reason : 'unfinished';
  const moves = Math.ceil(tokens.length / 2);
  const result = winnerSeat === 'red' ? '1-0' : winnerSeat === 'black' ? '0-1' : '1/2-1/2';
  const loserInk = winnerSeat ? inkOf(winnerSeat === 'red' ? 'black' : 'red') : null;
  const ending =
    reason === 'stalemate'
      ? `${loserInk === 'red' ? 'Red' : 'Blue'} was left with no move`
      : reason === 'no-progress'
        ? 'forty plies passed with no flip or capture'
        : reason === 'repetition'
          ? 'the position repeated three times'
          : reason === 'dead-position'
            ? 'neither side could force a win with what was left'
            : reason;
  const decisive = winnerSeat !== null;
  const name = decisive
    ? `Game ${index + 1}: ${winnerSeat === 'red' ? 'first seat' : 'second seat'} wins in ${moves}`
    : `Game ${index + 1}: drawn in ${moves}`;
  const intro = [
    `MistyJungleFlip against itself at ${(game.nodes / 1_000_000).toFixed(1)} million nodes a move, three times the strength the site's bot plays at.`,
    `The first flip turned up ${inkName(firstColor)}, so the first seat played ${inkName(firstColor)}.`,
    `${moves} moves, ${flips} flips, ${captures} captures${firstCaptureMove ? `, the first at move ${firstCaptureMove}` : ''}.`,
    biggest ? `Biggest capture: ${biggest.text}.` : '',
    decisive
      ? `${winnerSeat === 'red' ? 'The first seat' : 'The second seat'} (${inkName(inkOf(winnerSeat as 'red' | 'black'))}) won: ${ending}${
          lastSwing
            ? lastSwing === firstCaptureMove
              ? `; the winner led on material from move ${lastSwing} and never gave it back`
              : `; material last changed hands at move ${lastSwing}`
            : ''
        }.`
      : `Drawn: ${ending}.`,
  ]
    .filter(Boolean)
    .join(' ');
  return {
    name,
    rootFen: jungleFlipStateToDealtFen(start),
    moves: tokens,
    intro,
    red: `MistyJungleFlip, ${(game.nodes / 1_000_000).toFixed(1)}M nodes`,
    black: `MistyJungleFlip, ${(game.nodes / 1_000_000).toFixed(1)}M nodes`,
    result,
    event: 'Flip Jungle, engine self-play',
    date: new Date().toISOString().slice(0, 10),
    orientation: 'red',
    seed: game.seed,
    nodes: game.nodes,
  };
}

function compile(files: string[]): void {
  // Chapters already in the data file keep their number and name: --update
  // matches chapters by name, so renumbering on every compile would orphan the
  // published ones. New games are appended, decisive first.
  let existing: StudyGame[] = [];
  try {
    existing = (JSON.parse(readFileSync(DATA, 'utf8')) as { games: StudyGame[] }).games;
  } catch {
    existing = [];
  }
  const known = new Set(existing.map((g) => g.seed));
  const games: SelfPlayGame[] = [];
  for (const file of files) {
    const data = JSON.parse(readFileSync(resolve(file), 'utf8')) as { games: SelfPlayGame[] };
    for (const g of data.games) if (!known.has(g.seed)) games.push(g);
  }
  games.sort((a, b) => {
    const da = a.status.winner ? 0 : 1;
    const db = b.status.winner ? 0 : 1;
    return da - db || a.plies - b.plies;
  });
  const described = [...existing, ...games.map((g, i) => describe(g, existing.length + i))];
  const decisive = described.filter((g) => g.result !== '1/2-1/2').length;
  const out = {
    name: `Flip Jungle: ${described.length} engine games`,
    description: `MistyJungleFlip against itself at 7.5 million nodes a move, three times the strength the site's bot plays at. ${decisive} decisive, ${described.length - decisive} drawn. Each chapter opens into its own deal; the note on each says what the replay shows. Rules: /rules/jungle-flip`,
    games: described,
  };
  writeFileSync(DATA, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`wrote ${DATA}: ${described.length} games, ${decisive} decisive`);
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
    variant: 'jungle-flip',
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

/** Local persistent pair only: the dev auth flow hands the code back. */
async function devLogin(email: string): Promise<string> {
  const start = await send('POST', '/api/auth/email/start', { email });
  const { loginId, devCode } = start.json;
  if (!devCode) throw new Error('no devCode in the start response: not a dev server');
  const confirm = await send('POST', '/api/auth/email/confirm', { loginId, code: devCode });
  const setCookie = confirm.headers.get('set-cookie') ?? '';
  const cookie = setCookie
    .split(/,(?=[^;]+=)/)
    .map((c) => c.split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
  if (!cookie) throw new Error('dev login returned no session cookie');
  return cookie;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

async function main(): Promise<void> {
  if (has('compile')) {
    const files = args.slice(args.indexOf('--compile') + 1).filter((a) => !a.startsWith('--'));
    compile(files);
    return;
  }
  const data = JSON.parse(readFileSync(DATA, 'utf8')) as {
    name: string;
    description: string;
    games: StudyGame[];
  };
  for (const game of data.games) {
    console.log(
      `${game.name.padEnd(40)} ${String(game.moves.length).padStart(3)} plies, ${game.result}`,
    );
  }
  const create = has('create');
  const update = flag('update');
  if (!create && !update) {
    console.log(
      `\ndry run: ${data.games.length} chapters. --create writes a new study, --update <id> syncs one.`,
    );
    return;
  }
  const devEmail = flag('dev-login');
  const cookie = devEmail
    ? await devLogin(devEmail)
    : readFileSync(flag('cookie') ?? join(homedir(), '.mistboard-cookie'), 'utf8').trim();
  if (update) {
    const current = (await send('GET', `/api/studies/${update}`)).json;
    const byName = new Map<string, { id: string; version: number; root: unknown; tags?: unknown }>(
      current.chapters.map((c: { name: string; id: string; version: number; root: unknown }) => [
        c.name,
        c,
      ]),
    );
    for (const game of data.games) {
      const chapter = byName.get(game.name);
      const payload = chapterFor(game);
      if (!chapter) {
        await send('POST', `/api/studies/${update}/chapters`, payload, cookie);
        console.log(`  + ${game.name}`);
        continue;
      }
      const treeStale = stable(chapter.root) !== stable(payload.root);
      const tagsStale = stable(chapter.tags ?? {}) !== stable(payload.tags);
      if (!treeStale && !tagsStale) continue;
      await send(
        'PATCH',
        `/api/studies/${update}/chapters/${chapter.id}`,
        {
          ...(treeStale ? { root: payload.root, baseVersion: chapter.version } : {}),
          ...(tagsStale ? { tags: payload.tags } : {}),
        },
        cookie,
      );
      console.log(`  ~ ${game.name}`);
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
        chapter: chapterFor(first),
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
