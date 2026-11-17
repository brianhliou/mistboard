import './live-invites.css';
import {
  type AccountPreferences,
  accountPreferencesChangedEvent,
  accountPreferencesStorageKey,
  readAccountPreferences,
  replaceAccountPreferences,
} from './account-preferences.js';
import { firstMoverColorName, secondMoverColorName, variantDisplayLabel } from './game-display.js';
import { type I18nKey, t } from './i18n/catalog.js';
import { localizedHref, stripLocalePrefix } from './i18n/locale.js';
import { timeControlLabelFromMeta } from './replay-meta.js';

export type LiveInviteView = {
  id: string;
  sender: { handle: string; displayName: string };
  target: { handle: string; displayName: string };
  gameSpecId: string;
  timeControl: { initialMs: number; incrementMs: number };
  preferredColor: 'first' | 'second' | 'random';
  rated: boolean;
  createdAt: string;
  expiresAt: string;
  status:
    | 'pending'
    | 'accepting'
    | 'accepted'
    | 'cancelled'
    | 'declined'
    | 'expired'
    | 'unavailable';
  isMine: boolean;
  canAccept: boolean;
  canCancel: boolean;
  canDecline: boolean;
  room?: { roomId: string; url: string; seat: string };
};

const base = '/api/live-invites';
const statusKeys = {
  pending: 'challenge.liveWaiting',
  accepting: 'challenge.liveAccepting',
  accepted: 'challenge.liveAccepted',
  cancelled: 'challenge.liveCancelled',
  declined: 'challenge.liveDeclined',
  expired: 'challenge.liveExpired',
  unavailable: 'challenge.liveUnavailable',
} as const satisfies Record<LiveInviteView['status'], I18nKey>;

function active(invite: LiveInviteView): boolean {
  return invite.status === 'pending' || invite.status === 'accepting';
}

/** One controller per document. Each tab renews the shared account lease; leaving
 * a page never DELETEs it, since revocation would also make other tabs offline. */
