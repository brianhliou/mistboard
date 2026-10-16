// The achievement hook points. Writers that finish an event an achievement can
// follow from (recordGameEnd, recordPuzzleAttempt, forum topic and post
// creation) call emitAchievementTrigger after their transaction commits. It is
// a no-op until startServer installs the evaluator, so tests, imports and
// scripts that call the same writers never award anything as a side effect;
// scripts/backfill-achievements.mjs is how those rows earn.
//
// Emitting never blocks or fails the caller: evaluation runs on a later tick,
// and any error is logged and dropped (the next backfill repairs a miss).
//
// onAchievementsAwarded is the slot for the notification step (a toast, a bell
// row, the digest): it receives every award the live path wrote. Nothing is
// installed yet; how an award is announced is an open product question.

import type { AchievementTrigger } from '@mistboard/game';
import type { AchievementEvaluation, NewAchievementAward } from './persistence-achievements.js';

export type AchievementTriggerEvent = {
  trigger: AchievementTrigger;
  userIds: readonly (string | null | undefined)[];
};

export type AchievementEvaluator = (input: {
  trigger: AchievementTrigger;
  userIds: string[];
}) => Promise<AchievementEvaluation>;

export type AchievementsAwardedListener = (awards: NewAchievementAward[]) => void;

type ErrorLogger = (error: unknown, event: AchievementTriggerEvent) => void;

let evaluator: AchievementEvaluator | null = null;
let awardedListener: AchievementsAwardedListener | null = null;
let logError: ErrorLogger = () => {};
const inFlight = new Set<Promise<void>>();

export function installAchievementEvaluator(
  next: AchievementEvaluator | null,
  options: { onError?: ErrorLogger } = {},
): void {
  evaluator = next;
  logError = options.onError ?? (() => {});
}

export function onAchievementsAwarded(listener: AchievementsAwardedListener | null): void {
  awardedListener = listener;
}

export function emitAchievementTrigger(event: AchievementTriggerEvent): void {
  const run = evaluator;
  if (!run) return;
  const userIds = [
    ...new Set(event.userIds.filter((id): id is string => typeof id === 'string' && id !== '')),
  ];
  if (userIds.length === 0) return;
  const task: Promise<void> = Promise.resolve()
    .then(() => run({ trigger: event.trigger, userIds }))
    .then((result) => {
      if (result.newAwards.length > 0) awardedListener?.(result.newAwards);
    })
    .catch((error: unknown) => logError(error, event))
    .finally(() => inFlight.delete(task));
  inFlight.add(task);
}

// Resolves once every evaluation emitted so far has finished (tests, shutdown).
export async function drainAchievementTriggers(): Promise<void> {
  while (inFlight.size > 0) await Promise.all([...inFlight]);
}
