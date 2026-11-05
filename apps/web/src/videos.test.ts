import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as analytics from './analytics.js';
import { ensureLocaleCatalog } from './i18n/catalog.js';
import { SUPPORTED_LOCALES } from './i18n/locale.js';
import { VIDEOS_OPEN_IN_CN } from './nav-items.js';
import {
  buildVideoCard,
  buildVideosPage,
  filterVideos,
  mountVideos,
  sortVideos,
  type VideoFilters,
  videoLanguageForLocale,
  videoThumbUrl,
  videoWatchUrl,
} from './videos.js';
import {
  type BilibiliVideo,
  bilibiliCatalogueIsDeep,
  FIRST_PARTY_VIDEOS,
  isShort,
  isVideoLive,
  VIDEO_LANGUAGES,
  VIDEO_LEVELS,
  VIDEO_TAGS,
  VIDEOS,
  type VideoEntry,
  type VideoLanguage,
  type VideoLevel,
  type VideoTag,
  type VideoVariant,
  videoKey,
} from './videos-data.js';

// jsdom reports an English navigator locale, so a bare mount lands on the
// English-language default. Tests that assert against the whole catalog widen it
// back out through the facet's own All chip rather than reaching into state.
function mount(): HTMLElement {
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  mountVideos(root);
  return root;
}

function mountAllLanguages(): HTMLElement {
  const root = mount();
  chip(root, 'Language', 'all').click();
  return root;
}

function visibleTitles(root: HTMLElement): string[] {
  return [...root.querySelectorAll('.videos-catalog-grid .videos-card-title')].map(
    (el) => el.textContent ?? '',
  );
}

function facetRow(root: HTMLElement, label: string): HTMLElement {
  const row = [...root.querySelectorAll<HTMLElement>('.videos-facet')].find(
    (el) => el.querySelector('.videos-facet-label')?.textContent === label,
  );
  if (!row) throw new Error(`missing facet row: ${label}`);
  return row;
}

function chip(root: HTMLElement, facetLabel: string, value: string): HTMLButtonElement {
  const el = facetRow(root, facetLabel).querySelector<HTMLButtonElement>(
    `.videos-tag-chip[data-value="${value}"]`,
  );
  if (!el) throw new Error(`missing chip ${facetLabel}/${value}`);
  return el;
}

function noFilter(query = ''): VideoFilters {
  return {
    tags: new Set(),
    levels: new Set(),
    variants: new Set(),
    sources: new Set(),
    languages: new Set(),
    query,
  };
}

const MISTBOARD_FIXTURE: VideoEntry = {
  source: 'mistboard',
  slug: 'first-fog-game',
  url: '/video/first-fog-game',
  thumbnailUrl: '/img/videos/first-fog-game.jpg',
  title: 'Your first Fog of War game',
  author: 'Mistboard',
  tags: ['basics'],
  level: 'intro',
  variant: 'fog',
  language: 'en',
  addedAt: '2026-07-21',
};

const BILIBILI_FIXTURE: BilibiliVideo = {
  source: 'bilibili',
  bvid: 'BV1xx411c7mD',
  thumbnailUrl: 'https://i0.hdslb.com/bfs/archive/fixture.jpg',
  title: '揭棋入门',
  author: '象棋课堂',
  durationMinutes: 10,
  tags: ['basics'],
  level: 'intro',
  variant: 'jieqi',
  language: 'zh',
  addedAt: '2026-11-05',
};

async function pageWithCatalogue(
  videos: readonly VideoEntry[],
  locale: 'en' | 'zh-Hans' | 'zh-Hant' = 'en',
): Promise<HTMLElement> {
  vi.resetModules();
  vi.doMock('./videos-data.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./videos-data.js')>()),
    VIDEOS: videos,
    FIRST_PARTY_VIDEOS: [...FIRST_PARTY_VIDEOS, MISTBOARD_FIXTURE],
  }));
  const { buildVideosPage: build } = await import('./videos.js');
  await ensureLocaleCatalog(locale);
  return build(locale);
}

afterEach(() => {
  document.cookie = 'mb_cc=; Max-Age=0; Path=/';
  vi.restoreAllMocks();
  vi.doUnmock('./videos-data.js');
  vi.resetModules();
});

