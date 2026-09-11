// Curated video library at /videos, lichess.org/video style: a filterable grid
// of verified English-first xiangqi videos. External (YouTube) cards link out in
// a new tab instead of embedding: the dev server is cross-origin isolated
// site-wide (COEP credentialless in vite.config.ts), which blocks YouTube
// iframes (the embed document sends no COEP), while no-cors thumbnail <img> loads
// are exactly what credentialless permits. Link-out behaves identically in dev
// and prod; revisit lazy embeds only if the dev header scoping changes.
//
// The catalog filters on four axes (topic / level / game / spoken language) plus
// a source filter. It opens in editorial order (`featured`), which is the order
// of the VIDEOS array itself, and can be re-sorted by recency or length. Watch
// URL and thumbnail are derived per `source` so first-party Mistboard videos
// render alongside YouTube ones.

import './videos.css';

import { track } from './analytics.js';
import { t } from './i18n/catalog.js';
import { currentLocale, type Locale } from './i18n/locale.js';
import { YOUTUBE_BLOCKED_IN } from './nav-items.js';
import { buildNav } from './site-shell.js';
import {
  FIRST_PARTY_VIDEOS,
  VIDEO_LANGUAGES,
  VIDEO_LEVELS,
  VIDEO_TAGS,
  VIDEOS,
  type VideoEntry,
  type VideoLanguage,
  type VideoLevel,
  type VideoSource,
  type VideoTag,
  type VideoVariant,
  videoKey,
} from './videos-data.js';
import { isBlockedForViewer } from './viewer-geo.js';

const TAG_LABEL_KEYS: Record<VideoTag, `videos.tag.${VideoTag}`> = {
  basics: 'videos.tag.basics',
  openings: 'videos.tag.openings',
  tactics: 'videos.tag.tactics',
  endgames: 'videos.tag.endgames',
  strategy: 'videos.tag.strategy',
  games: 'videos.tag.games',
  culture: 'videos.tag.culture',
};

const LEVEL_LABEL_KEYS: Record<VideoLevel, `videos.level.${VideoLevel}`> = {
  intro: 'videos.level.intro',
  intermediate: 'videos.level.intermediate',
  advanced: 'videos.level.advanced',
};

const VARIANT_LABEL_KEYS: Record<VideoVariant, `videos.variant.${VideoVariant}`> = {
  xiangqi: 'videos.variant.xiangqi',
  fog: 'videos.variant.fog',
};

const LANGUAGE_LABEL_KEYS: Record<VideoLanguage, `videos.language.${VideoLanguage}`> = {
  en: 'videos.language.en',
  zh: 'videos.language.zh',
};

// Site locale to spoken video language. Both Chinese locales want Mandarin
// video: script is a writing-system axis, speech is not. Exhaustive switch with
// no default, so a new Locale member fails the build here instead of silently
// falling back to English.
export function videoLanguageForLocale(locale: Locale): VideoLanguage {
  switch (locale) {
    case 'en':
      return 'en';
    case 'zh-Hans':
    case 'zh-Hant':
      return 'zh';
  }
}

export type VideoSort = 'featured' | 'newest' | 'longest' | 'shortest';

const SORT_OPTIONS: readonly VideoSort[] = ['featured', 'newest', 'longest', 'shortest'];

const SORT_LABEL_KEYS: Record<VideoSort, `videos.sort.${VideoSort}`> = {
  featured: 'videos.sort.featured',
  newest: 'videos.sort.newest',
  longest: 'videos.sort.longest',
  shortest: 'videos.sort.shortest',
};

export interface VideoFilters {
  tags: ReadonlySet<VideoTag>;
  levels: ReadonlySet<VideoLevel>;
  variants: ReadonlySet<VideoVariant>;
  sources: ReadonlySet<VideoSource>;
  languages: ReadonlySet<VideoLanguage>;
  query: string;
}

// The card links out (YouTube) or in (first-party). Both URL and thumbnail are
// derived per source; the exhaustive switch has no default, so adding a source
// to the union is a compile error here until it is handled (fail-closed).
export function videoWatchUrl(video: VideoEntry): string {
  switch (video.source) {
    case 'youtube':
      return `https://www.youtube.com/watch?v=${encodeURIComponent(video.id)}`;
    case 'mistboard':
      return video.url;
  }
}

