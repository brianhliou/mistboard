import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The active Write tab overlaps the textarea's top border on a raised layer;
// a focused textarea must sit above it or the tab hides the focus ring.
describe('forum composer focus ring', () => {
  const css = readFileSync('src/forum.css', 'utf8');
  const zIndex = (selector: string) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const block = css.match(new RegExp(`${escaped}[,\\s][^{]*\\{([^}]*)\\}`))?.[1];
    return Number(block?.match(/z-index: (\d+);/)?.[1] ?? Number.NaN);
  };

  it('raises a focused textarea above the active tab', () => {
    const tab = zIndex('.forum-composer-tab-active');
    expect(tab).toBeGreaterThan(0);
    for (const selector of [
      '.forum-body-composer textarea:focus',
      '.forum-reply-form textarea:focus',
    ]) {
      expect(zIndex(selector), selector).toBeGreaterThan(tab);
    }
  });
});
