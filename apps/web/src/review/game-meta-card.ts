// Shared game meta card (lichess/playstrategy-style), used by the live room's
// left rail AND the review pages' left rail so both surfaces read identically:
//
//   [glyph]  5+0 • Casual • Xiangqi
//            3 days ago
//   ● red player (2203)            1
//   ○ black player (2166)          0
//   ─────────────────────────────
//   Black resigned • Red is victorious
//
// The trailing score is what makes a finished game readable at a glance: the
// status line names the winning COLOUR, which costs the reader a hop back to the
// discs to work out which name that was.
//
// The card is stateful for the room: setStatus swaps the bottom line between
// pregame / live / finished copy, and setPlayers re-renders the player rows as
// seats fill. Every field is plain data — no variant coupling.

import '../seat-disc-ink.css';
import './game-meta-card.css';
import { t } from '../i18n/catalog.js';
import { type ProfileTarget, playerNameEl } from '../profile-link.js';
import { timeAgo } from '../relative-time.js';
import { renderVariantMarker } from '../variant-markers.js';
import type { VariantMiniId } from '../variant-mini-boards.js';

export type GameMetaPlayer = {
  /**
   * The INK this player renders as (e.g. 'red' | 'black' | 'white') — the colour on
   * the board, NOT the seat id. For most variants the seat name IS the colour, so
   * callers pass the seat straight through. For flip variants (Flip Jungle, banqi)
   * the seat is a move-order slot and the ink binds on the opening flip, so the
   * caller must translate first; passing the raw seat there paints the wrong disc
   * for the half of games that flip the opposite colour. `null` means "not bound
   * yet" (pre-flip) and renders a neutral disc.
   */
  color: string | null;
  name: string;
  rating?: number | null;
  /** Engine/bot seats get a small BOT tag (playstrategy-style). */
  isEngine?: boolean;
  /** Final score for this seat, shown at the end of the row. Omit while the game
   *  is unfinished — a blank row is right there, a wrong number is not. */
  score?: GameMetaScore | null;
  /** Where this name links, or null/absent for a seat with no page (guest,
   *  corpus seat, redacted 'Anonymous'). Built by profile-link.ts from
   *  server-supplied identity — never derived from `name`. */
  profile?: ProfileTarget | null;
};

/** Chess-notation score for one seat: winner, loser, draw. */
export type GameMetaScore = '1' | '0' | '½';

function scoreTitle(score: GameMetaScore): string {
  if (score === '1') return t('result.win');
  if (score === '0') return t('result.loss');
  return t('result.draw');
}

/**
 * Per-seat scores for a finished game, parallel to `seats`.
 *
 * Seat-keyed, not ink-keyed: `result` names the winning SEAT ('red-wins' = the
 * first-mover seat won), so flip variants (Banqi, Flip Jungle) need no
 * firstColor translation here — the seat that won is the seat that won whatever
 * ink it flipped. Only the winning-side WORD needs the ink, and that lives in
 * each variant's result label.
 *
 * Fail-closed: an unfinished, aborted, or unrecognized result — or a winner who
 * is not one of these two seats — scores nobody, so the rows stay bare rather
 * than claiming a loss for both players.
 */
export function seatResultScores(
  result: string | null | undefined,
  seats: readonly (string | null)[],
): (GameMetaScore | null)[] {
  const blank = seats.map(() => null);
  if (seats.length !== 2) return blank;
  if (result === 'draw') return ['½', '½'];
  const winner = /^(.+)-wins$/.exec(result ?? '')?.[1] ?? null;
  if (winner === null || !seats.includes(winner)) return blank;
  return seats.map((seat) => (seat === winner ? '1' : '0'));
}

export type GameMetaCardConfig = {
  /** Finalized variant marker for the icon box (the site-wide icon language:
   *  picker, watch rail, puzzles, profile). Wins over `glyph` when set. */
  markerId?: VariantMiniId;
  /** Variant glyph for the icon box (e.g. '象', '♔', '☗', '虎'). Fallback for
   *  variants without a finalized marker. */
  glyph?: string;
  /** "5+0 • Casual" style segments; falsy segments are skipped. */
  headline: Array<string | null | undefined>;
  /** Makes the headline text a link (a broadcast game's event page). */
  headlineHref?: string;
  /** Accented trailing headline segment (the variant name). */
  variantName?: string;
  /** Subline under the headline (e.g. "3 days ago", "Waiting for opponent"). */
  subline?: string | null;
  players?: GameMetaPlayer[];
  /** Bottom line under the divider (result / status). Hidden when absent. */
  status?: string | null;
};

export type GameMetaCard = {
  el: HTMLElement;
  setSubline(text: string | null): void;
  setPlayers(players: GameMetaPlayer[]): void;
  setStatus(text: string | null): void;
};

// Colors whose player disc renders dark; everything else renders light. Chess
// white/black and xiangqi red/black both map correctly.
const DARK_COLORS = new Set(['black', 'blue']);

