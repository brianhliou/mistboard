// Shared shell for the /about family of static pages: the left rail (about,
// updates, FAQ, contact, support, terms, privacy, title verification, then
// source code / contribute / thank you, then the lag page) and the boxed
// content panel. Mirrors lichess's page-menu shell so every page in the set
// shares one rail and one white panel. Used by pages-static.ts, verify-title.ts,
// and the standalone contribute/thanks/lag page modules.

import './static-page-shell.css';

import { type I18nKey, t } from './i18n/catalog.js';
import { currentLocale, type Locale, localizedHref } from './i18n/locale.js';

export type StaticPageKey =
  | 'about'
  | 'stats'
  | 'news'
  | 'faq'
  | 'contact'
  | 'patron'
  | 'terms'
  | 'privacy'
  | 'title'
  | 'source'
  | 'contribute'
  | 'developers'
  | 'apiDocs'
  | 'thanks'
  | 'lag';

type StaticRailLink = {
  key?: StaticPageKey;
  href: string;
  labelKey: I18nKey;
  external?: boolean;
};

// Grouped like lichess's about menu: the pages a reader browses, then the
// project pages (source / contribute / thanks), then the standalone lag tool.
// GitHub is no longer a rail link of its own — the Source code page carries the
// repository link now.
const STATIC_RAIL_GROUPS: ReadonlyArray<ReadonlyArray<StaticRailLink>> = [
  [
    { key: 'about', href: '/about', labelKey: 'about.heading' },
    { key: 'stats', href: '/stats', labelKey: 'stats.heading' },
    { key: 'news', href: '/feed', labelKey: 'news.feedHeading' },
    { key: 'faq', href: '/faq', labelKey: 'faq.heading' },
    { key: 'contact', href: '/contact', labelKey: 'contact.heading' },
    { key: 'patron', href: '/patron', labelKey: 'patron.heading' },
    { key: 'terms', href: '/terms', labelKey: 'terms.heading' },
    { key: 'privacy', href: '/privacy', labelKey: 'privacy.heading' },
    { key: 'title', href: '/verify-title', labelKey: 'verifyTitle.heading' },
  ],
  [
    { key: 'source', href: '/source', labelKey: 'source.heading' },
    { key: 'contribute', href: '/contribute', labelKey: 'contribute.heading' },
    { key: 'developers', href: '/developers', labelKey: 'developers.heading' },
    { key: 'apiDocs', href: '/api-docs', labelKey: 'apiDocs.heading' },
    { key: 'thanks', href: '/thanks', labelKey: 'thanks.heading' },
  ],
  [{ key: 'lag', href: '/lag', labelKey: 'lag.heading' }],
];

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

  for (const group of STATIC_RAIL_GROUPS) {
    const list = document.createElement('ul');
    list.className = 'static-page-rail-group';
    for (const item of group) {
      const row = document.createElement('li');
      const link = document.createElement('a');
      link.className = 'static-page-rail-link';
      link.href = item.external ? item.href : localizedHref(item.href, locale);
      link.textContent = t(item.labelKey, {}, locale);
      if (item.external) {
        link.target = '_blank';
        link.rel = 'noreferrer noopener';
      }
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
  return aside;
}
