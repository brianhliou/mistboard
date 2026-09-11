// Study viewer/editor (/study/:id). Fetches a persisted study, rebuilds each
// chapter's tree from its serialized blob, and mounts that chapter variant's
// review surface (review/study-review.ts owns the board dispatch). A study is
// single-variant: the first chapter fixes the variant and later chapters inherit
// it. Chapters live in a compact navigation-first rail with a per-study chat
// beneath; owner metadata and chapter actions open in focused dialogs. Tree
// edits autosave through the version-guarded chapter PATCH. Non-owners get the
// same reading workspace without authoring controls.

import './game-shell.css';
import { track } from './analytics.js';
import { t } from './i18n/catalog.js';
import { localizedHref } from './i18n/locale.js';
import { appendLinkedText } from './link-text.js';
import {
  displayComment,
  localizedChapterTags,
  localizedStudyDescription,
  localizedStudyName,
} from './study-i18n.js';
import './live-xiangqi.css';
import './xiangqi-postgame.css';
import './study.css';
import './study-index.css';
import type { XiangqiPieceRole } from '@mistboard/game';
import { deepCloneJson, normalizeStartFen, parsePracticeGoal } from '@mistboard/game';
import { buildStudyChat } from './review/spectator-chat.js';
import { mountStudyReview } from './review/study-review.js';
import type { TreeReviewHandle } from './review/tree-review.js';
import type { SerializedTree } from './review/tree-serialize.js';
import { mountXiangqiGamebook } from './review/xiangqi-gamebook.js';
import { downloadStudyPgn } from './review/xiangqi-pgn-chapter.js';
import { buildNav } from './site-shell.js';
import {
  createStudyAutosave,
  type StudyAutosave,
  type StudyAutosaveState,
} from './study-autosave.js';
import {
  DEFAULT_STUDY_VARIANT,
  isStudyVariantId,
  type StudyVariantId,
  studyVariantLabel,
  studyVariantSupportsComposition,
  studyVariantSupportsGamebook,
} from './study-catalog.js';
import { openChapterDialog } from './study-chapter-dialog.js';
import {
  buildStudyRail,
  type ChapterControlModel,
  type ChapterSettingsPatch,
  clearTreeAnnotations,
  keepTreeMainline,
  openChapterSettingsDialog,
  openStudySaveRecoveryDialog,
  openStudySettingsDialog,
  type StudySettingsPatch,
  type StudyVisibility,
} from './study-controls.js';
import { buildStudyThumbnail } from './study-thumbnails.js';
import { renderXiangqiPiece } from './xiangqi-pieces.js';

type StudyDto = {
  id: string;
  /** Curated slug, when the study is part of a catalogue (migration 132). */
  slug?: string | null;
  name: string;
  description: string;
  /** Per-locale overrides for name/description; resolved at render time. */
  i18n?: unknown;
  visibility: StudyVisibility;
  isOwner: boolean;
  featuredAt: string | null;
  canFeature: boolean;
  likeCount: number;
  likedByViewer: boolean;
  owner?: { handle: string; displayName: string };
};

type ChapterDto = {
  id: string;
  name: string;
  /** Per-locale overrides for `name`. */
  i18n?: unknown;
  variant: string;
  orientation: string;
  root: SerializedTree;
  version: number;
  gamebook: boolean;
  /** Practice (engine-adjudicated) chapter: played from the root position
   *  against the engine, which also grades. Absent on chapters written before
   *  migration 131. */
  practice?: boolean;
  /** Authored goal text ("mate in 3", "win", "draw in 20"); null unless
   *  `practice`. Parsed by parsePracticeGoal at mount. */
  practiceGoal?: string | null;
  /** Whether the signed-in reader has already solved this exercise. */
  solved?: boolean;
  /** PGN-style tags: who had Red, the result, the event. Absent on chapters
   *  authored before migration 128, and on chapters that are not a real game. */
  tags?: {
    red?: string;
    black?: string;
    result?: string;
    event?: string;
    date?: string;
    round?: string;
    site?: string;
  };
};

type LoadResult =
  | { ok: true; study: StudyDto; chapters: ChapterDto[] }
  | { ok: false; status: number };

const EMPTY_TREE: SerializedTree = { version: 1, root: { children: [] } };
const studyMountTokens = new WeakMap<HTMLElement, object>();
const studyMountCleanups = new WeakMap<HTMLElement, () => void>();

export function mountStudy(root: HTMLElement, studyId: string, initialChapterId?: string): void {
  studyMountCleanups.get(root)?.();
  const token = {};
  studyMountTokens.set(root, token);
  root.classList.add('landing-page', 'xiangqi-postgame-route');
  root.replaceChildren(buildNav(), notice(t('study.loadingOne')));
  void loadStudy(studyId)
    .then((result) => {
      if (studyMountTokens.get(root) !== token) return;
      if (result.ok) renderStudy(root, result.study, result.chapters, initialChapterId);
      else renderError(root, result.status);
    })
    .catch(() => {
      if (studyMountTokens.get(root) === token) renderError(root, 0);
    });
}

