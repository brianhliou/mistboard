// Numeric-only observation of the current queued computation. Checkpoint items
// (which can contain hidden information) never cross this seam.
import { AsyncLocalStorage } from 'node:async_hooks';

export type AnalysisJobProgress = {
  phase: 'analysis' | 'decisions';
  completed: number;
  total: number;
};
const context = new AsyncLocalStorage<(update: Partial<AnalysisJobProgress>) => void>();
export function withAnalysisJobProgress<T>(
  update: (progress: Partial<AnalysisJobProgress>) => void,
  run: () => Promise<T>,
): Promise<T> {
  return context.run(update, run);
}
export function reportAnalysisJobProgress(update: Partial<AnalysisJobProgress>): void {
  context.getStore()?.(update);
}
