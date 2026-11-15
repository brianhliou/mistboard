import { t } from '../i18n/catalog.js';
import './study-move-note.css';

/** A stable preview slot; the full text is read in a modal sheet. */
export function createStudyMoveNote(root: HTMLElement, signal: AbortSignal) {
  const el = document.createElement('section');
  el.className = 'review-comment-panel review-comment-panel--study';
  el.hidden = true;
  el.setAttribute('aria-live', 'polite');
  const preview = document.createElement('button');
  preview.type = 'button';
  preview.className = 'study-move-note__preview';
  preview.setAttribute('aria-label', t('study.readMoveNote'));
  preview.setAttribute('aria-haspopup', 'dialog');
  const excerpt = document.createElement('span');
  excerpt.className = 'study-move-note__excerpt';
  preview.append(excerpt);
  el.append(preview);

  const sheet = document.createElement('div');
  sheet.className = 'study-move-note-sheet';
  sheet.hidden = true;
  const backdrop = document.createElement('div');
  backdrop.className = 'study-sheet-overlay';
  const panel = document.createElement('section');
  panel.className = 'study-sheet';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', t('study.moveNote'));
  const head = document.createElement('div');
  head.className = 'study-sheet__head';
  const title = document.createElement('h2');
  title.className = 'study-sheet__title';
  title.textContent = t('study.moveNote');
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'study-sheet__icon-button';
  closeButton.textContent = '×';
  closeButton.setAttribute('aria-label', t('live.roomInfoClose'));
  const text = document.createElement('div');
  text.className = 'study-move-note-sheet__text';
  head.append(title, closeButton);
  panel.append(head, text);
  sheet.append(backdrop, panel);

  function close(restoreFocus = true): void {
    if (sheet.hidden) return;
    sheet.hidden = true;
    sheet.remove();
    document.documentElement.classList.remove('study-sheet-open');
    if (restoreFocus && preview.isConnected && !preview.hidden)
      preview.focus({ preventScroll: true });
  }
  preview.addEventListener(
    'click',
    () => {
      if (!preview.textContent) return;
      root.append(sheet);
      sheet.hidden = false;
      document.documentElement.classList.add('study-sheet-open');
      closeButton.focus({ preventScroll: true });
    },
    { signal },
  );
  closeButton.addEventListener('click', () => close(), { signal });
  backdrop.addEventListener('click', () => close(), { signal });
  // Capture before review navigation: the modal owns keys while it is open.
  document.addEventListener(
    'keydown',
    (event) => {
      if (sheet.hidden) return;
      event.stopImmediatePropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      } else if (event.key === 'Tab') {
        event.preventDefault();
        closeButton.focus();
      }
    },
    { capture: true, signal },
  );
  signal.addEventListener(
    'abort',
    () => {
      close(false);
      sheet.remove();
    },
    { once: true },
  );

  return {
    el,
    update(comment: string, hasNotes: boolean): void {
      el.hidden = !hasNotes;
      preview.hidden = !comment;
      excerpt.textContent = comment;
      text.textContent = comment;
      if (!comment) close(false);
    },
  };
}
