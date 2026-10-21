// Phone study chrome (#576): a one-line chapter bar under the site header, a
// bottom dock (Chapters, Info, Back, Next), a half sheet listing every chapter
// and an Info sheet that borrows the study's own blocks (title card, engine,
// About and Share, description, chat) so the page itself stops at the moves.
//
// All of it is built on every viewport and shown only under the phone query in
// study.css, so tablet and desktop render exactly as before. Back and Next drive
// the board's own move band (`[data-replay]` buttons) rather than reaching into
// the tree review: the band already owns the cursor, its retro guard and its
// bounds, and its next button going disabled is the "end of this line" signal
// that turns Next into "Next chapter".

import { t } from './i18n/catalog.js';
import { revealCurrentMove } from './review/analysis-phone-bar.js';
import { buildChapterGameRow, type GameChapter } from './study-chapter-games.js';
import { localizedStudyName } from './study-i18n.js';

export type StudyPhoneChapter = GameChapter & { name: string };

export interface StudyPhoneOptions {
  studyTitle: string;
  chapters: readonly StudyPhoneChapter[];
  activeId: string;
  /** The study's focus player, so a game row's result chip reads win/draw/loss. */
  gameFocus: string | null;
  /** The event heading that opens a group before this chapter, if any. */
  groupHeading: (id: string) => string | null;
  chapterHref: (id: string) => string;
  onSwitch: (id: string) => void;
}

export interface StudyPhoneHandle {
  bar: HTMLElement;
  dock: HTMLElement;
  /** Puts the bar under the site nav and the dock at the page foot. Safe to
   *  call again after a mount replaced the root's children. */
  attach(root: HTMLElement): void;
  /** Wires Back/Next to the move band inside `scope`; without a band they hide. */
  bindMoveNav(scope: ParentNode): void;
  openSheet(opener?: HTMLElement | null): void;
  openInfo(opener?: HTMLElement | null): void;
  closeSheet(): void;
  isSheetOpen(): boolean;
  destroy(): void;
}

const SHEET_OPEN_CLASS = 'study-sheet-open';
/** What the Info sheet borrows from the page, in the order it shows them. Any
 *  a chapter lacks (practice, gamebook) is skipped. */
const INFO_BLOCKS = [
  '.review-info-card',
  '.engine-panel',
  '.review-underboard-panel',
  '.study-description',
  '.review-spectator-chat',
] as const;
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select, [tabindex]:not([tabindex="-1"])';

function chapterLabel(chapter: StudyPhoneChapter): string {
  return localizedStudyName(chapter.name, chapter.i18n);
}

function dockButton(kind: string, icon: string, label: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `study-phone-dock__button study-phone-dock__button--${kind}`;
  button.dataset.studyPhone = kind;
  const glyph = document.createElement('span');
  glyph.className = 'study-phone-dock__icon';
  glyph.setAttribute('aria-hidden', 'true');
  glyph.textContent = icon;
  const text = document.createElement('span');
  text.className = 'study-phone-dock__label';
  text.textContent = label;
  button.append(glyph, text);
  return button;
}

function setDockLabel(button: HTMLButtonElement, label: string): void {
  const text = button.querySelector('.study-phone-dock__label');
  if (text) text.textContent = label;
}

