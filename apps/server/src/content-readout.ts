import { reportingArticles } from './article-meta.js';

export const CONTENT_HISTORY_START = '2026-05-01 00:00:00';
const DAY = 86_400_000;
export const CONTENT_METRICS = [
  'visitors',
  'visits',
  'views',
  'entryVisits',
  'boardUsers',
  'ctaUsers',
  'startedVisits',
  'movedVisits',
  'finishedVisits',
  'studyUsers',
  'puzzleUsers',
  'priorPlayers',
  'firstPlayers',
  'entryFirstPlayers',
  'matureVisitors',
  'returnedVisitors',
] as const;
export type ContentMetrics = Record<
  Exclude<(typeof CONTENT_METRICS)[number], 'movedVisits'>,
  number
> & { movedVisits: number | null };
export type ContentArticle = {
  slug: string;
  title: string;
  publishedAt: string | null;
  liveAt: number | null;
  ageDays: number | null;
  current: ContentMetrics;
  previous: ContentMetrics;
};
export type ContentReadout = {
  version: 1;
  collectedAt: string;
  periodStart: string;
  periodEnd: string;
  previousPeriodStart: string;
  status: 'available' | 'unavailable';
  reason?: 'not-configured' | 'provider-unavailable' | 'invalid-response';
  articles: ContentArticle[];
};
export const CONTENT_CAVEATS = [
  'Observed production visitors, including unrecognized automation; analytics excludes opted-out browsers. Internal sessions are excluded; return cohorts also exclude any person flagged internal during the window. Locale switches are deduplicated; Vietnamese articles remain separate.',
  'Assisted outcomes can overlap across articles and must not be summed as acquisitions. Starts and lifecycle events are client observations, separate from database completed human games.',
  'First recorded players means earliest observed game_started since 2026-05-01, after an article view in that session. Entry first players also require the session to enter on that article; earlier history is unknown. Prior and first players can overlap across repeat visits.',
  'Returns: a first actual blog view in the window, at least eight days before its end; another pageview one to seven days later. The denominator is mature observed visitors.',
  'Board use covers the xiangqi replay component only. First-move coverage begins 2026-10-25; human_input coverage begins 2026-11-05 and is not a human-reader denominator. Reading completion and time on article are unmeasured.',
  'Search context unavailable: Google Search Console and Bing exports require an explicit source date and are not collected by this report.',
] as const;
export function contentSummary(content?: ContentReadout | null): string[] {
  if (content?.status !== 'available')
    return [
      `Content engagement unavailable${content ? ` (${content.reason ?? 'provider-unavailable'}; attempted ${content.collectedAt})` : ' (no stored snapshot)'}.`,
    ];
  const top = [...content.articles]
    .sort((a, b) => b.current.visitors - a.current.visitors || a.slug.localeCompare(b.slug))
    .filter((a) => a.current.visitors > 0)
    .slice(0, 2);
  return [
    `Content: ${content.periodStart.slice(0, 10)} to ${content.periodEnd.slice(0, 10)} UTC (end exclusive); collected ${content.collectedAt}. Compared with ${content.previousPeriodStart.slice(0, 10)} to ${content.periodStart.slice(0, 10)}.`,
    ...top.map(
      (a) =>
        `${a.title}: ${a.current.visitors} visitors (previous ${a.previous.visitors}); ${a.current.boardUsers} board users / ${a.current.visitors} visitors; ${a.current.entryFirstPlayers} first recorded players from ${a.current.entryVisits} entry visits.`,
    ),
    ...(top.length ? [] : ['No observed article visits in this complete window.']),
  ];
}
export function contentWindow(now: Date) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return { end, start: new Date(+end - 28 * DAY), previous: new Date(+end - 56 * DAY) };
}
export type ReportingArticle = ReturnType<typeof reportingArticles>[number];
const sqlDate = (date: Date) => date.toISOString().slice(0, 19).replace('T', ' ');
const quote = (s: string) => `'${s.replaceAll("'", "''")}'`;
const path = "replaceRegexpOne(coalesce(properties.$pathname,properties.path,''),'/$','')";
const blog =
  "match(coalesce(properties.$pathname,properties.path,''),'^(/zh-hans|/zh-hant)?/blog/[^/]+/?$')";
