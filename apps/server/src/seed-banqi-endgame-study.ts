/**
 * Seed the banqi endgame study: chariot and horse (black) against chariot, horse
 * and soldier (red), every piece face up, red to move. The tablebase
 * (apps/web/public/tablebase/banqi, written by
 * scripts/banqi-tablebase/endgame-table.ts --export) says red wins in 67
 * moves, but the first capture comes after 44 moves, so banqi's 40-move rule draws
 * it over the board.
 *
 * Every line is read from the shipped tables (packages/game
 * banqi-endgame-tablebase.ts) and REPLAYED through the kernel before it is
 * written, so the chapter can never carry a move the study board would refuse.
 * The study board plays on past the 40-move clock (BANQI_STUDY_MOVE_OPTIONS),
 * so the whole 67-move win is one chapter, with a comment at move 40 where a
 * real game would have ended.
 *
 * The study is about the 40-move rule banqi played under until 2026-10-17 (now
 * 60), so it grades against LEGACY_BANQI_NO_PROGRESS_PLY_LIMIT explicitly. Under
 * 60 this win (first capture at move 44) would not be a draw. Note the study
 * board's own tablebase panel judges a parsed position by the current 60.
 *
 * Local dev only (dev sign-in codes): it refuses any base that is not
 * localhost.
 *
 *   npx tsx apps/server/src/seed-banqi-endgame-study.ts \
 *     --email you@example.com [--base http://127.0.0.1:3001] \
 *     [--visibility public|unlisted|private] [--replace] [--dry-run]
 *
 * `--out <file>` writes the study's name, description and chapter as JSON
 * instead, for a `study:edit` plan (how the prod copy is made and replaced).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import {
  applyBanqiMove,
  BANQI_STUDY_MOVE_OPTIONS,
  type BanqiGameState,
  type BanqiMove,
  type BanqiPiece,
  type BanqiTablebaseAnswer,
  type BanqiTablebaseRow,
  type BanqiTablebaseTable,
  banqiStateToEngineFen,
  banqiTablebaseTableFromBytes,
  banqiTablebaseUrl,
  isBanqiLegalMove,
  LEGACY_BANQI_NO_PROGRESS_PLY_LIMIT,
  parseBanqiFen,
  readBanqiTablebase,
} from '@mistboard/game';
import { resolveExistingStudy } from './seed-study-idempotency.js';

const ROOT_FEN = '8/7R/hS6/2H4r r - 0 1';
const STUDY_NAME = 'Banqi endgame: chariot and horse against chariot, horse and soldier';
const STUDY_DESCRIPTION =
  'An exact banqi endgame, solved by a tablebase: red wins in 67 moves, but the first capture comes after 44 moves, so banqi’s old 40-move rule drew it over the board; Mistboard now allows 60. The whole win in one line, with a note where the old clock ran out and a position where only one move keeps it.';

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), '../../web/public');
const tables = new Map<string, BanqiTablebaseTable>();
function table(key: string): BanqiTablebaseTable | undefined {
  const known = tables.get(key);
  if (known) return known;
  const bytes = gunzipSync(readFileSync(`${PUBLIC}${banqiTablebaseUrl(key)}`));
  const parsed = banqiTablebaseTableFromBytes(key, new Uint8Array(bytes));
  if (!parsed) throw new Error(`${key}: table has the wrong length`);
  tables.set(key, parsed);
  return parsed;
}

function stateOf(fen: string): BanqiGameState {
  const parsed = parseBanqiFen(fen);
  if (!parsed.ok) throw new Error(`${fen}: ${parsed.error}`);
  return parsed.state;
}

/** The tablebase answer. `clock: false` grades moves by the result alone, with
 *  no 40-move tags, which is how the study line is chosen. */
function answerOf(state: BanqiGameState, clock = true): BanqiTablebaseAnswer {
  const answer = readBanqiTablebase(
    state,
    table,
    clock ? LEGACY_BANQI_NO_PROGRESS_PLY_LIMIT : Number.POSITIVE_INFINITY,
  );
  if (!answer) throw new Error(`${banqiStateToEngineFen(state)}: not covered`);
  return answer;
}

