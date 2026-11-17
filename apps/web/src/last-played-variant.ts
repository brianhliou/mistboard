import { type GameSpecId, isGameSpecId } from '@mistboard/game';

const KEY = 'mistboard:last-played-variant';

export function rememberLastPlayedVariant(gameSpecId: string): void {
  try {
    window.localStorage.setItem(KEY, gameSpecId);
  } catch {
    // A blocked or full store must not interrupt play.
  }
}

export function lastPlayedVariant(): GameSpecId | null {
  try {
    const stored = window.localStorage.getItem(KEY);
    return isGameSpecId(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function withLastPlayedFirst<T extends { gameSpecId: string }>(
  specs: T[],
  last: string | null,
): T[] {
  const index = specs.findIndex((spec) => spec.gameSpecId === last);
  if (index <= 0) return specs;
  return [...specs.slice(index, index + 1), ...specs.slice(0, index), ...specs.slice(index + 1)];
}
