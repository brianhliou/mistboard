import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createForumTranslationService,
  detectScriptLanguage,
  type ForumTranslationDeps,
  forumContentHash,
  forumTranslationCacheHash,
  TranslationFailedError,
  translationNeeded,
  translationSystemPrompt,
} from './forum-translation.js';

// Post #6 of the live "weekly jieqi arena" topic (2026-10-27), verbatim: a
// Quote of Brian's English post, then one Chinese line of the author's own.
const QUOTE_REPLY_POST = [
  '> brianhliou-dev wrote:',
  "> Haha yes, 3 p.m. UTC+8. Most of our current players are in Asia, so we picked a time that works there. If enough people come, we'd love to run it on repeat by itself, with longer events and more time zones.",
  '> ',
  "> No prize money for now. For now it's for glory: tournament points, achievements, maybe a trophy 😄",
  '> ',
  '> So would you play?!',
  '你是这个网站的作者吗',
].join('\n');
const OWN_ZH_LINE = '你是这个网站的作者吗';

// An English post whose author also wrote one line in Chinese: a zh reader
// gets it translated, and that line must come through untouched.
const MIXED_OWN_POST = [
  'Thanks for hosting this, I played last week and had a lot of fun.',
  OWN_ZH_LINE,
  'See you on Saturday.',
].join('\n');

const SEG_RE = /<seg id="(\d+)">([\s\S]*?)<\/seg>/g;

// A model stub that answers the segment protocol: each segment comes back
// under its id, rewritten by `fn`. Untagged input (the pre-segment protocol)
// is rewritten whole, so the stub means the same thing on either side.
function perSegment(fn: (segment: string, target: string) => string | null) {
  return async ({ text, target }: { text: string; target: string }) => {
    const segments = [...text.matchAll(SEG_RE)];
    if (segments.length === 0) return fn(text, target) ?? '';
    return segments
      .map(([, id, body]) => {
        const out = fn(body ?? '', target);
        return out === null ? '' : `<seg id="${id}">${out}</seg>`;
      })
      .filter(Boolean)
      .join('\n');
  };
}

test('detectScriptLanguage: Han-majority text is zh, Latin text is latin, symbols are unknown', () => {
  assert.equal(detectScriptLanguage('这个开局的炮二平五很常见'), 'zh');
  assert.equal(detectScriptLanguage('Cannon to the centre file is the classic opening.'), 'latin');
  // An English post that names a few pieces in Chinese stays latin.
  assert.equal(detectScriptLanguage('The 炮 (cannon) and 马 (horse) work together here.'), 'latin');
  // A Chinese post carrying a URL stays zh.
  assert.equal(detectScriptLanguage('看这局 https://mistboard.com/game/abc123 第十回合'), 'zh');
  assert.equal(detectScriptLanguage('1. C2=5 ... 42 :)'), 'unknown');
  assert.equal(detectScriptLanguage(''), 'unknown');
});

test('translationNeeded: only when the script differs from the target locale', () => {
  assert.equal(translationNeeded('炮二平五', 'en'), true);
  assert.equal(translationNeeded('炮二平五', 'zh-Hans'), false);
  assert.equal(translationNeeded('炮二平五', 'zh-Hant'), false);
  assert.equal(translationNeeded('Cannon to the centre', 'en'), false);
  assert.equal(translationNeeded('Cannon to the centre', 'zh-Hans'), true);
  assert.equal(translationNeeded('Cannon to the centre', 'zh-Hant'), true);
  assert.equal(translationNeeded('1. C2=5', 'zh-Hans'), false);
});

test('translationNeeded: decided by the author own lines, never by what they quoted', () => {
  // The quote is English, the author wrote Chinese: an English reader needs it,
  // a Chinese reader does not.
  assert.equal(translationNeeded(QUOTE_REPLY_POST, 'en'), true);
  assert.equal(translationNeeded(QUOTE_REPLY_POST, 'zh-Hans'), false);
  assert.equal(translationNeeded(QUOTE_REPLY_POST, 'zh-Hant'), false);
  // A post that is only a quote has nothing of its own to translate.
  assert.equal(translationNeeded('> alice wrote:\n> Cannon to the centre', 'zh-Hans'), false);
});

test('translationSystemPrompt copies target-language text verbatim and never answers', () => {
  const prompt = translationSystemPrompt('zh-Hans');
  assert.match(prompt, /already written in Simplified Chinese.*verbatim/);
  assert.match(prompt, /never answer/i);
});

