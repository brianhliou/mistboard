/**
 * The puzzles-page sidebar: the current-puzzle info card (identity, source
 * game, side to move, and its themes once solved), the rated toggle + rating
 * summary, and the settings card (variant and theme pickers, the themes page
 * link, auto-next).
 */

import {
  type JunglePuzzleTheme,
  puzzleShortCode,
  XIANGQI_MOTIF_BY_ID,
  XIANGQI_SPEC_ID,
  type XiangqiPuzzleTheme,
} from '@mistboard/game';
import { type I18nKey, t } from '../i18n/catalog.js';
import { currentLocale } from '../i18n/locale.js';
import { seatDiscEl } from '../seat-disc.js';
import { renderVariantMarker } from '../variant-markers.js';
import { colorLabel, type PuzzleSummary } from './adapter.js';
import type { UserPuzzleRating } from './api.js';
import { isPuzzleVariant, type PuzzleVariant, puzzleBoardAdapter } from './registry.js';
import { type PuzzleThemeSettings, puzzleThemePicker, puzzleThemesLink } from './themes.js';

export type QueuePanelProps = {
  queue: readonly PuzzleSummary[];
  selectedId: string | null;
  solvedIds: ReadonlySet<string>;
  variantFilter: PuzzleVariant;
  // Variants surfaced in the Settings variant picker (order = display order).
  variantFilters: readonly PuzzleVariant[];
  theme?: PuzzleThemeSettings;
  // The selected puzzle is over in this visit (solved or its solution shown):
  // its rating, goal and themes are no longer spoilers.
  selectedComplete?: boolean;
  autoNext: boolean;
  ratedEnabled: boolean;
  userRating: UserPuzzleRating | null;
  ratingDelta: number | null;
  // The open puzzle's detail attribution: the list summaries carry no source
  // game, so the "From game" card reads it from here when the ids match.
  selectedSource?: Pick<PuzzleSummary, 'id' | 'sourceGame'> | null;
  onVariantChange: (variant: PuzzleVariant) => Promise<void>;
  onAutoNextChange: (enabled: boolean) => void;
  onRatedChange: (enabled: boolean) => void;
};

