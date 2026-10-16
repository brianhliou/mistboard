// Build the "MistyBanqi against people" study: the three games the MistyBanqi
// article (/blog/mistybanqi) embeds, one chapter each.
//
//   npx tsx scripts/misty-banqi-study.ts                       # dry run over the data file
//   npx tsx scripts/misty-banqi-study.ts --create --public --cookie ~/.mistboard-cookie
//   npx tsx scripts/misty-banqi-study.ts --update <studyId> --cookie ~/.mistboard-cookie
//   npx tsx scripts/misty-banqi-study.ts --create --base http://localhost:3171 --dev-login you@example.com
//
// scripts/data/misty-banqi-study.json is the source of truth: each game's deal
// and moves (real prod PvE games, rebuilt from the finished games' truth
// history), the chapter intro, and notes keyed by ply. Every game is replayed
// under LEGACY_BANQI_RULES (all three predate the 長捉 rule) and must reach the
// recorded result before anything is sent. A production --create writes the new
// study and chapter ids back into the data file and into the article's
// placeholder ids (apps/web/src/articles/content/banqi-engine.ts);
// apps/web/src/articles/misty-banqi-study.test.ts checks the two agree. The cookie is read from a FILE and used as a header; it is never printed.
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  applyBanqiMove,
  type BanqiDeal,
  type BanqiGameState,
  type BanqiSquare,
  banqiStateToDealtFen,
  createInitialBanqiState,
  isBanqiLegalMove,
  LEGACY_BANQI_RULES,
} from '@mistboard/game';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name: string): boolean => args.includes(`--${name}`);
const BASE = flag('base') ?? 'https://mistboard.com';
const DATA = resolve('scripts/data/misty-banqi-study.json');
const ARTICLE = resolve('apps/web/src/articles/content/banqi-engine.ts');

type StudyGame = {
  key: string;
  name: string;
  chapterId: string | null;
  embedPly: number;
  red: string;
  black: string;
  result: '1-0' | '0-1' | '1/2-1/2';
  event: string;
  date?: string;
  room?: string;
  intro: string;
  notes: Record<string, string>;
  deal: BanqiDeal;
  moves: string;
};

type StudyData = {
  name: string;
  description: string;
  studyId: string | null;
  games: StudyGame[];
};

/** Replay a game under the rules it was played under; throws on any refused move. */
function replay(game: StudyGame): BanqiGameState[] {
  let state = createInitialBanqiState(`study-${game.key}`, game.deal, LEGACY_BANQI_RULES);
  const states = [state];
  for (const [i, token] of game.moves.trim().split(/\s+/).entries()) {
    const move = { from: token.slice(0, 2) as BanqiSquare, to: token.slice(2, 4) as BanqiSquare };
    if (!isBanqiLegalMove(state, move))
      throw new Error(`${game.key}: move ${i + 1} ${token} refused by the kernel`);
    state = applyBanqiMove(state, move);
    states.push(state);
  }
  return states;
}

function check(game: StudyGame): BanqiGameState[] {
  const states = replay(game);
  const end = states.at(-1)!.status;
  const result =
    end.type !== 'finished'
      ? 'unfinished'
      : end.winner === 'red'
        ? '1-0'
        : end.winner === 'black'
          ? '0-1'
          : '1/2-1/2';
  if (result !== game.result)
    throw new Error(`${game.key}: replay ends ${result}, data says ${game.result}`);
  if (game.embedPly < 0 || game.embedPly >= states.length)
    throw new Error(`${game.key}: embed ply ${game.embedPly} is past the game`);
  for (const ply of Object.keys(game.notes)) {
    const n = Number(ply);
    if (!Number.isInteger(n) || n < 1 || n >= states.length)
      throw new Error(`${game.key}: note at ply ${ply} is off the game`);
  }
  return states;
}