export function createLiveInviteController(options: { navigate?: (url: string) => void } = {}) {
  const navigate = options.navigate ?? ((url: string) => window.location.assign(url));
  const tray = document.createElement('aside');
  tray.className = 'live-invites';
  tray.setAttribute('aria-label', t('challenge.liveTitle'));
  tray.hidden = true;
  document.body.append(tray);
  const records = new Map<string, LiveInviteView>();
  const cards = new Map<string, { element: HTMLElement; signature: string }>();
  const waiting = new Map<HTMLElement, { id: string; onJoined?: () => void }>();
  const dismissed = new Set<string>();
  const joined = new Set<string>();
  const busy = new Set<string>();
  const errors = new Map<string, string>();
  let userId: string | null = null;
  let epoch = 0;
  let revision = 0;
  let authRevision = 0;
  let stopped = false;
  let suspended = false;
  let abort = new AbortController();
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let tickTimer: ReturnType<typeof setInterval> | undefined;
  let reconnecting = false;
  let pollMs = 5_000;

  const current = (version: number) => !stopped && !suspended && !!userId && version === epoch;
  const seenKey = (id: string) => `mistboard.liveInvites.joined.${userId}.${id}`;
  const pendingKey = () => `mistboard.liveInvites.pending.${userId}`;
  function persistPending(): void {
    if (!userId) return;
    try {
      window.sessionStorage.setItem(
        pendingKey(),
        JSON.stringify([...records.values()].filter(active)),
      );
    } catch {
      // Invites still work in this document if browser storage is unavailable.
    }
  }

  function restorePending(): void {
    try {
      const saved: unknown = JSON.parse(window.sessionStorage.getItem(pendingKey()) ?? '[]');
      if (!Array.isArray(saved)) return;
      for (const value of saved.slice(0, 3)) {
        if (!value || typeof value !== 'object') continue;
        const invite = value as LiveInviteView;
        // Only an id is needed to inspect after reload. Do not render cached
        // terms or navigate until the server has returned a participant view.
        if (typeof invite.id === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(invite.id)) {
          restoredIds.add(invite.id);
        }
      }
    } catch {
      // Ignore missing or malformed per-tab state.
    }
  }
  const restoredIds = new Set<string>();
  const hasJoined = (id: string) => {
    if (joined.has(id)) return true;
    try {
      return window.sessionStorage.getItem(seenKey(id)) === '1';
    } catch {
      return false;
    }
  };

  function follow(invite: LiveInviteView): void {
    if (invite.status !== 'accepted' || !invite.room || hasJoined(invite.id)) return;
    // Only the reserved-room path is a navigation target, including on reload.
    const path = `/room/${encodeURIComponent(invite.room.roomId)}`;
    if (invite.room.url !== path) return;
    joined.add(invite.id);
    try {
      window.sessionStorage.setItem(seenKey(invite.id), '1');
    } catch {
      // The in-memory set still prevents repeat navigation in this document.
    }
    if (stripLocalePrefix(window.location.pathname) !== path) {
      for (const entry of waiting.values()) {
        if (entry.id === invite.id) entry.onJoined?.();
      }
      navigate(localizedHref(path));
    }
  }

  function remember(invite: LiveInviteView): void {
    const previous = records.get(invite.id);
    // A delayed poll cannot turn a completed offer back into a pending one.
    if (previous && !active(previous) && active(invite)) return;
    records.set(invite.id, invite);
    persistPending();
    follow(invite);
    // Keep a small, dismissible history without accumulating DOM over a long visit.
    for (const [id, record] of records) {
      if (records.size <= 20) break;
      if (!active(record)) records.delete(id);
    }
  }

  async function request(path: string, method = 'GET') {
    const version = epoch;
    const sessionSignal = abort.signal;
    const deadline = new AbortController();
    const onAbort = () => deadline.abort();
    sessionSignal.addEventListener('abort', onAbort, { once: true });
    const timeout = setTimeout(() => deadline.abort(), 10_000);
    try {
      const response = await fetch(path, {
        method,
        credentials: 'same-origin',
        cache: 'no-store',
        signal: deadline.signal,
        ...(method === 'POST'
          ? { headers: { 'content-type': 'application/json' }, body: '{}' }
          : {}),
      });
      if (response.status === 401 && current(version)) setUser(null);
      return response;
    } finally {
      clearTimeout(timeout);
      sessionSignal.removeEventListener('abort', onAbort);
    }
  }

  function interval(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.max(1_000, Math.min(5_000, value))
      : 5_000;
  }

  async function poll(version: number): Promise<void> {
    const startedRevision = revision;
    try {
      const heartbeat = await request(`${base}/heartbeat`, 'POST');
      if (!current(version)) return;
      if (!heartbeat.ok) throw new Error('heartbeat failed');
      const lease = (await heartbeat.json()) as { pollAfterMs?: number; leaseMs?: number };
      if (!current(version)) return;
      pollMs = Math.min(interval(lease.pollAfterMs), interval((lease.leaseMs ?? 15_000) / 3));
      const response = await request(base);
      if (!current(version)) return;
      if (!response.ok) throw new Error('poll failed');
      const data = (await response.json()) as {
        incoming: LiveInviteView[];
        outgoing: LiveInviteView[];
        pollAfterMs?: number;
      };
      if (!current(version) || startedRevision !== revision) return;
      pollMs = Math.min(pollMs, interval(data.pollAfterMs));
      const listed = [...data.incoming, ...data.outgoing];
      const ids = new Set(listed.map((invite) => invite.id));
      for (const id of [...restoredIds]) {
        if (ids.has(id)) {
          restoredIds.delete(id);
          continue;
        }
        const detail = await request(`${base}/${encodeURIComponent(id)}`);
        if (!current(version) || startedRevision !== revision) return;
        if (detail.ok) {
          const body = (await detail.json()) as { invite: LiveInviteView };
          if (!current(version) || startedRevision !== revision) return;
          remember(body.invite);
          restoredIds.delete(id);
        } else if (detail.status === 404) restoredIds.delete(id);
        else throw new Error('inspection failed');
      }
      // The list omits declined/cancelled/expired/unavailable offers. Inspect
      // known missing ids so the sender sees the actual retained outcome.
      for (const invite of [...records.values()]) {
        if (!active(invite) || ids.has(invite.id) || busy.has(invite.id)) continue;
        const detail = await request(`${base}/${encodeURIComponent(invite.id)}`);
        if (!current(version) || startedRevision !== revision) return;
        if (detail.ok) {
          const body = (await detail.json()) as { invite: LiveInviteView };
          if (!current(version) || startedRevision !== revision) return;
          remember(body.invite);
        } else if (detail.status === 404) {
          remember({ ...invite, status: 'unavailable' });
        } else throw new Error('inspection failed');
      }
      if (!current(version) || startedRevision !== revision) return;
      for (const invite of listed) if (!busy.has(invite.id)) remember(invite);
      reconnecting = false;
    } catch {
      if (current(version)) reconnecting = true;
    } finally {
      if (current(version)) {
        render();
        pollTimer = setTimeout(() => void poll(version), pollMs);
      }
    }
  }

  async function act(id: string, action: 'accept' | 'decline' | 'cancel'): Promise<void> {
    const invite = records.get(id);
    if (!invite || busy.has(id) || !active(invite)) return;
    const version = epoch;
    revision++;
    busy.add(id);
    errors.delete(id);
    render();
    try {
      const path = `${base}/${encodeURIComponent(id)}${action === 'cancel' ? '' : `/${action}`}`;
      const response = await request(path, action === 'cancel' ? 'DELETE' : 'POST');
      if (!current(version)) return;
      if (response.ok) {
        const data = (await response.json()) as { invite: LiveInviteView };
        if (current(version)) remember(data.invite);
      } else {
        // A competing tab may already have accepted. Read its authoritative
        // outcome; transient room-creation failures stay retryable.
        const detail = await request(`${base}/${encodeURIComponent(id)}`);
        if (!current(version)) return;
        if (detail.ok) {
          const data = (await detail.json()) as { invite: LiveInviteView };
          if (current(version)) remember(data.invite);
        } else if (detail.status === 404) remember({ ...invite, status: 'unavailable' });
        if (current(version) && active(records.get(id)!)) errors.set(id, t('challenge.liveRetry'));
      }
    } catch {
      if (current(version)) errors.set(id, t('challenge.liveRetry'));
    } finally {
      if (current(version)) {
        revision++;
        busy.delete(id);
        render();
      }
    }
  }

  function card(invite: LiveInviteView): HTMLElement {
    const element = document.createElement('section');
    element.className = 'live-invite';
    element.dataset.inviteId = invite.id;
    const heading = document.createElement('h2');
    const party = invite.isMine ? invite.target : invite.sender;
    heading.textContent = t(invite.isMine ? 'challenge.liveSent' : 'challenge.liveIncoming', {
      // A new account's display name is its handle; say it once.
      name:
        party.displayName === party.handle
          ? `@${party.handle}`
          : `${party.displayName} (@${party.handle})`,
    });
    const terms = document.createElement('p');
    const first = invite.preferredColor === 'first';
    const side =
      invite.preferredColor === 'random'
        ? t('challenge.randomColors')
        : t('challenge.youPlayColor', {
            color: (invite.isMine === first ? firstMoverColorName : secondMoverColorName)(
              invite.gameSpecId,
            ),
          });
    terms.textContent = `${variantDisplayLabel(invite.gameSpecId)} · ${timeControlLabelFromMeta(invite.timeControl)} · ${side} · ${t(invite.rated ? 'play.rated' : 'play.casual')}`;
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    status.textContent = errors.get(invite.id) ?? t(statusKeys[invite.status]);
    element.append(heading, terms, status);
    if (invite.status === 'pending') {
      const countdown = document.createElement('p');
      countdown.dataset.inviteCountdown = invite.expiresAt;
      countdown.setAttribute('aria-live', 'off');
      element.append(countdown);
    }
    const actions = document.createElement('div');
    actions.className = 'live-invite-actions';
    const button = (label: I18nKey, action: () => void, live = false) => {
      const control = document.createElement('button');
      control.type = 'button';
      control.textContent = t(label);
      control.disabled = busy.has(invite.id);
      if (live) control.dataset.inviteAction = '';
      control.addEventListener('click', action);
      actions.append(control);
    };
    if (invite.status === 'pending') {
      if (invite.isMine && invite.canCancel)
        button('challenge.cancel', () => void act(invite.id, 'cancel'), true);
      if (!invite.isMine && readAccountPreferences().liveInvites) {
        if (invite.canAccept) button('challenge.accept', () => void act(invite.id, 'accept'), true);
        if (invite.canDecline)
          button('challenge.decline', () => void act(invite.id, 'decline'), true);
      }
    } else if (!active(invite)) {
      if (invite.status === 'accepted' && invite.room) {
        const path = `/room/${encodeURIComponent(invite.room.roomId)}`;
        if (invite.room.url === path) {
          const link = document.createElement('a');
          link.href = localizedHref(path);
          link.textContent = t('challenge.liveOpenGame');
          actions.append(link);
        }
      }
      button('challenge.liveDismiss', () => {
        dismissed.add(invite.id);
        render();
      });
    }
    element.append(actions);
    return element;
  }

  function tick(host: HTMLElement): void {
    for (const node of host.querySelectorAll<HTMLElement>('[data-invite-countdown]')) {
      const seconds = Math.max(
        0,
        Math.ceil((Date.parse(node.dataset.inviteCountdown!) - Date.now()) / 1_000),
      );
      node.textContent = seconds
        ? t('challenge.liveRemaining', { seconds })
        : t('challenge.liveExpired');
      for (const button of node.parentElement!.querySelectorAll<HTMLButtonElement>(
        '[data-invite-action]',
      )) {
        button.disabled = seconds === 0 || busy.has(node.parentElement!.dataset.inviteId!);
      }
    }
  }

  // The tray can't be seen from another tab, and an invitation lasts a minute,
  // so a hidden tab carries the count in its title until the player looks.
  let titlePrefix: string | null = null;
  function updateTitle(): void {
    const count =
      userId && !suspended && document.visibilityState === 'hidden'
        ? [...records.values()].filter(
            (invite) =>
              !invite.isMine &&
              invite.status === 'pending' &&
              !dismissed.has(invite.id) &&
              Date.parse(invite.expiresAt) > Date.now(),
          ).length
        : 0;
    const base =
      titlePrefix && document.title.startsWith(titlePrefix)
        ? document.title.slice(titlePrefix.length)
        : document.title;
    titlePrefix = count ? `(${count}) ${t('challenge.liveTabTitle')} · ` : null;
    const next = `${titlePrefix ?? ''}${base}`;
    if (document.title !== next) document.title = next;
  }
  const onVisibility = () => updateTitle();

  function render(): void {
    // An accepted offer has done its job once its player is in that room; left
    // up, its card would cover the board until dismissed by hand.
    const here = stripLocalePrefix(window.location.pathname);
    for (const [id, invite] of records) {
      if (
        invite.status === 'accepted' &&
        invite.room &&
        here === `/room/${encodeURIComponent(invite.room.roomId)}`
      )
        dismissed.add(id);
    }
    for (const [id, cached] of cards) {
      if (!records.has(id) || dismissed.has(id)) {
        cached.element.remove();
        cards.delete(id);
      }
    }
    for (const [id, invite] of records) {
      if (dismissed.has(id)) continue;
      const signature = JSON.stringify([
        invite,
        busy.has(id),
        errors.get(id),
        readAccountPreferences().liveInvites,
      ]);
      const previous = cards.get(id);
      if (previous?.signature === signature) continue;
      const element = card(invite);
      if (previous) previous.element.replaceWith(element);
      else tray.append(element);
      cards.set(id, { element, signature });
    }
    let connection = tray.querySelector<HTMLElement>('.live-invite-connection');
    if (reconnecting && records.size) {
      if (!connection) {
        connection = document.createElement('p');
        connection.className = 'live-invite-connection';
        connection.setAttribute('role', 'status');
        tray.append(connection);
      }
      connection.textContent = t('challenge.liveReconnecting');
    } else connection?.remove();
    tray.hidden = !userId || suspended || cards.size === 0;
    updateTitle();
    tick(tray);
    for (const [host, { id }] of waiting) {
      const invite = records.get(id);
      host.replaceChildren(
        ...(invite && userId && !suspended && !dismissed.has(id) ? [card(invite)] : []),
      );
      tick(host);
    }
  }

  function pause(clearRecords = true): void {
    epoch++;
    abort.abort();
    abort = new AbortController();
    clearTimeout(pollTimer);
    clearInterval(tickTimer);
    if (clearRecords) {
      records.clear();
      restoredIds.clear();
    }
    busy.clear();
    errors.clear();
    dismissed.clear();
    joined.clear();
    reconnecting = false;
    render();
  }

  function start(): void {
    if (!userId || stopped || suspended) return;
    const version = epoch;
    tickTimer = setInterval(() => {
      tick(tray);
      for (const host of waiting.keys()) tick(host);
    }, 1_000);
    void poll(version);
  }

  function setUser(next: string | null): void {
    authRevision++;
    if (stopped || userId === next) return;
    pause();
    userId = next;
    if (userId) restorePending();
    render();
    start();
  }

  const onPageHide = () => {
    suspended = true;
    pause(false);
  };
  const onPageShow = () => {
    if (!suspended) return;
    suspended = false;
    render();
    start();
  };
  const onPreferences = () => render();
  const onStorage = (event: StorageEvent) => {
    if (event.key === accountPreferencesStorageKey) render();
    if (event.key === 'mb_cached_user' || event.key === null) {
      // Cached identity is only a signal. Never start a new account's heartbeat
      // on the strength of another tab's localStorage value.
      setUser(null);
      const version = authRevision;
      const requestEpoch = epoch;
      void fetch('/api/auth/me', {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: abort.signal,
      })
        .then(async (response) => {
          if (!response.ok) return;
          const data = (await response.json()) as {
            user?: { id: string; accountPreferences?: Partial<AccountPreferences> } | null;
          };
          if (!stopped && !suspended && version === authRevision && requestEpoch === epoch) {
            if (data.user) replaceAccountPreferences(data.user.accountPreferences);
            setUser(data.user?.id ?? null);
          }
        })
        .catch(() => {});
    }
  };
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('storage', onStorage);
  window.addEventListener(accountPreferencesChangedEvent, onPreferences);

  return {
    setUser,
    watch(invite: LiveInviteView): void {
      if (!userId || stopped || suspended) return;
      revision++;
      remember(invite);
      render();
    },
    mountWaiting(host: HTMLElement, invite: LiveInviteView, onJoined?: () => void): () => void {
      waiting.set(host, { id: invite.id, onJoined });
      this.watch(invite);
      render();
      return () => {
        waiting.delete(host);
        host.replaceChildren();
      };
    },
    dispose(): void {
      stopped = true;
      userId = null;
      pause();
      waiting.clear();
      tray.remove();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(accountPreferencesChangedEvent, onPreferences);
    },
  };
}

let controller: ReturnType<typeof createLiveInviteController> | undefined;

export function initializeLiveInvites(): void {
  controller ??= createLiveInviteController();
}

export function setLiveInviteUser(id: string | null): void {
  controller?.setUser(id);
}

export function disposeLiveInvites(): void {
  controller?.dispose();
  controller = undefined;
}

/** Reusable by send controls: pass the POST response's participant view. The
 * document controller continues tracking the offer after the sender UI unmounts. */
export function mountLiveInviteWaiting(
  host: HTMLElement,
  invite: LiveInviteView,
  onJoined?: () => void,
): () => void {
  if (!controller) throw new Error('Live invite controller is not initialized');
  return controller.mountWaiting(host, invite, onJoined);
}
