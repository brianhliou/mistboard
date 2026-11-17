import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  anchorFor,
  inlineCode,
  mountApiDocs,
  type OpenApiDocument,
  renderOpenApi,
  schemaLabel,
  tryItHref,
} from './api-docs-page.js';

const DOC: OpenApiDocument = {
  info: { title: 'Mistboard API', version: '0.1.0', description: 'First.\n\nSecond.' },
  tags: [{ name: 'Games', description: 'Finished games.' }, { name: 'Site' }],
  paths: {
    '/api/ping': {
      get: { tags: ['Site'], summary: 'Ping', responses: { '200': { description: 'OK' } } },
    },
    '/api/games/{roomId}': {
      get: {
        tags: ['Games'],
        summary: 'One game',
        parameters: [{ name: 'roomId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'OK' }, '404': { description: 'Not found' } },
      },
    },
    '/api/leaderboard': {
      get: {
        tags: ['Games'],
        summary: 'Ladder',
        parameters: [
          { name: 'variant', in: 'query', required: true, schema: { type: 'string' } },
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
          },
        ],
        responses: { '200': { description: 'OK' } },
      },
    },
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('tryItHref', () => {
  it('fills path parameters from the examples', () => {
    const op = DOC.paths['/api/games/{roomId}']?.get;
    expect(tryItHref('/api/games/{roomId}', op as never, { roomId: 'a b' })).toBe(
      '/api/games/a%20b',
    );
  });

  it('adds required query parameters and refuses when one has no example', () => {
    const op = DOC.paths['/api/leaderboard']?.get;
    expect(tryItHref('/api/leaderboard', op as never, { variant: 'xiangqi' })).toBe(
      '/api/leaderboard?variant=xiangqi',
    );
    expect(tryItHref('/api/leaderboard', op as never, {})).toBeNull();
  });
});

describe('inlineCode', () => {
  it('turns backtick spans into code elements and leaves the rest as text', () => {
    const fragment = inlineCode('errors are `{ "error": "x" }` here');
    const host = document.createElement('div');
    host.append(fragment);
    expect(host.querySelector('code')?.textContent).toBe('{ "error": "x" }');
    expect(host.textContent).toBe('errors are { "error": "x" } here');
  });
});

describe('schemaLabel', () => {
  it('reads like a type column', () => {
    expect(schemaLabel({ type: 'integer', minimum: 1, maximum: 50, default: 10 })).toBe(
      'integer (1..50, default 10)',
    );
    expect(schemaLabel({ type: 'string', enum: ['a', 'b'] })).toBe('one of a, b');
    expect(schemaLabel({ $ref: '#/components/schemas/GameRecord' })).toBe('GameRecord');
    expect(schemaLabel(undefined)).toBe('');
  });
});

describe('renderOpenApi', () => {
  it('offers a public player example for the player slug path parameter', () => {
    const root = renderOpenApi({
      ...DOC,
      tags: [{ name: 'Xiangqi' }],
      paths: {
        '/api/xiangqi/players/{slug}': {
          get: {
            tags: ['Xiangqi'],
            summary: 'One professional player and their games',
            parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }],
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    });
    expect(root.querySelector('.api-docs-try')?.getAttribute('href')).toBe(
      '/api/xiangqi/players/yin-sheng',
    );
  });

  it('groups operations by tag in the document’s tag order', () => {
    const root = renderOpenApi(DOC);
    const sections = [...root.querySelectorAll('.api-docs-tag h2')].map((h) => h.textContent);
    expect(sections).toEqual(['Games', 'Site']);
    expect(root.querySelectorAll('.api-docs-op')).toHaveLength(3);
    expect(root.querySelector(`#${anchorFor('get', '/api/games/{roomId}')}`)).not.toBeNull();
  });

  it('renders parameters, responses, and a try-it link where one is possible', () => {
    const root = renderOpenApi(DOC);
    const game = root.querySelector(`#${anchorFor('get', '/api/games/{roomId}')}`);
    expect(game?.querySelector('.api-docs-params')).not.toBeNull();
    expect(game?.querySelectorAll('.api-docs-responses dt')).toHaveLength(2);
    // The ladder needs a `variant` the examples do not carry for this doc, so
    // the ping is the one with a link and the ladder without.
    expect(root.querySelector(`#${anchorFor('get', '/api/ping')} .api-docs-try`)).not.toBeNull();
    const required = root.querySelector(
      `#${anchorFor('get', '/api/leaderboard')} .api-docs-required`,
    );
    expect(required?.textContent).toBe('required');
  });
});

describe('mountApiDocs', () => {
  it('renders the reference from the fetched document', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => DOC }));
    const root = document.createElement('div');
    await mountApiDocs(root);
    expect(root.querySelector('.api-docs-op')).not.toBeNull();
    expect(root.textContent).toContain('First.');
    expect(root.querySelector('a[href="/api/openapi.json"]')).not.toBeNull();
  });

  it('says so when the document cannot be loaded', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, json: async () => ({}) }));
    const root = document.createElement('div');
    await mountApiDocs(root);
    expect(root.textContent).toContain('could not be loaded');
  });
});
