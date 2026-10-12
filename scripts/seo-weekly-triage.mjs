#!/usr/bin/env node
// Weekly search triage: one short markdown page from files the Monday pull
// already wrote, so the growth read starts from what moved instead of from a
// hand-run analysis.
//
// Reads (all under --dir, default docs-private/seo/gsc):
//   gsc-daily.tsv                  Google site totals (no privacy suppression)
//   gsc-windows-{query,page,country}.tsv
//                                  last7 / prior7 / last28 / prior28 / before7
//                                  (tools/scripts/gsc-pull.py, `windows = true`)
//   bing-daily.tsv, bing-queries.tsv, bing-pages.tsv
//                                  tools/scripts/bing-pull.py; when bing-daily
//                                  is missing, Bing clicks come from the
//                                  life-os numbers cache (--bing-cache)
//   terms-history.tsv              npm run seo:terms
// Writes docs-private/seo/weekly/<today>.md (or --out).
//
//   node scripts/seo-weekly-triage.mjs
//   node scripts/seo-weekly-triage.mjs --dir <gsc dir> --out <file.md> --date 2026-10-12
//
// Run by tools/scripts/run-gsc-pull.sh after a successful Monday pull.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ZH_MARKETS = ['twn', 'hkg', 'chn', 'sgp', 'mys'];
const COUNTRY_NAMES = {
  twn: 'Taiwan',
  hkg: 'Hong Kong',
  chn: 'China',
  sgp: 'Singapore',
  mys: 'Malaysia',
  usa: 'US',
  vnm: 'Vietnam',
  gbr: 'UK',
  can: 'Canada',
  aus: 'Australia',
  ind: 'India',
  deu: 'Germany',
  fra: 'France',
  jpn: 'Japan',
  kor: 'Korea',
  mac: 'Macau',
  bra: 'Brazil',
  idn: 'Indonesia',
  phl: 'Philippines',
  tha: 'Thailand',
  nld: 'Netherlands',
  esp: 'Spain',
  ita: 'Italy',
  rus: 'Russia',
  nzl: 'New Zealand',
};

// ── parsing ────────────────────────────────────────────────────────────────

/** TSV text -> array of objects keyed by the header row. Numeric-looking
 * cells stay strings; callers convert the columns they use. */
export function parseTsv(text) {
  const lines = text.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
  if (!lines.length) return [];
  const header = lines[0].split('\t');
  return lines.slice(1).map((line) => {
    const cells = line.split('\t');
    return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? '']));
  });
}

function readTsv(path) {
  return existsSync(path) ? parseTsv(readFileSync(path, 'utf8')) : null;
}

export function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Search Console page URL -> path, so tables stay narrow. */
export function shortPage(url) {
  try {
    const u = new URL(url);
    return decodeURIComponent(u.pathname) + u.search;
  } catch {
    return url;
  }
}

// ── aggregation ────────────────────────────────────────────────────────────

/** Sum rows into {clicks, impressions, ctr, position}; position is
 * impression-weighted over rows that have one (Bing writes -1 for none). */
export function aggregate(rows, posKey = 'position') {
  let clicks = 0;
  let impressions = 0;
  let posWeight = 0;
  let posSum = 0;
  let hasImpressions = false;
  for (const r of rows) {
    const c = Number(r.clicks) || 0;
    const i = r.impressions === undefined ? null : Number(r.impressions) || 0;
    clicks += c;
    if (i !== null) {
      hasImpressions = true;
      impressions += i;
      const p = Number(r[posKey]);
      if (Number.isFinite(p) && p > 0 && i > 0) {
        posSum += p * i;
        posWeight += i;
      }
    }
  }
  return {
    clicks,
    impressions: hasImpressions ? impressions : null,
    ctr: hasImpressions && impressions ? clicks / impressions : null,
    position: posWeight ? posSum / posWeight : null,
  };
}

/** last7 / prior7 / last28 / prior28 date ranges ending at `end` (inclusive). */
export function windowRanges(end) {
  return {
    last7: [addDays(end, -6), end],
    prior7: [addDays(end, -13), addDays(end, -7)],
    last28: [addDays(end, -27), end],
    prior28: [addDays(end, -55), addDays(end, -28)],
  };
}

/** Daily rows ({date, clicks, impressions?, position?}) -> totals per window,
 * anchored on the newest date. A prior window that starts before the data
 * does is marked partial (null), never compared as if it were whole. */
