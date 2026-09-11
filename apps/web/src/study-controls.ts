import { t } from './i18n/catalog.js';
import type { SerializedNode, SerializedTree } from './review/tree-serialize.js';
import { localizedStudyName } from './study-i18n.js';

export type StudyVisibility = 'private' | 'unlisted' | 'public';

export type StudyControlModel = {
  id: string;
  name: string;
  description: string;
  visibility: StudyVisibility;
  isOwner: boolean;
  featuredAt: string | null;
  canFeature: boolean;
};

export type ChapterControlModel = {
  id: string;
  name: string;
  i18n?: unknown;
  gamebook: boolean;
  /** Practice exercise this reader has already solved. Renders as a tick in the
   *  place of the row number, which is what turns the rail from a table of
   *  chapters into a course you can see your way through. */
  solved?: boolean;
  /** Server-validated on write, typed loose here to match the chapter DTO;
   *  normalized where it is read. */
  orientation: string;
};

export type StudyRailActions = {
  onSwitch(id: string): void;
  onAdd(): void;
  chapterHref(id: string): string;
  onReorder(ids: string[]): Promise<string | null>;
  onToggleFeatured(featured: boolean): Promise<string | null>;
  onOpenStudySettings(): void;
  onOpenChapterSettings(chapter: ChapterControlModel): void;
  // Scroll offset of the previous rail's chapter list, captured by the caller
  // before the old rail left the DOM. Null/absent on first mount, where the
  // active chapter is centered instead.
  previousListScrollTop?: number | null;
  /** The errata invitation. It is a property of the STUDY and the underboard is
   *  per-chapter, so rendering it there put a study-wide note under all 92
   *  chapters. It closes the rail instead, which is where study.css already
   *  said it belonged. (The favourite moved for the same reason, to the info
   *  card's title row.) */
  errata?: HTMLElement | null;
};