describe('country routing', () => {
  it.each(SUPPORTED_LOCALES)(
    'never builds YouTube destinations or thumbnails for CN (%s)',
    (locale) => {
      document.cookie = 'mb_cc=CN; Path=/';
      // Inspect assignments as well as the finished DOM: hiding cards after they
      // start fetching their art would still flash broken YouTube thumbnails.
      const imageSource = vi.spyOn(HTMLImageElement.prototype, 'src', 'set');
      const page = buildVideosPage(locale);
      expect(page.querySelectorAll('.videos-card')).toHaveLength(0);
      expect(page.querySelector('.videos-ours')).toBeNull();
      expect(page.querySelector('.videos-subscribe')).toBeNull();
      expect(page.innerHTML).not.toMatch(/youtube\.com|youtu\.be/i);
      expect(imageSource).not.toHaveBeenCalled();
    },
  );

  it.each([null, 'US', 'HK', 'TW', 'SG', 'MY', 'MO'])(
    'preserves YouTube in Chinese locales outside CN (%s)',
    (country) => {
      if (country) document.cookie = `mb_cc=${country}; Path=/`;
      const page = buildVideosPage('zh-Hant');
      expect(page.querySelectorAll('.videos-catalog-grid .videos-card')).toHaveLength(
        VIDEOS.filter((video) => video.language === 'zh').length,
      );
      expect(page.querySelector('.videos-ours-grid .videos-card')).not.toBeNull();
      expect(page.querySelector('.videos-shorts-grid .videos-card')).not.toBeNull();
      expect(page.querySelector('.videos-subscribe')).not.toBeNull();
    },
  );

  it('derives CN facets and counts from reachable videos and keeps local first-party cards', async () => {
    document.cookie = 'mb_cc=CN; Path=/';
    const page = await pageWithCatalogue([...VIDEOS, BILIBILI_FIXTURE]);
    expect(visibleTitles(page)).toEqual([BILIBILI_FIXTURE.title]);
    expect(page.querySelector('.videos-count')?.textContent).toBe('1 video');
    expect(page.querySelectorAll('.videos-ours-grid .videos-card')).toHaveLength(1);
    expect(page.querySelector('.videos-ours-grid a')?.getAttribute('href')).toBe(
      MISTBOARD_FIXTURE.url,
    );
    expect(page.querySelector('.videos-shorts-grid')).toBeNull();
    expect(page.querySelector('.videos-subscribe')).toBeNull();
    const labels = [...page.querySelectorAll('.videos-facet-label')].map((el) => el.textContent);
    expect(labels).not.toContain('Language');
    expect(labels).not.toContain('Source');
    expect(labels).not.toContain('Game');
    expect(page.querySelector('.videos-note')?.textContent).toContain('Bilibili');
    expect(page.innerHTML).not.toMatch(/youtube\.com|youtu\.be/i);
    const search = page.querySelector<HTMLInputElement>('.videos-search')!;
    search.value = 'no match';
    search.dispatchEvent(new Event('input'));
    expect(visibleTitles(page)).toEqual([]);
    search.value = '';
    search.dispatchEvent(new Event('input'));
    expect(visibleTitles(page)).toEqual([BILIBILI_FIXTURE.title]);
  });

  it('allows a mixed source catalogue to filter Bilibili and Jieqi independently', async () => {
    const page = await pageWithCatalogue([...VIDEOS, BILIBILI_FIXTURE, MISTBOARD_FIXTURE]);
    chip(page, 'Language', 'all').click();
    chip(page, 'Source', 'bilibili').click();
    expect(visibleTitles(page)).toEqual([BILIBILI_FIXTURE.title]);
    chip(page, 'Source', 'all').click();
    chip(page, 'Game', 'jieqi').click();
    expect(visibleTitles(page)).toEqual([BILIBILI_FIXTURE.title]);
  });

  it('never flashes a blocked card when the CN SPA route mounts', () => {
    document.cookie = 'mb_cc=CN; Path=/';
    const root = mount();
    expect(root.querySelector('.videos-page')).not.toBeNull();
    expect(root.querySelectorAll('.videos-card')).toHaveLength(0);
    expect(root.querySelector('a[href="/videos"]')).toBeNull();
    expect(root.innerHTML).not.toMatch(/youtube\.com|youtu\.be/i);
  });

  it('keeps the homepage free of video rows and blocked thumbnails', async () => {
    document.cookie = 'mb_cc=CN; Path=/';
    const { renderLandingShellForPrerender } = await import('./landing.js');
    const html = renderLandingShellForPrerender();
    expect(html).not.toMatch(/videos-card|videos-grid|videos-ours|youtube\.com|youtu\.be/i);
    expect(html).toContain('landing-play');
  });

  it('keeps /videos on an empty SPA shell with only modulepreload hints before JS mounts', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const shell = readFileSync(resolve(here, '../index.html'), 'utf8');
    const prerender = readFileSync(resolve(here, '../scripts/prerender-articles.mjs'), 'utf8');
    expect(shell).toContain('<div id="app"></div>');
    expect(shell).not.toMatch(/videos-card|youtube\.com|youtu\.be/i);
    expect(prerender).toContain("{ pattern: '^/videos$', module: 'src/videos.ts' }");
    expect(prerender).not.toMatch(/ssrLoadModule\([^)]*videos\.ts/);
    expect(prerender).not.toContain('videos.html');
  });
});

