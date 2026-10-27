#!/usr/bin/env node
// Harvest verified historical games out of dpxq.com's master-games archive.
//
// Why this exists: the champions article needs representative games for ~21
// national champions, and hand-recovering each one does not scale. dpxq has
// the archive but publishes no API, and its search UI renders results through
// a chain of JS frames, so "just use the search page" is not a plan either.
//
// Solved 2026-08-27: /hldcg/search/search.asp accepts the query directly as
// GB18030-encoded params (owner/red/black/event/date/result/page) and returns
// server-rendered rows. Each row carries owner+id; the game record then lives
// at /hldcg/search/view_<owner>_<id>.html with the mainline in a JS variable
// (DhtmlXQ_movelist), NOT in the [DhtmlXQ_movelist] tag, which ships empty.
//
//   node scripts/dpxq-archive-harvest.mjs --red 杨官 --event 全国象棋个人赛
//   node scripts/dpxq-archive-harvest.mjs --player 胡荣华 --pages 3 --out ./games
//   node scripts/dpxq-archive-harvest.mjs --red 吕钦 --json
//   node scripts/dpxq-archive-harvest.mjs --tour 12286 --player 唐丹 --out ./games
//   node scripts/dpxq-archive-harvest.mjs --ids m_138545,m_138533 --out ./games
//
// Since October 2026 search.asp answers "AI爬虫机器人太多了,请先登陆" (log in
// first) instead of rows, so --player/--red/--black/--event/--date stop with an
// error naming the wall. The record pages are still public: --tour reads a
// tournament's game list (/hldcg/movelist_<tour>.html, ids from the year pages
// /hldcg/index_<year>.html) and keeps the rows naming --player; --ids takes the
// keys directly.
//
// Every game is replayed through our own converter and rule engine before it
// is reported; anything that does not replay legally is dropped and counted.
// Moves only. dpxq's annotations are third-party authored work and are never
// read or written by this script (see docs-private/famous-games-canon.md).
//
// Read-only against dpxq. Fetches public pages at a polite pace.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  convertWxfDhtmlXqPageToSnapshot,
  STANDARD_DHTMLXQ_BINIT,
} from '../apps/server/dist/xiangqi-broadcast-wxf-dhtmlxq.js';
import { createInitialXiangqiState } from '../packages/game/dist/variants-xiangqi.js';
import {
  applyStandardXiangqiMove,
  getStandardXiangqiLegalMoves,
} from '../packages/game/dist/variants-xiangqi-standard.js';
import { formatXiangqiMoves } from '../packages/game/dist/xiangqi-notation-format.js';
import {
  harvestMode,
  hasTarget,
  idRows,
  isLoginWall,
  parseArgs,
  parseRows,
  parseTourRows,
} from './lib/dpxq-harvest-args.mjs';

const HOST = 'http://www.dpxq.com';
const REQUEST_TIMEOUT_MS = 20000;
const POLITE_DELAY_MS = 400;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// dpxq is GB18030 end to end: the query string is percent-encoded GB18030 and
// the response is GB18030. Some rarer hanzi (璘) round-trip badly, so prefer a
// two-character surname+given prefix over a full name when a search comes back
// empty.
function encodeGb(value) {
  const bytes = new TextEncoder('gb18030');
  // Node has no GB18030 encoder; build percent-encoding from the decoder's
  // inverse by round-tripping through a lookup of the source characters.
  void bytes;
  return [...value]
    .map((ch) => {
      const code = ch.codePointAt(0);
      if (code < 0x80) return encodeURIComponent(ch);
      const buf = gbEncodeChar(ch);
      return buf
        ? [...buf].map((b) => `%${b.toString(16).toUpperCase().padStart(2, '0')}`).join('')
        : '';
    })
    .join('');
}