const host = "coalesce(properties.$host,'') IN ('mistboard.com','www.mistboard.com')";
const internal =
  'coalesce(poe.properties.$internal_or_test_user,false) OR coalesce(properties.is_internal,false)';
const slugExpr = `arrayElement(splitByChar('/',${path}),-1)`;
/** Only generated, already-live articles enter the event arrays. No user SQL/URLs. */
export function buildContentQueries(
  start: Date,
  end: Date,
  articles: ReportingArticle[],
): string[] {
  const from = quote(sqlDate(start));
  const to = quote(sqlDate(end));
  const live =
    articles
      .map(
        (a) =>
          `(${slugExpr}=${quote(a.slug)}${a.liveAt === null ? '' : ` AND timestamp>=${quote(sqlDate(new Date(a.liveAt)))}`})`,
      )
      .join(' OR ') || 'false';
  const sessions = `WITH session_rows AS (
 SELECT person_id,properties.$session_id AS sid,max(${internal}) AS internal,
 argMinIf(${path},timestamp,event='$pageview') AS entry_path,
 arrayDistinct(groupArrayIf(${path},event='$pageview' AND ${blog} AND (${live}))) AS article_paths,
 groupArray(tuple(timestamp,if(event='$pageview' AND NOT (${live}),'',${path}),event,coalesce(properties.gameId,''))) AS actions
 FROM events WHERE timestamp>=${from} AND timestamp<${to} AND ${host}
 AND coalesce(properties.$session_id,'')!=''
 GROUP BY person_id,sid HAVING internal=0 AND length(article_paths)>0
 ), visits AS (SELECT *,arrayJoin(article_paths) AS article_path FROM session_rows),
 timed AS (SELECT *,arrayMin(arrayMap(x -> x.1,arrayFilter(x -> x.2=article_path AND x.3='$pageview',actions))) AS first_view FROM visits)`;
  const after = (event: string) => `arrayExists(x -> x.3='${event}' AND x.1>=first_view,actions)`;
  const lifecycle = (event: string) =>
    `arrayExists(x -> x.3='game_started' AND x.1>=first_view AND x.4!='' AND arrayExists(y -> y.3='${event}' AND y.4=x.4 AND y.1>=x.1,actions),actions)`;
  const metrics = `${sessions}
 SELECT arrayElement(splitByChar('/',article_path),-1) AS slug,
 uniq(person_id) AS visitors,uniq(tuple(person_id,sid)) AS visits,
 sum(length(arrayFilter(x -> x.2=article_path AND x.3='$pageview',actions))) AS views,
 uniqIf(tuple(person_id,sid),entry_path=article_path) AS entryVisits,
 uniqIf(person_id,arrayExists(x -> x.2=article_path AND x.3='article_replay_engaged' AND x.1>=first_view,actions)) AS boardUsers,
 uniqIf(person_id,arrayExists(x -> x.2=article_path AND x.3='article_cta_clicked' AND x.1>=first_view,actions)) AS ctaUsers,
 uniqIf(tuple(person_id,sid),${after('game_started')}) AS startedVisits,
 uniqIf(tuple(person_id,sid),${lifecycle('game_first_move')}) AS movedVisits,
 uniqIf(tuple(person_id,sid),${lifecycle('game_finished')}) AS finishedVisits,
 uniqIf(person_id,${after('study_opened')}) AS studyUsers,
 uniqIf(person_id,${after('puzzle_attempted')}) AS puzzleUsers
 FROM timed GROUP BY slug ORDER BY slug LIMIT 500`;
  const first = `${sessions}
 SELECT arrayElement(splitByChar('/',t.article_path),-1) AS slug,
 uniqIf(t.person_id,f.first_game>=${quote(CONTENT_HISTORY_START)} AND f.first_game<t.first_view) AS priorPlayers,
 uniqIf(t.person_id,f.first_game>=t.first_view AND arrayExists(x -> x.3='game_started' AND x.1=f.first_game,t.actions)) AS firstPlayers,
 uniqIf(t.person_id,t.entry_path=t.article_path AND f.first_game>=t.first_view AND arrayExists(x -> x.3='game_started' AND x.1=f.first_game,t.actions)) AS entryFirstPlayers
 FROM timed AS t LEFT JOIN (
 SELECT person_id,min(first_start) AS first_game FROM (
 SELECT person_id,properties.$session_id AS sid,max(${internal}) AS internal,
 minIf(timestamp,event='game_started') AS first_start FROM events
 WHERE timestamp>=${quote(CONTENT_HISTORY_START)} AND timestamp<${to} AND ${host}
 GROUP BY person_id,sid HAVING internal=0 AND first_start>=${quote(CONTENT_HISTORY_START)}
 ) GROUP BY person_id
 ) AS f ON t.person_id=f.person_id GROUP BY slug ORDER BY slug LIMIT 500`;
  const returns = `WITH people AS (
 SELECT person_id,max(${internal}) AS internal,
 arrayDistinct(groupArrayIf(${slugExpr},event='$pageview' AND timestamp<${quote(sqlDate(new Date(+end - 8 * DAY)))} AND ${blog} AND (${live}))) AS slugs,
 groupArray(tuple(timestamp,${slugExpr},event,(${blog} AND (${live})))) AS actions
 FROM events WHERE timestamp>=${from} AND timestamp<${to} AND ${host}
 GROUP BY person_id HAVING internal=0 AND length(slugs)>0
 ), expanded AS (SELECT *,arrayJoin(slugs) AS slug FROM people), timed AS (
 SELECT *,arrayMin(arrayMap(x -> x.1,arrayFilter(x -> x.2=slug AND x.3='$pageview' AND x.4=1,actions))) AS first_view FROM expanded)
 SELECT slug,count() AS matureVisitors,
 countIf(arrayExists(x -> x.3='$pageview' AND x.1>=first_view+INTERVAL 1 DAY AND x.1<first_view+INTERVAL 8 DAY,actions)) AS returnedVisitors
 FROM timed GROUP BY slug ORDER BY slug LIMIT 500`;
  return [metrics, first, returns];
}

