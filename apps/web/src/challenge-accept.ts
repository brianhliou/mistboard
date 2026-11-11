import './challenge.css';
import { variantDisplayLabel } from './game-display.js';
import { t } from './i18n/catalog.js';
import { localizedHref } from './i18n/locale.js';
import { appendWithNameNode, playerNameEl, profileTargetFor } from './profile-link.js';
import { accepterColorLabel, buildSeekAcceptAction, seekSignInHref } from './seek-accept.js';
import { buildLoadingState, buildNav, buildNotice } from './site-shell.js';
import { renderStartPositionSvg } from './start-position-board.js';

// The challenge landing page (/challenge/:id): where a shared "play me" link, a
// direct challenge or an open seek (the operator email, an old link) is opened.
// Reads GET /api/correspondence/seeks/:id and renders the right action (accept,
// decline, or for the creator the share link or Cancel) from the server's
// canAccept / canDecline / isMine flags. The copy follows `visibility`: a
// public seek is someone looking for a game, a private one is a challenge.

export type ChallengeView = {
  id: string;
  gameSpecId: string;
  daysPerMove: number;
  // Move order, not color (server migration 106).
  preferredColor: 'first' | 'second' | 'random';
  visibility: 'public' | 'private';
  challengerName: string | null;
  // Profile handle, sent only for an open, non-private account; absent/null
  // means the name renders as plain text (profile-link.ts, fail-closed).
  challengerHandle?: string | null;
  isMine: boolean;
  canAccept: boolean;
  canDecline: boolean;
  expired: boolean;
  // Rated correspondence (2026-10-02); absent reads as casual.
  rated?: boolean;
};

/**
 * The 410 body for a seek that has closed (server seekGoneView, #527). The server
 * sends it only when this viewer may know: a public seek, or a private challenge
 * the viewer was part of. Anyone else still gets the plain 404.
 */
export type SeekGone = {
  reason: 'taken' | 'withdrawn' | 'declined' | 'expired';
  roomId?: string;
  accepterName?: string | null;
  // Taken only: the viewer plays in the game, so the link opens it rather than watches it.
  youPlay?: boolean;
};

function specLabel(gameSpecId: string): string {
  return variantDisplayLabel(gameSpecId);
}

export async function mountChallengeAccept(root: HTMLElement, challengeId: string): Promise<void> {
  root.replaceChildren();
  root.classList.add('landing-page');
  root.append(buildNav(), buildLoadingState(t('challenge.loading')));

  const res = await fetch(`/api/correspondence/seeks/${encodeURIComponent(challengeId)}`).catch(
    () => null,
  );

  const shell = (node: HTMLElement) => {
    root.replaceChildren(buildNav(), node);
  };

  if (!res) {
    shell(buildNotice(t('challenge.unavailable'), t('challenge.unavailableBody')));
    return;
  }
  if (res.status === 401) {
    // A link challenge's 401 carries who, what and the pace (#1058); a directed
    // one, or anything unreadable, keeps the plain sign-in notice.
    const body = (await res.json().catch(() => null)) as { preview?: unknown } | null;
    const preview = parseChallengePreview(body?.preview);
    shell(
      preview ? buildSignedOutChallengeCard(preview, challengeId) : buildSignInNotice(challengeId),
    );
    return;
  }
  if (res.status === 404) {
    shell(buildClosedNotice());
    return;
  }
  if (res.status === 410) {
    const gone = (await res.json().catch(() => null)) as SeekGone | null;
    shell(buildGoneNotice(gone));
    return;
  }
  const view = (await res.json().catch(() => null)) as ChallengeView | null;
  if (!view) {
    shell(buildNotice(t('challenge.unavailable'), t('challenge.unavailableShortBody')));
    return;
  }

  shell(buildChallengeCard(view));
}

/** What the server tells a signed-out visitor about a link challenge (#1058). */
export type ChallengePreview = Pick<
  ChallengeView,
  | 'gameSpecId'
  | 'daysPerMove'
  | 'preferredColor'
  | 'visibility'
  | 'challengerName'
  | 'challengerHandle'
  | 'rated'
>;

export function parseChallengePreview(value: unknown): ChallengePreview | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.gameSpecId !== 'string' || typeof v.daysPerMove !== 'number') return null;
  const order = v.preferredColor;
  return {
    gameSpecId: v.gameSpecId,
    daysPerMove: v.daysPerMove,
    preferredColor: order === 'first' || order === 'second' ? order : 'random',
    visibility: v.visibility === 'public' ? 'public' : 'private',
    challengerName: typeof v.challengerName === 'string' ? v.challengerName : null,
    challengerHandle: typeof v.challengerHandle === 'string' ? v.challengerHandle : null,
    rated: v.rated === true,
  };
}

function buildSignInButton(challengeId: string, label = t('challenge.signIn')): HTMLElement {
  const signIn = document.createElement('a');
  signIn.className = 'challenge-btn';
  // Return here after signing in so the link converts a click into a game.
  signIn.href = seekSignInHref(challengeId);
  signIn.textContent = label;
  return signIn;
}

