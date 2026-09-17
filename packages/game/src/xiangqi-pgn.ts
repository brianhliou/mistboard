// PGN reader for standard xiangqi.
//
// PGN is a WRAPPER, not a notation. The movetext inside it can be in any of the
// five notations xiangqi-import.ts already decodes (Western PGN exports carry
// coordinates or WXF; Chinese tooling carries 炮二平五). So this module owns only
// the wrapper — tag pairs, comments, variations, NAGs, move numbers, the result
// token, and multi-game files — and hands the bare movetext to the existing
// legality-guided sniffer to pick the notation.
//
// Why a TREE and not a move list: a PGN variation is a branch, and a study
// chapter is a branching tree. Flattening to the mainline would throw away
// exactly the part a repertoire author cares about. The cost is that a
// variation's tokens must resolve against the position at its BRANCH POINT, not
// the mainline, which is why the sniffer runs once on the mainline to fix the
// notation and every other node is then decoded one token at a time in that
// format (resolveXiangqiMoveInFormat).

import {
  createInitialXiangqiState,
  type XiangqiGameState,
  type XiangqiMove,
} from './variants-xiangqi.js';
import { applyStandardXiangqiMove } from './variants-xiangqi-standard.js';
import {
  importXiangqiGame,
  resolveXiangqiMoveInFormat,
  type XiangqiMoveFormat,
} from './xiangqi-import.js';
import { formatXiangqiMove, type XiangqiNotationStyle } from './xiangqi-notation-format.js';
import { parseStandardXiangqiFen, standardXiangqiFen } from './xiangqi-position.js';

/** Standard PGN result tokens. `*` means unknown/ongoing. */
export type XiangqiPgnResult = '1-0' | '0-1' | '1/2-1/2' | '*';

export interface XiangqiPgnNode {
  move: XiangqiMove;
  /** The token as written, kept so an importer can show the author's own
   *  notation rather than our canonical coordinates. */
  token: string;
  comment?: string;
  /** Numeric Annotation Glyphs, including the ones we fold in from `!`/`?`
   *  suffixes so both spellings land in one place. */
  nags: number[];
  /** children[0] is the mainline continuation; the rest are variations, in the
   *  order they appeared. */
  children: XiangqiPgnNode[];
}

export interface XiangqiPgnGame {
  tags: Record<string, string>;
  result: XiangqiPgnResult;
  /** Comment before the first move, if any. */
  comment?: string;
  children: XiangqiPgnNode[];
  /** The notation the movetext turned out to be written in. */
  format: XiangqiMoveFormat | null;
  /** Number of mainline plies that replayed legally. */
  plyCount: number;
  /** Set when the movetext could not be fully read; the tree holds whatever
   *  replayed before the failure, so a partial import is still offerable. */
  error?: string;
}

// `!`/`?` suffixes are the same information as $1-$6 in a different spelling.
// Fold them at parse time so consumers read one field.
const SUFFIX_NAGS: Record<string, number> = {
  '!': 1,
  '?': 2,
  '!!': 3,
  '??': 4,
  '!?': 5,
  '?!': 6,
};