describe('videos data', () => {
  it.each([
    [11, false],
    [12, true],
  ] as const)('checks Bilibili catalogue depth at %i entries', (count, expected) => {
    const videos = Array.from({ length: count }, () => BILIBILI_FIXTURE);
    expect(bilibiliCatalogueIsDeep(videos)).toBe(expected);
  });

  it('counts only Bilibili entries toward catalogue depth', () => {
    const videos = Array.from({ length: 11 }, () => BILIBILI_FIXTURE);
    const youtube = VIDEOS.find((video) => video.source === 'youtube')!;
    expect(bilibiliCatalogueIsDeep([...videos, youtube, MISTBOARD_FIXTURE])).toBe(false);
  });

  it('keeps the manual CN nav gate in sync with the catalogue depth', () => {
    expect(VIDEOS_OPEN_IN_CN).toBe(bilibiliCatalogueIsDeep(VIDEOS));
  });

  it.each(['nav-items.ts', 'viewer-geo.ts'])(
    'keeps the eager shell free of videos-data imports in %s',
    (file) => {
      const here = dirname(fileURLToPath(import.meta.url));
      const source = readFileSync(resolve(here, file), 'utf8');
      expect(source).not.toMatch(/\bimport\b[^;]*['"][^'"]*videos-data(?:\.[cm]?[jt]s)?['"]/);
    },
  );

  it('holds verified, well-formed entries', () => {
    expect(VIDEOS.length).toBeGreaterThanOrEqual(12);
    for (const video of VIDEOS) {
      expect(video.title.trim()).not.toBe('');
      expect(video.author.trim()).not.toBe('');
      expect(VIDEO_LANGUAGES).toContain(video.language);
      expect(video.tags.length).toBeGreaterThan(0);
      for (const tag of video.tags) expect(VIDEO_TAGS).toContain(tag);
      expect(VIDEO_LEVELS).toContain(video.level);
      expect(['xiangqi', 'jieqi', 'fog']).toContain(video.variant);
      if (video.source === 'youtube') expect(video.id).toMatch(/^[A-Za-z0-9_-]{11}$/);
      else if (video.source === 'bilibili') {
        expect(video.bvid).toMatch(/^BV[A-Za-z0-9]{10}$/);
        expect(video.thumbnailUrl.trim()).not.toBe('');
      } else {
        expect(video.slug.trim()).not.toBe('');
        expect(video.url.trim()).not.toBe('');
        expect(video.thumbnailUrl.trim()).not.toBe('');
      }
    }
    // Keys are unique across sources.
    expect(new Set(VIDEOS.map(videoKey)).size).toBe(VIDEOS.length);
  });

  it('ships no Bilibili entries before curation', () => {
    expect(
      [...VIDEOS, ...FIRST_PARTY_VIDEOS].filter((video) => video.source === 'bilibili'),
    ).toEqual([]);
  });

  // The length sorts push an unknown duration to the end of the list, so a
  // catalogue that is mostly unknown does not sort badly, it does not sort at
  // all: two of the three sort modes degrade to one bucket. That is what this
  // was before `scripts/videos-audit.mjs` backfilled 36 of the entries from
  // YouTube. Run `npm run videos:audit -- --missing --write` when this fails.
  it("knows every entry's runtime, so the length sorts mean something", () => {
    for (const video of VIDEOS) {
      expect(video.durationMinutes, `${video.title} has no durationMinutes`).toBeGreaterThan(0);
    }
  });

  it('covers every topic tag and difficulty level with at least one entry', () => {
    for (const tag of VIDEO_TAGS) {
      expect(VIDEOS.some((video) => video.tags.includes(tag))).toBe(true);
    }
    for (const level of VIDEO_LEVELS) {
      expect(VIDEOS.some((video) => video.level === level)).toBe(true);
    }
  });

  // Replaces the old blanket `language === 'en'` assertion. That check was the
  // editorial English-first guarantee wearing a schema check's clothes; widening
  // the type would have dropped the guarantee silently, so it is restated here as
  // what it always meant: English is the largest shelf, not merely a present one.
  it('keeps English the deepest shelf and ships no token language', () => {
    const counts = new Map<VideoLanguage, number>();
    for (const video of VIDEOS) counts.set(video.language, (counts.get(video.language) ?? 0) + 1);

    const english = counts.get('en') ?? 0;
    for (const [language, count] of counts) {
      if (language !== 'en') expect(english).toBeGreaterThan(count);
      // A language thin enough to look accidental should not get a facet chip.
      expect(count).toBeGreaterThanOrEqual(4);
      // The locale default lands a beginner somewhere useful in every language.
      expect(
        VIDEOS.some((video) => video.language === language && video.tags.includes('basics')),
      ).toBe(true);
    }
  });

  // A cut has to stay cut. The declined ledger already stopped `videos:mine`
  // re-PROPOSING what was judged, but nothing stopped a session ACCEPTING it
  // back, and nothing put the July banned-player removals in the ledger at all
  // — so 386e9256 removed `aUPyuAv-Hhs` and 73cc8104, the commit that built the
  // miner, restored it. This closes that loop from the other side: the ledger is
  // the list of ids this catalogue may not contain, whatever the reason for the
  // cut, and it fails here rather than shipping.
  it('contains nothing the declined ledger has ruled out', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const ledger = JSON.parse(
      readFileSync(resolve(here, '../../../scripts/data/videos-declined.json'), 'utf8'),
    ) as { declined: Record<string, string> };

    const declined = Object.keys(ledger.declined);
    expect(declined.length).toBeGreaterThan(0);
    for (const id of declined) expect(id).toMatch(/^[A-Za-z0-9_-]{11}$/);

    for (const video of VIDEOS) {
      if (video.source !== 'youtube') continue;
      expect(
        declined,
        `${video.id} (${video.title}) is in the declined ledger: ${ledger.declined[video.id]}`,
      ).not.toContain(video.id);
    }
  });
});

