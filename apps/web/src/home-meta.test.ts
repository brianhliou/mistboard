import { afterEach, describe, expect, it } from 'vitest';
import { HOME_DESCRIPTION, updateHomeDescription } from './home-meta.js';

const selectors = ['meta[name="description"]', 'meta[property="og:description"]'];

afterEach(() => {
  for (const selector of selectors) {
    document.head.querySelectorAll(selector).forEach((meta) => {
      meta.remove();
    });
  }
});

describe('English home description on remount', () => {
  it.each([false, true])('restores the description with existing tags: %s', (existing) => {
    if (existing) {
      document.head.insertAdjacentHTML(
        'beforeend',
        '<meta name="description" content="Another page"><meta property="og:description" content="Another page">',
      );
    }
    updateHomeDescription('en');
    updateHomeDescription('en');
    for (const selector of selectors) {
      expect(document.head.querySelectorAll(selector)).toHaveLength(1);
      expect(document.head.querySelector(selector)?.getAttribute('content')).toBe(HOME_DESCRIPTION);
    }
  });

  it.each(['zh-Hans', 'zh-Hant'] as const)('preserves the %s home descriptions', (locale) => {
    document.head.insertAdjacentHTML(
      'beforeend',
      '<meta name="description" content="Localized snippet"><meta property="og:description" content="Localized share card">',
    );
    updateHomeDescription(locale);
    expect(document.head.querySelector(selectors[0]!)?.getAttribute('content')).toBe(
      'Localized snippet',
    );
    expect(document.head.querySelector(selectors[1]!)?.getAttribute('content')).toBe(
      'Localized share card',
    );
  });
});
