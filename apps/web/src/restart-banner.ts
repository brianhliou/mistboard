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
let currentRestartAt: number | null = null;
let countdownTimer: number | null = null;

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

export function setRestartBanner(
  phase: RestartBannerPhase | null,
  restartAt?: number | null,
): void {
  if (!bannerEl) mountRestartBanner();
  clearCountdown();
  currentPhase = phase;
  currentRestartAt =
    phase === 'pending' && typeof restartAt === 'number' && Number.isFinite(restartAt)
      ? restartAt
      : null;
  renderRestartBanner();
  if (currentRestartAt !== null && currentRestartAt > Date.now()) {
    countdownTimer = window.setInterval(renderRestartBanner, 1_000);
  }
}

function clearCountdown(): void {
  if (countdownTimer !== null) window.clearInterval(countdownTimer);
  countdownTimer = null;
}

function renderRestartBanner(): void {
  const phase = currentPhase;
  if (phase === null) {
    if (bannerEl) bannerEl.hidden = true;
    return;
  }
  if (bannerEl) bannerEl.hidden = false;
  if (phase === 'pending') {
    const seconds =
      currentRestartAt === null
        ? null
        : Math.max(0, Math.ceil((currentRestartAt - Date.now()) / 1_000));
    const countdown =
      seconds === null
        ? ''
        : ` · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    if (labelEl) labelEl.textContent = t('connection.restartPending') + countdown;
    if (hintEl) hintEl.textContent = t('connection.restartPendingHint');
    if (seconds === 0) clearCountdown();
  } else {
    if (labelEl) labelEl.textContent = t('connection.restartNow');
    if (hintEl) hintEl.textContent = t('connection.restartNowHint');
  }
}

/** Repaint the visible phase, if any, in the current locale (called once the
 *  locale chunk has loaded; before that `t()` answers in English). */
export function refreshRestartBanner(): void {
  if (currentPhase !== null) renderRestartBanner();
}
