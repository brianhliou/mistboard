/**
 * Seed the "deep puzzles" chess study: positions from real Lichess games where
 * the server's 1,000,000-node analysis approved the move played and a
 * 20,000,000-node search calls it a mistake or blunder against a unique best
 * move. One chapter per puzzle, in the champions-study shape
 * (seed-xiangqi-champions-study.ts): the root is the position, the mainline is
 * the GAME (the move played, then the deep continuation), and every judged
 * move on it carries the glyph (`?!` / `?` / `??`, NAG 6 / 2 / 4), the shared
 * judgment comment ("mistake: 12.3 win% given up, eval +1.20 after. ..."), and
 * the engine's line as a sibling sideline with a verdict glyph (±, −+, ...) on
 * its last node. The puzzle move is the first of those. The embed shows the
 * mainline with the badge; the study page shows the sidelines, which are the
 * solutions. Every line is replayed through the chess kernel before it is
 * written, so a chapter can never carry a move the board would reject.
 *
 * Input: results/puzzles-r-lines.json from chess-companion/experiments/
 * shallow-labels (puzzles.py list --json, then sweep_lines.py: 20M nodes,
 * MultiPV 3, one search per position along the game line). Study-only chess:
 * see CHESS_SPEC_ID in packages/game/src/game-specs.ts.
 *
 * Usage (local dev, server on 3001):
 *   npx tsx apps/server/src/seed-chess-puzzles-study.ts \
 *     --puzzles <path to puzzles-r.json> --email you@example.com \
 *     [--base http://127.0.0.1:3001] [--visibility public|unlisted|private] [--replace]
 *
 * Against a real server, supply a browser session instead of --email:
 *   MISTBOARD_SESSION_COOKIE='mistboard_session=...' npx tsx ... --base https://mistboard.com
 * The cookie is a live credential: read from the environment, never logged.
 */
import { readFileSync } from 'node:fs';
import {
  type GameState,
  judgmentComment,
  type Move,
  moveJudgment,
  type PieceRole,
  parseStandardChessFen,
  type Square,
  standardChessSan,
  standardChessVariant,
  winPercent,
} from '@mistboard/game';
import { resolveExistingStudy } from './seed-study-idempotency.js';

export const CHESS_PUZZLES_STUDY_NAME = 'Deep puzzles: what the analysis missed';

type Puzzle = {
  player: string;
  game_id: string;
  ply: number;
  mover: 'white' | 'black';
  speed: string;
  white: string;
  black: string;
  date: string;
  fen_full: string;
  played: string;
  played_uci: string;
  best_san: string;
  lichess_before: number;
  lichess_after: number;
  deep_best: number;
  deep_second: number;
  deep_after: number;
  drop: number;
  forcing: boolean;
  second_san: string;
  best_pv_uci: string[];
  played_pv_uci: string[];
  /** From sweep_lines.py: the game continuation actually searched, and one
   *  MultiPV-3 search per position along it (index 0 = the puzzle position). */
  game_line: string[];
  positions: { fen: string; lines: EngineLine[] }[];
};

type EngineLine = { cp: number | null; mate: number | null; pv: string[] };

type ChapterPayload = {
  name: string;
  variant: 'chess';
  orientation: 'red' | 'black';
  tags: Record<string, string>;
  root: { version: 1; rootFen: string; root: SerializedNode };
};

type SerializedNode = {
  uci?: string;
  annotations?: { comments?: { text: string }[]; glyphs?: number[] };
  children: SerializedNode[];
};

/** PGN assessment NAG for a white-POV eval (apps/web/src/assessment-glyphs.ts
 *  renders 10 '=', 14 '⩲', 15 '⩱', 16 '±', 17 '∓', 18 '+−', 19 '−+'). A mate is
 *  decisive for whoever delivers it. */
function assessmentNag(line: EngineLine): number {
  if (line.mate != null) return line.mate > 0 ? 18 : 19;
  const cp = line.cp ?? 0;
  const a = Math.abs(cp);
  if (a < 30) return 10;
  if (a < 70) return cp > 0 ? 14 : 15;
  if (a < 150) return cp > 0 ? 16 : 17;
  return cp > 0 ? 18 : 19;
}

const NAG: Record<string, number> = { blunder: 4, mistake: 2, inaccuracy: 6 };

/** Mover-POV win% of a white-POV engine line. */
function moverWin(line: EngineLine, mover: 'white' | 'black'): number {
  const w = winPercent(line.cp, line.mate);
  return mover === 'white' ? w : 100 - w;
}