export function videoThumbUrl(video: VideoEntry): string {
  // An explicit thumbnail always wins: it is how our own episodes avoid a
  // third-party image request that a blocker can drop.
  if (video.thumbnailUrl) return video.thumbnailUrl;
  switch (video.source) {
    case 'youtube':
      // no-cors image load: fine under dev's COEP credentialless and in prod
      // (where /videos carries no COEP at all). hqdefault ships 4:3 letterboxed.
      return `https://img.youtube.com/vi/${encodeURIComponent(video.id)}/hqdefault.jpg`;
    case 'mistboard':
      return video.thumbnailUrl;
  }
}

export function mountVideos(root: HTMLElement): void {
  const locale = currentLocale();
  document.title = `${t('videos.heading', {}, locale)} · Mistboard`;
  root.replaceChildren();
  root.classList.add('landing-page', 'videos-route');
  root.append(buildNav(locale), buildVideosPage(locale));
}

export function buildVideosPage(locale: Locale = currentLocale()): HTMLElement {
  const section = document.createElement('section');
  section.className = 'site-section videos-page';

  const heading = document.createElement('h1');
  heading.className = 'site-section-heading';
  heading.textContent = t('videos.heading', {}, locale);

  const intro = document.createElement('p');
  intro.className = 'videos-intro';
  intro.textContent = t('videos.intro', {}, locale);

  // Ours lead. The library's job changed the day the channel published: it is
  // the site's one surface that can turn a visitor into a subscriber, and a
  // page whose every card sends traffic to another channel cannot do that.
  // The curated catalogue still carries the page while there is one episode.
  const ours = document.createElement('section');
  ours.className = 'videos-ours';
  const oursHeading = document.createElement('h2');
  oursHeading.className = 'videos-ours-heading';
  oursHeading.textContent = t('videos.ourHeading', {}, locale);
  const oursIntro = document.createElement('p');
  oursIntro.className = 'videos-ours-intro';
  oursIntro.textContent = t('videos.ourIntro', {}, locale);
  const oursList = document.createElement('ul');
  oursList.className = 'videos-grid videos-ours-grid';
  for (const video of FIRST_PARTY_VIDEOS) oursList.append(buildVideoCard(video, locale));
  const subscribe = document.createElement('a');
  subscribe.className = 'videos-subscribe';
  subscribe.href = 'https://www.youtube.com/@Mistboard?sub_confirmation=1';
  subscribe.target = '_blank';
  subscribe.rel = 'noopener noreferrer';
  subscribe.textContent = t('videos.subscribe', {}, locale);
  subscribe.addEventListener('click', () => {
    track('video_clicked', { kind: 'subscribe', source: 'youtube', video_key: null });
  });
  ours.append(oursHeading, oursIntro, oursList, subscribe);

  // Which facet options actually exist in the data. Level always spans its full
  // ordered set; language, variant, and source facets render only when they
  // discriminate (more than one language/variant present, any first-party video
  // present), so the page never shows a dead single-option facet.
  const presentLanguages = PRESENT_LANGUAGES;
  const presentVariants = presentVideoVariants();
  const presentSources = presentVideoSources();

  const controls = document.createElement('div');
  controls.className = 'videos-controls';

  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'videos-search';
  search.placeholder = t('videos.searchPlaceholder', {}, locale);
  search.setAttribute('aria-label', t('videos.searchLabel', {}, locale));

  const sortWrap = document.createElement('label');
  sortWrap.className = 'videos-sort';
  const sortText = document.createElement('span');
  sortText.className = 'videos-sort-label';
  sortText.textContent = t('videos.sortLabel', {}, locale);
  const sortSelect = document.createElement('select');
  sortSelect.className = 'videos-sort-select';
  for (const option of SORT_OPTIONS) {
    const opt = document.createElement('option');
    opt.value = option;
    opt.textContent = t(SORT_LABEL_KEYS[option], {}, locale);
    sortSelect.append(opt);
  }
  sortWrap.append(sortText, sortSelect);
  controls.append(search, sortWrap);

  const facets = document.createElement('div');
  facets.className = 'videos-facets';

  const state: {
    tags: Set<VideoTag>;
    levels: Set<VideoLevel>;
    variants: Set<VideoVariant>;
    sources: Set<VideoSource>;
    languages: Set<VideoLanguage>;
    query: string;
    sort: VideoSort;
  } = {
    tags: new Set(),
    levels: new Set(),
    variants: new Set(),
    sources: new Set(),
    languages: new Set(),
    query: '',
    sort: 'featured',
  };

  // The one facet that starts with a selection: a visitor reading zh-Hant should
  // land on Chinese-language video, not on an English list they cannot follow.
  // Two guards keep the default honest. It only applies when the facet renders
  // (never an invisible filter), and only when the visitor's language actually
  // has entries, so an unrepresented locale falls open to the whole catalog
  // instead of to an empty grid that reads as a broken page. The chip sits first
  // in the facet stack, pressed, with All beside it: the narrowing is visible
  // and one click from undone.
  const preferredLanguage = videoLanguageForLocale(locale);
  if (presentLanguages.length > 1 && presentLanguages.includes(preferredLanguage)) {
    state.languages.add(preferredLanguage);
  }

  const groups: Array<() => void> = [];

  if (presentLanguages.length > 1) {
    const languageGroup = buildChipGroup({
      labelText: t('videos.languageLabel', {}, locale),
      allLabel: t('videos.allLanguages', {}, locale),
      values: presentLanguages,
      optionLabel: (language) => t(LANGUAGE_LABEL_KEYS[language], {}, locale),
      selected: state.languages,
      onChange: apply,
    });
    facets.append(languageGroup.row);
    groups.push(languageGroup.sync);
  }

  const topicGroup = buildChipGroup({
    labelText: t('videos.topicLabel', {}, locale),
    allLabel: t('videos.allTag', {}, locale),
    values: VIDEO_TAGS,
    optionLabel: (tag) => t(TAG_LABEL_KEYS[tag], {}, locale),
    selected: state.tags,
    onChange: apply,
  });
  facets.append(topicGroup.row);
  groups.push(topicGroup.sync);

  const levelGroup = buildChipGroup({
    labelText: t('videos.levelLabel', {}, locale),
    allLabel: t('videos.allTag', {}, locale),
    values: VIDEO_LEVELS,
    optionLabel: (level) => t(LEVEL_LABEL_KEYS[level], {}, locale),
    selected: state.levels,
    onChange: apply,
  });
  facets.append(levelGroup.row);
  groups.push(levelGroup.sync);

  if (presentVariants.length > 1) {
    const variantGroup = buildChipGroup({
      labelText: t('videos.variantLabel', {}, locale),
      allLabel: t('videos.allTag', {}, locale),
      values: presentVariants,
      optionLabel: (variant) => t(VARIANT_LABEL_KEYS[variant], {}, locale),
      selected: state.variants,
      onChange: apply,
    });
    facets.append(variantGroup.row);
    groups.push(variantGroup.sync);
  }

  if (presentSources.includes('mistboard')) {
    const sourceGroup = buildChipGroup({
      labelText: t('videos.sourceLabel', {}, locale),
      allLabel: t('videos.allTag', {}, locale),
      values: ['mistboard'],
      optionLabel: () => t('videos.source.mistboard', {}, locale),
      selected: state.sources,
      onChange: apply,
    });
    facets.append(sourceGroup.row);
    groups.push(sourceGroup.sync);
  }

  const count = document.createElement('p');
  count.className = 'videos-count';
  count.setAttribute('aria-live', 'polite');

  const grid = document.createElement('ul');
  grid.className = 'videos-grid videos-catalog-grid';

  const empty = document.createElement('p');
  empty.className = 'videos-empty';
  empty.textContent = t('videos.empty', {}, locale);
  empty.hidden = true;

  const note = document.createElement('p');
  note.className = 'videos-note';
  note.textContent = t('videos.opensOnYoutube', {}, locale);

  search.addEventListener('input', () => {
    state.query = search.value;
    apply();
  });
  sortSelect.addEventListener('change', () => {
    state.sort = (sortSelect.value as VideoSort) ?? 'featured';
    apply();
  });

  function apply(): void {
    const matches = sortVideos(
      filterVideos(VIDEOS, {
        tags: state.tags,
        levels: state.levels,
        variants: state.variants,
        sources: state.sources,
        languages: state.languages,
        query: state.query,
      }),
      state.sort,
    );
    for (const sync of groups) sync();
    count.textContent =
      matches.length === 1
        ? t('videos.countOne', {}, locale)
        : t('videos.count', { count: matches.length }, locale);
    grid.replaceChildren(...matches.map((video) => buildVideoCard(video, locale)));
    grid.hidden = matches.length === 0;
    empty.hidden = matches.length > 0;
  }

  apply();

  section.append(heading, intro, ours, controls, facets, count, grid, empty, note);
  return section;
}

