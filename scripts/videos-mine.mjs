// Finds xiangqi videos worth adding to the /videos library.
//
// The catalogue is hand-curated, which is right, but hand-curated has meant
// hand-FOUND: someone remembering a channel and pasting an id. That biases the
// library toward whoever was already known, and it shows — one channel holds
// half the English shelf, and the last entry landed 2026-08-18.
//
// This sweeps YouTube search over a fixed query set, drops everything already
// catalogued or already declined, and ranks what is left by the same measure
// videos-data.ts is ordered by, so a candidate can be compared against the
// entries it would sit next to. It proposes; a human still picks, tags, and
// writes the entry. Nothing here edits the catalogue.
//
//   node scripts/videos-mine.mjs                  both query sets
//   node scripts/videos-mine.mjs --language en    one of them
//   node scripts/videos-mine.mjs --min-views 2000 raise the floor (default 500)
//   node scripts/videos-mine.mjs --json out.json  machine-readable candidates
//   node scripts/videos-mine.mjs --all           keep off-topic results too
//   node scripts/videos-mine.mjs --reject ID,ID   add ids to the declined ledger
//   node scripts/videos-mine.mjs --source bilibili --json out.json
//     Chinese jieqi first, then xiangqi teaching; proposal only. A Bilibili
//     rejection can be recorded with --reject BV... (or bb:BV...). Stops on
//     the first API failure; a partial sweep is never written as a proposal.
//
// The declined ledger (scripts/data/videos-declined.json) is why a second run is
// useful: without it every sweep re-proposes the same rejects, including the
// seven this repo cut on 2026-08-28, and the output stops being read.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BROWSER_HEADERS,
  fetchYoutubePage,
  mapWithConcurrency,
  parseEmbeddedObjects,
} from './lib/youtube.mjs';
import { parseEntries } from './videos-audit.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = resolve(HERE, '../apps/web/src/videos-data.ts');
const DECLINED_PATH = resolve(HERE, 'data/videos-declined.json');

// Queries are weighted toward the shelves the catalogue is thin on rather than
// toward what it already has: another "how to play" video is not what is
// missing. English endgame and midgame video is the biggest hole (four English
// endgame entries, three of them under 600 views), so it gets the most queries.
const QUERIES = {
  en: [
    'xiangqi endgame tutorial',
    'chinese chess endgame lesson english',
    'xiangqi middlegame strategy english',
    'xiangqi tactics lesson english',
    'chinese chess opening theory english',
    'xiangqi for chess players',
    'chinese chess explained english',
    'xiangqi game commentary english',
    'learn xiangqi english lesson',
    'chinese chess documentary english',
  ],
  zh: [
    '象棋残局教学',
    '象棋中局技巧',
    '象棋杀法教学',
    '象棋布局讲解',
    '象棋入门教学',
    '象棋名局解说',
    '象棋大师对局解说',
    '象棋战术教学',
  ],
};

// YouTube's "Video" type filter: no playlists, no channels, no Shorts shelf.
const VIDEO_ONLY = 'EgIQAQ%3D%3D';

// One query at a time. Search pages are heavier than watch pages and a wider
// sweep loses whole queries to "fetch failed" partway through, which reads as an
// empty shelf rather than as an unasked question.
const CONCURRENCY = 1;

/** Does this result actually concern xiangqi?
 *
 *  It has to be asked. Half the English query set contains the word "chess", and
 *  YouTube reads "chinese chess opening theory english" as a strong signal for
 *  the English Opening: one sweep returned GothamChess on basic chess openings
 *  and Naroditsky on the Accelerated Dragon, both scoring far above every real
 *  candidate because a chess channel's reach dwarfs this whole niche. Ranking is
 *  no defence against an off-topic result -- it promotes it. */
export function isXiangqi(row) {
  // 国际象棋 is Western chess, and it contains 象棋. A bare 象棋 test therefore
  // reads a Chinese-language course on the Sicilian as a xiangqi video, which
  // the first Chinese sweep duly ranked tenth. Strip the compound first, then
  // ask -- so "中國象棋VS國際象棋" still qualifies on its 中國象棋 half.
  const text = `${row.title} ${row.author}`.replace(/[国國]际象棋|[国國]際象棋/g, ' ');
  return /xiangqi|xianqi|chinese chess|象棋|象戏|c[ờo]\s*t[ưu][ớo]ng/i.test(text);
}