test('forumContentHash: stable across CRLF, surrounding whitespace, and NFC', () => {
  const a = forumContentHash('Hello\r\nworld  ');
  assert.equal(a, forumContentHash('Hello\nworld'));
  assert.equal(forumContentHash('é'), forumContentHash('é'));
  assert.notEqual(a, forumContentHash('Hello world'));
  assert.match(a, /^[0-9a-f]{64}$/);
});

test('translationSystemPrompt is byte-stable per locale and names the target language', () => {
  assert.equal(translationSystemPrompt('zh-Hans'), translationSystemPrompt('zh-Hans'));
  assert.match(translationSystemPrompt('zh-Hant'), /Traditional Chinese/);
  assert.match(translationSystemPrompt('en'), /into English/);
});

type Call = { text: string; target: string };

function makeDeps(
  overrides: Partial<ForumTranslationDeps> & {
    sourceText?: string | null;
    onTranslate?: (call: Call) => Promise<string>;
  } = {},
) {
  const calls: Call[] = [];
  const stored: Parameters<ForumTranslationDeps['store']>[0][] = [];
  const cache = new Map<string, string>();
  const deps: ForumTranslationDeps = {
    client: {
      model: 'test-model',
      async translate(text, target) {
        calls.push({ text, target });
        const out = await (overrides.onTranslate ?? perSegment((seg, t) => `[${t}] ${seg}`))({
          text,
          target,
        });
        return { text: out, inputTokens: 10, outputTokens: 12 };
      },
    },
    async loadSource(kind, id) {
      const text =
        overrides.sourceText === undefined ? 'Cannon to the centre' : overrides.sourceText;
      return text === null ? null : { kind, id, text };
    },
    async getCached(key) {
      const hit = cache.get(`${key.contentHash}:${key.targetLocale}:${key.model}`);
      return hit ? { translatedText: hit, createdAt: new Date(0) } : null;
    },
    async store(input) {
      stored.push(input);
      cache.set(`${input.contentHash}:${input.targetLocale}:${input.model}`, input.translatedText);
    },
    ...overrides,
  };
  return { deps, calls, stored, cache };
}

test('service: miss translates, stores, and the next call is a cache hit that is not metered', async () => {
  const { deps, calls, stored } = makeDeps();
  const service = createForumTranslationService(deps);
  let metered = 0;
  const meter = () => {
    metered += 1;
    return true;
  };

  const first = await service.translate({ kind: 'post', id: 'p1', target: 'zh-Hans', meter });
  assert.deepEqual(first, { status: 'ok', text: '[zh-Hans] Cannon to the centre', cached: false });
  assert.equal(calls.length, 1);
  assert.equal(stored.length, 1);
  assert.equal(stored[0]?.source.id, 'p1');
  assert.equal(stored[0]?.inputTokens, 10);
  assert.equal(metered, 1);

  const second = await service.translate({ kind: 'post', id: 'p1', target: 'zh-Hans', meter });
  assert.deepEqual(second, { status: 'ok', text: '[zh-Hans] Cannon to the centre', cached: true });
  assert.equal(calls.length, 1, 'cache hit must not call the model');
  assert.equal(metered, 1, 'cache hit must not be metered');
});

test('service: identical text under a different post id shares the translation', async () => {
  const { deps, calls } = makeDeps();
  const service = createForumTranslationService(deps);
  await service.translate({ kind: 'post', id: 'p1', target: 'zh-Hant', meter: () => true });
  const again = await service.translate({
    kind: 'post',
    id: 'p2',
    target: 'zh-Hant',
    meter: () => true,
  });
  assert.equal(again.status, 'ok');
  assert.equal(again.status === 'ok' && again.cached, true);
  assert.equal(calls.length, 1);
});

test('service: same-language text is refused before any lookup or model call', async () => {
  const { deps, calls } = makeDeps({ sourceText: 'Cannon to the centre' });
  const service = createForumTranslationService(deps);
  const result = await service.translate({
    kind: 'post',
    id: 'p1',
    target: 'en',
    meter: () => true,
  });
  assert.deepEqual(result, { status: 'same_language' });
  assert.equal(calls.length, 0);
});

test('service: hidden or missing source is not_found and never reaches the model', async () => {
  const { deps, calls } = makeDeps({ sourceText: null });
  const service = createForumTranslationService(deps);
  const result = await service.translate({
    kind: 'topic',
    id: 't1',
    target: 'zh-Hans',
    meter: () => true,
  });
  assert.deepEqual(result, { status: 'not_found' });
  assert.equal(calls.length, 0);
});

