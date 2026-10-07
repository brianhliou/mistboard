// A set of games behind one step card: a picker over every record, the card
// swapping game in place. The records live in a module the article loads on
// demand (anti-xiangqi-games.ts, horde-xiangqi-games.ts), so a hundred games
// cost nothing until the reader scrolls to them. Records carry template keys
// and arguments, never sentences: the English templates sit in the article
// block, where the article translator reaches them.

import type { XiangqiPiece, XiangqiSquare } from '@mistboard/game';
import type { ArticleLang } from './article-i18n.js';
import { createStepCard, type StepCardGame } from './article-step-card.js';
import {
  XQ_BOARD_H,
  XQ_BOARD_W,
  xqBoardSvg,
  xqCoord,
  xqPoint,
  xqSvg,
  xqVisionDemoState,
} from './articles/diagrams.js';
import { glideSvgPiece, pieceAnimationDurationMs } from './board-anim.js';
import { replayStepperCopy } from './replay-stepper-copy.js';
import { xiangqiAppearanceChangedEvent } from './theme.js';

export type GameSetBoard = Partial<Record<XiangqiSquare, XiangqiPiece>>;
/** A template argument: a literal, or ['k', key] for another template. */
export type GameSetArg = number | string | readonly ['k', string];
/** A template key and its %1, %2 ... arguments. */
export type GameSetText = { k: string; a: readonly GameSetArg[] };

export type StepGameSetRecord = {
  id: string;
  /** The picker's option group. */
  group: GameSetText;
  /** The picker's option. */
  label: GameSetText;
  /** The sentence under the picker. */
  result: GameSetText;
  /** A second sentence after it (a template key). */
  extra?: string;
  /** The card's result foot ("Red wins"). */
  verdict: GameSetText;
  red: GameSetText;
  black: GameSetText;
  /** Space-separated coordinate moves, `b3b10`. */
  moves: string;
  /** Space-separated move notation, one per move; without it the sheet shows from-to. */
  san?: string;
  /** Veteran soldiers: the crossed soldier art (horde). */
  veteran?: boolean;
  /** A start placement, when the set's games start from different arrays. */
  start?: string;
  /** The no-capture clock the game was played under. */
  clock?: number;
};

export type StepGameSet = {
  records: readonly StepGameSetRecord[];
  /** The start every record replays from by moving the piece on `from` to
   *  `to` (the generator checked that against the kernel, every ply). */
  start?: GameSetBoard;
  /** Or the positions after each ply, 0 the start, from the set's own kernel. */
  replay?: (record: StepGameSetRecord) => GameSetBoard[];
  /** The record the card opens on; default the first. */
  open?: string;
};

export type StepGameSetModule = { GAME_SET: StepGameSet };

export type StepGameSetController = { destroy: () => void };

const SQUARES = /^([a-i](?:10|[1-9]))([a-i](?:10|[1-9]))$/;

export function splitGameSetMove(token: string): { from: XiangqiSquare; to: XiangqiSquare } {
  const m = SQUARES.exec(token);
  if (!m) throw new Error(`game set: bad move "${token}"`);
  return { from: m[1] as XiangqiSquare, to: m[2] as XiangqiSquare };
}

/** Fill a record's templates: %n takes the nth argument, a ['k', key]
 *  argument is itself a template. A missing template shows its key. */
export function gameSetText(text: GameSetText, strings: Record<string, string>): string {
  const template = strings[text.k] ?? text.k;
  return template.replace(/%(\d)/g, (whole, n: string) => {
    const arg = text.a[Number(n) - 1];
    if (arg === undefined) return whole;
    return Array.isArray(arg) ? (strings[arg[1]] ?? arg[1]) : String(arg);
  });
}

function plainReplay(
  start: GameSetBoard,
  moves: Array<{ from: XiangqiSquare; to: XiangqiSquare }>,
) {
  let board: GameSetBoard = { ...start };
  const boards = [board];
  for (const { from, to } of moves) {
    if (!board[from]) throw new Error(`game set: no piece on ${from}`);
    board = { ...board, [to]: board[from] };
    delete board[from];
    boards.push(board);
  }
  return boards;
}

/** A record's moves and the position after each (0 the start), from the
 *  set's own replay or the plain from-to replay of its start. */
export function gameSetLine(
  set: StepGameSet,
  record: StepGameSetRecord,
): { moves: Array<{ from: XiangqiSquare; to: XiangqiSquare }>; boards: GameSetBoard[] } {
  const moves = record.moves.trim().split(/\s+/).filter(Boolean).map(splitGameSetMove);
  let boards: GameSetBoard[];
  if (set.replay) boards = set.replay(record);
  else if (set.start) boards = plainReplay(set.start, moves);
  else throw new Error('game set: neither a start nor a replay');
  if (boards.length !== moves.length + 1)
    throw new Error(
      `game set: ${record.id} replays to ${boards.length - 1} plies, not ${moves.length}`,
    );
  return { moves, boards };
}

