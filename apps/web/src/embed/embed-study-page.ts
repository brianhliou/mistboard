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
import { type StudyChapterPayload, studyChapterToReplaySpec } from '../study-chapter-spec.js';
import { mountXiangqiReplay } from '../xiangqi-replay.js';
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

  const frame = document.createElement('div');
  frame.className = 'embed-frame';
  const host = document.createElement('div');
  // Named so the stylesheet can make it the flexible row of the frame. The
  // widget must fill the height it is given rather than take its natural one.
  host.className = 'embed-widget';
  frame.append(host);

  const credit = document.createElement('a');
  credit.className = 'embed-credit';
  credit.href = `/study/${encodeURIComponent(route.studyId)}/${encodeURIComponent(route.chapterId)}`;
  credit.target = '_blank';
  credit.rel = 'noopener';
  credit.textContent = `${chapter.name ?? 'Study'} · mistboard.com`;
  frame.append(credit);

  root.replaceChildren(frame);
  // Pinned, as the game card's foot is: framed beside games, the study card
  // should say who won without a scroll to the end of the list.
  mountXiangqiReplay(host, spec, { resultPlacement: 'pinned' });
  document.title = `${chapter.name ?? 'Study'} · Mistboard`;
}
