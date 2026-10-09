// A study whose chapters are whole games (an import of one player's run, a
// tournament, a match) lays its rail out from the chapters' PGN tags rather
// than from each chapter's name. The name an import writes is one string,
// "2022-10-24 · Tony Fung Ga Zen vs Calvin Tay Yelin · 1-0", which the rail
// wrapped to two lines a row and which said nothing about whose result it was.
//
// Everything here reads the tags the chapter already stores; nothing is
// written back, so every existing study gets it and a study without tags keeps
// its plain rows.

import { translateXiangqiEventNameStrict } from '@mistboard/game';
import { t } from './i18n/catalog.js';
import { currentLocale, type Locale } from './i18n/locale.js';
import { localizedChapterTags } from './study-i18n.js';

export type GameChapterTags = {
  red?: string;
  black?: string;
  result?: string;
  event?: string;
  date?: string;
  round?: string;
  site?: string;
};

export type GameChapter = {
  id: string;
  i18n?: unknown;
  tags?: GameChapterTags;
};

export type GameOutcome = 'red' | 'black' | 'draw';

/**
 * An event name for the reader's locale.
 *
 * Imports from Chinese sources store the event in Chinese, and an English page
 * printed "Event 2022年第17届世界象棋锦标赛". Translated here, at render time, so
 * every existing study is covered with no migration and the stored original
 * stays what a Chinese reader sees. A name the glossary cannot fully account
 * for stays as it was: a half-translated name is worse than the original.
 */
export function displayEventName(event: string, locale: Locale = currentLocale()): string {
  if (locale !== 'en') return event;
  return translateXiangqiEventNameStrict(event) ?? event;
}

/** Who won, from a PGN result: `1-0`, `0-1`, `1/2-1/2` (or `½-½`). */
export function gameOutcome(result: string | undefined): GameOutcome | null {
  const value = result?.trim().replace(/\s+/g, '');
  if (!value) return null;
  if (value === '1-0') return 'red';
  if (value === '0-1') return 'black';
  if (value === '1/2-1/2' || value === '½-½' || value === '0.5-0.5') return 'draw';
  return null;
}

/** The result as the chip prints it. */
export function resultLabel(outcome: GameOutcome): string {
  return outcome === 'red' ? '1-0' : outcome === 'black' ? '0-1' : '½-½';
}

/** A chapter that is a game: both players named. */
export function isGameChapter(chapter: GameChapter): boolean {
  return Boolean(chapter.tags?.red?.trim() && chapter.tags?.black?.trim());
}

/**
 * The player the study is about: the one name that sits in every game
 * chapter. Needs at least two games (in one game both players qualify) and
 * exactly one such name (a match between two people has two, and neither is
 * the study's subject). Compared on the stored names, which is what an import
 * writes once per player.
 */
export function studyFocusPlayer(chapters: readonly GameChapter[]): string | null {
  const games = chapters.filter(isGameChapter);
  if (games.length < 2) return null;
  const first = games[0]!.tags!;
  const candidates = [first.red!.trim(), first.black!.trim()].filter(
    (name) =>
      name.length > 0 &&
      games.every((chapter) => {
        const tags = chapter.tags!;
        return tags.red?.trim() === name || tags.black?.trim() === name;
      }),
  );
  const unique = [...new Set(candidates)];
  return unique.length === 1 ? unique[0]! : null;
}

/** The focus player's side of one game: win, draw or loss; null if unknown. */
export function focusResult(chapter: GameChapter, focus: string): 'win' | 'draw' | 'loss' | null {
  const outcome = gameOutcome(chapter.tags?.result);
  if (!outcome) return null;
  if (outcome === 'draw') return 'draw';
  const side =
    chapter.tags?.red?.trim() === focus
      ? 'red'
      : chapter.tags?.black?.trim() === focus
        ? 'black'
        : null;
  if (!side) return null;
  return outcome === side ? 'win' : 'loss';
}

export type FocusScore = { games: number; wins: number; draws: number; losses: number };

export function focusScore(chapters: readonly GameChapter[], focus: string): FocusScore {
  const score: FocusScore = { games: 0, wins: 0, draws: 0, losses: 0 };
  for (const chapter of chapters) {
    if (!isGameChapter(chapter)) continue;
    score.games += 1;
    const result = focusResult(chapter, focus);
    if (result === 'win') score.wins += 1;
    else if (result === 'draw') score.draws += 1;
    else if (result === 'loss') score.losses += 1;
  }
  return score;
}