async function loadStudy(studyId: string): Promise<LoadResult> {
  const response = await fetch(`/api/studies/${encodeURIComponent(studyId)}`, {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) return { ok: false, status: response.status };
  const body = (await response.json()) as { study: StudyDto; chapters: ChapterDto[] };
  return { ok: true, study: body.study, chapters: body.chapters };
}

/**
 * The opening sentence of a study description, for the rail card's tagline slot.
 *
 * A description is written to be read in full on the index; the rail wants the
 * one line that says what the set is. Falls back to the whole string when there
 * is no sentence break, rather than cutting mid-word.
 */
/** The piece an endgame set's rail header illustrates. Mirrors practice-index. */
function railPieceForSlug(slug: string | null | undefined): XiangqiPieceRole {
  if (!slug) return 'general';
  if (slug.includes('chariot')) return 'chariot';
  if (slug.includes('horse')) return 'horse';
  if (slug.includes('cannon')) return 'cannon';
  if (slug.includes('soldier')) return 'soldier';
  return 'general';
}

function firstSentence(text: string): string {
  const trimmed = text.trim();
  const stop = trimmed.indexOf('. ');
  return stop === -1 ? trimmed : trimmed.slice(0, stop + 1);
}

function renderStudy(
  root: HTMLElement,
  study: StudyDto,
  chapters: ChapterDto[],
  initialChapterId?: string,
): void {
  if (chapters.length === 0) {
    renderError(root, 415);
    return;
  }
  let activeId = chapters.some((chapter) => chapter.id === initialChapterId)
    ? initialChapterId!
    : chapters[0]!.id;
  // Bumped on every render so an in-flight async board mount knows it is stale.
  let mountSeq = 0;

  // Study engagement had no instrumentation at all: we could see that someone
  // loaded the page and nothing after it. Chapter opens are the read signal --
  // a reader who works through five chapters is engaged, and unlike a per-move
  // event it stays low volume. Deduped per chapter per page load so a rerender
  // (gamebook toggle, autosave) does not inflate the count.
  const openedChapters = new Set<string>();
  track('study_opened', {
    studyId: study.id,
    chapters: chapters.length,
    isOwner: Boolean(study.isOwner),
  });
  let activeHandle: TreeReviewHandle | null = null;
  let activeAutosave: StudyAutosave | null = null;

  const flushActive = async (): Promise<boolean> => {
    if (!activeAutosave) return true;
    return activeAutosave.flush();
  };

  const disposeActive = (): void => {
    activeAutosave?.dispose();
    activeAutosave = null;
    activeHandle = null;
  };

  const updateChapterUrl = (id: string, mode: 'push' | 'replace'): void => {
    const nextPath = studyChapterPath(study.id, id, window.location.pathname);
    if (window.location.pathname === nextPath) return;
    const nextUrl = `${nextPath}${window.location.search}${window.location.hash}`;
    if (mode === 'push')
      window.history.pushState({ studyId: study.id, chapterId: id }, '', nextUrl);
    else window.history.replaceState({ studyId: study.id, chapterId: id }, '', nextUrl);
  };

  const switchTo = async (id: string, historyMode: 'push' | 'replace' = 'push'): Promise<void> => {
    // No-op when already active — otherwise a double-click (two clicks) would
    // re-render and detach the tab label before its dblclick-to-rename fires.
    if (id === activeId) return;
    if (!(await flushActive())) {
      // Back/Forward changes the URL before popstate. Restore the still-active
      // chapter when its local draft could not be safely flushed.
      updateChapterUrl(activeId, 'replace');
      return;
    }
    disposeActive();
    activeId = id;
    updateChapterUrl(id, historyMode);
    // renderActive() rebuilds the whole page and the board mounts async, so the
    // document briefly shrinks and the browser yanks the scroll to the top. Pin
    // it: hold the current scroll while the new chapter mounts.
    preserveScroll();
    renderActive();
  };

  // Every rendered chapter has a stable permalink, including the first chapter
  // reached through the shorter /study/:id URL or an invalid stale chapter URL.
  updateChapterUrl(activeId, 'replace');
  const onPopState = (): void => {
    if (!root.isConnected) {
      window.removeEventListener('popstate', onPopState);
      return;
    }
    const chapterId = chapterIdFromStudyPath(window.location.pathname, study.id);
    if (
      !chapterId ||
      chapterId === activeId ||
      !chapters.some((chapter) => chapter.id === chapterId)
    ) {
      return;
    }
    void switchTo(chapterId, 'replace');
  };
  window.addEventListener('popstate', onPopState);
  const onBeforeUnload = (event: BeforeUnloadEvent): void => {
    if (!activeAutosave?.hasPending()) return;
    event.preventDefault();
    event.returnValue = '';
  };
  window.addEventListener('beforeunload', onBeforeUnload);
  studyMountCleanups.set(root, () => {
    window.removeEventListener('popstate', onPopState);
    window.removeEventListener('beforeunload', onBeforeUnload);
    disposeActive();
  });

  // Keep the page from jumping to the top on a chapter switch. Capture the
  // scroll now and restore it across the re-render + async board mount, until a
  // real user scroll releases the pin.
  const preserveScroll = (): void => {
    const y = window.scrollY;
    let released = false;
    const release = () => {
      released = true;
      window.removeEventListener('wheel', release);
      window.removeEventListener('touchmove', release);
      window.removeEventListener('keydown', release);
    };
    window.addEventListener('wheel', release, { passive: true, once: true });
    window.addEventListener('touchmove', release, { passive: true, once: true });
    window.addEventListener('keydown', release, { once: true });
    let frames = 0;
    const pin = () => {
      if (released) return;
      if (Math.abs(window.scrollY - y) > 1) window.scrollTo(0, y);
      // Re-pin for a few frames — the board chunk lands async and reflows once.
      if (frames++ < 30) requestAnimationFrame(pin);
      else release();
    };
    requestAnimationFrame(pin);
  };

  // A study is single-variant: chapters inherit the variant chosen at create
  // time, so no chapter request carries one (the server refuses a mismatch).
  const studyVariant = (): StudyVariantId => {
    const first = chapters[0];
    return first && isStudyVariantId(first.variant) ? first.variant : DEFAULT_STUDY_VARIANT;
  };

  const createChapter = async (
    name: string,
    rootFen?: string,
    sourceRoot?: SerializedTree,
    orientation?: 'red' | 'black',
  ): Promise<string | null> => {
    if (!(await flushActive())) return t('study.resolveFirst');
    // rootFen rides inside the tree blob (SerializedTree.rootFen). Duplicating a
    // chapter supplies the whole source tree instead.
    const chapterRoot: SerializedTree = sourceRoot
      ? deepCloneJson(sourceRoot)
      : rootFen
        ? { ...EMPTY_TREE, rootFen }
        : EMPTY_TREE;
    const response = await fetch(`/api/studies/${study.id}/chapters`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: name || `Chapter ${chapters.length + 1}`,
        root: chapterRoot,
        ...(orientation ? { orientation } : {}),
      }),
    });
    if (!response.ok) return responseError(response, t('study.createChapterFailed'));
    const { chapter } = (await response.json()) as { chapter: ChapterDto };
    chapters.push(chapter);
    await switchTo(chapter.id);
    return null;
  };

  const addChapter = (): void =>
    openChapterDialog({
      defaultName: `Chapter ${chapters.length + 1}`,
      composable: studyVariantSupportsComposition(studyVariant()),
      // PGN is standard-xiangqi only for now: the reader, the notation codecs,
      // and the tree translation are all xiangqi. Other variants get the dialog
      // without the tab rather than a tab that cannot work.
      importable: studyVariant() === 'xiangqi',
      normalizeFen: (raw) => normalizeStartFen(studyVariant(), raw),
      createChapter: (name, rootFen, root, orientation) =>
        createChapter(name, rootFen, root, orientation),
    });

  const pgnExportable = (): boolean => studyVariant() === 'xiangqi';

  const pgnExportRow = (): HTMLElement => {
    const row = document.createElement('div');
    row.className = 'review-share__row';
    const label = document.createElement('span');
    label.className = 'review-share__label';
    label.textContent = 'PGN';
    const note = document.createElement('span');
    note.className = 'review-share__note';
    note.textContent = chapters.length > 1 ? `All ${chapters.length} chapters` : 'This study';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'review-share__copy';
    button.textContent = 'Download';
    button.addEventListener('click', () => {
      // Export the SAVED trees: an unflushed edit would leave the file a move
      // behind what the author can see on the board.
      void flushActive().then((flushed) => {
        if (!flushed) {
          button.textContent = t('study.resolveFirst');
          setTimeout(() => (button.textContent = 'Download'), 2000);
          return;
        }
        downloadStudyPgn(
          {
            name: study.name,
            id: study.id,
            ...(study.owner ? { author: study.owner.displayName || study.owner.handle } : {}),
          },
          chapters.map((chapter) => ({ name: chapter.name, root: chapter.root })),
        );
        button.textContent = 'Downloaded';
        setTimeout(() => (button.textContent = 'Download'), 1200);
      });
    });
    row.append(label, note, button);
    return row;
  };

  const removeChapter = async (id: string): Promise<string | null> => {
    if (!(await flushActive())) return t('study.resolveFirst');
    const response = await fetch(`/api/studies/${study.id}/chapters/${id}`, { method: 'DELETE' });
    if (!response.ok) return responseError(response, t('study.deleteChapterFailed'));
    const index = chapters.findIndex((chapter) => chapter.id === id);
    if (index >= 0) chapters.splice(index, 1);
    if (activeId === id) {
      activeId = chapters[Math.min(index, chapters.length - 1)]?.id ?? activeId;
      updateChapterUrl(activeId, 'replace');
    }
    disposeActive();
    renderActive();
    return null;
  };

  const reorderChapters = async (nextIds: string[]): Promise<string | null> => {
    if (!(await flushActive())) return t('study.resolveFirst');
    const response = await fetch(`/api/studies/${study.id}/chapters`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chapterIds: nextIds }),
    });
    if (!response.ok) return responseError(response, t('study.reorderChaptersFailed'));
    const byId = new Map(chapters.map((chapter) => [chapter.id, chapter]));
    const reordered = nextIds.flatMap((id) => {
      const chapter = byId.get(id);
      return chapter ? [chapter] : [];
    });
    if (reordered.length !== chapters.length) return t('study.chapterListChanged');
    chapters.splice(0, chapters.length, ...reordered);
    disposeActive();
    renderActive();
    return null;
  };

  // Owner-only: whether the owner is previewing (test-playing) the active gamebook
  // chapter instead of authoring it.
  let previewMode = false;

  const setGamebook = async (
    chapterId: string,
    on: boolean,
    rerender = true,
  ): Promise<string | null> => {
    const chapter = chapters.find((entry) => entry.id === chapterId);
    if (!chapter) return t('study.chapterNotFound');
    if (!(await flushActive())) return t('study.resolveFirst');
    const response = await fetch(`/api/studies/${study.id}/chapters/${chapterId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gamebook: on }),
    });
    if (!response.ok) return responseError(response, t('study.lessonModeFailed'));
    chapter.gamebook = on;
    if (!on) previewMode = false;
    if (rerender) {
      disposeActive();
      renderActive();
    }
    return null;
  };

  /**
   * Turn a chapter into a practice exercise, or back.
   *
   * The goal travels with the flag because a practice chapter without one is not
   * a half-configured exercise, it is an exercise with no way to be won or lost.
   * Validated here before the request so a typo is a message under the field
   * rather than a 400 the author has to interpret.
   */
  const setPractice = async (
    chapterId: string,
    on: boolean,
    goal: string,
  ): Promise<string | null> => {
    const chapter = chapters.find((entry) => entry.id === chapterId);
    if (!chapter) return t('study.chapterNotFound');
    if (on && !parsePracticeGoal(goal)) {
      return 'Goal must read like "mate", "mate in 3", "win", or "draw in 20".';
    }
    if (!(await flushActive())) return t('study.resolveFirst');
    const response = await fetch(`/api/studies/${study.id}/chapters/${chapterId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ practice: on, practiceGoal: on ? goal.trim() : null }),
    });
    if (!response.ok) return responseError(response, 'Could not change practice mode.');
    chapter.practice = on;
    chapter.practiceGoal = on ? goal.trim() : null;
    if (!on) previewMode = false;
    disposeActive();
    renderActive();
    return null;
  };

  const setPreview = (on: boolean): void => {
    void flushActive().then((saved) => {
      if (!saved) return;
      previewMode = on;
      disposeActive();
      renderActive();
    });
  };

  const saveStudySettings = async (patch: StudySettingsPatch): Promise<string | null> => {
    if (!(await flushActive())) return t('study.resolveFirst');
    const response = await fetch(`/api/studies/${study.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!response.ok) return responseError(response, t('study.saveSettingsFailed'));
    study.name = patch.name;
    study.description = patch.description;
    study.visibility = patch.visibility;
    disposeActive();
    renderActive();
    return null;
  };

  const deleteStudy = async (): Promise<string | null> => {
    const response = await fetch(`/api/studies/${study.id}`, { method: 'DELETE' });
    if (!response.ok) return responseError(response, t('study.deleteStudyFailed'));
    activeAutosave?.discard();
    disposeActive();
    window.location.href = localizedHref('/study?tab=mine');
    return null;
  };

  const toggleFeatured = async (featured: boolean): Promise<string | null> => {
    const response = await fetch(`/api/admin/studies/${study.id}/featured`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ featured }),
    });
    if (!response.ok) return responseError(response, t('study.staffPicksFailed'));
    const body = (await response.json()) as { featuredAt: string | null };
    study.featuredAt = body.featuredAt;
    return null;
  };

  /** Persist a chapter's default board facing. Shared by the settings dialog and
   *  the under-board menu, so the two can never disagree about what "default"
   *  means or how a failure surfaces. */
  const saveOrientation = async (
    chapter: ChapterDto,
    orientation: 'red' | 'black',
  ): Promise<string | null> => {
    if (orientation === chapter.orientation) return null;
    const response = await fetch(`/api/studies/${study.id}/chapters/${chapter.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orientation }),
    });
    if (!response.ok) return responseError(response, t('study.updateChapterFailed'));
    chapter.orientation = orientation;
    return null;
  };

  const saveChapterSettings = async (
    chapter: ChapterDto,
    patch: ChapterSettingsPatch,
  ): Promise<string | null> => {
    if (!(await flushActive())) return t('study.resolveFirst');
    if (patch.name !== chapter.name) {
      const response = await fetch(`/api/studies/${study.id}/chapters/${chapter.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: patch.name }),
      });
      if (!response.ok) return responseError(response, t('study.renameChapterFailed'));
      chapter.name = patch.name;
    }
    const orientationError = await saveOrientation(chapter, patch.orientation);
    if (orientationError) return orientationError;
    if (patch.gamebook !== chapter.gamebook) {
      const error = await setGamebook(chapter.id, patch.gamebook, false);
      if (error) return error;
    }
    disposeActive();
    renderActive();
    return null;
  };

  const saveChapterRoot = async (
    chapter: ChapterDto,
    nextRoot: SerializedTree,
  ): Promise<string | null> => {
    if (!(await flushActive())) return t('study.resolveFirst');
    const response = await fetch(`/api/studies/${study.id}/chapters/${chapter.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ root: nextRoot, baseVersion: chapter.version }),
    });
    if (!response.ok) {
      return response.status === 409
        ? t('study.chapterChangedReload')
        : responseError(response, t('study.updateChapterFailed'));
    }
    const body = (await response.json()) as { chapter: { version: number } };
    chapter.root = nextRoot;
    chapter.version = body.chapter.version;
    disposeActive();
    renderActive();
    return null;
  };

  const openStudySettings = (): void => {
    openStudySettingsDialog(study, {
      onSave: saveStudySettings,
      onDelete: deleteStudy,
    });
  };

  const openChapterSettings = (model: ChapterControlModel): void => {
    const chapter = chapters.find((entry) => entry.id === model.id);
    if (!chapter) return;
    const snapshotActive = (): void => {
      if (chapter.id === activeId && activeHandle) chapter.root = activeHandle.serialize();
    };
    openChapterSettingsDialog(chapter, {
      canUseGamebook: studyVariantSupportsGamebook(studyVariant()),
      canDelete: chapters.length > 1,
      onSave: (patch) => saveChapterSettings(chapter, patch),
      onDuplicate: () => {
        snapshotActive();
        return createChapter(
          `${chapter.name} copy`,
          undefined,
          chapter.root,
          chapter.orientation === 'black' ? 'black' : 'red',
        );
      },
      onClearAnnotations: () => {
        snapshotActive();
        return saveChapterRoot(chapter, clearTreeAnnotations(chapter.root));
      },
      onClearVariations: () => {
        snapshotActive();
        return saveChapterRoot(chapter, keepTreeMainline(chapter.root));
      },
      onDelete: () => {
        snapshotActive();
        return removeChapter(chapter.id);
      },
    });
  };

  function renderActive(): void {
    // Captured before the rebuild tears the old rail out of the DOM, so a
    // chapter switch keeps the reader's place in a long chapter list.
    const previousListScrollTop =
      root.querySelector<HTMLElement>('.study-chapters__list')?.scrollTop ?? null;
    const chapter = chapters.find((entry) => entry.id === activeId) ?? chapters[0];
    // Fail-closed: a chapter whose variant has no board on this client (an older
    // client, or a variant retired from the study catalog) reports unsupported
    // rather than rendering some other variant's board.
    if (!chapter || !isStudyVariantId(chapter.variant)) {
      renderError(root, 415);
      return;
    }
    const variant = chapter.variant;
    activeId = chapter.id;

    if (!openedChapters.has(chapter.id)) {
      openedChapters.add(chapter.id);
      track('study_chapter_opened', {
        studyId: study.id,
        chapterId: chapter.id,
        chapterIndex: chapters.findIndex((entry) => entry.id === chapter.id),
        variant,
        isOwner: Boolean(study.isOwner),
        // How deep into the study this reader has gone so far.
        chaptersOpened: openedChapters.size,
      });
    }

    const gamebookable = studyVariantSupportsGamebook(variant);
    /**
     * The rail as a LEARNER sees it: no settings gear, no per-chapter gear, no
     * drag handles, no "add a chapter".
     *
     * The rail gates all of those on `study.isOwner`, which stays true while an
     * owner previews their own exercise -- so a preview rendered the author's
     * editing affordances inside the player and showed them something no learner
     * would ever see. A preview that is not faithful defeats the point of having
     * one.
     */
    const learnerView = { ...study, isOwner: false };
    const rail = (status: HTMLElement, asLearner = false): HTMLElement =>
      buildStudyRail(asLearner ? learnerView : study, chapters, activeId, status, {
        previousListScrollTop,
        onSwitch: switchTo,
        onAdd: addChapter,
        chapterHref: (id) => studyChapterPath(study.id, id, window.location.pathname),
        onReorder: reorderChapters,
        onToggleFeatured: toggleFeatured,
        onOpenStudySettings: openStudySettings,
        onOpenChapterSettings: openChapterSettings,
        // A private draft has no audience, and an owner is the person who would
        // fix the mistake rather than report it. A CURATED set is the other
        // condition: the invitation says these are transcribed from historical
        // sources, which is true of ours and not of a stranger's study, and it
        // was showing on every public study on the site. `slug` is the catalogue
        // marker (migration 132).
        errata: study.visibility === 'public' && !study.isOwner && study.slug ? errataNote() : null,
      });
    // Practice and gamebook are alternative chapter modes, so an owner is offered
    // whichever one the chapter is already in, and practice's dock when it is in
    // neither. Showing both at once would invite turning both on, which the
    // player resolves by silently preferring practice.
    const practiceDock =
      study.isOwner && gamebookable && !chapter.gamebook
        ? buildPracticeDock({
            enabled: Boolean(chapter.practice),
            goal: chapter.practiceGoal ?? '',
            preview: previewMode,
            onToggle: (enabled, goal) => setPractice(chapter.id, enabled, goal),
            onPreview: setPreview,
          })
        : undefined;
    const lessonControls =
      study.isOwner && gamebookable && !chapter.practice
        ? buildLessonDock({
            enabled: chapter.gamebook,
            preview: previewMode,
            onToggle: (enabled) => setGamebook(chapter.id, enabled),
            onPreview: setPreview,
          })
        : undefined;

    root.replaceChildren(buildNav());

    // A practice chapter is played against the engine. It is checked BEFORE the
    // gamebook branch because the two flags are mutually exclusive in intent and
    // practice ignores the tree entirely: a chapter carrying both is a bug, and
    // silently rendering the tree-based player would hide it.
    const practiceGoal = chapter.practice ? parsePracticeGoal(chapter.practiceGoal) : null;
    if (practiceGoal && gamebookable && (!study.isOwner || previewMode)) {
      const aside = document.createElement('div');
      aside.className = 'study-aside';
      // The rail is a SECTION of a surrounding panel, not a standalone box: it
      // carries only a border-top and expects a card to supply the border,
      // background and radius (study.css: `.review-info-card .study-chapters`).
      // Mounted bare it renders as naked rows floating on the page. Wrap it the
      // way the review page does, with the set's name as the card's header --
      // which is also where lichess puts it, instead of a centred page title.
      const railCard = document.createElement('section');
      railCard.className = 'practice__panel practice__rail-card';
      const railHead = document.createElement('header');
      railHead.className = 'practice__rail-head';
      // An emblem beside the title, matching the /practice card the reader just
      // clicked and the illustration lichess puts in this slot. Derived from the
      // slug rather than stored: an endgame set is named for its piece.
      const railIcon = document.createElement('div');
      railIcon.className = 'practice__rail-icon';
      railIcon.innerHTML = renderXiangqiPiece(
        { color: 'red', role: railPieceForSlug(study.slug) },
        { size: 44 },
      );
      const railText = document.createElement('div');
      railText.className = 'practice__rail-headtext';
      const railTitle = document.createElement('h2');
      railTitle.className = 'practice__rail-title';
      railTitle.textContent = localizedStudyName(study.name, study.i18n);
      const railSub = document.createElement('p');
      railSub.className = 'practice__rail-sub';
      // The SET's tagline, not the current chapter's name. The chapter name is
      // already the highlighted row two lines below, and repeating it here spent
      // three wrapped lines saying nothing new. lichess puts a short standing
      // blurb in this slot ("Pin it to win it").
      railSub.textContent = firstSentence(localizedStudyDescription(study.description, study.i18n));
      railText.append(railTitle, railSub);
      railHead.append(railIcon, railText);
      // Always the learner's rail here: this branch only renders when the reader
      // is not the owner, or when the owner asked to preview.
      railCard.append(railHead, rail(statusSpan(false), true));
      // Rail only, no chat: a practice chapter is a solo drill against the
      // engine, and the chat panel rendered as an empty box under the rail.
      aside.append(railCard);
      // Dynamic: the practice player pulls in the client engine, and a study
      // view that never opens a practice chapter should not pay for it.
      const practiceNav = buildNav();
      const practiceIndex = chapters.findIndex((entry) => entry.id === chapter.id);
      const nextChapter = chapters[practiceIndex + 1];
      void import('./review/study-practice.js').then(({ mountPracticeChapter }) => {
        mountPracticeChapter(root, {
          chapter,
          nav: practiceNav,
          goal: practiceGoal,
          // No centred page header: the set's name lives in the rail card, the
          // exercise's goal lives under the board. A title floating above the
          // three columns belongs to neither and reads as a stray caption.
          aside,
          chapterId: chapter.id,
          studyId: study.id,
          progress: { index: practiceIndex + 1, total: chapters.length },
          // Omitted on the last chapter, so the button is not offered at all
          // rather than offered and inert.
          ...(nextChapter ? { onNext: () => void switchTo(nextChapter.id) } : {}),
        });
      });
      attachStudyTitleRow(root, study.id, study.visibility === 'public' ? likeButton(study) : null);
      return;
    }

    // A gamebook chapter is played (guess-the-move) by viewers and by the owner in
    // preview; the owner authors it in the review board otherwise.
    if (gamebookable && chapter.gamebook && (!study.isOwner || previewMode)) {
      const aside = document.createElement('div');
      aside.className = 'study-aside';
      aside.append(rail(statusSpan(study.isOwner)), buildStudyChat(study.id));
      mountXiangqiGamebook(root, {
        tree: chapter.root,
        orientation: chapter.orientation === 'black' ? 'black' : 'red',
        title: localizedStudyName(study.name, study.i18n),
        summary: localizedStudyName(chapter.name, chapter.i18n),
        aside,
      });
      attachStudyTitleRow(root, study.id, study.visibility === 'public' ? likeButton(study) : null);
      return;
    }

    let handle: TreeReviewHandle | null = null;
    activeHandle = null;
    const status = statusSpan(study.isOwner);
    let autosave: StudyAutosave | null = null;
    if (study.isOwner) {
      const updateStatus = (state: StudyAutosaveState, message: string): void => {
        setStatus(status, state, message);
        const actionable = state === 'conflict' || state === 'error';
        status.classList.toggle('is-actionable', actionable);
        if (actionable) {
          status.setAttribute('role', 'button');
          status.tabIndex = 0;
          status.title =
            state === 'conflict' ? t('study.chooseCopyToKeep') : t('study.retrySavingDraft');
        } else {
          status.removeAttribute('role');
          status.removeAttribute('tabindex');
          status.removeAttribute('title');
        }
      };
      autosave = createStudyAutosave({
        studyId: study.id,
        chapterId: chapter.id,
        initialTree: chapter.root,
        initialVersion: chapter.version,
        onStatus: updateStatus,
        onSaved: (tree, version) => {
          chapter.root = tree;
          chapter.version = version;
        },
      });
      chapter.root = autosave.initialTree;
      activeAutosave = autosave;
      const resolveOrRetry = (): void => {
        if (!autosave) return;
        if (!autosave.hasConflict()) {
          void autosave.flush();
          return;
        }
        openStudySaveRecoveryDialog({
          onKeepLocal: () => autosave?.overwriteRemote() ?? Promise.resolve(false),
          onUseServer: () => {
            autosave?.discard();
            window.location.reload();
          },
        });
      };
      status.addEventListener('click', resolveOrRetry);
      status.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        resolveOrRetry();
      });
    }

    // The board stacks are code-split per variant, so the mount is async: the
    // page renders its nav, then the board lands. A stale mount (the reader
    // switched chapters while the chunk loaded) is dropped on arrival.
    const mountToken = ++mountSeq;
    void mountStudyReview(variant, root, {
      reviewSurface: 'study',
      pageClassName: `${variant}-review study-review`,
      ariaLabel: t('study.ariaStudy'),
      // Empty eyebrow: the info card leads with the study name itself.
      eyebrow: '',
      title: localizedStudyName(study.name, study.i18n),
      // The description is STUDY-level and the rail is the study column, so it
      // belongs here under the study's own name. It spent a while in the
      // underboard "About" tab, which is per-chapter: that printed the same 745
      // characters under all 92 chapters of a manual, above the moves, and left
      // the tab permanently open to hold it. Clamped, because it is reference
      // rather than reading.
      summary: localizedStudyDescription(study.description, study.i18n),
      boardAriaLabel: `${studyVariantLabel(variant)} board`,
      // A chapter of a real game can now say who had which side. Without this
      // the only place identity could live was the chapter title, which cannot
      // follow a board flip and reads as a spoiler.
      ...(chapter.tags?.red || chapter.tags?.black
        ? (() => {
            const named = localizedChapterTags(chapter.tags ?? {}, chapter.i18n);
            return {
              seatLabels: true,
              players: {
                ...(named.red ? { red: named.red } : {}),
                ...(named.black ? { black: named.black } : {}),
              },
            };
          })()
        : {}),
      actions: rail(status),
      aboutTab: { label: t('study.aboutTab'), body: aboutPanel(study, chapter) },
      // PGN download sits with FEN/Share/Moves rather than in the owner-only
      // settings menu: a study whose work cannot leave it is a trap, so every
      // viewer gets it.
      ...(pgnExportable() ? { shareExtra: [pgnExportRow()] } : {}),
      details: buildStudyChat(study.id),
      gamebookEditing: gamebookable && chapter.gamebook && study.isOwner,
      annotationLessonControls: lessonControls,
      annotationPracticeControls: practiceDock,
      annotationEditing: study.isOwner,
      // A study is read forward. Landing on the final position of a 60-ply
      // annotated game means rewinding before you can start.
      initialPosition: 'start',
      // The chapter's own orientation, not the reader's last flip: a black
      // repertoire is authored to be read from black's side, and the Flip
      // button resets on every chapter switch because the board remounts.
      initialFlipped: chapter.orientation === 'black',
      // Owner-only: the under-board menu's "Set as default view" saves whichever
      // way the board is currently facing, so Flip board composes with it.
      ...(study.isOwner
        ? {
            saveDefaultOrientation: async (flipped: boolean): Promise<string | null> => {
              const error = await saveOrientation(chapter, flipped ? 'black' : 'red');
              setStatus(status, error ? 'error' : 'saved', error ?? t('review.defaultViewSaved'));
              return error;
            },
          }
        : {}),
      initialTree: autosave?.initialTree ?? chapter.root,
      // A composition chapter (SerializedTree.rootFen) roots the board at its
      // hand-set position; an invalid FEN degrades to the standard start, same
      // posture as a corrupt blob.
      rootFen: chapter.root.rootFen,
      onChange: study.isOwner
        ? () => {
            // Keep the in-memory chapter tree fresh so switching tabs never drops an
            // edit that has not been flushed to the server yet.
            if (!handle || !autosave) return;
            chapter.root = handle.serialize();
            autosave.markDirty(chapter.root);
          }
        : // A viewer's first move is the moment "is this being saved?" becomes a
          // real question. Answer it then, not on arrival.
          () => {
            status.hidden = false;
          },
    })
      .then((mounted) => {
        if (mountToken !== mountSeq) return;
        attachStudyTitleRow(
          root,
          study.id,
          study.visibility === 'public' ? likeButton(study) : null,
        );
        handle = mounted;
        activeHandle = mounted;
      })
      .catch(() => renderError(root, 415));
  }

  renderActive();
}

