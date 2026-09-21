/**
 * Seed the "popular opening moves the engine calls inaccuracies" chess study:
 * positions from the Lichess opening explorer (1600-2200 players, 500k+ games
 * each) where the MOST PLAYED move loses at least 0.1 winning chances at
 * 20,000,000 nodes against the best move, verified by a second independent
 * search. One chapter per position, the champions shape: the club move on the
 * mainline with its glyph, a comment carrying the club share, the masters' top
 * move by era and both engine numbers, and then the engine's continuation
 * played out to a verdict glyph, so the reader sees WHY it is worse; the
 * engine's own line as the sideline, `!` on its first move and its verdict at
 * the end. Two lines, two verdicts, side by side.
 *
 * Input: results/openings-study.json from chess-companion/experiments/
 * shallow-labels (openings_export.py), featured ten first.
 *
 * Usage (local dev, server on 3001):
 *   npx tsx apps/server/src/seed-chess-openings-study.ts \
 *     --input <path to openings-study.json> --email you@example.com \
 *     [--base http://127.0.0.1:3001] [--visibility public|unlisted|private] [--replace]
 *
 * Against a real server, supply a browser session instead of --email:
 *   MISTBOARD_SESSION_COOKIE='mistboard_session=...' npx tsx ... --base https://mistboard.com
 * The cookie is a live credential: read from the environment, never logged.
 */
import { readFileSync } from 'node:fs';
import {
  type GameState,
  type Move,
  type PieceRole,
  parseStandardChessFen,
  type Square,
  standardChessSan,
  standardChessVariant,
} from '@mistboard/game';
import { resolveExistingStudy } from './seed-study-idempotency.js';

export const CHESS_OPENINGS_STUDY_NAME = 'The most played move is an inaccuracy';

type Era = {
  window: string;
  games: number;
  top: string | null;
  played_share: number | null;
  best_share: number | null;
};
type Node = {
  key: string;
  fen: string;
  fen_full: string;
  ply: number;
  line: string[];
  opening: string | null;
  eco: string | null;
  games: number;
  mover: 'white' | 'black';
  played: string;
  played_uci: string;
  played_share: number;
  played_cp: number;
  best: string;
  best_uci: string;
  best_cp: number;
  best_pv: string;
  best_pv_ucis: string[];
  /** The engine's continuation after the club move, so the mainline plays the
   *  inaccuracy out to where the gap shows. */
  played_pv_ucis: string[];
  second: string | null;
  second_cp: number | null;
  drop: number;
  verify: { best: string; best_cp: number; played_cp: number; drop: number };
  eras: Era[];
  shape: string;
  featured: boolean;
};

type SerializedNode = {
  uci?: string;
  annotations?: { comments?: { text: string }[]; glyphs?: number[] };
  children: SerializedNode[];
};