function buildSignInNotice(challengeId: string): HTMLElement {
  const notice = buildNotice(t('challenge.signInToPlay'), t('challenge.signInToPlayBody'));
  notice.append(buildSignInButton(challengeId));
  return notice;
}

/**
 * The /challenge page for a signed-out visitor: the same board, heading and
 * terms a signed-in reader sees, then "Sign in to play" in place of Accept.
 * The board is the variant's start position from the first side, so a fog
 * variant keeps its fogged tile (start-position-board.ts).
 */
export function buildSignedOutChallengeCard(
  preview: ChallengePreview,
  challengeId: string,
): HTMLElement {
  const view: ChallengeView = {
    ...preview,
    id: challengeId,
    isMine: false,
    canAccept: false,
    canDecline: false,
    expired: false,
  };
  const card = document.createElement('section');
  card.className = 'challenge-card';
  card.dataset.visibility = view.visibility;
  const body = document.createElement('div');
  body.className = 'challenge-body';
  card.append(buildBoard(view), body);
  body.append(buildHeading(view), buildTerms(view));
  const actions = document.createElement('div');
  actions.className = 'challenge-actions';
  actions.append(buildSignInButton(challengeId, t('challenge.signInToPlay')));
  body.append(actions);
  return card;
}

// A 404 says nothing about what the link was (a stranger to a private
// challenge gets the same answer), so the copy fits a seek and a challenge.
export function buildClosedNotice(): HTMLElement {
  const notice = buildNotice(t('challenge.notFound'), t('challenge.notFoundBody'));
  notice.append(buildOpenGamesLink('challenge-btn'));
  return notice;
}

// A 410 names what happened to the offer: taken (with the game), withdrawn,
// declined or expired. Anything unrecognised falls back to the plain closed notice.
export function buildGoneNotice(gone: SeekGone | null): HTMLElement {
  switch (gone?.reason) {
    case 'taken': {
      if (!gone.roomId) return buildClosedNotice();
      const notice = gone.youPlay
        ? buildNotice(t('challenge.gameStarted'), t('challenge.gameStartedBody'))
        : buildNotice(
            gone.accepterName
              ? t('challenge.takenBy', { name: gone.accepterName })
              : t('challenge.takenBySomeone'),
            t('challenge.takenBody'),
          );
      const game = document.createElement('a');
      game.className = 'challenge-btn';
      game.href = localizedHref(`/room/${encodeURIComponent(gone.roomId)}`);
      game.textContent = gone.youPlay ? t('challenge.openGame') : t('challenge.watch');
      notice.append(game);
      if (!gone.youPlay) notice.append(buildOpenGamesLink('challenge-btn-secondary'));
      return notice;
    }
    case 'withdrawn':
      return withOpenGamesLink(buildNotice(t('challenge.withdrawn'), t('challenge.withdrawnBody')));
    case 'declined':
      return withOpenGamesLink(
        buildNotice(t('challenge.declinedTitle'), t('challenge.declinedGoneBody')),
      );
    case 'expired':
      return withOpenGamesLink(
        buildNotice(t('challenge.expiredTitle'), t('challenge.expiredBody')),
      );
    default:
      return buildClosedNotice();
  }
}

function withOpenGamesLink(notice: HTMLElement): HTMLElement {
  notice.append(buildOpenGamesLink('challenge-btn'));
  return notice;
}

function buildOpenGamesLink(className: string): HTMLElement {
  const link = document.createElement('a');
  link.className = className;
  link.href = localizedHref('/games');
  link.textContent = t('challenge.seeOpenGames');
  return link;
}

function buildHeading(view: ChallengeView): HTMLElement {
  const heading = document.createElement('h1');
  heading.className = 'challenge-heading';
  const isPublic = view.visibility === 'public';
  if (view.isMine) {
    heading.textContent = isPublic ? t('challenge.yourSeek') : t('challenge.yourChallenge');
    return heading;
  }
  if (!view.challengerName) {
    heading.textContent = isPublic
      ? t('challenge.someoneLookingForGame')
      : t('challenge.youHaveBeenChallenged');
    return heading;
  }
  appendWithNameNode(
    heading,
    (token) =>
      isPublic
        ? t('challenge.nameLookingForGame', { name: token })
        : t('challenge.nameChallengedYou', { name: token }),
    playerNameEl(
      view.challengerName,
      profileTargetFor({ handle: view.challengerHandle }),
      'challenge-heading-name',
    ),
  );
  return heading;
}

// The variant's starting position, the same picture as the seek's card on
// /games. Your own seek is drawn from your side; someone else's from the
// first side, so a fog variant keeps its tile (start-position-board.ts).
function buildBoard(view: ChallengeView): HTMLElement {
  const board = document.createElement('div');
  board.className = 'challenge-board';
  board.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.className = 'challenge-board-label';
  label.textContent = specLabel(view.gameSpecId);
  board.append(label);
  const side = view.isMine ? (view.preferredColor === 'second' ? 'second' : 'first') : undefined;
  void renderStartPositionSvg(view.gameSpecId, side)
    .then((svg) => {
      if (!svg) return;
      const frame = document.createElement('div');
      frame.className = 'challenge-board-frame notranslate';
      frame.setAttribute('translate', 'no');
      frame.innerHTML = svg;
      frame.querySelector('svg')?.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      board.replaceChildren(frame);
    })
    .catch((err) => console.warn('[challenge] start board failed', err));
  return board;
}