export function dailyWindows(rows, posKey = 'position') {
  if (!rows?.length) return null;
  const dates = rows.map((r) => r.date).sort();
  const first = dates[0];
  const end = dates.at(-1);
  const out = { end, first };
  for (const [name, [from, to]] of Object.entries(windowRanges(end))) {
    out[name] =
      from < first
        ? null
        : aggregate(
            rows.filter((r) => r.date >= from && r.date <= to),
            posKey,
          );
  }
  return out;
}

/** Windowed TSV rows -> Map<window, Map<key, totals>>. */
export function byWindow(rows, keyCol) {
  const out = new Map();
  for (const r of rows ?? []) {
    if (!out.has(r.window)) out.set(r.window, new Map());
    const m = out.get(r.window);
    const key = r[keyCol];
    const prev = m.get(key);
    const cur = aggregate([r]);
    m.set(key, prev ? aggregate([prev, cur].map(toRow)) : cur);
  }
  return out;
}

function toRow(t) {
  return { clicks: t.clicks, impressions: t.impressions, position: t.position };
}

/** Bucketed rows ({date, <keyCol>, ...}) -> the same shape as byWindow for
 * last7 / prior7, anchored on the newest date. Bing's query and page stats
 * come in weekly buckets, so each window usually holds one bucket. */
export function bucketWindows(rows, keyCol, posKey) {
  if (!rows?.length) return null;
  const end = rows
    .map((r) => r.date)
    .sort()
    .at(-1);
  const ranges = windowRanges(end);
  const out = new Map();
  for (const name of ['last7', 'prior7']) {
    const [from, to] = ranges[name];
    const groups = new Map();
    for (const r of rows) {
      if (r.date < from || r.date > to) continue;
      if (!groups.has(r[keyCol])) groups.set(r[keyCol], []);
      groups.get(r[keyCol]).push(r);
    }
    out.set(name, new Map([...groups].map(([k, rs]) => [k, aggregate(rs, posKey)])));
  }
  out.end = end;
  return out;
}

const EMPTY = { clicks: 0, impressions: 0, ctr: null, position: null };

/** Biggest impression (then click) changes between two windows. */
export function movers(cur, prev, n = 5) {
  const keys = new Set([...(cur?.keys() ?? []), ...(prev?.keys() ?? [])]);
  const rows = [...keys].map((key) => {
    const a = cur?.get(key) ?? EMPTY;
    const b = prev?.get(key) ?? EMPTY;
    return {
      key,
      cur: a,
      prev: b,
      dImpr: (a.impressions ?? 0) - (b.impressions ?? 0),
      dClicks: a.clicks - b.clicks,
    };
  });
  const score = (r) => r.dImpr + 10 * r.dClicks;
  const tie = (x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0);
  return {
    gainers: rows
      .filter((r) => score(r) > 0)
      .sort((x, y) => score(y) - score(x) || tie(x, y))
      .slice(0, n),
    losers: rows
      .filter((r) => score(r) < 0)
      .sort((x, y) => score(x) - score(y) || tie(x, y))
      .slice(0, n),
  };
}

/** Keys with impressions in last7 that had none in the rest of the window. */
export function newKeys(last7, before7, n = 8) {
  return [...(last7 ?? new Map())]
    .filter(([k, t]) => (t.impressions ?? 0) > 0 && !before7?.has(k))
    .map(([key, t]) => ({ key, ...t }))
    .sort(
      (a, b) => b.impressions - a.impressions || b.clicks - a.clicks || (a.key < b.key ? -1 : 1),
    )
    .slice(0, n);
}

/** Last-28 keys worth a title or content pass: page-one-or-two positions
 * (5-15) with real impressions, or high impressions at a low CTR. */
export function opportunities(
  window28,
  { minImpr = 20, lowCtr = 0.02, highImpr = 100, n = 8 } = {},
) {
  const out = [];
  for (const [key, t] of window28 ?? new Map()) {
    const impr = t.impressions ?? 0;
    const why = [];
    if (t.position !== null && t.position >= 5 && t.position <= 15 && impr >= minImpr)
      why.push('pos 5-15');
    if (impr >= highImpr && (t.ctr ?? 0) < lowCtr) why.push('low CTR');
    if (why.length) out.push({ key, ...t, why: why.join(', ') });
  }
  return out.sort((a, b) => b.impressions - a.impressions || (a.key < b.key ? -1 : 1)).slice(0, n);
}