describe('videoLanguageForLocale', () => {
  it('maps every supported locale, folding both Chinese scripts onto one spoken language', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(VIDEO_LANGUAGES).toContain(videoLanguageForLocale(locale));
    }
    expect(videoLanguageForLocale('en')).toBe('en');
    expect(videoLanguageForLocale('zh-Hans')).toBe('zh');
    expect(videoLanguageForLocale('zh-Hant')).toBe('zh');
    // Every site locale has a catalog behind it: no locale maps to a language
    // the library does not stock, which is what keeps the default non-empty.
    for (const locale of SUPPORTED_LOCALES) {
      expect(VIDEOS.some((video) => video.language === videoLanguageForLocale(locale))).toBe(true);
    }
  });
});

describe('source-dispatched watch + thumbnail', () => {
  it('namespaces every source and uses the Bilibili watch destination and curated thumbnail', () => {
    expect(videoKey(BILIBILI_FIXTURE)).toBe('bb:BV1xx411c7mD');
    expect(videoWatchUrl(BILIBILI_FIXTURE)).toBe('https://www.bilibili.com/video/BV1xx411c7mD/');
    expect(videoThumbUrl(BILIBILI_FIXTURE)).toBe(BILIBILI_FIXTURE.thumbnailUrl);
    expect(videoKey(MISTBOARD_FIXTURE)).toBe('mb:first-fog-game');
    const yt = VIDEOS.find((video) => video.source === 'youtube')!;
    expect(videoKey(yt)).toMatch(/^yt:/);
  });
  it('derives YouTube URLs from the id', () => {
    const yt = VIDEOS.find((v) => v.source === 'youtube' && v.firstParty !== true);
    if (!yt || yt.source !== 'youtube') throw new Error('expected a youtube video');
    expect(videoWatchUrl(yt)).toBe(`https://www.youtube.com/watch?v=${yt.id}`);
    expect(videoThumbUrl(yt)).toBe(`https://img.youtube.com/vi/${yt.id}/hqdefault.jpg`);
  });

  it('uses the explicit URL + thumbnail for first-party videos', () => {
    expect(videoWatchUrl(MISTBOARD_FIXTURE)).toBe('/video/first-fog-game');
    expect(videoThumbUrl(MISTBOARD_FIXTURE)).toBe('/img/videos/first-fog-game.jpg');
  });
});