/**
 * Decorate the info card's title: the study thumbnail on the left, the favourite
 * on the right.
 *
 * The shell builds the card as title + summary + the chapter rail, with no slot
 * beside the heading, so both of these are attached after the mount. The heart
 * belongs here rather than in the underboard because it favourites the STUDY,
 * and the underboard is per-chapter -- it was rendering a study-wide control
 * under all 92 chapters.
 *
 * The row is built whenever there is anything to put in it, not only when a
 * thumbnail exists: only five studies have one.
 */
function attachStudyTitleRow(root: HTMLElement, studyId: string, like: HTMLElement | null): void {
  const title = root.querySelector<HTMLElement>('.review-info-card__title, .gamebook__title');
  if (!title) return;
  const existing = title.closest('.study-page__title-row');
  if (existing) {
    // A rerender reuses the row; do not stack a second heart into it.
    if (like && !existing.querySelector('.study-actions__like')) existing.append(like);
    return;
  }
  const thumbnail = buildStudyThumbnail(studyId, 'study-page__thumbnail', 'eager');
  if (!thumbnail && !like) return;

  const summary = title.nextElementSibling;
  const hasSummary =
    summary instanceof HTMLElement &&
    (summary.classList.contains('review-info-card__summary') ||
      summary.classList.contains('gamebook__summary'));
  const copy = document.createElement('div');
  copy.className = 'study-page__title-copy';
  const row = document.createElement('div');
  row.className = 'study-page__title-row';
  title.before(row);
  copy.append(title, ...(hasSummary ? [summary] : []));
  row.append(...(thumbnail ? [thumbnail] : []), copy, ...(like ? [like] : []));
  if (hasSummary) attachSummaryToggle(copy, summary);
}

