#!/usr/bin/env node
// Where release wall-clock goes, from the records release-prod.mjs writes.
//
// Every `npm run release:prod` appends one JSON line to
// ~/.local/share/mistboard/releases.jsonl (MISTBOARD_RELEASE_LOG overrides)
// whether it passed or failed: the stages it ran with their durations, the
// revisions, the gate and smoke tier, the CI run. Until 2026-09-23 the only
// record of a release was the session transcript, which is why the September
// profile (2.5 min of every deploy compiling engines) took an afternoon of
// transcript parsing; --import-transcripts recovers those older releases into
// the same file so the series does not start from zero.
//
//   npm run release:profile                    medians per stage, last 14 days
//   npm run release:profile -- --since 30d     wider window
//   npm run release:profile -- --html          write the chart page and print its path
//   npm run release:profile -- --html --open   ...and open it
//   npm run release:profile -- --import-transcripts   backfill from ~/.claude transcripts
//
// The chart is one self-contained HTML file (inline SVG, no dependencies):
// whole-release wall clock per release, deploy time (push to live) where a
// deploy happened, failures as their own marks, and a weekly median line.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export const DEFAULT_LOG = path.join(homedir(), '.local', 'share', 'mistboard', 'releases.jsonl');
const TRANSCRIPT_DIR = path.join(
  homedir(),
  '.claude',
  'projects',
  '-Users-brianliou-projects-mistboard',
);

function main(args) {
  const options = parseArgs(args);
  const logPath = options.log;
  if (options.importTranscripts) {
    const added = importTranscripts({ logPath, transcriptDir: options.transcriptDir });
    console.log(`imported ${added} release record(s) from transcripts into ${logPath}`);
  }
  const records = readRecords(logPath);
  const since = Date.now() - options.sinceMs;
  const window = records.filter((record) => Date.parse(record.startedAt) >= since);
  printSummary(window, options);
  if (options.html || options.svgPath) {
    const html = renderChart(records);
    if (options.html) {
      const out = options.htmlPath ?? path.join(path.dirname(logPath), 'releases.html');
      writeFileSync(out, html);
      console.log(`chart: ${out}`);
      if (options.open) spawnSync('open', [out], { stdio: 'ignore' });
    }
    if (options.svgPath) {
      // The chart alone, for a page that embeds it (every style is an attribute).
      const svg = html.slice(html.indexOf('<svg'), html.indexOf('</svg>') + 6);
      writeFileSync(options.svgPath, `<?xml version="1.0" encoding="UTF-8"?>\n${svg}\n`);
      console.log(`svg: ${options.svgPath}`);
    }
  }
}