describe('scheduled Shorts', () => {
  const short: VideoEntry = {
    source: 'youtube',
    id: 'abcDEF12345',
    short: true,
    title: 'A Chinese Chess Puzzle',
    author: 'Mistboard',
    firstParty: true,
    tags: ['basics'],
    level: 'intro',
    variant: 'xiangqi',
    language: 'en',
    addedAt: '2026-10-16',
    publishAt: '2026-10-21T16:00:00Z',
  };

  it('hides a Short until YouTube publishes it', () => {
    expect(isVideoLive(short, Date.parse('2026-10-21T15:59:59Z'))).toBe(false);
    expect(isVideoLive(short, Date.parse('2026-10-21T16:00:00Z'))).toBe(true);
    expect(isVideoLive({ ...short, publishAt: undefined }, 0)).toBe(true);
  });

  it('links a Short to its Shorts player, not the watch page', () => {
    expect(isShort(short)).toBe(true);
    expect(videoWatchUrl(short)).toBe('https://www.youtube.com/shorts/abcDEF12345');
  });

  it('enters every first-party Short with its publish instant', () => {
    // An entry without one would appear the moment it ships, before YouTube makes it public.
    for (const video of FIRST_PARTY_VIDEOS.filter(isShort)) {
      expect(video.publishAt, video.title).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
      expect(video.thumbnailUrl, video.title).toBeTruthy();
    }
  });
});

describe('video card', () => {
  it.each([
    ['en', 'Bilibili'],
    ['zh-Hans', '哔哩哔哩'],
    ['zh-Hant', '嗶哩嗶哩'],
  ] as const)(
    'links out to Bilibili with localized copy and analytics (%s)',
    async (locale, label) => {
      await ensureLocaleCatalog(locale);
      const track = vi.spyOn(analytics, 'track').mockImplementation(() => {});
      const card = buildVideoCard(BILIBILI_FIXTURE, locale);
      const link = card.querySelector<HTMLAnchorElement>('.videos-card-link')!;
      expect(link.getAttribute('href')).toBe(videoWatchUrl(BILIBILI_FIXTURE));
      expect(link.target).toBe('_blank');
      expect(link.rel).toBe('noopener noreferrer');
      expect(card.querySelector('.videos-source-badge')?.textContent).toBe(label);
      link.addEventListener('click', (event) => event.preventDefault());
      link.dispatchEvent(new MouseEvent('click', { cancelable: true }));
      expect(track).toHaveBeenCalledWith('video_clicked', {
        kind: 'card',
        source: 'bilibili',
        video_key: videoKey(BILIBILI_FIXTURE),
        first_party: false,
        level: 'intro',
        language: 'zh',
      });
    },
  );

  it.each([BILIBILI_FIXTURE, VIDEOS[0]!, FIRST_PARTY_VIDEOS[0]!])(
    'falls back once to local art without a referrer ($source)',
    (video) => {
      const card = buildVideoCard(video);
      const img = card.querySelector('img')!;
      expect(img.referrerPolicy).toBe('no-referrer');
      expect(img.getAttribute('src')).toBe(videoThumbUrl(video));
      img.dispatchEvent(new Event('error'));
      expect(img.getAttribute('src')).toBe('/video-thumbs/unavailable.svg');
      const here = dirname(fileURLToPath(import.meta.url));
      expect(readFileSync(resolve(here, `../public${img.getAttribute('src')}`), 'utf8')).toContain(
        '<svg',
      );
      // A second error must not reassign src and retry forever.
      const source = vi.spyOn(img, 'src', 'set');
      img.dispatchEvent(new Event('error'));
      expect(source).not.toHaveBeenCalled();
      expect(card.querySelector('.videos-card-link')?.getAttribute('href')).toBe(
        videoWatchUrl(video),
      );
    },
  );
  it('shelves our own episodes above the catalogue, never inside it', () => {
    // The library's job is to turn a visitor into a subscriber, so ours lead and
    // the curated list stays external. A first-party entry appearing in the
    // catalogue would double-render it and shift every count and facet the page
    // derives from that list.
    const root = mountAllLanguages();
    const ours = root.querySelectorAll('.videos-ours-grid .videos-card');
    expect(ours.length).toBe(
      FIRST_PARTY_VIDEOS.filter((v) => !isShort(v) && isVideoLive(v)).length,
    );
    expect(ours.length).toBeGreaterThan(0);
    expect(root.querySelector('.videos-ours-grid .videos-source-badge')).not.toBeNull();
    for (const video of VIDEOS) expect(video.firstParty).not.toBe(true);
    const subscribe = root.querySelector<HTMLAnchorElement>('.videos-subscribe');
    expect(subscribe?.href).toContain('youtube.com/@Mistboard');
  });

  it('renders a YouTube card as an outbound new-tab link', () => {
    const yt = VIDEOS.find((v) => v.source === 'youtube' && v.firstParty !== true);
    if (!yt || yt.source !== 'youtube') throw new Error('expected a youtube video');
    const card = buildVideoCard(yt, 'en');
    const link = card.querySelector<HTMLAnchorElement>('.videos-card-link');
    expect(link?.getAttribute('href')).toBe(`https://www.youtube.com/watch?v=${yt.id}`);
    expect(link?.target).toBe('_blank');
    expect(link?.rel).toBe('noopener noreferrer');
    expect(card.querySelector('.videos-source-badge')).toBeNull();
  });

  it('renders a first-party card as an internal link with a Mistboard badge', () => {
    const card = buildVideoCard(MISTBOARD_FIXTURE, 'en');
    const link = card.querySelector<HTMLAnchorElement>('.videos-card-link');
    expect(link?.getAttribute('href')).toBe('/video/first-fog-game');
    expect(link?.target).toBe('');
    expect(link?.getAttribute('rel')).toBeNull();
    expect(card.querySelector('.videos-source-badge')?.textContent).toBe('Mistboard');
    expect(card.querySelector('img')?.getAttribute('src')).toBe('/img/videos/first-fog-game.jpg');
  });

  it('leads the badge row with the difficulty level', () => {
    const yt = VIDEOS.find((v) => v.source === 'youtube' && v.firstParty !== true);
    if (!yt) throw new Error('expected a video');
    const card = buildVideoCard(yt, 'en');
    expect(card.querySelector('.videos-card-tags .videos-card-tag')?.classList).toContain(
      'videos-card-level',
    );
  });
});

