// /embed/study/:studyId/:chapterId — one study chapter, rendered alone, meant to
// be framed by someone else's page.
//
// This reads the chapter at request time rather than shipping baked moves, which
// is the whole difference between an embed and the article's replays: an article
// should not depend on a study still existing, and an embed's entire promise is
// that it shows what the study says now.
//
// The page deliberately renders nothing but the board and a source link. No nav,
// no footer, no analytics identity: it runs on a third party's page and should
// take as little of their surface, and know as little about their readers, as it
// can.

import '../app-base.css';
import '../articles.css';
import { mountAtomicXiangqiReplayBoard } from '../atomic-xiangqi-replay.js';
import { mountBanqiReplayBoard } from '../banqi-replay-board.js';
import {
  chessChapterToReplaySpec,
  mountChessReplayBoard,
  replayChess,
} from '../chess-study-replay.js';
import { mountDuckXiangqiReplayBoard } from '../duck-xiangqi-replay.js';
import { mountJungleReplayBoard } from '../jungle-replay-board.js';
import { replayStepperCopy } from '../replay-stepper-copy.js';
import { reviewResultLabel } from '../review/game-review-meta.js';
import { type StudyChapterPayload, studyChapterToReplaySpec } from '../study-chapter-spec.js';
import { boardAspectForSpec } from '../watch-board-aspect.js';
import { mountXiangqiReplayBoard, xiangqiResultLabel } from '../xiangqi-replay.js';
import { embedRailWidthPx, mountEmbedCard } from './embed-card.js';
import type { EmbedStudyRoute } from './embed-route.js';
import './embed.css';

type StudyPayload = {
  study?: { id?: string; name?: string; visibility?: string };
  chapters?: StudyChapterPayload[];
};

function note(root: HTMLElement, message: string): void {
  const box = document.createElement('div');
  box.className = 'embed-note';
  box.textContent = message;
  root.replaceChildren(box);
}

