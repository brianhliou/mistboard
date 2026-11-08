import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type PrerenderRoute = {
  route: string;
  file: string;
  kind?: 'tool';
  fallback?: string;
};

// The build writes the routes it actually baked. An absent manifest (older or
// incomplete build) leaves the normal SPA fallback in charge.
export function readPrerenderRoutes(staticDir: string): ReadonlyMap<string, PrerenderRoute> {
  let data: { version: number; routes: PrerenderRoute[] };
  try {
    data = JSON.parse(readFileSync(resolve(staticDir, 'prerender-routes.json'), 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Map();
    throw error;
  }
  if (data.version !== 1 || !Array.isArray(data.routes))
    throw new Error('Invalid prerender route manifest');
  const routes = new Map<string, PrerenderRoute>();
  for (const row of data.routes) {
    if (
      !row.route.startsWith('/') ||
      !/^[\w/-]+\.html$/.test(row.file) ||
      row.file.split('/').includes('..') ||
      routes.has(row.route)
    ) {
      throw new Error(`Invalid or duplicate prerender route: ${row.route}`);
    }
    routes.set(row.route, row);
  }
  return routes;
}