// Minimal GB18030 encoder by decoder inversion: walk candidate byte pairs once
// and cache. Enough for names and event titles, which is all we send.
const gbCache = new Map();
let gbTable = null;
function buildGbTable() {
  if (gbTable) return gbTable;
  gbTable = new Map();
  const decoder = new TextDecoder('gb18030');
  for (let hi = 0x81; hi <= 0xfe; hi += 1) {
    for (let lo = 0x40; lo <= 0xfe; lo += 1) {
      if (lo === 0x7f) continue;
      const ch = decoder.decode(new Uint8Array([hi, lo]));
      if (ch.length === 1 && !gbTable.has(ch)) gbTable.set(ch, new Uint8Array([hi, lo]));
    }
  }
  return gbTable;
}
function gbEncodeChar(ch) {
  if (gbCache.has(ch)) return gbCache.get(ch);
  const found = buildGbTable().get(ch) ?? null;
  gbCache.set(ch, found);
  return found;
}

async function fetchGbOnce(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: `${HOST}/hldcg/search/` },
    });
    if (!response.ok) {
      const err = new Error(`HTTP ${response.status} for ${url}`);
      err.status = response.status;
      throw err;
    }
    return new TextDecoder('gb18030').decode(new Uint8Array(await response.arrayBuffer()));
  } finally {
    clearTimeout(timer);
  }
}

// dpxq answers 503 when it decides you are going too fast, and a run of deep
// harvests will trip it. That is a politeness signal, not a failure: back off
// and try again rather than losing the whole sweep.
async function fetchGb(url, attempt = 0) {
  try {
    return await fetchGbOnce(url);
  } catch (error) {
    const retriable = error.status === 503 || error.status === 429 || error.name === 'AbortError';
    if (!retriable || attempt >= 4) throw error;
    const backoffMs = POLITE_DELAY_MS * 4 * 2 ** attempt;
    console.error(`  backing off ${backoffMs}ms after ${error.status ?? error.name}`);
    await sleep(backoffMs);
    return await fetchGb(url, attempt + 1);
  }
}

function searchUrl({ library, red, black, event, date, page }) {
  const params = {
    site: 'www.dpxq.com',
    owner: library,
    e: '',
    p: '',
    red,
    black,
    result: '',
    title: '',
    date,
    class: '',
    event,
    open: '',
    order: '',
    page: String(page),
  };
  const qs = Object.entries(params)
    .map(([key, value]) => `${key}=${encodeGb(String(value))}`)
    .join('&');
  return `${HOST}/hldcg/search/search.asp?${qs}`;
}

// The record page ships [DhtmlXQ_movelist] EMPTY and puts the real mainline in
// a JS variable, with variations appended as [0_7_1]-style branch blocks. Take
// the mainline only.
function mainlineFrom(html) {
  const raw = html.match(/DhtmlXQ_movelist\s*=\s*'([^']*)'/)?.[1];
  if (!raw) return null;
  const wrapped = raw.match(/\[0_1_0\]([0-9]+)\[\/0_1_0\]/)?.[1];
  const moves = wrapped ?? raw.replace(/\[[^\]]*\]/g, '');
  const digits = moves.replace(/[^0-9]/g, '');
  return digits.length >= 4 && digits.length % 4 === 0 ? digits : null;
}

function tagFrom(html, tag) {
  return (
    html.match(new RegExp(`\\[DhtmlXQ_${tag}\\]([\\s\\S]*?)\\[/DhtmlXQ_${tag}\\]`))?.[1]?.trim() ??
    ''
  );
}

// Rebuild a minimal DhtmlXQ frame so the game goes through the SAME converter
// the broadcast pipeline uses. Legality is then checked by our own rule engine
// rather than trusted from the source.
// Our rule engine auto-terminates on repetition and on the progress clock.
// Real tournament games run past both: an arbiter applies the Chinese
// perpetual-check/chase rules instead of an automatic draw, and long endgames
// outlast the progress clock. So a replay that stops is not proof of a bad
// record, and treating it as one silently discards genuine history. Classify
// the stop instead of collapsing every failure into "illegal".
function classifyReplayStop(moves) {
  let state = createInitialXiangqiState('harvest');
  for (let i = 0; i < moves.length; i += 1) {
    const move = moves[i];
    const legal = getStandardXiangqiLegalMoves(state).some(
      (candidate) => candidate.from === move.from && candidate.to === move.to,
    );
    if (!legal) {
      const terminal = state.status?.type === 'finished';
      return {
        kind: terminal ? 'terminated_early' : 'illegal',
        ply: i + 1,
        reason: terminal
          ? (state.status.reason ?? 'finished')
          : 'move is not legal in this position',
      };
    }
    state = applyStandardXiangqiMove(state, move);
  }
  return { kind: 'clean', ply: moves.length, reason: null };
}

