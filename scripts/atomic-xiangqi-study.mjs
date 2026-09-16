#!/usr/bin/env node
// Build the Atomic Xiangqi companion study from scripts/data/atomic-xiangqi-study.json:
// the engine games under the shipped rules (the variant lab's cannon-shot design,
// fingerprint 045a5cf08c06), one chapter each, with the notes the lab's eval scan
// and the write-up arrived at.
//
//   node scripts/atomic-xiangqi-study.mjs --dry-run
//   node scripts/atomic-xiangqi-study.mjs --create --cookie ~/.mistboard-cookie
//   node scripts/atomic-xiangqi-study.mjs --create --base http://localhost:3001 --dev-login you@example.com
//   node scripts/atomic-xiangqi-study.mjs --update <studyId> --cookie ~/.mistboard-cookie
//
// The cookie is read from a FILE and used as a header; it is never printed. On a
// local persistent pair `--dev-login` signs in with the dev auto-code instead.
//
// The data file is the source of truth for the study: moves as the engine played
// them (a1-i10 UCI, which is also the study's stored form for this variant),
// per-ply comments keyed by ply number, and the chapter's players, event and
// result. The study is created UNLISTED: the variant is unlisted, and the study
// is linked from its rules page and the post, not from /study.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(here, 'data', 'atomic-xiangqi-study.json');
const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const BASE = argOf('base', 'https://mistboard.com');
const CREATE = args.includes('--create');
const UPDATE = argOf('update', null);

const NAG = { '!': 1, '?': 2, '!!': 3, '??': 4, '!?': 5, '?!': 6 };

function buildTree(game) {
  const root = { annotations: {}, children: [] };
  if (game.intro) root.annotations = { comments: [{ text: game.intro }] };
  let cursor = root;
  for (const [index, uci] of game.moves.entries()) {
    const node = { uci, children: [] };
    const note = game.notes?.[String(index + 1)];
    if (note) {
      const glyph = note.glyph ? NAG[note.glyph] : undefined;
      node.annotations = {
        ...(glyph ? { glyphs: [glyph] } : {}),
        ...(note.text ? { comments: [{ text: note.text }] } : {}),
      };
    }
    cursor.children.push(node);
    cursor = node;
  }
  return { version: 1, root };
}

function chapterFor(game) {
  return {
    name: game.name,
    variant: 'atomic-xiangqi',
    orientation: game.orientation ?? 'red',
    root: buildTree(game),
    tags: {
      red: game.red,
      black: game.black,
      result: game.result,
      event: game.event,
      ...(game.date ? { date: game.date } : {}),
    },
  };
}

async function send(method, path, body, cookie) {
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
async function devLogin(email) {
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

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

async function update(studyId, data, cookie) {
  const current = (await send('GET', `/api/studies/${studyId}`)).json;
  const byName = new Map(current.chapters.map((c) => [c.name, c]));
  for (const game of data.games) {
    const chapter = byName.get(game.name);
    const payload = chapterFor(game);
    if (!chapter) {
      await send('POST', `/api/studies/${studyId}/chapters`, payload, cookie);
      console.log(`  + ${game.name}`);
      continue;
    }
    const treeStale = stable(chapter.root) !== stable(payload.root);
    const tagsStale = stable(chapter.tags ?? {}) !== stable(payload.tags);
    if (!treeStale && !tagsStale) continue;
    await send(
      'PATCH',
      `/api/studies/${studyId}/chapters/${chapter.id}`,
      {
        ...(treeStale ? { root: payload.root, baseVersion: chapter.version } : {}),
        ...(tagsStale ? { tags: payload.tags } : {}),
      },
      cookie,
    );
    console.log(
      `  ~ ${game.name} (${[treeStale && 'tree', tagsStale && 'tags'].filter(Boolean).join(', ')})`,
    );
  }
  await send(
    'PATCH',
    `/api/studies/${studyId}`,
    { name: data.name, description: data.description },
    cookie,
  );
}

async function main() {
  const data = JSON.parse(readFileSync(DATA, 'utf8'));
  for (const game of data.games) {
    const notes = Object.keys(game.notes ?? {}).length;
    console.log(
      `${game.name.padEnd(44)} ${String(game.moves.length).padStart(3)} plies, ${notes} notes, ${game.result}`,
    );
  }
  if (!CREATE && !UPDATE) {
    console.log(
      `\ndry run: ${data.games.length} chapters. --create writes a new study, --update <id> syncs one.`,
    );
    return;
  }
  const devEmail = argOf('dev-login', null);
  const cookie = devEmail
    ? await devLogin(devEmail)
    : readFileSync(argOf('cookie', join(homedir(), '.mistboard-cookie')), 'utf8').trim();

  if (UPDATE) {
    await update(UPDATE, data, cookie);
    console.log(`${BASE}/study/${UPDATE}`);
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
        visibility: args.includes('--public') ? 'public' : 'unlisted',
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