describe('videos page', () => {
  it('renders every curated entry in editorial order once language is widened', () => {
    const root = mountAllLanguages();
    const cards = root.querySelectorAll<HTMLAnchorElement>(
      '.videos-catalog-grid .videos-card-link',
    );
    expect(cards.length).toBe(VIDEOS.length);
    expect(root.querySelector('.videos-count')?.textContent).toBe(`${VIDEOS.length} videos`);
    // The page opens on the curated ranking, which is the array as written.
    expect(visibleTitles(root)).toEqual(VIDEOS.map((v) => v.title));
    expect(root.querySelector('.videos-empty')?.hasAttribute('hidden')).toBe(true);
  });

  it('renders a level facet but no dead variant/source facets for homogeneous data', () => {
    const root = mount();
    // All current videos are xiangqi YouTube videos, so those facets stay hidden.
    expect(() => facetRow(root, 'Level')).not.toThrow();
    const labels = [...root.querySelectorAll('.videos-facet-label')].map((el) => el.textContent);
    expect(labels).toContain('Topic');
    expect(labels).toContain('Level');
    // Language discriminates now that the catalog is mixed, and leads the stack
    // because it is the one facet that starts with a selection.
    expect(labels[0]).toBe('Language');
    expect(labels).not.toContain('Game');
    expect(labels).not.toContain('Source');
    // Level facet exposes All + the three ordered levels.
    const levelChips = facetRow(root, 'Level').querySelectorAll('.videos-tag-chip');
    expect(levelChips.length).toBe(VIDEO_LEVELS.length + 1);
  });

  it('narrows by a toggled topic tag and restores on untoggle', () => {
    const root = mountAllLanguages();
    const openings = chip(root, 'Topic', 'openings');
    openings.click();
    const expected = VIDEOS.filter((v) => v.tags.includes('openings'));
    expect(root.querySelectorAll('.videos-catalog-grid .videos-card-link').length).toBe(
      expected.length,
    );
    expect(openings.getAttribute('aria-pressed')).toBe('true');
    openings.click();
    expect(root.querySelectorAll('.videos-catalog-grid .videos-card-link').length).toBe(
      VIDEOS.length,
    );
    expect(openings.getAttribute('aria-pressed')).toBe('false');
  });

  it('intersects across axes (topic AND level)', () => {
    const root = mountAllLanguages();
    chip(root, 'Topic', 'games').click();
    chip(root, 'Level', 'advanced').click();
    const expected = VIDEOS.filter((v) => v.tags.includes('games') && v.level === 'advanced');
    expect(expected.length).toBeGreaterThan(0);
    expect(root.querySelectorAll('.videos-catalog-grid .videos-card-link').length).toBe(
      expected.length,
    );
  });

  it('resets a facet via its All chip', () => {
    const root = mountAllLanguages();
    chip(root, 'Level', 'intro').click();
    expect(root.querySelectorAll('.videos-catalog-grid .videos-card-link').length).toBeLessThan(
      VIDEOS.length,
    );
    chip(root, 'Level', 'all').click();
    expect(root.querySelectorAll('.videos-catalog-grid .videos-card-link').length).toBe(
      VIDEOS.length,
    );
  });

  it('narrows by text across title and author, case-insensitively', () => {
    const root = mountAllLanguages();
    const search = root.querySelector<HTMLInputElement>('.videos-search');
    if (!search) throw new Error('missing search input');
    search.value = 'CHECKMATE';
    search.dispatchEvent(new Event('input'));
    // Author too, which is what this test is named for and did not check: the
    // expectation filtered titles only, and passed until a channel called
    // `iwantcheckmate` joined the catalogue and the page correctly returned one
    // more card than the test predicted.
    const expected = VIDEOS.filter((v) =>
      `${v.title} ${v.author}`.toLowerCase().includes('checkmate'),
    );
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.some((v) => !v.title.toLowerCase().includes('checkmate'))).toBe(true);
    expect(new Set(visibleTitles(root))).toEqual(new Set(expected.map((v) => v.title)));
  });

  it('reorders by the sort control', () => {
    const root = mountAllLanguages();
    const select = root.querySelector<HTMLSelectElement>('.videos-sort-select');
    if (!select) throw new Error('missing sort select');
    select.value = 'shortest';
    select.dispatchEvent(new Event('change'));
    expect(visibleTitles(root)).toEqual(sortVideos(VIDEOS, 'shortest').map((v) => v.title));
  });

  it('shows the empty state when no entry matches', () => {
    const root = mount();
    const search = root.querySelector<HTMLInputElement>('.videos-search');
    if (!search) throw new Error('missing search input');
    search.value = 'zzzz-no-match';
    search.dispatchEvent(new Event('input'));
    expect(root.querySelectorAll('.videos-catalog-grid .videos-card-link').length).toBe(0);
    expect(root.querySelector('.videos-count')?.textContent).toBe('0 videos');
    expect(root.querySelector('.videos-empty')?.hasAttribute('hidden')).toBe(false);
    expect(root.querySelector('.videos-empty')?.textContent).toBe('No videos match your filters.');
  });

  it('localizes page chrome for zh-Hant', () => {
    const page = buildVideosPage('zh-Hant');
    expect(page.querySelector('.site-section-heading')?.textContent).toBe('影片庫');
    expect(page.querySelector('.videos-empty')?.textContent).toBe('沒有符合篩選條件的影片。');
    const levelRow = [...page.querySelectorAll<HTMLElement>('.videos-facet')].find(
      (el) => el.querySelector('.videos-facet-label')?.textContent === '難度',
    );
    expect(levelRow).toBeDefined();
    // First option is the default sort, which is the editorial ranking.
    expect(page.querySelector('.videos-sort-select option')?.textContent).toBe('推薦');
  });
});

