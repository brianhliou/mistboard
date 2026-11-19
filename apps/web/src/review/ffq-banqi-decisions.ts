// Decided 2026-11-13: FFQ uses the shared mover-seat luck overlay.

import { ffqBanqiSquare } from '../ffq-banqi-board.js';
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
import { formatFlipVariantBestMove } from './move-advice-text.js';

export function parseFFQBanqiEngineMove(uci: string) {
  if (!/^[a-d][0-7][a-d][0-7]$/.test(uci)) return null;
  const square = (s: string) => ffqBanqiSquare(Number(s[1]) * 4 + s.charCodeAt(0) - 97);
  return { from: square(uci.slice(0, 2)), to: square(uci.slice(2)) };
}

export function formatFFQBanqiBestMove(uci: string): string {
  const move = parseFFQBanqiEngineMove(uci);
  if (!move) return uci;
  // The shared formatter takes Banqi's zero-based engine ranks.
  const engineSquare = (s: string) => `${s[0]}${Number(s[1]) - 1}`;
  return formatFlipVariantBestMove(engineSquare(move.from) + engineSquare(move.to));
}

export function ffqBanqiDecisionOverlay(body: BanqiDecisionsResponse) {
  const overlay = banqiDecisionOverlay(summarizeDecisions(body.decisions));
  for (const info of overlay.byPly.values())
    for (const candidate of info.candidates ?? []) {
      if (candidate.uci) candidate.label = formatFFQBanqiBestMove(candidate.uci);
    }
  return overlay;
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