function parseArgs(): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg?.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = args[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

const UCI_PROMOTION: Record<string, Exclude<PieceRole, 'king' | 'pawn'>> = {
  q: 'queen',
  r: 'rook',
  b: 'bishop',
  n: 'knight',
};

function uciToMove(uci: string): Move {
  const promotion = uci.length > 4 ? UCI_PROMOTION[uci[4]!] : undefined;
  return {
    from: uci.slice(0, 2) as Square,
    to: uci.slice(2, 4) as Square,
    ...(promotion ? { promotion } : {}),
  };
}

/** Replay a UCI line through the chess kernel; throw on the first illegal move. */
function verifiedLine(name: string, start: GameState, line: string[]): string[] {
  let state = start;
  const kept: string[] = [];
  for (const uci of line) {
    if (state.status.type !== 'playing') break;
    const move = uciToMove(uci);
    const legal = standardChessVariant
      .getLegalMoves(state, state.status.turn)
      .find((m) => m.from === move.from && m.to === move.to && m.promotion === move.promotion);
    if (!legal) throw new Error(`${name}: illegal ${uci} after ${kept.join(' ')}`);
    state = standardChessVariant.applyMove(state, legal);
    kept.push(uci);
  }
  return kept;
}

function chain(line: string[], leafGlyphs: number[] = []): SerializedNode | null {
  let child: SerializedNode | null = null;
  for (const [index, uci] of [...line.entries()].reverse()) {
    const isLeaf = index === line.length - 1;
    child = {
      uci,
      ...(isLeaf && leafGlyphs.length ? { annotations: { glyphs: leafGlyphs } } : {}),
      children: child ? [child] : [],
    };
  }
  return child;
}

/** PGN assessment NAG for a white-POV eval (10 '=', 14 '⩲', 15 '⩱', 16 '±', 17 '∓', 18 '+−', 19 '−+'). */
function assessmentNag(cp: number): number {
  const a = Math.abs(cp);
  if (a < 30) return 10;
  if (a < 70) return cp > 0 ? 14 : 15;
  if (a < 150) return cp > 0 ? 16 : 17;
  return cp > 0 ? 18 : 19;
}

const pawns = (cp: number): string => `${cp >= 0 ? '+' : ''}${(cp / 100).toFixed(2)}`;
const pct = (x: number): string => `${Math.round(x * 100)}%`;

function mastersSentence(n: Node): string {
  const parts = n.eras.map((e) => {
    if (!e.top || e.games < 20) return `${e.window}: too few games`;
    const share = e.top === n.played ? e.played_share : e.top === n.best ? e.best_share : null;
    return `${e.window}: ${e.top}${share != null ? ` ${pct(share)}` : ''} of ${e.games.toLocaleString()}`;
  });
  return `Masters database, top move by era: ${parts.join('; ')}.`;
}

/** Full SAN line from the node's move list, for the chapter name and root comment. */
function lineText(line: string[]): string {
  return line.map((san, i) => (i % 2 === 0 ? `${i / 2 + 1}.${san}` : san)).join(' ');
}

export function chapterPayload(n: Node) {
  const parsed = parseStandardChessFen(n.fen_full, `seed-opening-${n.key}`);
  if (!parsed.ok) throw new Error(`${n.key}: ${parsed.error}`);
  const start = parsed.state;
  const moveNo = `${Math.floor(n.ply / 2) + 1}.${n.mover === 'white' ? '' : '..'}`;
  const gap = n.verify.drop;
  const judgment = gap >= 0.3 ? 'blunder' : gap >= 0.2 ? 'mistake' : 'inaccuracy';
  const nag = gap >= 0.3 ? 4 : gap >= 0.2 ? 2 : 6;
  const points = Math.round(gap * 50);

  const playedLine = verifiedLine(`${n.key} played`, start, [n.played_uci, ...n.played_pv_ucis]);
  const bestLine = verifiedLine(
    `${n.key} best`,
    start,
    n.best_pv_ucis.length ? n.best_pv_ucis : [n.best_uci],
  );
  const playedSan = standardChessSan(start, uciToMove(n.played_uci));

  const root =
    `${lineText(n.line)}${n.opening ? ` (${n.eco ?? ''} ${n.opening})`.replace('( ', '(') : ''}. ` +
    `In ${n.games.toLocaleString()} Lichess games between 1600 and 2200, the most played move is ` +
    `${moveNo}${playedSan} (${pct(n.played_share)}). At 20 million nodes it is ${judgment === 'blunder' ? 'a blunder' : judgment === 'mistake' ? 'a mistake' : 'an inaccuracy'}: ` +
    `${pawns(n.played_cp)} against ${pawns(n.best_cp)} for ${n.best}, ${points} win-chance points, ` +
    `confirmed by a second search (${pawns(n.verify.played_cp)} against ${pawns(n.verify.best_cp)}). ${mastersSentence(n)}`;
  const playedComment =
    `The club move: ${pct(n.played_share)} of games. ${judgment}, ${points} win-chance points against ${n.best}. ` +
    `${pawns(n.played_cp)} at 20M nodes.`;
  const bestComment =
    `${n.best}: ${pawns(n.best_cp)} at 20M nodes` +
    (n.second && n.second_cp != null
      ? `, against ${pawns(n.second_cp)} for the second choice (${n.second})`
      : '') +
    `. ${n.best_pv}`;

  const mainline = chain(playedLine, [assessmentNag(n.played_cp)]);
  const variation = chain(bestLine, [assessmentNag(n.best_cp)]);
  if (!mainline || !variation) throw new Error(`${n.key}: empty line`);
  mainline.annotations = {
    ...(mainline.annotations ?? {}),
    glyphs: [nag, ...(mainline.annotations?.glyphs ?? [])],
    comments: [{ text: playedComment }],
  };
  variation.annotations = {
    ...(variation.annotations ?? {}),
    glyphs: [1, ...(variation.annotations?.glyphs ?? [])],
    comments: [{ text: bestComment }],
  };

  const title = n.opening ?? lineText(n.line);
  return {
    name: `${title}: ${moveNo}${playedSan}?${gap >= 0.2 ? '' : '!'} (${pct(n.played_share)} of ${Math.round((n.games / 1e6) * 10) / 10}M games)`,
    variant: 'chess' as const,
    orientation: n.mover === 'white' ? ('red' as const) : ('black' as const),
    tags: {
      red: 'White',
      black: 'Black',
      event: `Lichess database, 1600-2200, ${n.games.toLocaleString()} games`,
      result: '*',
    },
    root: {
      version: 1 as const,
      rootFen: n.fen_full,
      root: {
        annotations: { comments: [{ text: root }] },
        children: [mainline, variation],
      },
    },
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const base = typeof args.base === 'string' ? args.base : 'http://127.0.0.1:3001';
  const inputPath = typeof args.input === 'string' ? args.input : null;
  const email = typeof args.email === 'string' ? args.email : null;
  const visibility = typeof args.visibility === 'string' ? args.visibility : 'public';
  if (!inputPath) {
    console.error('--input <json> is required');
    process.exitCode = 1;
    return;
  }
  const nodes = JSON.parse(readFileSync(inputPath, 'utf8')) as Node[];
  const chapters = nodes.map(chapterPayload);
  console.log(`${chapters.length} chapters verified against the chess kernel`);

  const suppliedCookie = process.env.MISTBOARD_SESSION_COOKIE?.trim();
  if (!suppliedCookie && !email) {
    console.error('--email required (dev server), or set MISTBOARD_SESSION_COOKIE');
    process.exitCode = 1;
    return;
  }
  let cookie = suppliedCookie ?? '';
  const post = async (path: string, body: unknown): Promise<Response> => {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0] ?? cookie;
    return response;
  };
  if (!suppliedCookie) {
    const start = await post('/api/auth/email/start', { email });
    if (!start.ok) throw new Error(`auth start failed: ${start.status}`);
    const started = (await start.json()) as { loginId?: string; devCode?: string };
    if (!started.loginId || !started.devCode) {
      throw new Error('no dev code returned; use MISTBOARD_SESSION_COOKIE against a real server');
    }
    const confirm = await post('/api/auth/email/confirm', {
      loginId: started.loginId,
      code: started.devCode,
    });
    if (!confirm.ok) throw new Error(`auth confirm failed: ${confirm.status}`);
    console.log(`signed in as ${email} at ${base}`);
  }
  const get = async (path: string): Promise<Response> =>
    fetch(`${base}${path}`, { headers: { ...(cookie ? { cookie } : {}) } });
  const del = async (path: string): Promise<Response> =>
    fetch(`${base}${path}`, { method: 'DELETE', headers: { ...(cookie ? { cookie } : {}) } });

  const decision = await resolveExistingStudy({ get, del }, CHESS_OPENINGS_STUDY_NAME, {
    replace: args.replace === true,
  });
  if (decision.action === 'skip') return;

  const [first, ...rest] = chapters;
  const createResponse = await post('/api/studies', {
    name: CHESS_OPENINGS_STUDY_NAME,
    description:
      'Opening positions from the Lichess database (1600-2200 players, 500,000+ games each) where the most played move loses winning chances against the engine at 20,000,000 nodes, confirmed by a second search. Each chapter: the club move with its share, the masters’ top move by era, and the engine’s line. Companion to the write-up on brianhliou.com.',
    visibility,
    chapter: first,
  });
  if (!createResponse.ok) {
    throw new Error(`create study failed: ${createResponse.status} ${await createResponse.text()}`);
  }
  const created = (await createResponse.json()) as { study: { id: string } };
  console.log(`created study ${created.study.id} (${visibility})`);
  for (const [index, chapter] of rest.entries()) {
    const response = await post(`/api/studies/${created.study.id}/chapters`, chapter);
    if (!response.ok) {
      throw new Error(
        `chapter ${index + 2} (${chapter.name}) failed: ${response.status} ${await response.text()}`,
      );
    }
  }
  console.log(
    `done: ${chapters.length} chapters at ${base.replace(':3001', ':3000')}/study/${created.study.id}`,
  );
}

const invokedDirectly = process.argv[1]?.endsWith('seed-chess-openings-study.ts');
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