/**
 * A show-more control for the clamped study description, added only when the
 * text is actually cut off.
 *
 * Explicitly a button rather than `:hover { line-clamp: unset }`: expanding on
 * hover pushed the chapter list down whenever the cursor crossed the rail, which
 * is the same content-moving-under-the-reader problem the caption's reserved
 * height exists to prevent, and worse for being unrequested.
 */
function attachSummaryToggle(copy: HTMLElement, summary: HTMLElement): void {
  // The overflow test has to run after layout: called straight from the mount,
  // scrollHeight and clientHeight are both 0 and every description looks short.
  // The rail's scroll restore guards the same way, for the same reason.
  let attempts = 0;
  const measure = (): void => {
    if (!summary.isConnected || summary.clientHeight === 0) {
      if (attempts++ < 20) requestAnimationFrame(measure);
      return;
    }
    // scrollHeight only exceeds clientHeight once the clamp has actually bitten,
    // so a short description gets no control at all.
    if (summary.scrollHeight <= summary.clientHeight + 1) return;
    if (copy.querySelector('.study-page__summary-toggle')) return;
    copy.append(buildSummaryToggle(summary));
  };
  requestAnimationFrame(measure);
}

function buildSummaryToggle(summary: HTMLElement): HTMLElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'study-page__summary-toggle';
  button.textContent = t('study.showMore');
  button.addEventListener('click', () => {
    const expanded = summary.classList.toggle('is-expanded');
    button.textContent = expanded ? t('study.showLess') : t('study.showMore');
    button.setAttribute('aria-expanded', String(expanded));
  });
  button.setAttribute('aria-expanded', 'false');
  return button;
}

