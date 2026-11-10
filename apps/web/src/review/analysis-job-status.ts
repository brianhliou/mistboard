import { t } from '../i18n/catalog.js';
import type { AnalysisJobStatus } from './analysis-job-poll.js';

export function analysisJobLabel(status: AnalysisJobStatus, decisions = false): string {
  if (status.state === 'queued')
    return t(decisions ? 'replay.revealsQueued' : 'replay.analysisQueued');
  const progress = status.progress;
  if (
    progress &&
    Number.isSafeInteger(progress.completed) &&
    Number.isSafeInteger(progress.total) &&
    progress.total > 0 &&
    progress.completed >= 0 &&
    progress.completed <= progress.total
  )
    return t(
      progress.phase === 'decisions' ? 'replay.revealsProgress' : 'replay.positionsProgress',
      { done: progress.completed, total: progress.total },
    );
  return t(decisions ? 'replay.analysingReveals' : 'replay.analysingWholeGame');
}
export function analysisJobFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (message.endsWith('_404')) return t('replay.analysisJobLost');
  if (message.endsWith('_analysis_failed')) return t('replay.analysisCouldNotFinish');
  if (message.includes('analysis_engine_unavailable')) return t('replay.analysisEngineUnavailable');
  return t('replay.analysisConnectionLost');
}