type Fetch = typeof fetch;
export type ContentCollectorOptions = {
  apiKey?: string;
  fetch?: Fetch;
  timeoutMs?: number;
  articles?: ReportingArticle[];
};
const emptyMetrics = (): ContentMetrics =>
  Object.fromEntries(CONTENT_METRICS.map((k) => [k, 0])) as ContentMetrics;
/** Bounded aggregate-only API response validation. Provider text never escapes. */
export function parseContentResult(
  value: unknown,
): { slug: string; metrics: Partial<ContentMetrics> }[] {
  if (!value || typeof value !== 'object') throw new Error('invalid-response');
  const v = value as {
    columns?: unknown;
    results?: unknown;
    hasMore?: unknown;
    next?: unknown;
    error?: unknown;
  };
  if (
    v.error ||
    v.hasMore ||
    v.next ||
    !Array.isArray(v.columns) ||
    !Array.isArray(v.results) ||
    v.results.length >= 500 ||
    !v.columns.includes('slug')
  )
    throw new Error('invalid-response');
  const columns = v.columns as unknown[];
  if (
    columns.some((c) => c !== 'slug' && !CONTENT_METRICS.includes(c as never)) ||
    new Set(columns).size !== columns.length
  )
    throw new Error('invalid-response');
  const seen = new Set<string>();
  return v.results.map((row) => {
    if (!Array.isArray(row) || row.length !== columns.length) throw new Error('invalid-response');
    const slug = row[columns.indexOf('slug')];
    if (typeof slug !== 'string' || !/^[a-z0-9-]+$/.test(slug) || seen.has(slug))
      throw new Error('invalid-response');
    seen.add(slug);
    const metrics: Partial<ContentMetrics> = {};
    columns.forEach((key, i) => {
      if (key === 'slug') return;
      const n = row[i];
      if (!Number.isSafeInteger(n) || n < 0) throw new Error('invalid-response');
      metrics[key as keyof ContentMetrics] = n;
    });
    return { slug, metrics };
  });
}
export async function collectContentReadout(
  now: Date,
  options: ContentCollectorOptions = {},
): Promise<ContentReadout> {
  const { start, end, previous } = contentWindow(now);
  const base = {
    version: 1 as const,
    collectedAt: now.toISOString(),
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    previousPeriodStart: previous.toISOString(),
  };
  const apiKey = options.apiKey ?? process.env.MISTBOARD_POSTHOG_REPORTING_API_KEY;
  if (!apiKey) return { ...base, status: 'unavailable', reason: 'not-configured', articles: [] };
  const articles = options.articles ?? reportingArticles(end);
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    Math.min(120_000, Math.max(1, options.timeoutMs ?? 90_000)),
  );
  try {
    const windows: Map<string, ContentMetrics>[] = [];
    for (const windowStart of [start, previous]) {
      const windowEnd = windowStart === start ? end : start;
      const values = new Map<string, ContentMetrics>();
      for (const sql of buildContentQueries(windowStart, windowEnd, articles)) {
        const response = await (options.fetch ?? fetch)(
          'https://us.posthog.com/api/projects/413256/query/',
          {
            method: 'POST',
            redirect: 'error',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: { kind: 'HogQLQuery', query: sql },
              name: 'Mistboard weekly content aggregates',
            }),
            signal: controller.signal,
          },
        );
        if (!response.ok) throw new Error('provider-unavailable');
        // Bound even a malicious/misconfigured provider; never persist raw body.
        const declared = Number(response.headers.get('content-length') ?? 0);
        if (declared > 1_000_000) throw new Error('invalid-response');
        const reader = response.body?.getReader();
        if (!reader) throw new Error('invalid-response');
        const chunks: Uint8Array[] = [];
        let size = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 1_000_000) {
            await reader.cancel();
            throw new Error('invalid-response');
          }
          chunks.push(value);
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const c of chunks) {
          bytes.set(c, offset);
          offset += c.length;
        }
        let result: unknown;
        try {
          result = JSON.parse(new TextDecoder().decode(bytes));
        } catch {
          throw new Error('invalid-response');
        }
        const rows = parseContentResult(result);
        // Each query must return its complete named aggregate contract, even on zero rows.
        const expected = sql.includes('AS matureVisitors')
          ? ['matureVisitors', 'returnedVisitors']
          : sql.includes('AS priorPlayers')
            ? ['priorPlayers', 'firstPlayers', 'entryFirstPlayers']
            : CONTENT_METRICS.slice(0, 11);
        const columns = (result as { columns: string[] }).columns;
        if (expected.some((k) => !columns.includes(k))) throw new Error('invalid-response');
        for (const row of rows) {
          if (!articles.some((a) => a.slug === row.slug)) continue;
          values.set(row.slug, { ...(values.get(row.slug) ?? emptyMetrics()), ...row.metrics });
        }
      }
      windows.push(values);
    }
    return {
      ...base,
      status: 'available',
      articles: articles.map((a) => ({
        ...a,
        ageDays: a.liveAt === null ? null : Math.max(0, Math.floor((+end - a.liveAt) / DAY)),
        current: {
          ...(windows[0].get(a.slug) ?? emptyMetrics()),
          ...(+end <= Date.parse('2026-10-25T00:00:00Z') ? { movedVisits: null } : {}),
        },
        previous: {
          ...(windows[1].get(a.slug) ?? emptyMetrics()),
          ...(+start <= Date.parse('2026-10-25T00:00:00Z') ? { movedVisits: null } : {}),
        },
      })),
    };
  } catch (error) {
    return {
      ...base,
      status: 'unavailable',
      reason:
        error instanceof Error && error.message === 'invalid-response'
          ? 'invalid-response'
          : 'provider-unavailable',
      articles: [],
    };
  } finally {
    clearTimeout(timer);
  }
}
