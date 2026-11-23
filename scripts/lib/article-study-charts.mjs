// The pure half of scripts/check-article-study-charts.mjs: find the study
// embeds in served article versions, and judge each embedded chapter against
// the study the public API returns. No I/O here; the script fetches and prints.
// The rule (which chapters must carry a chart) is stated in the script header.

/** `/embed/study/<studyId>/<chapterId>[?query]` → its parts, or null. */
export function parseStudyEmbedPath(path) {
  const m = /^\/embed\/study\/([A-Za-z0-9_-]+)(?:\/([A-Za-z0-9_-]+))?\/?(?:\?(.*))?$/.exec(path);
  if (!m) return null;
  const query = new URLSearchParams(m[3] ?? '');
  const ply = query.get('ply');
  return {
    studyId: m[1],
    chapterId: m[2] ?? null,
    ply: ply !== null && /^\d+$/.test(ply) ? Number(ply) : null,
  };
}

/**
 * Every study embed block in each served version of an article. A version is
 * `{ slug, lang, article }`: the English source and each published translation,
 * since a translation is a deep copy whose strings (an embed path included)
 * could differ. The walk is over the whole article object, so an embed nested
 * anywhere (intro, sections, a stepper) is found; an `/embed/study/` path that
 * does not parse comes back with `studyId: null` so the caller can fail on it.
 */
export function collectStudyEmbeds(versions) {
  const out = [];
  for (const { slug, lang, article } of versions) {
    const seen = new Set();
    const walk = (value) => {
      if (Array.isArray(value)) {
        for (const v of value) walk(v);
        return;
      }
      if (!value || typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);
      if (
        value.kind === 'embed' &&
        typeof value.path === 'string' &&
        value.path.startsWith('/embed/study/')
      ) {
        const parsed = parseStudyEmbedPath(value.path);
        out.push({
          slug,
          lang,
          path: value.path,
          studyId: parsed?.studyId ?? null,
          chapterId: parsed?.chapterId ?? null,
          ply: parsed?.ply ?? null,
        });
        return;
      }
      for (const v of Object.values(value)) walk(v);
    };
    walk(article);
  }
  return out;
}

/** Mainline plies of a study chapter root (`{ root: { children: [...] } }`, or its JSON text). */
export function mainlinePlies(root) {
  let tree = root;
  if (typeof tree === 'string') {
    try {
      tree = JSON.parse(tree);
    } catch {
      return 0;
    }
  }
  let node = tree?.root ?? tree;
  let plies = 0;
  while (node && Array.isArray(node.children) && node.children.length > 0) {
    node = node.children[0];
    plies += 1;
  }
  return plies;
}

/** A chapter's tags as the API serves them (object), never trusted to exist. */
function tagsOf(chapter) {
  return chapter && typeof chapter.tags === 'object' && chapter.tags !== null ? chapter.tags : {};
}

const RESULT_TAG = /^(1-0|0-1|1\/2-1\/2|½-½)$/;

/** Opening boards of the full-information variants whose chapters store one. */
const OPENING_BOARDS = new Set([
  'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR', // xiangqi family
  't5l/1c3d1/e1w1p1r/7/7/7/R1P1W1E/1D3C1', // jungle (first eight ranks)
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR', // chess family
]);

/** The game this mainline plays out from: true when the root is the variant's opening. */
export function startsFromOpening(root) {
  let tree = root;
  if (typeof tree === 'string') {
    try {
      tree = JSON.parse(tree);
    } catch {
      return false;
    }
  }
  const fen = typeof tree?.rootFen === 'string' ? tree.rootFen.trim() : '';
  if (fen === '') return true; // no stored start: the variant's own opening
  const board = fen.split(/\s+/)[0];
  if (OPENING_BOARDS.has(board)) return true;
  for (const opening of OPENING_BOARDS) if (board.startsWith(`${opening}/`)) return true;
  // A dealt start: every piece face down (banqi, Flip Jungle), or all but the
  // generals (jieqi). A set-up position always shows some piece face up.
  const pieces = board.replace(/[0-9/]/g, '');
  return pieces.length > 0 && /^[XxKk]+$/.test(pieces) && /[Xx]/.test(pieces);
}

/** A mainline from the opening shorter than this is an opening line, not a game. */
export const MIN_UNTAGGED_GAME_PLIES = 10;

/**
 * Is this chapter a played game (it should carry a chart)? See the rule in
 * scripts/check-article-study-charts.mjs. In short: never a gamebook or
 * practice chapter; a game when its tags name both sides (red or white, and
 * black) with a decided result; otherwise a game when its mainline plays at
 * least MIN_UNTAGGED_GAME_PLIES moves from the variant's opening. Everything
 * else (a composed or tablebase position, a chess middlegame, an opening line,
 * an unfinished `*` game from a set-up position) is a position.
 */
