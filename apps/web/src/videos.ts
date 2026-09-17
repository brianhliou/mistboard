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
  videoThumbUrl,
  videoWatchUrl,
} from './videos-data.js';

// Re-exported so the page's own callers and tests keep one import site.
export { videoThumbUrl, videoWatchUrl };

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
