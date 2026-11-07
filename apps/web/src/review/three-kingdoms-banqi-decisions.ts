// The Three Kingdoms response shares banqi's mover-seat win% contract and UI.
import { postAnalysisJob } from './analysis-job-poll.js';
import {
  type BanqiDecisionsResponse,
  banqiDecisionOverlay,
  summarizeDecisions,
} from './banqi-decisions.js';

function decisionsUrl(roomId: string): string {
  return `/api/three-kingdoms-banqi/games/${encodeURIComponent(roomId)}/decisions`;
}

export async function fetchCachedThreeKingdomsBanqiDecisions(roomId: string) {
  const response = await fetch(decisionsUrl(roomId), { method: 'GET' });
  if (response.status === 204 || !response.ok) return null;
  const body = (await response.json()) as BanqiDecisionsResponse;
  return banqiDecisionOverlay(summarizeDecisions(body.decisions));
}

export async function requestThreeKingdomsBanqiDecisions(roomId: string) {
  const body = await postAnalysisJob<BanqiDecisionsResponse>(decisionsUrl(roomId), {
    errorPrefix: 'decisions_request_failed',
  });
  return banqiDecisionOverlay(summarizeDecisions(body.decisions));
}
