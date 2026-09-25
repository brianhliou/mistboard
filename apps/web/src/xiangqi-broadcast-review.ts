// A finished broadcast board on the site's review surface: the same shell an
// archive game gets (engine, advantage chart, the reader's notation, share and
// export, one-click study), with the round's pairings in the left rail so the
// reader can move between boards without leaving. The live board keeps its
// own streaming replay in xiangqi-broadcast.ts; this is what it becomes once
// the result is in.

import type {
  XiangqiBroadcastPlayerTag,
  XiangqiBroadcastResult,
  XiangqiColor,
  XiangqiMove,
} from '@mistboard/game';
import { XIANGQI_SPEC_ID } from '@mistboard/game';
import { variantDisplayLabel } from './game-display.js';
import { DEFAULT_STUDY_VARIANT } from './study-catalog.js';
import {
  type BroadcastPgnInput,
  broadcastGamePgn,
  broadcastPgnFileName,
  pgnDataHref,
} from './xiangqi-broadcast-pgn.js';
import './game-shell.css';
import './live-xiangqi.css';
import './dark-xiangqi-postgame.css';
import './xiangqi-postgame.css';
import { t } from './i18n/catalog.js';
import type { ProfileTarget } from './profile-link.js';
import { fetchCachedGameAnalysis } from './review/game-analysis.js';
import { createGameMetaCard } from './review/game-meta-card.js';
import { downloadRow } from './review/underboard-tabs.js';
import { buildXiangqiClientAnalysisSource } from './review/xiangqi-client-analysis.js';
import type { XiangqiAnalysisSource } from './review/xiangqi-review.js';
import { mountXiangqiReview } from './review/xiangqi-review.js';
import { buildXiangqiReplayFromMoves } from './review/xiangqi-review-model.js';
import { buildNav } from './site-shell.js';
import { formatEventDateTime } from './xiangqi-broadcast-time.js';

export type BroadcastReviewBoard = {
  id: string;
  tourSlug: string;
  roundId: string;
  boardNumber: number;
  red: XiangqiBroadcastPlayerTag;
  black: XiangqiBroadcastPlayerTag;
  result: XiangqiBroadcastResult;
  sourceUrl?: string;
};

export type BroadcastReviewInput = {
  board: BroadcastReviewBoard;
  timeline: Array<{ ply: number; color: XiangqiColor; move: XiangqiMove }>;
  /** Names for the meta card and provenance; the round payload when it loaded. */
  context?: {
    tour: { name: string; nameEn?: string };
    round: { name: string; nameEn?: string; startsAt?: string };
  } | null;
  /** Each side's player page slug, when the player has one (the board API
   *  resolves them against the player index). */
  playerSlugs?: { red: string | null; black: string | null };
};

export function mountBroadcastBoardReview(
  root: HTMLElement,
  data: BroadcastReviewInput,
  opts: {
    rail?: HTMLElement | null;
    context?: BroadcastReviewInput['context'];
    /** Board and moves only, in the event page's content column: the event
     *  header and game list around it already name the event and the result. */
    embedded?: boolean;
  } = {},
): { destroy(): void } {
  const context = opts.context ?? data.context ?? null;
  const moves = [...data.timeline].sort((a, b) => a.ply - b.ply).map((entry) => entry.move);
  const replay = buildXiangqiReplayFromMoves(moves, undefined, { record: true });
  const red = playerLabel(data.board.red);
  const black = playerLabel(data.board.black);
  const result = resultOf(data.board.result);
  const eventName = context ? primary(context.tour) : null;
  const roundName = context ? primary(context.round) : null;
  const playedOn = context ? formatEventDateTime(context.round.startsAt) : null;

  document.title = `${red} vs ${black} · ${eventName ?? 'Mistboard'}`;
  if (!opts.embedded) {
    root.classList.add('landing-page', 'xiangqi-postgame-route', 'xqb-review-route');
  }

  const metaCard = createGameMetaCard({
    markerId: 'xiangqi',
    glyph: '象',
    headline: [eventName ?? t('broadcast.eyebrow')],
    // Lichess's board view names its event as the way back to the boards.
    headlineHref: `/broadcast/xiangqi/${encodeURIComponent(
      data.board.tourSlug,
    )}/round/${encodeURIComponent(data.board.roundId)}`,
    variantName: variantDisplayLabel(XIANGQI_SPEC_ID),
    subline: [roundName, `${t('broadcast.board')} ${data.board.boardNumber}`, playedOn]
      .filter(Boolean)
      .join(' · '),
    // The players are named in the strips above and below the board, the way
    // lichess seats a broadcast game; the card keeps the event and the result.
    status: result.label,
  });
  const slugs = data.playerSlugs;
  const profileFor = (slug: string | null | undefined): ProfileTarget | null =>
    slug ? { kind: 'player', slug } : null;

  // The game as PGN for a creator's own tools (#454), beside the JSON.
  const pgnInput: BroadcastPgnInput = {
    boardId: data.board.id,
    red: data.board.red,
    black: data.board.black,
    result: data.board.result,
    moves: [...data.timeline].sort((a, b) => a.ply - b.ply).map((entry) => entry.move),
    tour: context?.tour ?? null,
    round: context?.round ?? null,
    origin: window.location.origin,
  };
  if (opts.embedded) root.replaceChildren();
  else root.replaceChildren(buildNav());
  return mountXiangqiReview(root, {
    embedded: opts.embedded,
    pageClassName: 'xiangqi-review',
    ariaLabel: t('broadcast.boardAriaLabel'),
    title: `${red} vs ${black}`,
    summary: `${result.label} · ${replay.maxPly} plies`,
    boardAriaLabel: t('broadcast.boardAriaLabel'),
    ...(opts.embedded ? {} : { metaCard: metaCard.el }),
    ...(opts.rail && !opts.embedded ? { details: opts.rail } : {}),
    provenance: provenance(data, context),
    moves,
    record: true,
    players: { red, black },
    seatLabels: true,
    playerProfiles: { red: profileFor(slugs?.red), black: profileFor(slugs?.black) },
    seatDetails: { red: teamOf(data.board.red), black: teamOf(data.board.black) },
    result,
    // A link can name a move (?ply=34), for a creator's video description.
    urlPly: true,
    shareExtra: [
      downloadRow([
        {
          text: 'PGN',
          href: pgnDataHref(broadcastGamePgn(pgnInput)),
          filename: broadcastPgnFileName(pgnInput),
        },
        exportLink(data.board.id),
      ]),
    ],
    studyExport: {
      variant: DEFAULT_STUDY_VARIANT,
      name: eventName ? `${red} vs ${black} (${eventName})` : `${red} vs ${black}`,
    },
    // The server analyses every finished broadcast game once and stores it
    // (xiangqi-broadcast-analysis.ts), so the review opens with the chart and
    // the move marks already there, as a site game's does. Until the sweep
    // reaches a game, the button runs the same sweep in the reader's browser.
    analysis: broadcastAnalysisSource(data.board.id, replay),
  });
}

