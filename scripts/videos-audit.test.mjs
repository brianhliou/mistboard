// Unit tests for the video-library audit. Everything here is offline: the
// network path is exercised by running the script, and what breaks silently is
// the parsing, not the fetching.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { isThrottle } from './lib/youtube.mjs';
import {
  durationToMinutes,
  extractMetadata,
  field,
  parseEntries,
  withDuration,
} from './videos-audit.mjs';

const DATA_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../apps/web/src/videos-data.ts',
);
const SOURCE = readFileSync(DATA_PATH, 'utf8');

// Parse the real catalogue, not a fixture. A fixture written from this parser's
// own assumptions would have passed while the parser read zero entries.
test('parseEntries reads the real catalogue', () => {
  const entries = parseEntries(SOURCE);
  assert.ok(entries.length >= 40, `expected a populated catalogue, got ${entries.length}`);
  for (const entry of entries) {
    assert.equal(entry.source, 'youtube');
    assert.match(entry.id, /^[\w-]{11}$/);
    assert.ok(entry.title, `entry ${entry.id} parsed with no title`);
    assert.ok(entry.author, `entry ${entry.id} parsed with no author`);
    assert.match(entry.addedAt, /^\d{4}-\d{2}-\d{2}$/);
  }
  const ids = entries.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate video ids in the catalogue');
});

// The type annotation `readonly YoutubeVideo[]` carries a bracket pair of its
// own. Anchoring on the first `[` after the declaration matches that one, which
// closes immediately and reports an empty catalogue rather than failing.
test('parseEntries is not fooled by the array type annotation', () => {
  const entries = parseEntries(
    "const YOUTUBE_VIDEOS: readonly YoutubeVideo[] = [\n  {\n    source: 'youtube',\n" +
      "    id: 'aaaaaaaaaaa',\n    title: 'One',\n    author: 'Someone',\n    addedAt: '2026-01-01',\n  },\n];\n" +
      'const MISTBOARD_CHANNEL_VIDEOS: readonly YoutubeVideo[] = [];\n',
  );
  assert.equal(entries.length, 1);
  assert.equal(entries[0].title, 'One');
});

test('parseEntries can read the Bilibili shelf without adding it to the YouTube audit', () => {
  const source = `${SOURCE}\nconst BILIBILI_VIDEOS: readonly BilibiliVideo[] = [
    { source: 'bilibili', bvid: 'BV1xx411c7mD', title: '揭棋教学', author: '老师' },
  ];`;
  assert.ok(parseEntries(source).every((entry) => entry.source === 'youtube'));
  const entries = parseEntries(source, ['BILIBILI_VIDEOS']);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].bvid, 'BV1xx411c7mD');
  assert.equal(entries[0].title, '揭棋教学');
  assert.equal(source.slice(entries[0].start, entries[0].end), entries[0].body);
});

test('field reads both quote styles', () => {
  assert.equal(field("  title: 'Plain',", 'title'), 'Plain');
  assert.equal(field('  title: "Men\'s Final",', 'title'), "Men's Final");
  assert.equal(field("  title: 'It\\'s fine',", 'title'), "It's fine");
  assert.equal(field("  author: 'Chan',", 'title'), null);
});

test('the catalogue really does mix quote styles', () => {
  assert.match(SOURCE, /title: "/, 'expected at least one double-quoted title');
  assert.match(SOURCE, /title: '/, 'expected at least one single-quoted title');
});

test('withDuration inserts after author, at the right indent, once', () => {
  const body = "  {\n    id: 'aaaaaaaaaaa',\n    author: 'Chan',\n    tags: ['games'],\n  }";
  const once = withDuration(body, 24);
  assert.match(once, /author: 'Chan',\n {4}durationMinutes: 24,\n {4}tags:/);
  assert.equal(withDuration(once, 99), once, 'a second pass must not add a second field');
});

test('withDuration anchors past a double-quoted author', () => {
  const body = '  {\n    author: "O\'Brien",\n    tags: [],\n  }';
  assert.match(withDuration(body, 7), /author: "O'Brien",\n {4}durationMinutes: 7,/);
});

test('durationToMinutes never rounds a short video to zero', () => {
  assert.equal(durationToMinutes(40), 1);
  assert.equal(durationToMinutes(1), 1);
  assert.equal(durationToMinutes(1138), 19);
});

// A bot wall reported as rot would send someone deleting live entries out of
// the catalogue. It has to read as "we could not check", never as "it is gone".
test('isThrottle separates a bot wall from a dead video', () => {
  assert.equal(isThrottle('LOGIN_REQUIRED', 'Sign in to confirm you’re not a bot'), true);
  assert.equal(isThrottle('ERROR', 'Please try again later'), true);
  assert.equal(isThrottle('ERROR', 'Video unavailable'), false);
  assert.equal(isThrottle('LOGIN_REQUIRED', 'This video is private'), false);
  assert.equal(isThrottle('OK', null), false);
});

test('extractMetadata reads videoDetails, not a neighbouring blob', () => {
  const html =
    '{"playabilityStatus":{"status":"OK"},"videoDetails":{"videoId":"aaaaaaaaaaa",' +
    '"title":"A \\"quoted\\" title","lengthSeconds":"1138","viewCount":"12315",' +
    '"author":"Chess with Mustreader","isPrivate":false,"isLiveContent":false},' +
    '"related":{"viewCount":"999999999"},' +
    '"playerMicroformatRenderer":{"publishDate":"2021-03-04T00:00:00-08:00"}}';
  const meta = extractMetadata(html);
  assert.deepEqual(
    {
      status: meta.status,
      title: meta.title,
      lengthSeconds: meta.lengthSeconds,
      viewCount: meta.viewCount,
      author: meta.author,
      publishDate: meta.publishDate,
      isLive: meta.isLive,
    },
    {
      status: 'OK',
      title: 'A "quoted" title',
      lengthSeconds: 1138,
      viewCount: 12315,
      author: 'Chess with Mustreader',
      publishDate: '2021-03-04',
      isLive: false,
    },
  );
});

test('extractMetadata survives a page with no player response', () => {
  const meta = extractMetadata('<html><body>consent wall</body></html>');
  assert.equal(meta.status, null);
  assert.equal(meta.lengthSeconds, null);
  assert.equal(meta.viewCount, null);
});
