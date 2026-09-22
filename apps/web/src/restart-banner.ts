// Server-restart drain banner.
//
import './restart-banner.css';
import { t } from './i18n/catalog.js';

// Two sources update it:
//   1. /api/server-status at page boot (covers the case where the user loads
//      a page mid-drain — no WS broadcast was in flight for them).
//   2. WS messages `server_restart_scheduled` / `server_restart_cancelled`
//      pushed by the live socket when the admin drain endpoint fires.

let bannerEl: HTMLDivElement | null = null;
let labelEl: HTMLSpanElement | null = null;
let hintEl: HTMLSpanElement | null = null;
// The phase on screen, so a locale chunk landing after the banner was painted
// (a zh page loaded mid-drain) can repaint it in the right language.
let currentPhase: RestartBannerPhase | null = null;

export type RestartBannerPhase = 'pending' | 'restarting';

export function mountRestartBanner(): void {
  if (bannerEl && document.body.contains(bannerEl)) return;
  const el = document.createElement('div');
  el.className = 'restart-banner';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.hidden = true;
  el.innerHTML =
    '<span class="restart-banner__label" data-label></span>' +
    '<span class="restart-banner__hint" data-hint></span>';
  document.body.insertBefore(el, document.body.firstChild);
  bannerEl = el;
  labelEl = el.querySelector<HTMLSpanElement>('[data-label]');
  hintEl = el.querySelector<HTMLSpanElement>('[data-hint]');
}

export function setRestartBanner(phase: RestartBannerPhase | null): void {
  if (!bannerEl) mountRestartBanner();
  currentPhase = phase;
  if (phase === null) {
    if (bannerEl) bannerEl.hidden = true;
    return;
  }
  if (bannerEl) bannerEl.hidden = false;
  if (phase === 'pending') {
    if (labelEl) labelEl.textContent = t('connection.restartPending');
    if (hintEl) hintEl.textContent = t('connection.restartPendingHint');
  } else {
    if (labelEl) labelEl.textContent = t('connection.restartNow');
    if (hintEl) hintEl.textContent = t('connection.restartNowHint');
  }
}

/** Repaint the visible phase, if any, in the current locale (called once the
 *  locale chunk has loaded; before that `t()` answers in English). */
export function refreshRestartBanner(): void {
  if (currentPhase !== null) setRestartBanner(currentPhase);
}
