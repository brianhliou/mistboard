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
import { chessChapterToReplaySpec, mountChessReplayBoard } from '../chess-study-replay.js';
import { mountDuckXiangqiReplayBoard } from '../duck-xiangqi-replay.js';
import { replayStepperCopy } from '../replay-stepper-copy.js';
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
  if (chapter.variant === 'chess') {
    await mountChessEmbed(root, route, chapter, options);
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
      href: `/study/${encodeURIComponent(route.studyId)}/${encodeURIComponent(route.chapterId)}`,
      text: `${chapter.name ?? 'Study'} · mistboard.com`,
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

// A chess chapter is its own branch rather than a case in the xiangqi spec
// conversion: that conversion re-spells UCI as ICCS (ranks 0-9), which reads
// "e2e4" as a legal xiangqi token and lands every chess move on the wrong
// rank. The chess board replays the tree's own UCI against the chess kernel.
async function mountChessEmbed(
  root: HTMLElement,
  route: EmbedStudyRoute,
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
  const result = tags.result && tags.result !== '*' ? tags.result : '';
  await mountEmbedCard(root, {
    header: event,
    seats: {
      first: { name: tags.red ?? 'White', ink: 'white' },
      second: { name: tags.black ?? 'Black', ink: 'black' },
    },
    result,
    credit: {
      href: `/study/${encodeURIComponent(route.studyId)}/${encodeURIComponent(route.chapterId)}`,
      text: `${chapter.name ?? 'Study'} · mistboard.com`,
    },
    aspect: boardAspectForSpec('chess'),
    railWidthPx: embedRailWidthPx('chess'),
    startPly: options.startPly ?? 0,
    mountBoard: async (host, hooks) => mountChessReplayBoard(host, spec, hooks),
  });
  document.title = `${chapter.name ?? 'Study'} · Mistboard`;
}
