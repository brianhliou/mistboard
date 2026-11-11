import { Window } from 'happy-dom';

// A parser Window per document keeps happy-dom 21 from retaining earlier pages.
// The returned DOM stays readable after closing its inert browsing context.
export function crawlerDocument(html) {
  const window = new Window({
    settings: {
      disableJavaScriptEvaluation: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
    },
  });
  try {
    return new window.DOMParser().parseFromString(html, 'text/html');
  } finally {
    void window.happyDOM.close();
  }
}

// Decided 2026-11-07 (#961): the English-calibrated floor counts each CJK
// ideograph or kana twice. Iterate code points so other characters count once.
export function crawlerCharCount(text) {
  let chars = 0;
  for (const char of text)
    chars += /[\p{Unified_Ideograph}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(char) ? 2 : 1;
  return chars;
}

export function crawlerText(html) {
  const document = crawlerDocument(html);
  for (const node of document.querySelectorAll('script,style,template,svg')) node.remove();
  return (document.body?.textContent ?? '').replace(/\s+/gu, ' ').trim();
}

// site-shell.ts emits <nav class="site-nav"> and a detached #site-menu
// dialog. Server crawler bodies may have no shell at all. Strip only these
// chrome containers and semantic header/nav/footer, retaining all other copy.
export function crawlerContentText(html) {
  return crawlerDocumentContentText(crawlerDocument(html));
}

export function crawlerDocumentContentText(document) {
  for (const node of document.querySelectorAll(
    'script,style,template,svg,header,nav,footer,.site-nav,#site-menu',
  ))
    node.remove();
  return (document.body?.textContent ?? '').replace(/\s+/gu, ' ').trim();
}

export function crawlerFacts(html, { contentOnly = false } = {}) {
  const document = crawlerDocument(html);
  const facts = {
    h1: document.querySelector('h1')?.textContent?.trim() ?? '',
    description:
      document.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() ?? '',
    canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? '',
    alternates: [...document.querySelectorAll('link[rel="alternate"][hreflang]')].map((link) => ({
      lang: link.getAttribute('hreflang'),
      href: link.getAttribute('href'),
    })),
  };
  // Read metadata before removing chrome (an article's h1 may be in a header).
  // Reuse the parsed document: large prerenders include many SVG diagrams.
  return { ...facts, text: contentOnly ? crawlerDocumentContentText(document) : crawlerText(html) };
}