export function studyChapterPath(studyId: string, chapterId: string, pathname = '/'): string {
  const localePrefix = /^\/(zh-hans|zh-hant)(?:\/|$)/.exec(pathname)?.[1];
  return `${localePrefix ? `/${localePrefix}` : ''}/study/${encodeURIComponent(
    studyId,
  )}/${encodeURIComponent(chapterId)}`;
}

export function chapterIdFromStudyPath(pathname: string, studyId: string): string | null {
  const match = /^(?:\/(?:zh-hans|zh-hant))?\/study\/([A-Za-z0-9]+)\/([A-Za-z0-9]+)\/?$/.exec(
    pathname,
  );
  return match?.[1] === studyId ? match[2]! : null;
}

/** The save-state readout in the chapter rail. Only an owner's board writes
 *  anywhere, but a viewer's board takes moves exactly like the owner's and said
 *  nothing about where they went, so a signed-in non-owner read their own
 *  scratch analysis as stored on someone else's study. A viewer now gets a
 *  readout too, held back until their first move: before that there is no
 *  question to answer, and every visitor to a public study is a viewer. */
function statusSpan(isOwner: boolean): HTMLElement {
  const status = document.createElement('span');
  status.className = 'study-actions__status';
  if (!isOwner) {
    status.dataset.state = 'viewer';
    status.textContent = t('study.viewerNotSaved');
    status.title = t('study.viewerNotSavedHint');
    status.hidden = true;
    return status;
  }
  status.dataset.state = 'saved';
  status.textContent = t('study.saved');
  return status;
}

