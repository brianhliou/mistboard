#!/usr/bin/env node
// Build the "Misty vs Misty, 30 s a move" study: three Fog Chess games Misty v1.6
// played against itself at 30 s a move, one chapter each, with the node comments
// Brian wrote while reviewing them on the local pair.
//
//   node scripts/misty-mirror-study.mjs --compile --from http://localhost:3030/study/HmAwf2y3
//       reads the reviewed local study, checks every chapter's mainline against
//       the engine's own game record, writes scripts/data/misty-mirror-study.json
//   node scripts/misty-mirror-study.mjs                                  # dry run
//   node scripts/misty-mirror-study.mjs --cookie ~/.mistboard-cookie     # dry run + prod lookup
//   node scripts/misty-mirror-study.mjs --write --cookie ~/.mistboard-cookie
//   node scripts/misty-mirror-study.mjs --base http://localhost:3030 --dev-login you@example.com
//
// Dry run is the default: it replays every chapter through the Fog Chess kernel,
// prints one row per chapter, and, given a session, says whether --write would
// create the study or sync an existing one. --write is idempotent: it looks for a
// study of the same name owned by the session's account and syncs its chapters in
// place (by chapter name, version-guarded) when there is one, so a second run
// changes nothing. It creates the study UNLISTED. On mistboard.com it refuses to
// write unless the session is @brianhliou (`--as <handle>` overrides).
//
// The cookie is read from a FILE and used as a header; it is never printed and
// never an argument (an argument shows in the process list).
//
// Castling is stored king-onto-rook (e1h1, e8a8), the board's own spelling and
// what a castle played on the study board saves. Misty's records write standard
// UCI (e1g1, e8c8); --compile canonicalises them, and the dry run refuses a
// bundle that still carries a standard-UCI castle, so this script does not need
// the #451 fix to be deployed.
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalChessCastlingMove, darkChessVariant } from '@mistboard/game';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

const PROD = 'https://mistboard.com';
const BASE = argOf('base', PROD).replace(/\/$/, '');
const DATA = resolve(argOf('data', join(here, 'data', 'misty-mirror-study.json')));
const LAB = join(homedir(), 'projects', 'mistboard-engine', 'lab');

/** Chapter name -> the engine's game record it was built from. */
const SOURCES = {
  'Seed 1010: Black wins in 74': join(LAB, 'fow-mirror-20260923-123906-s1010', 'game.json'),
  'Seed 1007: White wins in 55': join(LAB, 'fow-mirror-20260923-123906-s1007', 'game.json'),
  'Pilot: White wins in 121': join(LAB, 'fow-mirror-pilot-20260923-111231', 'game.json'),
};

const STANDARD_CASTLES = new Set(['e1g1', 'e1c1', 'e8g8', 'e8c8']);

function uciToMove(uci) {
  const promotion = { q: 'queen', r: 'rook', b: 'bishop', n: 'knight' }[uci[4]];
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), ...(promotion ? { promotion } : {}) };
}

function moveToUci(move) {
  const promo = { queen: 'q', rook: 'r', bishop: 'b', knight: 'n' }[move.promotion] ?? '';
  return `${move.from}${move.to}${promo}`;
}

function mainline(root) {
  const moves = [];
  for (let node = root.root; node.children?.length; ) {
    node = node.children[0];
    moves.push(node.uci);
  }
  return moves;
}

function countComments(node) {
  const own = node.annotations?.comments?.length ?? (node.annotations?.comment ? 1 : 0);
  return own + (node.children ?? []).reduce((sum, child) => sum + countComments(child), 0);
}

/** Replay a UCI list through the Fog Chess kernel. Throws on the first illegal
 *  ply; returns the final state and the list in the board's castling spelling. */
function replay(ucis, label) {
  let state = darkChessVariant.createInitialState('study-check');
  const canonical = [];
  ucis.forEach((uci, i) => {
    if (state.status.type !== 'playing') {
      throw new Error(`${label}: ply ${i + 1} (${uci}) comes after the game ended`);
    }
    const move = canonicalChessCastlingMove(state, uciToMove(uci));
    const next = darkChessVariant.applyMove(state, move);
    if (next === state) throw new Error(`${label}: ply ${i + 1} (${uci}) is illegal`);
    canonical.push(moveToUci(move));
    state = next;
  });
  return { state, canonical };
}

