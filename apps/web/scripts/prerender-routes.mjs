// Expand only existing locale URLs. Other pages accept a locale in their
// renderer; adding locale-prefixed routes belongs to #956's locale child.
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
