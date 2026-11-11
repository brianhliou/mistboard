import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  articleIsScheduledAhead,
  parseArticleSchedule,
  prerenderedIndexIsStale,
  readArticleSchedule,
  resetArticleScheduleCache,
} from './article-schedule.js';

const T0 = Date.parse('2026-09-21T20:00:00Z');
const LIVE = Date.parse('2026-09-25T16:00:00Z');

const sample = JSON.stringify({
  builtAt: new Date(T0).toISOString(),
  scheduled: [{ slug: 'pikafish', liveAt: new Date(LIVE).toISOString() }],
});

test('a scheduled slug is ahead until its moment, then not', () => {
  const schedule = parseArticleSchedule(sample);
  assert.equal(articleIsScheduledAhead(schedule, 'pikafish', LIVE - 1), true);
  assert.equal(articleIsScheduledAhead(schedule, 'pikafish', LIVE), false);
  assert.equal(articleIsScheduledAhead(schedule, 'jieqi-platform', LIVE - 1), false);
});

test('the prerendered index goes stale the moment a scheduled post goes live', () => {
  const schedule = parseArticleSchedule(sample);
  assert.equal(prerenderedIndexIsStale(schedule, LIVE - 1), false);
  assert.equal(prerenderedIndexIsStale(schedule, LIVE), true);
});

test('a scheduled announcement makes the prerendered pages stale on the same clock', () => {
  const schedule = parseArticleSchedule(
    JSON.stringify({
      builtAt: new Date(T0).toISOString(),
      scheduled: [],
      announcements: [{ slug: '2026-09-25-pikafish', liveAt: new Date(LIVE).toISOString() }],
    }),
  );
  assert.equal(schedule.announcements.length, 1);
  assert.equal(prerenderedIndexIsStale(schedule, LIVE - 1), false);
  assert.equal(prerenderedIndexIsStale(schedule, LIVE), true);
  // A schedule file from before announcements were listed still parses.
  assert.deepEqual(parseArticleSchedule(sample).announcements, []);
});

test('a missing or malformed schedule file means nothing is scheduled', async () => {
  resetArticleScheduleCache();
  const dir = await mkdtemp(join(tmpdir(), 'mistboard-schedule-'));
  const empty = await readArticleSchedule(dir);
  assert.equal(empty.scheduled.size, 0);
  assert.equal(prerenderedIndexIsStale(empty), false);

  resetArticleScheduleCache();
  await writeFile(join(dir, 'article-schedule.json'), '{not json', 'utf-8');
  const broken = await readArticleSchedule(dir);
  assert.equal(broken.scheduled.size, 0);
});

test('the schedule file is read from dist and cached', async () => {
  resetArticleScheduleCache();
  const dir = await mkdtemp(join(tmpdir(), 'mistboard-schedule-'));
  await writeFile(join(dir, 'article-schedule.json'), sample, 'utf-8');
  const schedule = await readArticleSchedule(dir, T0);
  assert.equal(schedule.scheduled.get('pikafish'), LIVE);
  await writeFile(join(dir, 'article-schedule.json'), '{"scheduled":[]}', 'utf-8');
  const cached = await readArticleSchedule(dir, T0 + 1_000);
  assert.equal(cached.scheduled.size, 1, 'served from cache inside the window');
  const fresh = await readArticleSchedule(dir, T0 + 120_000);
  assert.equal(fresh.scheduled.size, 0, 're-read after the window');
});

test('schedule parsing retains localized index entries and explicit unlisted decisions', () => {
  const indexEntry = {
    kind: 'article',
    publisher: 'community',
    locales: {
      'zh-hans': { title: '棋友文章', summary: '对局心得', href: '/zh-hans/blog/new-post' },
    },
  };
  const schedule = parseArticleSchedule(
    JSON.stringify({
      scheduled: [
        { slug: 'new-post', liveAt: new Date(LIVE).toISOString(), indexEntry },
        { slug: 'unlisted', liveAt: new Date(LIVE).toISOString(), indexEntry: null },
        { slug: 'legacy', liveAt: new Date(LIVE).toISOString() },
      ],
    }),
  );
  assert.deepEqual(schedule.indexEntries.get('new-post'), indexEntry);
  assert.equal(schedule.indexEntries.get('unlisted'), null);
  assert.equal(schedule.indexEntries.has('legacy'), false);
});
