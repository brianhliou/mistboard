// One prerendered page per happy-dom window (#972), each a first visit.
//
// A page must not inherit storage from the pages the build rendered before it.
// The renderers read visitor memory as they go: the nav's piece-set preview and
// every board default follow `mistboard.firstLocale`, which the first render
// writes. Carrying storage from page to page made every page bake whatever the
// first page (an English article) recorded, so the zh homepages and zh articles
// baked the international pieces their own readers never get by default.
//
// `install(window)` points the DOM globals at a window; `render(page)` returns
// the page's serialized markup. The page window is closed even on failure, and
// the bootstrap window's globals are restored for the SSR module loads between
// pages.
export function createPageRenderer({ Window, bootstrap, install }) {
  return async function renderPage(url, render) {
    const page = new Window({ url });
    install(page);
    try {
      return await render(page);
    } finally {
      try {
        await page.happyDOM.close();
      } finally {
        install(bootstrap);
      }
    }
  };
}