function evalText(line: EngineLine): string {
  if (line.mate != null) return `mate in ${Math.abs(line.mate)}`;
  return pawns(line.cp ?? 0);
}

const PLAYER_NAMES: Record<string, string> = {
  'magnus-carlsen': 'Magnus Carlsen',
  'alireza-firouzja': 'Alireza Firouzja',
  'eric-rosen': 'Eric Rosen',
  'jerry-chessnetwork': 'Jerry (ChessNetwork)',
  'oleksandr-bortnyk': 'Oleksandr Bortnyk',
  'sergei-zhigalko': 'Sergei Zhigalko',
  'dmitry-andreikin': 'Dmitry Andreikin',
  'ediz-gurel': 'Ediz Gürel',
  'anish-giri': 'Anish Giri',
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

/** Replay a UCI line through the chess kernel from `start`; throw on the first
 *  illegal move so a bad export fails the seed rather than a reader's board. */
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

function chain(
  line: string[],
  leaf: { comment?: string; glyphs?: number[] } = {},
): SerializedNode | null {
  let child: SerializedNode | null = null;
  for (const [index, uci] of [...line.entries()].reverse()) {
    const isLeaf = index === line.length - 1;
    const annotations = isLeaf
      ? {
          ...(leaf.comment ? { comments: [{ text: leaf.comment }] } : {}),
          ...(leaf.glyphs?.length ? { glyphs: leaf.glyphs } : {}),
        }
      : {};
    child = {
      uci,
      ...(Object.keys(annotations).length ? { annotations } : {}),
      children: child ? [child] : [],
    };
  }
  return child;
}

const pawns = (cp: number): string => `${cp >= 0 ? '+' : ''}${(cp / 100).toFixed(2)}`;

export function chapterPayload(p: Puzzle): ChapterPayload | null {
  const parsed = parseStandardChessFen(p.fen_full, `seed-${p.game_id}-${p.ply}`);
  if (!parsed.ok) throw new Error(`${p.game_id}#${p.ply}: ${parsed.error}`);
  const start = parsed.state;
  const name = PLAYER_NAMES[p.player] ?? p.player;
  const moveNo = `${Math.floor(p.ply / 2) + 1}.${p.mover === 'white' ? '' : '..'}`;
  const points = Math.round(p.drop * 50);
  const verdict = p.drop >= 0.3 ? 'a blunder' : 'a mistake';
  const playedSan = standardChessSan(start, uciToMove(p.played_uci));

  const prompt =
    `${name} to move, ${p.mover === 'white' ? 'White' : 'Black'}. Lichess's analysis gave the ` +
    `move played no mark (${pawns(p.lichess_before)} before, ${pawns(p.lichess_after)} after). ` +
    `A 20-million-node search calls it ${verdict}, ${points} win-chance points against a best ` +
    `move that is unique. Find it before opening the sideline.`;

  // The game line, one node per ply, each judged against the search from its
  // own position: the played move's own MultiPV line when the search ranked
  // it (same root, so no odd/even noise between two searches), else the eval
  // of the position after it, which is lila's consecutive-eval rule at 20M
  // instead of 1M. A judged move gets the engine's line as a sibling.
  const gameLine = verifiedLine(`${p.game_id} game`, start, p.game_line);
  if (!gameLine.length) throw new Error(`${p.game_id}#${p.ply}: empty game line`);
  let state = start;
  const nodes: SerializedNode[] = [];
  const siblings: (SerializedNode | null)[] = [];
  for (const [i, uci] of gameLine.entries()) {
    const before = p.positions[i]?.lines[0];
    const ownLine = p.positions[i]?.lines.find((line) => line.pv[0] === uci);
    const after = ownLine ?? p.positions[i + 1]?.lines[0];
    const mover = state.status.type === 'playing' ? state.status.turn : 'white';
    let annotations: SerializedNode['annotations'] | undefined;
    let sibling: SerializedNode | null = null;
    if (before && after && before.pv[0] && before.pv[0] !== uci) {
      const winBefore = moverWin(before, mover);
      const winAfter = moverWin(after, mover);
      const judgment = moveJudgment(winBefore, winAfter);
      if (judgment) {
        const lost = (winBefore - winAfter).toFixed(1);
        const line = verifiedLine(`${p.game_id} pv${i}`, state, before.pv);
        sibling = line.length ? chain(line, { glyphs: [assessmentNag(before)] }) : null;
        const comment =
          i === 0
            ? `The game move. Lichess: ${pawns(p.lichess_before)} to ${pawns(p.lichess_after)}, ` +
              `no label. At 20M nodes: ${judgment}, ${lost} win% given up, ${points} points worse ` +
              `than ${p.best_san}.`
            : judgmentComment({
                judgment,
                lost,
                evalText: evalText(after),
                hasLine: sibling != null,
              });
        annotations = { glyphs: [NAG[judgment]!], comments: [{ text: comment }] };
        if (sibling) {
          // The sideline's first move is the engine's pick: `!`, and its own
          // numbers so the solution reads without the panel.
          const second = p.positions[i]?.lines[1];
          sibling.annotations = {
            ...(sibling.annotations ?? {}),
            glyphs: [1, ...(sibling.annotations?.glyphs ?? [])],
            comments: [
              {
                text:
                  `${evalText(before)} at 20M nodes` +
                  (second ? `, against ${evalText(second)} for the second choice` : '') +
                  `; ${evalText(after)} after the game move.`,
              },
            ],
          };
        }
      }
    }
    nodes.push({ uci, ...(annotations ? { annotations } : {}), children: [] });
    siblings.push(sibling);
    const move = uciToMove(uci);
    const legal = standardChessVariant
      .getLegalMoves(state, state.status.type === 'playing' ? state.status.turn : 'white')
      .find((m) => m.from === move.from && m.to === move.to && m.promotion === move.promotion);
    if (!legal) break;
    state = standardChessVariant.applyMove(state, legal);
  }
  // Link the chain: each node's children are [next game move, engine sideline].
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const next = nodes[i + 1];
    const sib = siblings[i + 1];
    nodes[i]!.children = [...(next ? [next] : []), ...(sib ? [sib] : [])];
  }
  const rootChildren: SerializedNode[] = [nodes[0]!, ...(siblings[0] ? [siblings[0]] : [])];
  // The sweep is a second, independent 20M search of the puzzle position. A
  // puzzle whose game move it no longer judges did not survive re-analysis and
  // is dropped rather than published on one search's say-so.
  if (!siblings[0]) return null;

  return {
    name: `${name}: ${moveNo}${playedSan}? (${p.speed}, ${p.date})`,
    variant: 'chess' as const,
    orientation: p.mover === 'white' ? ('red' as const) : ('black' as const),
    tags: {
      red: p.white,
      black: p.black,
      event: `Lichess ${p.speed}, ${p.date}`,
      site: `https://lichess.org/${p.game_id}#${p.ply}`,
      result: '*',
    },
    root: {
      version: 1 as const,
      rootFen: p.fen_full,
      root: {
        annotations: { comments: [{ text: prompt }] },
        children: rootChildren,
      },
    },
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const base = typeof args.base === 'string' ? args.base : 'http://127.0.0.1:3001';
  const puzzlesPath = typeof args.puzzles === 'string' ? args.puzzles : null;
  const email = typeof args.email === 'string' ? args.email : null;
  const visibility = typeof args.visibility === 'string' ? args.visibility : 'public';
  if (!puzzlesPath) {
    console.error('--puzzles <json> is required');
    process.exitCode = 1;
    return;
  }
  const puzzles = JSON.parse(readFileSync(puzzlesPath, 'utf8')) as Puzzle[];
  // Forcing solutions first, then by how much the game move gave up; that is
  // the order the blog presents them in, and the study should read the same.
  puzzles.sort((a, b) => Number(b.forcing) - Number(a.forcing) || b.drop - a.drop);
  const chapters: ChapterPayload[] = [];
  for (const puzzle of puzzles) {
    const chapter = chapterPayload(puzzle);
    if (chapter) chapters.push(chapter);
    else console.warn(`  dropped ${puzzle.game_id}#${puzzle.ply}: not a mistake on re-analysis`);
  }
  console.log(`${chapters.length} of ${puzzles.length} chapters verified against the chess kernel`);

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

  const decision = await resolveExistingStudy({ get, del }, CHESS_PUZZLES_STUDY_NAME, {
    replace: args.replace === true,
  });
  if (decision.action === 'skip') return;

  const [first, ...rest] = chapters;
  const createResponse = await post('/api/studies', {
    name: CHESS_PUZZLES_STUDY_NAME,
    description:
      'Positions from real Lichess games where the server analysis (1,000,000 nodes a move) approved the move played and a 20,000,000-node search calls it a mistake or blunder against a unique best move. Companion to the write-up on brianhliou.com.',
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

const invokedDirectly = process.argv[1]?.endsWith('seed-chess-puzzles-study.ts');
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