export function renderQueuePanel(host: HTMLElement, props: QueuePanelProps): void {
  const {
    queue,
    selectedId,
    solvedIds,
    variantFilter,
    variantFilters,
    selectedComplete = false,
    autoNext,
    ratedEnabled,
    userRating,
    ratingDelta,
    onVariantChange,
    onAutoNextChange,
    onRatedChange,
  } = props;
  host.replaceChildren();

  const currentIndex = Math.max(
    0,
    queue.findIndex((puzzle) => puzzle.id === selectedId),
  );
  const current = withSelectedSource(queue[currentIndex] ?? null, props.selectedSource);
  const solvedCount = queue.filter((puzzle) => solvedIds.has(puzzle.id)).length;
  // Solved before, or finished just now (a reveal counts: the answer is out).
  const revealed =
    current !== null &&
    (solvedIds.has(current.id) || (selectedComplete && current.id === selectedId));

  const infoCard = current
    ? puzzleInfoCard(current, {
        rating: revealed ? current.rating : null,
        status: solvedIds.has(current.id) ? t('puzzle.statusSolved') : t('puzzle.playedLocally'),
        goalRevealed: revealed,
        themes: revealed ? 'shown' : 'hidden',
      })
    : emptyInfoCard(props.theme?.id ? t('puzzle.noneForTheme') : t('puzzle.noneForVariant'));

  // Rated on/off (lichess parity). Off = practice: attempts send rated:false, so
  // neither the user's nor the puzzle's rating moves.
  const ratingCard = document.createElement('section');
  ratingCard.className = `puzzle-left-card puzzle-rating-card${
    ratedEnabled ? ' puzzle-rating-card--enabled' : ' puzzle-rating-card--practice'
  }`;
  const ratedToggle = document.createElement('label');
  ratedToggle.className = 'puzzle-toggle puzzle-rated-toggle';
  const ratedInput = document.createElement('input');
  ratedInput.type = 'checkbox';
  ratedInput.checked = ratedEnabled;
  ratedInput.dataset.puzzleRated = 'true';
  ratedInput.addEventListener('change', () => onRatedChange(ratedInput.checked));
  const ratedSwitch = document.createElement('span');
  ratedSwitch.className = 'puzzle-toggle-switch';
  ratedSwitch.setAttribute('aria-hidden', 'true');
  const ratedName = document.createElement('span');
  ratedName.className = 'puzzle-toggle-label';
  ratedName.textContent = t('puzzle.rated');
  ratedToggle.append(ratedInput, ratedSwitch, ratedName);
  ratingCard.append(ratedToggle);
  if (ratedEnabled) {
    const ratingSummary = document.createElement('div');
    ratingSummary.className = 'puzzle-rating-summary';
    const ratingValue = document.createElement('strong');
    if (userRating) {
      ratingValue.textContent = `${userRating.rating}${userRating.provisional ? '?' : ''}`;
      if (ratingDelta) {
        const delta = document.createElement('span');
        delta.className = `puzzle-rating-delta puzzle-rating-delta--${ratingDelta > 0 ? 'up' : 'down'}`;
        delta.textContent = ` ${ratingDelta > 0 ? '+' : ''}${ratingDelta}`;
        ratingValue.append(delta);
      }
    } else {
      // No rating yet (a guest, or no rated attempt): one quiet line beside the
      // count, not a headline number.
      ratingSummary.classList.add('puzzle-rating-summary--none');
      ratingValue.textContent = t('puzzle.unrated');
    }
    const ratingMeta = document.createElement('span');
    ratingMeta.className = 'puzzle-rating-meta';
    ratingMeta.textContent = t('puzzle.solvedOf', { solved: solvedCount, total: queue.length });
    ratingSummary.append(ratingValue, ratingMeta);
    ratingCard.append(ratingSummary);
  }
  if (!ratedEnabled) {
    const ratedNote = document.createElement('p');
    ratedNote.className = 'puzzle-rated-note';
    ratedNote.textContent = t('puzzle.ratingNote');
    ratingCard.append(ratedNote);
  }

  const settingsCard = document.createElement('section');
  settingsCard.className = 'puzzle-left-card puzzle-settings-card';
  const settingsTitle = document.createElement('h2');
  settingsTitle.textContent = t('puzzle.settings');
  const form = document.createElement('div');
  form.className = 'puzzle-settings';
  // The variant picker only appears when more than one variant is surfaced.
  if (variantFilters.length > 1) {
    const field = document.createElement('label');
    field.className = 'puzzle-field';
    const fieldLabel = document.createElement('span');
    fieldLabel.textContent = t('puzzle.variantField');
    const select = document.createElement('select');
    select.className = 'puzzle-select';
    select.dataset.puzzleVariant = 'true';
    for (const filter of variantFilters) {
      const option = document.createElement('option');
      option.value = filter;
      option.textContent = variantLabel(filter);
      select.append(option);
    }
    select.value = variantFilter;
    select.addEventListener('change', () => {
      void onVariantChange(parseVariantFilter(select.value));
    });
    field.append(fieldLabel, select);
    form.append(field);
  }
  if (props.theme && variantFilter === XIANGQI_SPEC_ID) {
    form.append(puzzleThemePicker(props.theme));
  }
  form.append(puzzleThemesLink());
  const autoNextToggle = document.createElement('label');
  autoNextToggle.className = 'puzzle-toggle';
  const autoNextInput = document.createElement('input');
  autoNextInput.type = 'checkbox';
  autoNextInput.checked = autoNext;
  autoNextInput.dataset.puzzleAutoNext = 'true';
  autoNextInput.addEventListener('change', () => {
    onAutoNextChange(autoNextInput.checked);
  });
  const autoNextSwitch = document.createElement('span');
  autoNextSwitch.className = 'puzzle-toggle-switch';
  autoNextSwitch.setAttribute('aria-hidden', 'true');
  const autoNextLabel = document.createElement('span');
  autoNextLabel.className = 'puzzle-toggle-label';
  autoNextLabel.textContent = t('puzzle.autoNext');
  autoNextToggle.append(autoNextInput, autoNextSwitch, autoNextLabel);
  form.append(autoNextToggle);
  settingsCard.append(settingsTitle, form);

  host.append(infoCard, ratingCard, settingsCard);
}