const RESULT_TOKENS = new Set(['1-0', '0-1', '1/2-1/2', '1/2', '*']);
// A move-number ordinal: "12." / "12..." / bare "12". A WXF token like "C2.5"
// starts with a letter and a Chinese one with a CJK char, so neither collides.
const MOVE_NUMBER = /^\d+\.{0,3}$/;
// A PGN tag-pair line: `[Event "…"]`. Used both to split multi-game files and
// to decide whether a failed paste should be reported as a broken PGN or as
// unreadable movetext, so it lives in one place.
const TAG_PAIR_LINE = /^\s*\[\s*[A-Za-z][A-Za-z0-9_]*\s+"/;

interface RawNode {
  token: string;
  comment?: string;
  nags: number[];
  children: RawNode[];
}

/** Read a PGN file into one entry per game. Never throws: an unreadable game
 *  comes back with `error` set so a multi-game import can report per game
 *  instead of failing the whole file. */
export function parseXiangqiPgn(input: string): XiangqiPgnGame[] {
  return splitGames(input).map(readGame);
}

// --- splitting a multi-game file ---------------------------------------------
// A new game starts at a tag pair that follows movetext. Tracking that
// transition is enough; PGN has no explicit game separator.

function splitGames(input: string): string[] {
  const lines = input.split(/\r?\n/);
  const games: string[] = [];
  let current: string[] = [];
  let sawMovetext = false;
  for (const line of lines) {
    const isTag = TAG_PAIR_LINE.test(line);
    if (isTag && sawMovetext) {
      games.push(current.join('\n'));
      current = [];
      sawMovetext = false;
    }
    if (!isTag && line.trim().length > 0) sawMovetext = true;
    current.push(line);
  }
  if (current.join('').trim().length > 0) games.push(current.join('\n'));
  return games.filter((game) => game.trim().length > 0);
}

// --- tags ---------------------------------------------------------------------

function readTags(input: string): { tags: Record<string, string>; movetext: string } {
  const tags: Record<string, string> = {};
  const tagLine = /^\s*\[\s*([A-Za-z][A-Za-z0-9_]*)\s+"((?:[^"\\]|\\.)*)"\s*\]\s*$/;
  const rest: string[] = [];
  let inMovetext = false;
  for (const line of input.split(/\r?\n/)) {
    if (!inMovetext) {
      const match = line.match(tagLine);
      if (match) {
        tags[match[1]!] = match[2]!.replace(/\\(["\\])/g, '$1');
        continue;
      }
      if (line.trim().length === 0) continue;
      inMovetext = true;
    }
    rest.push(line);
  }
  return { tags, movetext: rest.join('\n') };
}

// --- movetext tokenizer + tree builder ---------------------------------------

interface Tokenizer {
  text: string;
  pos: number;
}

/** One move as written, with the annotations and variations attached to it. A
 *  variation is an ALTERNATIVE to this move, so it branches from the position
 *  before it — which is why it is parked on the step rather than on the tree. */
interface Step {
  token: string;
  comment?: string;
  nags: number[];
  variations: Step[][];
}

function readComment(tk: Tokenizer): string {
  // `{...}` does not nest in PGN; the first `}` closes it.
  const end = tk.text.indexOf('}', tk.pos + 1);
  const stop = end === -1 ? tk.text.length : end;
  const body = tk.text.slice(tk.pos + 1, stop);
  tk.pos = end === -1 ? tk.text.length : end + 1;
  return body.trim().replace(/\s+/g, ' ');
}

function readLineComment(tk: Tokenizer): string {
  const end = tk.text.indexOf('\n', tk.pos);
  const body = tk.text.slice(tk.pos + 1, end === -1 ? undefined : end).trim();
  tk.pos = end === -1 ? tk.text.length : end + 1;
  return body;
}

/** Read one flat sequence of moves. Stops at the `)` that closes this depth. */
function readSequence(tk: Tokenizer, depth: number): { steps: Step[]; leadComment?: string } {
  const steps: Step[] = [];
  let leadComment: string | undefined;
  const addComment = (text: string): void => {
    if (text.length === 0) return;
    const target = steps[steps.length - 1];
    if (target) target.comment = target.comment ? `${target.comment} ${text}` : text;
    else leadComment = leadComment ? `${leadComment} ${text}` : text;
  };

  while (tk.pos < tk.text.length) {
    const char = tk.text[tk.pos]!;
    if (/\s/.test(char)) {
      tk.pos += 1;
      continue;
    }
    if (char === '{') {
      addComment(readComment(tk));
      continue;
    }
    if (char === ';') {
      addComment(readLineComment(tk));
      continue;
    }
    if (char === '(') {
      tk.pos += 1;
      const inner = readSequence(tk, depth + 1);
      const target = steps[steps.length - 1];
      // A variation with nothing to be an alternative TO is malformed; drop it
      // rather than silently promoting it to the mainline.
      if (target && inner.steps.length > 0) target.variations.push(inner.steps);
      continue;
    }
    if (char === ')') {
      tk.pos += 1;
      if (depth > 0) return { steps, leadComment };
      continue; // stray close paren: ignore rather than abort the game
    }
    const match = /^[^\s{}();]+/.exec(tk.text.slice(tk.pos));
    if (!match) {
      tk.pos += 1;
      continue;
    }
    const word = match[0]!;
    tk.pos += word.length;

    if (MOVE_NUMBER.test(word)) continue;
    if (RESULT_TOKENS.has(word)) continue;
    if (word.startsWith('$')) {
      const nag = Number(word.slice(1));
      const target = steps[steps.length - 1];
      if (target && Number.isFinite(nag)) target.nags.push(nag);
      continue;
    }
    const { move, nags } = stripSuffixNags(word);
    if (move.length === 0) continue;
    steps.push({ token: move, nags, variations: [] });
  }
  return { steps, leadComment };
}

function stripSuffixNags(word: string): { move: string; nags: number[] } {
  const match = /(\?\?|!!|!\?|\?!|[!?])+$/.exec(word);
  if (!match) return { move: word, nags: [] };
  const suffix = match[0]!;
  const nags: number[] = [];
  for (const part of suffix.match(/\?\?|!!|!\?|\?!|[!?]/g) ?? []) {
    const nag = SUFFIX_NAGS[part];
    if (nag !== undefined) nags.push(nag);
  }
  return { move: word.slice(0, word.length - suffix.length), nags };
}

/** Turn a flat sequence into a sibling list. The first step continues into the
 *  rest of the sequence; its variations become its siblings, because they are
 *  alternatives from the same position. */
function buildNodes(steps: readonly Step[]): RawNode[] {
  const [head, ...rest] = steps;
  if (!head) return [];
  const node: RawNode = {
    token: head.token,
    ...(head.comment ? { comment: head.comment } : {}),
    nags: head.nags,
    children: buildNodes(rest),
  };
  return [node, ...head.variations.flatMap((variation) => buildNodes(variation))];
}

// --- resolution ---------------------------------------------------------------

function readGame(raw: string): XiangqiPgnGame {
  const { tags, movetext } = readTags(raw);
  const tokenizer: Tokenizer = { text: movetext, pos: 0 };
  const parsed = readSequence(tokenizer, 0);
  const spine = buildNodes(parsed.steps);
  const result = readResult(movetext, tags);

  const start = startState(tags);
  if (!start.ok) {
    return {
      tags,
      result,
      comment: parsed.leadComment,
      children: [],
      format: null,
      plyCount: 0,
      error: start.error,
    };
  }

  const mainline = mainlineTokens(spine);
  if (mainline.length === 0) {
    // A position-only chapter is legitimate (an endgame study is a FEN plus
    // prose), so this is a success, not a parse failure.
    return {
      tags,
      result,
      comment: parsed.leadComment,
      children: [],
      format: null,
      plyCount: 0,
    };
  }

  const sniff = importXiangqiGame(mainline.join(' '), { initialState: start.state });
  if (!sniff.format) {
    return {
      tags,
      result,
      comment: parsed.leadComment,
      children: [],
      format: null,
      plyCount: 0,
      error: sniff.error ?? 'Unrecognized move notation.',
    };
  }

  const resolved = resolveNodes(spine, start.state, sniff.format);
  return {
    tags,
    result,
    comment: parsed.leadComment,
    children: resolved.nodes,
    format: sniff.format,
    plyCount: countMainline(resolved.nodes),
    ...(resolved.error ? { error: resolved.error } : {}),
  };
}

function startState(
  tags: Record<string, string>,
): { ok: true; state: XiangqiGameState } | { ok: false; error: string } {
  const fen = tags.FEN?.trim();
  if (!fen) return { ok: true, state: createInitialXiangqiState('pgn-import') };
  const parsed = parseStandardXiangqiFen(fen, 'pgn-import');
  if (!parsed.ok) return { ok: false, error: `Could not read the [FEN] tag: ${fen}` };
  return { ok: true, state: parsed.state };
}

function readResult(movetext: string, tags: Record<string, string>): XiangqiPgnResult {
  const tagged = tags.Result?.trim();
  if (tagged === '1-0' || tagged === '0-1' || tagged === '1/2-1/2' || tagged === '*') {
    return tagged;
  }
  const trailing = movetext.trim().match(/(1-0|0-1|1\/2-1\/2|\*)\s*$/);
  const found = trailing?.[1];
  if (found === '1-0' || found === '0-1' || found === '1/2-1/2') return found;
  return '*';
}

function mainlineTokens(nodes: RawNode[]): string[] {
  const tokens: string[] = [];
  let cursor = nodes[0];
  while (cursor) {
    tokens.push(cursor.token);
    cursor = cursor.children[0];
  }
  return tokens;
}

function countMainline(nodes: XiangqiPgnNode[]): number {
  let count = 0;
  let cursor = nodes[0];
  while (cursor) {
    count += 1;
    cursor = cursor.children[0];
  }
  return count;
}

// Resolve a sibling list against one position. Every sibling is an ALTERNATIVE
// from the same position, so they all replay from `state`.
function resolveNodes(
  nodes: readonly RawNode[],
  state: XiangqiGameState,
  format: XiangqiMoveFormat,
): { nodes: XiangqiPgnNode[]; error?: string } {
  const out: XiangqiPgnNode[] = [];
  let error: string | undefined;
  for (const node of nodes) {
    const move = resolveXiangqiMoveInFormat(node.token, state, format);
    if (!move) {
      // Drop this branch and keep going: one bad variation should not cost the
      // author the rest of the game.
      error ??= `"${node.token}" is not a legal move here.`;
      continue;
    }
    const next = applyStandardXiangqiMove(state, move);
    const children = resolveNodes(node.children, next, format);
    error ??= children.error;
    out.push({
      move,
      token: node.token,
      ...(node.comment ? { comment: node.comment } : {}),
      nags: node.nags,
      children: children.nodes,
    });
  }
  return { nodes: out, ...(error ? { error } : {}) };
}

// --- writing ------------------------------------------------------------------
// The inverse of the reader, sharing its node shape so a round trip is a
// structural identity rather than two hand-kept-in-sync formats. Xiangqi PGN
// names the first player [Red], not [White]; we WRITE Red and READ either,
// because Western tooling emits White for every game it touches.

/** The seven-tag roster, in the order PGN specifies. */
const TAG_ORDER = ['Event', 'Site', 'Date', 'Round', 'Red', 'Black', 'Result'];

export interface XiangqiPgnWriteGame {
  tags?: Record<string, string>;
  result?: XiangqiPgnResult;
  /** Comment before the first move. */
  comment?: string;
  children: readonly XiangqiPgnNode[];
  /** Start position, when it is not the standard opening. Written as [FEN]. */
  initialState?: XiangqiGameState;
}

export interface XiangqiPgnWriteOptions {
  /** Notation for the movetext. Defaults to coordinate, which is the only style
   *  guaranteed to round-trip through our own reader without a legality replay. */
  style?: XiangqiNotationStyle;
  /** The rules the writer replays while spelling a position-relative style
   *  (WXF reads the board before each move): the start position and the step.
   *  Defaults to the standard rules; a variant on the same board with different
   *  capture rules (atomic) hands in its own kernel so every label is written
   *  against the board that variant actually had. `game.initialState` still
   *  wins for the start when a custom position is given. */
  replay?: {
    start: XiangqiGameState;
    apply: (state: XiangqiGameState, move: XiangqiMove) => XiangqiGameState;
  };
}

/** Render one game as PGN text. */
export function writeXiangqiPgn(
  game: XiangqiPgnWriteGame,
  options: XiangqiPgnWriteOptions = {},
): string {
  const style = options.style ?? 'coordinate';
  const replay = options.replay ?? {
    start: createInitialXiangqiState('pgn-export'),
    apply: applyStandardXiangqiMove,
  };
  const start = game.initialState ?? replay.start;
  const custom = game.initialState !== undefined;
  const result = game.result ?? '*';

  const tags: Record<string, string> = { ...game.tags };
  tags.Result = result;
  if (custom) {
    tags.SetUp = '1';
    tags.FEN = standardXiangqiFen(start);
  }

  const lines: string[] = [];
  for (const name of TAG_ORDER) {
    lines.push(tagLine(name, tags[name] ?? defaultTagValue(name, result)));
  }
  for (const [name, value] of Object.entries(tags)) {
    if (!TAG_ORDER.includes(name)) lines.push(tagLine(name, value));
  }

  const body: string[] = [];
  if (game.comment) body.push(`{${game.comment}}`);
  writeNodes(game.children, start, style, plyNumber(start), body, true, replay.apply);
  body.push(result);

  return `${lines.join('\n')}\n\n${wrap(body.join(' '))}\n`;
}

function tagLine(name: string, value: string): string {
  return `[${name} "${value.replace(/[\\"]/g, (char) => `\\${char}`)}"]`;
}

function defaultTagValue(name: string, result: XiangqiPgnResult): string {
  if (name === 'Result') return result;
  // PGN spells an unknown mandatory tag "?"; date has its own placeholder.
  return name === 'Date' ? '????.??.??' : '?';
}

/** 0-based ply index of the start position, so a black-to-move FEN opens on
 *  "1..." rather than silently renumbering the game. */
function plyNumber(state: XiangqiGameState): number {
  return state.status.type === 'playing' && state.status.turn === 'black' ? 1 : 0;
}

function writeNodes(
  nodes: readonly XiangqiPgnNode[],
  state: XiangqiGameState,
  style: XiangqiNotationStyle,
  ply: number,
  out: string[],
  needsNumber: boolean,
  apply: (state: XiangqiGameState, move: XiangqiMove) => XiangqiGameState,
): void {
  const [mainline, ...variations] = nodes;
  if (!mainline) return;

  const red = ply % 2 === 0;
  if (red) out.push(`${Math.floor(ply / 2) + 1}.`);
  else if (needsNumber) out.push(`${Math.floor(ply / 2) + 1}...`);
  out.push(formatXiangqiMove(state, mainline.move, style));
  for (const nag of mainline.nags) out.push(`$${nag}`);
  if (mainline.comment) out.push(`{${mainline.comment}}`);

  // Variations are alternatives to THIS move, so they replay from `state` too
  // and are written before the mainline continues.
  for (const variation of variations) {
    const inner: string[] = [];
    writeNodes([variation], state, style, ply, inner, true, apply);
    out.push(`(${inner.join(' ')})`);
  }

  const next = apply(state, mainline.move);
  // A variation or a comment breaks the reader's implicit numbering, so the
  // black move that follows one has to restate its number.
  const interrupted = variations.length > 0 || mainline.comment !== undefined;
  writeNodes(mainline.children, next, style, ply + 1, out, interrupted, apply);
}

/** Soft-wrap at the PGN export limit so the file reads in a plain editor. */
function wrap(text: string, width = 80): string {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line.length === 0) line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line.length > 0) lines.push(line);
  return lines.join('\n');
}

