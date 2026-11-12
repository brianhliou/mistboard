import './landing-correspondence-moves.css';
import { type CorrespondenceGame, deadlineRemainingMs } from './correspondence-model.js';
import { variantDisplayLabel } from './game-display.js';
import { t } from './i18n/catalog.js';
import { currentLocale, type Locale, localizedHref } from './i18n/locale.js';
import { isSignedIn, signedInResolvedEvent } from './signed-in-state.js';
import { formatDayClock } from './web-utils.js';

// The signed-in homepage's correspondence row (#1058): the player's games that
// wait on their move, each a link into its room. Nothing for a player with none
// and nothing for a signed-out visitor, so it is no promotion: a homepage
// correspondence card was tried and removed in October. It asks the server only
// once auth has settled signed in, so an anonymous visitor costs no request.
//
// Desktop shows the same games as the Play panel's Your move tab instead
// (2026-11-11), so the card only shows on a phone there. One feed loads them
// for both: the homepage builds it once and hands it to the card and the panel.

const MAX_GAMES = 4;

type YourMoveListener = (games: readonly CorrespondenceGame[]) => void;

/** The signed-in player's correspondence games on their move, loaded once per homepage build. */
export interface YourMoveFeed {
  /**
   * Calls `listener` with the games each time they load, and with none when the
   * player signs out. `anchor` is the element the listener draws into: once
   * every anchor has left the page, the feed stops listening for auth changes.
   */
  subscribe(anchor: HTMLElement, listener: YourMoveListener): void;
}

export function createYourMoveFeed(options: { hydrate?: boolean } = {}): YourMoveFeed {
  const subscribers: { anchor: HTMLElement; listener: YourMoveListener }[] = [];
  let games: readonly CorrespondenceGame[] | null = null;
  let loading = false;
  let mounted = false;
  let started = false;
  let generation = 0;
  const emit = (): void => {
    for (const { listener } of subscribers) listener(games ?? []);
  };
  const sync = (): void => {
    // The homepage is rebuilt on navigation; a feed whose rows left the page
    // stops listening instead of fetching for nothing.
    if (subscribers.some(({ anchor }) => anchor.isConnected)) mounted = true;
    else if (mounted) {
      window.removeEventListener(signedInResolvedEvent, sync);
      return;
    }
    if (!isSignedIn()) {
      generation += 1;
      loading = false;
      const had = (games?.length ?? 0) > 0;
      games = null;
      if (had) emit();
      return;
    }
    if (loading || games !== null) return;
    loading = true;
    const mine = generation;
    void loadYourMoveGames().then((loaded) => {
      if (mine !== generation) return;
      loading = false;
      games = loaded;
      emit();
    });
  };
  return {
    subscribe(anchor, listener) {
      subscribers.push({ anchor, listener });
      if (games !== null) listener(games);
      if (options.hydrate === false || started) return;
      started = true;
      window.addEventListener(signedInResolvedEvent, sync);
      sync();
    },
  };
}

export function buildLandingCorrespondenceMoves(
  options: {
    hydrate?: boolean;
    feed?: YourMoveFeed;
    /** The Play panel lists these games on desktop, so show the card only on a phone. */
    phoneOnly?: boolean;
  } = {},
): HTMLElement {
  const box = document.createElement('section');
  box.className = 'landing-corr-moves';
  if (options.phoneOnly) box.classList.add('is-phone-only');
  box.hidden = true;
  if (options.hydrate === false) return box;
  const feed = options.feed ?? createYourMoveFeed();
  feed.subscribe(box, (games) => renderLandingCorrespondenceMoves(box, games));
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

/** Games on the player's move, soonest deadline first. */
export function yourMoveGamesInOrder(games: readonly CorrespondenceGame[]): CorrespondenceGame[] {
  return games.filter((game) => game.isYourMove).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}

/** "vs Alice" for a row. */
export function yourMoveOpponentLabel(game: CorrespondenceGame, locale?: Locale): string {
  return t(
    'correspondence.vsOpponent',
    { name: game.opponentName ?? t('correspondence.opponentFallback', {}, locale) },
    locale,
  );
}

/** "Xiangqi · 1d 4h left" for a row; the time drops once the deadline passed. */
export function yourMoveMeta(game: CorrespondenceGame, now = Date.now(), locale?: Locale): string {
  const parts = [variantDisplayLabel(game.gameSpecId)];
  const remaining = deadlineRemainingMs(game.dueAt, now);
  if (remaining !== null && remaining > 0) {
    parts.push(t('correspondence.timeLeft', { time: formatDayClock(remaining) }, locale));
  }
  return parts.join(' · ');
}

/** Draws the row from the games on the player's move; hidden when there are none. */
export function renderLandingCorrespondenceMoves(
  box: HTMLElement,
  games: readonly CorrespondenceGame[],
  now = Date.now(),
): void {
  const yours = yourMoveGamesInOrder(games);
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
  for (const game of yours.slice(0, MAX_GAMES)) {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.className = 'landing-corr-moves-game hover-row';
    link.href = localizedHref(game.url, locale);
    const who = document.createElement('span');
    who.className = 'landing-corr-moves-name';
    who.textContent = yourMoveOpponentLabel(game, locale);
    const meta = document.createElement('span');
    meta.className = 'landing-corr-moves-meta';
    meta.textContent = yourMoveMeta(game, now, locale);
    link.append(who, meta);
    item.append(link);
    list.append(item);
  }
  box.replaceChildren(head, list);
}