// The current-puzzle info card (lichess's puzzle__side__metas): the puzzle's
// code linking to its page, the rating (hidden unless `rating` is given), an
// optional status line, then where it came from and who is to move. The goal
// (e.g. "Mate in 1") is a spoiler while solving, so it shows only once
// `goalRevealed`. Puzzle Streak puts the same card over its own. With `themes`
// the card ends in the puzzle's themes row: a spoiler note until the puzzle is
// over ('hidden'), the theme chips after ('shown'). Streak passes none.
export function puzzleInfoCard(
  puzzle: PuzzleSummary,
  opts: {
    rating: number | null;
    status: string | null;
    goalRevealed: boolean;
    themes?: 'hidden' | 'shown';
  },
): HTMLElement {
  const infoCard = document.createElement('section');
  infoCard.className = 'puzzle-left-card puzzle-current-card puzzle-info-card';
  infoCard.append(
    puzzleInfoRow('target', [
      puzzleCodeLine(puzzle),
      puzzleInfoLine(
        opts.rating === null
          ? t('puzzle.ratingHidden')
          : t('puzzle.ratingShown', { rating: opts.rating }),
      ),
      ...(opts.status ? [puzzleInfoLine(opts.status)] : []),
    ]),
    puzzleInfoDivider(),
    puzzleInfoRow(
      'variant',
      [
        // Mined xiangqi puzzles carry attribution for the real game they came
        // from: show a lichess-style "From game" header instead of "From set",
        // linked to the game's page where the server serves it.
        ...sourceGameLines(puzzle),
        puzzleInfoLine(
          opts.goalRevealed
            ? t('puzzle.goalToMove', {
                goal: goalLabel(puzzle),
                color: colorLabel(puzzle.sideToMove),
              })
            : t('puzzle.toMove', { color: colorLabel(puzzle.sideToMove) }),
        ),
      ],
      puzzle.variant,
    ),
  );
  if (opts.themes) infoCard.append(puzzleInfoDivider(), puzzleThemesRow(puzzle, opts.themes));
  return infoCard;
}

// Themes name the piece or pattern (e.g. "Drop", "Treasure"), so the chips
// show only once the puzzle is over; until then the row says when they will.
function puzzleThemesRow(
  puzzle: Pick<PuzzleSummary, 'themes' | 'motifs'>,
  state: 'hidden' | 'shown',
): HTMLElement {
  const row = document.createElement('div');
  row.className = `puzzle-info-themes puzzle-info-themes--${state}`;
  row.dataset.puzzleInfoThemes = state;
  const label = document.createElement('span');
  label.className = 'puzzle-info-themes__label';
  label.textContent = t('puzzle.themesTitle');
  if (state === 'shown') {
    row.append(label, tagsPanel(puzzle));
  } else {
    const note = document.createElement('span');
    note.className = 'puzzle-info-themes__note';
    note.textContent = t('puzzle.themesHidden');
    row.append(label, note);
  }
  return row;
}

function emptyInfoCard(message: string): HTMLElement {
  const infoCard = document.createElement('section');
  infoCard.className = 'puzzle-left-card puzzle-current-card puzzle-info-card';
  const empty = document.createElement('p');
  empty.className = 'puzzle-card-empty';
  empty.textContent = message;
  infoCard.append(empty);
  return infoCard;
}

export function variantLabel(variant: PuzzleVariant): string {
  return t(puzzleBoardAdapter(variant).labelKey);
}

export function parseVariantFilter(value: string): PuzzleVariant {
  return isPuzzleVariant(value) ? value : XIANGQI_SPEC_ID;
}