export function buildStudyRail(
  study: StudyControlModel,
  chapters: ChapterControlModel[],
  activeId: string,
  status: HTMLElement,
  actions: StudyRailActions,
): HTMLElement {
  const panel = document.createElement('section');
  panel.className = 'study-chapters';
  panel.setAttribute('aria-label', t('study.chapters'));

  const head = document.createElement('div');
  head.className = 'study-chapters__head';
  const count = document.createElement('span');
  count.textContent =
    chapters.length === 1
      ? t('study.chapterCountOne')
      : t('study.chapterCount', { count: chapters.length });
  head.append(count);

  const tools = document.createElement('span');
  tools.className = 'study-chapters__tools';
  // The readout mounts for every viewer, not just writers: a viewer's copy is
  // hidden until they move a piece, and it is the only thing on the page that
  // says their moves are not going into someone else's study.
  status.classList.add('study-chapters__status');
  tools.append(status);
  if (study.canFeature) {
    const renderFeatured = (button: HTMLButtonElement): void => {
      const featured = !!study.featuredAt;
      button.textContent = featured ? '★' : '☆';
      button.title =
        study.visibility !== 'public' && !featured
          ? t('study.publicBeforeFeature')
          : featured
            ? t('study.removeFrom')
            : t('study.featureIn');
      button.setAttribute('aria-label', button.title);
      button.setAttribute('aria-pressed', String(featured));
      button.disabled = study.visibility !== 'public' && !featured;
    };
    const featured = iconButton('☆', t('study.featureIn'), 'study-chapters__featured');
    renderFeatured(featured);
    featured.addEventListener('click', () => {
      const next = !study.featuredAt;
      featured.disabled = true;
      setRailStatus(status, 'saving', next ? t('study.featuring') : t('study.removing'));
      void actions
        .onToggleFeatured(next)
        .then((error) => {
          if (error) {
            setRailStatus(status, 'error', error);
            renderFeatured(featured);
            return;
          }
          study.featuredAt = next ? new Date().toISOString() : null;
          setRailStatus(status, 'saved', next ? t('study.featured') : t('study.removed'));
          renderFeatured(featured);
        })
        .catch(() => {
          setRailStatus(status, 'error', t('study.curationFailed'));
          renderFeatured(featured);
        });
    });
    tools.append(featured);
  }
  if (study.isOwner) {
    const settings = iconButton('☰', t('study.studySettings'), 'study-chapters__settings');
    settings.addEventListener('click', actions.onOpenStudySettings);
    tools.append(settings);
  }
  head.append(tools);
  panel.append(head);

  const list = document.createElement('ol');
  list.className = 'study-chapters__list';
  let draggedId: string | null = null;
  let reorderPending = false;
  const requestReorder = (chapterId: string, offset: number): void => {
    if (reorderPending) return;
    const currentIds = chapters.map((chapter) => chapter.id);
    const currentIndex = currentIds.indexOf(chapterId);
    if (currentIndex < 0) return;
    const nextIds = moveChapterId(currentIds, chapterId, currentIndex + offset);
    if (nextIds.every((id, index) => id === currentIds[index])) return;
    reorderPending = true;
    setRailStatus(status, 'saving', t('study.reordering'));
    void actions
      .onReorder(nextIds)
      .then((error) => {
        if (error) {
          reorderPending = false;
          setRailStatus(status, 'error', error);
          return;
        }
        setRailStatus(status, 'saved', t('study.saved'));
      })
      .catch(() => {
        reorderPending = false;
        setRailStatus(status, 'error', t('study.reorderFailed'));
      });
  };
  const requestDrop = (chapterId: string, targetId: string): void => {
    if (reorderPending || chapterId === targetId) return;
    const currentIds = chapters.map((chapter) => chapter.id);
    const targetIndex = currentIds.indexOf(targetId);
    if (targetIndex < 0) return;
    const nextIds = moveChapterId(currentIds, chapterId, targetIndex);
    if (nextIds.every((id, index) => id === currentIds[index])) return;
    reorderPending = true;
    setRailStatus(status, 'saving', t('study.reordering'));
    void actions
      .onReorder(nextIds)
      .then((error) => {
        if (error) {
          reorderPending = false;
          setRailStatus(status, 'error', error);
          return;
        }
        setRailStatus(status, 'saved', t('study.saved'));
      })
      .catch(() => {
        reorderPending = false;
        setRailStatus(status, 'error', t('study.reorderFailed'));
      });
  };
  chapters.forEach((chapter, index) => {
    const row = document.createElement('li');
    row.className = 'study-chapters__row';
    row.dataset.chapterId = chapter.id;
    if (chapter.id === activeId) row.classList.add('is-active');

    const chapterLabel = localizedStudyName(chapter.name, chapter.i18n);
    if (study.isOwner) {
      const drag = iconButton('⠿', `Reorder ${chapterLabel}`, 'study-chapters__drag');
      drag.draggable = true;
      drag.title = t('study.dragToReorder');
      drag.addEventListener('dragstart', (event) => {
        draggedId = chapter.id;
        row.classList.add('is-dragging');
        event.dataTransfer?.setData('text/plain', chapter.id);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      });
      drag.addEventListener('dragend', () => {
        draggedId = null;
        list.querySelectorAll('.is-dragging, .is-drop-target').forEach((element) => {
          element.classList.remove('is-dragging', 'is-drop-target');
        });
      });
      drag.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        requestReorder(chapter.id, event.key === 'ArrowUp' ? -1 : 1);
      });
      row.append(drag);
      row.addEventListener('dragover', (event) => {
        if (!draggedId || draggedId === chapter.id) return;
        event.preventDefault();
        row.classList.add('is-drop-target');
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      });
      row.addEventListener('dragleave', () => row.classList.remove('is-drop-target'));
      row.addEventListener('drop', (event) => {
        event.preventDefault();
        row.classList.remove('is-drop-target');
        const sourceId = draggedId ?? event.dataTransfer?.getData('text/plain');
        if (sourceId) requestDrop(sourceId, chapter.id);
      });
    }

    const link = document.createElement('a');
    link.href = actions.chapterHref(chapter.id);
    link.className = 'study-chapters__link';
    if (chapter.id === activeId) link.setAttribute('aria-current', 'page');
    const num = document.createElement('span');
    num.className = 'study-chapters__num';
    if (chapter.solved) {
      // A tick REPLACES the number rather than sitting beside it: the row is
      // already ordered by position, and two markers in one slot reads as a
      // table with a status column instead of a checklist.
      num.classList.add('study-chapters__num--solved');
      num.textContent = '✓';
      num.title = 'Solved';
    } else {
      num.textContent = String(index + 1);
    }
    const name = document.createElement('span');
    name.className = 'study-chapters__name';
    name.textContent = chapterLabel;
    name.title = chapterLabel;
    link.append(num, name);
    link.addEventListener('click', (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      event.preventDefault();
      actions.onSwitch(chapter.id);
    });
    row.append(link);

    if (study.isOwner) {
      const settings = iconButton('⚙', `Edit ${chapterLabel}`, 'study-chapters__chapter-settings');
      settings.addEventListener('click', () => actions.onOpenChapterSettings(chapter));
      row.append(settings);
    }
    list.append(row);
  });
  panel.append(list);

  if (study.isOwner) {
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'study-chapters__add';
    add.textContent = '＋ Add a new chapter';
    add.addEventListener('click', actions.onAdd);
    panel.append(add);
  }

  // Closes the rail rather than opening the underboard: an admission that a
  // transcription can be wrong belongs with the study it is about, once.
  if (actions.errata) panel.append(actions.errata);

  // Restore the reader's place across the rail rebuild a chapter switch
  // performs; center the active chapter only on first mount (deep links into
  // long studies). The rail can attach after an async board import, so wait
  // until the list is connected and laid out before touching scrollTop.
  let scrollAttempts = 0;
  const placeChapterList = (): void => {
    if (!list.isConnected || list.clientHeight === 0) {
      if (scrollAttempts++ < 20) requestAnimationFrame(placeChapterList);
      return;
    }
    if (actions.previousListScrollTop != null) {
      list.scrollTop = actions.previousListScrollTop;
      return;
    }
    const active = list.querySelector<HTMLElement>('.is-active');
    if (active) list.scrollTop = Math.max(0, active.offsetTop - list.clientHeight / 2);
  };
  requestAnimationFrame(placeChapterList);
  return panel;
}

