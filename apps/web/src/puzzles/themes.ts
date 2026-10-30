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
        // The catalogue holds each pattern's name and gloss per locale: the
        // English label and gloss, the hanzi and a Chinese gloss in zh.
        name: t(`puzzle.motifName.${motif.id}` as I18nKey),
        description: t(`puzzle.motifDesc.${motif.id}` as I18nKey),
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

/*
 * One hand-drawn line icon per group (Brian, 2026-10-29: "more beautiful sort
 * of icons for each of these sections"), every row in a group wearing its
 * group's: the same ring, the same 5-unit round stroke, no text or hanzi, so
 * the set reads as one family in any locale and any font. The row's name
 * tells the rows of a group apart.
 */
const ICON_LINE =
  'fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"';

const GROUP_ICON: Record<XiangqiTrainingTagGroup | 'mix', string> = {
  // Two crossing arrows: everything, shuffled.
  mix: `<path ${ICON_LINE} d="M28 39 H38 C51 39 49 61 62 61 H70 M28 61 H38 C51 61 49 39 62 39 H70 M64 33 L70 39 L64 45 M64 55 L70 61 L64 67"/>`,
  // The palace, its diagonals and the general caught at its centre.
  motif: `<path ${ICON_LINE} d="M32 32 H68 V68 H32 Z M32 32 L68 68 M68 32 L32 68"/><circle cx="50" cy="50" r="8" fill="currentColor"/>`,
  // A sight on the general: forced mate.
  mate: `<circle cx="50" cy="50" r="15" ${ICON_LINE}/><path ${ICON_LINE} d="M50 25 V35 M50 65 V75 M25 50 H35 M65 50 H75"/><circle cx="50" cy="50" r="5" fill="currentColor"/>`,
  // An hourglass: where the game is.
  phase: `<path ${ICON_LINE} d="M36 30 H64 M36 70 H64 M39 30 C39 45 61 53 61 70 M61 30 C61 45 39 53 39 70"/>`,
  // A flag on its pole: what the line wins.
  goal: `<path ${ICON_LINE} d="M37 72 V28 M37 31 C47 25 55 37 66 31 V51 C55 57 47 45 37 51"/>`,
  // Moves along a path to an arrow: how long the line is.
  length: `<path ${ICON_LINE} d="M29 63 L43 49 L56 58 L70 41 M60 40 H71 V51"/><circle cx="29" cy="63" r="4" fill="currentColor"/><circle cx="43" cy="49" r="4" fill="currentColor"/><circle cx="56" cy="58" r="4" fill="currentColor"/>`,
};

const TAG_GROUP = new Map<string, XiangqiTrainingTagGroup>(
  XIANGQI_TRAINING_TAGS.map((tag) => [tag.id, tag.group]),
);

function themeIcon(id: PuzzleThemeId | 'mix'): HTMLElement {
  const group = id === 'mix' ? 'mix' : (TAG_GROUP.get(id) ?? 'motif');
  const icon = document.createElement('span');
  icon.className = 'puzzle-theme-icon';
  icon.dataset.iconGroup = group;
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = `<svg viewBox="0 0 100 100" focusable="false"><circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" stroke-width="2.5"/>${GROUP_ICON[group]}</svg>`;
  return icon;
}

const formatCount = (count: number) => new Intl.NumberFormat('en-US').format(count);

/**
 * One catalogue row, as lichess draws it: the icon, the name with its count
 * after it, the description under. The whole row is the link.
 */
function themeRow(
  key: PuzzleThemeId | 'mix',
  href: string,
  name: string,
  count: number | null,
  description: string,
): HTMLElement {
  const card = document.createElement('article');
  card.className = 'puzzle-theme-entry';
  // The mix is every puzzle, not a theme: it carries no theme-card id.
  if (key !== 'mix') card.dataset.puzzleThemeCard = key;
  const link = document.createElement('a');
  link.className = 'puzzle-theme-entry__link';
  link.href = href;
  const body = document.createElement('span');
  body.className = 'puzzle-theme-body';
  const heading = document.createElement('h3');
  heading.append(name);
  if (count !== null) {
    const counter = document.createElement('span');
    counter.className = 'puzzle-theme-count';
    counter.textContent = formatCount(count);
    counter.title =
      count === 1
        ? t('puzzle.themeCountOne')
        : t('puzzle.themeCount', { count: formatCount(count) });
    heading.append(' ', counter);
  }
  const text = document.createElement('p');
  text.className = 'puzzle-theme-description';
  text.textContent = description;
  // Every locale shows the catalogue's own name: English in en, the hanzi in
  // zh. English copy assumes a reader who reads no Chinese (2026-10-10), so
  // there is no hanzi or pinyin line under an English name.
  body.append(heading, text);
  link.append(themeIcon(key), body);
  card.append(link);
  return card;
}

function themeCard(entry: PuzzleThemeEntry): HTMLElement {
  return themeRow(
    entry.id,
    `/puzzles?theme=${encodeURIComponent(entry.id)}`,
    entry.name,
    entry.count,
    entry.description,
  );
}

/**
 * Every xiangqi puzzle carries exactly one phase tag, so the phases sum to
 * the corpus; null from an older server that sends no tag counts.
 */
export function puzzleThemeTotal(options: PuzzleThemeOptions): number | null {
  const total = XIANGQI_TRAINING_TAGS.filter((tag) => tag.group === 'phase').reduce(
    (sum, tag) => sum + (options.tagCounts[tag.id] ?? 0),
    0,
  );
  return total > 0 ? total : null;
}

/** Lichess's "Recommended" block: one wide row that trains on everything. */
function recommendedSection(options: PuzzleThemeOptions): HTMLElement {
  const section = document.createElement('section');
  section.className = 'puzzle-themes-group puzzle-themes-recommended';
  section.dataset.puzzleThemeRecommended = 'true';
  const heading = document.createElement('h2');
  heading.textContent = t('puzzle.themeGroupRecommended');
  const grid = document.createElement('div');
  grid.className = 'puzzle-themes-grid';
  grid.append(
    themeRow(
      'mix',
      // An empty theme clears a saved one: plain /puzzles reopens the last drill.
      '/puzzles?theme=',
      t('puzzle.themeMixName'),
      puzzleThemeTotal(options),
      t('puzzle.themeMixDesc'),
    ),
  );
  section.append(heading, grid);
  return section;
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
  title.className = 'site-section-heading puzzle-themes-title';
  title.textContent = t('puzzle.themesTitle');
  main.append(title, recommendedSection(options));
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