function puzzleInfoRow(
  icon: 'target' | 'variant',
  lines: readonly HTMLElement[],
  variant?: PuzzleVariant,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'puzzle-info-row';
  const iconEl = document.createElement('span');
  iconEl.className = `puzzle-info-icon puzzle-info-icon--${icon}`;
  iconEl.setAttribute('aria-hidden', 'true');
  iconEl.innerHTML =
    icon === 'target'
      ? targetAvatarSvg()
      : variant
        ? renderVariantMarker(puzzleBoardAdapter(variant).markerId, {
            size: 54,
            label: `${variantLabel(variant)} marker`,
            className: 'puzzle-variant-marker',
          })
        : '';
  const copy = document.createElement('div');
  copy.className = 'puzzle-info-copy';
  copy.append(...lines);
  row.append(iconEl, copy);
  return row;
}

function puzzleInfoLine(text: string): HTMLSpanElement {
  const line = document.createElement('span');
  line.textContent = text;
  return line;
}

// The "From X" header lines for the info card. Mined xiangqi puzzles that carry
// source-game attribution get a lichess-style "From game" header with the event
// and both players; everything else falls back to "From set <variant>".
export function sourceGameLines(
  puzzle: Pick<PuzzleSummary, 'variant' | 'sourceGame'>,
): HTMLElement[] {
  const source = puzzle.sourceGame;
  const hasAttribution =
    puzzle.variant === XIANGQI_SPEC_ID &&
    source !== undefined &&
    (source.event !== undefined ||
      source.redName !== undefined ||
      source.blackName !== undefined ||
      source.attribution !== undefined);
  if (!source || !hasAttribution) {
    return [puzzleInfoLine(t('puzzle.fromSet', { variant: variantLabel(puzzle.variant) }))];
  }
  const lines: HTMLElement[] = [sourceGameHeaderLine(source)];
  if (source.redName !== undefined || source.blackName !== undefined) {
    lines.push(
      sourceGamePlayerLine('red', sourceText(source.redName, source.redNameEn), source.result),
      sourceGamePlayerLine(
        'black',
        sourceText(source.blackName, source.blackNameEn),
        source.result,
      ),
    );
  }
  if (source.attribution) lines.push(sourceCreditLine(source.attribution));
  return lines;
}

/** The list summary with the open puzzle's detail attribution, when it is that puzzle. */
export function withSelectedSource(
  puzzle: PuzzleSummary | null,
  selected: Pick<PuzzleSummary, 'id' | 'sourceGame'> | null | undefined,
): PuzzleSummary | null {
  if (!puzzle || !selected?.sourceGame || selected.id !== puzzle.id) return puzzle;
  return { ...puzzle, sourceGame: selected.sourceGame };
}

// The header, a link to the game's page at the puzzle's move when the server
// says it hosts the game (the same route as historicalXiangqiReviewUrl, not
// imported: that module brings the game search's styles with it).
function sourceGameHeaderLine(source: NonNullable<PuzzleSummary['sourceGame']>): HTMLElement {
  if (!source.hosted) return puzzleInfoLine(sourceGameHeader(source));
  const line = document.createElement('span');
  const link = document.createElement('a');
  link.className = 'puzzle-source-link';
  link.href = `/historical-xiangqi/game/${encodeURIComponent(source.gameId)}?ply=${source.ply}`;
  link.textContent = sourceGameHeader(source);
  link.title = t('puzzle.openSourceGame');
  line.append(link);
  return line;
}

// The credit a source requires (#712; DPXQ asks for a link back to the
// original game, over http). Rendered wherever the "From game" lines are.
function sourceCreditLine(attribution: { name: string; url: string }): HTMLSpanElement {
  const line = document.createElement('span');
  line.className = 'puzzle-source-credit';
  const link = document.createElement('a');
  link.href = attribution.url;
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = attribution.name;
  line.append(t('puzzle.sourceCredit'), link);
  return line;
}

const CJK = /[\p{Script=Han}\u3000-\u303f\uff00-\uffef]/u;

// The archive's event and player strings are Chinese; the server sends an
// English form beside each (the broadcast translators). English pages show
// that form and never the Chinese: with no English form, a Chinese string is
// left out (the line falls back to "From game" or the side's colour). The
// Chinese pages keep the original.
export function sourceText(
  original: string | undefined,
  english: string | undefined,
): string | undefined {
  if (currentLocale() !== 'en') return original;
  if (english && english.length > 0) return english;
  return original && !CJK.test(original) ? original : undefined;
}