/** Country rows for the zh markets (always) and the biggest other movers. */
export function countryShifts(win, n = 5) {
  const row = (key, a, b) => ({ key, cur: a ?? EMPTY, prev: b ?? EMPTY });
  const zh = ZH_MARKETS.map((c) => ({
    ...row(c, win.get('last7')?.get(c), win.get('prior7')?.get(c)),
    cur28: win.get('last28')?.get(c) ?? EMPTY,
    prev28: win.get('prior28')?.get(c) ?? EMPTY,
  }));
  const { gainers, losers } = movers(win.get('last28'), win.get('prior28'), 50);
  const others = [...gainers, ...losers]
    .filter((r) => !ZH_MARKETS.includes(r.key))
    .sort((a, b) => Math.abs(b.dImpr) - Math.abs(a.dImpr))
    .slice(0, n);
  return { zh, others };
}

/** terms-history.tsv -> the newest pull's rows with the previous pull's
 * position beside each. */
export function termsDelta(rows) {
  if (!rows?.length) return null;
  const dates = [...new Set(rows.map((r) => r.pulled_on))].sort();
  const latest = dates.at(-1);
  const before = dates.at(-2) ?? null;
  const prevPos = new Map(
    rows.filter((r) => r.pulled_on === before).map((r) => [r.term, num(r.position)]),
  );
  return {
    latest,
    before,
    terms: rows
      .filter((r) => r.pulled_on === latest)
      .map((r) => ({
        term: r.term,
        impressions: Number(r.impressions) || 0,
        clicks: Number(r.clicks) || 0,
        position: num(r.position),
        prevPosition: prevPos.get(r.term) ?? null,
        page: r.top_page || '',
      })),
  };
}

function num(s) {
  if (s === '' || s === undefined || s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// ── worth a look ───────────────────────────────────────────────────────────

const pct = (a, b) => (b ? Math.round(((a - b) / b) * 100) : null);
const signed = (n) => (n > 0 ? `+${n}` : `${n}`);
const pctText = (a, b) => {
  const p = pct(a, b);
  return p === null ? 'new' : `${signed(p)}%`;
};
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const fmtPos = (p) => (p === null || p === undefined ? '-' : p.toFixed(1));
const fmtCtr = (c) => (c === null || c === undefined ? '-' : `${(c * 100).toFixed(1)}%`);

/** At most five observations, each with its numbers, in a fixed priority
 * order; a candidate earns a line only past its threshold. */
export function worthALook(m) {
  const out = [];
  const totalLine = (label, w) => {
    if (!w?.last7 || !w?.prior7) return;
    const a = w.last7.clicks;
    const b = w.prior7.clicks;
    if (Math.abs(a - b) >= 5 && (b === 0 || Math.abs(a - b) / b >= 0.25)) {
      const impr =
        w.last7.impressions !== null && w.prior7.impressions !== null
          ? `; impressions ${w.last7.impressions} vs ${w.prior7.impressions} (${pctText(w.last7.impressions, w.prior7.impressions)})`
          : '';
      out.push(
        `${label} clicks ${a} in the last 7 days vs ${b} the 7 before (${pctText(a, b)})${impr}.`,
      );
    }
  };
  totalLine('Google', m.google);
  totalLine('Bing', m.bing);

  const zhMove = (m.countries?.zh ?? [])
    .map((r) => ({ ...r, d: (r.cur.impressions ?? 0) - (r.prev.impressions ?? 0) }))
    .filter(
      (r) => Math.abs(r.d) >= 30 && Math.abs(r.d) >= 0.25 * Math.max(r.prev.impressions ?? 0, 1),
    )
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))[0];
  if (zhMove) {
    out.push(
      `${COUNTRY_NAMES[zhMove.key]} (Google) impressions ${zhMove.cur.impressions} vs ${zhMove.prev.impressions} the week before (${pctText(zhMove.cur.impressions, zhMove.prev.impressions)}), clicks ${zhMove.cur.clicks} vs ${zhMove.prev.clicks}.`,
    );
  }

  // One bullet per query: a query that is both the top gainer and new is
  // said once, and the opportunity line skips queries already named.
  const seen = new Set();
  const isNew = new Set((m.newQueries ?? []).map((r) => r.key));
  const g = m.queryMovers?.gainers?.[0];
  if (g && g.dImpr >= 20) {
    seen.add(g.key);
    const before = isNew.has(g.key)
      ? 'new this week, none in the 12 weeks before'
      : `vs ${g.prev.impressions} the week before`;
    out.push(
      `Query "${g.key}" gained most: ${g.cur.impressions} impressions (${before}), ${plural(g.cur.clicks, 'click')}, position ${fmtPos(g.cur.position)}.`,
    );
  }
  const l = m.queryMovers?.losers?.[0];
  if (l && l.dImpr <= -20) {
    seen.add(l.key);
    out.push(
      `Query "${l.key}" lost most: ${l.cur.impressions} impressions vs ${l.prev.impressions}, position ${fmtPos(l.cur.position)} (was ${fmtPos(l.prev.position)}).`,
    );
  }
  const op = (m.queryOpportunities ?? []).find((r) => !seen.has(r.key));
  if (op) {
    seen.add(op.key);
    out.push(
      `Opportunity "${op.key}": ${op.impressions} impressions over 28 days at position ${fmtPos(op.position)}, CTR ${fmtCtr(op.ctr)} (${op.why}).`,
    );
  }
  const term = (m.terms?.terms ?? [])
    .filter((t) => t.position !== null && t.prevPosition !== null)
    .map((t) => ({ ...t, d: t.prevPosition - t.position }))
    .filter((t) => Math.abs(t.d) >= 2)
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))[0];
  if (term) {
    out.push(
      `Tracked term "${term.term}" moved to position ${fmtPos(term.position)} from ${fmtPos(term.prevPosition)} (90-day average, ${term.impressions} impressions).`,
    );
  }
  const nq = (m.newQueries ?? []).find((r) => !seen.has(r.key));
  if (nq && nq.impressions >= 10) {
    seen.add(nq.key);
    out.push(
      `New query "${nq.key}": ${nq.impressions} impressions this week at position ${fmtPos(nq.position)}, none in the 12 weeks before.`,
    );
  }
  const pl = m.pageMovers?.losers?.[0];
  if (pl && pl.dImpr <= -30) {
    out.push(
      `Page ${shortPage(pl.key)} lost most: ${pl.cur.impressions} impressions vs ${pl.prev.impressions}, ${pl.cur.clicks} vs ${plural(pl.prev.clicks, 'click')}.`,
    );
  }
  return out.slice(0, 5);
}

