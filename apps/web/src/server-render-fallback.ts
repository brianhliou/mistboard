// The server prerenders rules, blog, FAQ and other static pages into #app, and
// the client then remounts them. Search renderers index whatever the DOM holds
// when they stop, so two things the client does to a prerendered page reach
// the index:
//
// - A failed remount (a stale hashed chunk after a deploy is the usual cause)
//   replaced a complete page with the error panel. Google indexed
//   /rules/duck-xiangqi as "Articles · Mistboard" with a TypeError for a body.
// - Mounts set short UI titles ("Learn", "Puzzles", an article's display
//   title) over the server's search titles ("Learn Chinese Chess (Xiangqi)",
//   the article's seoTitle). 82 of 138 sitemap pages did this on 2026-09-25.
//
// Capture the server render before any mount touches it; put the page back on
// failure, and the title back after a successful mount. The server also sets
// search titles on routes it does not prerender (/about, /bots, /videos); any
// title other than the shell's default is one it chose, and is kept too.
export const SHELL_TITLE = 'Free Online Chinese Chess (Xiangqi) | Mistboard';

export interface ServerRender {
  present: boolean;
  restore(): void;
  keepTitle(locale: string): void;
}

export function captureServerRender(root: HTMLElement, doc: Document = document): ServerRender {
  const nodes = Array.from(root.childNodes);
  const present = root.firstElementChild !== null;
  const title = doc.title;
  const className = root.className;
  const lang = (doc.documentElement.lang || 'en').toLowerCase();
  const serverTitled = present || (title !== '' && title !== SHELL_TITLE);
  return {
    present,
    restore() {
      if (serverTitled) doc.title = title;
      if (!present) return;
      root.replaceChildren(...nodes);
      root.className = className;
    },
    // A visitor reading in another locale than the page was rendered in keeps
    // the client's localized title; crawlers carry no locale preference.
    keepTitle(locale) {
      if (serverTitled && locale.toLowerCase() === lang) doc.title = title;
    },
  };
}
