// UI and confirmation lifetime for the removable ?repwarn prototype.
import type { JieqiMove, JieqiPlayerView, JieqiSquare } from '@mistboard/game';
import { t } from './i18n/catalog.js';
import type {
  RepetitionLoss,
  RepetitionWarning,
  RepetitionWarningMode,
} from './jieqi-repetition-warning.js';
import { noticeReadMs, placeChaseBubble } from './live-banqi-chase-bubble.js';
import './live-jieqi-repetition-warning.css';

export function createJieqiRepetitionWarningUi(board: HTMLElement, mode: RepetitionWarningMode) {
  let position = '';
  let analysis: RepetitionWarning = { headsUp: null, losingMoves: [] };
  let pending: JieqiMove | null = null;
  let expires = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let bubble: HTMLDivElement | null = null;
  let anchor: JieqiSquare | null = null;
  let origin: JieqiSquare | null = null;
  let active = false;
  const stage = board.closest<HTMLElement>('.board-stage') ?? board;
  const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(sync);
  resize?.observe(board);

  function clear() {
    clearTimeout(timer);
    pending = null;
    expires = 0;
    bubble?.remove();
    bubble = null;
  }

  function sync() {
    if (!bubble || !anchor) return;
    const cell = board.querySelector(`[data-square="${anchor}"] rect`);
    const surface = board.querySelector('svg');
    if (!cell || !surface) return;
    const host = stage.getBoundingClientRect();
    const rel = (rect: DOMRect) => ({
      left: rect.left - host.left,
      top: rect.top - host.top,
      width: rect.width,
      height: rect.height,
    });
    const bounds = rel(surface.getBoundingClientRect());
    if (!bounds.width) return;
    bubble.style.setProperty('--banqi-chase-board-max', `${Math.max(0, bounds.width - 12)}px`);
    const from = origin ? board.querySelector(`[data-square="${origin}"] rect`) : null;
    const placed = placeChaseBubble(
      rel(cell.getBoundingClientRect()),
      bounds,
      { width: bubble.offsetWidth, height: bubble.offsetHeight },
      from ? rel(from.getBoundingClientRect()) : null,
    );
    bubble.style.left = `${placed.left}px`;
    // Unlike the banqi notice, this can anchor to any edge point. Clamp both axes.
    bubble.style.top = `${Math.max(bounds.top + 6, Math.min(placed.top, bounds.top + bounds.height - bubble.offsetHeight - 6))}px`;
    bubble.style.setProperty('--banqi-chase-caret-x', `${placed.caretX}px`);
    bubble.classList.toggle('banqi-chase-bubble--below', placed.below);
    if (!bubble.isConnected) stage.append(bubble);
  }

  function show(point: JieqiSquare, from: JieqiSquare | null, text: string) {
    clear();
    anchor = point;
    origin = from;
    bubble = document.createElement('div');
    bubble.className = 'banqi-chase-bubble jieqi-repetition-bubble';
    bubble.setAttribute('role', 'status');
    bubble.setAttribute('aria-live', 'polite');
    bubble.textContent = text;
    stage.append(bubble);
    expires = Date.now() + noticeReadMs(text);
    timer = setTimeout(clear, noticeReadMs(text));
    sync();
  }

  // Only a second primary tap on the pending point may retain confirmation.
  // Outside taps, another point, annotations, keyboard navigation and scroll
  // all dismiss it. Dragging again starts another interaction and cancels it.
  const cancelOther = (event: Event) => {
    if (!pending) return;
    const point = (event.target as Element | null)?.closest?.('[data-square]');
    if (
      event.type === 'pointerdown' &&
      (event as PointerEvent).button === 0 &&
      board.contains(point ?? null) &&
      point?.getAttribute('data-square') === pending.to
    )
      return;
    clear();
  };
  document.addEventListener('pointerdown', cancelOther, true);
  document.addEventListener('keydown', cancelOther, true);
  document.addEventListener('wheel', cancelOther, true);
  document.addEventListener('scroll', cancelOther, true);

  function headsUpText(loss: RepetitionLoss): string {
    if (loss.reason === 'perpetual-check')
      return t(
        loss.loser === 'red' ? 'live.jieqiRepwarn.redCheck' : 'live.jieqiRepwarn.blackCheck',
      );
    return t(loss.loser === 'red' ? 'live.jieqiRepwarn.redChase' : 'live.jieqiRepwarn.blackChase');
  }

  return {
    update(view: JieqiPlayerView | null, next: RepetitionWarning, enabled: boolean) {
      analysis = next;
      active = enabled && view?.status.type === 'playing';
      if (!active || !view) {
        position = '';
        clear();
        return;
      }
      const key = `${view.id}:${view.moveNumber}:${JSON.stringify(view.status)}:${JSON.stringify(view.lastMove)}`;
      if (position !== key) {
        position = key;
        clear();
        if (next.headsUp && view.lastMove) show(view.lastMove.to, null, headsUpText(next.headsUp));
      }
      sync();
    },
    losingDestinations(from: JieqiSquare | null): ReadonlySet<JieqiSquare> {
      return new Set(
        active && mode !== 'heads-up'
          ? analysis.losingMoves.filter(({ move }) => move.from === from).map(({ move }) => move.to)
          : [],
      );
    },
    /** Called only for an immediate own move. A future premove must bypass it. */
    allowMove(move: JieqiMove): boolean {
      const loss = analysis.losingMoves.find(
        (item) => item.move.from === move.from && item.move.to === move.to,
      );
      if (!active || mode !== 'confirm' || !loss) {
        clear();
        return true;
      }
      if (pending?.from === move.from && pending.to === move.to && Date.now() < expires) {
        clear();
        return true;
      }
      show(
        move.to,
        move.from,
        t(
          loss.reason === 'perpetual-check'
            ? 'live.jieqiRepwarn.confirmCheck'
            : 'live.jieqiRepwarn.confirmChase',
        ),
      );
      pending = move;
      return false;
    },
    cancel: clear,
    sync,
    destroy() {
      clear();
      resize?.disconnect();
      document.removeEventListener('pointerdown', cancelOther, true);
      document.removeEventListener('keydown', cancelOther, true);
      document.removeEventListener('wheel', cancelOther, true);
      document.removeEventListener('scroll', cancelOther, true);
    },
  };
}
