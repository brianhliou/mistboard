// Phone-only pieces of the homepage (mobile pass #576, #573). Both render on
// every width and stay `display: none` until the phone breakpoint in
// landing.css shows them, so tablet and desktop paint exactly what they did.
//
// - The TV strip: one line over the showcase board naming what it shows
//   ("Live · Mistboard TV · Xiangqi") with a Watch link, since the phone board
//   has no rail around it to say so.
// - The shortcut tiles: the six places a phone visitor goes after playing,
//   under the Play buttons, so they need not open the menu. Each carries a
//   sticker drawing in the broadcast TV's style (home-tile-art.ts).
import { buildHomeTileArt, type HomeTileArt } from './home-tile-art.js';
import { type I18nKey, t } from './i18n/catalog.js';
import { type Locale, localizedHref } from './i18n/locale.js';
import type { LandingTvMode } from './landing-tv.js';
import { navPhoneMediaQuery } from './site-shell.js';

/**
 * Whether the homepage mounts as the phone home: the site header's phone
 * breakpoint, read once at mount. The phone home ends after the blog strip (live
 * event banners and the chat room aside), so the widgets below it are never
 * built there, and never fetch or poll. A page that later crosses 600px keeps
 * the set it mounted with until a reload.
 */
export function isPhoneHome(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(navPhoneMediaQuery).matches
  );
}

export interface LandingTvStrip {
  el: HTMLElement;
  /** Re-label the strip for the game the TV just switched to. */
  update(game: { mode: LandingTvMode; variantLabel: string; watchHref: string }): void;
}

export function buildLandingTvStrip(locale: Locale, watchHref: string): LandingTvStrip {
  const el = document.createElement('div');
  el.className = 'landing-tv-strip';

  const live = document.createElement('span');
  live.className = 'landing-tv-strip-live';
  const dot = document.createElement('span');
  dot.className = 'landing-tv-strip-dot';
  dot.setAttribute('aria-hidden', 'true');
  const liveLabel = document.createElement('span');
  liveLabel.className = 'landing-tv-strip-live-label';
  liveLabel.textContent = t('home.tvLive', {}, locale);
  live.append(dot, liveLabel);
  live.hidden = true;

  const label = document.createElement('span');
  label.className = 'landing-tv-strip-label';
  label.textContent = t('nav.tv', {}, locale);

  const watch = document.createElement('a');
  watch.className = 'landing-tv-strip-watch';
  watch.href = watchHref;
  watch.textContent = t('nav.watch', {}, locale);

  el.append(live, label, watch);

  return {
    el,
    update({ mode, variantLabel, watchHref: href }) {
      const isLive = mode === 'live';
      live.hidden = !isLive;
      el.classList.toggle('is-live', isLive);
      label.textContent = variantLabel
        ? `${t('nav.tv', {}, locale)} · ${variantLabel}`
        : t('nav.tv', {}, locale);
      watch.href = href;
    },
  };
}

export const LANDING_PHONE_TILES: readonly {
  href: string;
  labelKey: I18nKey;
  art: HomeTileArt;
}[] = [
  { href: '/puzzles', labelKey: 'nav.puzzles', art: 'puzzles' },
  { href: '/rules', labelKey: 'nav.rules', art: 'rules' },
  { href: '/study', labelKey: 'nav.studies', art: 'study' },
  { href: '/analysis/xiangqi', labelKey: 'home.tileAnalysis', art: 'analysis' },
  { href: '/forum', labelKey: 'nav.forum', art: 'forum' },
  { href: '/watch', labelKey: 'nav.watch', art: 'watch' },
];

export function buildLandingPhoneTiles(locale: Locale): HTMLElement {
  const nav = document.createElement('nav');
  nav.className = 'landing-phone-tiles';
  nav.setAttribute('aria-label', t('home.phoneTilesAria', {}, locale));
  for (const tile of LANDING_PHONE_TILES) {
    const link = document.createElement('a');
    link.className = 'landing-phone-tile';
    link.href = localizedHref(tile.href, locale);
    const label = document.createElement('span');
    label.className = 'landing-phone-tile-label';
    label.textContent = t(tile.labelKey, {}, locale);
    link.append(buildHomeTileArt(tile.art), label);
    nav.append(link);
  }
  return nav;
}
