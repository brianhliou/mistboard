import assert from 'node:assert/strict';
import test from 'node:test';
import { routes } from './http-api.js';
import { buildOpenApiDocument } from './openapi.js';

// The document is hand-written, so the one thing that can rot is the list of
// paths. This walks every documented path, with its parameters filled in,
// through the real dispatch array and fails if no module claims it: a route
// that was renamed or removed cannot stay in the reference.

const EXAMPLES: Record<string, string> = {
  roomId: 'abc',
  variant: 'xiangqi',
  handle: 'someone',
  id: 'abc',
  tourSlug: 'tour',
  roundId: 'r1',
  boardId: 'b1',
  slug: 'yin-sheng',
};

function fill(path: string): string {
  return path.replace(/\{(\w+)\}/g, (_m, name: string) => EXAMPLES[name] ?? 'x');
}

async function claimed(pathname: string): Promise<boolean> {
  const url = new URL(pathname, 'https://mistboard.com');
  const response = {
    writeHead() {
      return response;
    },
    setHeader() {},
    end() {},
  };
  const request = { method: 'GET', headers: { host: 'mistboard.com' }, url: pathname };
  const ctx = {
    rooms: new Map(),
    inMemoryGameSummary: () => null,
    playableEngines: () => [],
  };
  for (const route of routes) {
    let handled = false;
    try {
      handled = await route.tryHandle(
        ctx as never,
        request as never,
        response as never,
        url.pathname,
        url,
      );
    } catch {
      // A handler that threw still claimed the path; what it does without a
      // database is not this test's question.
      handled = true;
    }
    if (handled) return true;
  }
  return false;
}

test('the document is OpenAPI 3.1 with a tag and a 200 on every operation', () => {
  const doc = buildOpenApiDocument('https://mistboard.com') as {
    openapi: string;
    tags: Array<{ name: string }>;
    paths: Record<
      string,
      Record<string, { tags?: string[]; summary?: string; responses: Record<string, unknown> }>
    >;
  };
  assert.equal(doc.openapi, '3.1.0');
  const tagNames = new Set(doc.tags.map((t) => t.name));
  for (const [path, methods] of Object.entries(doc.paths)) {
    assert.ok(path.startsWith('/api/'), path);
    for (const [method, op] of Object.entries(methods)) {
      assert.equal(method, 'get', `${path}: only anonymous reads are documented`);
      assert.ok(op.summary, `${path} has no summary`);
      assert.ok(op.tags?.[0] && tagNames.has(op.tags[0]), `${path} has an unknown tag`);
      assert.ok(op.responses['200'], `${path} has no 200`);
    }
  }
});

test('every documented path is claimed by a route module', async () => {
  const doc = buildOpenApiDocument('https://mistboard.com') as { paths: Record<string, unknown> };
  for (const path of Object.keys(doc.paths)) {
    assert.equal(await claimed(fill(path)), true, `${path} is documented but no route claims it`);
  }
});

test('the servers entry is the origin the caller used', () => {
  const doc = buildOpenApiDocument('http://localhost:3011') as { servers: Array<{ url: string }> };
  assert.equal(doc.servers[0]?.url, 'http://localhost:3011');
});

type DocumentedOperation = {
  tags: string[];
  parameters?: Array<{
    name: string;
    in: string;
    required: boolean;
    schema: Record<string, unknown>;
  }>;
  responses: Record<string, { description: string }>;
};

const publicReads = [
  ['/api/studies/staff', 'Studies', ['200', '503']],
  ['/api/xiangqi/broadcasts/calendar', 'Xiangqi', ['200', '503']],
  ['/api/xiangqi/players', 'Xiangqi', ['200', '503']],
  ['/api/xiangqi/players/{slug}', 'Xiangqi', ['200', '404', '503']],
  ['/api/xiangqi/tablebase', 'Xiangqi', ['200', '400']],
  ['/api/puzzles/ramp', 'Puzzles', ['200', '400']],
  ['/api/correspondence/seeks', 'Games', ['200', '404', '503']],
  ['/api/historical-xiangqi/games', 'Games', ['200', '400', '503']],
] as const;

