// Public repetition-loss labels and the lifetime of a pending move dialog.
import type { JieqiMove, JieqiPlayerView, JieqiSquare } from '@mistboard/game';
import { readAccountPreferences } from './account-preferences.js';
import { openConfirmDialog } from './confirm-dialog.js';
import { t } from './i18n/catalog.js';
import {
  placeRepetitionLabel,
  type RepetitionLoss,
  type RepetitionWarning,
  repetitionConfirmationPosition,
} from './jieqi-repetition-warning.js';
import './live-jieqi-repetition-warning.css';

export function createJieqiRepetitionWarningUi(board: HTMLElement, repaint: () => void) {
  let position = '';
  let analysis: RepetitionWarning = { losingMoves: [] };
  let pending: { move: JieqiMove; position: string; dialog?: HTMLDialogElement } | null = null;
  let active = false;
  let labels: Array<{ point: JieqiSquare; loss: RepetitionLoss; element: HTMLDivElement }> = [];
  let labelFrom: JieqiSquare | null = null;
  let legalPoints: JieqiSquare[] = [];
  const stage = board.closest<HTMLElement>('.board-stage') ?? board;
  const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(syncLabels);
  resize?.observe(board);

  function cancel() {
    const previous = pending;
    pending = null;
    previous?.dialog?.close('cancel');
    previous?.dialog?.remove();
  }

  function clearLabels() {
    for (const label of labels) label.element.remove();
    labels = [];
    labelFrom = null;
    legalPoints = [];
  }

  function syncLabels() {
    if (!labels.length || !labelFrom) return;
    const surface = board.querySelector('svg');
    const from = board.querySelector(`[data-square="${labelFrom}"] rect`);
    if (!surface || !from) {
      clearLabels();
      return;
    }
    const host = stage.getBoundingClientRect();
    const rel = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left - host.left,
        top: rect.top - host.top,
        width: rect.width,
        height: rect.height,
      };
    };
    const bounds = rel(surface);
    if (!bounds.width) return;
    for (const { point, element } of labels) {
      // Pin beside the visible ring rather than the larger invisible hit area.
      const target =
        board.querySelector(`[data-repetition-loss="${point}"] .jieqi-repetition-ring-edge`) ??
        board.querySelector(`[data-square="${point}"] rect`);
      if (!target) continue;
      const siblings = legalPoints.flatMap((p) => {
        const cell = p !== point ? board.querySelector(`[data-square="${p}"] rect`) : null;
        return cell ? [rel(cell)] : [];
      });
      element.style.setProperty(
        '--jieqi-repetition-label-max',
        `${Math.max(0, bounds.width - 8)}px`,
      );
      const placed = placeRepetitionLabel(
        rel(target),
        bounds,
        { width: element.offsetWidth, height: element.offsetHeight },
        rel(from),
        siblings,
      );
      element.style.left = `${placed.left}px`;
      element.style.top = `${placed.top}px`;
    }
  }

  return {
    update(view: JieqiPlayerView | null, next: RepetitionWarning, enabled: boolean) {
      analysis = next;
      active = enabled && view?.status.type === 'playing';
      const key = active && view ? repetitionConfirmationPosition(view) : '';
      if (position !== key || !active) {
        position = key;
        cancel();
        clearLabels();
      }
    },
    /** A rendering-only projection. Canonical state and replay remain untouched. */
    preview(view: JieqiPlayerView): JieqiPlayerView {
      if (!pending) return view;
      const board = { ...view.board, [pending.move.to]: view.board[pending.move.from] };
      delete board[pending.move.from];
      return { ...view, board };
    },
    /** Called after the SVG render for both tap selection and drag start. */
    select(from: JieqiSquare | null, legalMoves: readonly JieqiMove[]) {
      clearLabels();
      if (!active || !from || pending) return;
      labelFrom = from;
      legalPoints = legalMoves.filter((move) => move.from === from).map((move) => move.to);
      for (const loss of analysis.losingMoves.filter(({ move }) => move.from === from)) {
        const element = document.createElement('div');
        element.className = 'jieqi-repetition-label';
        element.dataset.repetitionLabel = loss.move.to;
        element.textContent = t(
          loss.reason === 'perpetual-check'
            ? 'live.jieqiRepwarn.labelCheck'
            : 'live.jieqiRepwarn.labelChase',
        );
        stage.append(element);
        labels.push({ point: loss.move.to, loss, element });
      }
      syncLabels();
    },
    losingDestinations(from: JieqiSquare | null): ReadonlySet<JieqiSquare> {
      return new Set(
        active
          ? analysis.losingMoves.filter(({ move }) => move.from === from).map(({ move }) => move.to)
          : [],
      );
    },
    /** Called only for an immediate own move, never a future premove. */
    allowMove(move: JieqiMove, play: () => void): boolean {
      if (pending) return false;
      const loss = analysis.losingMoves.find(
        (item) => item.move.from === move.from && item.move.to === move.to,
      );
      if (!active || !loss || !readAccountPreferences().confirmGameActions) return true;
      const attempt = { move: { ...move }, position };
      pending = attempt;
      clearLabels();
      const finish = (confirmed: boolean) => {
        if (pending !== attempt) return;
        pending = null;
        if (confirmed && active && position === attempt.position) play();
        repaint();
      };
      const dialog = openConfirmDialog({
        title: t(
          loss.reason === 'perpetual-check'
            ? 'live.jieqiRepwarn.checkTitle'
            : 'live.jieqiRepwarn.chaseTitle',
        ),
        body: t('live.jieqiRepwarn.body'),
        confirmLabel: t('live.jieqiRepwarn.playMove'),
        cancelLabel: t('setup.cancel'),
        confirmTone: 'danger',
        onConfirm: () => finish(true),
        onCancel: () => finish(false),
      });
      pending.dialog = dialog;
      return false;
    },
    cancel,
    sync: syncLabels,
    destroy() {
      cancel();
      clearLabels();
      resize?.disconnect();
    },
  };
}