function resultOf(state) {
  if (state.status.type !== 'finished') return 'unfinished';
  const { winner, reason } = state.status;
  return `${winner ?? 'draw'} (${reason})`;
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
  const cookie = (confirm.headers.get('set-cookie') ?? '')
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

function chapterPayload(chapter) {
  return {
    name: chapter.name,
    variant: chapter.variant,
    orientation: chapter.orientation,
    tags: chapter.tags ?? {},
    root: chapter.root,
  };
}

// ── --compile: reviewed local study + engine records -> the bundle ─────────────
async function compile() {
  const from = argOf('from', 'http://localhost:3030/study/HmAwf2y3');
  const url = new URL(from);
  const id = url.pathname.split('/').filter(Boolean).pop();
  const res = await fetch(`${url.origin}/api/studies/${id}`);
  if (!res.ok) throw new Error(`GET ${url.origin}/api/studies/${id} -> ${res.status}`);
  const { study, chapters } = await res.json();

  const out = [];
  for (const chapter of chapters) {
    const source = SOURCES[chapter.name];
    if (!source) throw new Error(`chapter "${chapter.name}" has no game record in SOURCES`);
    const record = JSON.parse(readFileSync(source, 'utf8'));
    const fromRecord = replay(
      record.moves.map((m) => m.uci),
      `${chapter.name} (record)`,
    );
    const fromStudy = replay(mainline(chapter.root), `${chapter.name} (local study)`);
    if (fromRecord.canonical.join(' ') !== fromStudy.canonical.join(' ')) {
      throw new Error(`${chapter.name}: the local study's mainline differs from ${source}`);
    }
    const want = `${record.winner} (${record.end_reason})`;
    if (resultOf(fromRecord.state) !== want) {
      throw new Error(
        `${chapter.name}: replay ends ${resultOf(fromRecord.state)}, record says ${want}`,
      );
    }
    out.push({
      name: chapter.name,
      variant: chapter.variant,
      orientation: chapter.orientation,
      tags: chapter.tags ?? {},
      root: rewriteCastles(chapter.root),
    });
  }
  const bundle = {
    name: study.name,
    description: study.description,
    visibility: 'unlisted',
    source: `${url.origin}/study/${id}`,
    chapters: out,
  };
  writeFileSync(DATA, `${JSON.stringify(bundle, null, 2)}\n`);
  console.log(`wrote ${DATA}: ${out.length} chapters from ${bundle.source}`);
}

/** Every node's uci in the board's castling spelling (a local tree saved before
 *  the #451 fix already is; this makes the bundle independent of that). */
function rewriteCastles(serialized) {
  const walk = (node, state) => {
    const children = (node.children ?? []).map((child) => {
      const move = canonicalChessCastlingMove(state, uciToMove(child.uci));
      const next = darkChessVariant.applyMove(state, move);
      return walk({ ...child, uci: moveToUci(move) }, next);
    });
    return { ...node, children };
  };
  return {
    ...serialized,
    root: walk(serialized.root, darkChessVariant.createInitialState('study-check')),
  };
}

// ── dry run / --write ─────────────────────────────────────────────────────────
function checkBundle(bundle) {
  let ok = true;
  for (const chapter of bundle.chapters) {
    const ucis = mainline(chapter.root);
    const standard = ucis.filter((u, i) => STANDARD_CASTLES.has(u) && isKingMove(ucis, i));
    const { state } = replay(ucis, chapter.name);
    const castles = ucis
      .map((u, i) => [i + 1, u])
      .filter(([, u]) => /^e[18][ah][18]$/.test(u) || STANDARD_CASTLES.has(u));
    console.log(
      `${chapter.name.padEnd(30)} ${String(ucis.length).padStart(3)} plies  ` +
        `${String(countComments(chapter.root.root)).padStart(2)} comments  ` +
        `ends ${resultOf(state).padEnd(22)} castles ${castles.map(([p, u]) => `${p}:${u}`).join(' ')}`,
    );
    if (state.status.type !== 'finished') ok = false;
    if (standard.length > 0) {
      console.error(`  standard-UCI castling left in the bundle: ${standard.join(' ')}`);
      ok = false;
    }
  }
  if (!ok) throw new Error('bundle check failed');
}

/** Whether ply i of the list moves a king (so e1g1 there is a castle, not a
 *  rook or queen that happens to share the squares). */
function isKingMove(ucis, i) {
  let state = darkChessVariant.createInitialState('study-check');
  for (let p = 0; p < i; p += 1) {
    state = darkChessVariant.applyMove(state, uciToMove(ucis[p]));
  }
  return state.board[ucis[i].slice(0, 2)]?.role === 'king';
}

async function session() {
  const devEmail = argOf('dev-login', null);
  if (devEmail) return devLogin(devEmail);
  const path = argOf('cookie', null);
  return path ? readFileSync(path, 'utf8').trim() : null;
}

async function main() {
  if (has('compile')) return compile();

  const bundle = JSON.parse(readFileSync(DATA, 'utf8'));
  console.log(`"${bundle.name}" (${bundle.visibility}), ${bundle.chapters.length} chapters\n`);
  checkBundle(bundle);

  const cookie = await session();
  if (!cookie) {
    console.log('\ndry run, no session: pass --cookie <file> to look the study up on', BASE);
    return;
  }
  const me = (await send('GET', '/api/auth/me', undefined, cookie)).json?.user;
  if (!me) throw new Error(`the session is not signed in on ${BASE}`);
  const expected = argOf('as', BASE === PROD ? 'brianhliou' : null);
  console.log(`\n${BASE} session: @${me.handle}`);
  if (expected && me.handle !== expected) {
    throw new Error(`session is @${me.handle}, expected @${expected}; refusing`);
  }

  const mine = (
    await send('GET', `/api/studies/mine?q=${encodeURIComponent(bundle.name)}`, undefined, cookie)
  ).json;
  const existing = (mine.studies ?? []).find((s) => s.name === bundle.name);
  const write = has('write');

  if (!existing) {
    if (!write) {
      console.log(`dry run: no study named "${bundle.name}"; --write creates it`);
      return;
    }
    const [first, ...rest] = bundle.chapters;
    const created = (
      await send(
        'POST',
        '/api/studies',
        {
          name: bundle.name,
          description: bundle.description,
          visibility: bundle.visibility,
          chapter: chapterPayload(first),
        },
        cookie,
      )
    ).json;
    const studyId = created.study?.id ?? created.id;
    console.log(`created ${studyId}\n  + ${first.name}`);
    for (const chapter of rest) {
      await send('POST', `/api/studies/${studyId}/chapters`, chapterPayload(chapter), cookie);
      console.log(`  + ${chapter.name}`);
    }
    await verify(studyId, bundle);
    console.log(`\n${BASE}/study/${studyId}`);
    return;
  }

  // Exists: diff chapter by chapter, sync in place when --write.
  const current = (await send('GET', `/api/studies/${existing.id}`, undefined, cookie)).json;
  const byName = new Map(current.chapters.map((c) => [c.name, c]));
  const plan = bundle.chapters.map((chapter) => {
    const have = byName.get(chapter.name);
    if (!have) return { chapter, action: 'add' };
    const tree = stable(have.root) !== stable(chapter.root);
    const tags = stable(have.tags ?? {}) !== stable(chapter.tags ?? {});
    return { chapter, have, tree, tags, action: tree || tags ? 'sync' : 'same' };
  });
  const meta =
    current.study.description !== bundle.description ||
    current.study.visibility !== bundle.visibility;
  console.log(`study exists as ${existing.id}:`);
  for (const p of plan) console.log(`  ${p.action.padEnd(4)} ${p.chapter.name}`);
  if (meta) console.log('  sync description/visibility');
  if (!write) {
    console.log('dry run: --write applies the lines above that are not "same"');
    return;
  }
  for (const p of plan) {
    if (p.action === 'add') {
      await send('POST', `/api/studies/${existing.id}/chapters`, chapterPayload(p.chapter), cookie);
    } else if (p.action === 'sync') {
      await send(
        'PATCH',
        `/api/studies/${existing.id}/chapters/${p.have.id}`,
        {
          ...(p.tree ? { root: p.chapter.root, baseVersion: p.have.version } : {}),
          ...(p.tags ? { tags: p.chapter.tags ?? {} } : {}),
        },
        cookie,
      );
    }
  }
  if (meta) {
    await send(
      'PATCH',
      `/api/studies/${existing.id}`,
      { description: bundle.description, visibility: bundle.visibility },
      cookie,
    );
  }
  await verify(existing.id, bundle);
  console.log(`\n${BASE}/study/${existing.id}`);
}

/** Read the study back and check every chapter's stored mainline is the whole game. */
async function verify(studyId, bundle) {
  const { chapters } = (await send('GET', `/api/studies/${studyId}`)).json;
  for (const chapter of bundle.chapters) {
    const stored = chapters.find((c) => c.name === chapter.name);
    const want = mainline(chapter.root).length;
    const got = stored ? mainline(stored.root).length : 0;
    if (got !== want) throw new Error(`${chapter.name}: stored ${got} plies, expected ${want}`);
  }
  console.log(`verified: ${bundle.chapters.length} chapters read back whole`);
}

main().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
