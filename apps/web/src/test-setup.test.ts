import { expect, it } from 'vitest';

it('can cancel an animation without consuming its finished promise', async () => {
  const target = document.createElement('div');
  const animation = target.animate([{ opacity: 0 }, { opacity: 1 }], 1000);
  animation.cancel();
  expect(animation.playState).toBe('idle');
  // Let an unhandled rejection surface in Vitest if the environment regresses.
  await new Promise((resolve) => setTimeout(resolve, 0));
});

it('still rejects a chained finished promise when an animation is canceled', async () => {
  const target = document.createElement('div');
  const animation = target.animate([{ opacity: 0 }, { opacity: 1 }], 1000);
  const chained = animation.finished.then(() => 'finished');
  animation.cancel();
  await expect(chained).rejects.toMatchObject({ name: 'AbortError' });
});