/** Best play under the tablebase: the winner takes the fastest win, the loser
 *  the slowest loss (rows are sorted that way), and a draw stays a draw. */
function bestRow(answer: BanqiTablebaseAnswer): BanqiTablebaseRow {
  const row = answer.rows[0];
  if (!row) throw new Error('no legal moves');
  return row;
}

type Step = {
  move: BanqiMove;
  row: BanqiTablebaseRow;
  before: BanqiGameState;
  after: BanqiGameState;
};

/** Play best moves from `start` until the game ends or `maxPlies` is reached,
 *  through the kernel as the study board runs it (no 40-move clock). */
function bestLine(start: BanqiGameState, maxPlies = 200): Step[] {
  const steps: Step[] = [];
  let state = start;
  while (state.status.type === 'playing' && steps.length < maxPlies) {
    const row = bestRow(answerOf(state, false));
    const step = play(state, row);
    steps.push(step);
    state = step.after;
  }
  return steps;
}

function play(state: BanqiGameState, row: BanqiTablebaseRow): Step {
  const move = { from: row.move.from, to: row.move.to };
  if (state.status.type !== 'playing' || !isBanqiLegalMove(state, move)) {
    throw new Error(`${move.from}${move.to} is not legal in ${banqiStateToEngineFen(state)}`);
  }
  return { move, row, before: state, after: applyBanqiMove(state, move, BANQI_STUDY_MOVE_OPTIONS) };
}