/** "5:36" or "1:02:33" -> minutes, rounded like the catalogue rounds. */
export function parseLength(text) {
  if (!text) return null;
  const parts = text.split(':').map(Number);
  if (parts.some(Number.isNaN)) return null;
  const seconds = parts.reduce((total, part) => total * 60 + part, 0);
  return Math.max(1, Math.round(seconds / 60));
}

/** "178,996 views" -> 178996. Live rows say "watching", which is not a count. */
export function parseViews(text) {
  if (!text || /watching/i.test(text)) return null;
  const digits = text.replace(/[^\d]/g, '');
  return digits === '' ? null : Number(digits);
}

/** "5 years ago" -> days. Coarse on purpose: it only feeds a reach rate, and
 *  YouTube gives search results nothing finer. */
export function parseAgeDays(text) {
  const match = text?.match(/(\d+)\s*(second|minute|hour|day|week|month|year)/i);
  if (!match) return null;
  const scale = {
    second: 1 / 86400,
    minute: 1 / 1440,
    hour: 1 / 24,
    day: 1,
    week: 7,
    month: 30.4,
    year: 365,
  };
  return Number(match[1]) * scale[match[2].toLowerCase()];
}

/** Pull the video rows out of a search results page. */
export function extractSearchResults(html) {
  return parseEmbeddedObjects(html, '"videoRenderer":')
    .map((row) => {
      const title = row.title?.runs?.[0]?.text ?? row.title?.simpleText ?? null;
      const author = row.ownerText?.runs?.[0]?.text ?? row.longBylineText?.runs?.[0]?.text ?? null;
      if (!row.videoId || !title || !author) return null;
      return {
        id: row.videoId,
        title,
        author,
        durationMinutes: parseLength(row.lengthText?.simpleText),
        views: parseViews(row.viewCountText?.simpleText),
        ageDays: parseAgeDays(row.publishedTimeText?.simpleText),
      };
    })
    .filter((row) => row !== null);
}

// Views per day is only meaningful once a video has had a few weeks to find its
// audience. Below that the divisor does the ranking: the first Chinese sweep put
// a one-day-old upload with 1,530 views above a classic with 246,708, because
// 1530/1 beats 246708/1460. Everything under a quarter is scored as if it were a
// quarter old, which damps the spike without discarding a genuinely hot video:
// a 25-day-old video with 70k views still ranks first by an order of magnitude.
// videos-data.ts is ordered on the same floor, so a proposal here is directly
// comparable to the entries it would sit between.
const MIN_AGE_DAYS = 90;

/** The catalogue's ranking measure, so a candidate lands comparably: reach per
 *  day since publication, with clips of two minutes or less at half weight. */
export function score(candidate) {
  if (!candidate.views || !candidate.ageDays) return 0;
  const perDay = candidate.views / Math.max(MIN_AGE_DAYS, candidate.ageDays);
  return (candidate.durationMinutes ?? 99) <= 2 ? perDay / 2 : perDay;
}

// Back-to-back search requests get their connections reset, which surfaces as a
// bare "fetch failed" and costs a whole query -- five of ten in one sweep, and a
// missing query looks exactly like a shelf with nothing on it. The same queries
// succeed on their own, so the fix is pacing, not retries.
const PAUSE_MS = 1800;

export const BILIBILI_QUERIES = [
  '揭棋入门教学',
  '揭棋开局技巧',
  '揭棋中局战术',
  '揭棋残局教学',
  '揭棋实战讲解',
  '揭象棋教学',
  '象棋残局教学',
  '象棋中局教学',
  '象棋布局教学',
];

