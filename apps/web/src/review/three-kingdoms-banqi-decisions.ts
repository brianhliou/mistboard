// The Three Kingdoms response shares banqi's mover-seat win% contract and UI.
import { t } from '../i18n/catalog.js';
import {
  type AnalysisJobPollOptions,
  fetchAnalysisJob,
  postAnalysisJob,
} from './analysis-job-poll.js';
import {
  type BanqiDecision,
  type BanqiDecisionsResponse,
  banqiDecisionOverlay,
  summarizeDecisions,
} from './banqi-decisions.js';

/** This engine uses board ranks 1..5, unlike Banqi's 0-based engine UCI. */
export function formatThreeKingdomsBanqiBestMove(uci: string): string {
  if (!/^[a-i][1-5][a-i][1-5]$/.test(uci)) return uci;
  const from = uci.slice(0, 2);
  const to = uci.slice(2);
  return from === to ? t('review.advice.flip', { square: from }) : `${from}-${to}`;
}

export function threeKingdomsBanqiDecisionOverlay(rows: readonly BanqiDecision[]) {
  const overlay = banqiDecisionOverlay(summarizeDecisions(rows));
  for (const info of overlay.byPly.values())
    for (const candidate of info.candidates ?? [])
      if (candidate.uci) candidate.label = formatThreeKingdomsBanqiBestMove(candidate.uci);
  return overlay;
}

function decisionsUrl(roomId: string): string {
  return `/api/three-kingdoms-banqi/games/${encodeURIComponent(roomId)}/decisions`;
}

export async function fetchCachedThreeKingdomsBanqiDecisions(
  roomId: string,
  options: AnalysisJobPollOptions = {},
) {
  const cached = await fetchAnalysisJob<BanqiDecisionsResponse>(decisionsUrl(roomId), {
    ...options,
    errorPrefix: 'decisions_request_failed',
  });
  if (!cached) return null;
  const body = cached;
  return threeKingdomsBanqiDecisionOverlay(body.decisions);
}

export async function requestThreeKingdomsBanqiDecisions(
  roomId: string,
  options: AnalysisJobPollOptions = {},
) {
  const body = await postAnalysisJob<BanqiDecisionsResponse>(decisionsUrl(roomId), {
    ...options,
    errorPrefix: 'decisions_request_failed',
  });
  return threeKingdomsBanqiDecisionOverlay(body.decisions);
}
