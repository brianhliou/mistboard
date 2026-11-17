import { t } from './i18n/catalog.js';
import type { Locale } from './i18n/locale.js';
import { type LiveInviteView, mountLiveInviteWaiting } from './live-invites.js';

/** A directed send is never retried as a room/link or correspondence seek. */
export function createLandingLiveChallenge(options: {
  button: HTMLButtonElement;
  status: HTMLElement;
  waiting: HTMLElement;
  locale: Locale;
  onSent(): void;
  onStarted(): void;
  onAccountRequired(): void;
  onUnavailable(): void;
  onSettled(): void;
}) {
  let disposed = false;
  let sending = false;
  let activeRequest: AbortController | undefined;
  let unmount: (() => void) | undefined;
  return {
    async send(
      terms: Pick<LiveInviteView, 'gameSpecId' | 'timeControl' | 'preferredColor' | 'rated'> & {
        targetHandle: string;
      },
    ) {
      if (disposed || sending || unmount) return;
      sending = true;
      const abort = new AbortController();
      activeRequest = abort;
      options.button.disabled = true;
      options.button.setAttribute('aria-busy', 'true');
      options.status.textContent = '';
      const deadline = setTimeout(() => abort.abort(), 10_000);
      try {
        const response = await fetch('/api/live-invites', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(terms),
          signal: abort.signal,
        });
        if (disposed) return;
        if (response.status === 401) {
          options.onAccountRequired();
          return;
        }
        if (!response.ok) {
          const data = (await response.json()) as { error?: string };
          if (!disposed) {
            if (data.error === 'target_unavailable') options.onUnavailable();
            options.status.textContent = t(
              data.error === 'target_unavailable'
                ? 'challenge.liveUnavailable'
                : 'challenge.liveRetry',
              {},
              options.locale,
            );
          }
          return;
        }
        const data = (await response.json()) as { invite: LiveInviteView };
        if (disposed) return;
        const stopWaiting = mountLiveInviteWaiting(options.waiting, data.invite, options.onStarted);
        // An already accepted response may have joined and disposed this UI
        // synchronously while mounting the waiting state.
        if (disposed) {
          stopWaiting();
          return;
        }
        unmount = stopWaiting;
        options.onSent();
      } catch {
        if (!disposed) options.status.textContent = t('challenge.liveRetry', {}, options.locale);
      } finally {
        clearTimeout(deadline);
        sending = false;
        activeRequest = undefined;
        if (!disposed) {
          options.button.removeAttribute('aria-busy');
          options.onSettled();
        }
      }
    },
    dispose() {
      disposed = true;
      activeRequest?.abort();
      unmount?.();
    },
  };
}
