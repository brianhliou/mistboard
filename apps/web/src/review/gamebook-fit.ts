// Shared by both lesson players (gamebook + practice), which share gamebook.css.

/**
 * Tell the grid where it starts, so its row ends at the viewport bottom.
 *
 * gamebook.css sizes the row as `100dvh - --gamebook-page-top`, and a fixed
 * guess for that top overran the viewport whenever the chrome above differed:
 * the study header put the grid at 117px against an assumed 88px and the whole
 * page scrolled 37px. Measured after layout, and again on resize because the nav
 * wraps at narrower widths.
 */
export function fitGamebookToViewport(wrap: HTMLElement): void {
  const measure = (): void => {
    if (!wrap.isConnected) {
      window.removeEventListener('resize', measure);
      return;
    }
    const top = wrap.getBoundingClientRect().top + window.scrollY;
    wrap.style.setProperty('--gamebook-page-top', `${Math.round(top)}px`);
  };
  requestAnimationFrame(measure);
  window.addEventListener('resize', measure);
}
