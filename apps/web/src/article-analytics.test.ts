import { describe, expect, it, vi } from 'vitest';
import { setPostHogInstance } from './analytics.js';
import { buildArticlePage, mountPendingWidgets } from './articles.js';

/** Capture what the page sends to PostHog. */
function recorder() {
  const events: Array<{ name: string; props?: Record<string, unknown> }> = [];
  setPostHogInstance({
    capture: (name: string, props?: Record<string, unknown>) => void events.push({ name, props }),
  } as never);
  return events;
}

describe('article instrumentation', () => {
  it('reports which article and which button a CTA click came from', () => {
    const events = recorder();
    const page = buildArticlePage('xiangqi-champions');
    document.body.append(page);
    try {
      const cta = page.querySelector<HTMLAnchorElement>('.article-cta');
      expect(cta).not.toBeNull();
      // Navigation is what a real click does; the listener is what we assert.
      cta?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      const click = events.find((e) => e.name === 'article_cta_clicked');
      expect(click).toBeDefined();
      expect(click?.props?.slug).toBe('xiangqi-champions');
      expect(click?.props?.href).toBeTruthy();
      expect(click?.props?.label).toBeTruthy();
    } finally {
      page.remove();
    }
  });

  // Explicit timeout: mountPendingWidgets mounts EVERY widget on the page, and
  // the champions article carries fifteen replays, so this one test builds
  // fifteen boards to click one. Measured 8.5s to 17s on the same machine
  // depending on what else is running, which straddles the 15s default and
  // fails a release gate at random. The cost grows with the article.
  it('reports a board embed once, on first interaction, not per move', { timeout: 60_000 }, () => {
    const events = recorder();
    const page = buildArticlePage('xiangqi-champions');
    document.body.append(page);
    const controllers = mountPendingWidgets(page);
    try {
      const next = page.querySelector<HTMLButtonElement>('.xq-replay .stepper-button-next');
      expect(next).not.toBeNull();
      // Scrolling past an embed must not look like reading it.
      expect(events.filter((e) => e.name === 'article_replay_engaged')).toHaveLength(0);
      for (let i = 0; i < 6; i += 1) next?.click();
      const engaged = events.filter((e) => e.name === 'article_replay_engaged');
      expect(engaged).toHaveLength(1);
      expect(engaged[0]?.props?.slug).toBe('xiangqi-champions');
      expect(engaged[0]?.props?.annotated).toBe(true);
    } finally {
      for (const controller of controllers) controller.destroy();
      page.remove();
      vi.restoreAllMocks();
    }
  });
});