/** The underboard "About" tab: the study's own description, plus the favorite and
 *  errata affordances. Pulling these out of the left rail leaves it as just the
 *  chapter list and chat, which was the source of the double-scroll clutter. */
function aboutPanel(study: StudyDto, chapter: ChapterDto): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'study-about';

  // The chapter's name alone. Prefixing the study name repeated it a third time
  // on one screen -- it is already the chapter-list header and the page title --
  // and on a manual whose study name runs to 57 characters that cost two lines
  // above the fold on every chapter.
  const title = document.createElement('h3');
  title.className = 'study-about__title';
  title.textContent = localizedStudyName(chapter.name, chapter.i18n);
  panel.append(title);

  // The chapter's own introduction, which used to sit in the under-board caption
  // and only at the start position. It is chapter-level prose sharing a slot
  // with per-move notes an order of magnitude shorter, so stepping off the start
  // resized the page by ~300px. Here it is chapter-level content in the
  // chapter-level tab, and readable from any position in the game rather than
  // only from the first.
  // displayComment, not the raw `text`: these studies are Chinese-first, so the
  // base column holds Chinese and English lives in the comment's locale overlay.
  // Reading `text` directly put Chinese prose on the English page.
  const intro = displayComment(chapter.root.root.annotations?.comments?.[0])?.trim();
  if (intro) {
    const prose = document.createElement('p');
    prose.className = 'study-about__intro';
    appendLinkedText(prose, intro);
    panel.append(prose);
  }

  // Event, date, result, source: the other genuinely per-chapter block.
  panel.append(gameDetails(chapter));

  // The favourite and the errata invitation used to live here. Both are
  // properties of the STUDY and the underboard is per-chapter, so they were
  // repeating a study-wide control under all 92 chapters and pushing the moves
  // down on every one. They now sit in the chapter rail, which is the
  // study-level block. What stays is the visibility chip, which the owner wants
  // while editing a chapter.
  const row = document.createElement('div');
  row.className = 'study-about__row';
  if (study.isOwner) {
    const visibility = document.createElement('span');
    visibility.className = 'study-about__visibility';
    visibility.textContent = study.visibility;
    row.append(visibility);
  }
  panel.append(row);
  return panel;
}