describe('language facet', () => {
  // Language leads the facet stack, so the first row is it. The ordering itself
  // is asserted in the facet-presence test above.
  function languageRow(root: HTMLElement): HTMLElement {
    const row = root.querySelector<HTMLElement>('.videos-facet');
    if (!row) throw new Error('missing language facet');
    return row;
  }

  function pressedChips(root: HTMLElement): (string | undefined)[] {
    return [...languageRow(root).querySelectorAll<HTMLButtonElement>('.videos-tag-chip')]
      .filter((el) => el.getAttribute('aria-pressed') === 'true')
      .map((el) => el.dataset.value);
  }

  function cardCount(root: HTMLElement): number {
    return root.querySelectorAll('.videos-catalog-grid .videos-card-link').length;
  }

  it("opens on the visitor's language instead of a mixed list", () => {
    const root = mount();
    expect(pressedChips(root)).toEqual(['en']);
    expect(cardCount(root)).toBe(VIDEOS.filter((v) => v.language === 'en').length);
    expect(cardCount(root)).toBeLessThan(VIDEOS.length);
  });

  it('is one click from the whole catalog', () => {
    const root = mount();
    chip(root, 'Language', 'all').click();
    expect(pressedChips(root)).toEqual(['all']);
    expect(cardCount(root)).toBe(VIDEOS.length);
  });

  it('opens a Chinese-locale visitor on Chinese-language video', () => {
    const page = buildVideosPage('zh-Hant');
    expect(pressedChips(page)).toEqual(['zh']);
    const chinese = VIDEOS.filter((v) => v.language === 'zh');
    expect(chinese.length).toBeGreaterThan(0);
    expect(cardCount(page)).toBe(chinese.length);
  });

  // The guard that makes a default-on filter safe: no locale may land on the
  // empty state, which would read as a broken library rather than as a filter.
  it('never opens on an empty grid for any supported locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const page = buildVideosPage(locale);
      expect(cardCount(page)).toBeGreaterThan(0);
      expect(page.querySelector('.videos-empty')?.hasAttribute('hidden')).toBe(true);
    }
  });

  it('badges each card with its spoken language now that the catalog is mixed', () => {
    const chinese = VIDEOS.find((v) => v.language === 'zh');
    if (!chinese) throw new Error('expected a Chinese entry');
    const card = buildVideoCard(chinese, 'en');
    expect(card.querySelector('.videos-card-language')?.textContent).toBe('Chinese');
  });
});

