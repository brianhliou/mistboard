// Shared LEFT-COLUMN builder for every /game review page. The left rail is a pure
// function of the normalized postgame `game` envelope + the room id, so one helper
// produces the identical lichess-style stack across all variants:
//
//   [marker]  5+0 • Casual • Xiangqi
//             3 days ago
//   ● red player (2203)
//   ○ black player (2166)
//   ────────────────────────────────
//   Black resigned • Red is victorious      ← the caller-supplied `status`
//   ────────────────────────────────
//   Spectator room (buildSpectatorChat)
//
// The board-top/meta-card-top and board-bottom/spectator-bottom alignment is owned
// by the shared review scaffold (review-layout.ts); this module only fills the rail.
//
// `status` (the outcome line) stays caller-supplied because some variants phrase it
// with variant-specific knowledge the envelope doesn't carry — Flip Jungle and Half
// Xiangqi translate the recorded SEAT result into the bound ink via `firstColor`.
// Everything else (time control, casual/rated, time-ago, players, marker, spectator
// room) is plain envelope data and lives here so it can't drift between variants.

import { brandedEngineName } from '../game-display.js';
import { profileTargetFor } from '../profile-link.js';
import type { VariantMiniId } from '../variant-mini-boards.js';
import { seatColorWord } from '../variant-seat-label.js';
import {
  createGameMetaCard,
  type GameMetaPlayer,
  seatResultScores,
  timeAgoLabel,
} from './game-meta-card.js';
import { type ReviewSeatColors, reviewColorForSeat } from './review-seat-colors.js';
import { buildSpectatorChat } from './spectator-chat.js';

/** A persisted postgame participant as the shared `postgameGameSummary` server
 *  builder emits it (see apps/server/src/routes/lib.ts). */
export type ReviewMetaPlayer = {
  color: string;
  name: string;
  rating?: number | null;
  kind?: 'account' | 'guest' | 'engine';
  /** Linkable seat identity, at most one set. `kind` cannot substitute: it
   *  collapses users and bots into 'account'. */
  handle?: string | null;
  botId?: string | null;
};

/** The subset of the postgame `game` envelope the meta card reads. Every variant
 *  that flows through `postgameGameSummary` supplies all of these. */
export type ReviewMetaGame = {
  roomId: string;
  rated?: boolean;
  initialMs?: number | null;
  incrementMs?: number | null;
  /** Some variant envelopes carry the clock nested (`game.timeControl`) instead of
   *  flat `initialMs`/`incrementMs`; the label reads either shape. Kept loose
   *  (`Record`) so callers can pass their whole `game` object without a cast. */
  timeControl?: Record<string, unknown> | null;
  endedAt?: string | null;
  players?: ReviewMetaPlayer[];
  /** Raw seat-keyed result ('red-wins' | 'black-wins' | 'white-wins' | 'draw'),
   *  scored onto the player rows as 1 / 0 / ½. Every postgame envelope carries
   *  it; optional so surfaces that hand-build a partial game object still fit. */
  result?: string | null;
};

export type ReviewMetaConfig = {
  /** Finalized variant marker id (usually === GameSpecId; translate spec →
   *  VariantMiniId before calling where they differ). */
  markerId?: VariantMiniId;
  /** Glyph fallback for variants without a finalized marker. */
  glyph?: string;
  /** Accented trailing headline segment, e.g. 'Xiangqi', 'Flip Jungle'. */
  variantName: string;
  game: ReviewMetaGame;
  /** Outcome line under the divider, e.g. 'Red wins by Checkmate'. Caller-computed
   *  so variant-specific result phrasing (seat→ink) stays with the variant. */
  status: string;
  /** Optional seat→ink binding for flip variants. Player order remains seat
   *  order, but each row's disc uses the color established by the opening flip. */
  seatColors?: ReviewSeatColors;
};

export type ReviewMeta = {
  /** Pass as `metaCard` to mountReviewLayout / createReviewScaffold. */
  metaCard: HTMLElement;
  /** Pass as `details` — the spectator-room panel below the meta card. */
  details: HTMLElement;
};

/** Build the standardized review left column (meta card + spectator room). */
export function buildReviewMeta(config: ReviewMetaConfig): ReviewMeta {
  const { game } = config;
  const card = createGameMetaCard({
    markerId: config.markerId,
    glyph: config.glyph,
    headline: [reviewTimeControlLabel(game), game.rated ? 'Rated' : 'Casual'],
    variantName: config.variantName,
    subline: timeAgoLabel(game.endedAt),
    players: reviewMetaPlayers(game.players, config.seatColors, game.result),
    status: config.status,
  });
  return { metaCard: card.el, details: buildSpectatorChat(game.roomId) };
}