export function moveChapterId(ids: string[], chapterId: string, targetIndex: number): string[] {
  const fromIndex = ids.indexOf(chapterId);
  if (fromIndex < 0 || ids.length < 2) return [...ids];
  const boundedTarget = Math.max(0, Math.min(targetIndex, ids.length - 1));
  if (fromIndex === boundedTarget) return [...ids];
  const next = [...ids];
  next.splice(fromIndex, 1);
  next.splice(boundedTarget, 0, chapterId);
  return next;
}

function setRailStatus(status: HTMLElement, state: string, message: string): void {
  // An admin who does not own the study starts with the hidden viewer readout;
  // curating is still their own write and has to report itself.
  status.hidden = false;
  status.dataset.state = state;
  status.textContent = message;
}

export type StudySettingsPatch = {
  name: string;
  description: string;
  visibility: StudyVisibility;
};

export type StudySettingsActions = {
  onSave(patch: StudySettingsPatch): Promise<string | null>;
  onDelete(): Promise<string | null>;
};

export function openStudySettingsDialog(
  study: StudyControlModel,
  actions: StudySettingsActions,
): void {
  closeExistingDialog('study-settings');
  const dialog = baseDialog('study-settings', t('study.studySettings'));
  const form = document.createElement('form');
  form.className = 'study-settings__form';

  const name = textInput(study.name, 100);
  const description = document.createElement('textarea');
  description.className = 'study-create-dialog__control study-settings__description';
  description.rows = 5;
  description.maxLength = 4000;
  description.value = study.description;
  description.placeholder = t('study.descriptionPlaceholder');
  const visibility = visibilitySelect(study.visibility);
  form.append(
    field(t('study.fieldName'), name),
    field(t('study.fieldDescription'), description),
    field(t('study.fieldVisibility'), visibility),
  );

  const feedback = feedbackLine();
  const footer = document.createElement('div');
  footer.className = 'study-settings__footer';
  const danger = document.createElement('div');
  danger.className = 'study-settings__danger';
  const remove = actionButton(t('study.deleteStudy'), 'study-settings__delete');
  armDanger(remove, feedback, t('study.deleteStudyConfirm'), async () => {
    setPending(remove, t('study.deleting'));
    try {
      const error = await actions.onDelete();
      if (!error) return;
      setFeedback(feedback, error, 'error');
      restoreButton(remove, t('study.deleteStudy'));
      remove.blur();
    } catch {
      setFeedback(feedback, t('study.requestFailed'), 'error');
      restoreButton(remove, t('study.deleteStudy'));
      remove.blur();
    }
  });
  danger.append(remove);

  const primary = document.createElement('div');
  primary.className = 'study-create-dialog__actions';
  const cancel = actionButton(t('study.cancel'), 'study-create-dialog__cancel');
  cancel.addEventListener('click', () => dialog.close('cancel'));
  const save = actionButton(t('study.saveChanges'), 'study-create-dialog__start', 'submit');
  primary.append(cancel, save);
  footer.append(danger, primary);
  form.append(feedback, footer);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!name.value.trim()) {
      setFeedback(feedback, t('study.nameRequired'), 'error');
      return;
    }
    setPending(save, t('study.saving'));
    void actions
      .onSave({
        name: name.value.trim(),
        description: description.value.trim(),
        visibility: visibility.value as StudyVisibility,
      })
      .then((error) => {
        if (error) {
          setFeedback(feedback, error, 'error');
          restoreButton(save, t('study.saveChanges'));
          return;
        }
        dialog.close('saved');
      })
      .catch(() => {
        setFeedback(feedback, t('study.requestFailed'), 'error');
        restoreButton(save, t('study.saveChanges'));
      });
  });

  dialog.append(form);
  showDialog(dialog, name);
}