// ── rendering ──────────────────────────────────────────────────────────────

const esc = (s) => String(s).replace(/\|/g, '\\|');

function totalsRows(label, w) {
  if (!w) return [`| ${label} | no data | | | |`];
  const cell = (name, field, fmt) => {
    const t = w[name];
    if (!t || t[field] === null) return '-';
    return fmt(t[field]);
  };
  const delta = (cur, prev, field) => {
    const a = w[cur];
    const b = w[prev];
    if (!a || !b || a[field] === null || b[field] === null) return '';
    if (field === 'position') return ` (was ${b.position.toFixed(1)})`;
    if (field === 'ctr') return ` (was ${fmtCtr(b.ctr)})`;
    return ` (${pctText(a[field], b[field])})`;
  };
  const line = (span, cur, prev) =>
    `| ${label} ${span} | ${cell(cur, 'clicks', String)}${delta(cur, prev, 'clicks')} | ${cell(cur, 'impressions', String)}${delta(cur, prev, 'impressions')} | ${cell(cur, 'ctr', fmtCtr)}${delta(cur, prev, 'ctr')} | ${cell(cur, 'position', fmtPos)}${delta(cur, prev, 'position')} |`;
  const rows = [line('7d', 'last7', 'prior7')];
  rows.push(
    w.last28 && w.prior28
      ? line('28d', 'last28', 'prior28')
      : `| ${label} 28d | prior 28 days not in the data yet (starts ${w.first}) | | | |`,
  );
  return rows;
}

function moverTable(title, mv, fmtKey) {
  const lines = [`**${title}**`, '', '| | Impr | Clicks | Pos |', '|---|---|---|---|'];
  const row = (r) =>
    `| ${esc(fmtKey(r.key))} | ${r.cur.impressions ?? 0} (${signed(r.dImpr)}) | ${r.cur.clicks} (${signed(r.dClicks)}) | ${fmtPos(r.cur.position)} (was ${fmtPos(r.prev.position)}) |`;
  if (!mv.gainers.length && !mv.losers.length) return [`**${title}**: no change.`, ''];
  for (const r of mv.gainers) lines.push(row(r));
  if (mv.gainers.length && mv.losers.length) lines.push('| ... | | | |');
  for (const r of mv.losers) lines.push(row(r));
  lines.push('');
  return lines;
}

