import { existsSync, readFileSync } from 'node:fs';
import { crawlerDocument } from '../lib/crawler-text.mjs';

// Captured from real prerendered home pages and site-shell's open phone menu,
// not a list of guessed labels.
// Keep the fixtures for socketless/source-only tests; also check current build
// markup when available so a new menu label cannot weaken the manifest.
export function crawlerShells() {
  return ['en', 'zh-hans', 'zh-hant'].flatMap((locale) => {
    const fixture = readFileSync(
      new URL(`./crawler-shell/${locale}.html`, import.meta.url),
      'utf8',
    );
    const file = locale === 'en' ? 'home.html' : `${locale}-home.html`;
    const built = new URL(`../../apps/web/dist/${file}`, import.meta.url);
    const shells = [{ locale, source: 'fixture', html: fixture }];
    if (existsSync(built)) {
      const document = crawlerDocument(readFileSync(built, 'utf8'));
      const chrome = [...document.querySelectorAll('header,nav,footer,.site-nav,#site-menu')]
        .filter((node) => !node.parentElement?.closest('header,nav,footer,.site-nav,#site-menu'))
        .map((node) => node.outerHTML)
        .join('\n');
      shells.push({ locale, source: 'build', html: chrome });
    }
    return shells;
  });
}