// "From game · <event> (<year>)" — event and year are both optional, and the
// year is left off an event name that already says it ("2026 National Xiangqi
// Team Championship", not "... (2026)").
function sourceGameHeader(source: NonNullable<PuzzleSummary['sourceGame']>): string {
  const event = sourceText(source.event, source.eventEn);
  const playedYear = source.playedOn?.slice(0, 4);
  const year = playedYear && !event?.includes(playedYear) ? playedYear : undefined;
  const parts = [event, year ? `(${year})` : undefined].filter(
    (part): part is string => part !== undefined && part.length > 0,
  );
  // No event a reader can read: a plain description ("From a 2025 game").
  if (!event) return year ? t('puzzle.fromGameYear', { year }) : t('puzzle.fromGame');
  return t('puzzle.fromGameWith', { details: parts.join(' ') });
}

// One player row: a color disc, the player name, and a result glyph on the
// side that won (½ on a draw). Names are the raw source-archive strings, the
// game row's where the server holds the game (it replaces the copy stored on
// the puzzle at mine time).
function sourceGamePlayerLine(
  color: 'red' | 'black',
  name: string | undefined,
  result: string | undefined,
): HTMLSpanElement {
  const line = document.createElement('span');
  line.className = 'puzzle-source-player';
  const disc = seatDiscEl(color, 'puzzle-source-disc');
  const label = document.createElement('span');
  label.className = 'puzzle-source-player-name';
  if (name && name.length > 0) {
    // The archive strings carry the team, which crowds out the name in a
    // sidebar line; the name shows and the full string is the tooltip.
    const player = playerWithoutTeam(name);
    label.textContent = player;
    if (player !== name) label.title = name;
  } else {
    label.textContent = color === 'red' ? t('setup.red') : t('setup.black');
  }
  line.append(disc, label);
  const glyph = sourceGameResultGlyph(color, result);
  if (glyph) {
    const outcome = document.createElement('span');
    outcome.className = 'puzzle-source-result';
    outcome.textContent = glyph;
    line.append(outcome);
  }
  return line;
}

const CJK_TEAM_PREFIX = /^[\p{Script=Han}\u3000-\u303f\uff00-\uffef]+\s+(?=\S)/u;

/** The player without the team the archive strings carry: the English form
 *  puts it in a trailing parenthetical ("Xu Wei (Xinjiang Production Team)" →
 *  "Xu Wei"), the Chinese original before the name ("四川 黎德玲" → "黎德玲").
 *  A name with no team, or one that is only a team, is returned as is. */
export function playerWithoutTeam(name: string): string {
  const trimmed = name.trim();
  const open = trimmed.search(/\s*[(（]/u);
  if (open > 0 && /[)）]$/u.test(trimmed)) return trimmed.slice(0, open);
  const prefix = trimmed.match(CJK_TEAM_PREFIX);
  if (prefix) return trimmed.slice(prefix[0].length);
  return name;
}

function sourceGameResultGlyph(color: 'red' | 'black', result: string | undefined): string | null {
  if (result === '1/2-1/2') return '½';
  if (result === '1-0') return color === 'red' ? '1' : null;
  if (result === '0-1') return color === 'black' ? '1' : null;
  return null;
}

function puzzleInfoDivider(): HTMLHRElement {
  const divider = document.createElement('hr');
  divider.className = 'puzzle-info-divider';
  return divider;
}

// Stable, lichess-style puzzle identifier: "Puzzle #bMpKA", where the code is a
// deterministic hash of the puzzle id (unlike the old queue position, which
// shuffled every visit). The code links to the puzzle's canonical full-id URL;
// hand-typing /puzzles/<code> also resolves (see resolveToFullPuzzleId).
export function puzzleCodeLine(puzzle: PuzzleSummary): HTMLSpanElement {
  const line = document.createElement('span');
  line.append(t('puzzle.label'));
  const link = document.createElement('a');
  link.className = 'puzzle-code-link';
  link.href = `/puzzles/${encodeURIComponent(puzzle.id)}`;
  link.dataset.puzzleCode = puzzleShortCode(puzzle.id);
  link.textContent = `#${puzzleShortCode(puzzle.id)}`;
  line.append(link);
  return line;
}