function pieceName(piece: BanqiPiece): string {
  return `${piece.color === 'black' ? "black's" : "red's"} ${piece.role}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function ink(color: string): string {
  return color === 'black' ? 'Black' : 'Red';
}

function captureText(step: Step): string {
  const mover = step.before.board[step.move.from];
  const taken = step.before.board[step.move.to];
  if (!mover || !taken) return '';
  return `${pieceName(mover)} takes ${pieceName(taken)}`;
}

type SerializedNode = {
  uci?: string;
  annotations?: { comments?: { text: string }[] };
  children: SerializedNode[];
};

/** A mainline from the steps, with comments keyed by ply index (0 = first move). */
function chain(
  steps: readonly Step[],
  comments: ReadonlyMap<number, string> = new Map(),
  sidelines: ReadonlyMap<number, SerializedNode[]> = new Map(),
): SerializedNode[] {
  let next: SerializedNode | null = null;
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i] as Step;
    const comment = comments.get(i);
    const node: SerializedNode = {
      uci: `${step.move.from}${step.move.to}`,
      ...(comment ? { annotations: { comments: [{ text: comment }] } } : {}),
      children: [...(next ? [next] : []), ...(sidelines.get(i + 1) ?? [])],
    };
    next = node;
  }
  return [...(next ? [next] : []), ...(sidelines.get(0) ?? [])];
}

/** Comments on each capture in a line: who took what, and what is left. */
function captureComments(steps: readonly Step[]): Map<number, string> {
  const out = new Map<number, string>();
  steps.forEach((step, i) => {
    if (!step.row.capture) return;
    // No move number: the comment sits on the move, and the move list numbers
    // pairs of turns, so a turn count would point at the wrong row.
    const text = capitalize(captureText(step));
    if (step.after.status.type !== 'playing') {
      const loser = step.before.board[step.move.to]?.color ?? 'black';
      const left = Object.values(step.after.board).some((piece) => piece?.color === loser);
      out.set(
        i,
        `${text}, and ${loser} has ${left ? 'no move' : 'nothing'} left. ${ink(loser === 'black' ? 'red' : 'black')} wins.`,
      );
      return;
    }
    const after = answerOf(step.after, false);
    const verdict =
      after.result === 'draw'
        ? 'The position is a draw.'
        : `${ink(after.result === 'win' ? after.moverInk : after.moverInk === 'black' ? 'red' : 'black')} wins in ${after.dtm} more.`;
    out.set(i, `${text}. The move clock starts again. ${verdict}`);
  });
  return out;
}

function buildChapter() {
  const limit = LEGACY_BANQI_NO_PROGRESS_PLY_LIMIT;
  const root = stateOf(ROOT_FEN);
  const rootAnswer = answerOf(root);
  if (rootAnswer.dtm !== 67 || rootAnswer.dtz !== 45 || !rootAnswer.clockDraw) {
    throw new Error(`root moved: dtm ${rootAnswer.dtm}, dtz ${rootAnswer.dtz}`);
  }
  const rootWins = rootAnswer.rows.filter((row) => row.result === 'win').length;

  const line = bestLine(root);
  const end = line.at(-1)?.after.status;
  if (end?.type !== 'finished' || end.winner === null || line.length !== rootAnswer.dtm) {
    throw new Error(
      `the line ends after ${line.length} moves, not in a ${rootAnswer.dtm}-move win`,
    );
  }
  const firstCapture = line.findIndex((step) => step.row.capture);
  if (firstCapture < limit)
    throw new Error(`a capture on move ${firstCapture + 1}, inside the clock`);
  // The study description names this number.
  if (firstCapture + 1 !== 44) throw new Error(`the first capture moved to ${firstCapture + 1}`);
  const comments = captureComments(line);

  // Move 40: where a real game ends.
  const atClock = line[limit - 1] as Step;
  const clockAnswer = answerOf(atClock.after, false);
  comments.set(
    limit - 1,
    `${limit} moves without a capture: under the old 40-move rule a real game ended here as a draw. Banqi on Mistboard now allows 60, and the study board plays on to show the rest of the win. Red still wins in ${clockAnswer.dtm} more moves, and the first capture comes ${firstCapture + 1 - limit} moves later.`,
  );

  // The first position on the line where exactly one move keeps the win.
  const pickIndex = line.findIndex((step, i) => {
    if (i < 2 || step.row.capture) return false;
    const answer = answerOf(step.before, false);
    return (
      answer.result === 'win' &&
      answer.rows.length >= 6 &&
      answer.rows.filter((row) => row.result === 'win').length === 1
    );
  });
  const pick = line[pickIndex];
  if (!pick) throw new Error('no position on the line with a single winning move');
  const pickAnswer = answerOf(pick.before, false);
  const others = pickAnswer.rows.slice(1);
  const runnerUp = others[0];
  const sidelines = new Map<number, SerializedNode[]>();
  if (runnerUp) {
    const verdict = runnerUp.result === 'draw' ? 'only draws' : `loses, in ${runnerUp.dtm}`;
    sidelines.set(pickIndex, [
      {
        uci: `${runnerUp.move.from}${runnerUp.move.to}`,
        annotations: {
          comments: [
            {
              text: `The best of the other ${others.length} moves, and it ${verdict}. Every move but ${pick.move.from}-${pick.move.to} lets black hold.`,
            },
          ],
        },
        children: [],
      },
    ]);
  }
  const before = comments.get(pickIndex - 1);
  const prompt = `Red to move has ${pickAnswer.rows.length} legal moves here and exactly one keeps the win. Find it before looking at the Tablebase pane.`;
  comments.set(pickIndex - 1, before ? `${before} ${prompt}` : prompt);
  comments.set(
    pickIndex,
    `The only winning move. Red wins in ${(pickAnswer.dtm ?? 1) - 1} more moves from here.`,
  );

  const chapter = {
    name: 'The long win',
    variant: 'banqi' as const,
    orientation: 'red' as const,
    root: {
      version: 1 as const,
      rootFen: ROOT_FEN,
      root: {
        annotations: {
          comments: [
            {
              text: `Red has chariot, horse and soldier against black's chariot and horse, all face up, red to move. Red wins in ${rootAnswer.dtm} moves (each player's turn counts as one), and only ${rootWins} of the ${rootAnswer.rows.length} moves keep it. The first capture comes after ${firstCapture + 1} moves, so banqi’s old 40-move rule drew this over the board; Mistboard now draws at 60, which leaves room for the whole win. Red's soldier takes only generals and soldiers, so here it just blocks squares.`,
            },
          ],
        },
        children: chain(line, comments, sidelines),
      },
    },
  };

  return {
    chapter,
    facts: {
      rootDtm: rootAnswer.dtm,
      rootDtz: rootAnswer.dtz,
      rootWins: `${rootWins}/${rootAnswer.rows.length}`,
      moves: line.length,
      firstCapture: firstCapture + 1,
      onlyMove: pickIndex + 1,
      onlyMoveFen: banqiStateToEngineFen(pick.before),
      onlyMoveAnswer: `${pick.move.from}-${pick.move.to}`,
    },
  };
}

