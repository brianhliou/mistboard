// About rail navigation reuses the real page mounts, including their forms and
// live data. Prepare them in a hidden, connected root (the lag poller requires
// connectivity), then move just the panel into the existing shell.
import { ABOUT_NAV_GROUPS } from './about-nav-items.js';
import { track } from './analytics.js';
import { t } from './i18n/catalog.js';
import { currentLocale, localizedHref } from './i18n/locale.js';
import { SHELL_TITLE } from './server-render-fallback.js';

type RailItem = (typeof ABOUT_NAV_GROUPS)[number][number];
type RailPage = Exclude<RailItem, { readonly leavesRail: true }>;
type RailKey = RailPage['key'];
type Mount = (root: HTMLElement) => void | Promise<void>;

const mounts = {
  about: () => import('./pages-static.js').then((m) => m.mountAbout),
  stats: () =>
    import('./metrics.js').then(
      (m) => (root: HTMLElement) => m.mountMetrics(root, { admin: false }),
    ),
  news: () => import('./pages-static.js').then((m) => m.mountNews),
  changelog: () => import('./changelog-page.js').then((m) => m.mountChangelog),
  faq: () => import('./pages-static.js').then((m) => m.mountFaq),
  contact: () => import('./pages-static.js').then((m) => m.mountContact),
  lag: () => import('./lag-page.js').then((m) => m.mountLag),
  title: () => import('./verify-title.js').then((m) => m.mountVerifyTitle),
  terms: () => import('./pages-static.js').then((m) => m.mountTerms),
  privacy: () => import('./pages-static.js').then((m) => m.mountPrivacy),
  source: () => import('./pages-static.js').then((m) => m.mountSource),
  contribute: () => import('./contribute-page.js').then((m) => m.mountContribute),
  creators: () => import('./creators-page.js').then((m) => m.mountCreators),
  champions: () => import('./champions-page.js').then((m) => m.mountChampions),
  developers: () => import('./developers-page.js').then((m) => m.mountDevelopers),
  apiDocs: () => import('./api-docs-page.js').then((m) => m.mountApiDocs),
  thanks: () => import('./thanks-page.js').then((m) => m.mountThanks),
} satisfies Record<RailKey, () => Promise<Mount>>;

function railItem(pathname: string): RailPage | null {
  // Archive pages also have the rail and must remain reachable with Back.
  const path = pathname
    .replace(/^\/zh-han[st](?=\/)/, '')
    .replace(/\/(feed|changelog)\/\d{4}-\d{2}$/, '/$1');
  for (const group of ABOUT_NAV_GROUPS) {
    for (const item of group) {
      if ('leavesRail' in item) continue;
      if (item.href === path) return item;
    }
  }
  return null;
}

const controllers = new WeakMap<HTMLElement, (url: URL) => Promise<void>>();

export function navigateStaticPage(layout: HTMLElement, url: URL): Promise<void> {
  let navigate = controllers.get(layout);
  if (!navigate) {
    navigate = createNavigation(layout);
    controllers.set(layout, navigate);
  }
  return navigate(url);
}

function createNavigation(layout: HTMLElement): (url: URL) => Promise<void> {
  const root = layout.parentElement!;
  const panel = layout.querySelector<HTMLElement>(':scope > .static-page-panel')!;
  const locale = currentLocale();
  let sequence = 0;
  let renderedUrl = new URL(window.location.href);
  let pending: AbortController | undefined;

  async function render(url: URL, push: boolean): Promise<void> {
    const ticket = ++sequence;
    pending?.abort();
    pending = new AbortController();
    const item = railItem(url.pathname);
    if (!item || !layout.isConnected) throw new Error('Destination has no About rail');
    if (url.pathname === renderedUrl.pathname && url.search === renderedUrl.search) {
      // Cancel a page still preparing after its history entry was pushed.
      // The visible page wins, including its address, when its tab is clicked.
      if (push && url.href !== window.location.href) {
        window.history.pushState(null, '', url.pathname + url.search + url.hash);
      }
      return;
    }
    const staging = document.createElement('div');
    staging.dataset.staticPageStaging = '';
    staging.hidden = true;
    staging.style.display = 'none';
    try {
      // The served head is authoritative: preserve search titles and canonicals
      // without duplicating the server's SEO table in this client router.
      const [mount, response] = await Promise.all([
        mounts[item.key](),
        fetch(url.href, { headers: { accept: 'text/html' }, signal: pending.signal }),
      ]);
      if (!response.ok) throw new Error('Could not load About page metadata');
      const html = await response.text();
      if (ticket !== sequence || !layout.isConnected) return;
      if (push) window.history.pushState(null, '', url.pathname + url.search + url.hash);
      document.body.append(staging);
      await mount(staging);
      if (ticket !== sequence || !layout.isConnected) return;
      const next = staging.querySelector<HTMLElement>('.static-page-panel');
      if (!next) throw new Error('Destination did not render an About panel');
      panel.replaceChildren(...next.childNodes);
      root.className = staging.className;
      for (const link of layout.querySelectorAll<HTMLAnchorElement>('.static-page-rail-link')) {
        const active = new URL(link.href).pathname === localizedHref(item.href, locale);
        link.classList.toggle('active', active);
        if (active) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      }
      const head = new DOMParser().parseFromString(html, 'text/html');
      const fallbackKey =
        item.key === 'about'
          ? 'footer.about'
          : item.key === 'terms'
            ? 'footer.terms'
            : item.key === 'privacy'
              ? 'footer.privacy'
              : item.labelKey;
      const fallbackTitle = `${item.key === 'stats' ? 'Statistics' : t(fallbackKey, {}, locale)} · Mistboard`;
      document.title =
        head.title &&
        head.title !== SHELL_TITLE &&
        head.documentElement.lang.toLowerCase() === locale.toLowerCase()
          ? head.title
          : fallbackTitle;
      // Vite serves the generic shell head. Production serves route-specific
      // metadata; copy that head without executing scripts or replacing styles.
      if (head.title !== SHELL_TITLE) {
        const selector =
          'link[rel="canonical"], link[rel="alternate"][hreflang], meta[name="description"], meta[property^="og:"], meta[name^="twitter:"], script[type="application/ld+json"]';
        for (const node of document.head.querySelectorAll(selector)) node.remove();
        document.head.append(...head.head.querySelectorAll(selector));
      }
      renderedUrl = url;
      if (url.hash) {
        let id = url.hash.slice(1);
        try {
          id = decodeURIComponent(id);
        } catch {
          // Match the normal page mount's handling of malformed fragments.
        }
        document.getElementById(id)?.scrollIntoView();
      } else if (push) {
        // A rail click opens the new page at its top, as a document load did.
        // Back and Forward leave the position to the browser.
        window.scrollTo(0, 0);
      }
      track('$pageview', { path: url.pathname });
    } catch (error) {
      // A later click or history traversal owns navigation now.
      if (ticket === sequence && layout.isConnected) throw error;
    } finally {
      staging.remove();
    }
  }

  const onPopState = () => {
    if (!layout.isConnected) {
      pending?.abort();
      window.removeEventListener('popstate', onPopState);
      return;
    }
    void render(new URL(window.location.href), false).catch(() => window.location.reload());
  };
  window.addEventListener('popstate', onPopState);
  return (url) => render(url, true);
}
