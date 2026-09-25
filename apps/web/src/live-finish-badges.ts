// Game-over badges on the kings (chess.com's finish animation). When a game
// ends while the viewer is watching live, the loser's general gets a red badge
// naming how it ended and the winner's a green crown; each starts as a corner
// badge, grows over the piece, and a pill label pops above it. A draw marks
// both generals in grey.
//
// The layer is an HTML sibling of the board inside `.board-stage`, not part of
// the board SVG: tenant boards rebuild their SVG with an innerHTML swap on every
// render, which would restart a baked-in animation each time. Badges are
// positioned from the rendered piece slot (`[data-piece-square]`), so the layer
// needs no board geometry of its own and follows the board through resizes.
//
// It plays only on a live playing -> finished transition (the caller passes the
// lifecycle effect), so reloading a finished room or scrubbing a replay never
// replays it. It clears when the viewer leaves the final position or a new game
// starts in the room.

import './live-finish-badges.css';
import { terminationLabel } from './game-display.js';
import { t } from './i18n/catalog.js';

export type FinishBadgeKind = 'loser' | 'winner' | 'draw';
export type FinishBadgeIcon = 'mate' | 'resign' | 'timeout' | 'loss' | 'crown' | 'draw';

export type FinishBadge = {
  square: string;
  kind: FinishBadgeKind;
  icon: FinishBadgeIcon;
  label: string;
};

const LOSER_ICONS: Record<string, FinishBadgeIcon> = {
  checkmate: 'mate',
  resignation: 'resign',
  timeout: 'timeout',
};

/**
 * Badges for a finished game in a king-based family (xiangqi, jieqi). A side
 * whose general is off the board (general captured) simply gets no badge; the
 * winner's still shows.
 */
export function finishBadgesForResult<C extends string>(result: {
  colors: readonly C[];
  winner: C | null;
  reason: string;
  generalSquare: (color: C) => string | null | undefined;
}): FinishBadge[] {
  const badges: FinishBadge[] = [];
  const reasonLabel = terminationLabel(result.reason);
  for (const color of result.colors) {
    const square = result.generalSquare(color);
    if (!square) continue;
    if (result.winner === null) {
      badges.push({ square, kind: 'draw', icon: 'draw', label: reasonLabel });
    } else if (color === result.winner) {
      badges.push({ square, kind: 'winner', icon: 'crown', label: t('live.finishWinner') });
    } else {
      badges.push({
        square,
        kind: 'loser',
        icon: LOSER_ICONS[result.reason] ?? 'loss',
        label: reasonLabel,
      });
    }
  }
  return badges;
}

/** Square of `color`'s general on a square-keyed board (face-down pieces carry no role). */
export function generalSquareOn(
  board: Readonly<Record<string, { color: string; role?: string } | undefined>>,
  color: string,
): string | null {
  for (const [square, piece] of Object.entries(board)) {
    if (piece && piece.color === color && piece.role === 'general') return square;
  }
  return null;
}

// 24-unit icons, white on the badge disc.
const ICON_SVG: Record<FinishBadgeIcon, string> = {
  crown: '<path d="M3 8.5 7.6 12 12 5l4.4 7L21 8.5 19.2 18H4.8z"/>',
  mate: '<path d="M8.6 3.5h2.3L9.4 20.5H7.1zM14.6 3.5h2.3l-1.5 17h-2.3zM3.5 8h17v2.2h-17zM3.5 13.8h17V16h-17z"/>',
  resign:
    '<path d="M5.5 3h2v18h-2z"/><path d="M8 4.2c3.4-1.6 5.8 1.6 10.5 0v8.3c-4.7 1.6-7.1-1.6-10.5 0z"/>',
  timeout:
    '<path fill-rule="evenodd" d="M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zm0 2.3a6.7 6.7 0 1 0 0 13.4 6.7 6.7 0 0 0 0-13.4z"/><path d="M11 7h2v5.2l3.6 2.1-1 1.7L11 13.3z"/>',
  loss: '<path d="m6.3 4.6 5.7 5.7 5.7-5.7 1.7 1.7-5.7 5.7 5.7 5.7-1.7 1.7-5.7-5.7-5.7 5.7-1.7-1.7 5.7-5.7-5.7-5.7z"/>',
  draw: '<text x="12" y="12.5" text-anchor="middle" dominant-baseline="central" font-size="15" font-weight="700" font-family="inherit">½</text>',
};

function badgeElement(badge: FinishBadge): HTMLElement {
  const root = document.createElement('div');
  root.className = `finish-badge finish-badge--${badge.kind}`;
  root.dataset.finishSquare = badge.square;
  root.setAttribute('aria-hidden', 'true');
  const disc = document.createElement('span');
  disc.className = 'finish-badge__disc';
  disc.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor">${ICON_SVG[badge.icon]}</svg>`;
  root.append(disc);
  if (badge.label) {
    const pill = document.createElement('span');
    pill.className = 'finish-badge__pill';
    pill.textContent = badge.label;
    root.append(pill);
  }
  return root;
}

export type LiveFinishBadges = {
  /** Start the animation for a game that just finished. */
  play(gameId: string, badges: readonly FinishBadge[]): void;
  /**
   * Call after every board render: keeps the badges on their pieces, and
   * clears them once the viewer is no longer on this game's final position.
   */
  sync(gameId: string | null, atFinalPosition: boolean): void;
  clear(): void;
  destroy(): void;
};

export function createLiveFinishBadges(stage: HTMLElement, board: HTMLElement): LiveFinishBadges {
  let layer: HTMLElement | null = null;
  let activeGameId: string | null = null;
  const resize =
    typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => position());
  resize?.observe(stage);

  function position(): void {
    if (!layer) return;
    const stageRect = stage.getBoundingClientRect();
    for (const el of layer.querySelectorAll<HTMLElement>('.finish-badge')) {
      const square = el.dataset.finishSquare ?? '';
      const piece = board.querySelector(`[data-piece-square="${square}"]`);
      const rect = piece?.getBoundingClientRect();
      if (!rect || rect.width === 0) {
        el.hidden = true;
        continue;
      }
      el.hidden = false;
      const top = rect.top - stageRect.top;
      el.style.left = `${rect.left - stageRect.left}px`;
      el.style.top = `${top}px`;
      el.style.width = `${rect.width}px`;
      el.style.height = `${rect.height}px`;
      el.style.fontSize = `${Math.round(Math.min(16, Math.max(11, rect.height * 0.27)))}px`;
      // A general on the top edge would push its pill off the board: hang it
      // below the piece instead.
      el.classList.toggle('finish-badge--pill-below', top < rect.height * 0.4);
    }
  }

  function clear(): void {
    layer?.remove();
    layer = null;
    activeGameId = null;
  }

  return {
    play(gameId, badges) {
      clear();
      if (badges.length === 0) return;
      layer = document.createElement('div');
      layer.className = 'finish-badges';
      layer.append(...badges.map(badgeElement));
      stage.append(layer);
      activeGameId = gameId;
      position();
    },
    sync(gameId, atFinalPosition) {
      if (!layer) return;
      if (gameId !== activeGameId || !atFinalPosition) {
        clear();
        return;
      }
      position();
    },
    clear,
    destroy() {
      resize?.disconnect();
      clear();
    },
  };
}