function parseArgs(): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (!arg.startsWith('--')) continue;
    const next = args[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out[arg.slice(2)] = next;
      i += 1;
    } else {
      out[arg.slice(2)] = true;
    }
  }
  return out;
}

class Session {
  private cookie = '';
  constructor(private readonly base: string) {}

  private headers(json = false): Record<string, string> {
    return {
      ...(json ? { 'content-type': 'application/json' } : {}),
      ...(this.cookie ? { cookie: this.cookie } : {}),
    };
  }

  get(path: string): Promise<Response> {
    return fetch(`${this.base}${path}`, { headers: this.headers() });
  }

  del(path: string): Promise<Response> {
    return fetch(`${this.base}${path}`, { method: 'DELETE', headers: this.headers() });
  }

  async post(path: string, body: unknown): Promise<Response> {
    const response = await fetch(`${this.base}${path}`, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify(body),
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0] ?? this.cookie;
    return response;
  }

  async signIn(email: string): Promise<void> {
    const start = await this.post('/api/auth/email/start', { email });
    if (!start.ok) throw new Error(`auth start failed: ${start.status} ${await start.text()}`);
    const started = (await start.json()) as { loginId?: string; devCode?: string };
    if (!started.loginId || !started.devCode) {
      throw new Error(
        'auth start returned no dev code: this seeder runs against a dev server only',
      );
    }
    const confirm = await this.post('/api/auth/email/confirm', {
      loginId: started.loginId,
      code: started.devCode,
    });
    if (!confirm.ok)
      throw new Error(`auth confirm failed: ${confirm.status} ${await confirm.text()}`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs();
  const base = typeof args.base === 'string' ? args.base : 'http://127.0.0.1:3001';
  const visibility = typeof args.visibility === 'string' ? args.visibility : 'unlisted';
  const { chapter, facts } = buildChapter();
  console.log(JSON.stringify(facts));
  if (typeof args.out === 'string') {
    const study = { name: STUDY_NAME, description: STUDY_DESCRIPTION, chapter };
    writeFileSync(args.out, `${JSON.stringify(study, null, 2)}\n`);
    console.log(`wrote ${args.out}`);
    return;
  }
  if (args['dry-run'] === true) {
    const say = (n: SerializedNode, at: number) => {
      for (const comment of n.annotations?.comments ?? []) console.log(`  [${at}] ${comment.text}`);
      for (const [i, child] of n.children.entries()) {
        if (i > 0) console.log(`  (sideline at ${at + 1}: ${child.uci})`);
        say(child, at + 1);
      }
    };
    if (args.comments === true) say(chapter.root.root as SerializedNode, 0);
    return;
  }
  const host = new URL(base).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error(`refusing ${base}: this seeder writes to a local dev server only`);
  }
  const email = args.email;
  if (typeof email !== 'string') throw new Error('--email is required');

  const session = new Session(base);
  await session.signIn(email);
  const decision = await resolveExistingStudy(
    { get: (path) => session.get(path), del: (path) => session.del(path) },
    STUDY_NAME,
    { replace: args.replace === true },
  );
  if (decision.action === 'skip') return;

  const created = await session.post('/api/studies', {
    name: STUDY_NAME,
    description: STUDY_DESCRIPTION,
    visibility,
    chapter,
  });
  if (!created.ok)
    throw new Error(`create study failed: ${created.status} ${await created.text()}`);
  const studyId = ((await created.json()) as { study: { id: string } }).study.id;
  const webBase = base.replace(/:(\d+)$/, (_, port: string) => `:${Number(port) - 1}`);
  console.log(`created ${webBase}/study/${studyId}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