test('service: a refused meter stops a miss without calling the model', async () => {
  const { deps, calls } = makeDeps();
  const service = createForumTranslationService(deps);
  const result = await service.translate({
    kind: 'post',
    id: 'p1',
    target: 'zh-Hans',
    meter: () => false,
  });
  assert.deepEqual(result, { status: 'rate_limited' });
  assert.equal(calls.length, 0);
});

test('service: concurrent misses for one key coalesce into one model call and one store', async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { deps, calls, stored } = makeDeps({
    onTranslate: async (call) => {
      await gate;
      return perSegment((segment, target) => `[${target}] ${segment}`)(call);
    },
  });
  const service = createForumTranslationService(deps);
  let metered = 0;
  const meter = () => {
    metered += 1;
    return true;
  };
  const a = service.translate({ kind: 'post', id: 'p1', target: 'zh-Hans', meter });
  const b = service.translate({ kind: 'post', id: 'p1', target: 'zh-Hans', meter });
  const c = service.translate({ kind: 'post', id: 'p9', target: 'zh-Hans', meter });
  // Let all three reach the in-flight map before the model answers.
  await new Promise((resolve) => setImmediate(resolve));
  release();
  const results = await Promise.all([a, b, c]);
  for (const result of results) {
    assert.deepEqual(result, {
      status: 'ok',
      text: '[zh-Hans] Cannon to the centre',
      cached: false,
    });
  }
  assert.equal(calls.length, 1, 'one model call for three concurrent readers');
  assert.equal(stored.length, 1, 'the leader stores once; joiners do not');
  assert.equal(metered, 1, 'joiners are not metered');
});

test('service: model failures surface as failed with the code and store nothing', async () => {
  const { deps, stored } = makeDeps({
    onTranslate: async () => {
      throw new TranslationFailedError('refused');
    },
  });
  const service = createForumTranslationService(deps);
  const result = await service.translate({
    kind: 'post',
    id: 'p1',
    target: 'zh-Hans',
    meter: () => true,
  });
  assert.deepEqual(result, { status: 'failed', code: 'refused' });
  assert.equal(stored.length, 0);

  // After a failure the key is released, so a retry asks the model again.
  const { deps: deps2, calls } = makeDeps();
  const service2 = createForumTranslationService(deps2);
  await service2.translate({ kind: 'post', id: 'p1', target: 'zh-Hans', meter: () => true });
  assert.equal(calls.length, 1);
});

test('service: the global daily cap stops misses before the caller meter and rolls at UTC midnight', async () => {
  let clock = Date.parse('2026-09-02T23:59:00Z');
  const { deps, calls } = makeDeps({ dailyMissCap: 2, now: () => clock });
  let metered = 0;
  const meter = () => {
    metered += 1;
    return true;
  };
  // Distinct text per id so nothing hits the cache.
  const results: string[] = [];
  const svc = createForumTranslationService({
    ...deps,
    loadSource: async (kind, id) => ({ kind, id, text: `post ${id} says hello` }),
  });
  for (const id of ['a', 'b', 'c']) {
    const result = await svc.translate({ kind: 'post', id, target: 'zh-Hans', meter });
    results.push(result.status);
  }
  assert.deepEqual(results, ['ok', 'ok', 'capped']);
  assert.equal(calls.length, 2);
  assert.equal(metered, 2, 'a capped call must not consume the caller budget');
  assert.equal(svc.stats().missesToday, 2);

  clock = Date.parse('2026-09-03T00:00:30Z');
  const next = await svc.translate({ kind: 'post', id: 'd', target: 'zh-Hans', meter });
  assert.equal(next.status, 'ok');
  assert.equal(svc.stats().missesToday, 1);
  assert.equal(svc.stats().day, '2026-09-03');
});