export type ChapterSettingsPatch = {
  name: string;
  gamebook: boolean;
  orientation: 'red' | 'black';
};

export type ChapterSettingsActions = {
  canUseGamebook: boolean;
  canDelete: boolean;
  onSave(patch: ChapterSettingsPatch): Promise<string | null>;
  onDuplicate(): Promise<string | null>;
  onClearAnnotations(): Promise<string | null>;
  onClearVariations(): Promise<string | null>;
  onDelete(): Promise<string | null>;
};

export function openChapterSettingsDialog(
  chapter: ChapterControlModel,
  actions: ChapterSettingsActions,
): void {
  closeExistingDialog('chapter-settings');
  const dialog = baseDialog('chapter-settings', t('study.chapterSettings'));
  const form = document.createElement('form');
  form.className = 'study-settings__form';
  const name = textInput(chapter.name, 80);
  form.append(field(t('study.fieldName'), name));
  const orientation = orientationSelect(chapter.orientation === 'black' ? 'black' : 'red');
  form.append(field(t('study.fieldOrientation'), orientation));

  const gamebook = document.createElement('input');
  gamebook.type = 'checkbox';
  gamebook.checked = chapter.gamebook;
  if (actions.canUseGamebook) form.append(checkField(t('study.lessonTitle'), gamebook));

  const feedback = feedbackLine();
  const utilities = document.createElement('div');
  utilities.className = 'study-chapter-dialog__utilities';
  const duplicate = actionButton(t('study.duplicateChapter'), 'study-settings__secondary');
  duplicate.addEventListener('click', () => {
    setPending(duplicate, t('study.duplicating'));
    void actions
      .onDuplicate()
      .then((error) => {
        if (error) {
          setFeedback(feedback, error, 'error');
          restoreButton(duplicate, t('study.duplicateChapter'));
          return;
        }
        dialog.close('duplicated');
      })
      .catch(() => {
        setFeedback(feedback, t('study.requestFailed'), 'error');
        restoreButton(duplicate, t('study.duplicateChapter'));
      });
  });
  utilities.append(duplicate);

  const destructive = document.createElement('div');
  destructive.className = 'study-chapter-dialog__destructive';
  const clearAnnotations = actionButton(
    t('study.clearAnnotations'),
    'study-settings__danger-action',
  );
  armDanger(clearAnnotations, feedback, t('study.clearAnnotationsConfirm'), () =>
    runDialogAction(
      dialog,
      clearAnnotations,
      feedback,
      t('study.clearing'),
      actions.onClearAnnotations,
    ),
  );
  const clearVariations = actionButton(t('study.clearVariations'), 'study-settings__danger-action');
  armDanger(clearVariations, feedback, t('study.clearVariationsConfirm'), () =>
    runDialogAction(
      dialog,
      clearVariations,
      feedback,
      t('study.clearing'),
      actions.onClearVariations,
    ),
  );
  destructive.append(clearAnnotations, clearVariations);
  if (actions.canDelete) {
    const remove = actionButton(t('study.deleteChapter'), 'study-settings__delete');
    armDanger(remove, feedback, t('study.deleteChapterConfirm'), () =>
      runDialogAction(dialog, remove, feedback, t('study.deleting'), actions.onDelete),
    );
    destructive.append(remove);
  }

  const primary = document.createElement('div');
  primary.className = 'study-create-dialog__actions';
  const cancel = actionButton(t('study.cancel'), 'study-create-dialog__cancel');
  cancel.addEventListener('click', () => dialog.close('cancel'));
  const save = actionButton(t('study.saveChapter'), 'study-create-dialog__start', 'submit');
  primary.append(cancel, save);

  form.append(utilities, destructive, feedback, primary);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!name.value.trim()) {
      setFeedback(feedback, t('study.chapterNameRequired'), 'error');
      return;
    }
    setPending(save, t('study.saving'));
    void actions
      .onSave({
        name: name.value.trim(),
        gamebook: gamebook.checked,
        orientation: orientation.value === 'black' ? 'black' : 'red',
      })
      .then((error) => {
        if (error) {
          setFeedback(feedback, error, 'error');
          restoreButton(save, t('study.saveChapter'));
          return;
        }
        dialog.close('saved');
      })
      .catch(() => {
        setFeedback(feedback, t('study.requestFailed'), 'error');
        restoreButton(save, t('study.saveChapter'));
      });
  });

  dialog.append(form);
  showDialog(dialog, name);
}

