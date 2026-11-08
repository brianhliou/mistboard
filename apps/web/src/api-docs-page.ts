import { prerenderCopy } from './prerender-copy.js';
// /api-docs: the public HTTP API, rendered from the server's own OpenAPI
// document (GET /api/openapi.json).
//
// Rendered in-house rather than by a hosted reference UI: the document is a
// few dozen GET routes, and a page that lists them with their parameters,
// responses and a try-it link is what a reader needs. The document itself is
// standard OpenAPI 3.1, so anyone who wants Scalar, Redoc or a client generator
// can point it at the JSON.

import { currentLocale, type Locale } from './i18n/locale.js';
import { buildNav } from './site-shell.js';
import { proseHeading, proseLink, proseParagraph, proseSection } from './static-page-dom.js';
import { buildStaticPageLayout } from './static-page-shell.js';
import './api-docs.css';

export const OPENAPI_URL = '/api/openapi.json';

type Schema = {
  type?: string | string[];
  enum?: unknown[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  $ref?: string;
  const?: unknown;
  description?: string;
  format?: string;
};

type Parameter = {
  name: string;
  in: 'query' | 'path';
  required?: boolean;
  schema?: Schema;
  description?: string;
};

type Operation = {
  tags?: string[];
  summary?: string;
  description?: string;
  parameters?: Parameter[];
  responses?: Record<string, { description?: string }>;
};

export type OpenApiDocument = {
  info: { title: string; version: string; description?: string };
  servers?: Array<{ url: string }>;
  tags?: Array<{ name: string; description?: string }>;
  paths: Record<string, Record<string, Operation>>;
};

/** A path pattern's `{param}` segments swapped for their example values, so
 *  a reader can click straight into a real response. Null when a required
 *  parameter has no example to offer. */
export function tryItHref(
  path: string,
  operation: Operation,
  examples: Record<string, string>,
): string | null {
  let href = path;
  for (const param of operation.parameters ?? []) {
    if (param.in === 'path') {
      const value = examples[param.name];
      if (!value) return null;
      href = href.replace(`{${param.name}}`, encodeURIComponent(value));
    }
  }
  const required = (operation.parameters ?? []).filter((p) => p.in === 'query' && p.required);
  if (required.length > 0) {
    const search = new URLSearchParams();
    for (const param of required) {
      const value = examples[param.name];
      if (!value) return null;
      search.set(param.name, value);
    }
    href += `?${search.toString()}`;
  }
  return href;
}

// Example values for path and required query parameters. Real, public ids so
// the link answers with content rather than a 404.
const EXAMPLES: Record<string, string> = {
  roomId: 'xq_a30faae1-a4be-4d58-9cb8-da0659b2c439',
  variant: 'xiangqi',
  handle: 'brianhliou',
  id: 'ytSzepET',
  fen: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w',
  url: 'https://mistboard.com/study/ytSzepET/Ue0EgpS7',
  q: 'opening',
};

/** `string`, `integer (1..50, default 10)`, `one of a, b, c` … for the table. */
export function schemaLabel(schema: Schema | undefined): string {
  if (!schema) return '';
  if (schema.$ref) return schema.$ref.split('/').pop() ?? '';
  const parts: string[] = [];
  if (schema.enum) {
    parts.push(`one of ${schema.enum.filter((v) => v !== null).join(', ')}`);
  } else if (schema.type) {
    parts.push(Array.isArray(schema.type) ? schema.type.join(' | ') : schema.type);
  }
  const bounds: string[] = [];
  if (schema.minimum !== undefined && schema.maximum !== undefined)
    bounds.push(`${schema.minimum}..${schema.maximum}`);
  else if (schema.minimum !== undefined) bounds.push(`>= ${schema.minimum}`);
  else if (schema.maximum !== undefined) bounds.push(`<= ${schema.maximum}`);
  if (schema.default !== undefined) bounds.push(`default ${String(schema.default)}`);
  if (bounds.length) parts.push(`(${bounds.join(', ')})`);
  return parts.join(' ');
}

/** Description text with `code` spans as <code>: the document is written in
 *  the plain-text-plus-backticks dialect every OpenAPI tool renders. */
export function inlineCode(text: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const parts = text.split('`');
  parts.forEach((part, index) => {
    if (index % 2 === 1) {
      const code = document.createElement('code');
      code.textContent = part;
      fragment.append(code);
    } else if (part) {
      fragment.append(document.createTextNode(part));
    }
  });
  return fragment;
}

function describe<T extends HTMLElement>(node: T, text: string): T {
  node.append(inlineCode(text));
  return node;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function parametersTable(parameters: Parameter[]): HTMLElement {
  const table = el('table', 'api-docs-params');
  const head = el('thead');
  const headRow = el('tr');
  for (const label of ['Parameter', 'In', 'Type', '']) headRow.append(el('th', undefined, label));
  head.append(headRow);
  const body = el('tbody');
  for (const param of parameters) {
    const row = el('tr');
    const name = el('td');
    name.append(el('code', undefined, param.name));
    if (param.required) name.append(el('span', 'api-docs-required', 'required'));
    row.append(
      name,
      el('td', undefined, param.in),
      el('td', 'api-docs-type', schemaLabel(param.schema)),
      describe(el('td'), param.description ?? ''),
    );
    body.append(row);
  }
  table.append(head, body);
  return table;
}

function operationCard(path: string, method: string, operation: Operation): HTMLElement {
  const card = el('article', 'api-docs-op');
  card.id = anchorFor(method, path);
  const head = el('div', 'api-docs-op__head');
  head.append(el('span', `api-docs-method api-docs-method--${method}`, method.toUpperCase()));
  head.append(el('code', 'api-docs-path', path));
  const href = tryItHref(path, operation, EXAMPLES);
  if (href && method === 'get') {
    const link = el('a', 'api-docs-try', 'Try it');
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener';
    head.append(link);
  }
  card.append(head);
  if (operation.summary) card.append(el('h3', 'api-docs-op__summary', operation.summary));
  if (operation.description)
    card.append(describe(el('p', 'api-docs-op__description'), operation.description));
  if (operation.parameters?.length) card.append(parametersTable(operation.parameters));
  const responses = Object.entries(operation.responses ?? {});
  if (responses.length) {
    const list = el('dl', 'api-docs-responses');
    for (const [status, response] of responses) {
      list.append(el('dt', undefined, status), describe(el('dd'), response.description ?? ''));
    }
    card.append(list);
  }
  return card;
}

export function anchorFor(method: string, path: string): string {
  return `${method}-${path.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')}`.toLowerCase();
}

/** The whole reference as DOM: an index of tags, then one section per tag. */
export function renderOpenApi(doc: OpenApiDocument): HTMLElement {
  const root = el('div', 'api-docs');
  const tags = doc.tags ?? [];
  const byTag = new Map<string, Array<[string, string, Operation]>>();
  for (const [path, methods] of Object.entries(doc.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      const tag = operation.tags?.[0] ?? 'Other';
      const bucket = byTag.get(tag) ?? [];
      bucket.push([path, method, operation]);
      byTag.set(tag, bucket);
    }
  }
  const order = [
    ...tags.map((t) => t.name),
    ...[...byTag.keys()].filter((t) => !tags.some((x) => x.name === t)),
  ];

  const index = el('nav', 'api-docs-index');
  index.setAttribute('aria-label', 'Sections');
  for (const tag of order) {
    if (!byTag.has(tag)) continue;
    const link = el('a', undefined, tag);
    link.href = `#tag-${tag.toLowerCase()}`;
    index.append(link);
  }
  root.append(index);

  for (const tag of order) {
    const ops = byTag.get(tag);
    if (!ops) continue;
    const section = el('section', 'api-docs-tag');
    section.id = `tag-${tag.toLowerCase()}`;
    section.append(el('h2', undefined, tag));
    const description = tags.find((t) => t.name === tag)?.description;
    if (description) section.append(el('p', 'api-docs-tag__description', description));
    for (const [path, method, operation] of ops)
      section.append(operationCard(path, method, operation));
    root.append(section);
  }
  return root;
}

function buildIntro(doc: OpenApiDocument | null): HTMLElement {
  const section = proseSection('api-docs-section');
  section.append(proseHeading('API'));
  const description = doc?.info.description ?? '';
  for (const para of description.split('\n\n').filter(Boolean)) {
    section.append(proseParagraph([inlineCode(para)]));
  }
  section.append(
    proseParagraph([
      'The document itself is OpenAPI 3.1 at ',
      proseLink(OPENAPI_URL, OPENAPI_URL),
      ', for Scalar, Redoc, or a client generator. Boards you can put in your own page are on the ',
      proseLink('developers page', '/developers'),
      '.',
    ]),
  );
  return section;
}

export async function mountApiDocs(root: HTMLElement): Promise<void> {
  const locale: Locale = currentLocale();
  root.replaceChildren();
  root.classList.add('landing-page', 'api-docs-route');

  let doc: OpenApiDocument | null = null;
  try {
    const response = await fetch(OPENAPI_URL, { headers: { accept: 'application/json' } });
    if (response.ok) doc = (await response.json()) as OpenApiDocument;
  } catch {
    doc = null;
  }

  const content = buildIntro(doc);
  if (doc) content.append(renderOpenApi(doc));
  else
    content.append(
      proseParagraph(['The API document could not be loaded. Try again in a moment.']),
    );
  root.append(buildNav(locale), buildStaticPageLayout('apiDocs', content, locale));
}

export function renderApiDocsShellForPrerender(locale: Locale, doc: OpenApiDocument): string {
  const content = buildIntro(doc);
  content.append(renderOpenApi(doc));
  const root = document.createElement('div');
  root.className = 'landing-page api-docs-route';
  root.append(buildNav(locale), buildStaticPageLayout('apiDocs', content, locale));
  return prerenderCopy(root);
}