export function parseArgs(args) {
  const options = {
    log: process.env.MISTBOARD_RELEASE_LOG || DEFAULT_LOG,
    sinceMs: 14 * 86_400_000,
    html: false,
    htmlPath: null,
    svgPath: null,
    open: false,
    importTranscripts: false,
    transcriptDir: TRANSCRIPT_DIR,
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--since') options.sinceMs = parseWindow(args[++i]);
    else if (arg === '--html') {
      options.html = true;
      if (args[i + 1] && !args[i + 1].startsWith('--')) options.htmlPath = args[++i];
    } else if (arg === '--open') options.open = true;
    else if (arg === '--svg') options.svgPath = args[++i];
    else if (arg === '--log') options.log = args[++i];
    else if (arg === '--import-transcripts') options.importTranscripts = true;
    else if (arg === '--transcript-dir') options.transcriptDir = args[++i];
    else if (arg === '--help' || arg === '-h') {
      const header = readFileSync(new URL(import.meta.url), 'utf8')
        .split('\n')
        .slice(1, 22);
      console.log(header.map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
      process.exit(0);
    } else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

export function parseWindow(text) {
  const match = /^(\d+)([dhw])$/.exec(text ?? '');
  if (!match) throw new Error(`--since wants 7d, 36h or 2w, got ${text}`);
  const unit = { h: 3_600_000, d: 86_400_000, w: 7 * 86_400_000 }[match[2]];
  return Number(match[1]) * unit;
}

export function readRecords(logPath) {
  if (!existsSync(logPath)) return [];
  const records = [];
  for (const line of readFileSync(logPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      if (record && typeof record.startedAt === 'string') records.push(record);
    } catch {
      // A torn line from a release killed mid-write is not a reason to lose the rest.
    }
  }
  return records.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
}

// --- summary -----------------------------------------------------------------

export function summarize(records) {
  const ok = records.filter((r) => r.outcome === 'ok');
  const failed = records.filter((r) => r.outcome !== 'ok');
  const stages = new Map();
  for (const record of records) {
    for (const stage of record.stages ?? []) {
      if (!stages.has(stage.label)) stages.set(stage.label, []);
      stages.get(stage.label).push(stage.ms);
    }
  }
  const deploys = ok.map(deployMs).filter((ms) => ms !== null);
  return {
    count: records.length,
    ok: ok.length,
    failed: failed.length,
    total: quantiles(ok.map((r) => r.elapsedMs)),
    deploy: quantiles(deploys),
    stages: [...stages.entries()]
      .map(([label, values]) => ({ label, ...quantiles(values) }))
      .sort((a, b) => b.p50 - a.p50),
    failures: countBy(failed.map((r) => failureClass(r))),
  };
}

// Push-to-live: from the end of the push stage to the end of the revision wait.
// A record imported from a transcript preview may not carry deployRequired;
// a revision wait that ran and passed is the deploy having happened.
export function deployMs(record) {
  if (record.deployRequired === false) return null;
  const push = (record.stages ?? []).find((s) => s.label === 'git push release head');
  const wait = (record.stages ?? []).find((s) => s.label === 'production revision wait');
  if (!push?.startedAt || !wait?.startedAt) return null;
  const pushEnd = Date.parse(push.startedAt) + push.ms;
  const liveAt = Date.parse(wait.startedAt) + wait.ms;
  return liveAt > pushEnd ? liveAt - pushEnd : null;
}

// One name per way a release attempt dies, so the failure table reads as a
// list of causes rather than of stage labels.
export function failureClass(record) {
  const text = record.error ?? '';
  if (/superseded/.test(text)) return 'superseded by a later push';
  if (/drain token/i.test(text)) return 'drain token unusable';
  if (/hosted CI (failed|has a failed)/.test(text)) return 'hosted CI red';
  if (/smokes? failed|smoke: FAILED/i.test(text)) return 'prod smoke failed';
  if (/clean worktree/.test(text)) return 'dirty worktree';
  if (/timed out waiting/.test(text)) return 'CI wait timed out';
  const stage =
    (record.stages ?? []).find((s) => s.ok === false)?.label ?? record.failedStage ?? null;
  if (stage === 'git push release head') return 'push rejected (main moved)';
  if (stage === 'production drain') return 'drain failed';
  if (stage === 'production revision wait') return 'production never served the revision';
  if (stage === 'hosted CI wait') return 'hosted CI red';
  if (stage && /^prod /.test(stage)) return 'prod smoke failed';
  if (stage) return `local gate: ${stage}`;
  return 'unknown (output cut short)';
}

export function quantiles(values) {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const at = (q) =>
    sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : null;
  return { n: sorted.length, p50: at(0.5), p90: at(0.9), max: sorted.at(-1) ?? null };
}

function countBy(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function printSummary(records, options) {
  const s = summarize(records);
  const days = Math.round(options.sinceMs / 86_400_000);
  console.log(`# releases, last ${days} day(s): ${s.count} (${s.ok} ok, ${s.failed} failed)`);
  if (s.count === 0) {
    console.log('no records in the window; run a release, or --import-transcripts for history');
    return;
  }
  console.log(`whole release (ok):   ${fmtQ(s.total)}`);
  console.log(`deploy, push to live: ${fmtQ(s.deploy)}`);
  console.log('\nstages (ok or failed), by median:');
  for (const stage of s.stages) console.log(`  ${stage.label.padEnd(34)} ${fmtQ(stage)}`);
  if (s.failures.length) {
    console.log(`\nfailed attempts, ${s.failed} of ${s.count} (${pct(s.failed, s.count)}):`);
    for (const [name, n] of s.failures) {
      console.log(`  ${String(n).padStart(3)}  ${pct(n, s.count).padStart(4)}  ${name}`);
    }
  }
  console.log(`\nattempts per day: ${(s.count / Math.max(1, days)).toFixed(1)}`);
}

function fmtQ(q) {
  if (!q || q.n === 0) return 'n=0';
  return `n=${String(q.n).padStart(3)}  p50 ${fmt(q.p50).padStart(7)}  p90 ${fmt(q.p90).padStart(7)}  max ${fmt(q.max).padStart(7)}`;
}

function pct(n, of) {
  return of ? `${Math.round((100 * n) / of)}%` : '-';
}

export function fmt(ms) {
  if (ms === null || ms === undefined) return '-';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, '0')}s`;
}

// --- chart -------------------------------------------------------------------

export function renderChart(records) {
  const points = records
    .map((r) => ({
      t: Date.parse(r.startedAt),
      total: r.elapsedMs,
      deploy: deployMs(r),
      ok: r.outcome === 'ok',
      head: (r.head ?? '').slice(0, 8),
      source: r.source ?? 'release',
    }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.total));
  if (points.length === 0)
    return `<!doctype html><title>Release times</title><p>No records yet.</p>`;

  const W = 960;
  const H = 420;
  const L = 56;
  const R = 16;
  const T = 24;
  const B = 44;
  const t0 = Math.min(...points.map((p) => p.t));
  const t1 = Math.max(...points.map((p) => p.t), t0 + 1);
  const yMax = Math.max(8 * 60_000, ...points.map((p) => Math.min(p.total, 20 * 60_000)));
  const x = (t) => L + ((t - t0) / (t1 - t0)) * (W - L - R);
  const y = (ms) => T + (1 - Math.min(ms, yMax) / yMax) * (H - T - B);

  const weekly = weeklyMedians(points.filter((p) => p.ok));
  const path = weekly
    .map((w, i) => `${i ? 'L' : 'M'}${x(w.t).toFixed(1)},${y(w.p50).toFixed(1)}`)
    .join(' ');

  const gridlines = [];
  for (let m = 0; m <= yMax / 60_000; m += 2) {
    gridlines.push(
      `<line x1="${L}" x2="${W - R}" y1="${y(m * 60_000).toFixed(1)}" y2="${y(m * 60_000).toFixed(1)}" stroke="#e5e0d5"/>` +
        `<text x="${L - 8}" y="${(y(m * 60_000) + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="#6b6459">${m}m</text>`,
    );
  }
  const days = [];
  for (let t = startOfDay(t0); t <= t1; t += 86_400_000) {
    const d = new Date(t);
    if (d.getUTCDate() % 3 === 1 || t1 - t0 < 4 * 86_400_000) {
      days.push(
        `<text x="${x(t).toFixed(1)}" y="${H - B + 18}" text-anchor="middle" font-size="11" fill="#6b6459">${d.toISOString().slice(5, 10)}</text>`,
      );
    }
  }

  const marks = points
    .map((p) => {
      const title = `${new Date(p.t).toISOString().slice(0, 16).replace('T', ' ')}Z ${p.head} ${p.ok ? 'ok' : 'failed'} ${fmt(p.total)}${p.deploy ? `, deploy ${fmt(p.deploy)}` : ''}${p.source === 'transcript' ? ' (from transcript)' : ''}`;
      const total = p.ok
        ? `<circle cx="${x(p.t).toFixed(1)}" cy="${y(p.total).toFixed(1)}" r="3.5" fill="#2f6f9f" opacity="0.85"><title>${escapeXml(title)}</title></circle>`
        : `<path d="M${(x(p.t) - 4).toFixed(1)},${(y(p.total) - 4).toFixed(1)} l8,8 m0,-8 l-8,8" stroke="#b8443a" stroke-width="1.6"><title>${escapeXml(title)}</title></path>`;
      const deploy = p.deploy
        ? `<rect x="${(x(p.t) - 2.5).toFixed(1)}" y="${y(p.deploy).toFixed(1)}" width="5" height="5" fill="#c58a1a" opacity="0.9"><title>${escapeXml(title)}</title></rect>`
        : '';
      return total + deploy;
    })
    .join('\n');

  const last = summarize(records.filter((r) => Date.parse(r.startedAt) >= t1 - 7 * 86_400_000));
  const month = summarize(records.filter((r) => Date.parse(r.startedAt) >= t1 - 30 * 86_400_000));
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Release times</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { --bg: #f7f4ee; --ink: #1f1c18; --muted: #6b6459; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #16150f; --ink: #ece7dc; --muted: #a39b8c; } }
  :root[data-theme="dark"] { --bg: #16150f; --ink: #ece7dc; --muted: #a39b8c; }
  body { margin: 0; padding: 24px 16px; background: var(--bg); color: var(--ink); font: 14px/1.45 -apple-system, system-ui, sans-serif; }
  main { max-width: 992px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p { color: var(--muted); margin: 0 0 12px; }
  svg { width: 100%; height: auto; display: block; background: #fffdf8; border: 1px solid #e5e0d5; border-radius: 6px; }
  .legend span { display: inline-block; margin-right: 16px; }
  .legend i { display: inline-block; width: 10px; height: 10px; margin-right: 6px; vertical-align: -1px; }
  table { border-collapse: collapse; margin-top: 16px; font-variant-numeric: tabular-nums; }
  td, th { text-align: left; padding: 3px 12px 3px 0; border-bottom: 1px solid #e5e0d5; }
</style></head><body><main>
<h1>Release times</h1>
<p>${points.length} releases, ${new Date(t0).toISOString().slice(0, 10)} to ${new Date(t1).toISOString().slice(0, 10)}. Y axis clipped at ${Math.round(yMax / 60_000)} minutes.</p>
<div class="legend"><span><i style="background:#2f6f9f;border-radius:50%"></i>whole release, ok</span><span><i style="background:#c58a1a"></i>deploy, push to live</span><span><i style="color:#b8443a;font-style:normal">✕</i>failed attempt</span><span><i style="background:#2f6f9f;height:2px;vertical-align:3px"></i>weekly median</span></div>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Release duration per release over time" font-family="-apple-system, system-ui, sans-serif" style="background:#fffdf8">
${gridlines.join('\n')}
${days.join('\n')}
<path d="${path}" fill="none" stroke="#2f6f9f" stroke-width="2" opacity="0.7"/>
${marks}
</svg>
<table><tr><th>last 7 days</th><th>n</th><th>p50</th><th>p90</th></tr>
<tr><td>whole release (ok)</td><td>${last.total.n}</td><td>${fmt(last.total.p50)}</td><td>${fmt(last.total.p90)}</td></tr>
<tr><td>deploy, push to live</td><td>${last.deploy.n}</td><td>${fmt(last.deploy.p50)}</td><td>${fmt(last.deploy.p90)}</td></tr>
${last.stages.map((s) => `<tr><td>${escapeXml(s.label)}</td><td>${s.n}</td><td>${fmt(s.p50)}</td><td>${fmt(s.p90)}</td></tr>`).join('\n')}
</table>
<table><tr><th>failed attempts, last 30 days</th><th>n</th><th>of ${month.count}</th></tr>
${month.failures.map(([name, n]) => `<tr><td>${escapeXml(name)}</td><td>${n}</td><td>${pct(n, month.count)}</td></tr>`).join('\n')}
</table>
</main></body></html>
`;
}

function weeklyMedians(points) {
  const buckets = new Map();
  for (const p of points) {
    const week = Math.floor(p.t / (7 * 86_400_000));
    if (!buckets.has(week)) buckets.set(week, []);
    buckets.get(week).push(p);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, ps]) => ({
      t: ps.reduce((s, p) => s + p.t, 0) / ps.length,
      p50: quantiles(ps.map((p) => p.total)).p50,
    }));
}

function startOfDay(t) {
  return Math.floor(t / 86_400_000) * 86_400_000;
}

function escapeXml(text) {
  return String(text).replace(
    /[<>&"]/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c],
  );
}

// --- transcript import ---------------------------------------------------------
//
// A release's console output lands in the session transcript as a tool result
// (or, when it is long, in a tool-results/*.txt file with only a preview in
// the transcript). Both carry the `# stage` / `started_at:` / `<stage>: ok in
// <duration>` lines that time-command.mjs prints, and the `release: ok in` or
// `release: failed after` line at the end. Records are deduplicated by the
// text's hash, and a release already recorded natively (same head, started
// within a minute) is skipped.

const STAGE_LINE =
  /^(?:== )?([A-Za-z][A-Za-z0-9 :._-]{2,60}?): (ok|failed) in ((?:\d+h )?(?:\d+m )?[\d.]+(?:ms|s))$/;
const RELEASE_LINE = /^release: (ok in|failed after) ((?:\d+h )?(?:\d+m )?[\d.]+(?:ms|s))/;

export function parseDuration(text) {
  if (/ms$/.test(text)) return Number.parseFloat(text);
  let ms = 0;
  for (const [, num, unit] of text.matchAll(/([\d.]+)([hms])/g)) {
    ms += Number.parseFloat(num) * { h: 3_600_000, m: 60_000, s: 1000 }[unit];
  }
  return Math.round(ms);
}

// One release record from one release's console text, or null if the text
// holds no `release:` outcome line. `fallbackStartedAt` is the transcript's
// timestamp for the message, used when no started_at line survived.
export function parseTranscriptRelease(text, fallbackStartedAt) {
  const outcome = RELEASE_LINE.exec(
    text
      .split('\n')
      .reverse()
      .find((l) => RELEASE_LINE.test(l)) ?? '',
  );
  if (!outcome) return null;
  const lines = text.split('\n');
  const stages = [];
  let pendingLabel = null;
  let pendingStart = null;
  let inFlight = null;
  let head = null;
  let firstStart = null;
  let gate = null;
  let smokeTier = null;
  let deployRequired = null;
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    if (
      line.startsWith('# ') &&
      !/^# (production release|hosted CI|engine-family|ci:)/.test(line)
    ) {
      pendingLabel = line.slice(2).trim();
      continue;
    }
    const start = /^started_at: (\S+)/.exec(line);
    if (start) {
      pendingStart = start[1];
      firstStart ??= start[1];
      inFlight = pendingLabel;
      continue;
    }
    const headLine = /^head: ([0-9a-f]{40})/.exec(line);
    if (headLine) head = headLine[1];
    const gateLine = /^local gate: (\w+) \(([^)]*)\)/.exec(line);
    if (gateLine) gate = { kind: gateLine[1], reason: gateLine[2] };
    const tierLine =
      /^smoke: (full|web|lite|none)/.exec(line) ?? /^smoke: full -> (web)/.exec(line);
    if (tierLine) smokeTier = tierLine[1];
    const deployLine = /^prod-smoke-plan: deploy_required=(true|false)/.exec(line);
    if (deployLine) deployRequired = deployLine[1] === 'true';
    const stage = STAGE_LINE.exec(line);
    if (stage && !stage[1].startsWith('release')) {
      const label = stage[1].replace(/^\d+[:-]/, '').trim();
      const ms = parseDuration(stage[3]);
      const startedAt =
        pendingLabel && label.startsWith(pendingLabel.slice(0, 12)) ? pendingStart : null;
      stages.push({ label, ms, ok: stage[2] === 'ok', ...(startedAt ? { startedAt } : {}) });
      pendingLabel = null;
      pendingStart = null;
      inFlight = null;
    }
  }
  // The stage that printed `failed in`, or, when the output was cut before that
  // line, the one that had started and never finished.
  const failedStage = stages.find((s) => s.ok === false) ?? (inFlight ? { label: inFlight } : null);
  const errorLine =
    outcome[1] === 'failed after'
      ? (lines[lines.findIndex((l) => RELEASE_LINE.test(l)) + 1] ?? '')
      : null;
  return {
    v: 1,
    source: 'transcript',
    startedAt: firstStart ?? fallbackStartedAt,
    elapsedMs: parseDuration(outcome[2]),
    outcome: outcome[1] === 'ok in' ? 'ok' : 'failed',
    ...(errorLine ? { error: errorLine.slice(0, 200) } : {}),
    head,
    deployRequired,
    gate,
    smokeTier,
    stages,
    ...(failedStage ? { failedStage: failedStage.label } : {}),
  };
}

// One release, however many copies of its output exist: the head, the minute
// it started, the outcome and the elapsed time.
function releaseKey(record) {
  const when = record.head ? record.head.slice(0, 12) : (record.startedAt ?? '').slice(0, 10);
  return `${when}|${record.outcome}|${record.elapsedMs}`;
}

export function importTranscripts({ logPath, transcriptDir }) {
  const existing = readRecords(logPath);
  const seen = new Set(existing.map((r) => r.hash).filter(Boolean));
  const known = new Set(existing.map(releaseKey));
  const nativeHeads = new Set(existing.filter((r) => r.source !== 'transcript').map((r) => r.head));
  const candidates = [];
  for (const [text, ts] of iterTranscriptTexts(transcriptDir)) {
    const hash = createHash('sha1').update(text).digest('hex').slice(0, 16);
    if (seen.has(hash)) continue;
    const record = parseTranscriptRelease(text, ts);
    if (!record?.startedAt) continue;
    if (record.head && nativeHeads.has(record.head)) continue;
    if (known.has(releaseKey(record))) continue;
    seen.add(hash);
    candidates.push({ ...record, hash });
  }
  // The same release can appear as a transcript preview AND a persisted full
  // output; keep the one with more stages.
  const best = new Map();
  for (const record of candidates) {
    const key = releaseKey(record);
    const prior = best.get(key);
    if (!prior || record.stages.length > prior.stages.length) best.set(key, record);
  }
  const fresh = [...best.values()].sort(
    (a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt),
  );
  if (fresh.length) {
    mkdirSync(path.dirname(logPath), { recursive: true });
    appendFileSync(logPath, `${fresh.map((r) => JSON.stringify(r)).join('\n')}\n`);
  }
  return fresh.length;
}

function* iterTranscriptTexts(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const results = path.join(full, 'tool-results');
      if (!existsSync(results)) continue;
      for (const file of readdirSync(results)) {
        if (!file.endsWith('.txt')) continue;
        const text = readFileSync(path.join(results, file), 'utf8');
        if (
          !RELEASE_LINE.test(text) &&
          !text.includes('release: ok in') &&
          !text.includes('release: failed after')
        )
          continue;
        const { mtime } = statSafe(path.join(results, file));
        yield [text, mtime];
      }
      continue;
    }
    if (!entry.name.endsWith('.jsonl')) continue;
    for (const line of readFileSync(full, 'utf8').split('\n')) {
      if (!line.includes('release: ok in') && !line.includes('release: failed after')) continue;
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      const content = parsed?.message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (block?.type !== 'tool_result') continue;
        const inner = block.content;
        const texts =
          typeof inner === 'string'
            ? [inner]
            : Array.isArray(inner)
              ? inner.filter((p) => p?.type === 'text').map((p) => p.text)
              : [];
        for (const text of texts) {
          if (text.includes('release: ok in') || text.includes('release: failed after'))
            yield [text, parsed.timestamp ?? null];
        }
      }
    }
  }
}

function statSafe(file) {
  try {
    return { mtime: statSync(file).mtime.toISOString() };
  } catch {
    return { mtime: null };
  }
}

// Last, after every module-level constant above is initialised: `main` reads
// the regexes near the bottom of the file, and a top-of-file call trips the
// temporal dead zone when the script is run directly (imports are fine).
const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname;
if (isMain) main(process.argv.slice(2));