// Cross-axis AND, within-axis OR: a video shows if it matches at least one
// selected value in every axis that has a selection. The text query is a
// case-insensitive substring match on title + author.
export function filterVideos(videos: readonly VideoEntry[], filters: VideoFilters): VideoEntry[] {
  const needle = filters.query.trim().toLowerCase();
  return videos.filter((video) => {
    if (filters.tags.size > 0 && !video.tags.some((tag) => filters.tags.has(tag))) return false;
    if (filters.levels.size > 0 && !filters.levels.has(video.level)) return false;
    if (filters.variants.size > 0 && !filters.variants.has(video.variant)) return false;
    if (filters.sources.size > 0 && !filters.sources.has(video.source)) return false;
    if (filters.languages.size > 0 && !filters.languages.has(video.language)) return false;
    if (needle === '') return true;
    return (
      video.title.toLowerCase().includes(needle) || video.author.toLowerCase().includes(needle)
    );
  });
}

// Editorial order first: `featured` is the VIDEOS array as written, so the
// ranking is maintained by moving lines in videos-data.ts rather than by a score
// this has to recompute. It is deliberately a no-op sort and not the absence of
// one, so that a filtered subset still comes out ranked: the facets slice the
// list, the order survives the slice.
//
// The other modes reorder it. Length sorts push unknown-duration videos to the
// end, though the catalogue has none: `scripts/videos-audit.mjs` backfills
// durations and a test in videos.test.ts fails if one lands without.
export function sortVideos(videos: readonly VideoEntry[], sort: VideoSort): VideoEntry[] {
  const list = [...videos];
  switch (sort) {
    case 'featured':
      return list;
    case 'newest':
      return list.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
    case 'longest':
      return list.sort((a, b) => (b.durationMinutes ?? -1) - (a.durationMinutes ?? -1));
    case 'shortest':
      return list.sort((a, b) => (a.durationMinutes ?? Infinity) - (b.durationMinutes ?? Infinity));
  }
}