test('service: consecutive upstream failures open the breaker; cooldown half-opens; success closes', async () => {
  let clock = 1_000_000;
  let failing = true;
  const { deps, calls } = makeDeps({
    breaker: { threshold: 2, cooldownMs: 60_000 },
    now: () => clock,
    onTranslate: async ({ text, target }) => {
      if (failing) throw new TranslationFailedError('upstream', 'boom');
      return `[${target}] ${text}`;
    },
  });
  const svc = createForumTranslationService({
    ...deps,
    loadSource: async (kind, id) => ({ kind, id, text: `post ${id} says hello` }),
  });
  const meter = () => true;
  assert.deepEqual(await svc.translate({ kind: 'post', id: 'a', target: 'zh-Hans', meter }), {
    status: 'failed',
    code: 'upstream',
  });
  assert.deepEqual(await svc.translate({ kind: 'post', id: 'b', target: 'zh-Hans', meter }), {
    status: 'failed',
    code: 'upstream',
  });
  // Open: no model call, distinct code so the route can say "paused".
  assert.deepEqual(await svc.translate({ kind: 'post', id: 'c', target: 'zh-Hans', meter }), {
    status: 'failed',
    code: 'paused',
  });
  assert.equal(calls.length, 2);
  assert.equal(svc.stats().breakerOpenUntil, 1_060_000);

  // Cooldown elapsed: one call goes through and, succeeding, closes it.
  clock = 1_060_001;
  failing = false;
  const result = await svc.translate({ kind: 'post', id: 'd', target: 'zh-Hans', meter });
  assert.equal(result.status, 'ok');
  assert.equal(calls.length, 3);
  assert.equal(svc.stats().breakerOpenUntil, null);
  assert.equal(svc.stats().consecutiveUpstreamFailures, 0);
});

test('service: refusals do not trip the breaker', async () => {
  const { deps } = makeDeps({
    breaker: { threshold: 1, cooldownMs: 60_000 },
    onTranslate: async () => {
      throw new TranslationFailedError('refused');
    },
  });
  const svc = createForumTranslationService({
    ...deps,
    loadSource: async (kind, id) => ({ kind, id, text: `post ${id} says hello` }),
  });
  await svc.translate({ kind: 'post', id: 'a', target: 'zh-Hans', meter: () => true });
  const again = await svc.translate({
    kind: 'post',
    id: 'b',
    target: 'zh-Hans',
    meter: () => true,
  });
  assert.deepEqual(again, { status: 'failed', code: 'refused' });
  assert.equal(svc.stats().breakerOpenUntil, null);
});

test('service: one miss event per model call, carrying tokens and outcome; joiners and hits emit none', async () => {
  const events: Parameters<NonNullable<ForumTranslationDeps['onMiss']>>[0][] = [];
  const { deps } = makeDeps({ onMiss: (event) => events.push(event) });
  const svc = createForumTranslationService(deps);
  const meter = () => true;
  const a = svc.translate({ kind: 'post', id: 'p1', target: 'zh-Hans', meter });
  const b = svc.translate({ kind: 'post', id: 'p1', target: 'zh-Hans', meter });
  await Promise.all([a, b]);
  await svc.translate({ kind: 'post', id: 'p1', target: 'zh-Hans', meter });
  assert.equal(events.length, 1);
  assert.equal(events[0]?.outcome, 'ok');
  assert.equal(events[0]?.inputTokens, 10);
  assert.equal(events[0]?.outputTokens, 12);
  assert.equal(events[0]?.missesToday, 1);
  assert.equal(events[0]?.target, 'zh-Hans');
});

test('service: a quote reply in Chinese is translated for an English reader, quote untouched', async () => {
  const { deps, calls, stored } = makeDeps({ sourceText: QUOTE_REPLY_POST });
  const service = createForumTranslationService(deps);
  const result = await service.translate({
    kind: 'post',
    id: 'post_d5ec0914',
    target: 'en',
    meter: () => true,
  });
  assert.equal(result.status, 'ok');
  // The English quote is already in the target language: it is not sent.
  assert.equal(calls.length, 1);
  assert.match(calls[0]?.text ?? '', /你是这个网站的作者吗/);
  assert.doesNotMatch(calls[0]?.text ?? '', /Most of our current players/);
  const lines = QUOTE_REPLY_POST.split('\n');
  assert.equal(
    result.status === 'ok' && result.text,
    [...lines.slice(0, -1), `[en] ${OWN_ZH_LINE}`].join('\n'),
  );
  // A new key: whatever the whole-body path cached for this text is not served.
  assert.notEqual(stored[0]?.contentHash, forumContentHash(QUOTE_REPLY_POST));
  assert.equal(stored[0]?.contentHash, forumTranslationCacheHash(QUOTE_REPLY_POST, 'en'));
});

test('service: a Chinese reader of the quote reply gets the original, the author line intact', async () => {
  const { deps, calls } = makeDeps({ sourceText: QUOTE_REPLY_POST });
  const service = createForumTranslationService(deps);
  for (const target of ['zh-Hans', 'zh-Hant'] as const) {
    const result = await service.translate({ kind: 'post', id: 'p6', target, meter: () => true });
    assert.deepEqual(result, { status: 'same_language' });
  }
  assert.equal(calls.length, 0);
});