/**
 * The chapter's game details: event, date, result, and where the record came
 * from.
 *
 * A chapter of a real game carries these as PGN-style tags, and until now the
 * only one the study page rendered was the pair of player names beside the
 * board. Everything else was stored and shown nowhere, so a study of ten
 * world-championship games could not tell you which championship, which year,
 * or who won without reading it off the moves.
 *
 * Rendered as a definition list rather than a sentence: these are four
 * independent facts of which any subset may be absent, and a sentence would
 * have to be rebuilt for each combination.
 */
export function gameDetails(chapter: ChapterDto): HTMLElement {
  const list = document.createElement('dl');
  list.className = 'study-about__game';
  const tags = localizedChapterTags(chapter.tags ?? {}, chapter.i18n);
  const rows: Array<[string, string]> = [
    [t('study.gameEvent'), tags.event ?? ''],
    [t('study.gameDate'), tags.date ?? ''],
    [t('study.gameResult'), tags.result ?? ''],
  ];
  for (const [label, value] of rows) {
    if (!value) continue;
    const term = document.createElement('dt');
    term.textContent = label;
    const detail = document.createElement('dd');
    detail.textContent = value;
    list.append(term, detail);
  }
  // The source is a URL the author recorded, so it renders as a link to it
  // rather than as the raw address, which is rarely readable.
  if (tags.site && /^https?:\/\//i.test(tags.site)) {
    const term = document.createElement('dt');
    term.textContent = t('study.gameSource');
    const detail = document.createElement('dd');
    const link = document.createElement('a');
    link.href = tags.site;
    link.rel = 'nofollow noopener noreferrer';
    link.target = '_blank';
    try {
      link.textContent = new URL(tags.site).hostname.replace(/^www\./, '');
    } catch {
      link.textContent = tags.site;
    }
    detail.append(link);
    list.append(term, detail);
  }
  // An empty list is hidden by CSS rather than skipped here, so the caller does
  // not have to know whether a chapter has tags.
  return list;
}

/** Invite corrections. Several studies here are transcriptions of woodblock
 *  prints, where a misread glyph is a genuine possibility; claiming otherwise
 *  would be the untrustworthy move. Saying so plainly and routing readers to
 *  /contact costs a few lines and is the honest posture.
 *
 *  A card with a heading and a paragraph was 120px of every chapter, which is a
 *  lot of permanent furniture for an invitation almost nobody accepts. The
 *  offer survives as one line; the explanation moves to the title attribute,
 *  where a reader who is actually about to report something will find it. */
function errataNote(): HTMLElement {
  const note = document.createElement('aside');
  note.className = 'study-errata study-errata--inline';

  const link = document.createElement('a');
  link.className = 'study-errata__link';
  link.href = localizedHref('/contact');
  link.textContent = t('study.errataAction');
  link.title = t('study.errataBody');

  const lead = document.createElement('span');
  lead.className = 'study-errata__lead';
  lead.textContent = t('study.errataTitle');

  note.append(lead, link);
  return note;
}