export type StudySaveRecoveryActions = {
  onKeepLocal(): Promise<boolean>;
  onUseServer(): void;
};

export function openStudySaveRecoveryDialog(actions: StudySaveRecoveryActions): void {
  closeExistingDialog('save-recovery');
  const dialog = baseDialog('save-recovery', t('study.recoveryTitle'));

  const body = document.createElement('div');
  body.className = 'study-save-recovery';
  const explanation = document.createElement('p');
  explanation.textContent = t('study.recoveryBody');
  const guidance = document.createElement('p');
  guidance.className = 'study-save-recovery__guidance';
  guidance.textContent = t('study.recoveryChoice');
  body.append(explanation, guidance);

  const feedback = feedbackLine();
  const actionsRow = document.createElement('div');
  actionsRow.className = 'study-create-dialog__actions';
  const useServer = actionButton(t('study.useServerCopy'), 'study-settings__danger-action');
  useServer.addEventListener('click', () => {
    actions.onUseServer();
    dialog.close('server');
  });
  const keepLocal = actionButton(t('study.keepMyDraft'), 'study-create-dialog__start');
  keepLocal.addEventListener('click', () => {
    setPending(keepLocal, t('study.saving'));
    useServer.disabled = true;
    void actions
      .onKeepLocal()
      .then((saved) => {
        if (saved) {
          dialog.close('local');
          return;
        }
        setFeedback(feedback, t('study.draftStillSafe'), 'error');
        restoreButton(keepLocal, t('study.keepMyDraft'));
        useServer.disabled = false;
      })
      .catch(() => {
        setFeedback(feedback, t('study.draftStillSafe'), 'error');
        restoreButton(keepLocal, t('study.keepMyDraft'));
        useServer.disabled = false;
      });
  });
  actionsRow.append(useServer, keepLocal);
  body.append(feedback, actionsRow);
  dialog.append(body);
  showDialog(dialog, keepLocal);
}

export function clearTreeAnnotations(tree: SerializedTree): SerializedTree {
  return {
    ...tree,
    root: mapNode(tree.root, (node) => {
      const { annotations: _annotations, ...rest } = node;
      return rest;
    }),
  };
}

export function keepTreeMainline(tree: SerializedTree): SerializedTree {
  const keep = (node: SerializedNode): SerializedNode => ({
    ...node,
    children: node.children[0] ? [keep(node.children[0])] : [],
  });
  return { ...tree, root: keep(tree.root) };
}

function mapNode(
  node: SerializedNode,
  transform: (node: SerializedNode) => SerializedNode,
): SerializedNode {
  return transform({ ...node, children: node.children.map((child) => mapNode(child, transform)) });
}

function baseDialog(kind: string, titleText: string): HTMLDialogElement {
  const dialog = document.createElement('dialog');
  dialog.dataset.studyDialog = kind;
  dialog.className = 'study-create-dialog study-settings';
  const title = document.createElement('h2');
  title.className = 'study-create-dialog__title';
  title.textContent = titleText;
  dialog.append(title);
  return dialog;
}

