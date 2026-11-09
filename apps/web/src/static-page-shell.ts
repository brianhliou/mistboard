// Shared shell for the /about family of static pages: the left rail and boxed
// content panel. Mirrors lichess's page-menu shell so every page in the set
// shares one rail and one white panel. Used by pages-static.ts, verify-title.ts,
// and the standalone contribute/thanks/lag page modules.

import './static-page-shell.css';

import { ABOUT_NAV_GROUPS } from './about-nav-items.js';
import { t } from './i18n/catalog.js';
import { currentLocale, type Locale, localizedHref } from './i18n/locale.js';

export type StaticPageKey =
  | 'about'
  | 'stats'
  | 'news'
  | 'changelog'
  | 'faq'
  | 'contact'
  | 'patron'
  | 'terms'
  | 'privacy'
  | 'title'
  | 'source'
  | 'contribute'
  | 'creators'
  | 'champions'
  | 'developers'
  | 'apiDocs'
  | 'thanks'
  | 'lag';

export function buildStaticPageLayout(
  activeKey: StaticPageKey,
  content: HTMLElement,
  locale: Locale = currentLocale(),
): HTMLElement {
  const layout = document.createElement('div');
  layout.className = 'static-page-layout';
  const panel = document.createElement('div');
  panel.className = 'static-page-panel';
  panel.append(content);
  layout.append(buildStaticPageRail(activeKey, locale), panel);
  return layout;
}

function buildStaticPageRail(
  activeKey: StaticPageKey,
  locale: Locale = currentLocale(),
): HTMLElement {
  const aside = document.createElement('aside');
  aside.className = 'static-page-rail';

  const nav = document.createElement('nav');
  nav.className = 'static-page-rail-nav';
  nav.setAttribute('aria-label', t('footer.about', {}, locale));

  for (const group of ABOUT_NAV_GROUPS) {
    const list = document.createElement('ul');
    list.className = 'static-page-rail-group';
    for (const item of group) {
      const row = document.createElement('li');
      const link = document.createElement('a');
      link.className = 'static-page-rail-link';
      link.href = localizedHref(item.href, locale);
      link.textContent = t(item.labelKey, {}, locale);
      if (item.key === activeKey) {
        link.classList.add('active');
        link.setAttribute('aria-current', 'page');
      }
      row.append(link);
      list.append(row);
    }
    nav.append(list);
  }

  aside.append(nav);
  observeStaticPageRail(aside, nav);
  return aside;
}

function observeStaticPageRail(rail: HTMLElement, nav: HTMLElement): void {
  const updateFade = () => {
    const maxScroll = rail.scrollWidth - rail.clientWidth;
    // scrollLeft can be fractional, or extend past either edge during bounce.
    rail.classList.toggle('fade-left', maxScroll > 1 && rail.scrollLeft > 1);
    rail.classList.toggle('fade-right', maxScroll > 1 && rail.scrollLeft < maxScroll - 1);
  };
  let revealedCurrent = false;
  const sync = () => {
    // The shell is built before its caller inserts it into the document.
    if (!rail.isConnected || rail.clientWidth === 0) return;
    if (
      !revealedCurrent &&
      window.matchMedia('(max-width: 720px)').matches &&
      rail.scrollWidth > rail.clientWidth + 1
    ) {
      const active = nav.querySelector<HTMLElement>('[aria-current="page"]');
      if (active) {
        const viewport = rail.getBoundingClientRect();
        const link = active.getBoundingClientRect();
        // Move only the strip, with room for the 28px fade beside the tab.
        if (link.right > viewport.right) rail.scrollLeft += link.right - viewport.right + 28;
        else if (link.left < viewport.left) rail.scrollLeft += link.left - viewport.left - 28;
      }
      revealedCurrent = true;
    }
    updateFade();
  };
  rail.addEventListener('scroll', updateFade, { passive: true });
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(sync);
    observer.observe(rail);
    // Font loading and translated labels can resize the content independently.
    observer.observe(nav);
  }
  requestAnimationFrame(sync);
}
