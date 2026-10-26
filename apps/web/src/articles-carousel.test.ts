// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { initLandingCarousel } from './articles.js';

// happy-dom has no layout, so the geometry the carousel reads is stubbed: cards
// at a fixed pitch inside a narrower window, as on the desktop band-2 rows
// where 210px cards leave part of the next card in view.
function carousel(cardCount: number, cardPx: number, gapPx: number, viewPx: number) {
  const root = document.createElement('div');
  root.innerHTML = `<div class="landing-carousel"><div class="landing-carousel-track"></div>
    <button class="landing-carousel-nav-prev"></button><button class="landing-carousel-nav-next"></button></div>`;
  const car = root.querySelector<HTMLElement>('.landing-carousel')!;
  const track = root.querySelector<HTMLElement>('.landing-carousel-track')!;
  for (let i = 0; i < cardCount; i++) {
    const card = document.createElement('a');
    const left = i * (cardPx + gapPx);
    card.getBoundingClientRect = () => ({ left, width: cardPx }) as DOMRect;
    track.append(card);
  }
  Object.defineProperty(track, 'scrollWidth', {
    value: cardCount * cardPx + (cardCount - 1) * gapPx,
  });
  Object.defineProperty(car, 'clientWidth', { value: viewPx });
  document.body.append(root);
  initLandingCarousel(root);
  const next = root.querySelector<HTMLButtonElement>('.landing-carousel-nav-next')!;
  const offset = () => -Number(/translateX\((-?[\d.]+)px\)/.exec(track.style.transform)?.[1] ?? 0);
  return { next, offset };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('landing carousel with a part card in view', () => {
  it('stops with the last card flush right, never past it', () => {
    // 1280px window: six 210px cards, 8px gap, 515px view. Overflow 785px is
    // 3.6 steps of 218px; rounding gave 4 steps (872px), 87px of blank track.
    const { next, offset } = carousel(6, 210, 8, 515);
    const stops: number[] = [];
    for (let i = 0; i < 6; i++) {
      next.click();
      stops.push(offset());
    }
    expect(stops).toEqual([218, 436, 654, 785, 785, 785]);
    expect(next.disabled).toBe(true);
  });

  it('still steps whole cards when the view holds a whole number of them', () => {
    const { next, offset } = carousel(6, 210, 8, 646);
    const stops: number[] = [];
    for (let i = 0; i < 4; i++) {
      next.click();
      stops.push(offset());
    }
    expect(stops).toEqual([218, 436, 654, 654]);
  });
});
