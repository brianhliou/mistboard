import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

// Locale groups are declared once in the route table, for rendering and lookup.
export function expandPrerenderRoutes(table, catalogs) {
  return table.flatMap((row) => {
    const variants = row.variants ? catalogs[row.variants] : [null];
    if (!variants) throw new Error(`Missing prerender variant catalog: ${row.variants}`);
    return variants.flatMap((variant) =>
      row.locales.flatMap((locale) => {
        if (variant && variant !== 'xiangqi' && locale !== 'en') return [];
        const prefix = locale === 'en' ? '' : `/${locale.toLowerCase()}`;
        return [
          {
            ...row,
            locale,
            locales: variant && variant !== 'xiangqi' ? ['en'] : row.locales,
            ...(variant && variant !== 'xiangqi' ? { metaByLocale: undefined } : {}),
            variant,
            route: prefix + row.route.replace(':variant', variant ?? ''),
            file:
              (prefix ? `${prefix.slice(1)}/` : '') + row.file.replace(':variant', variant ?? ''),
          },
        ];
      }),
    );
  });
}

export function prerenderRouteManifest(rows, prebuilt = []) {
  const routes = [
    ...prebuilt,
    ...rows.map(({ route, file, kind, fallback }) => ({
      route,
      file,
      ...(kind ? { kind } : {}),
      ...(fallback ? { fallback } : {}),
    })),
  ];
  const paths = routes.map(({ route }) => route);
  if (new Set(paths).size !== paths.length) throw new Error('Duplicate prerender route');
  return { version: 1, routes };
}

export function prerenderAlternateLinks(row, host) {
  if (row.locales.length < 2) return '';
  const path = row.route.replace(/^\/zh-han[st](?=\/|$)/, '');
  return [
    ...row.locales.map(
      (locale) =>
        `<link rel="alternate" hreflang="${locale}" href="${host}${locale === 'en' ? '' : `/${locale.toLowerCase()}`}${path}">`,
    ),
    `<link rel="alternate" hreflang="x-default" href="${host}${path}">`,
  ].join('');
}

// Check the final files, including article translation groups written outside
// the route table. A declared alternate must have an emitted canonical page.
export async function prerenderAlternateProblems(distDir, host) {
  const pages = [];
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'assets' && !entry.name.startsWith('.')) await walk(file);
      } else if (entry.name.endsWith('.html')) {
        pages.push({ file: relative(distDir, file), html: await readFile(file, 'utf8') });
      }
    }
  };
  await walk(distDir);
  const links = (html, rel) =>
    [...html.matchAll(/<link\b[^>]*>/g)]
      .map(([tag]) => ({
        rel: tag.match(/\brel="([^"]+)"/)?.[1],
        href: tag.match(/\bhref="([^"]+)"/)?.[1],
        lang: tag.match(/\bhreflang="([^"]+)"/)?.[1],
      }))
      .filter((link) => link.rel === rel && link.href);
  const canonicalUrls = new Set(
    pages.flatMap(({ html }) =>
      links(html, 'canonical').map(({ href }) => new URL(href, host).href),
    ),
  );
  return pages.flatMap(({ file, html }) =>
    links(html, 'alternate')
      .filter(({ lang }) => lang)
      .filter(({ href }) => !canonicalUrls.has(new URL(href, host).href))
      .map(({ href }) => `${file}: alternate ${href} has no emitted canonical page`),
  );
}