function showDialog(dialog: HTMLDialogElement, focus: HTMLElement): void {
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close('cancel');
  });
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  focus.focus();
  if (focus instanceof HTMLInputElement) focus.select();
}

function closeExistingDialog(kind: string): void {
  document.querySelector<HTMLDialogElement>(`dialog[data-study-dialog="${kind}"]`)?.close();
}

function field(labelText: string, control: HTMLElement): HTMLElement {
  const label = document.createElement('label');
  label.className = 'study-create-dialog__field';
  const text = document.createElement('span');
  text.className = 'study-create-dialog__label';
  text.textContent = labelText;
  label.append(text, control);
  return label;
}

function checkField(labelText: string, control: HTMLInputElement): HTMLElement {
  const label = document.createElement('label');
  label.className = 'study-settings__check';
  const text = document.createElement('span');
  text.textContent = labelText;
  label.append(control, text);
  return label;
}

function textInput(value: string, maxLength: number): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'study-create-dialog__control';
  input.value = value;
  input.maxLength = maxLength;
  return input;
}

/** Which side the chapter's board faces on open. A select rather than a radio
 *  pair so it sits on the same row shape as Name and Visibility. */
function orientationSelect(selected: 'red' | 'black'): HTMLSelectElement {
  const select = document.createElement('select');
  select.className = 'study-create-dialog__control';
  for (const [value, label] of [
    ['red', t('study.orientationRed')],
    ['black', t('study.orientationBlack')],
  ] as const) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    option.selected = value === selected;
    select.append(option);
  }
  return select;
}

function visibilitySelect(selected: StudyVisibility): HTMLSelectElement {
  const select = document.createElement('select');
  select.className = 'study-create-dialog__control';
  for (const [value, label] of [
    ['private', 'Private'],
    ['unlisted', 'Unlisted'],
    ['public', 'Public'],
  ] as const) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    option.selected = value === selected;
    select.append(option);
  }
  return select;
}

function iconButton(text: string, title: string, className: string): HTMLButtonElement {
  const button = actionButton(text, className);
  button.title = title;
  button.setAttribute('aria-label', title);
  return button;
}

function actionButton(
  text: string,
  className: string,
  type: 'button' | 'submit' = 'button',
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = type;
  button.className = className;
  button.textContent = text;
  button.dataset.defaultLabel = text;
  return button;
}

function feedbackLine(): HTMLParagraphElement {
  const feedback = document.createElement('p');
  feedback.className = 'study-settings__feedback';
  feedback.setAttribute('aria-live', 'polite');
  return feedback;
}

function setFeedback(feedback: HTMLElement, text: string, state: 'confirm' | 'error'): void {
  feedback.textContent = text;
  feedback.dataset.state = state;
}

function armDanger(
  button: HTMLButtonElement,
  feedback: HTMLElement,
  prompt: string,
  action: () => void | Promise<void>,
): void {
  const original = button.textContent ?? '';
  let armed = false;
  button.addEventListener('click', () => {
    if (!armed) {
      armed = true;
      button.textContent = 'Confirm';
      button.classList.add('is-armed');
      setFeedback(feedback, prompt, 'confirm');
      return;
    }
    void action();
  });
  button.addEventListener('blur', () => {
    if (button.disabled) return;
    armed = false;
    button.textContent = original;
    button.classList.remove('is-armed');
  });
}

async function runDialogAction(
  dialog: HTMLDialogElement,
  button: HTMLButtonElement,
  feedback: HTMLElement,
  pendingText: string,
  action: () => Promise<string | null>,
): Promise<void> {
  setPending(button, pendingText);
  try {
    const error = await action();
    if (!error) {
      dialog.close('changed');
      return;
    }
    setFeedback(feedback, error, 'error');
    restoreButton(button, button.dataset.defaultLabel ?? 'Try again');
    button.blur();
  } catch {
    setFeedback(feedback, t('study.requestFailed'), 'error');
    restoreButton(button, button.dataset.defaultLabel ?? 'Try again');
    button.blur();
  }
}

function setPending(button: HTMLButtonElement, text: string): void {
  button.disabled = true;
  button.textContent = text;
}

function restoreButton(button: HTMLButtonElement, text: string): void {
  button.disabled = false;
  button.textContent = text;
  button.classList.remove('is-armed');
}