export async function mountEmbedStudy(
  root: HTMLElement,
  route: EmbedStudyRoute,
  options: { startPly?: number | null } = {},
): Promise<void> {
  document.body.classList.add('embed-body');
  // A hook on the ROOT, not just the body. :root in app-base.css paints the page
  // colour and a gradient, and it outranks a bare `html` selector, so the frame
  // kept its cream ground however body was styled.
  document.documentElement.dataset.embed = 'study';
  root.className = 'embed-root';
  note(root, 'Loading…');

  let payload: StudyPayload;
  try {
    const response = await fetch(`/api/studies/${encodeURIComponent(route.studyId)}`, {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) {
      // A private or deleted study must read as unavailable, never as broken.
      note(root, 'This study is not available.');
      return;
    }
    payload = (await response.json()) as StudyPayload;
  } catch {
    note(root, 'This study could not be loaded.');
    return;
  }

  const chapter = (payload.chapters ?? []).find((c) => c.id === route.chapterId);
  if (!chapter) {
    note(root, 'This chapter is not available.');
    return;
  }
  await mountChapterEmbed(
    root,
    {
      href: `/study/${encodeURIComponent(route.studyId)}/${encodeURIComponent(route.chapterId)}`,
      text: `${chapter.name ?? 'Study'} · mistboard.com`,
    },
    chapter,
    options,
  );
}

export type EmbedCredit = { href: string; text: string };

/** The variants this card can draw. A chapter of any other variant is refused
 *  by name: the old fallthrough drew it on the xiangqi board, which is how a
 *  jungle chapter once rendered as a xiangqi position with jungle squares
 *  ringed on it. */
export const CHAPTER_EMBED_VARIANTS: ReadonlySet<string> = new Set([
  'xiangqi',
  'duck-xiangqi',
  'atomic-xiangqi',
  'banqi',
  'jungle',
  'chess',
  'dark-chess',
]);

/**
 * One chapter payload on the embed card, whoever built it: the study page
 * after fetching a study, or the line page from a query string. Dispatches on
 * the chapter's own variant to the board that can draw it.
 */
export async function mountChapterEmbed(
  root: HTMLElement,
  credit: EmbedCredit,
  chapter: StudyChapterPayload,
  options: { startPly?: number | null },
): Promise<void> {
  const variant = chapter.variant ?? 'xiangqi';
  if (!CHAPTER_EMBED_VARIANTS.has(variant)) {
    note(root, `A ${variant} game cannot be framed yet.`);
    return;
  }
  if (variant === 'chess' || variant === 'dark-chess') {
    await mountChessEmbed(root, credit, chapter, options);
    return;
  }
  if (variant === 'banqi') {
    await mountBanqiEmbed(root, credit, chapter, options);
    return;
  }
  if (variant === 'jungle') {
    await mountJungleEmbed(root, credit, chapter, options);
    return;
  }
  const spec = studyChapterToReplaySpec(chapter);
  if (!spec) {
    note(root, 'This chapter has no moves to show.');
    return;
  }

  // The same card a game sits in (embed-card.ts), with the study's board
  // underneath: mainline only, no sidelines or flip menu, which are the study
  // page's; the credit link is the way there. A chapter has no clocks, so the
  // seat rows' clock slots stay empty.
  const isDuck = chapter.variant === 'duck-xiangqi';
  const isAtomic = chapter.variant === 'atomic-xiangqi';
  const copy = replayStepperCopy(undefined, 'xiangqi');
  await mountEmbedCard(root, {
    header: spec.title ? `${spec.title} · ${spec.event}` : spec.event,
    seats: {
      first: { name: spec.red, ink: 'red' },
      second: { name: spec.black, ink: 'black' },
    },
    result: xiangqiResultLabel(spec.resultText, copy),
    credit: {
      href: credit.href,
      text: credit.text,
    },
    // Duck games need the duck renderer: the xiangqi board has no way to draw
    // the duck, which lives in the seventh FEN field, so a duck chapter used
    // to render as a xiangqi position with a piece missing. Atomic games need
    // the atomic kernel, or every explosion's victims stay on the board.
    // Dispatch on the chapter's own variant, and fail over to xiangqi for
    // everything else rather than guessing.
    aspect: boardAspectForSpec(isDuck ? 'duck-xiangqi' : 'xiangqi'),
    railWidthPx: embedRailWidthPx(isDuck ? 'duck-xiangqi' : 'xiangqi'),
    // Clamped by the card against the real ply count, so an out-of-range
    // deep link opens at the end rather than on nothing.
    startPly: options.startPly ?? 0,
    mountBoard: async (host, hooks) =>
      isDuck
        ? mountDuckXiangqiReplayBoard(
            host,
            {
              // A duck chapter's mainline is stored as duck turn tokens
              // (`from+to@duckTo`, the tree adapter's own spelling), in the
              // same field a xiangqi chapter uses for ICCS.
              moves: spec.iccs,
              red: spec.red,
              black: spec.black,
              event: spec.event,
              resultText: spec.resultText,
            },
            hooks,
          )
        : isAtomic
          ? mountAtomicXiangqiReplayBoard(
              host,
              {
                moves: spec.iccs,
                red: spec.red,
                black: spec.black,
                event: spec.event,
                resultText: spec.resultText,
              },
              hooks,
            )
          : mountXiangqiReplayBoard(host, spec, hooks),
  });
  document.title = `${chapter.name ?? 'Study'} · Mistboard`;
}

// A banqi chapter is its own branch for the same reason as chess below: the
// xiangqi spec conversion re-spells UCI as ICCS, and a banqi token (`b2b2`, a
// flip; `a1b1`, a step) is not xiangqi UCI. The chapter's dealt root (rootFen)
// is what makes its moves replayable; without it there is nothing to show.
async function mountBanqiEmbed(
  root: HTMLElement,
  credit: EmbedCredit,
  chapter: StudyChapterPayload,
  options: { startPly?: number | null },
): Promise<void> {
  const rootFen = chapter.root?.rootFen;
  if (!rootFen) {
    note(root, 'This chapter has no dealt position to show.');
    return;
  }
  const moves: string[] = [];
  let node = chapter.root?.root;
  while (node?.children?.length) {
    const played = node.children[0];
    if (!played?.uci) break;
    moves.push(played.uci);
    node = played;
  }
  const tags = chapter.tags ?? {};
  const event = tags.event ?? chapter.name ?? 'Study';
  // The tags' result is seat-keyed (1-0 is the first mover), and a seat's ink
  // is whatever the first flip turned up, so the label names the seat.
  const result =
    tags.result === '1-0'
      ? 'First seat wins'
      : tags.result === '0-1'
        ? 'Second seat wins'
        : tags.result === '1/2-1/2'
          ? 'Draw'
          : '';
  await mountEmbedCard(root, {
    header: event,
    // The seats are the first and second mover; the ink each plays is bound by
    // the first flip, so the seat rows carry the seat, not a colour.
    seats: {
      first: { name: tags.red ?? 'First seat', ink: 'red' },
      second: { name: tags.black ?? 'Second seat', ink: 'black' },
    },
    result,
    credit: {
      href: credit.href,
      text: credit.text,
    },
    aspect: boardAspectForSpec('banqi'),
    railWidthPx: embedRailWidthPx('banqi'),
    startPly: options.startPly ?? 0,
    mountBoard: async (host, hooks) =>
      mountBanqiReplayBoard(host, { rootFen, moves, perspective: 'red' }, hooks),
  });
  document.title = `${chapter.name ?? 'Study'} · Mistboard`;
}

// A jungle chapter is its own branch for the banqi reason: `a1b1` is not xiangqi
// UCI, and the xiangqi spec conversion would draw a xiangqi board under jungle
// moves (which is exactly what the first jungle study embed did, 2026-09-21).
// Open jungle is perfect information, so the root is the start position and
// the seats are the inks.
function mainlineTokens(chapter: StudyChapterPayload): string[] {
  const moves: string[] = [];
  let node = chapter.root?.root;
  while (node?.children?.length) {
    const played = node.children[0];
    if (!played?.uci) break;
    moves.push(played.uci);
    node = played;
  }
  return moves;
}

async function mountJungleEmbed(
  root: HTMLElement,
  credit: EmbedCredit,
  chapter: StudyChapterPayload,
  options: { startPly?: number | null },
): Promise<void> {
  const rootFen = chapter.root?.rootFen;
  if (!rootFen) {
    note(root, 'This chapter has no position to show.');
    return;
  }
  const moves = mainlineTokens(chapter);
  const tags = chapter.tags ?? {};
  const event = tags.event ?? chapter.name ?? 'Study';
  const result =
    tags.result === '1-0'
      ? reviewResultLabel('red-wins', 'jungle')
      : tags.result === '0-1'
        ? reviewResultLabel('black-wins', 'jungle')
        : tags.result === '1/2-1/2'
          ? reviewResultLabel('draw', 'jungle')
          : '';
  await mountEmbedCard(root, {
    header: event,
    seats: {
      first: { name: tags.red ?? 'Red', ink: 'red' },
      second: { name: tags.black ?? 'Blue', ink: 'blue' },
    },
    result,
    credit: {
      href: credit.href,
      text: credit.text,
    },
    aspect: boardAspectForSpec('jungle'),
    railWidthPx: embedRailWidthPx('jungle'),
    startPly: options.startPly ?? 0,
    mountBoard: async (host, hooks) =>
      mountJungleReplayBoard(host, { rootFen, moves, perspective: 'red' }, hooks),
  });
  document.title = `${chapter.name ?? 'Study'} · Mistboard`;
}

// A chess chapter is its own branch rather than a case in the xiangqi spec
// conversion: that conversion re-spells UCI as ICCS (ranks 0-9), which reads
// "e2e4" as a legal xiangqi token and lands every chess move on the wrong
// rank. The chess board replays the tree's own UCI against the chess kernel.
//
// A fog chess chapter takes the same branch on the fog chess kernel, drawn as
// the revealed truth board: a chapter is a finished record its author chose to
// publish, shown the way a finished room and the study page's primary board
// show it. The per-seat fogged views stay the study page's.
async function mountChessEmbed(
  root: HTMLElement,
  credit: EmbedCredit,
  chapter: StudyChapterPayload,
  options: { startPly?: number | null },
): Promise<void> {
  const spec = chessChapterToReplaySpec(chapter);
  if (!spec) {
    note(root, 'This chapter has no moves to show.');
    return;
  }
  // Chapter tags are the lowercase whitelist routes/studies.ts stores: `red` is
  // the first mover's seat (White here), as on every other variant.
  const tags = chapter.tags ?? {};
  const event = tags.event ?? chapter.name ?? 'Study';
  const result =
    tags.result && tags.result !== '*'
      ? tags.result
      : spec.variant === 'dark-chess'
        ? darkChessEndingLabel(spec)
        : '';
  await mountEmbedCard(root, {
    header: event,
    seats: {
      first: { name: tags.red ?? 'White', ink: 'white' },
      second: { name: tags.black ?? 'Black', ink: 'black' },
    },
    result,
    credit: {
      href: credit.href,
      text: credit.text,
    },
    aspect: boardAspectForSpec('chess'),
    railWidthPx: embedRailWidthPx('chess'),
    startPly: options.startPly ?? 0,
    mountBoard: async (host, hooks) => mountChessReplayBoard(host, spec, hooks),
  });
  document.title = `${chapter.name ?? 'Study'} · Mistboard`;
}

/** A fog chess chapter's ending read off its last position, for a chapter with
 *  no result tag (the Misty self-play studies carry none): a king capture or a
 *  kernel draw is on the board, so the card can say it. Empty when the line
 *  stops mid-game. */
function darkChessEndingLabel(spec: NonNullable<ReturnType<typeof chessChapterToReplaySpec>>) {
  const { states } = replayChess(spec);
  const status = states[states.length - 1]?.status;
  if (status?.type !== 'finished') return '';
  if (status.winner === 'white') return reviewResultLabel('white-wins', 'dark-chess');
  if (status.winner === 'black') return reviewResultLabel('black-wins', 'dark-chess');
  return reviewResultLabel('draw', 'dark-chess');
}