/** Map persisted participants into meta-card player rows (engine → BOT tag).
 *  `result` scores the rows; omit it and they render without numbers. */
export function reviewMetaPlayers(
  players: ReviewMetaPlayer[] | undefined,
  seatColors?: ReviewSeatColors,
  result?: string | null,
): GameMetaPlayer[] {
  const rows = players ?? [];
  // Seat-keyed, so this runs on the persisted `player.color` (the seat) BEFORE
  // reviewColorForSeat maps it to the flipped ink below.
  const scores = seatResultScores(
    result,
    rows.map((player) => player.color),
  );
  return rows.map((player, index) => ({
    color:
      player.color === 'red' || player.color === 'black'
        ? reviewColorForSeat(player.color, seatColors)
        : player.color,
    // The persisted seat name is the engine BUILD ("Misty DXQ 1.1"); the card
    // shows the brand, same as every list surface (see brandedEngineName).
    name: brandedEngineName(player.name) ?? player.name,
    rating: player.rating ?? null,
    // `kind` merges bots into 'account', so a bot seat needs its own tell here or
    // the BOT tag goes missing on every review page that faces one.
    isEngine: player.kind === 'engine' || player.botId != null,
    score: scores[index] ?? null,
    profile: profileTargetFor(player),
  }));
}

/** "5:00+0" / "Untimed" from the envelope's millisecond time control. Reads the
 *  flat `initialMs`/`incrementMs` first, falling back to a nested `timeControl`
 *  object (the shape a few variant envelopes use). */
export function reviewTimeControlLabel(game: {
  initialMs?: number | null;
  incrementMs?: number | null;
  timeControl?: Record<string, unknown> | null;
}): string {
  const nested = (game.timeControl ?? null) as {
    initialMs?: number | null;
    incrementMs?: number | null;
  } | null;
  const initialMs = game.initialMs ?? nested?.initialMs ?? null;
  const incrementMs = game.incrementMs ?? nested?.incrementMs ?? null;
  if (initialMs === null && incrementMs === null) return 'Untimed';
  return `${clockLabel(initialMs ?? 0)}+${Math.round((incrementMs ?? 0) / 1000)}`;
}

/** Generic outcome word for the fixed-color variants (red/black/white + draw).
 *  Pass `variant` so the winning-side word honours the variant's canonical seat
 *  colors (the Jungle family shows "Blue", not "Black"). Variants with
 *  seat-relative results (Flip Jungle, Banqi) compute their own label
 *  from `firstColor` instead. */
export function reviewResultLabel(result: string, variant?: string): string {
  if (result === 'red-wins') return `${seatColorWord(variant, 'red')} wins`;
  if (result === 'black-wins') return `${seatColorWord(variant, 'black')} wins`;
  if (result === 'white-wins') return `${seatColorWord(variant, 'white')} wins`;
  if (result === 'draw') return 'Draw';
  return labelize(result);
}

/** Lichess room-anatomy outcome line, matching the live room meta card
 *  (live-render.ts `renderGameInfo`): "<Reason> • <Winner> is victorious" for a
 *  decisive result, "Draw • <reason>" for a draw. Replaces the ad-hoc
 *  "<Winner> wins by <Reason>" each postgame adapter used to build, so the
 *  postgame page reads the same as the live room. `resultLabel` is the
 *  already-computed "<Color> wins" / "Draw" string (variant- and seat-aware);
 *  `termination` is the raw kebab reason (e.g. 'king-captured'). */
export function reviewOutcomeLine(resultLabel: string, termination: string): string {
  const reason = termination.replace(/-/g, ' ').trim();
  if (/^draw\b/i.test(resultLabel)) {
    return reason ? `Draw • ${reason}` : 'Draw';
  }
  const winner = resultLabel.replace(/\s+wins?\b.*$/i, '').trim() || resultLabel.trim();
  const capped = reason ? `${reason.charAt(0).toUpperCase()}${reason.slice(1)}` : '';
  return capped ? `${capped} • ${winner} is victorious` : `${winner} is victorious`;
}

/** kebab/space token → Title Case, e.g. 'king-captured' → 'King Captured'. */
export function labelize(value: string): string {
  return value
    .split('-')
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function clockLabel(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
