// The phone analysis slot (#619) re-fits the board only when its strip is or
// was on the page. Above 600px the request and the chart land in the Computer
// analysis tab as before, and an extra re-fit there moved the move list's
// scroll after the chart landed, so desktop changed.
import { describe, expect, it, vi } from 'vitest';
import { createPhoneAnalysisSlot } from './review-phone-analysis.js';

function media(matches: boolean): MediaQueryList {
  const list = new EventTarget() as MediaQueryList;
  Object.defineProperty(list, 'matches', { value: matches, writable: true });
  return list;
}

function slot(phone: boolean) {
  const abort = new AbortController();
  const wideHost = document.createElement('div');
  const onLayout = vi.fn();
  const list = media(phone);
  const s = createPhoneAnalysisSlot({
    signal: abort.signal,
    wideHost,
    onScrub: () => {},
    onLayout,
    media: list,
  });
  return { s, wideHost, onLayout, list, abort };
}

describe('phone analysis slot', () => {
  it('leaves the tab and the board fit alone above 600px', () => {
    const { s, wideHost, onLayout, abort } = slot(false);
    const request = document.createElement('button');
    s.setContent({ kind: 'request', el: request });
    expect(wideHost.firstChild).toBe(request);
    const chart = document.createElement('div');
    s.setContent({ kind: 'chart', el: chart });
    expect(wideHost.firstChild).toBe(chart);
    expect(s.el.hidden).toBe(true);
    expect(onLayout).not.toHaveBeenCalled();
    abort.abort();
  });

  it('re-fits the board when the strip shows, changes or leaves', () => {
    const { s, wideHost, onLayout, list, abort } = slot(true);
    const chart = document.createElement('div');
    s.setContent({ kind: 'chart', el: chart });
    expect(s.el.hidden).toBe(false);
    expect(wideHost.childNodes).toHaveLength(0);
    expect(onLayout).toHaveBeenCalledTimes(1);
    // Rotated past 600px: the chart moves to the tab, and the board re-fits once.
    Object.defineProperty(list, 'matches', { value: false, writable: true });
    list.dispatchEvent(new Event('change'));
    expect(wideHost.firstChild).toBe(chart);
    expect(s.el.hidden).toBe(true);
    expect(onLayout).toHaveBeenCalledTimes(2);
    abort.abort();
  });
});
