import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mountRestartBanner, refreshRestartBanner, setRestartBanner } from './restart-banner.js';

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
    document.body.innerHTML = '';
    mountRestartBanner();
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

  it('shows when the restart is beginning', () => {
    setRestartBanner('restarting');
    expect(getBanner().hidden).toBe(false);
    expect(getLabelText()).toBe('Server restarting now');
    expect(getHintText()).toBe('Please reconnect in a moment.');
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
      expect(getHintText()).toBe('请稍后重新连接。');

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