function broadcastAnalysisSource(
  boardId: string,
  replay: ReturnType<typeof buildXiangqiReplayFromMoves>,
): XiangqiAnalysisSource | null {
  const local = buildXiangqiClientAnalysisSource(replay);
  if (!local) return null;
  return {
    ...local,
    fetchCached: () => fetchCachedGameAnalysis('xiangqi-broadcasts', boardId),
  };
}

function provenance(
  data: BroadcastReviewInput,
  context: BroadcastReviewInput['context'],
): HTMLElement {
  const details = document.createElement('dl');
  details.className = 'review-provenance';
  if (context) {
    addDetail(details, t('broadcast.event'), primary(context.tour), secondary(context.tour));
    addDetail(details, t('broadcast.round'), primary(context.round), secondary(context.round));
    const date = formatEventDateTime(context.round.startsAt);
    if (date) addDetail(details, t('broadcast.date'), date);
  }
  addDetail(details, t('broadcast.board'), String(data.board.boardNumber));
  addDetail(details, t('setup.red'), playerLine(data.board.red));
  addDetail(details, t('setup.black'), playerLine(data.board.black));
  if (data.board.sourceUrl) {
    const dt = document.createElement('dt');
    dt.textContent = t('broadcast.source');
    const dd = document.createElement('dd');
    const link = document.createElement('a');
    link.href = data.board.sourceUrl;
    link.rel = 'noreferrer';
    link.textContent = hostOf(data.board.sourceUrl) ?? data.board.sourceUrl;
    dd.append(link);
    details.append(dt, dd);
  }
  return details;
}

function addDetail(
  details: HTMLElement,
  label: string,
  value: string,
  secondaryValue?: string | null,
): void {
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  dd.textContent =
    secondaryValue && secondaryValue !== value ? `${value} (${secondaryValue})` : value;
  details.append(dt, dd);
}

function primary(entity: { name: string; nameEn?: string }): string {
  return entity.nameEn?.trim() || entity.name;
}

function secondary(entity: { name: string; nameEn?: string }): string | null {
  return entity.nameEn?.trim() && entity.nameEn.trim() !== entity.name ? entity.name : null;
}

/** The player's team, English first, for the strip's muted line. */
function teamOf(player: XiangqiBroadcastPlayerTag): string | undefined {
  return player.federationEn?.trim() || player.federation?.trim() || undefined;
}

function playerLabel(player: XiangqiBroadcastPlayerTag): string {
  const name = primary(player);
  return player.title ? `${player.title} ${name}` : name;
}

function playerLine(player: XiangqiBroadcastPlayerTag): string {
  const zh = secondary(player);
  const team = player.federationEn?.trim() || player.federation;
  return [playerLabel(player), zh ? `(${zh})` : null, team ? `· ${team}` : null]
    .filter(Boolean)
    .join(' ');
}

function resultOf(result: XiangqiBroadcastResult): { score: string; label: string } {
  if (result === '1-0') return { score: '1-0', label: t('broadcast.redWins') };
  if (result === '0-1') return { score: '0-1', label: t('broadcast.blackWins') };
  if (result === '1/2-1/2') return { score: '½-½', label: t('broadcast.draw') };
  return { score: '*', label: t('broadcast.inProgress') };
}

function hostOf(href: string): string | null {
  try {
    return new URL(href).host.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function exportLink(boardId: string): { text: string; href: string; filename: string } {
  return {
    text: 'JSON',
    href: `/api/xiangqi/broadcasts/boards/${encodeURIComponent(boardId)}/export`,
    filename: `mistboard-broadcast-${boardId}.json`,
  };
}