test('service: zh-Hans output keeps the author line already in Chinese, even if the model drops it', async () => {
  // The stub drops any Han segment, as the model did with post #6.
  const { deps, calls } = makeDeps({
    sourceText: MIXED_OWN_POST,
    onTranslate: perSegment((seg, t) => (/\p{Script=Han}/u.test(seg) ? null : `[${t}] ${seg}`)),
  });
  const service = createForumTranslationService(deps);
  const result = await service.translate({
    kind: 'post',
    id: 'p',
    target: 'zh-Hans',
    meter: () => true,
  });
  assert.equal(result.status, 'ok');
  assert.doesNotMatch(
    calls[0]?.text ?? '',
    /你是这个网站的作者吗/,
    'text already in the target script is not sent',
  );
  assert.equal(
    result.status === 'ok' && result.text,
    [
      '[zh-Hans] Thanks for hosting this, I played last week and had a lot of fun.',
      OWN_ZH_LINE,
      '[zh-Hans] See you on Saturday.',
    ].join('\n'),
  );
});

test('service: a model that answers one segment and drops another cannot remove the author text', async () => {
  const { deps } = makeDeps({
    sourceText: MIXED_OWN_POST,
    onTranslate: async ({ text }) =>
      text.includes('<seg id=')
        ? '<seg id="1">是的，我是这个网站的作者。</seg>'
        : '是的，我是这个网站的作者。',
  });
  const service = createForumTranslationService(deps);
  const result = await service.translate({
    kind: 'post',
    id: 'p',
    target: 'zh-Hans',
    meter: () => true,
  });
  assert.equal(result.status, 'ok');
  const text = result.status === 'ok' ? result.text : '';
  assert.match(text, /你是这个网站的作者吗/);
  // The dropped segment falls back to its source, never to nothing.
  assert.match(text, /See you on Saturday\./);
});

test('service: a foreign quote is translated line by line for the reader, header and quote marks kept', async () => {
  const body = ['> 小明 wrote:', '> 炮二平五是最常见的开局', '', '我同意，这是最常见的开局'].join(
    '\n',
  );
  const { deps } = makeDeps({ sourceText: body });
  const service = createForumTranslationService(deps);
  const en = await service.translate({ kind: 'post', id: 'p', target: 'en', meter: () => true });
  assert.equal(
    en.status === 'ok' && en.text,
    ['> 小明 wrote:', '> [en] 炮二平五是最常见的开局', '', '[en] 我同意，这是最常见的开局'].join(
      '\n',
    ),
  );
  // An English reply quoting the same post: an English reader has nothing to
  // translate, whatever the quote is in.
  const reply = [
    '> 小明 wrote:',
    '> 炮二平五是最常见的开局',
    '',
    'Agreed, it is the most common.',
  ].join('\n');
  const { deps: deps2, calls } = makeDeps({ sourceText: reply });
  const same = await createForumTranslationService(deps2).translate({
    kind: 'post',
    id: 'p',
    target: 'en',
    meter: () => true,
  });
  assert.deepEqual(same, { status: 'same_language' });
  assert.equal(calls.length, 0);
});

test('service: pure Chinese for an English reader translates as before, under the old cache key', async () => {
  const body = '这是什么宝藏网站，居然很少见到有人推荐这个网站';
  const { deps, stored } = makeDeps({ sourceText: body });
  const service = createForumTranslationService(deps);
  const result = await service.translate({
    kind: 'post',
    id: 'p5',
    target: 'en',
    meter: () => true,
  });
  assert.deepEqual(result, { status: 'ok', text: `[en] ${body}`, cached: false });
  assert.equal(stored[0]?.contentHash, forumContentHash(body));
});

test('forumTranslationCacheHash: whole-body texts keep the old key; segmented ones get a new one', () => {
  assert.equal(
    forumTranslationCacheHash('Cannon to the centre', 'zh-Hans'),
    forumContentHash('Cannon to the centre'),
  );
  assert.equal(forumTranslationCacheHash('炮二平五好棋', 'en'), forumContentHash('炮二平五好棋'));
  assert.notEqual(
    forumTranslationCacheHash(QUOTE_REPLY_POST, 'zh-Hans'),
    forumContentHash(QUOTE_REPLY_POST),
  );
  assert.notEqual(
    forumTranslationCacheHash(MIXED_OWN_POST, 'zh-Hans'),
    forumContentHash(MIXED_OWN_POST),
  );
});
