import assert from 'node:assert/strict';
import test from 'node:test';
import { createForumTranslationService, type ForumTranslationDeps } from './forum-translation.js';
import {
  createForumWriteLimits,
  FORUM_EDIT_LIMIT,
  FORUM_WARM_DAILY_LIMIT,
  FORUM_WARM_HOURLY_LIMIT,
} from './forum-write-limits.js';

const HOUR = 60 * 60 * 1000;

// A translation service over one editable post, the shape the route warms.
function editablePost(initial: string) {
  let text = initial;
  const calls: string[] = [];
  const cache = new Map<string, string>();
  const deps: ForumTranslationDeps = {
    client: {
      model: 'test-model',
      // The service sends a segment request (forum-translation.ts); record the
      // text it carried and answer each segment under its id.
      async translate(request, target) {
        const segments = [...request.matchAll(/<seg id="(\d+)">([\s\S]*?)<\/seg>/g)];
        calls.push(segments.map(([, , body]) => body).join('\n'));
        const text = segments
          .map(([, id, body]) => `<seg id="${id}">[${target}] ${body}</seg>`)
          .join('\n');
        return { text, inputTokens: 1, outputTokens: 1 };
      },
    },
    async loadSource(kind, id) {
      return { kind, id, text };
    },
    async getCached(key) {
      const hit = cache.get(`${key.contentHash}:${key.targetLocale}:${key.model}`);
      return hit ? { translatedText: hit, createdAt: new Date(0) } : null;
    },
    async store(input) {
      cache.set(`${input.contentHash}:${input.targetLocale}:${input.model}`, input.translatedText);
    },
  };
  return {
    service: createForumTranslationService(deps),
    calls,
    edit(next: string) {
      text = next;
    },
  };
}

test('edits: a burst of typo fixes passes, a loop is refused, per account', () => {
  const limits = createForumWriteLimits();
  const t0 = 1_000_000;
  for (let i = 0; i < FORUM_EDIT_LIMIT.limit; i += 1) {
    assert.equal(limits.allowEdit('a', t0 + i), true, `edit ${i + 1}`);
  }
  assert.equal(limits.allowEdit('a', t0 + 100), false, 'one past the window budget');
  assert.equal(limits.allowEdit('b', t0 + 100), true, 'another account is unaffected');
  assert.equal(limits.allowEdit('a', t0 + FORUM_EDIT_LIMIT.windowMs + 200), true, 'window rolls');
});

test('planted abuse: 100 rewrites of a long post stop at the author warm budget', async () => {
  const limits = createForumWriteLimits();
  let clock = 5 * HOUR;
  const meter = limits.warmMeter('abuser', () => clock);
  const post = editablePost('x');
  const filler = 'Cannon to the centre file. '.repeat(180); // ~4900 chars

  for (let i = 0; i < 100; i += 1) {
    post.edit(`${filler}${i}`);
    for (const target of ['zh-Hans', 'zh-Hant'] as const) {
      await post.service.translate({ kind: 'post', id: 'p1', target, meter });
    }
  }
  // 200 misses were asked for; the hour allows 40.
  assert.equal(post.calls.length, FORUM_WARM_HOURLY_LIMIT.limit);

  // A full day of it: the daily bound holds even as each hour refills.
  for (let hour = 1; hour <= 24; hour += 1) {
    clock = 5 * HOUR + hour * HOUR + 1;
    for (let i = 0; i < 30; i += 1) {
      post.edit(`${filler}h${hour}-${i}`);
      await post.service.translate({ kind: 'post', id: 'p1', target: 'zh-Hans', meter });
    }
  }
  assert.ok(post.calls.length <= FORUM_WARM_DAILY_LIMIT.limit + FORUM_WARM_HOURLY_LIMIT.limit);
  assert.ok(post.calls.length < 2000 / 4, 'one author stays well under the global daily cap');
});

test('an edited post is translated afresh; an unchanged save costs nothing', async () => {
  const limits = createForumWriteLimits();
  let metered = 0;
  const authorMeter = limits.warmMeter('author');
  const meter = () => {
    metered += 1;
    return authorMeter();
  };
  const post = editablePost('3 p.m. Beijing time');

  const before = await post.service.translate({ kind: 'post', id: 'p1', target: 'zh-Hant', meter });
  assert.deepEqual(before, { status: 'ok', text: '[zh-Hant] 3 p.m. Beijing time', cached: false });

  post.edit('3 p.m. UTC+8');
  const after = await post.service.translate({ kind: 'post', id: 'p1', target: 'zh-Hant', meter });
  assert.deepEqual(after, { status: 'ok', text: '[zh-Hant] 3 p.m. UTC+8', cached: false });

  const resaved = await post.service.translate({
    kind: 'post',
    id: 'p1',
    target: 'zh-Hant',
    meter,
  });
  assert.deepEqual(resaved, { status: 'ok', text: '[zh-Hant] 3 p.m. UTC+8', cached: true });
  assert.deepEqual(post.calls, ['3 p.m. Beijing time', '3 p.m. UTC+8']);
  assert.equal(metered, 2, 'only the two misses touch the author budget');
});
