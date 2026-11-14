// Decided 2026-11-13: FFQ uses the shared mover-seat luck overlay.
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

export function ffqBanqiDecisionOverlay(body: BanqiDecisionsResponse) {
  const overlay = banqiDecisionOverlay(summarizeDecisions(body.decisions));
  const totals = {
    red: { luck: 0, decisionLoss: 0 },
    black: { luck: 0, decisionLoss: 0 },
  };
  for (const d of body.decisions) {
    totals[d.mover].luck += d.realizedWin - d.playedWin;
    totals[d.mover].decisionLoss += Math.max(0, d.bestWin - d.playedWin);
  }
  return { ...overlay, totals };
}
const url = (roomId: string) => `/api/ffq-banqi/games/${encodeURIComponent(roomId)}/decisions`;
export async function fetchCachedFFQBanqiDecisions(
  roomId: string,
  options: AnalysisJobPollOptions = {},
) {
  const body = await fetchAnalysisJob<BanqiDecisionsResponse>(url(roomId), {
    ...options,
    errorPrefix: 'decisions_request_failed',
  });
  return body ? ffqBanqiDecisionOverlay(body) : null;
}
export async function requestFFQBanqiDecisions(
  roomId: string,
  options: AnalysisJobPollOptions = {},
) {
  return ffqBanqiDecisionOverlay(
    await postAnalysisJob<BanqiDecisionsResponse>(url(roomId), {
      ...options,
      errorPrefix: 'decisions_request_failed',
    }),
  );
}