function presentVideoVariants(): VideoVariant[] {
  const seen = new Set<VideoVariant>();
  for (const video of VIDEOS) seen.add(video.variant);
  // Stable, meaningful order rather than insertion order.
  return (['xiangqi', 'fog'] as const).filter((variant) => seen.has(variant));
}

function presentVideoSources(): VideoSource[] {
  const seen = new Set<VideoSource>();
  for (const video of VIDEOS) seen.add(video.source);
  return (['youtube', 'mistboard'] as const).filter((source) => seen.has(source));
}

// Unlike the variant/source helpers this is computed once at module load: the
// card renderer consults it per card to decide whether a language badge carries
// information, and VIDEOS is a static list that cannot change at runtime.
const PRESENT_LANGUAGES: readonly VideoLanguage[] = (() => {
  const seen = new Set<VideoLanguage>();
  for (const video of VIDEOS) seen.add(video.language);
  return VIDEO_LANGUAGES.filter((language) => seen.has(language));
})();

interface ChipGroupOptions<T extends string> {
  labelText: string;
  allLabel: string;
  values: readonly T[];
  optionLabel: (value: T) => string;
  selected: Set<T>;
  onChange: () => void;
}

// A labelled facet row: an "All" chip that clears the selection plus one toggle
// chip per value. Returns the row element and a `sync` that reflects the current
// selection into aria-pressed after any change.
function buildChipGroup<T extends string>(
  options: ChipGroupOptions<T>,
): {
  row: HTMLElement;
  sync: () => void;
} {
  const row = document.createElement('div');
  row.className = 'videos-facet';

  const label = document.createElement('span');
  label.className = 'videos-facet-label';
  label.textContent = options.labelText;

  const chips = document.createElement('div');
  chips.className = 'videos-tags';
  chips.setAttribute('role', 'group');
  chips.setAttribute('aria-label', options.labelText);

  const allChip = buildChip(options.allLabel);
  allChip.dataset.value = 'all';
  allChip.addEventListener('click', () => {
    options.selected.clear();
    options.onChange();
  });
  chips.append(allChip);

  const chipByValue = new Map<T, HTMLButtonElement>();
  for (const value of options.values) {
    const chip = buildChip(options.optionLabel(value));
    chip.dataset.value = value;
    chip.addEventListener('click', () => {
      if (options.selected.has(value)) options.selected.delete(value);
      else options.selected.add(value);
      options.onChange();
    });
    chipByValue.set(value, chip);
    chips.append(chip);
  }

  row.append(label, chips);

  function sync(): void {
    allChip.setAttribute('aria-pressed', String(options.selected.size === 0));
    for (const [value, chip] of chipByValue) {
      chip.setAttribute('aria-pressed', String(options.selected.has(value)));
    }
  }

  return { row, sync };
}

