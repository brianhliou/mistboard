// Homepage correspondence card (2026-10-03 jieqi test). Jieqi is most of the
// site's human games, but nearly every jieqi player is a guest playing the bot
// once. This card offers the one thing a guest cannot get from the bot: a game
// that waits for you, one move a day, with an email when it is your turn. That
// needs an account, so the card is also the sign-up door.
//
// Three states, one footprint (two lines, so the rail never jumps between them
// or from the prerendered shell, which always carries the first):
//   start      "Jieqi by correspondence". Guests: a link to sign-up whose return
//              path carries ?corr=jieqi, and the homepage runs the quick pair on
//              arrival, so there is no second click. Signed in: runs it here.
//   your-move  you owe a move in some correspondence game: links to the first.
//   waiting    your quick-pair seek is up: links to /correspondence.

import {
  type CorrespondenceButtonState,
  trackCorrespondenceButtonClicked,
  trackCorrespondenceQuickPair,
  trackCorrespondenceSeekAccepted,
  trackCorrespondenceSeekPosted,
} from './analytics.js';
import { rememberCorrespondenceStartSource, rememberGameStartSource } from './game-start-source.js';
import { t } from './i18n/catalog.js';
import { currentLocale, type Locale, localizedHref } from './i18n/locale.js';
import { isLikelySignedIn } from './signed-in-state.js';
import { buildUiIcon } from './ui-icon.js';

/** The one offer the card makes. The server's quick-pair route accepts only this. */
export const CORRESPONDENCE_CARD_TERMS = { gameSpecId: 'jieqi', daysPerMove: 1 } as const;
/** The homepage query that says "a guest clicked the card and has now signed in". */
export const CORRESPONDENCE_INTENT_PARAM = 'corr';
const INTENT_VALUE = 'jieqi';
const QUICK_PAIR_URL = '/api/correspondence/quick-pair';
const START_SOURCE = 'home-correspondence' as const;

export type CorrespondenceCardState =
  | { kind: 'start' }
  | { kind: 'your-move'; count: number; href: string }
  | { kind: 'waiting' };

type GamesPayload = { games?: Array<{ url?: unknown; isYourMove?: unknown }> };
type SeeksPayload = {
  seeks?: Array<{
    gameSpecId?: unknown;
    daysPerMove?: unknown;
    rated?: unknown;
    visibility?: unknown;
  }>;
};

/** Pure: which state a signed-in visitor sees, from the two reads. A move owed
 *  anywhere outranks waiting, which outranks the offer. */
export function correspondenceCardState(
  games: GamesPayload | null,
  seeks: SeeksPayload | null,
): CorrespondenceCardState {
  const yourMove = (games?.games ?? []).filter(
    (game) => game.isYourMove === true && typeof game.url === 'string',
  );
  const first = yourMove[0];
  if (first && typeof first.url === 'string') {
    return { kind: 'your-move', count: yourMove.length, href: first.url };
  }
  const waiting = (seeks?.seeks ?? []).some(
    (seek) =>
      seek.visibility === 'public' &&
      seek.gameSpecId === CORRESPONDENCE_CARD_TERMS.gameSpecId &&
      seek.daysPerMove === CORRESPONDENCE_CARD_TERMS.daysPerMove &&
      seek.rated !== true,
  );
  return waiting ? { kind: 'waiting' } : { kind: 'start' };
}

/** Where a guest's click goes: sign-up, returning to the homepage with the intent. */
export function correspondenceGuestHref(locale: Locale): string {
  const returnTo = localizedHref(`/?${CORRESPONDENCE_INTENT_PARAM}=${INTENT_VALUE}`, locale);
  const params = new URLSearchParams({ tab: 'register', referrer: returnTo });
  return localizedHref(`/account?${params.toString()}`, locale);
}

/** True (and the query is stripped, so a reload does not pair again) when this
 *  page load is the return from sign-up that the card started. */
export function consumeCorrespondenceIntent(): boolean {
  const url = new URL(window.location.href);
  if (url.searchParams.get(CORRESPONDENCE_INTENT_PARAM) !== INTENT_VALUE) return false;
  url.searchParams.delete(CORRESPONDENCE_INTENT_PARAM);
  try {
    window.history.replaceState(
      window.history.state,
      '',
      `${url.pathname}${url.search}${url.hash}`,
    );
  } catch {
    // A sandboxed frame can refuse; the pair still runs once on this load.
  }
  return true;
}

