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
import { DEFAULT_STUDY_VARIANT } from './study-catalog.js';
import './game-shell.css';
import './live-xiangqi.css';
import './dark-xiangqi-postgame.css';
import './xiangqi-postgame.css';
import { t } from './i18n/catalog.js';
import { createGameMetaCard } from './review/game-meta-card.js';
import { downloadRow } from './review/underboard-tabs.js';
import { buildXiangqiClientAnalysisSource } from './review/xiangqi-client-analysis.js';
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
};

export function mountBroadcastBoardReview(
  root: HTMLElement,
  data: BroadcastReviewInput,
  opts: { rail?: HTMLElement | null; context?: BroadcastReviewInput['context'] } = {},
): void {
  const context = opts.context ?? data.context ?? null;
  const moves = [...data.timeline].sort((a, b) => a.ply - b.ply).map((entry) => entry.move);
  const replay = buildXiangqiReplayFromMoves(moves);
  const red = playerLabel(data.board.red);
  const black = playerLabel(data.board.black);
  const result = resultOf(data.board.result);
  const eventName = context ? primary(context.tour) : null;
  const roundName = context ? primary(context.round) : null;
  const playedOn = context ? formatEventDateTime(context.round.startsAt) : null;

  document.title = `${red} vs ${black} · ${eventName ?? 'Mistboard'}`;
  root.classList.add('landing-page', 'xiangqi-postgame-route', 'xqb-review-route');

  const metaCard = createGameMetaCard({
    markerId: 'xiangqi',
    glyph: '象',
    headline: [eventName ?? t('broadcast.eyebrow')],
    variantName: 'Xiangqi',
    subline: [roundName, `${t('broadcast.board')} ${data.board.boardNumber}`, playedOn]
      .filter(Boolean)
      .join(' · '),
    players: [
      { color: 'red', name: red },
      { color: 'black', name: black },
    ],
    status: result.label,
  });

  root.replaceChildren(buildNav());
  mountXiangqiReview(root, {
    pageClassName: 'xiangqi-review',
    ariaLabel: t('broadcast.boardAriaLabel'),
    title: `${red} vs ${black}`,
    summary: `${result.label} · ${replay.maxPly} plies`,
    boardAriaLabel: t('broadcast.boardAriaLabel'),
    metaCard: metaCard.el,
    ...(opts.rail ? { details: opts.rail } : {}),
    provenance: provenance(data, context),
    moves,
    players: { red, black },
    result,
    shareExtra: [downloadRow([exportLink(data.board.id)])],
    studyExport: {
      variant: DEFAULT_STUDY_VARIANT,
      name: eventName ? `${red} vs ${black} (${eventName})` : `${red} vs ${black}`,
    },
    // No room and no server sweep behind a relayed game: whole-game analysis is
    // the shared client ceval sweep, the same as an archive game.
    analysis: buildXiangqiClientAnalysisSource(replay),
  });
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
