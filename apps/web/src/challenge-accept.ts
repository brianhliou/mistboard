import './challenge.css';
import { trackCorrespondenceSeekAccepted } from './analytics.js';
import { firstMoverColorName, secondMoverColorName, variantDisplayLabel } from './game-display.js';
import { t } from './i18n/catalog.js';
import { buildLoadingState, buildNav, buildNotice } from './site-shell.js';

// The challenge landing page (/challenge/:id): where a shared "play me" link or
// a direct challenge is opened. Reads GET /api/correspondence/seeks/:id and
// renders the right action — accept, decline, or (for the creator) the share
// link — from the server's canAccept / canDecline / isMine flags.

type ChallengeView = {
  id: string;
  gameSpecId: string;
  daysPerMove: number;
  // Move order, not color (server migration 106).
  preferredColor: 'first' | 'second' | 'random';
  visibility: 'public' | 'private';
  challengerName: string | null;
  isMine: boolean;
  canAccept: boolean;
  canDecline: boolean;
  expired: boolean;
  // Rated correspondence (2026-10-02); absent reads as casual.
  rated?: boolean;
};

function specLabel(gameSpecId: string): string {
  return variantDisplayLabel(gameSpecId);
}

function colorLabel(gameSpecId: string, color: ChallengeView['preferredColor']): string {
  if (color === 'random') return t('challenge.randomColors');
  // The challenger picked their side; the accepter takes the OTHER, so the label names the
  // opposite of what the challenger chose.
  return color === 'first'
    ? t('challenge.youPlayColor', { color: secondMoverColorName(gameSpecId) })
    : t('challenge.youPlayColor', { color: firstMoverColorName(gameSpecId) });
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
    const notice = buildNotice(t('challenge.signInToPlay'), t('challenge.signInToPlayBody'));
    const signIn = document.createElement('a');
    signIn.className = 'challenge-btn';
    // Return here after signing in so the link converts a click into a game.
    signIn.href = `/account?return=${encodeURIComponent(`/challenge/${challengeId}`)}`;
    signIn.textContent = t('challenge.signIn');
    notice.append(signIn);
    shell(notice);
    return;
  }
  if (res.status === 404) {
    shell(buildNotice(t('challenge.notFound'), t('challenge.notFoundBody')));
    return;
  }
  const view = (await res.json().catch(() => null)) as ChallengeView | null;
  if (!view) {
    shell(buildNotice(t('challenge.unavailable'), t('challenge.unavailableShortBody')));
    return;
  }

  shell(buildChallengeCard(view));
}

function buildChallengeCard(view: ChallengeView): HTMLElement {
  const card = document.createElement('section');
  card.className = 'challenge-card';

  const heading = document.createElement('h1');
  heading.className = 'challenge-heading';
  if (view.isMine) heading.textContent = t('challenge.yourChallenge');
  else if (view.challengerName)
    heading.textContent = t('challenge.nameChallengedYou', { name: view.challengerName });
  else heading.textContent = t('challenge.youHaveBeenChallenged');
  card.append(heading);

  const detail = document.createElement('p');
  detail.className = 'challenge-subhead';
  const terms = t('challenge.detail', {
    variant: specLabel(view.gameSpecId),
    cadence:
      view.daysPerMove === 1
        ? t('challenge.dayOption', { days: view.daysPerMove })
        : t('challenge.daysOption', { days: view.daysPerMove }),
    color: colorLabel(view.gameSpecId, view.preferredColor),
  });
  // Accepting a rated challenge plays for rating: say so before the button, not after.
  detail.textContent = view.rated === true ? `${terms} · ${t('play.rated')}` : terms;
  card.append(detail);

  if (view.expired) {
    const note = document.createElement('p');
    note.className = 'challenge-status';
    note.textContent = t('challenge.expired');
    card.append(note);
    return card;
  }

  const actions = document.createElement('div');
  actions.className = 'challenge-actions';

  const status = document.createElement('p');
  status.className = 'challenge-status';
  status.hidden = true;

  if (view.isMine) {
    // The creator sees the shareable link and can copy it.
    const share = document.createElement('input');
    share.className = 'challenge-share-link';
    share.readOnly = true;
    share.value = `${location.origin}/challenge/${view.id}`;
    share.addEventListener('focus', () => share.select());
    card.append(share);

    const copy = document.createElement('button');
    copy.className = 'challenge-btn';
    copy.textContent = t('challenge.copyLink');
    copy.addEventListener('click', () => {
      void navigator.clipboard?.writeText(share.value);
      copy.textContent = t('challenge.copied');
    });
    actions.append(copy);
  }

  if (view.canAccept) {
    const accept = document.createElement('button');
    accept.className = 'challenge-btn';
    accept.textContent = t('challenge.accept');
    accept.addEventListener('click', () => {
      accept.disabled = true;
      status.hidden = true;
      void fetch(`/api/correspondence/seeks/${encodeURIComponent(view.id)}/accept`, {
        method: 'POST',
      })
        .then(async (res) => {
          const body = (await res.json().catch(() => null)) as {
            url?: string;
            error?: string;
          } | null;
          if (res.ok && body?.url) {
            trackCorrespondenceSeekAccepted({
              gameSpecId: view.gameSpecId,
              daysPerMove: view.daysPerMove,
              surface: 'challenge',
            });
            location.href = body.url;
            return;
          }
          status.textContent =
            body?.error === 'challenge_expired'
              ? t('challenge.expired')
              : body?.error === 'seek_taken'
                ? t('challenge.alreadyAccepted')
                : t('challenge.couldNotAccept');
          status.hidden = false;
          accept.disabled = false;
        })
        .catch(() => {
          status.textContent = t('challenge.couldNotAccept');
          status.hidden = false;
          accept.disabled = false;
        });
    });
    actions.append(accept);
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
          card.replaceChildren(buildNotice(t('challenge.declined'), t('challenge.declinedBody')));
        })
        .catch(() => {
          decline.disabled = false;
        });
    });
    actions.append(decline);
  }

  card.append(actions, status);
  return card;
}
