import { t } from './i18n/catalog.js';

// Neutral "loading a game" placeholder shown while a replay renderer mounts (a
// watch channel switch, or a homepage showcase variant change that tears down one
// renderer kind and mounts another) so the board slot gives feedback instead of
// going blank. Kept as a leaf so the homepage showcase cycler can reuse it without
// pulling the whole /watch route into the landing bundle. Styled by watch-route.css
// on /watch and by landing.css on the homepage.
// `aspectRatio` (width / height) pre-sizes the placeholder to the board that is
// about to mount, so the slot reserves the right box and the swap doesn't shift
// layout twice (once to a square placeholder, once to the board's true height).
// Omit it (homepage showcase, unknown variant) to keep the stylesheet's square.
export function renderWatchReplaySkeleton(root: HTMLElement, aspectRatio?: number): void {
  const skeleton = document.createElement('div');
  skeleton.className = 'watch-replay-skeleton';
  skeleton.setAttribute('aria-hidden', 'true');
  const board = document.createElement('div');
  board.className = 'watch-replay-skeleton-board';
  if (aspectRatio !== undefined && Number.isFinite(aspectRatio) && aspectRatio > 0) {
    board.style.aspectRatio = `${aspectRatio}`;
    // The unsized skeleton floors its container at a square-ish min-height so a
    // blank slot still reads as a board. Once the ratio is known that floor
    // fights it (a 8x4 banqi placeholder would sit in a 420px-tall box and shift
    // when the real 210px board lands), so the container hugs the sized board.
    skeleton.classList.add('watch-replay-skeleton--sized');
  }
  const caption = document.createElement('div');
  caption.className = 'watch-replay-skeleton-caption';
  caption.textContent = t('replay.loadingGame');
  skeleton.append(board, caption);
  root.replaceChildren(skeleton);
}

export function renderWatchReplayFailure(root: HTMLElement): void {
  const failure = document.createElement('div');
  failure.className = 'watch-replay-skeleton watch-replay-failure';
  failure.setAttribute('role', 'status');
  const board = document.createElement('div');
  board.className = 'watch-replay-skeleton-board';
  const caption = document.createElement('div');
  caption.className = 'watch-replay-skeleton-caption';
  caption.textContent = t('home.gameViewerUnavailable');
  failure.append(board, caption);
  root.replaceChildren(failure);
}