export function buildLandingCorrespondenceCard(
  options: { hydrate?: boolean; locale?: Locale } = {},
): HTMLAnchorElement {
  const locale = options.locale ?? currentLocale();
  const card = document.createElement('a');
  card.className =
    'landing-play-action landing-play-action-dobutsu landing-corr-card landing-play-action-correspondence';
  const icon = document.createElement('span');
  icon.className = 'landing-play-icon landing-play-icon-dobutsu';
  icon.setAttribute('aria-hidden', 'true');
  icon.append(buildUiIcon('correspondence'));
  const text = document.createElement('span');
  text.className = 'landing-corr-text';
  const title = document.createElement('span');
  title.className = 'landing-corr-title';
  const subline = document.createElement('span');
  subline.className = 'landing-corr-subline';
  text.append(title, subline);
  card.append(icon, text);

  let state: CorrespondenceCardState = { kind: 'start' };
  let busy = false;

  const render = (next: CorrespondenceCardState): void => {
    state = next;
    card.dataset.state = next.kind;
    card.removeAttribute('aria-busy');
    if (next.kind === 'your-move') {
      title.textContent =
        next.count === 1
          ? t('home.corrYourMoveOne', {}, locale)
          : t('home.corrYourMoveMany', { count: String(next.count) }, locale);
      subline.textContent = t('home.corrYourMoveSubline', {}, locale);
      card.href = next.href;
      return;
    }
    if (next.kind === 'waiting') {
      title.textContent = t('home.corrWaiting', {}, locale);
      subline.textContent = t('home.corrWaitingSubline', {}, locale);
      card.href = '/correspondence';
      return;
    }
    title.textContent = t('home.corrTitle', {}, locale);
    subline.textContent = t('home.corrSubline', {}, locale);
    card.href = correspondenceGuestHref(locale);
  };

  const quickPair = async (afterAuth: boolean): Promise<void> => {
    if (busy) return;
    busy = true;
    card.setAttribute('aria-busy', 'true');
    subline.textContent = t('home.corrBusy', {}, locale);
    const outcome = await requestQuickPair();
    busy = false;
    const common = { afterAuth, locale, ...CORRESPONDENCE_CARD_TERMS };
    if (outcome.kind === 'game') {
      trackCorrespondenceQuickPair({ ...common, outcome: 'game' });
      trackCorrespondenceSeekAccepted({ ...CORRESPONDENCE_CARD_TERMS, surface: 'home-button' });
      rememberGameStartSource(START_SOURCE);
      window.location.assign(outcome.gameUrl);
      return;
    }
    if (outcome.kind === 'seek') {
      trackCorrespondenceQuickPair({
        ...common,
        outcome: outcome.existing ? 'seek-existing' : 'seek-posted',
      });
      if (!outcome.existing) {
        trackCorrespondenceSeekPosted({
          ...CORRESPONDENCE_CARD_TERMS,
          kind: 'public',
          surface: 'home-button',
        });
        // The game starts for this player days later, from an email.
        rememberCorrespondenceStartSource(START_SOURCE, CORRESPONDENCE_CARD_TERMS.gameSpecId);
      }
      render({ kind: 'waiting' });
      return;
    }
    if (outcome.kind === 'signed-out') {
      render({ kind: 'start' });
      // A stale signed-in hint: send them to sign-up with the intent. On the
      // return trip (afterAuth) a 401 means the sign-in did not stick; stop.
      if (!afterAuth) window.location.assign(correspondenceGuestHref(locale));
      return;
    }
    trackCorrespondenceQuickPair({ ...common, outcome: 'error', error: outcome.error });
    card.removeAttribute('aria-busy');
    subline.textContent = t('home.corrFailed', {}, locale);
  };

  card.addEventListener('click', (event) => {
    const signedIn = isLikelySignedIn();
    trackCorrespondenceButtonClicked({
      buttonState: state.kind as CorrespondenceButtonState,
      signedIn,
      locale,
      ...CORRESPONDENCE_CARD_TERMS,
    });
    // your-move and waiting are plain links; a guest's start is the sign-up link.
    if (state.kind !== 'start' || !signedIn) return;
    event.preventDefault();
    void quickPair(false);
  });

  render({ kind: 'start' });
  if (options.hydrate !== false) {
    if (consumeCorrespondenceIntent()) {
      void quickPair(true);
    } else if (isLikelySignedIn()) {
      void hydrateCorrespondenceCard().then((next) => {
        if (!busy) render(next);
      });
    }
  }
  return card;
}

async function hydrateCorrespondenceCard(): Promise<CorrespondenceCardState> {
  const [games, seeks] = await Promise.all([
    fetchJson<GamesPayload>('/api/correspondence/games'),
    fetchJson<SeeksPayload>('/api/correspondence/seeks/mine'),
  ]);
  return correspondenceCardState(games, seeks);
}

type QuickPairOutcome =
  | { kind: 'game'; gameUrl: string }
  | { kind: 'seek'; existing: boolean }
  | { kind: 'signed-out' }
  | { kind: 'error'; error: string };

async function requestQuickPair(): Promise<QuickPairOutcome> {
  try {
    const response = await fetch(QUICK_PAIR_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(CORRESPONDENCE_CARD_TERMS),
    });
    const body = (await response.json().catch(() => null)) as {
      kind?: unknown;
      gameUrl?: unknown;
      existing?: unknown;
      error?: unknown;
    } | null;
    if (response.status === 401) return { kind: 'signed-out' };
    if (response.ok && body?.kind === 'game' && typeof body.gameUrl === 'string') {
      return { kind: 'game', gameUrl: body.gameUrl };
    }
    if (response.ok && body?.kind === 'seek')
      return { kind: 'seek', existing: body.existing === true };
    return {
      kind: 'error',
      error: typeof body?.error === 'string' ? body.error : `http_${response.status}`,
    };
  } catch {
    return { kind: 'error', error: 'network' };
  }
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}
