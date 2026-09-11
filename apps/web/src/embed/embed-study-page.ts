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
import { replayStepperCopy } from '../replay-stepper-copy.js';
import { type StudyChapterPayload, studyChapterToReplaySpec } from '../study-chapter-spec.js';
import { boardAspectForSpec } from '../watch-board-aspect.js';
import { mountXiangqiReplayBoard, xiangqiResultLabel } from '../xiangqi-replay.js';
import { mountEmbedCard } from './embed-card.js';
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

export async function mountEmbedStudy(root: HTMLElement, route: EmbedStudyRoute): Promise<void> {
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
  const spec = studyChapterToReplaySpec(chapter);
  if (!spec) {
    note(root, 'This chapter has no moves to show.');
    return;
  }

  // The same card a game sits in (embed-card.ts), with the study's board
  // underneath: mainline only, no sidelines or flip menu, which are the study
  // page's; the credit link is the way there. A chapter has no clocks, so the
  // seat rows' clock slots stay empty.
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
    aspect: boardAspectForSpec('xiangqi'),
    startPly: 0,
    mountBoard: async (host, hooks) => mountXiangqiReplayBoard(host, spec, hooks),
  });
  document.title = `${chapter.name ?? 'Study'} · Mistboard`;
}