/** What a paste box actually received: the moves, plus whatever wrapper
 *  metadata came with them. `tags` is empty for bare movetext. */
export interface XiangqiPasteResult {
  moves: XiangqiMove[];
  /** The notation the moves turned out to be written in. */
  format: XiangqiMoveFormat | null;
  /** Set when nothing readable came back; the most useful reason. */
  error?: string;
  /** Which reader handled it. */
  source: 'movetext' | 'pgn';
  /** PGN tag pairs, empty when the input was bare movetext. Metadata has
   *  nowhere to live on the analysis board today, but a caller that mints a
   *  game from a paste needs it, and re-parsing to get it would be silly. */
  tags: Record<string, string>;
  result?: XiangqiPgnResult;
  /** The [FEN] start, when the game does not begin from the standard opening.
   *  A caller that ignores this replays the moves from the wrong position. */
  startFen?: string;
}

/** Read anything a human might paste: bare movetext in any of the five
 *  notations, or a full PGN with a tag block, comments and variations.
 *
 *  Order is load-bearing. The bare sniffer runs FIRST and the PGN reader is the
 *  fallback, not the other way round, because a DhtmlXQ record is a run of
 *  digits and PGN's move-number pattern (`^\d+\.{0,3}$`) matches one whole —
 *  PGN-first would read a valid dpxq paste as a single move number and return
 *  an empty game. Sniffer-first also means every input that worked before this
 *  function existed still takes exactly the path it used to. */
