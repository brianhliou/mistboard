#!/usr/bin/env node
// One read-only observation of one round. JSONL survives restarts; this never
// imports games or changes the production tour's source. See the runbook.
import { createHash } from 'node:crypto';
import { appendFile, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const SOURCES = new Set(['wxf', 'dpxq', 'mistboard']);
const HOSTS = new Set(['www.wxf-xiangqi.org', 'wxf-xiangqi.org', 'mistboard.com']);
let scopedImport;

export function recordObservation({ event, round, source, boards, observedAt }) {
  if (!SOURCES.has(source)) throw new Error('Unknown source');
  const games = boards
    .filter((board) => board.status === 'complete' && board.moves.length > 0)
    .map((board) => ({
      // Names and source ids vary across feeds. Match only an exact mainline
      // within this event/round; do not guess that two partial lines agree.
      fingerprint: createHash('sha256')
        .update(JSON.stringify(board.moves.map((move) => [move.from, move.to])))
        .digest('hex'),
      id: board.id,
      plies: board.moves.length,
      result: board.result,
    }));
  return { event, round, source, observedAt, ok: true, games };
}

export function summarizeObservations(observations, endedAt) {
  const games = new Map();
  const failures = [];
  const firstSamples = new Map();
  for (const observation of observations) {
    if (!observation.ok) {
      failures.push(observation);
      continue;
    }
    const sampleKey = `${observation.event}:${observation.round}:${observation.source}`;
    const previousSample = firstSamples.get(sampleKey);
    if (!previousSample || observation.observedAt < previousSample) {
      firstSamples.set(sampleKey, observation.observedAt);
    }
    for (const game of observation.games) {
      const key = `${observation.event}:${observation.round}:${game.fingerprint}`;
      const row = games.get(key) ?? {
        event: observation.event,
        round: observation.round,
        fingerprint: game.fingerprint,
        firstSeen: {},
        results: {},
        ids: {},
      };
      const previous = row.firstSeen[observation.source];
      if (!previous || observation.observedAt < previous) {
        row.firstSeen[observation.source] = observation.observedAt;
      }
      row.results[observation.source] = game.result;
      row.ids[observation.source] = [...new Set([...(row.ids[observation.source] ?? []), game.id])];
      games.set(key, row);
    }
  }
  return {
    // A first observation is an upper bound on publication time. A record
    // already present at the start of sampling has unknown publication time.
    timing: 'first observed, not exact publication time',
    failures,
    games: [...games.values()].map((row) => ({
      ...row,
      ambiguous: Object.values(row.ids).some((ids) => ids.length > 1),
      resultConflict: new Set(Object.values(row.results)).size > 1,
      presentAtFirstSample: Object.fromEntries(
        Object.entries(row.firstSeen).map(([source, at]) => [
          source,
          firstSamples.get(`${row.event}:${row.round}:${source}`) === at,
        ]),
      ),
      minutesAfterRoundEnd:
        endedAt && Object.values(row.ids).every((ids) => ids.length === 1)
          ? Object.fromEntries(
              Object.entries(row.firstSeen).map(([source, at]) => [
                source,
                (Date.parse(at) - Date.parse(endedAt)) / 60_000,
              ]),
            )
          : null,
    })),
  };
}

export async function sample(options, request = fetch) {
  // One loader scope: separate tsImport calls create separate instances of
  // discovery.ts, so the parser would not see the registered providers.
  if (!scopedImport) {
    const { register } = await import('tsx/esm/api');
    scopedImport = register({ namespace: 'mistboard-broadcast-records-speed' }).import;
  }
  const tsImport = scopedImport;
  const { decodeSourceBody } = await tsImport(
    '../apps/server/src/xiangqi-broadcast-fetch.ts',
    import.meta.url,
  );
  const allowed = new Set(HOSTS);
  if (options['dpxq-permitted']) {
    allowed.add('dpxq.com');
    allowed.add('www.dpxq.com');
  }
  let lastRequestAt = 0;
  const fetchImpl = async (rawUrl, init = {}) => {
    let url = new URL(rawUrl);
    for (let redirects = 0; redirects < 5; redirects++) {
      if (
        !allowed.has(url.hostname) ||
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.port
      ) {
        throw new Error('URL is outside the approved public sources');
      }
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(0, 1000 - (Date.now() - lastRequestAt))),
      );
      lastRequestAt = Date.now();
      const response = await request(url, {
        ...init,
        signal: init.signal ?? AbortSignal.timeout(20_000),
        redirect: 'manual',
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) throw new Error('Redirect has no location');
        await response.body?.cancel();
        url = new URL(location, url);
        continue;
      }
      return {
        ok: response.ok,
        status: response.status,
        async text() {
          return decodeSourceBody(
            new Uint8Array(await response.arrayBuffer()),
            response.headers.get('content-type'),
          );
        },
      };
    }
    throw new Error('Too many redirects');
  };
  const text = async (url) => {
    const response = await fetchImpl(url);
    if (!response.ok) throw new Error(`Source responded ${response.status}`);
    return response.text();
  };
  const round = Number(options.round);
  let boards;
  let conversionIssues = 0;
  if (options.source === 'mistboard') {
    const slug = encodeURIComponent(options.tour);
    const tour = JSON.parse(await text(`https://mistboard.com/api/xiangqi/broadcasts/${slug}`));
    const entry = tour.rounds.find((item) => Number(item.id.match(/-r0*(\d+)$/)?.[1]) === round);
    boards = entry
      ? JSON.parse(
          await text(
            `https://mistboard.com/api/xiangqi/broadcasts/${slug}/rounds/${encodeURIComponent(entry.id)}`,
          ),
        ).boards
      : [];
  } else {
    if (options.source === 'dpxq' && !options['dpxq-permitted']) {
      throw new Error('dpxq automation permission is pending; do not sample it yet');
    }
    const { parseXiangqiBroadcastDiscoverySource } = await tsImport(
      '../apps/server/src/xiangqi-broadcast-discovery.ts',
      import.meta.url,
    );
    const { registerDefaultXiangqiBroadcastDiscoveryProviders } = await tsImport(
      '../apps/server/src/xiangqi-broadcast-discovery-dpxq.ts',
      import.meta.url,
    );
    const { convertWxfDhtmlXqPageToSnapshot } = await tsImport(
      '../apps/server/src/xiangqi-broadcast-wxf-dhtmlxq.ts',
      import.meta.url,
    );
    const { normalizeDpxqPageToFrameHtml } = await tsImport(
      '../apps/server/src/xiangqi-broadcast-dpxq.ts',
      import.meta.url,
    );
    registerDefaultXiangqiBroadcastDiscoveryProviders();
    const parsed = parseXiangqiBroadcastDiscoverySource(options.url, 1000);
    if (!parsed.ok) throw new Error(parsed.message);
    const expected = options.source === 'wxf' ? 'wxf-category' : 'dpxq-tour';
    if (parsed.source.provider.name !== expected || parsed.source.tourSlug !== options.tour) {
      throw new Error('Discovery provider and tour must match --source and --tour');
    }
    const discovered = await parsed.source.provider.discover({
      config: parsed.source.config,
      fetchImpl,
      timeoutMs: 20_000,
      spacingMs: 1000,
    });
    if (!discovered.ok) {
      if (!discovered.quiet) throw new Error(discovered.message);
      boards = [];
    } else {
      boards = [];
      for (const entry of discovered.boards.filter((item) => item.roundNumber === round)) {
        const html = await text(entry.url);
        let body = html;
        if (options.source === 'dpxq') {
          const normalized = normalizeDpxqPageToFrameHtml(html);
          if (!normalized.ok) throw new Error(normalized.reason);
          body = normalized.html;
        }
        const converted = convertWxfDhtmlXqPageToSnapshot(body, {
          sourceUrl: entry.url,
          tourSlug: options.tour,
          roundId: `${options.tour}-r${String(round).padStart(2, '0')}`,
        });
        if (!converted.ok) throw new Error(`Source record failed replay: ${entry.url}`);
        conversionIssues += converted.issues.length;
        boards.push(...converted.snapshot.boards);
      }
    }
  }
  return {
    ...recordObservation({
      event: options.tour,
      round,
      source: options.source,
      boards,
      observedAt: new Date().toISOString(),
    }),
    conversionIssues,
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      source: { type: 'string' },
      url: { type: 'string' },
      tour: { type: 'string' },
      round: { type: 'string' },
      log: { type: 'string' },
      report: { type: 'boolean' },
      'round-ended-at': { type: 'string' },
      'dpxq-permitted': { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log(`Usage:
  node scripts/broadcast-records-speed.mjs --source wxf --url '<discovery URL>' --tour <slug> --round 1 --log <jsonl>
  node scripts/broadcast-records-speed.mjs --source mistboard --tour <slug> --round 1 --log <jsonl>
  node scripts/broadcast-records-speed.mjs --report --log <jsonl> [--round-ended-at <ISO timestamp>]

Read-only, one observation per run. See docs/xiangqi-broadcast-records-speed.md.`);
    return;
  }
  if (!values.log) throw new Error('--log is required');
  if (values.report) {
    if (values['round-ended-at'] && !Number.isFinite(Date.parse(values['round-ended-at']))) {
      throw new Error('--round-ended-at must be an ISO timestamp');
    }
    const rows = (await readFile(values.log, 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(JSON.parse);
    if (
      values['round-ended-at'] &&
      new Set(rows.map((row) => `${row.event}:${row.round}`)).size > 1
    ) {
      throw new Error('A round-end timestamp requires a log containing only that event/round');
    }
    console.log(JSON.stringify(summarizeObservations(rows, values['round-ended-at']), null, 2));
    return;
  }
  if (
    !SOURCES.has(values.source) ||
    !/^[a-z0-9-]+$/.test(values.tour ?? '') ||
    !/^[1-9]\d?$/.test(values.round ?? '') ||
    (values.source !== 'mistboard' && !values.url)
  ) {
    throw new Error(
      'Pass --source wxf|dpxq|mistboard, --tour, --round, and --url for an external source',
    );
  }
  let observation;
  try {
    observation = await sample(values);
  } catch (error) {
    observation = {
      event: values.tour,
      round: Number(values.round),
      source: values.source,
      observedAt: new Date().toISOString(),
      ok: false,
      error: error.message,
    };
    process.exitCode = 1;
  }
  await appendFile(values.log, `${JSON.stringify(observation)}\n`);
  console.log(JSON.stringify(observation));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