/** A tag date as a UTC Date, or null for a partial one (`2022.??.??`). */
export function parseTagDate(value: string | undefined): Date | null {
  const match = value?.trim().match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

function intlLocale(locale: Locale): string {
  return locale === 'en' ? 'en-US' : locale;
}

/** "Oct 24, 2022" (en), "2022年10月24日" (zh); an unparsable date as written. */
export function shortGameDate(value: string, locale: Locale = currentLocale()): string {
  const date = parseTagDate(value);
  if (!date) return value;
  return new Intl.DateTimeFormat(intlLocale(locale), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function monthYear(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    year: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(date);
}

/**
 * One line under the study title, from the tags: "47 games · Oct 2022 to Sep
 * 2026 · Tony Fung Ga Zen +20 =17 -10". Only for a study with a focus player;
 * the score is from that player's side.
 */
export function studyGamesSummary(
  chapters: readonly GameChapter[],
  locale: Locale = currentLocale(),
): string | null {
  const focus = studyFocusPlayer(chapters);
  if (!focus) return null;
  const games = chapters.filter(isGameChapter);
  const score = focusScore(games, focus);
  const parts = [t('study.gamesSummaryGames', { count: score.games }, locale)];
  const dates = games
    .map((chapter) => parseTagDate(chapter.tags?.date))
    .filter((date): date is Date => date !== null)
    .sort((a, b) => a.getTime() - b.getTime());
  if (dates.length > 0) {
    const from = monthYear(dates[0]!, locale);
    const to = monthYear(dates[dates.length - 1]!, locale);
    parts.push(from === to ? from : t('study.gamesSummaryRange', { from, to }, locale));
  }
  // The name as the reader's locale writes it (冯家俊 on a Chinese page).
  const first = games[0]!;
  const localized = localizedChapterTags(first.tags!, first.i18n, locale);
  const named = first.tags!.red?.trim() === focus ? localized.red : localized.black;
  parts.push(
    t(
      'study.gamesSummaryScore',
      {
        name: named ?? focus,
        wins: score.wins,
        draws: score.draws,
        losses: score.losses,
      },
      locale,
    ),
  );
  return parts.join(' · ');
}

/**
 * Group headers for the rail: the chapter id that opens each run of one event,
 * mapped to the event's display name. Empty unless the games span more than
 * one event (a single-event study would repeat its own title).
 */
export function chapterEventGroups(
  chapters: readonly GameChapter[],
  locale: Locale = currentLocale(),
): Map<string, string> {
  const groups = new Map<string, string>();
  const games = chapters.filter(isGameChapter);
  const events = new Set(games.map((chapter) => chapter.tags?.event?.trim() ?? ''));
  if (events.size < 2) return groups;
  let previous: string | undefined;
  for (const chapter of chapters) {
    if (!isGameChapter(chapter)) continue;
    const event = chapter.tags?.event?.trim() ?? '';
    if (event !== previous && event) {
      const localized = localizedChapterTags(chapter.tags!, chapter.i18n, locale).event ?? event;
      groups.set(chapter.id, displayEventName(localized, locale));
    }
    previous = event;
  }
  return groups;
}

/**
 * The rail row for a game chapter: "Red vs Black" with the winner in a
 * stronger weight, the date (and round) under it, and a result chip. With a
 * focus player the chip is coloured from that player's side; otherwise it is
 * neutral. Null for a chapter that is not a game, which keeps its name.
 */
export function buildChapterGameRow(
  chapter: GameChapter,
  focus: string | null,
  locale: Locale = currentLocale(),
): HTMLElement | null {
  if (!isGameChapter(chapter)) return null;
  const tags = localizedChapterTags(chapter.tags!, chapter.i18n, locale);
  const outcome = gameOutcome(tags.result);

  const row = document.createElement('span');
  row.className = 'study-game-line';
  const text = document.createElement('span');
  text.className = 'study-game-line__text';

  const players = document.createElement('span');
  players.className = 'study-game-line__players';
  const player = (name: string, won: boolean): HTMLElement => {
    const el = document.createElement('span');
    el.className = 'study-game-line__player';
    if (won) el.classList.add('is-winner');
    el.textContent = name;
    return el;
  };
  players.append(
    player(tags.red!, outcome === 'red'),
    ` ${t('study.gameVs', {}, locale)} `,
    player(tags.black!, outcome === 'black'),
  );
  text.append(players);

  const meta: string[] = [];
  if (tags.date?.trim()) meta.push(shortGameDate(tags.date, locale));
  const round = tags.round?.trim();
  if (round && round !== '?' && round !== '-') {
    const n = round.match(/^\d+$/)?.[0];
    meta.push(n ? t('study.rowRound', { n }, locale) : round);
  }
  if (meta.length > 0) {
    const sub = document.createElement('span');
    sub.className = 'study-game-line__meta';
    sub.textContent = meta.join(' · ');
    text.append(sub);
  }
  row.append(text);

  if (outcome) {
    const chip = document.createElement('span');
    chip.className = 'study-game-line__result';
    const side = focus ? focusResult(chapter, focus) : null;
    chip.dataset.outcome = side ?? 'neutral';
    chip.textContent = resultLabel(outcome);
    row.append(chip);
  }
  return row;
}
