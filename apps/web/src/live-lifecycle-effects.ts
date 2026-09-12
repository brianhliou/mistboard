export type LiveLifecycleStatus = 'playing' | 'finished' | 'aborted';

export type LiveLifecycleSnapshot = {
  gameId: string;
  status: LiveLifecycleStatus;
  moveNumber: number;
  ready: boolean;
  seated: boolean;
  isLive: boolean;
  seat: string | null;
  winner: string | null;
};

export type LiveLifecycleEffect = 'start' | 'finish' | 'finish-win' | 'finish-loss' | 'finish-draw';

const EFFECT_CLASSES = [
  'live-lifecycle--start',
  'live-lifecycle--finish',
  'live-lifecycle--finish-win',
  'live-lifecycle--finish-loss',
  'live-lifecycle--finish-draw',
] as const;

export function lifecycleEffectForTransition(
  previous: LiveLifecycleSnapshot | null,
  next: LiveLifecycleSnapshot,
): LiveLifecycleEffect | null {
  if (!next.isLive) return null;

  const sameGame = previous?.gameId === next.gameId;
  const openingReady =
    next.status === 'playing' && next.ready && next.seated && next.moveNumber < 2;
  const justBecameReady = !sameGame || previous.status !== 'playing' || previous.ready === false;
  if (openingReady && justBecameReady) return 'start';

  if (sameGame && previous.status === 'playing' && next.status === 'finished') {
    if (next.winner === null) return 'finish-draw';
    if (!next.seated) return 'finish';
    return next.seated && next.winner === next.seat ? 'finish-win' : 'finish-loss';
  }

  return null;
}

export type LiveLifecycleEffects = {
  update(snapshot: LiveLifecycleSnapshot): LiveLifecycleEffect | null;
  reset(): void;
  destroy(): void;
};

export function createLiveLifecycleEffects(target: HTMLElement): LiveLifecycleEffects {
  let previous: LiveLifecycleSnapshot | null = null;
  let clearTimer: ReturnType<typeof setTimeout> | null = null;
  const emitted = new Set<string>();

  function clearClasses(): void {
    target.classList.remove(...EFFECT_CLASSES);
    delete target.dataset.liveLifecycleEffect;
  }

  function pulse(effect: LiveLifecycleEffect): void {
    if (clearTimer !== null) clearTimeout(clearTimer);
    clearClasses();
    // Restart the CSS animation when a rematch begins before the prior pulse's
    // class has naturally cleared.
    void target.offsetWidth;
    target.classList.add(effect === 'start' ? 'live-lifecycle--start' : 'live-lifecycle--finish');
    if (effect !== 'start' && effect !== 'finish') {
      target.classList.add(`live-lifecycle--${effect}`);
    }
    target.dataset.liveLifecycleEffect = effect;
    clearTimer = setTimeout(
      () => {
        clearTimer = null;
        clearClasses();
      },
      effect === 'start' ? 650 : 850,
    );
  }

  return {
    update(snapshot) {
      const effect = lifecycleEffectForTransition(previous, snapshot);
      previous = snapshot;
      if (!effect) return null;

      const key = `${snapshot.gameId}:${effect.startsWith('finish') ? 'finish' : effect}`;
      if (emitted.has(key)) return null;
      emitted.add(key);
      pulse(effect);
      return effect;
    },
    reset() {
      previous = null;
      emitted.clear();
      if (clearTimer !== null) clearTimeout(clearTimer);
      clearTimer = null;
      clearClasses();
    },
    destroy() {
      if (clearTimer !== null) clearTimeout(clearTimer);
      clearTimer = null;
      clearClasses();
    },
  };
}