// Read the site's sanctions rather than maintain a second ban register. The
// source is a flat literal; fail closed if that contract changes. Reprimands
// are not bans (the same distinction as isBanned in sanctions.ts).
function bannedPlayerNames() {
  const source = readFileSync(resolve(HERE, '../apps/web/src/players/sanctions.ts'), 'utf8');
  const rows = [...source.matchAll(/^\s*([\p{Script=Han}]+): \{ penalty: '([^']+)' \}/gmu)];
  if (rows.length === 0) throw new Error('cannot read the player sanctions register');
  const names = rows.filter((row) => row[2] !== 'Reprimand').map((row) => row[1]);
  const aliases = readFileSync(
    resolve(HERE, '../apps/server/src/xiangqi-broadcast-translate.ts'),
    'utf8',
  );
  const english = [...aliases.matchAll(/\['([^']+)', '([^']+)'\]/g)]
    .filter((row) => names.includes(row[1]))
    .map((row) => row[2]);
  return [...names, ...english];
}

// Traditional forms occurring in the sanctions register. Whitespace, case and
// punctuation must not let "Wang Tianyi" or "王 天 一" evade the same filter.
function normalizePlayerText(text) {
  const traditional = '趙鄭謝躍鵬孫陽蔣張繼劉達鳴黨聶鐵強黃風楊銘瑋陸韜龍馬巋';
  const simplified = '赵郑谢跃鹏孙阳蒋张继刘达鸣党聂铁强黄风杨铭玮陆韬龙马岿';
  return text
    .toLowerCase()
    .replace(/[\p{P}\p{Z}\s]/gu, '')
    .replace(
      /[趙鄭謝躍鵬孫陽蔣張繼劉達鳴黨聶鐵強黃風楊銘瑋陸韜龍馬巋]/g,
      (char) => simplified[traditional.indexOf(char)],
    );
}

function bilibiliText(text) {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (entity, name) => {
      if (name[0] !== '#') {
        return { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' }[name.toLowerCase()];
      }
      const point =
        name[1].toLowerCase() === 'x' ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
      return point <= 0x10ffff ? String.fromCodePoint(point) : entity;
    });
}

function isEngineGuide(row) {
  const text = `${row.title} ${row.author}`;
  return (
    /引擎|软件|軟體|軟件|皮卡鱼|皮卡魚|佳佳|engine|pikafish|stockfish/i.test(text) &&
    /安装|安裝|下载|下載|install|download|setup|set[ -]?up/i.test(text)
  );
}

/** Proposal-only Bilibili sweep. All I/O and time are injectable for offline
 *  planted-filter tests. No retries or concurrent requests after an API error. */
export async function mineBilibili({
  catalogueSource = readFileSync(DATA_PATH, 'utf8'),
  declined = readBilibiliDeclined(),
  queries = BILIBILI_QUERIES,
  minViews = 500,
  keepOffTopic = false,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
  now = Date.now,
} = {}) {
  // Older checkouts predate #896's empty shelf; don't require a catalogue edit
  // just to run discovery. A present but malformed shelf still throws.
  const catalogued = new Set(
    /\bconst BILIBILI_VIDEOS\b/.test(catalogueSource)
      ? parseEntries(catalogueSource, ['BILIBILI_VIDEOS']).map((entry) => entry.bvid)
      : [],
  );
  const banned = bannedPlayerNames().map(normalizePlayerText);
  const eligible = (row) => {
    const text = normalizePlayerText(`${row.title} ${row.author}`);
    return (
      !banned.some((name) => text.includes(name)) &&
      !isEngineGuide(row) &&
      (keepOffTopic || isXiangqi(row) || /揭棋|揭象棋/.test(`${row.title} ${row.author}`)) &&
      row.views >= minViews
    );
  };
  const cookies = new Map();
  const request = async (url, api = true) => {
    if (api) await sleep(PAUSE_MS + Math.floor(Math.random() * 600));
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        'user-agent': BROWSER_HEADERS['user-agent'],
        accept: api ? 'application/json' : 'text/html',
        referer: 'https://search.bilibili.com/',
        ...(cookies.size
          ? { cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; ') }
          : {}),
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Bilibili stopped: HTTP ${response.status} at ${url}`);
    }
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';')[0];
      const equals = pair.indexOf('=');
      if (equals > 0) cookies.set(pair.slice(0, equals), pair.slice(equals + 1));
    }
    if (!api) {
      await response.body?.cancel();
      return null;
    }
    let body;
    try {
      if (!response.headers.get('content-type')?.includes('application/json')) {
        await response.body?.cancel();
        throw new Error();
      }
      body = await response.json();
    } catch {
      throw new Error(`Bilibili stopped: non-JSON response at ${url}`);
    }
    if (body?.code !== 0) {
      throw new Error(
        `Bilibili stopped: API ${body?.code ?? 'missing code'} (${body?.message ?? 'no message'}) at ${url}`,
      );
    }
    if (!body.data || typeof body.data !== 'object') {
      throw new Error(`Bilibili stopped: missing API data at ${url}`);
    }
    return body.data;
  };

  await request('https://www.bilibili.com/', false);
  if (cookies.size === 0) throw new Error('Bilibili stopped: homepage did not set cookies');
  const viewed = new Set();
  const candidates = new Map();
  for (const query of queries) {
    const url = new URL('https://api.bilibili.com/x/web-interface/search/type');
    url.search = new URLSearchParams({ search_type: 'video', keyword: query, page: '1' });
    const data = await request(url.toString());
    if (!Array.isArray(data.result)) throw new Error('Bilibili stopped: malformed search results');
    for (const raw of data.result) {
      const bvid = raw?.bvid;
      if (
        !/^BV[\da-zA-Z]{10}$/.test(bvid ?? '') ||
        catalogued.has(bvid) ||
        Object.hasOwn(declined, bvid) ||
        Object.hasOwn(declined, `bb:${bvid}`)
      )
        continue;
      if (viewed.has(bvid)) {
        const previous = candidates.get(bvid);
        if (previous && !previous.queries.includes(query)) previous.queries.push(query);
        continue;
      }
      if (typeof raw.title !== 'string' || typeof raw.author !== 'string') continue;
      if (
        !eligible({
          title: bilibiliText(raw.title),
          author: bilibiliText(raw.author),
          views: Number(raw.play),
        })
      )
        continue;
      viewed.add(bvid);
      const view = await request(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`);
      if (
        view.bvid !== bvid ||
        ![1, 2].includes(view.copyright) ||
        typeof view.title !== 'string' ||
        !view.title ||
        typeof view.owner?.name !== 'string' ||
        !view.owner.name ||
        !Number.isFinite(view.stat?.view) ||
        !Number.isFinite(view.duration) ||
        !Number.isFinite(view.pubdate) ||
        view.pubdate <= 0 ||
        typeof view.pic !== 'string'
      ) {
        throw new Error(`Bilibili stopped: malformed view metadata for ${bvid}`);
      }
      if (view.copyright === 2) continue;
      const row = {
        source: 'bilibili',
        bvid,
        title: bilibiliText(view.title),
        author: bilibiliText(view.owner.name),
        durationMinutes: Math.max(1, Math.round(view.duration / 60)),
        views: view.stat.view,
        ageDays: Math.max(1, (now() / 1000 - view.pubdate) / 86400),
        thumbnailUrl: view.pic.replace(/^\/\//, 'https://'),
        url: `https://www.bilibili.com/video/${bvid}`,
        queries: [query],
      };
      if (eligible(row)) candidates.set(bvid, { ...row, score: score(row) });
    }
  }
  return { candidates: [...candidates.values()].sort((a, b) => b.score - a.score) };
}

async function search(query, index) {
  if (index > 0) {
    await new Promise((done) => {
      setTimeout(done, PAUSE_MS + Math.random() * 600);
    });
  }
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=${VIDEO_ONLY}`;
  const { html, error } = await fetchYoutubePage(url, (page) =>
    // An empty result set and a bot wall look identical downstream. They are
    // told apart here: a real results page always carries the renderer key.
    page.includes('"videoRenderer":')
      ? null
      : 'no video results in page (bot wall or consent gate)',
  );
  if (error) return { query, error, results: [] };
  return { query, results: extractSearchResults(html) };
}

function readDeclined() {
  // A missing/corrupt ledger must stop a sweep, not put every reject back in play.
  return JSON.parse(readFileSync(DECLINED_PATH, 'utf8'));
}

function readBilibiliDeclined() {
  const ledger = readDeclined();
  return { ...ledger.declined, ...ledger.bilibiliDeclined };
}

/** Keep BVIDs out of the legacy YouTube-id ledger, which catalogue tests also
 *  enumerate. Accept bb: keys from the catalogue's source-namespaced format. */
export function declineVideos(ledger, ids, why) {
  for (const key of ids) {
    const bvid = key.replace(/^bb:/, '');
    if (/^BV[\da-zA-Z]{10}$/.test(bvid)) {
      ledger.bilibiliDeclined ??= {};
      ledger.bilibiliDeclined[bvid] = why;
    } else {
      ledger.declined[key] = why;
    }
  }
}

function formatViews(count) {
  if (count === null || count === undefined) return '—';
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${Math.round(count / 1_000)}k`;
  return String(count);
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name, fallback = null) => {
    const at = argv.indexOf(`--${name}`);
    return at === -1 ? fallback : argv[at + 1];
  };

  const rejectList = flag('reject');
  if (rejectList) {
    const ledger = readDeclined();
    const ids = rejectList
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    declineVideos(ledger, ids, flag('why', 'declined during a mining sweep'));
    writeFileSync(DECLINED_PATH, `${JSON.stringify(ledger, null, 2)}\n`);
    console.log(
      `Declined ledger now holds ${Object.keys(ledger.declined).length} YouTube ids and ${Object.keys(ledger.bilibiliDeclined ?? {}).length} Bilibili ids.`,
    );
    return;
  }

  const source = flag('source', 'youtube');
  if (!['youtube', 'bilibili'].includes(source))
    throw new Error(`unknown video source "${source}"`);

  const language = flag('language');
  const minViews = Number(flag('min-views', '500'));
  const jsonPath = flag('json');
  const keepOffTopic = argv.includes('--all');
  if (source === 'bilibili') {
    if (language && language !== 'zh')
      throw new Error('Bilibili discovery supports --language zh only');
    const result = await mineBilibili({ minViews, keepOffTopic });
    console.log(`BILIBILI — ${result.candidates.length} proposals (catalogue unchanged)`);
    for (const row of result.candidates.slice(0, 30)) {
      console.log(
        `  ${row.score.toFixed(1)}  ${formatViews(row.views)}  ${row.durationMinutes}m  ${row.author}  ${row.title}\n    ${row.url}`,
      );
    }
    if (jsonPath)
      writeFileSync(
        jsonPath,
        `${JSON.stringify({ minedAt: new Date().toISOString(), source, language: 'zh', ...result }, null, 2)}\n`,
      );
    return;
  }
  const languages = language ? [language] : Object.keys(QUERIES);
  for (const lang of languages) {
    if (!QUERIES[lang]) throw new Error(`no query set for language "${lang}"`);
  }

  const catalogued = new Set(
    parseEntries(readFileSync(DATA_PATH, 'utf8')).map((entry) => entry.id),
  );
  const declined = readDeclined().declined;
  const knownAuthors = new Set(
    parseEntries(readFileSync(DATA_PATH, 'utf8')).map((entry) => entry.author),
  );

  for (const lang of languages) {
    const queries = QUERIES[lang];
    console.log(
      `\n${'='.repeat(78)}\n${lang.toUpperCase()} — ${queries.length} queries\n${'='.repeat(78)}`,
    );
    const pages = await mapWithConcurrency(queries, CONCURRENCY, search);

    const failed = pages.filter((page) => page.error);
    for (const page of failed) console.log(`  ! "${page.query}": ${page.error}`);

    // Dedupe across queries, keeping the richest row for each id.
    const seen = new Map();
    for (const page of pages) {
      for (const row of page.results) {
        const existing = seen.get(row.id);
        if (!existing || (existing.views ?? 0) < (row.views ?? 0)) {
          seen.set(row.id, { ...row, queries: [...(existing?.queries ?? []), page.query] });
        } else {
          existing.queries.push(page.query);
        }
      }
    }

    const candidates = [...seen.values()]
      .filter((row) => !catalogued.has(row.id))
      .filter((row) => !(row.id in declined))
      .filter((row) => keepOffTopic || isXiangqi(row))
      .filter((row) => (row.views ?? 0) >= minViews)
      .map((row) => ({ ...row, score: score(row), newChannel: !knownAuthors.has(row.author) }))
      .sort((a, b) => b.score - a.score);

    const rows = [...seen.values()];
    console.log(
      `  ${seen.size} distinct results, ` +
        `${rows.filter((row) => catalogued.has(row.id)).length} already catalogued, ` +
        `${rows.filter((row) => row.id in declined).length} previously declined, ` +
        `${rows.filter((row) => !isXiangqi(row)).length} not about xiangqi, ` +
        `${candidates.length} candidates over ${minViews} views\n`,
    );

    console.log('   score   views   len  new?  channel                    title');
    for (const row of candidates.slice(0, 30)) {
      console.log(
        `  ${row.score.toFixed(1).padStart(6)}  ${formatViews(row.views).padStart(6)}  ` +
          `${String(row.durationMinutes ?? '?').padStart(3)}m  ${row.newChannel ? ' NEW' : '    '}  ` +
          `${row.author.slice(0, 24).padEnd(25)}${row.title.slice(0, 62)}`,
      );
      console.log(`          https://www.youtube.com/watch?v=${row.id}`);
    }

    if (jsonPath) {
      writeFileSync(
        jsonPath.replace(/\.json$/, `.${lang}.json`),
        `${JSON.stringify({ minedAt: new Date().toISOString(), language: lang, candidates }, null, 2)}\n`,
      );
    }
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
