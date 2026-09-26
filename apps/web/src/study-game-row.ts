// A chapter row built from the game it came from, for a study whose chapters are
// positions from real games ("decisive moments"). The chapter NAME there is a
// sentence ("Move 21, Black to play · Gu Bowen vs Jiang Mingcheng") that a
// one-line rail cut down to "Move 21, Black to play · Gu Bowen vs…", losing the
// half that tells the rows apart. The chapter's PGN tags already hold the parts,
// so the row shows the players with the side to move marked, and the coach's
// game card (gameCoachContext) carries the event, round, date and result.

import { t } from './i18n/catalog.js';
import { currentLocale, type Locale } from './i18n/locale.js';
import { localizedChapterTags } from './study-i18n.js';

export type GameRowChapter = {
  orientation: string;
  i18n?: unknown;
  root?: { rootFen?: string | null } | null;
  tags?: { red?: string; black?: string; event?: string; round?: string };
};

export type GameRowParts = {
  red: string;
  black: string;
  toMove: 'red' | 'black';
};

/**
 * The row's parts, or null when the chapter is not a game position (no players
 * on both sides), in which case the rail keeps the plain name.
 *
 * Side to move comes from the chapter's start FEN, the position the learner is
 * handed; the orientation (the side they play) is the fallback for a chapter
 * without one.
 */
export function gameRowParts(
  chapter: GameRowChapter,
  locale: Locale = currentLocale(),
): GameRowParts | null {
  const base = chapter.tags;
  if (!base?.red || !base.black) return null;
  const tags = localizedChapterTags(base, chapter.i18n, locale);
  const side = chapter.root?.rootFen?.trim().split(/\s+/)[1];
  const toMove =
    side === 'b'
      ? 'black'
      : side === 'w' || side === 'r'
        ? 'red'
        : chapter.orientation === 'black'
          ? 'black'
          : 'red';
  return { red: tags.red!, black: tags.black!, toMove };
}

/** The event without its leading year: every chapter in a season shares it. */
export function shortEvent(event: string): string {
  return event.replace(/^\d{4}\s*年?\s*/, '').trim() || event;
}

/** The label that replaces the name span in a rail row. */
export function buildGameRowLabel(parts: GameRowParts): HTMLElement {
  const label = document.createElement('span');
  label.className = 'study-game-row';
  const players = document.createElement('span');
  players.className = 'study-game-row__players';
  players.append(player(parts.red, 'red', parts.toMove === 'red'), ' – ');
  players.append(player(parts.black, 'black', parts.toMove === 'black'));
  label.append(players);
  return label;
}

function player(name: string, seat: 'red' | 'black', toMove: boolean): HTMLElement {
  const el = document.createElement('span');
  el.className = `study-game-row__player study-game-row__player--${seat}`;
  if (toMove) {
    el.classList.add('is-to-move');
    // Decorative: the link's title carries "Black to play" in words.
    const dot = document.createElement('span');
    dot.className = `study-game-row__dot study-game-row__dot--${seat}`;
    dot.setAttribute('aria-hidden', 'true');
    el.append(dot);
  }
  el.append(name);
  return el;
}

/**
 * The coach's game card: players, then event, round, date and result. The rail
 * row shows only the players; the rest is read once, beside the position.
 */
export function gameCoachContext(
  chapter: GameRowChapter & { tags?: { date?: string; result?: string } },
  locale: Locale = currentLocale(),
): { players: string; detail: string } | null {
  const base = chapter.tags;
  if (!base?.red || !base.black) return null;
  const tags = localizedChapterTags(base, chapter.i18n, locale);
  const detail: string[] = [];
  if (tags.event) detail.push(shortEvent(tags.event));
  const round = tags.round?.match(/(\d+)/)?.[1];
  if (round) detail.push(t('study.rowRound', { n: round }, locale));
  else if (tags.round) detail.push(tags.round);
  if (tags.date) detail.push(tags.date);
  if (tags.result && tags.result !== '*') detail.push(tags.result);
  return { players: `${tags.red} – ${tags.black}`, detail: detail.join(' · ') };
}