function buildChip(label: string): HTMLButtonElement {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'videos-tag-chip';
  chip.textContent = label;
  chip.setAttribute('aria-pressed', 'false');
  return chip;
}

export function buildVideoCard(video: VideoEntry, locale: Locale = currentLocale()): HTMLElement {
  const item = document.createElement('li');
  item.className = 'videos-card';

  const link = document.createElement('a');
  link.className = 'videos-card-link';
  link.href = videoWatchUrl(video);
  if (video.source === 'youtube') {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  }
  // Outbound clicks are the only signal the library has: a YouTube visit
  // leaves no pageview here, and the referrer is stripped on the way back.
  link.addEventListener('click', () => {
    track('video_clicked', {
      kind: 'card',
      source: video.source,
      video_key: videoKey(video),
      first_party: FIRST_PARTY_VIDEOS.includes(video),
      level: video.level,
      language: video.language,
    });
  });

  const thumb = document.createElement('span');
  thumb.className = 'videos-thumb';
  const img = document.createElement('img');
  img.src = videoThumbUrl(video);
  img.alt = '';
  img.loading = 'lazy';
  thumb.append(img);

  if (video.firstParty === true || video.source === 'mistboard') {
    const badge = document.createElement('span');
    badge.className = 'videos-source-badge';
    badge.textContent = t('videos.badge.mistboard', {}, locale);
    thumb.append(badge);
  }

  const title = document.createElement('span');
  title.className = 'videos-card-title';
  title.textContent = video.title;

  const meta = document.createElement('span');
  meta.className = 'videos-card-meta';
  meta.textContent =
    video.durationMinutes === undefined
      ? video.author
      : `${video.author} · ${t('videos.duration', { count: video.durationMinutes }, locale)}`;

  const tags = document.createElement('span');
  tags.className = 'videos-card-tags';

  const levelBadge = document.createElement('span');
  levelBadge.className = 'videos-card-tag videos-card-level';
  levelBadge.textContent = t(LEVEL_LABEL_KEYS[video.level], {}, locale);
  tags.append(levelBadge);

  // Only informative once the catalog is mixed: on a single-language library the
  // badge would repeat the same word on every card.
  if (PRESENT_LANGUAGES.length > 1) {
    const languageBadge = document.createElement('span');
    languageBadge.className = 'videos-card-tag videos-card-language';
    languageBadge.textContent = t(LANGUAGE_LABEL_KEYS[video.language], {}, locale);
    tags.append(languageBadge);
  }

  for (const tag of video.tags) {
    const badge = document.createElement('span');
    badge.className = 'videos-card-tag';
    badge.textContent = t(TAG_LABEL_KEYS[tag], {}, locale);
    tags.append(badge);
  }

  link.append(thumb, title, meta, tags);
  item.append(link);
  return item;
}