describe('sortVideos', () => {
  it('leaves the editorial order alone under `featured`', () => {
    expect(sortVideos(VIDEOS, 'featured')).toEqual([...VIDEOS]);
    // A copy, not the array itself: callers sort and slice the result freely.
    expect(sortVideos(VIDEOS, 'featured')).not.toBe(VIDEOS);
  });

  // The point of ranking by array order rather than by a score is that a
  // filtered view stays ranked. Sorting a subset must not reshuffle it into
  // whatever order the filter happened to produce.
  it('keeps a filtered subset in catalogue order', () => {
    const english = VIDEOS.filter((video) => video.language === 'en');
    expect(sortVideos(english, 'featured')).toEqual(english);
    expect(english.length).toBeGreaterThan(1);
  });

  // Guards a specific regression: if someone re-sorts videos-data.ts by
  // addedAt, or reverts the default sort, `featured` silently becomes `newest`
  // and the curation is gone with no test failing. These differ today, and the
  // catalogue is ranked, so they should keep differing.
  it('is a real ranking, not the curation date in disguise', () => {
    expect(sortVideos(VIDEOS, 'featured')).not.toEqual(sortVideos(VIDEOS, 'newest'));
  });

  it('orders by length in both directions', () => {
    const longest = sortVideos(VIDEOS, 'longest').map((v) => v.durationMinutes ?? 0);
    const shortest = sortVideos(VIDEOS, 'shortest').map((v) => v.durationMinutes ?? 0);
    expect(longest).toEqual([...longest].sort((a, b) => b - a));
    expect(shortest).toEqual([...shortest].sort((a, b) => a - b));
  });
});

describe('filterVideos', () => {
  it('treats selected topics as OR and trims the query', () => {
    const filters: VideoFilters = {
      ...noFilter('  '),
      tags: new Set<VideoTag>(['openings', 'endgames']),
    };
    const matches = filterVideos(VIDEOS, filters);
    const expected = VIDEOS.filter((v) =>
      v.tags.some((tag) => tag === 'openings' || tag === 'endgames'),
    );
    expect(matches).toEqual(expected);
  });

  it('intersects tag, level, variant, source, and language selections', () => {
    const pool: readonly VideoEntry[] = [...VIDEOS, MISTBOARD_FIXTURE];
    const filters: VideoFilters = {
      tags: new Set<VideoTag>(['basics']),
      levels: new Set<VideoLevel>(['intro']),
      variants: new Set<VideoVariant>(['fog']),
      sources: new Set(['mistboard']),
      languages: new Set<VideoLanguage>(['en']),
      query: '',
    };
    expect(filterVideos(pool, filters)).toEqual([MISTBOARD_FIXTURE]);
  });

  it('treats selected languages as OR', () => {
    // Selecting every language is the same list as selecting none.
    const all = filterVideos(VIDEOS, {
      ...noFilter(),
      languages: new Set<VideoLanguage>(VIDEO_LANGUAGES),
    });
    expect(all).toEqual(VIDEOS);

    const chinese = filterVideos(VIDEOS, {
      ...noFilter(),
      languages: new Set<VideoLanguage>(['zh']),
    });
    expect(chinese.length).toBeGreaterThan(0);
    expect(chinese).toEqual(VIDEOS.filter((v) => v.language === 'zh'));
  });
});