function keyTable(rows, fmtKey, extra = null) {
  const head = extra ? '| | Impr | Clicks | CTR | Pos | Why |' : '| | Impr | Clicks | Pos |';
  const sep = extra ? '|---|---|---|---|---|---|' : '|---|---|---|---|';
  return [
    head,
    sep,
    ...rows.map((r) =>
      extra
        ? `| ${esc(fmtKey(r.key))} | ${r.impressions} | ${r.clicks} | ${fmtCtr(r.ctr)} | ${fmtPos(r.position)} | ${r.why} |`
        : `| ${esc(fmtKey(r.key))} | ${r.impressions} | ${r.clicks} | ${fmtPos(r.position)} |`,
    ),
    '',
  ];
}

export function renderMarkdown(m) {
  const L = [];
  const g = m.google;
  L.push(`# Search triage, ${m.date}`);
  L.push('');
  const src = [];
  if (g) src.push(`Google to ${g.end}`);
  if (m.bing)
    src.push(
      `Bing to ${m.bing.end}${m.bingSource === 'cache' ? ' (clicks only, life-os cache)' : ''}`,
    );
  L.push(`${src.join('; ')}. Windows end on each source's newest day. Position: lower is better.`);
  L.push('');

  L.push('## Worth a look');
  L.push('');
  const wal = worthALook(m);
  if (wal.length) for (const w of wal) L.push(`- ${w}`);
  else L.push('- Nothing past the thresholds this week.');
  L.push('');

  L.push('## Totals');
  L.push('');
  L.push('| | Clicks | Impressions | CTR | Position |');
  L.push('|---|---|---|---|---|');
  L.push(...totalsRows('Google', g));
  L.push(...totalsRows('Bing', m.bing));
  L.push('');

  if (m.missingWindows) {
    L.push(
      '_No gsc-windows-*.tsv in the pull: movers, new keys and countries need `windows = true` for the site in tools/scripts/gsc-pull.toml._',
    );
    L.push('');
  } else {
    L.push('## Movers (Google, last 7 vs prior 7)');
    L.push('');
    L.push(...moverTable('Queries', m.queryMovers, (k) => k));
    L.push(...moverTable('Pages', m.pageMovers, shortPage));

    L.push('## New this week (Google)');
    L.push('');
    L.push('Impressions in the last 7 days, none in the rest of the 90-day window.');
    L.push('');
    if (m.newQueries.length) L.push('**Queries**', '', ...keyTable(m.newQueries, (k) => k));
    else L.push('No new queries.', '');
    if (m.newPages.length) L.push('**Pages**', '', ...keyTable(m.newPages, shortPage));
    else L.push('No new pages.', '');

    L.push('## Opportunities (Google, last 28 days)');
    L.push('');
    if (m.queryOpportunities.length)
      L.push('**Queries**', '', ...keyTable(m.queryOpportunities, (k) => k, true));
    if (m.pageOpportunities.length)
      L.push('**Pages**', '', ...keyTable(m.pageOpportunities, shortPage, true));
    if (!m.queryOpportunities.length && !m.pageOpportunities.length)
      L.push('None past the thresholds.', '');

    L.push('## Countries (Google)');
    L.push('');
    L.push('| | Impr 7d | Clicks 7d | Impr 28d | Clicks 28d | Pos 28d |');
    L.push('|---|---|---|---|---|---|');
    const name = (c) => COUNTRY_NAMES[c] ?? c.toUpperCase();
    for (const r of m.countries.zh) {
      L.push(
        `| **${name(r.key)}** | ${r.cur.impressions ?? 0} (was ${r.prev.impressions ?? 0}) | ${r.cur.clicks} (was ${r.prev.clicks}) | ${r.cur28.impressions ?? 0} (was ${r.prev28.impressions ?? 0}) | ${r.cur28.clicks} (was ${r.prev28.clicks}) | ${fmtPos(r.cur28.position)} |`,
      );
    }
    for (const r of m.countries.others) {
      L.push(
        `| ${name(r.key)} | | | ${r.cur.impressions ?? 0} (was ${r.prev.impressions ?? 0}) | ${r.cur.clicks} (was ${r.prev.clicks}) | ${fmtPos(r.cur.position)} |`,
      );
    }
    L.push('');
    L.push('Bold rows are the zh markets (growth lane 0); the rest are the biggest 28-day movers.');
    L.push('');
  }

  L.push('## Bing (last 7 vs prior 7)');
  L.push('');
  if (m.bingQueryMovers) {
    L.push(...moverTable('Queries', m.bingQueryMovers, (k) => k));
    L.push(...moverTable('Pages', m.bingPageMovers, shortPage));
  } else {
    L.push(
      'No Bing query or page data (tools/scripts/bing-pull.py has not written bing-queries.tsv).',
    );
    L.push('');
  }

  L.push('## Tracked terms (Google, 90-day average)');
  L.push('');
  if (m.terms) {
    L.push(`Pull of ${m.terms.latest}${m.terms.before ? ` vs ${m.terms.before}` : ''}.`);
    L.push('');
    L.push('| Term | Pos | Was | Impr | Clicks | Ranking page |');
    L.push('|---|---|---|---|---|---|');
    for (const t of m.terms.terms) {
      L.push(
        `| ${esc(t.term)} | ${fmtPos(t.position)} | ${fmtPos(t.prevPosition)} | ${t.impressions} | ${t.clicks} | ${esc(t.page || 'not shown')} |`,
      );
    }
  } else {
    L.push('No terms-history.tsv (npm run seo:terms).');
  }
  L.push('');
  return L.join('\n');
}