export function tagsPanel(puzzle: Pick<PuzzleSummary, 'themes' | 'motifs'>): HTMLElement {
  const tags = document.createElement('div');
  tags.className = 'puzzle-tags';
  // Named kill patterns lead, under the catalogue's name for the locale: the
  // English name in en, the hanzi in zh (traditional in zh-Hant). English copy
  // assumes a reader who reads no Chinese (2026-10-10), as the themes page does.
  for (const id of puzzle.motifs ?? []) {
    if (!XIANGQI_MOTIF_BY_ID.has(id)) continue;
    const tag = document.createElement('span');
    tag.className = 'puzzle-tag puzzle-tag-motif';
    tag.textContent = t(`puzzle.motifName.${id}` as I18nKey);
    tag.title = t(`puzzle.motifDesc.${id}` as I18nKey);
    tags.append(tag);
  }
  for (const theme of puzzle.themes) {
    const tag = document.createElement('span');
    tag.className = 'puzzle-tag';
    tag.textContent = puzzleThemeLabel(theme);
    tags.append(tag);
  }
  return tags;
}

// The label for every theme a puzzle can carry. A theme that is also a
// training tag shares the themes page's name, so the chip and the page agree.
// Typed over both unions: a theme added to the miner without a label here
// fails the typecheck, and puzzles.test.ts checks every catalogue has it.
export const PUZZLE_THEME_LABEL_KEYS: Record<XiangqiPuzzleTheme | JunglePuzzleTheme, I18nKey> = {
  checkmate: 'puzzle.tagName.checkmate',
  matein1: 'puzzle.tagName.matein1',
  matein2: 'puzzle.tagName.matein2',
  matein3: 'puzzle.tagName.matein3',
  matein4: 'puzzle.tagName.matein4',
  winning: 'puzzle.tagName.winning',
  'winning-material': 'puzzle.themeName.winning-material',
  crushing: 'puzzle.themeName.crushing',
  endgame: 'puzzle.tagName.endgame',
  middlegame: 'puzzle.tagName.middlegame',
  'den-race': 'puzzle.themeName.den-race',
  'capture-all': 'puzzle.themeName.capture-all',
  stalemate: 'puzzle.themeName.stalemate',
  trap: 'puzzle.themeName.trap',
  'water-leap': 'puzzle.themeName.water-leap',
  'rank-up': 'puzzle.themeName.rank-up',
  rat: 'puzzle.themeName.rat',
  elephant: 'puzzle.themeName.elephant',
  lion: 'puzzle.themeName.lion',
  tiger: 'puzzle.themeName.tiger',
};

export function puzzleThemeLabel(theme: string): string {
  const key = (PUZZLE_THEME_LABEL_KEYS as Record<string, I18nKey | undefined>)[theme];
  if (key) return t(key);
  // A theme from a newer server than this client: spell it out readably.
  return theme
    .split('-')
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ');
}

export function goalLabel(puzzle: Pick<PuzzleSummary, 'goal' | 'solutionPlyCount'>): string {
  if (puzzle.goal.type === 'checkmate') {
    return t('puzzle.mateIn', { count: Math.ceil(puzzle.solutionPlyCount / 2) });
  }
  if (puzzle.goal.type === 'win') {
    return t('puzzle.winIn', { count: Math.ceil(puzzle.solutionPlyCount / 2) });
  }
  return t('puzzle.winning');
}

function targetAvatarSvg(): string {
  // Lucide `target` (24-grid, 2px round), consistent with the app's other inlined
  // Lucide icons (see landing-play.ts). Plain concentric bullseye, no arrow.
  return [
    '<svg class="puzzle-target-avatar" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">',
    '<circle cx="12" cy="12" r="10"/>',
    '<circle cx="12" cy="12" r="6"/>',
    '<circle cx="12" cy="12" r="2"/>',
    '</svg>',
  ].join('');
}