// ── Homepage video strip (band 3, beneath the blog row) ─────────────────────
// A curated front-door set, hand-picked like articles' HOME_ARTICLE_SLUGS. The
// order below is the editorial arc as authored -- ours -> 60-second hook -> full
// rules primer -> first tactics -> openings -> a famous sacrifice -> a title
// game -> culture -- and it is what the roles are chosen against. It is NOT the
// render order: orderHomeVideos pins ours to the front and shuffles the rest per
// render, so the arc reads as coverage (one slot per role) rather than sequence.
// One slot per role: the earlier draft spent five of eight slots on
// near-duplicate "how to play" videos, which read as one repeated promise and
// hid the depth of the catalog behind it.
//
// This is NOT the catalogue ranking. videos-data.ts is ordered best-first and
// /videos opens on that; here the roles come first, so a lower-ranked video can
// hold a slot no higher-ranked one covers. What the ranking is good for is
// checking each slot against the alternatives for its role, which is how the
// endgames slot came out: it held a 574-view, 27-minute lecture, the second
// weakest entry in the English catalogue, because English endgame video is
// uniformly thin and the role forced a pick. The slot now shows a 50k-view
// six-minute knight sacrifice instead. Endgames keep their facet on /videos;
// they do not get a front-door card until something worth clicking exists.
// (The Chinese arc keeps its endgames slot: 13k lifetime views, a real
// teaching video, not the same case.)
//
// Newest-first is deliberately NOT used here (it skews to dense game commentary).
// Keys are videoKey() values; an unknown key is dropped so a removed video never
// breaks the row -- resilient at runtime, invisible to a typo, so a test asserts
// every key resolves and every arc is full. Every id below was verified live
// against YouTube on 2026-08-28 by `npm run videos:audit`.
//
// One arc per spoken language, each hand-ordered on the same beats: the strip a
// visitor sees follows their locale, because a homepage row of video they cannot
// follow is decoration, not a front door. The Record is keyed by VideoLanguage,
// so a new language fails the build here until it gets an arc of its own.
const HOME_VIDEO_KEYS: Record<VideoLanguage, readonly string[]> = {
  en: [
    // Ours leads. It also retires the slot that used to hold another channel's
    // chess-player framing: that was the exact editorial role this episode was
    // written for, and running both would promote a competitor for our own
    // positioning while saying the same thing twice.
    'yt:aWxafeWsncQ', // Mistboard — Chinese Chess for Chess Players, all the rules
    'yt:qbbFuWyx0XI', // 60-second hook — Sam Copeland (a name chess players know)
    'yt:kSL7JErRMx8', // Full rules primer — AncientChess
    'yt:950nyyjOirU', // Basic checkmate strategies — the first step past the rules
    'yt:MyLXgkL4C5A', // The Most Popular Openings in Xiangqi
    'yt:RzGPLnQgsIE', // Knight sacrifice, mate in 13 — the game at its most vivid
    'yt:uF3-KrlXprE', // 2023 World Championship final — the aspirational ceiling
    'yt:gkD29aQW3Vw', // The Four Types of Chinese Chess Players — culture
  ],
  zh: [
    'yt:vE1TGi6QAWo', // 两分钟从零学象棋 — the short hook
    'yt:90vfBo4J3fc', // 七分钟学会中国象棋 — full rules primer
    'yt:eGe52Bcp08g', // 开局前面三步 — first openings step
    'yt:hBljfkvvLxs', // 抢占这5个位置 — positional strategy
    'yt:ZxUA7c5xKWc', // 25大基本杀法 — the tactics reference
    'yt:UMmwd_bfmfg', // 实用残局基本杀法 — endgames
    'yt:ZHta2o0NOTw', // 郭中基's double-chariot sacrifice — the aspirational ceiling
    'yt:Cc4Kl4e8-7I', // 象棋的起源和江湖残局 — culture
  ],
};

// A locale arc has to be deep enough to fill the carousel's three visible cards
// before it displaces English; below that the row reads as a stub.
const MIN_HOME_VIDEOS_PER_LANGUAGE = 4;

// Slots the arc does NOT own, drawn from the catalogue and rotated weekly. The
// arc above is evergreen on purpose -- it is what a first-time visitor should
// meet, and reach cannot tell a lesson from a reaction video -- but being
// evergreen also meant the homepage was decoupled from the catalogue entirely:
// `npm run videos:mine` could add twenty videos and this row stayed
// byte-identical, so keeping the front door current was a manual edit nobody
// remembered to make. These slots are the wire between the two.
//
// Two, not more: the arc is the row's identity and freshness is the garnish. And
// they are shuffled in with the rest rather than pinned to the tail, because the
// carousel only shows about three cards at a time -- a new video parked in slot
// nine is a new video nobody sees.
const HOME_VIDEO_FRESH_SLOTS = 2;

// The arc has priority over the fresh slots, so a `limit` tighter than the arc
// trims freshness first and never silently shortens the curated roles.
const HOME_VIDEO_ROW_LIMIT = 10;

// A week. Long enough that a returning visitor meets a settled row instead of
// churn, short enough that the front door moves on its own between mining runs
// -- which is the whole ask: adding to the catalogue is a deliberate act, and the
// row should not sit still in the weeks when nobody performs it.
const HOME_VIDEO_ROTATION_MS = 7 * 24 * 60 * 60 * 1000;

// How deep the rotation reaches. Everything in this pool has to be good enough
// for the front door, so it is the TOP of the catalogue's own ordering, never the
// whole shelf: rotating through all 71 entries would eventually seat a 90-minute
// lecture or a 94-view clip beside the rules primer, which is exactly what the
// curated arc exists to prevent. Ten is two slots x a five-week cycle.
const HOME_VIDEO_ROTATION_POOL = 10;

