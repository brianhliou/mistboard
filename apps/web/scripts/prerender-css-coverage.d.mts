// Types for prerender-css-coverage.mjs, so its test can import it.
export type SelectorRequirement = { selector: string; classes: string[] };
export function selectorClassSets(selectorList: string): string[][];
export function stylesheetSelectors(css: string): SelectorRequirement[];
export function markupClasses(html: string): Set<string>;
export function linkedStylesheets(html: string): string[];
export function unlinkedMatchingRules(
  pageHtml: string,
  stylesheets: Map<string, SelectorRequirement[]>,
  options?: { limit?: number },
): { stylesheet: string; selectors: string[] }[];
export function prerenderedCssMisses(distDir: string): Promise<{ pages: number; lines: string[] }>;
