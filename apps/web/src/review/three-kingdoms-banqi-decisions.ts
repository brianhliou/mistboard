// The Three Kingdoms response shares banqi's mover-seat win% contract and UI.
import {
  type AnalysisJobPollOptions,
  fetchAnalysisJob,
  postAnalysisJob,
} from './analysis-job-poll.js';
import {
  type BanqiDecisionsResponse,
  banqiDecisionOverlay,
  summarizeDecisions,
} from './banqi-decisions.js';

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
  return banqiDecisionOverlay(summarizeDecisions(body.decisions));
}

export async function requestThreeKingdomsBanqiDecisions(
  roomId: string,
  options: AnalysisJobPollOptions = {},
) {
  const body = await postAnalysisJob<BanqiDecisionsResponse>(decisionsUrl(roomId), {
    ...options,
    errorPrefix: 'decisions_request_failed',
  });
  return banqiDecisionOverlay(summarizeDecisions(body.decisions));
}
