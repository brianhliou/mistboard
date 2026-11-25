import { afterEach, expect, it, vi } from 'vitest';
import { mountLanding } from './landing.js';
import { navPhoneMediaQuery } from './site-shell.js';

// Its own file: the homepage content chunk loads once per file, and a phone
// mount only reuses the prerendered rows while that chunk has not loaded yet,
// which is the case on every real first visit.
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it('on a phone, the mount keeps the prerendered News and article rows in place', () => {
  // 2026-11-25: a phone mount dropped them, so News collapsed to nothing until
  // the content chunk landed and then grew back by three rows, moving the chat
  // and footer under it twice.
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query === navPhoneMediaQuery,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('', { status: 503 })),
  );
  const root = document.createElement('div');
  root.innerHTML = [
    '<main class="landing-stage"><section class="landing-demo">',
    '<div class="landing-news-column"><aside class="landing-announcements held"></aside></div>',
    '<div class="landing-articles-row held"></div>',
    '<div class="landing-articles-row landing-dives-row held"></div>',
    '</section></main>',
  ].join('');
  document.body.append(root);
  const news = root.querySelector('.landing-announcements.held');
  const articles = root.querySelector('.landing-articles-row.held:not(.landing-dives-row)');
  const dives = root.querySelector('.landing-dives-row.held');

  // Everything before the mount's first await runs now: the stage is rebuilt.
  void mountLanding(root).catch(() => undefined);

  expect(root.querySelector('.landing-stage-phone')).not.toBeNull();
  expect(root.querySelector('.landing-news-column > *')).toBe(news);
  expect(root.querySelector('.landing-demo > .landing-articles-row:not(.landing-dives-row)')).toBe(
    articles,
  );
  expect(root.querySelector('.landing-demo > .landing-dives-row')).toBe(dives);
});