function verify(html, movelist, key) {
  const frame = [
    '[DhtmlXQiFrame]',
    `[DhtmlXQ_title]${tagFrom(html, 'title')}[/DhtmlXQ_title]`,
    `[DhtmlXQ_event]${tagFrom(html, 'event')}[/DhtmlXQ_event]`,
    `[DhtmlXQ_date]${tagFrom(html, 'date')}[/DhtmlXQ_date]`,
    `[DhtmlXQ_red]${tagFrom(html, 'red')}[/DhtmlXQ_red]`,
    `[DhtmlXQ_black]${tagFrom(html, 'black')}[/DhtmlXQ_black]`,
    `[DhtmlXQ_result]${tagFrom(html, 'result')}[/DhtmlXQ_result]`,
    `[DhtmlXQ_binit]${STANDARD_DHTMLXQ_BINIT}[/DhtmlXQ_binit]`,
    `[DhtmlXQ_movelist]${movelist}[/DhtmlXQ_movelist]`,
    '[/DhtmlXQiFrame]',
  ].join('\n');
  const converted = convertWxfDhtmlXqPageToSnapshot(frame, {
    tourSlug: 'dpxq-archive',
    roundId: `dpxq-${key}`,
  });
  if (!converted.ok) return { ok: false, issues: converted.issues };
  void key;
  const board = converted.snapshot.boards[0];
  if (!board)
    return { ok: false, issues: [{ kind: 'no_board', message: 'converter produced no board' }] };
  return { ok: true, board };
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  // dpxq filters by seat, so "every game this player appeared in" is two
  // queries, not one. --player runs both; --red/--black pin the seat.
  const queries = args.player
    ? [
        { red: args.player, black: '' },
        { red: '', black: args.player },
      ]
    : [{ red: args.red, black: args.black }];
  if (!hasTarget(args)) {
    console.error(
      'refusing to harvest the whole archive: pass --player, --red, --black, --event, --date, --tour or --ids',
    );
    process.exit(1);
  }
  // Each source yields pages of rows; the search yields one page per request.
  const sources = [];
  const mode = harvestMode(args);
  if (mode === 'ids') {
    sources.push(async function* () {
      yield idRows(args.ids);
    });
  } else if (mode === 'tour') {
    sources.push(async function* () {
      const html = await fetchGb(`${HOST}/hldcg/movelist_${args.tour}.html`);
      yield parseTourRows(html, args.player);
    });
  } else {
    for (const query of queries) {
      sources.push(async function* () {
        for (let page = 1; page <= args.pages; page += 1) {
          const html = await fetchGb(
            searchUrl({
              library: args.library,
              red: query.red,
              black: query.black,
              event: args.event,
              date: args.date,
              page,
            }),
          );
          if (isLoginWall(html)) {
            throw new Error(
              'dpxq search asks for a login (AI爬虫…请先登陆); use --tour <id> --player <name> or --ids instead',
            );
          }
          const rows = parseRows(html).map((row) => ({ ...row, fromSearch: true }));
          if (rows.length === 0) return;
          yield rows;
          if (page < args.pages) await sleep(POLITE_DELAY_MS);
        }
      });
    }
  }

  const seen = new Set();
  const games = [];
  const failures = [];

  for (const source of sources) {
    for await (const rows of source()) {
      for (const row of rows) {
        const key = `${row.owner}_${row.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (args.limit && games.length >= args.limit) break;
        await sleep(POLITE_DELAY_MS);
        let record;
        try {
          record = await fetchGb(`${HOST}/hldcg/search/view_${row.owner}_${row.id}.html`);
        } catch (error) {
          failures.push({ key, title: row.title, reason: String(error.message ?? error) });
          continue;
        }
        const movelist = mainlineFrom(record);
        if (!movelist) {
          failures.push({
            key,
            title: row.title,
            reason: 'no mainline movelist on the record page',
          });
          continue;
        }
        const checked = verify(record, movelist, key);
        let board;
        let replay = { kind: 'clean', ply: movelist.length / 4, reason: null };
        if (checked.ok) {
          board = checked.board;
        } else {
          // Rebuild the board without the converter's replay gate so we can say
          // WHY it stopped. Only a genuinely illegal move disqualifies a record.
          const moves = [];
          for (let i = 0; i < movelist.length; i += 4) {
            const sq = (c) => `${'abcdefghi'[Number(c[0])]}${10 - Number(c[1])}`;
            moves.push({
              from: sq(movelist.slice(i, i + 2)),
              to: sq(movelist.slice(i + 2, i + 4)),
            });
          }
          replay = classifyReplayStop(moves);
          if (replay.kind === 'illegal') {
            failures.push({ key, title: row.title, reason: `illegal move at ply ${replay.ply}` });
            continue;
          }
          const [redName, blackName] = [tagFrom(record, 'red'), tagFrom(record, 'black')];
          board = {
            red: { name: redName },
            black: { name: blackName },
            result: { 红胜: '1-0', 黑胜: '0-1', 和棋: '1/2-1/2' }[tagFrom(record, 'result')] ?? '*',
            moves,
          };
        }
        games.push({
          key,
          sourceUrl: `${HOST}/hldcg/search/view_${row.owner}_${row.id}.html`,
          // A search row's text is the game's title; a tour row's is the match
          // row, so take the record's own title there.
          title: row.fromSearch ? row.title : tagFrom(record, 'title') || row.title,
          event: tagFrom(record, 'event'),
          date: tagFrom(record, 'date'),
          place: tagFrom(record, 'place'),
          open: tagFrom(record, 'open'),
          red: board.red.name,
          black: board.black.name,
          result: board.result,
          plies: board.moves.length,
          replay: replay.kind,
          ...(replay.kind === 'terminated_early'
            ? { replayStoppedAtPly: replay.ply, replayStopReason: replay.reason }
            : {}),
          movelist,
          moves: board.moves,
        });
      }
      if (args.limit && games.length >= args.limit) break;
    }
    if (args.limit && games.length >= args.limit) break;
  }

  if (args.out) {
    mkdirSync(args.out, { recursive: true });
    for (const game of games) {
      const wxf = formatXiangqiMoves(game.moves, 'wxf');
      const zh = formatXiangqiMoves(game.moves, 'chinese-simplified');
      writeFileSync(
        join(args.out, `${game.key}.json`),
        `${JSON.stringify({ ...game, wxf, chinese: zh }, null, 2)}\n`,
      );
    }
  }

  if (args.json) {
    console.log(JSON.stringify({ games, failures }, null, 2));
    return;
  }
  console.log(`verified ${games.length} game(s)${args.out ? ` -> ${args.out}` : ''}`);
  for (const game of games) {
    const flag =
      game.replay === 'clean'
        ? ''
        : `  [engine stopped at ply ${game.replayStoppedAtPly}: ${game.replayStopReason}]`;
    console.log(
      `  ${game.key.padEnd(10)} ${(game.date || '????-??-??').padEnd(11)} ${game.result.padEnd(7)} ${game.plies.toString().padStart(3)}p  ${game.title}${flag}`,
    );
  }
  if (failures.length) {
    console.log(`\ndropped ${failures.length}:`);
    for (const failure of failures)
      console.log(`  ${failure.key.padEnd(10)} ${failure.reason}  ${failure.title}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