function chapterFor(game: StudyGame) {
  const start = createInitialBanqiState(`study-${game.key}`, game.deal, LEGACY_BANQI_RULES);
  type Node = { uci?: string; annotations?: object; children: Node[] };
  const root: Node = { annotations: { comments: [{ text: game.intro }] }, children: [] };
  let cursor = root;
  for (const [i, uci] of game.moves.trim().split(/\s+/).entries()) {
    const note = game.notes[String(i + 1)];
    const node: Node = {
      uci,
      children: [],
      ...(note ? { annotations: { comments: [{ text: note }] } } : {}),
    };
    cursor.children.push(node);
    cursor = node;
  }
  return {
    name: game.name,
    variant: 'banqi',
    orientation: 'red',
    root: { version: 1, rootFen: banqiStateToDealtFen(start), root },
    tags: {
      red: game.red,
      black: game.black,
      result: game.result,
      event: game.event,
      ...(game.date ? { date: game.date } : {}),
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
  const cookie = (confirm.headers.get('set-cookie') ?? '')
    .split(/,(?=[^;]+=)/)
    .map((c) => c.split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
  if (!cookie) throw new Error('dev login returned no session cookie');
  return cookie;
}

async function main(): Promise<void> {
  const data = JSON.parse(readFileSync(DATA, 'utf8')) as StudyData;
  for (const game of data.games) {
    const states = check(game);
    console.log(
      `${game.name.padEnd(48)} ${String(states.length - 1).padStart(3)} plies, ${game.result}, embed ply ${game.embedPly}`,
    );
  }
  const create = has('create');
  const update = flag('update');
  if (!create && !update) {
    console.log(
      `\ndry run: ${data.games.length} chapters replay cleanly. --create writes a new study.`,
    );
    return;
  }
  const devEmail = flag('dev-login');
  const cookie = devEmail
    ? await devLogin(devEmail)
    : readFileSync(flag('cookie') ?? join(homedir(), '.mistboard-cookie'), 'utf8').trim();
  if (update) {
    const current = (await send('GET', `/api/studies/${update}`)).json;
    const byName = new Map<string, { id: string; version: number }>(
      current.chapters.map((c: { name: string; id: string; version: number }) => [c.name, c]),
    );
    for (const game of data.games) {
      const chapter = byName.get(game.name);
      const payload = chapterFor(game);
      if (!chapter) {
        await send('POST', `/api/studies/${update}/chapters`, payload, cookie);
        console.log(`  + ${game.name}`);
        continue;
      }
      await send(
        'PATCH',
        `/api/studies/${update}/chapters/${chapter.id}`,
        { root: payload.root, baseVersion: chapter.version, tags: payload.tags },
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
  const studyId: string = created.study?.id ?? created.id;
  console.log(`\ncreated study ${studyId}`);
  for (const game of rest) {
    await send('POST', `/api/studies/${studyId}/chapters`, chapterFor(game), cookie);
    console.log(`  + ${game.name}`);
  }
  // Read the chapter ids back by name, in the order the data file lists them.
  const study = (await send('GET', `/api/studies/${studyId}`)).json;
  const ids = new Map<string, string>(
    study.chapters.map((c: { name: string; id: string }) => [c.name, c.id]),
  );
  for (const game of data.games) {
    const id = ids.get(game.name);
    console.log(`  ${id}  ${game.name}  /embed/study/${studyId}/${id}?ply=${game.embedPly}`);
  }
  // Only production ids belong in the data file the article is tested against.
  if (BASE === 'https://mistboard.com') {
    data.studyId = studyId;
    for (const game of data.games) game.chapterId = ids.get(game.name) ?? null;
    // One deal tile per line, as the file was written.
    const json = JSON.stringify(data, null, 2).replace(
      /\{\n\s+"color": "(\w+)",\n\s+"role": "(\w+)"\n\s+\}/g,
      '{ "color": "$1", "role": "$2" }',
    );
    writeFileSync(DATA, `${json}\n`);
    console.log(`wrote the ids to ${DATA}`);
    // The article ships with placeholder ids until the study exists; fill them.
    let article = readFileSync(ARTICLE, 'utf8').replace(`'STUDY_ID_PENDING'`, `'${studyId}'`);
    for (const game of data.games)
      article = article.replace(
        `'${game.key.toUpperCase()}_CHAPTER_PENDING'`,
        `'${ids.get(game.name)}'`,
      );
    writeFileSync(ARTICLE, article);
    console.log(`wrote the ids to ${ARTICLE}`);
  }
  console.log(`\n${BASE}/study/${studyId}`);
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