for (const [path, tag, statuses] of publicReads) {
  test(`the public reference includes GET ${path} under ${tag}`, () => {
    const doc = buildOpenApiDocument('https://mistboard.com') as {
      paths: Record<string, { get: DocumentedOperation }>;
    };
    const operation = doc.paths[path]?.get;
    assert.ok(operation, `${path} is missing from the public reference`);
    assert.deepEqual(operation.tags, [tag]);
    assert.deepEqual(Object.keys(operation.responses).sort(), [...statuses].sort());
  });
}

test('public study lists document pagination with their own page-size defaults', () => {
  const doc = buildOpenApiDocument('https://mistboard.com') as {
    paths: Record<string, { get: DocumentedOperation }>;
  };
  for (const [path, defaultLimit] of [
    ['/api/studies/public', 5],
    ['/api/studies/staff', 30],
  ] as const) {
    const parameters = doc.paths[path]?.get.parameters ?? [];
    assert.deepEqual(parameters.map((p) => p.name).sort(), ['limit', 'offset', 'q']);
    assert.deepEqual(parameters.find((p) => p.name === 'limit')?.schema, {
      type: 'integer',
      minimum: 1,
      maximum: 50,
      default: defaultLimit,
    });
    assert.deepEqual(parameters.find((p) => p.name === 'offset')?.schema, {
      type: 'integer',
      minimum: 0,
      default: 0,
    });
  }
});

test('the added reads document required inputs, filter bounds and rejection codes', () => {
  const doc = buildOpenApiDocument('https://mistboard.com') as {
    paths: Record<string, { get: DocumentedOperation }>;
  };
  const tablebase = doc.paths['/api/xiangqi/tablebase']?.get;
  const fen = tablebase?.parameters?.find((p) => p.name === 'fen');
  assert.equal(fen?.required, true);
  assert.equal(fen?.schema.maxLength, 120);
  assert.match(tablebase?.responses['400']?.description ?? '', /invalid_position/);
  const player = doc.paths['/api/xiangqi/players/{slug}']?.get.parameters?.[0];
  assert.equal(player?.name, 'slug');
  assert.equal(player?.in, 'path');
  assert.equal(player?.required, true);
  const ramp = doc.paths['/api/puzzles/ramp']?.get;
  assert.deepEqual(ramp?.parameters?.[0]?.schema, {
    type: 'string',
    enum: ['xiangqi', 'jungle'],
    default: 'xiangqi',
  });
  assert.match(ramp?.responses['400']?.description ?? '', /invalid_variant/);
  assert.match(
    doc.paths['/api/correspondence/seeks']?.get.responses['404']?.description ?? '',
    /correspondence_disabled/,
  );

  const search = doc.paths['/api/historical-xiangqi/games']?.get;
  const filters = search?.parameters ?? [];
  assert.deepEqual(filters.map((p) => p.name).sort(), [
    'event',
    'from',
    'limit',
    'offset',
    'player',
    'plyMax',
    'plyMin',
    'result',
    'sort',
    'source',
    'to',
    'variant',
  ]);
  for (const [name, minimum, maximum, fallback] of [
    ['limit', 1, 200, 50],
    ['offset', 0, 1_000_000, 0],
    ['plyMin', 0, 1000, undefined],
    ['plyMax', 0, 1000, undefined],
  ] as const) {
    const schema = filters.find((p) => p.name === name)?.schema;
    assert.equal(schema?.minimum, minimum, name);
    assert.equal(schema?.maximum, maximum, name);
    assert.equal(schema?.default, fallback, name);
  }
  for (const code of [
    'variant',
    'result',
    'from',
    'to',
    'ply_min',
    'ply_max',
    'sort',
    'offset',
    'limit',
  ]) {
    assert.ok(search?.responses['400']?.description.includes(`invalid_${code}`), code);
  }
});
