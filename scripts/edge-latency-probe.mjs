#!/usr/bin/env node
// Edge latency probe: how much the Cloudflare-proxied apex costs a visitor,
// city by city, against the direct Railway host the game socket uses.
//
// Runs Globalping HTTP probes (free, no key) from ~25 cities against
// /api/ping on both hosts, reusing the same probes for every round so the two
// paths are compared on identical machines. Reports per city the median
// time-to-first-byte after TLS (server + backhaul, the part a warm browser
// connection pays on every request), the Cloudflare colo that answered (the
// cf-ray suffix) and the Railway edge.
//
//   node scripts/edge-latency-probe.mjs [--rounds 3] [--label free-plan] [--out <dir>]
//
// Writes <out>/<YYYY-MM-DD>-<label>.json (raw measurements + summary). Default
// out: docs-private/perf/edge-latency. Re-run after a Cloudflare plan or
// routing change and compare the two files.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const API = 'https://api.globalping.io/v1/measurements';
const HOSTS = { apex: 'mistboard.com', direct: 'socket.mistboard.com' };
const LOCATIONS = [
  { magic: 'Seattle', limit: 2 },
  { magic: 'San Francisco', limit: 2 },
  { magic: 'Los Angeles' },
  { magic: 'New York', limit: 2 },
  { magic: 'Chicago', limit: 2 },
  { magic: 'Dallas' },
  { magic: 'Toronto' },
  { magic: 'London', limit: 2 },
  { magic: 'Frankfurt', limit: 2 },
  { magic: 'Singapore', limit: 2 },
  { magic: 'Tokyo', limit: 2 },
  { magic: 'Hong Kong' },
  { magic: 'Taiwan' },
  { magic: 'Vietnam' },
  { magic: 'Sydney' },
  { magic: 'Brazil' },
  { magic: 'AS209' },
  { magic: 'AS3356' },
];

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const rounds = Number(arg('rounds', '3'));
const label = arg('label', 'probe');
const outDir = arg('out', 'docs-private/perf/edge-latency');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function measure(target, locations) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'http',
      target,
      locations,
      measurementOptions: { protocol: 'HTTPS', request: { path: '/api/ping', method: 'GET' } },
    }),
  });
  if (!res.ok) throw new Error(`globalping POST ${res.status}: ${await res.text()}`);
  const { id } = await res.json();
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    const m = await (await fetch(`${API}/${id}`)).json();
    if (m.status === 'finished') return m;
  }
  throw new Error(`measurement ${id} did not finish`);
}

function rows(measurement) {
  return measurement.results.map((r, probe) => {
    const h = r.result.headers ?? {};
    return {
      probe,
      city: r.probe.city,
      country: r.probe.country,
      asn: r.probe.asn,
      firstByte: r.result.timings?.firstByte ?? null,
      tcp: r.result.timings?.tcp ?? null,
      total: r.result.timings?.total ?? null,
      colo: h['cf-ray']?.split('-').pop() ?? null,
      railwayEdge: h['x-railway-edge'] ?? null,
      status: r.result.statusCode ?? r.result.status,
    };
  });
}

const median = (xs) => {
  const s = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : null;
};

const raw = { apex: [], direct: [] };
let probeSet = LOCATIONS;
for (let round = 0; round < rounds; round++) {
  const apex = await measure(HOSTS.apex, probeSet);
  // Every later measurement reuses the first one's probes.
  if (round === 0) probeSet = apex.id;
  const direct = await measure(HOSTS.direct, probeSet);
  raw.apex.push(apex);
  raw.direct.push(direct);
  process.stderr.write(`round ${round + 1}/${rounds} done\n`);
}

const apexRows = raw.apex.map(rows);
const directRows = raw.direct.map(rows);
const summary = apexRows[0].map((first, probe) => {
  const a = apexRows.map((r) => r[probe]).filter(Boolean);
  const d = directRows.map((r) => r[probe]).filter(Boolean);
  const apexMs = median(a.map((x) => x.firstByte));
  const directMs = median(d.map((x) => x.firstByte));
  return {
    city: first.city,
    country: first.country,
    asn: first.asn,
    apexFirstByteMs: apexMs,
    directFirstByteMs: directMs,
    penaltyMs: apexMs !== null && directMs !== null ? apexMs - directMs : null,
    colos: [...new Set(a.map((x) => x.colo))].join(','),
    railwayEdge: [...new Set(d.map((x) => x.railwayEdge))].join(','),
  };
});

const date = new Date().toISOString().slice(0, 10);
mkdirSync(outDir, { recursive: true });
const file = join(outDir, `${date}-${label}.json`);
writeFileSync(
  file,
  `${JSON.stringify({ date, label, rounds, hosts: HOSTS, summary, raw }, null, 2)}\n`,
);

console.log('city                 cc  apex  direct  penalty  colo');
for (const s of summary) {
  console.log(
    `${s.city.padEnd(20)} ${s.country.padEnd(3)} ${String(s.apexFirstByteMs).padStart(5)} ${String(s.directFirstByteMs).padStart(7)} ${String(s.penaltyMs).padStart(8)}  ${s.colos}`,
  );
}
console.log(
  `median penalty ${median(summary.map((s) => s.penaltyMs))}ms over ${summary.length} probes; wrote ${file}`,
);