export function importXiangqiPaste(input: string): XiangqiPasteResult {
  const bare = importXiangqiGame(input);
  if (!bare.error && bare.moves.length > 0) {
    return { moves: bare.moves, format: bare.format, source: 'movetext', tags: {} };
  }

  const [game] = parseXiangqiPgn(input);
  if (game && game.plyCount > 0) {
    const startFen = game.tags.FEN?.trim();
    return {
      moves: mainline(game.children),
      format: game.format,
      error: game.error,
      source: 'pgn',
      tags: game.tags,
      result: game.result,
      ...(startFen ? { startFen } : {}),
    };
  }

  // Both readers failed. Report as whichever the input actually looked like, so
  // a malformed PGN says what is wrong with the PGN instead of the generic
  // "unrecognized notation" that a bare-movetext failure deserves.
  if (looksLikePgn(input)) {
    return {
      moves: [],
      format: null,
      error: game?.error ?? 'No moves found in this PGN.',
      source: 'pgn',
      tags: game?.tags ?? {},
    };
  }
  return { moves: [], format: bare.format, error: bare.error, source: 'movetext', tags: {} };
}

/** children[0] is the mainline continuation; variations are the rest. */
function mainline(children: readonly XiangqiPgnNode[]): XiangqiMove[] {
  const moves: XiangqiMove[] = [];
  let node = children[0];
  while (node) {
    moves.push(node.move);
    node = node.children[0];
  }
  return moves;
}

function looksLikePgn(input: string): boolean {
  return input.split(/\r?\n/).some((line) => TAG_PAIR_LINE.test(line));
}

/** Red/Black player names from a tag block, tolerating the White spelling that
 *  chess-shaped tools emit for the first player. PGN spells an unknown value
 *  "?", so a "?" is absent, not a name — without that, a file we exported
 *  ourselves reads back as a game between "?" and "?". */
export function xiangqiPgnPlayers(tags: Record<string, string>): {
  red: string | null;
  black: string | null;
} {
  return {
    red: namedTag(tags.Red) ?? namedTag(tags.White),
    black: namedTag(tags.Black),
  };
}

function namedTag(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed !== '?' ? trimmed : null;
}
