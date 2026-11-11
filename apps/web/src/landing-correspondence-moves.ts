import './landing-correspondence-moves.css';
import { type CorrespondenceGame, deadlineRemainingMs } from './correspondence-model.js';
import { variantDisplayLabel } from './game-display.js';
import { t } from './i18n/catalog.js';
import { currentLocale, localizedHref } from './i18n/locale.js';
import { isSignedIn, signedInResolvedEvent } from './signed-in-state.js';
import { formatDayClock } from './web-utils.js';

// The signed-in homepage's correspondence row (#1058): the player's games that
// wait on their move, each a link into its room. Nothing for a player with none
// and nothing for a signed-out visitor, so it is no promotion: a homepage
// correspondence card was tried and removed in October. It asks the server only
// once auth has settled signed in, so an anonymous visitor costs no request.

const MAX_GAMES = 4;

export function buildLandingCorrespondenceMoves(options: { hydrate?: boolean } = {}): HTMLElement {
  const box = document.createElement('section');
  box.className = 'landing-corr-moves';
  box.hidden = true;
  if (options.hydrate === false) return box;
  let loaded = false;
  let mounted = false;
  const sync = (): void => {
    // The homepage is rebuilt on navigation; a row that left the page stops
    // listening instead of fetching for nothing.
    if (box.isConnected) mounted = true;
    else if (mounted) {
      window.removeEventListener(signedInResolvedEvent, sync);
      return;
    }
    if (!isSignedIn()) {
      box.hidden = true;
      box.replaceChildren();
      loaded = false;
      return;
    }
    if (loaded) return;
    loaded = true;
    void loadYourMoveGames().then((games) => renderLandingCorrespondenceMoves(box, games));
  };
  window.addEventListener(signedInResolvedEvent, sync);
  sync();
  return box;
}

async function loadYourMoveGames(): Promise<CorrespondenceGame[]> {
  const resp = await fetch('/api/correspondence/games').catch(() => null);
  if (!resp?.ok) return [];
  const body = (await resp.json().catch(() => null)) as { games?: unknown } | null;
  if (!Array.isArray(body?.games)) return [];
  return (body.games as CorrespondenceGame[]).filter(
    (game) => game?.isYourMove === true && typeof game.url === 'string' && game.url.startsWith('/'),
  );
}

/** Draws the row from the games on the player's move; hidden when there are none. */
export function renderLandingCorrespondenceMoves(
  box: HTMLElement,
  games: readonly CorrespondenceGame[],
  now = Date.now(),
): void {
  const yours = games.filter((game) => game.isYourMove);
  box.hidden = yours.length === 0;
  if (yours.length === 0) {
    box.replaceChildren();
    return;
  }
  const locale = currentLocale();
  const head = document.createElement('a');
  head.className = 'landing-corr-moves-head hover-link';
  head.href = localizedHref('/correspondence', locale);
  head.textContent = t('correspondence.homeYourMove');
  const count = document.createElement('span');
  count.className = 'landing-corr-moves-count';
  count.textContent = String(yours.length);
  head.append(' ', count);

  const list = document.createElement('ul');
  list.className = 'landing-corr-moves-list';
  const ordered = [...yours].sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  for (const game of ordered.slice(0, MAX_GAMES)) {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.className = 'landing-corr-moves-game hover-row';
    link.href = localizedHref(game.url, locale);
    const who = document.createElement('span');
    who.className = 'landing-corr-moves-name';
    who.textContent = t('correspondence.vsOpponent', {
      name: game.opponentName ?? t('correspondence.opponentFallback'),
    });
    const meta = document.createElement('span');
    meta.className = 'landing-corr-moves-meta';
    const parts = [variantDisplayLabel(game.gameSpecId)];
    const remaining = deadlineRemainingMs(game.dueAt, now);
    if (remaining !== null && remaining > 0) {
      parts.push(t('correspondence.timeLeft', { time: formatDayClock(remaining) }));
    }
    meta.textContent = parts.join(' · ');
    link.append(who, meta);
    item.append(link);
    list.append(item);
  }
  box.replaceChildren(head, list);
}
