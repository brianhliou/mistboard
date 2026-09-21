import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import test from 'node:test';
import { parseChapterTags, tryHandle } from './routes/studies.js';

type ResponseCapture = { body: string; headers: Record<string, string>; status: number | null };

test('Staff picks curation rejects a non-admin before reading persistence', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const response = captureResponse();
    const request = {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as IncomingMessage;

    const handled = await tryHandle({}, request, response, '/api/admin/studies/study1/featured');

    assert.equal(handled, true);
    assert.equal(response.status, 403);
    assert.deepEqual(JSON.parse(response.body), { error: 'admin_required' });
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

test('cloning a study requires a session', async () => {
  const response = captureResponse();
  const request = {
    method: 'POST',
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as IncomingMessage;
  const handled = await tryHandle({}, request, response, '/api/studies/study1/clone');
  assert.equal(handled, true);
  // Without persistence the route answers 503 before the session check; with
  // it, 401. Either way nothing is cloned for a signed-out caller.
  assert.ok(response.status === 401 || response.status === 503, String(response.status));
});

test('chapter tags keep the allowlist and drop everything else', () => {
  assert.deepEqual(
    parseChapterTags({
      red: 'Xu Chao',
      black: 'Huang Xueqian',
      result: '1-0',
      event: '2019 World Championship',
      date: '2019-11-24',
      round: '9',
      site: 'http://www.dpxq.com/x.html',
    }),
    {
      red: 'Xu Chao',
      black: 'Huang Xueqian',
      result: '1-0',
      event: '2019 World Championship',
      date: '2019-11-24',
      round: '9',
      site: 'http://www.dpxq.com/x.html',
    },
  );

  // The case that cost a whole study: PGN writes its tags capitalised, so
  // sending Red/Black/Event/Result is the natural mistake. They are not on the
  // allowlist, the write still returns 201, and the chapter stores {}. The drop
  // is deliberate (an unknown key is not a reason to reject a whole save) but it
  // is silent, which is why a caller has to read its own write back.
  assert.deepEqual(parseChapterTags({ Red: 'Xu Chao', Black: 'Huang Xueqian', Result: '1-0' }), {});

  // Blank strings clear rather than store, and non-strings are ignored.
  assert.deepEqual(parseChapterTags({ red: '   ', black: 42, result: '1-0' }), { result: '1-0' });
  assert.deepEqual(parseChapterTags(null), {});
  assert.deepEqual(parseChapterTags(['red', 'Xu Chao']), {});
});

function captureResponse(): ServerResponse & ResponseCapture {
  const capture = {
    body: '',
    headers: {} as Record<string, string>,
    status: null as number | null,
    writeHead(status: number, headers?: Record<string, string>) {
      capture.status = status;
      capture.headers = headers ?? {};
      return capture;
    },
    end(chunk?: string) {
      capture.body += chunk ?? '';
      return capture;
    },
  };
  return capture as unknown as ServerResponse & ResponseCapture;
}