// Ink-disc tint. 'red' gets a filled RED disc (so red-vs-black variants — xiangqi,
// jungle, fortress, banqi, jieqi, … — read as red/black, not hollow/black); dark
// inks fill dark; everything else (white) is the hollow light disc. `null` is a
// flip variant before its opening flip: no ink is bound, so tint nothing rather
// than guessing.
function discToneClass(color: string | null): string {
  if (color === null) return 'game-meta-card__disc--unbound';
  if (color === 'red') return 'game-meta-card__disc--red';
  return DARK_COLORS.has(color) ? 'game-meta-card__disc--dark' : 'game-meta-card__disc--light';
}

export function createGameMetaCard(config: GameMetaCardConfig): GameMetaCard {
  const el = document.createElement('section');
  el.className = 'game-meta-card';

  const head = document.createElement('div');
  head.className = 'game-meta-card__head';
  if (config.markerId) {
    const icon = document.createElement('span');
    icon.className = 'game-meta-card__icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = renderVariantMarker(config.markerId, { size: 40 });
    head.append(icon);
  } else if (config.glyph) {
    const icon = document.createElement('span');
    icon.className = 'game-meta-card__icon';
    icon.textContent = config.glyph;
    icon.setAttribute('aria-hidden', 'true');
    head.append(icon);
  }
  const headText = document.createElement('div');
  headText.className = 'game-meta-card__head-text';
  const headline = document.createElement('p');
  headline.className = 'game-meta-card__headline';
  const segments = config.headline.filter((segment): segment is string => Boolean(segment));
  if (config.headlineHref && segments.length > 0) {
    const link = document.createElement('a');
    link.className = 'game-meta-card__headline-link';
    link.href = config.headlineHref;
    link.textContent = segments.join(' • ');
    headline.append(link);
  } else {
    headline.append(document.createTextNode(segments.join(' • ')));
  }
  if (config.variantName) {
    if (segments.length > 0) headline.append(document.createTextNode(' • '));
    const variant = document.createElement('span');
    variant.className = 'game-meta-card__variant';
    variant.textContent = config.variantName;
    headline.append(variant);
  }
  const subline = document.createElement('p');
  subline.className = 'game-meta-card__subline';
  headText.append(headline, subline);
  head.append(headText);

  const playersEl = document.createElement('div');
  playersEl.className = 'game-meta-card__players';

  const statusEl = document.createElement('p');
  statusEl.className = 'game-meta-card__status';

  el.append(head, playersEl, statusEl);

  function setSubline(text: string | null): void {
    subline.textContent = text ?? '';
    subline.hidden = !text;
  }

  function setPlayers(players: GameMetaPlayer[]): void {
    playersEl.replaceChildren();
    playersEl.hidden = players.length === 0;
    for (const player of players) {
      const row = document.createElement('div');
      row.className = 'game-meta-card__player';
      const disc = document.createElement('span');
      disc.className = `game-meta-card__disc ${discToneClass(player.color)}`;
      disc.setAttribute('aria-hidden', 'true');
      row.append(disc);
      if (player.isEngine) {
        const bot = document.createElement('span');
        bot.className = 'game-meta-card__bot';
        bot.textContent = t('watch.botBadge');
        row.append(bot);
      }
      row.append(playerNameEl(player.name, player.profile ?? null, 'game-meta-card__name'));
      if (player.rating !== null && player.rating !== undefined) {
        const rating = document.createElement('span');
        rating.className = 'game-meta-card__rating';
        rating.textContent = `(${player.rating})`;
        row.append(rating);
      }
      if (player.score) {
        const score = document.createElement('span');
        score.className = 'game-meta-card__score';
        score.textContent = player.score;
        // The glyph alone says nothing out loud, and '½' is worse than useless
        // read as a character.
        score.title = scoreTitle(player.score);
        score.setAttribute('aria-label', scoreTitle(player.score));
        row.append(score);
        // Only the winner is marked. A draw scores '½' on both rows, so a
        // won/lost pair of modifiers would have to invent a third state for it.
        if (player.score === '1') row.classList.add('game-meta-card__player--won');
      }
      playersEl.append(row);
    }
  }

  function setStatus(text: string | null): void {
    statusEl.textContent = text ?? '';
    statusEl.hidden = !text;
  }

  setSubline(config.subline ?? null);
  setPlayers(config.players ?? []);
  setStatus(config.status ?? null);

  return { el, setSubline, setPlayers, setStatus };
}

/** "3 days ago" / "3天前" for a past timestamp, in the site locale; empty on bad
 *  input. Intl.RelativeTimeFormat owns the plural rules (see relative-time.ts). */
export function timeAgoLabel(iso: string | null | undefined): string {
  if (!iso) return '';
  if (Number.isNaN(new Date(iso).getTime())) return '';
  return timeAgo(iso);
}