export function createStudyPhone(options: StudyPhoneOptions): StudyPhoneHandle {
  const { chapters } = options;
  const index = Math.max(
    0,
    chapters.findIndex((chapter) => chapter.id === options.activeId),
  );
  const active = chapters[index];
  const nextChapter = chapters[index + 1] ?? null;
  const total = chapters.length;

  // ---- Bar: chapter name, "N / M" pill (the study title is in Info) ---------
  const bar = document.createElement('div');
  bar.className = 'study-phone-bar';
  const titles = document.createElement('div');
  titles.className = 'study-phone-bar__titles';
  const chapterLine = document.createElement('p');
  chapterLine.className = 'study-phone-bar__chapter';
  chapterLine.textContent = active ? chapterLabel(active) : '';
  titles.append(chapterLine);
  const pill = document.createElement('button');
  pill.type = 'button';
  pill.className = 'study-phone__pill';
  pill.textContent = `${index + 1} / ${total}`;
  pill.setAttribute('aria-haspopup', 'dialog');
  pill.setAttribute('aria-expanded', 'false');
  pill.setAttribute(
    'aria-label',
    t('study.phone.chapterPill', { index: String(index + 1), total: String(total) }),
  );
  bar.append(titles, pill);

  // ---- Dock: Chapters, Info, Back, Next ----------------------------------
  const dock = document.createElement('div');
  dock.className = 'study-phone-dock';
  const chaptersButton = dockButton('chapters', '☰', t('study.chapters'));
  chaptersButton.setAttribute('aria-haspopup', 'dialog');
  chaptersButton.setAttribute('aria-expanded', 'false');
  const infoButton = dockButton('info', 'ⓘ', t('study.phone.info'));
  infoButton.setAttribute('aria-haspopup', 'dialog');
  infoButton.setAttribute('aria-expanded', 'false');
  const backButton = dockButton('back', '‹', t('study.phone.back'));
  backButton.setAttribute('aria-label', t('study.phone.previousMove'));
  const nextButton = dockButton('next', '›', t('study.phone.next'));
  dock.append(chaptersButton, infoButton, backButton, nextButton);
  backButton.hidden = true;
  nextButton.hidden = true;

  // ---- Sheet --------------------------------------------------------------
  const overlay = document.createElement('div');
  overlay.className = 'study-sheet-overlay';
  const sheet = document.createElement('section');
  sheet.className = 'study-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  const headingId = `study-sheet-title-${Math.random().toString(36).slice(2, 8)}`;
  sheet.setAttribute('aria-labelledby', headingId);
  const grabber = document.createElement('div');
  grabber.className = 'study-sheet__grabber';
  grabber.setAttribute('aria-hidden', 'true');
  const head = document.createElement('div');
  head.className = 'study-sheet__head';
  const heading = document.createElement('h2');
  heading.id = headingId;
  heading.className = 'study-sheet__title';
  heading.textContent =
    total === 1 ? t('study.chapterCountOne') : t('study.chapterCount', { count: String(total) });
  const searchToggle = document.createElement('button');
  searchToggle.type = 'button';
  searchToggle.className = 'study-sheet__icon-button study-sheet__search-toggle';
  searchToggle.setAttribute('aria-label', t('study.phone.searchChapters'));
  searchToggle.setAttribute('aria-expanded', 'false');
  searchToggle.textContent = '⌕';
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'study-sheet__icon-button study-sheet__close';
  closeButton.setAttribute('aria-label', t('study.phone.closeChapters'));
  closeButton.textContent = '×';
  head.append(heading, searchToggle, closeButton);

  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'study-sheet__search';
  search.placeholder = t('study.phone.searchChapters');
  search.setAttribute('aria-label', t('study.phone.searchChapters'));
  search.hidden = true;

  const list = document.createElement('ol');
  list.className = 'study-sheet__list';
  const empty = document.createElement('p');
  empty.className = 'study-sheet__empty';
  empty.textContent = t('study.phone.noChapterMatch');
  empty.hidden = true;

  type Entry = { row: HTMLLIElement; group: HTMLLIElement | null; text: string };
  const entries: Entry[] = [];
  let currentGroup: HTMLLIElement | null = null;
  chapters.forEach((chapter, position) => {
    const groupText = options.groupHeading(chapter.id);
    if (groupText) {
      const group = document.createElement('li');
      group.className = 'study-sheet__group';
      group.setAttribute('role', 'presentation');
      group.textContent = groupText;
      list.append(group);
      currentGroup = group;
    }
    const row = document.createElement('li');
    row.className = 'study-sheet__row';
    const link = document.createElement('a');
    link.className = 'study-sheet__link';
    link.href = options.chapterHref(chapter.id);
    link.dataset.chapterId = chapter.id;
    const isCurrent = chapter.id === active?.id;
    if (isCurrent) {
      row.classList.add('is-current');
      link.setAttribute('aria-current', 'page');
    }
    const num = document.createElement('span');
    num.className = 'study-sheet__num';
    num.textContent = String(position + 1);
    const name = chapterLabel(chapter);
    const game = buildChapterGameRow(chapter, options.gameFocus);
    if (game) {
      link.setAttribute('aria-label', `${position + 1}. ${name}`);
      link.append(num, game);
    } else {
      const label = document.createElement('span');
      label.className = 'study-sheet__name';
      label.textContent = name;
      link.append(num, label);
    }
    link.addEventListener('click', (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      event.preventDefault();
      closeSheet({ restoreFocus: false });
      if (chapter.id !== active?.id) options.onSwitch(chapter.id);
    });
    row.append(link);
    list.append(row);
    entries.push({
      row,
      group: currentGroup,
      text: `${position + 1} ${name} ${link.textContent ?? ''}`.toLocaleLowerCase(),
    });
  });

  const filter = (): void => {
    const query = search.value.trim().toLocaleLowerCase();
    const shownGroups = new Set<HTMLLIElement>();
    let shown = 0;
    for (const entry of entries) {
      const match = !query || entry.text.includes(query);
      entry.row.hidden = !match;
      if (match) {
        shown += 1;
        if (entry.group) shownGroups.add(entry.group);
      }
    }
    for (const group of list.querySelectorAll<HTMLLIElement>('.study-sheet__group')) {
      group.hidden = !shownGroups.has(group);
    }
    empty.hidden = shown > 0;
  };
  search.addEventListener('input', filter);
  searchToggle.addEventListener('click', () => {
    const show = search.hidden;
    search.hidden = !show;
    searchToggle.setAttribute('aria-expanded', String(show));
    if (show) search.focus();
    else {
      search.value = '';
      filter();
      searchToggle.focus();
    }
  });

  sheet.append(grabber, head, search, list, empty);

  // ---- Info sheet -----------------------------------------------------------
  const info = document.createElement('section');
  info.className = 'study-sheet study-info-sheet';
  info.setAttribute('role', 'dialog');
  info.setAttribute('aria-modal', 'true');
  const infoHeadingId = `${headingId}-info`;
  info.setAttribute('aria-labelledby', infoHeadingId);
  const infoGrabber = grabber.cloneNode() as HTMLElement;
  const infoHead = document.createElement('div');
  infoHead.className = 'study-sheet__head';
  const infoHeading = document.createElement('h2');
  infoHeading.id = infoHeadingId;
  infoHeading.className = 'study-sheet__title';
  infoHeading.textContent = options.studyTitle;
  const infoClose = document.createElement('button');
  infoClose.type = 'button';
  infoClose.className = 'study-sheet__icon-button study-sheet__close';
  infoClose.setAttribute('aria-label', t('study.phone.closeInfo'));
  infoClose.textContent = '×';
  infoHead.append(infoHeading, infoClose);
  const infoBody = document.createElement('div');
  infoBody.className = 'study-info-sheet__body';
  info.append(infoGrabber, infoHead, infoBody);

  // Where each borrowed block came from, to put it back on close.
  let homes: { el: HTMLElement; parent: ParentNode; next: Node | null }[] = [];
  let scope: ParentNode | null = null;

  function lendInfo(): void {
    homes = [];
    if (!scope) return;
    for (const selector of INFO_BLOCKS) {
      const el = scope.querySelector<HTMLElement>(selector);
      if (!el?.parentNode || infoBody.contains(el)) continue;
      homes.push({ el, parent: el.parentNode, next: el.nextSibling });
      infoBody.append(el);
    }
  }

  function returnInfo(): void {
    // Last lent goes back first, so a sibling it was placed before is home.
    for (const { el, parent, next } of homes.reverse()) parent.insertBefore(el, next);
    homes = [];
  }

  let opener: HTMLElement | null = null;
  let openPanel: HTMLElement | null = null;
  let open = false;

  const onKeydown = (event: KeyboardEvent): void => {
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSheet();
      return;
    }
    if (event.key !== 'Tab') return;
    const panel = openPanel ?? sheet;
    const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (el) => !el.hidden && !el.closest('[hidden]'),
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    const current = document.activeElement;
    if (event.shiftKey && (current === first || !panel.contains(current))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (current === last || !panel.contains(current))) {
      event.preventDefault();
      first.focus();
    }
  };

  function setExpanded(value: boolean): void {
    const chaptersOpen = value && openPanel === sheet;
    pill.setAttribute('aria-expanded', String(chaptersOpen));
    chaptersButton.setAttribute('aria-expanded', String(chaptersOpen));
    infoButton.setAttribute('aria-expanded', String(value && openPanel === info));
  }

  function show(panel: HTMLElement, from: HTMLElement | null): void {
    open = true;
    openPanel = panel;
    opener =
      from ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    document.body.append(overlay, panel);
    document.documentElement.classList.add(SHEET_OPEN_CLASS);
    document.addEventListener('keydown', onKeydown);
    setExpanded(true);
  }

  function openInfo(from: HTMLElement | null = null): void {
    if (open) return;
    lendInfo();
    show(info, from);
    infoBody.scrollTop = 0;
    infoClose.focus();
  }

  function openSheet(from: HTMLElement | null = null): void {
    if (open) return;
    show(sheet, from);
    // Open on the reader's place in a long list, not on chapter 1.
    const current = list.querySelector<HTMLElement>('.is-current');
    if (current && typeof current.scrollIntoView === 'function') {
      current.scrollIntoView({ block: 'center' });
    }
    closeButton.focus();
  }

  function closeSheet({ restoreFocus = true }: { restoreFocus?: boolean } = {}): void {
    if (!open) return;
    open = false;
    overlay.remove();
    sheet.remove();
    info.remove();
    returnInfo();
    document.documentElement.classList.remove(SHEET_OPEN_CLASS);
    document.removeEventListener('keydown', onKeydown);
    setExpanded(false);
    openPanel = null;
    if (!search.hidden) {
      search.value = '';
      search.hidden = true;
      searchToggle.setAttribute('aria-expanded', 'false');
      filter();
    }
    if (restoreFocus && opener?.isConnected) opener.focus();
    opener = null;
  }

  pill.addEventListener('click', () => openSheet(pill));
  chaptersButton.addEventListener('click', () => openSheet(chaptersButton));
  closeButton.addEventListener('click', () => closeSheet());
  infoButton.addEventListener('click', () => openInfo(infoButton));
  infoClose.addEventListener('click', () => closeSheet());
  overlay.addEventListener('click', () => closeSheet());

  // ---- Back / Next -----------------------------------------------------------
  let observer: MutationObserver | null = null;
  let movesObserver: MutationObserver | null = null;
  let bandPrev: HTMLButtonElement | null = null;
  let bandNext: HTMLButtonElement | null = null;

  const syncNav = (): void => {
    if (!bandPrev || !bandNext) return;
    backButton.disabled = bandPrev.disabled;
    const atEnd = bandNext.disabled;
    const toChapter = atEnd && nextChapter !== null;
    nextButton.dataset.mode = toChapter ? 'chapter' : 'move';
    setDockLabel(nextButton, toChapter ? t('study.phone.nextChapter') : t('study.phone.next'));
    nextButton.setAttribute(
      'aria-label',
      toChapter ? t('study.phone.nextChapter') : t('study.phone.nextMove'),
    );
    nextButton.disabled = atEnd && nextChapter === null;
  };

  // The band moves the cursor synchronously, so the dock re-reads it right
  // after its own clicks; the observer below covers every other way the cursor
  // moves (move list, keyboard, the band itself).
  backButton.addEventListener('click', () => {
    bandPrev?.click();
    syncNav();
  });
  nextButton.addEventListener('click', () => {
    if (nextButton.dataset.mode === 'chapter' && nextChapter) {
      options.onSwitch(nextChapter.id);
      return;
    }
    bandNext?.click();
    syncNav();
  });

  function bindMoveNav(within: ParentNode): void {
    observer?.disconnect();
    observer = null;
    movesObserver?.disconnect();
    movesObserver = null;
    scope = within;
    bandPrev = within.querySelector<HTMLButtonElement>('button[data-replay="prev"]');
    bandNext = within.querySelector<HTMLButtonElement>('button[data-replay="next"]');
    // The phone move strip is one sideways row: keep the current move in it.
    const moves = within.querySelector<HTMLElement>('.review-move-list');
    if (moves && typeof MutationObserver === 'function') {
      movesObserver = new MutationObserver(() => revealCurrentMove(moves));
      movesObserver.observe(moves, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['class'],
      });
      revealCurrentMove(moves);
    }
    const bound = Boolean(bandPrev && bandNext);
    backButton.hidden = !bound;
    nextButton.hidden = !bound;
    if (!bound) return;
    observer = new MutationObserver(syncNav);
    observer.observe(bandPrev!, { attributes: true, attributeFilter: ['disabled'] });
    observer.observe(bandNext!, { attributes: true, attributeFilter: ['disabled'] });
    syncNav();
  }

  function attach(root: HTMLElement): void {
    const nav = root.querySelector<HTMLElement>(':scope > .site-nav');
    if (nav) nav.after(bar);
    else root.prepend(bar);
    root.append(dock);
    scope = root;
  }

  function destroy(): void {
    closeSheet({ restoreFocus: false });
    observer?.disconnect();
    observer = null;
    movesObserver?.disconnect();
    movesObserver = null;
    bar.remove();
    dock.remove();
  }

  return {
    bar,
    dock,
    attach,
    bindMoveNav,
    openSheet,
    openInfo,
    closeSheet: () => closeSheet(),
    isSheetOpen: () => open,
    destroy,
  };
}