// "Xiangqi · 3 days per move · You play Black", plus Rated when it is.
function buildTerms(view: ChallengeView): HTMLElement {
  const detail = document.createElement('p');
  detail.className = 'challenge-subhead';
  const terms = t('challenge.detail', {
    variant: specLabel(view.gameSpecId),
    cadence:
      view.daysPerMove === 1
        ? t('challenge.dayOption', { days: view.daysPerMove })
        : t('challenge.daysOption', { days: view.daysPerMove }),
    color: accepterColorLabel(view.gameSpecId, view.preferredColor) ?? t('challenge.randomColors'),
  });
  // Accepting a rated challenge plays for rating: say so before the button, not after.
  detail.textContent = view.rated === true ? `${terms} · ${t('play.rated')}` : terms;
  return detail;
}

export function buildChallengeCard(view: ChallengeView): HTMLElement {
  const isPublic = view.visibility === 'public';
  const card = document.createElement('section');
  card.className = 'challenge-card';
  card.dataset.visibility = view.visibility;

  const body = document.createElement('div');
  body.className = 'challenge-body';
  card.append(buildBoard(view), body);

  body.append(buildHeading(view), buildTerms(view));

  if (view.expired) {
    const note = document.createElement('p');
    note.className = 'challenge-status';
    note.textContent = isPublic ? t('challenge.seekClosed') : t('challenge.expired');
    body.append(note);
    if (isPublic) body.append(buildOpenGamesLink('challenge-btn-secondary'));
    return card;
  }

  const actions = document.createElement('div');
  actions.className = 'challenge-actions';

  const status = document.createElement('p');
  status.className = 'challenge-status';
  status.hidden = true;

  if (view.isMine && isPublic) {
    // A public seek is already on the open board; its creator needs a way to
    // take it down, not a link to pass around.
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'challenge-btn-secondary';
    cancel.textContent = t('challenge.cancel');
    cancel.addEventListener('click', () => {
      cancel.disabled = true;
      status.hidden = true;
      void fetch(`/api/correspondence/seeks/${encodeURIComponent(view.id)}`, { method: 'DELETE' })
        .then((res) => {
          // 404: already gone (taken or expired), which is what Cancel wanted.
          if (res.ok || res.status === 404) {
            const notice = buildNotice(
              t('challenge.seekCancelled'),
              t('challenge.seekCancelledBody'),
            );
            notice.append(buildOpenGamesLink('challenge-btn'));
            card.replaceWith(notice);
            return;
          }
          throw new Error(`cancel ${res.status}`);
        })
        .catch(() => {
          status.textContent = t('challenge.couldNotCancel');
          status.hidden = false;
          cancel.disabled = false;
        });
    });
    actions.append(cancel);
  } else if (view.isMine) {
    // A link challenge: the creator sees the shareable link and can copy it.
    const share = document.createElement('input');
    share.className = 'challenge-share-link';
    share.readOnly = true;
    share.value = `${location.origin}/challenge/${view.id}`;
    share.addEventListener('focus', () => share.select());
    body.append(share);

    const copy = document.createElement('button');
    copy.className = 'challenge-btn';
    copy.textContent = t('challenge.copyLink');
    copy.addEventListener('click', () => {
      // A browser may refuse the write (NotAllowedError on Android Chrome):
      // select the link instead so a long-press copy is one step away.
      const selectForManualCopy = (): void => {
        share.focus();
        share.select();
      };
      if (!navigator.clipboard?.writeText) {
        selectForManualCopy();
        return;
      }
      navigator.clipboard.writeText(share.value).then(() => {
        copy.textContent = t('challenge.copied');
      }, selectForManualCopy);
    });
    actions.append(copy);
  }

  if (view.canAccept) {
    actions.append(
      buildSeekAcceptAction({
        className: 'challenge-btn',
        label: t('challenge.accept'),
        onGone: () => {
          if (isPublic) actions.append(buildOpenGamesLink('challenge-btn-secondary'));
        },
        seek: view,
        // The page itself is account-gated: a 401 never reaches this card.
        signedIn: true,
        status,
        surface: 'challenge',
        visibility: view.visibility,
      }),
    );
  }

  if (view.canDecline) {
    const decline = document.createElement('button');
    decline.className = 'challenge-btn-secondary';
    decline.textContent = t('challenge.decline');
    decline.addEventListener('click', () => {
      decline.disabled = true;
      void fetch(`/api/correspondence/seeks/${encodeURIComponent(view.id)}/decline`, {
        method: 'POST',
      })
        .then(() => {
          card.replaceWith(buildNotice(t('challenge.declined'), t('challenge.declinedBody')));
        })
        .catch(() => {
          decline.disabled = false;
        });
    });
    actions.append(decline);
  }

  body.append(actions, status);
  return card;
}