// The rotating slots: catalogue entries in one spoken language, minus whatever
// the arc already holds, advanced by week.
//
// The pool is ordered newest-first (and within a date by catalogue order, since
// videos-data.ts is written best-first, so a batch that lands fifteen entries on
// one day offers its best rather than its last). That ordering is what keeps
// ingestion wired to the homepage: a fresh batch enters at the front and pushes
// older entries out of the pool entirely, so `videos:mine` still reaches the
// front door -- within a cycle rather than the same day, which is the one thing
// this trades away for a row that moves by itself.
//
// The offset advances by `count` per period, so consecutive weeks do not overlap
// and a full cycle shows the whole pool. It is derived from the clock rather than
// stored, which means no state, no cron, and no deploy: the same week yields the
// same row for every visitor, and that determinism is what makes it testable.
// `now` is a parameter for exactly that reason.
//
// First-party videos are excluded -- orderHomeVideos already pins them, and a
// promoted entry appearing twice would read as a bug.
export function freshHomeVideos(
  language: VideoLanguage,
  exclude: ReadonlySet<string>,
  count: number,
  now: Date = new Date(),
): VideoEntry[] {
  const pool = VIDEOS.map((video, index) => ({ video, index }))
    .filter(
      ({ video }) =>
        video.language === language && !isPromotedVideo(video) && !exclude.has(videoKey(video)),
    )
    .sort((a, b) =>
      a.video.addedAt === b.video.addedAt
        ? a.index - b.index
        : a.video.addedAt < b.video.addedAt
          ? 1
          : -1,
    )
    .slice(0, HOME_VIDEO_ROTATION_POOL)
    .map(({ video }) => video);

  const take = Math.min(Math.max(0, count), pool.length);
  if (take === 0) return [];

  // The cycle is anchored to the newest entry, not to the epoch, and that anchor
  // is what keeps `videos:mine` wired to the homepage. Count weeks from the epoch
  // instead and the phase lands wherever the arithmetic puts it: a batch added
  // today can sit four weeks before its slot comes up, which is the whole point
  // of ingesting undone. Anchored, week zero of a batch shows its two best
  // entries the day it deploys, and every week after that advances by two.
  const anchor = Date.parse(`${pool[0].addedAt}T00:00:00Z`);
  const elapsed = now.getTime() - (Number.isNaN(anchor) ? 0 : anchor);

  // Math.floor, not truncation, and the double modulo after it: a clock behind
  // the anchor (skew, or an entry dated ahead) would otherwise rotate backwards
  // into a negative index, and a negative index is a hole in the row.
  const period = Math.floor(elapsed / HOME_VIDEO_ROTATION_MS);
  const start = (((period * take) % pool.length) + pool.length) % pool.length;
  return Array.from({ length: take }, (_, i) => pool[(start + i) % pool.length]);
}

// Ours lead, pinned and in curated order; everything after them is another
// channel's video and gets shuffled on every render. The curation still decides
// WHICH eight videos the row may show (one per editorial role, see above); what
// it no longer decides is which of them a given visitor sees first. Two reasons:
// the row is a carousel, so the tail slots are only reached by clicking, and a
// fixed order means the same three cards greet every repeat visitor while the
// rest of the arc is never seen. It matters more as `limit` drops below the arc
// length, where a fixed order would cut the tail off entirely.
//
// Promoted = ours: first-party episodes. They are the one thing on this row that
// converts a visitor into a subscriber rather than sending them to a competitor,
// so they never take a random slot.
export function orderHomeVideos(arc: readonly VideoEntry[]): VideoEntry[] {
  const promoted = arc.filter(isPromotedVideo);
  const rest = arc.filter((video) => !isPromotedVideo(video));
  return [...promoted, ...shuffle(rest)];
}

function isPromotedVideo(video: VideoEntry): boolean {
  return video.firstParty === true || video.source === 'mistboard';
}

// Fisher-Yates on a copy: the caller's array (a module-level curated list once
// resolved) is never reordered in place.
function shuffle<T>(items: readonly T[]): T[] {
  const list = [...items];
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const swap = list[i];
    list[i] = list[j];
    list[j] = swap;
  }
  return list;
}

