/** Theme preferences, the grouped theme catalogue, its picker and the themes page. */
import {
  isXiangqiTrainingTagId,
  XIANGQI_ENDGAME_MAX_PIECES,
  XIANGQI_OPENING_MAX_PLY,
  XIANGQI_TRAINING_TAGS,
  type XiangqiMotif,
  type XiangqiTrainingTagGroup,
  type XiangqiTrainingTagId,
} from '@mistboard/game';
import { type I18nKey, t } from '../i18n/catalog.js';
import { puzzleNavItems } from '../nav-items.js';

export type PuzzleThemeCount = XiangqiMotif & { count: number };
/** Any tag the trainer filters by: a kill pattern, mate-in-N, phase, goal or length. */
export type PuzzleThemeId = XiangqiTrainingTagId;
/** What the server counts: the kill patterns with their glossary, and every tag's count. */
export type PuzzleThemeOptions = {
  motifs: readonly PuzzleThemeCount[];
  tagCounts: Readonly<Partial<Record<PuzzleThemeId, number>>>;
};
export type PuzzleThemeSettings = {
  id: PuzzleThemeId | null;
  options: PuzzleThemeOptions;
  onChange: (id: PuzzleThemeId | null) => Promise<void>;
};

export type PuzzleThemeEntry = {
  id: PuzzleThemeId;
  name: string;
  description: string;
  count: number;
  /** Set on kill patterns, whose card carries the hanzi · pinyin line. */
  motif?: XiangqiMotif;
};
export type PuzzleThemeGroup = {
  group: XiangqiTrainingTagGroup;
  heading: string;
  entries: PuzzleThemeEntry[];
};

/**
 * A mate pattern is listed only once it has this many puzzles: below it a
 * drill repeats itself within minutes. Mates, phases, goals and lengths are
 * listed at any count above zero.
 */
export const PUZZLE_THEME_MIN_PATTERN_COUNT = 20;

const THEME_STORAGE_KEY = 'mistboard:puzzles:theme';

const GROUP_ORDER: readonly XiangqiTrainingTagGroup[] = [
  'motif',
  'mate',
  'phase',
  'goal',
  'length',
];
const GROUP_HEADING: Record<XiangqiTrainingTagGroup, I18nKey> = {
  motif: 'puzzle.themeGroupMotif',
  mate: 'puzzle.themeGroupMate',
  phase: 'puzzle.themeGroupPhase',
  goal: 'puzzle.themeGroupGoal',
  length: 'puzzle.themeGroupLength',
};

export function parsePuzzleTheme(value: string | null): PuzzleThemeId | null {
  return value && isXiangqiTrainingTagId(value) ? value : null;
}

export function loadPuzzleTheme(): PuzzleThemeId | null {
  try {
    return parsePuzzleTheme(window.localStorage?.getItem(THEME_STORAGE_KEY) ?? null);
  } catch {
    return null;
  }
}

export function savePuzzleTheme(id: PuzzleThemeId | null): void {
  try {
    window.localStorage?.setItem(THEME_STORAGE_KEY, id ?? '');
  } catch {
    // Training works when storage is unavailable.
  }
}

/** The tags a summary can be drilled by; an older server sends motifs only. */
export function puzzleSummaryTags(puzzle: {
  motifs?: readonly string[];
  tags?: readonly string[];
}): readonly string[] {
  return puzzle.tags ?? puzzle.motifs ?? [];
}

function tagDescription(id: (typeof XIANGQI_TRAINING_TAGS)[number]['id']): string {
  const count =
    id === 'opening'
      ? XIANGQI_OPENING_MAX_PLY / 2
      : id === 'endgame'
        ? XIANGQI_ENDGAME_MAX_PIECES
        : 0;
  return t(`puzzle.tagDesc.${id}` as I18nKey, { count });
}

/**
 * The catalogue as the themes page and the Settings picker show it, in
 * lichess's order: mate patterns (those at the minimum, most puzzles first),
 * then mates, phases, goals and lengths. Empty entries and groups are left
 * out; `keep` stays listed whatever its count, so a saved choice still shows.
 */
export function puzzleThemeGroups(
  options: PuzzleThemeOptions,
  keep: PuzzleThemeId | null = null,
): PuzzleThemeGroup[] {
  const countOf = (id: PuzzleThemeId, fallback = 0) => options.tagCounts[id] ?? fallback;
  const motifs = options.motifs
    .map((motif) => ({ motif, count: countOf(motif.id, motif.count) }))
    .filter(({ motif, count }) => count >= PUZZLE_THEME_MIN_PATTERN_COUNT || motif.id === keep)
    .sort((a, b) => b.count - a.count)
    .map(
      ({ motif, count }): PuzzleThemeEntry => ({
        id: motif.id,
        name: motif.label,
        description: motif.gloss,
        count,
        motif,
      }),
    );
  const byGroup = new Map<XiangqiTrainingTagGroup, PuzzleThemeEntry[]>([['motif', motifs]]);
  for (const tag of XIANGQI_TRAINING_TAGS) {
    const count = countOf(tag.id);
    if (count === 0 && tag.id !== keep) continue;
    const entries = byGroup.get(tag.group) ?? [];
    entries.push({
      id: tag.id,
      name: t(`puzzle.tagName.${tag.id}` as I18nKey),
      description: tagDescription(tag.id),
      count,
    });
    byGroup.set(tag.group, entries);
  }
  return GROUP_ORDER.flatMap((group) => {
    const entries = byGroup.get(group) ?? [];
    return entries.length > 0 ? [{ group, heading: t(GROUP_HEADING[group]), entries }] : [];
  });
}