// ── assembly ───────────────────────────────────────────────────────────────

/** Read every input under `dir` into the model renderMarkdown takes. */
export function buildModel({ dir, bingCache, date }) {
  const daily = readTsv(join(dir, 'gsc-daily.tsv'));
  const google = dailyWindows(daily);

  let bing = null;
  let bingSource = null;
  const bingDaily = readTsv(join(dir, 'bing-daily.tsv'));
  if (bingDaily?.length) {
    bing = dailyWindows(bingDaily, 'none');
    bingSource = 'pull';
  } else if (bingCache && existsSync(bingCache)) {
    const rows = JSON.parse(readFileSync(bingCache, 'utf8'))?.bing_mistboard_clicks?.rows;
    if (rows) {
      bing = dailyWindows(Object.entries(rows).map(([d, clicks]) => ({ date: d, clicks })));
      bingSource = 'cache';
    }
  }

  const wq = readTsv(join(dir, 'gsc-windows-query.tsv'));
  const wp = readTsv(join(dir, 'gsc-windows-page.tsv'));
  const wc = readTsv(join(dir, 'gsc-windows-country.tsv'));
  const model = { date, google, bing, bingSource, missingWindows: !wq || !wp || !wc };
  if (!model.missingWindows) {
    const q = byWindow(wq, 'query');
    const p = byWindow(wp, 'page');
    const c = byWindow(wc, 'country');
    Object.assign(model, {
      queryMovers: movers(q.get('last7'), q.get('prior7')),
      pageMovers: movers(p.get('last7'), p.get('prior7')),
      newQueries: newKeys(q.get('last7'), q.get('before7')),
      newPages: newKeys(p.get('last7'), p.get('before7')),
      queryOpportunities: opportunities(q.get('last28')),
      pageOpportunities: opportunities(p.get('last28'), { minImpr: 30 }),
      countries: countryShifts(c),
    });
  }

  const bq = readTsv(join(dir, 'bing-queries.tsv'));
  const bp = readTsv(join(dir, 'bing-pages.tsv'));
  if (bq?.length && bp?.length) {
    const qw = bucketWindows(bq, 'query', 'avg_impression_position');
    const pw = bucketWindows(bp, 'page', 'avg_impression_position');
    model.bingQueryMovers = movers(qw.get('last7'), qw.get('prior7'));
    model.bingPageMovers = movers(pw.get('last7'), pw.get('prior7'));
  }

  model.terms = termsDelta(readTsv(join(dir, 'terms-history.tsv')));
  return model;
}

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
}

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const dir = resolve(arg('--dir', join(root, 'docs-private/seo/gsc')));
  const date = arg('--date', localToday());
  const out = resolve(arg('--out', join(dir, '..', 'weekly', `${date}.md`)));
  const bingCache = arg(
    '--bing-cache',
    join(homedir(), 'projects/life-os/data/state/numbers-bing.json'),
  );
  if (!existsSync(join(dir, 'gsc-daily.tsv'))) {
    console.error(`no gsc-daily.tsv in ${dir}`);
    process.exit(1);
  }
  const md = renderMarkdown(buildModel({ dir, bingCache, date }));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, md);
  console.log(out);
}