export function mountStepGameSet(
  host: HTMLElement,
  set: StepGameSet,
  options: { lang?: ArticleLang; strings: Record<string, string>; title?: string },
): StepGameSetController {
  const { strings } = options;
  const copy = replayStepperCopy(options.lang, 'xiangqi');
  const T = (text: GameSetText) => gameSetText(text, strings);
  const perspective = 'red';
  if (set.records.length === 0) throw new Error('game set: no records');

  const select = document.createElement('select');
  select.className = 'article-step-card-picker';
  select.setAttribute('aria-label', options.title ?? strings.game ?? 'Game');
  let group: HTMLOptGroupElement | null = null;
  for (const record of set.records) {
    const label = T(record.group);
    if (!group || group.label !== label) {
      group = document.createElement('optgroup');
      group.label = label;
      select.append(group);
    }
    const option = document.createElement('option');
    option.value = record.id;
    option.textContent = T(record.label);
    group.append(option);
  }
  const blurb = document.createElement('p');
  blurb.className = 'article-step-card-picker-blurb';
  const picker = document.createElement('div');
  picker.className = 'article-step-card-picker-wrap';
  picker.append(select, blurb);

  function glide(
    board: HTMLElement,
    move: { from: XiangqiSquare; to: XiangqiSquare },
    reverse: boolean,
  ): void {
    const duration = pieceAnimationDurationMs();
    if (duration <= 0) return;
    const settle = reverse ? move.from : move.to;
    const origin = reverse ? move.to : move.from;
    const slot = board.querySelector(`[data-piece-square="${settle}"]`);
    if (!slot) return;
    const o = xqCoord(origin);
    const t = xqCoord(settle);
    const from = xqPoint(o.file, o.rank, perspective, 0, 0);
    const to = xqPoint(t.file, t.rank, perspective, 0, 0);
    glideSvgPiece(slot, from.x - to.x, from.y - to.y, duration);
  }

  function gameFor(record: StepGameSetRecord): StepCardGame {
    const { moves, boards } = gameSetLine(set, record);
    const san = record.san ? record.san.split(' ') : null;
    if (san && san.length !== moves.length)
      throw new Error(
        `game set: ${record.id} has ${san.length} notations for ${moves.length} moves`,
      );
    return {
      count: moves.length + 1,
      paint(board, index, from) {
        const last = index ? moves[index - 1]! : null;
        board.innerHTML = xqSvg(
          XQ_BOARD_W,
          // The board alone, no label band above it: the card's seat rows frame it.
          XQ_BOARD_H + 8,
          xqBoardSvg({
            state: xqVisionDemoState(`game-set-${record.id}-${index}`, boards[index]!),
            x: 0,
            y: -24,
            label: '',
            perspective,
            arrows: last ? [{ from: last.from, to: last.to }] : undefined,
            veteranSoldiers: record.veteran === true,
          }),
        );
        if (from !== null && Math.abs(index - from) === 1) {
          const forward = index > from;
          const move = moves[(forward ? index : from) - 1];
          if (move) glide(board, move, !forward);
        }
      },
      moves: moves.map((m, i) => ({ label: san?.[i] ?? `${m.from}-${m.to}` })),
      intro: copy.intro,
      seats: {
        first: { name: `${T(record.red)}${copy.firstRole}`, ink: 'red' },
        second: { name: `${T(record.black)}${copy.secondRole}`, ink: 'black' },
      },
      result: T(record.verdict),
    };
  }

  function show(record: StepGameSetRecord): StepCardGame {
    const extra = record.extra ? ` ${strings[record.extra] ?? record.extra}` : '';
    blurb.textContent = `${T(record.result)}${extra}`;
    return gameFor(record);
  }

  const first = set.records.find((r) => r.id === set.open) ?? set.records[0]!;
  select.value = first.id;
  host.classList.add('notranslate');
  host.setAttribute('translate', 'no');
  const card = createStepCard({ lang: options.lang, title: options.title, picker }, show(first));
  host.replaceChildren(card.el);

  const onChange = (): void => {
    const record = set.records.find((r) => r.id === select.value);
    if (record) card.setGame(show(record));
  };
  select.addEventListener('change', onChange);
  const onAppearance = (): void => card.repaint();
  window.addEventListener(xiangqiAppearanceChangedEvent, onAppearance);

  return {
    destroy(): void {
      select.removeEventListener('change', onChange);
      window.removeEventListener(xiangqiAppearanceChangedEvent, onAppearance);
      card.destroy();
      host.replaceChildren();
      host.classList.remove('notranslate');
      host.removeAttribute('translate');
    },
  };
}

/** Mount a set whose records load on demand: the module is fetched when the
 *  card nears the viewport, and the card mounts when it arrives. */
export function mountLazyStepGameSet(
  host: HTMLElement,
  load: () => Promise<StepGameSetModule>,
  options: { lang?: ArticleLang; strings: Record<string, string>; title?: string },
): StepGameSetController {
  let destroyed = false;
  let inner: StepGameSetController | null = null;
  let observer: IntersectionObserver | null = null;
  host.classList.add('article-step-card-loading');
  const start = (): void => {
    observer?.disconnect();
    observer = null;
    load()
      .then(({ GAME_SET }) => {
        if (destroyed) return;
        host.classList.remove('article-step-card-loading');
        inner = mountStepGameSet(host, GAME_SET, options);
      })
      .catch((error: unknown) => {
        host.classList.remove('article-step-card-loading');
        console.error('game set: failed to load', error);
      });
  };
  if (typeof IntersectionObserver === 'function') {
    observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) start();
      },
      { rootMargin: '800px 0px' },
    );
    observer.observe(host);
  } else {
    start();
  }
  return {
    destroy(): void {
      destroyed = true;
      observer?.disconnect();
      inner?.destroy();
      host.classList.remove('article-step-card-loading');
    },
  };
}
