import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearRestartingBanner,
  mountRestartBanner,
  refreshRestartBanner,
  setRestartBanner,
} from './restart-banner.js';

function getBanner(): HTMLDivElement {
  const el = document.body.querySelector<HTMLDivElement>('.restart-banner');
  if (!el) throw new Error('banner not mounted');
  return el;
}

function getLabelText(): string {
  return getBanner().querySelector('[data-label]')?.textContent ?? '';
}

function getHintText(): string {
  return getBanner().querySelector('[data-hint]')?.textContent ?? '';
}

describe('restart-banner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    document.body.innerHTML = '';
    mountRestartBanner();
    setRestartBanner(null);
  });

  afterEach(() => {
    setRestartBanner(null);
    window.history.replaceState(null, '', '/');
    vi.useRealTimers();
  });

  it('mounts hidden at the top of the body', () => {
    const banner = getBanner();
    expect(banner.hidden).toBe(true);
    expect(banner).toBe(document.body.firstChild);
  });

  it('mountRestartBanner is idempotent', () => {
    mountRestartBanner();
    mountRestartBanner();
    expect(document.body.querySelectorAll('.restart-banner').length).toBe(1);
  });

  it('shows a pending update while active games finish', () => {
    setRestartBanner('pending');
    expect(getBanner().hidden).toBe(false);
    expect(getLabelText()).toBe('Update pending');
    expect(getHintText()).toBe('Active games can finish before the restart.');
  });

  it('a hello clears "restarting now" but keeps "update pending"', () => {
    setRestartBanner('pending', Date.now() + 65_000);
    clearRestartingBanner();
    expect(getBanner().hidden).toBe(false);
    expect(getLabelText()).toContain('Update pending');
    setRestartBanner('restarting');
    clearRestartingBanner();
    expect(getBanner().hidden).toBe(true);
  });

  it('shows when the restart is beginning', () => {
    setRestartBanner('restarting');
    expect(getBanner().hidden).toBe(false);
    expect(getLabelText()).toBe('Server restarting now');
    expect(getHintText()).toBe('Back in a few seconds.');
  });

  it('counts down from the absolute restartAt, including across a sleeping tab', () => {
    setRestartBanner('pending', Date.now() + 65_000);
    expect(getLabelText()).toBe('Update pending · 1:05');
    vi.advanceTimersByTime(1_000);
    expect(getLabelText()).toBe('Update pending · 1:04');
    vi.setSystemTime(Date.now() + 62_000);
    vi.advanceTimersByTime(1_000);
    expect(getLabelText()).toBe('Update pending · 0:01');
    vi.advanceTimersByTime(2_000);
    expect(getLabelText()).toBe('Update pending · 0:00');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the deadline on a locale refresh and replaces it on a new drain', () => {
    setRestartBanner('pending', Date.now() + 65_000);
    window.history.replaceState(null, '', '/zh-hant/');
    refreshRestartBanner();
    expect(getLabelText()).toBe('即將更新 · 1:05');
    window.history.replaceState(null, '', '/');
    setRestartBanner('pending', Date.now() + 10_000);
    expect(getLabelText()).toBe('Update pending · 0:10');
    expect(vi.getTimerCount()).toBe(1);
    setRestartBanner('restarting');
    expect(getLabelText()).toBe('Server restarting now');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels its countdown when cleared', () => {
    setRestartBanner('pending', Date.now() + 65_000);
    setRestartBanner(null);
    vi.advanceTimersByTime(2_000);
    expect(getBanner().hidden).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('hides the banner when the restart is cancelled', () => {
    setRestartBanner('pending');
    expect(getBanner().hidden).toBe(false);
    setRestartBanner(null);
    expect(getBanner().hidden).toBe(true);
  });

  describe('in a Chinese locale', () => {
    afterEach(() => {
      window.history.replaceState(null, '', '/');
    });

    it('reads in the page language, and repaints when the locale lands after the phase', () => {
      // Painted in English first (the boot fetch can answer before the locale
      // chunk), then the chunk lands and the visible phase is repainted.
      setRestartBanner('restarting');
      expect(getLabelText()).toBe('Server restarting now');
      window.history.replaceState(null, '', '/zh-hans/');
      refreshRestartBanner();
      expect(getLabelText()).toBe('服务器正在重启');
      expect(getHintText()).toBe('几秒后恢复。');

      window.history.replaceState(null, '', '/zh-hant/');
      setRestartBanner('pending');
      expect(getLabelText()).toBe('即將更新');
    });

    it('refresh with no phase on screen keeps the banner hidden', () => {
      setRestartBanner(null);
      window.history.replaceState(null, '', '/zh-hans/');
      refreshRestartBanner();
      expect(getBanner().hidden).toBe(true);
    });
  });
});
