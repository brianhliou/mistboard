// A "more below" fade for a box that scrolls inside the page: the class is on
// only while the box overflows and is not scrolled to its end, so the fade
// says "scroll for more" and goes away once there is nothing more. The look
// is the `--site-scroll-fade` mask (app-base.css), the News box's.

type ScrollBox = Pick<HTMLElement, 'scrollTop' | 'scrollHeight' | 'clientHeight'>;

/** True while content sits below the visible part of the box. */
export function hasMoreBelow(box: ScrollBox): boolean {
  // A pixel of slack: a fractional height cannot scroll its last fraction.
  return box.scrollHeight - box.clientHeight - box.scrollTop > 1;
}

/**
 * Toggles `className` on `box` with `hasMoreBelow`, on scroll and whenever the
 * box changes size. Stops observing once the box has left the page.
 */
export function bindScrollFade(box: HTMLElement, className: string): void {
  const update = (): void => {
    box.classList.toggle(className, hasMoreBelow(box));
  };
  box.addEventListener('scroll', update, { passive: true });
  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(() => {
      if (!box.isConnected) {
        observer.disconnect();
        return;
      }
      update();
    });
    observer.observe(box);
  }
  // Built before it is attached: measure once it is on the page.
  if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(update);
  else update();
}