// Builds the homepage video carousel: the same `.landing-carousel` structure the
// blog strip uses (so initLandingCarousel drives it), filled with compact video
// cards. Returns null when none of the curated keys resolve (row is omitted).
export function buildHomeVideoCards(
  limit = HOME_VIDEO_ROW_LIMIT,
  locale: Locale = currentLocale(),
): HTMLElement | null {
  // Where YouTube is blocked the row is not merely useless, it is visibly
  // broken: the thumbnails come from img.youtube.com, so every card renders as
  // a failed image. Omitting the row is the honest version of that. Returning
  // null is the same signal the caller already handles when no curated key
  // resolves, and landing.css drops the grid's fourth row to match. See #378.
  if (isBlockedForViewer(YOUTUBE_BLOCKED_IN)) return null;

  // Ours resolve here too. They are not in VIDEOS (that list is the catalogue
  // the /videos page filters), so without this the strip would silently drop the
  // one entry it most wants to lead with.
  const byKey = new Map(
    [...FIRST_PARTY_VIDEOS, ...VIDEOS].map((video) => [videoKey(video), video]),
  );
  const resolve = (keys: readonly string[]): VideoEntry[] =>
    keys.flatMap((key) => {
      const video = byKey.get(key);
      return video ? [video] : [];
    });

  const wanted = videoLanguageForLocale(locale);
  const preferred = resolve(HOME_VIDEO_KEYS[wanted]);
  const deep = preferred.length >= MIN_HOME_VIDEOS_PER_LANGUAGE;
  const arc = deep ? preferred : resolve(HOME_VIDEO_KEYS.en);

  // Follows the arc that actually rendered, not the visitor's locale: a shallow
  // locale falls back to the English arc, and topping it up with fresh Chinese
  // would rebuild the mixed row the fallback exists to avoid.
  const spoken: VideoLanguage = deep ? wanted : 'en';
  const budget = Math.max(0, Math.min(HOME_VIDEO_FRESH_SLOTS, limit - arc.length));
  const fresh = freshHomeVideos(spoken, new Set(arc.map(videoKey)), budget);

  const picks = orderHomeVideos([...arc, ...fresh]).slice(0, limit);
  if (picks.length === 0) return null;

  const section = document.createElement('section');
  section.className = 'landing-videos';
  section.setAttribute('aria-label', t('videos.heading', {}, locale));

  const carousel = document.createElement('div');
  carousel.className = 'landing-carousel';

  const track = document.createElement('div');
  track.className = 'landing-carousel-track';
  for (const video of picks) track.append(landingVideoCard(video, locale));

  const prev = homeVideoNavButton('prev', '‹', locale);
  const next = homeVideoNavButton('next', '›', locale);

  carousel.append(prev, track, next);
  section.append(carousel);
  return section;
}

function homeVideoNavButton(
  dir: 'prev' | 'next',
  glyph: string,
  locale: Locale,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `landing-carousel-nav landing-carousel-nav-${dir}`;
  button.setAttribute(
    'aria-label',
    t(dir === 'prev' ? 'videos.previousVideos' : 'videos.moreVideos', {}, locale),
  );
  button.textContent = glyph;
  return button;
}

// Compact home card: reuses the blog card's base classes (border/hover/title
// clamp) so the two strips stay in visual lockstep, and adds a 16:9 photographic
// thumbnail with a play glyph + duration/source pills — the cues that read
// "video" at a glance next to the blog strip's board-diagram thumbnails.
function landingVideoCard(video: VideoEntry, locale: Locale): HTMLElement {
  const link = document.createElement('a');
  link.className = 'landing-article-card landing-video-card';
  link.dataset.cardKind = 'video';
  link.href = videoWatchUrl(video);
  if (video.source === 'youtube') {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  }

  const thumb = document.createElement('div');
  thumb.className = 'landing-article-card-thumb landing-video-card-thumb';

  const img = document.createElement('img');
  img.className = 'landing-video-card-img';
  img.src = videoThumbUrl(video);
  img.alt = '';
  img.loading = 'lazy';
  thumb.append(img);

  const play = document.createElement('span');
  play.className = 'landing-video-card-play';
  play.setAttribute('aria-hidden', 'true');
  play.textContent = '▶';
  thumb.append(play);

  if (video.durationMinutes !== undefined) {
    const duration = document.createElement('span');
    duration.className = 'landing-video-card-duration';
    duration.textContent = t('videos.duration', { count: video.durationMinutes }, locale);
    thumb.append(duration);
  }

  if (video.firstParty === true || video.source === 'mistboard') {
    const badge = document.createElement('span');
    badge.className = 'landing-video-card-badge';
    badge.textContent = t('videos.badge.mistboard', {}, locale);
    thumb.append(badge);
  }

  const title = document.createElement('strong');
  title.className = 'landing-article-card-title landing-video-card-title';
  title.textContent = video.title;

  const meta = document.createElement('span');
  meta.className = 'landing-video-card-meta';
  meta.textContent = video.author;

  link.append(thumb, title, meta);
  return link;
}
