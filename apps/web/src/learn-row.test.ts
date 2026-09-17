import { afterEach, describe, expect, it } from 'vitest';
import { isClientRoute } from '../../server/src/server-policy.js';
import {
  buildHomeLearnRow,
  LEARN_MANUAL_FEN,
  LEARN_MANUAL_STUDY_ID,
  LEARN_ROLES,
  learnRowRoutes,
  manualThumbnailFromFen,
} from './learn-row.js';
import { FIRST_PARTY_VIDEOS } from './videos-data.js';

const setCountry = (code: string | null) => {
  document.cookie = 'mb_cc=; Max-Age=0; Path=/';
  if (code) document.cookie = `mb_cc=${code}; Path=/`;
};

function roles(row: HTMLElement): string[] {
  return [...row.querySelectorAll<HTMLElement>('.landing-learn-card')].map(
    (card) => card.dataset.learnRole ?? '',
  );
}

afterEach(() => {
  setCountry(null);
});

describe('buildHomeLearnRow', () => {
  it('renders the whole arc, in walk order, inside the shared carousel', () => {
    const row = buildHomeLearnRow({ locale: 'en' });
    expect(row.querySelector('.landing-carousel-track')).not.toBeNull();
    expect(row.querySelector('.landing-carousel-nav-prev')).not.toBeNull();
    expect(row.querySelector('.landing-carousel-nav-next')).not.toBeNull();
    expect(roles(row)).toEqual([...LEARN_ROLES]);
  });

  it('gives every card a title, a blurb and a thumbnail frame', () => {
    const row = buildHomeLearnRow({ locale: 'en' });
    for (const card of row.querySelectorAll<HTMLElement>('.landing-learn-card')) {
      const role = card.dataset.learnRole;
      expect(card.querySelector('.landing-learn-card-title')?.textContent, role).toBeTruthy();
      expect(card.querySelector('.landing-learn-card-blurb')?.textContent, role).toBeTruthy();
      expect(card.querySelector('.landing-learn-card-thumb'), role).not.toBeNull();
    }
  });

  // Every card but the video is a page on this site: the row exists so the
  // homepage stops sending its learners to YouTube. A card whose href is not a
  // client route would 404 on a direct hit, which is how the video row's
  // "resilient at runtime, invisible to a typo" bug class starts.
  it('links every non-video card to a registered client route', () => {
    for (const href of learnRowRoutes()) {
      expect(isClientRoute(href), `${href} is not in isClientRoute()`).toBe(true);
    }
    const row = buildHomeLearnRow({ locale: 'en' });
    for (const card of row.querySelectorAll<HTMLAnchorElement>('.landing-learn-card')) {
      if (card.dataset.learnRole === 'video') continue;
      expect(card.getAttribute('href'), card.dataset.learnRole).toMatch(/^\//);
      expect(card.target).toBe('');
    }
  });

  it('draws a board diagram on every non-video, non-manual card', () => {
    const row = buildHomeLearnRow({ locale: 'en' });
    for (const card of row.querySelectorAll<HTMLElement>('.landing-learn-card')) {
      const role = card.dataset.learnRole;
      if (role === 'video' || role === 'manuals') continue;
      expect(card.querySelector('.landing-learn-card-thumb svg'), role).not.toBeNull();
    }
  });

  it('leads with our own episode as an outbound new-tab video card', () => {
    expect(FIRST_PARTY_VIDEOS.length).toBeGreaterThan(0);
    const row = buildHomeLearnRow({ locale: 'en' });
    const video = row.querySelector<HTMLAnchorElement>(
      '.landing-learn-card[data-learn-role="video"]',
    );
    expect(video).not.toBeNull();
    expect(video?.href).toContain('youtube.com/watch?v=');
    expect(video?.target).toBe('_blank');
    expect(video?.rel).toContain('noopener');
    expect(video?.querySelector('.landing-video-card-badge')?.textContent).toBe('Mistboard');
    expect(video?.querySelector('.landing-video-card-play')).not.toBeNull();
  });

  // The video row was omitted outright for a CN viewer (#378), so the mainland
  // audience got a shorter homepage than everyone else. Now only the one
  // YouTube card goes; the other seven are on this site and render everywhere.
  it('drops only the video card, never the row, where YouTube is blocked', () => {
    setCountry('CN');
    const row = buildHomeLearnRow({ locale: 'zh-Hans' });
    expect(roles(row)).toEqual(LEARN_ROLES.filter((role) => role !== 'video'));
  });

  it('keeps the video card for every other Chinese-reading region', () => {
    for (const country of ['TW', 'HK', 'MO', 'SG', 'MY']) {
      setCountry(country);
      const row = buildHomeLearnRow({ locale: 'zh-Hant' });
      expect(roles(row), country).toEqual([...LEARN_ROLES]);
    }
  });

  it('localizes copy and content hrefs for a Chinese locale', () => {
    const row = buildHomeLearnRow({ locale: 'zh-Hans' });
    expect(row.getAttribute('aria-label')).toBe('学象棋');
    const rules = row.querySelector<HTMLAnchorElement>(
      '.landing-learn-card[data-learn-role="rules"]',
    );
    expect(rules?.getAttribute('href')).toBe('/zh-hans/rules/xiangqi');
    // Non-content routes carry no locale prefix.
    const puzzles = row.querySelector<HTMLAnchorElement>(
      '.landing-learn-card[data-learn-role="puzzles"]',
    );
    expect(puzzles?.getAttribute('href')).toBe('/puzzles');
  });

  it('opens the bot setup on xiangqi from the play card', () => {
    const row = buildHomeLearnRow({ locale: 'en' });
    const play = row.querySelector<HTMLAnchorElement>(
      '.landing-learn-card[data-learn-role="play"]',
    );
    expect(play?.getAttribute('href')).toBe('/?play=computer&gameSpecId=xiangqi');
  });
});

describe('manual card', () => {
  it('links the study and opens on its chapter 1, Seven Stars Rejoice Together', () => {
    const row = buildHomeLearnRow({ locale: 'en' });
    const card = row.querySelector<HTMLAnchorElement>(
      '.landing-learn-card[data-learn-role="manuals"]',
    );
    expect(card?.getAttribute('href')).toBe(`/study/${LEARN_MANUAL_STUDY_ID}`);
    // Seven Stars: red has two chariots and a king on the back rank, black a
    // chariot and king; the baked FEN is what the study's list preview reports.
    expect(LEARN_MANUAL_FEN.split(' ')[0]?.endsWith('4K1RR1')).toBe(true);
  });

  it('rejects a FEN it cannot draw instead of drawing an empty board', () => {
    expect(manualThumbnailFromFen('not a fen')).toBeNull();
    expect(manualThumbnailFromFen(LEARN_MANUAL_FEN)).not.toBeNull();
  });
});