export function puzzleThemesLink(): HTMLAnchorElement {
  const link = document.createElement('a');
  link.href = '/puzzles/themes';
  link.textContent = t('puzzle.browseThemes');
  return link;
}

export function puzzleThemePicker(settings: PuzzleThemeSettings, phone = false): HTMLLabelElement {
  const field = document.createElement('label');
  field.className = phone ? 'puzzle-pm-row' : 'puzzle-field';
  if (phone) field.dataset.puzzleMenuRow = 'theme';
  const label = document.createElement('span');
  label.className = phone ? 'puzzle-pm-row__label' : '';
  label.textContent = t('puzzle.themeField');
  const select = document.createElement('select');
  select.className = 'puzzle-select';
  if (phone) select.dataset.puzzleMenu = 'theme';
  else select.dataset.puzzleTheme = 'true';
  const all = document.createElement('option');
  all.value = '';
  all.textContent = t('puzzle.allThemes');
  select.append(all);
  for (const group of puzzleThemeGroups(settings.options, settings.id)) {
    const optgroup = document.createElement('optgroup');
    optgroup.label = group.heading;
    for (const entry of group.entries) {
      const option = document.createElement('option');
      option.value = entry.id;
      option.textContent = `${entry.name} (${entry.count})`;
      option.disabled = entry.count === 0;
      optgroup.append(option);
    }
    select.append(optgroup);
  }
  select.value = settings.id ?? '';
  select.addEventListener('change', () => {
    void settings.onChange(parsePuzzleTheme(select.value));
  });
  field.append(label, select);
  return field;
}

function themeCard(entry: PuzzleThemeEntry): HTMLElement {
  const card = document.createElement('article');
  card.className = 'puzzle-theme-entry';
  card.dataset.puzzleThemeCard = entry.id;
  const link = document.createElement('a');
  link.className = 'puzzle-theme-entry__link';
  link.href = `/puzzles?theme=${encodeURIComponent(entry.id)}`;
  const heading = document.createElement('h3');
  heading.textContent = entry.name;
  link.append(heading);
  if (entry.motif) {
    const name = document.createElement('p');
    name.className = 'puzzle-theme-name';
    const hanzi = document.createElement('span');
    hanzi.lang = 'zh-Hans';
    hanzi.textContent = entry.motif.hanzi;
    name.append(hanzi, ` · ${entry.motif.pinyin} · “${entry.motif.literal}”`);
    link.append(name);
  }
  const description = document.createElement('p');
  description.className = 'puzzle-theme-description';
  description.textContent = entry.description;
  const count = document.createElement('p');
  count.className = 'puzzle-theme-count';
  count.textContent =
    entry.count === 1 ? t('puzzle.themeCountOne') : t('puzzle.themeCount', { count: entry.count });
  link.append(description, count);
  card.append(link);
  return card;
}

/** Puzzles, Puzzle Themes, Puzzle Streak: the Puzzles menu, as lichess's left column. */
function themesSidebar(): HTMLElement {
  const side = document.createElement('nav');
  side.className = 'puzzle-themes-side';
  side.setAttribute('aria-label', t('nav.puzzles'));
  for (const item of puzzleNavItems()) {
    const link = document.createElement('a');
    link.href = item.href;
    link.textContent = t(item.labelKey);
    if (item.href === '/puzzles/themes') {
      link.setAttribute('aria-current', 'page');
      link.classList.add('active');
    }
    side.append(link);
  }
  return side;
}

export function renderPuzzleThemesIndex(options: PuzzleThemeOptions): HTMLElement {
  const layout = document.createElement('div');
  layout.className = 'puzzle-themes-layout';
  const main = document.createElement('main');
  main.className = 'puzzle-themes-index';
  const title = document.createElement('h1');
  title.className = 'site-section-heading';
  title.textContent = t('puzzle.themesTitle');
  const intro = document.createElement('p');
  intro.textContent = t('puzzle.themeIndexIntro');
  main.append(title, intro);
  for (const group of puzzleThemeGroups(options)) {
    const section = document.createElement('section');
    section.className = 'puzzle-themes-group';
    section.dataset.puzzleThemeGroup = group.group;
    const heading = document.createElement('h2');
    heading.textContent = group.heading;
    const grid = document.createElement('div');
    grid.className = 'puzzle-themes-grid';
    grid.append(...group.entries.map(themeCard));
    section.append(heading, grid);
    main.append(section);
  }
  layout.append(themesSidebar(), main);
  return layout;
}