function likeButton(study: StudyDto): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'study-actions__like';
  const render = (): void => {
    button.classList.toggle('is-liked', study.likedByViewer);
    button.textContent = `${study.likedByViewer ? '♥' : '♡'} ${study.likeCount}`;
    button.setAttribute('aria-pressed', String(study.likedByViewer));
    button.setAttribute('aria-label', study.likedByViewer ? t('study.unlike') : t('study.like'));
  };
  render();
  button.addEventListener('click', () => {
    button.disabled = true;
    void fetch(`/api/studies/${encodeURIComponent(study.id)}/like`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ liked: !study.likedByViewer }),
    })
      .then(async (response) => {
        if (response.status === 401) {
          button.title = t('study.signInToLike');
          return;
        }
        if (!response.ok) return;
        const state = (await response.json()) as { likeCount: number; likedByViewer: boolean };
        study.likeCount = state.likeCount;
        study.likedByViewer = state.likedByViewer;
        render();
      })
      .finally(() => {
        button.disabled = false;
      });
  });
  return button;
}

/**
 * Owner control for practice mode: the flag, its goal, and a preview.
 *
 * Without this a practice chapter could only be created by hitting the API, and
 * its author could never see what a learner sees -- the player only mounts for
 * non-owners. That is how the gamebook ended up built, shipped and empty.
 *
 * Reuses the lesson dock's classes so the two chapter modes are configured in
 * visibly the same place rather than looking like unrelated features.
 */
function buildPracticeDock(opts: {
  enabled: boolean;
  goal: string;
  preview: boolean;
  onToggle(enabled: boolean, goal: string): Promise<string | null>;
  onPreview(preview: boolean): void;
}): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'study-lesson-dock';
  const copy = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = 'Practice';
  const description = document.createElement('p');
  description.textContent = opts.enabled
    ? 'Played against the engine from this position.'
    : 'Set a goal and the engine plays the defence. The move tree is ignored.';
  copy.append(title, description);

  const actions = document.createElement('div');
  actions.className = 'study-lesson-dock__actions';

  const goalInput = document.createElement('input');
  goalInput.type = 'text';
  goalInput.className = 'study-lesson-dock__goal';
  goalInput.value = opts.goal;
  goalInput.placeholder = 'mate in 3';
  goalInput.setAttribute('aria-label', 'Practice goal');

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = opts.enabled ? 'study-lesson-dock__toggle is-on' : 'study-lesson-dock__toggle';
  toggle.textContent = opts.enabled ? 'Practice on' : 'Enable practice';
  toggle.setAttribute('aria-pressed', String(opts.enabled));

  const feedback = document.createElement('span');
  feedback.className = 'study-lesson-dock__feedback';
  feedback.setAttribute('aria-live', 'polite');

  toggle.addEventListener('click', () => {
    toggle.disabled = true;
    feedback.textContent = '';
    void opts
      .onToggle(!opts.enabled, goalInput.value)
      .then((error) => {
        if (!error) return;
        toggle.disabled = false;
        feedback.textContent = error;
      })
      .catch(() => {
        toggle.disabled = false;
        feedback.textContent = t('study.requestFailed');
      });
  });

  if (!opts.enabled) actions.append(goalInput);
  actions.append(toggle);
  if (opts.enabled) {
    const preview = document.createElement('button');
    preview.type = 'button';
    preview.className = 'study-lesson-dock__preview';
    preview.textContent = opts.preview ? 'Back to editing' : 'Preview exercise';
    preview.addEventListener('click', () => opts.onPreview(!opts.preview));
    actions.append(preview);
  }
  panel.append(copy, actions, feedback);
  return panel;
}

function buildLessonDock(opts: {
  enabled: boolean;
  preview: boolean;
  onToggle(enabled: boolean): Promise<string | null>;
  onPreview(preview: boolean): void;
}): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'study-lesson-dock';
  const copy = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = t('study.lessonTitle');
  const description = document.createElement('p');
  description.textContent = opts.enabled ? t('study.lessonOnCopy') : t('study.lessonOffCopy');
  copy.append(title, description);

  const actions = document.createElement('div');
  actions.className = 'study-lesson-dock__actions';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = opts.enabled ? 'study-lesson-dock__toggle is-on' : 'study-lesson-dock__toggle';
  toggle.textContent = opts.enabled ? t('study.lessonOn') : t('study.enableLesson');
  toggle.setAttribute('aria-pressed', String(opts.enabled));
  const feedback = document.createElement('span');
  feedback.className = 'study-lesson-dock__feedback';
  feedback.setAttribute('aria-live', 'polite');
  toggle.addEventListener('click', () => {
    toggle.disabled = true;
    void opts
      .onToggle(!opts.enabled)
      .then((error) => {
        if (!error) return;
        toggle.disabled = false;
        feedback.textContent = error;
      })
      .catch(() => {
        toggle.disabled = false;
        feedback.textContent = t('study.requestFailed');
      });
  });
  actions.append(toggle);
  if (opts.enabled) {
    const preview = document.createElement('button');
    preview.type = 'button';
    preview.className = 'study-lesson-dock__preview';
    preview.textContent = opts.preview ? t('study.backToEditing') : t('study.previewLesson');
    preview.addEventListener('click', () => opts.onPreview(!opts.preview));
    actions.append(preview);
  }
  panel.append(copy, actions, feedback);
  return panel;
}

async function responseError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === 'string') {
      const readable = body.error.replaceAll('_', ' ');
      return `${readable.charAt(0).toUpperCase() + readable.slice(1)}.`;
    }
  } catch {
    // The fallback is more useful than exposing a malformed server response.
  }
  return fallback;
}

function setStatus(el: HTMLElement, state: string, text: string): void {
  el.dataset.state = state;
  el.textContent = text;
}

function notice(text: string): HTMLElement {
  const shell = document.createElement('main');
  shell.className = 'dxq-postgame__notice';
  const heading = document.createElement('h1');
  heading.textContent = text;
  shell.append(heading);
  return shell;
}
function renderError(root: HTMLElement, status: number): void {
  const shell = document.createElement('main');
  shell.className = 'dxq-postgame__error';
  const title = document.createElement('h1');
  title.textContent = status === 404 ? 'Study not found' : 'Study unavailable';
  const body = document.createElement('p');
  body.textContent =
    status === 404
      ? 'This study is private or does not exist.'
      : status === 415
        ? 'This study uses a variant that is not supported yet.'
        : 'The study could not be loaded.';
  shell.append(title, body);
  root.replaceChildren(buildNav(), shell);
}