export function isGameChapter(chapter) {
  if (!chapter || chapter.gamebook || chapter.practice) return false;
  const tags = tagsOf(chapter);
  const named = (v) => typeof v === 'string' && v.trim() !== '' && v.trim() !== '?';
  const decided = RESULT_TAG.test(String(tags.result ?? '').trim());
  if (decided && (named(tags.red) || named(tags.white)) && named(tags.black)) return true;
  return startsFromOpening(chapter.root) && mainlinePlies(chapter.root) >= MIN_UNTAGGED_GAME_PLIES;
}

/** A score series as served: an object, or its JSON text. Null when absent or unreadable. */
function seriesOf(chapter) {
  let s = chapter?.scoreSeries;
  if (s === undefined || s === null || s === '') return null;
  if (typeof s === 'string') {
    try {
      s = JSON.parse(s);
    } catch {
      return null;
    }
  }
  return s && Array.isArray(s.series) && s.series.length > 0 ? s : null;
}

/** Variants whose embed shows a luck split from stored per-move decisions. */
export const DECISION_VARIANTS = new Set([
  'jieqi',
  'banqi',
  'three-kingdoms-banqi',
  'ffq-banqi',
  'jungle-flip',
]);

/**
 * Judge every embed. `studies` maps studyId → the API body
 * (`{ study, chapters }`), or `{ error: string }` when the read failed.
 * `allowlist` entries are `{ studyId, chapterId, reason }`; an entry matches
 * one chapter exactly, never a whole study.
 *
 * Returns one verdict per embed:
 *   ok          a game chapter with its chart (and its decisions, where the variant has them)
 *   position    not a game by the rule; no chart expected
 *   allowlisted a game without a chart, named in the allowlist with its reason
 *   no-chart    FAIL: a game chapter with no scoreSeries
 *   bad-series  FAIL: a series whose length is not mainline plies + 1
 *   no-decisions FAIL: a game in a decision variant with no stored decisions
 *   unreadable  FAIL: the path, the study or the chapter could not be read
 */
export function judgeStudyCharts(embeds, studies, allowlist = []) {
  const allowed = new Map(allowlist.map((a) => [`${a.studyId}/${a.chapterId}`, a.reason]));
  return embeds.map((embed) => {
    const base = { ...embed };
    if (!embed.studyId) return { ...base, verdict: 'unreadable', why: 'embed path does not parse' };
    const body = studies[embed.studyId];
    if (!body || body.error || !Array.isArray(body.chapters)) {
      return {
        ...base,
        verdict: 'unreadable',
        why: `study read failed: ${body?.error ?? 'no response'}`,
      };
    }
    const chapter = embed.chapterId
      ? body.chapters.find((c) => c.id === embed.chapterId)
      : body.chapters[0];
    if (!chapter) return { ...base, verdict: 'unreadable', why: 'chapter not in study' };
    const named = {
      ...base,
      chapterId: chapter.id,
      chapterName: chapter.name,
      variant: chapter.variant,
    };
    if (!isGameChapter(chapter)) return { ...named, verdict: 'position' };
    const series = seriesOf(chapter);
    if (!series) {
      const reason = allowed.get(`${embed.studyId}/${chapter.id}`);
      return reason
        ? { ...named, verdict: 'allowlisted', why: reason }
        : { ...named, verdict: 'no-chart', why: 'game chapter has no scoreSeries' };
    }
    const plies = mainlinePlies(chapter.root);
    const lengths = series.series.map((line) =>
      Array.isArray(line.values) ? line.values.length : -1,
    );
    if (lengths.some((n) => n !== plies + 1)) {
      return {
        ...named,
        verdict: 'bad-series',
        why: `series holds ${lengths.join('/')} values for ${plies + 1} positions`,
      };
    }
    if (DECISION_VARIANTS.has(chapter.variant) && chapter.hasDecisions !== true) {
      return { ...named, verdict: 'no-decisions', why: 'chance variant with no stored decisions' };
    }
    return { ...named, verdict: 'ok' };
  });
}

export const FAILING_VERDICTS = new Set(['no-chart', 'bad-series', 'no-decisions', 'unreadable']);

/**
 * Embedded game chapters that deliberately carry no chart. One entry per
 * chapter, each with its reason; a study is never allowlisted whole. Add an
 * entry only for a chapter where a chart would mislead or say nothing, never
 * to quiet a chapter that is simply missing its data.
 */
export const STUDY_CHART_ALLOWLIST = [
  {
    studyId: 'ls3xEcX3',
    chapterId: 'hedraozx',
    reason:
      'shortest-stalemate: a cooperative line found by search (both sides help reach stalemate), not a contested game; the article is about its final position',
  },
  {
    studyId: 'ls3xEcX3',
    chapterId: '36PazYZl',
    reason:
      'shortest-stalemate: a composed stalemate game (both sides cooperate to reach it), not a contested one; the article is about its final position',
  },
  {
    studyId: 'peM4ujrr',
    chapterId: 'E0EQ89xy',
    reason:
      "shortest-stalemate: Sam Loyd's composed ten-move chess stalemate, a cooperative construction, not a contested game",
  },
];
