// Shared review shell: a lichess-style centered cluster of
// [left info rail | center board-stage | right moves/controls rail]. The three
// hug each other (small gap) and the whole cluster centers in the page, so extra
// horizontal space falls on the OUTER edges — never as a gulf between the board
// and its rails. This is the platform layout for every variant's postgame (and,
// later, the live room). Pair the center with review/board-stage.ts.

import '../seat-disc-ink.css';
import './review-shell.css';

export type ReviewShellPanels = {
  /** One or more rail groups. Passing several lets col1 (phone) split them
   *  across the stack: the game-meta group rides directly under the board while
   *  a deferred group (spectator chat) drops below the move list. */
  left: HTMLElement | HTMLElement[];
  center: HTMLElement;
  right: HTMLElement;
  ariaLabel?: string;
  /** Extra class on the <main> for per-variant board-family sizing tweaks. */
  pageClassName?: string;
  /** Board and moves only, sized to the element it mounts in rather than the
   *  viewport, with no left rail: a host page (a broadcast event) keeps its
   *  own header and side column around it. A <div>, since the host owns <main>. */
  embedded?: boolean;
};

export function createReviewShell(panels: ReviewShellPanels): HTMLElement {
  const main = document.createElement(panels.embedded ? 'div' : 'main');
  main.className = [
    'review-shell',
    panels.embedded ? 'review-shell--embedded' : null,
    panels.pageClassName,
  ]
    .filter(Boolean)
    .join(' ');
  if (panels.ariaLabel) main.setAttribute('aria-label', panels.ariaLabel);

  const cluster = document.createElement('div');
  cluster.className = 'review-shell__cluster';

  const left = document.createElement('aside');
  left.className = 'review-shell__rail review-shell__left';
  left.append(...(Array.isArray(panels.left) ? panels.left : [panels.left]));

  const center = document.createElement('div');
  center.className = 'review-shell__center';
  center.append(panels.center);

  const right = document.createElement('aside');
  right.className = 'review-shell__rail review-shell__right';
  right.append(panels.right);

  if (panels.embedded) cluster.append(center, right);
  else cluster.append(left, center, right);
  main.append(cluster);
  return main;
}
