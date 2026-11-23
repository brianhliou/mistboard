// Planted failures for scripts/check-article-study-charts.mjs: a fixture
// article whose embeds go through the same extractor and judge the script uses,
// against fixture study responses. Each planted gap must be flagged; if the
// check passes one of them, this test fails.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  collectStudyEmbeds,
  FAILING_VERDICTS,
  isGameChapter,
  judgeStudyCharts,
  STUDY_CHART_ALLOWLIST,
} from './lib/article-study-charts.mjs';

/** A mainline of `plies` moves, optionally from a set-up position. */
function tree(plies, rootFen) {
  let node = { children: [] };
  const root = node;
  for (let i = 0; i < plies; i += 1) {
    const next = { move: `m${i}`, children: [] };
    node.children.push(next);
    node = next;
  }
  return rootFen === undefined ? { version: 1, root } : { version: 1, rootFen, root };
}

function series(plies, side = 'red') {
  return {
    side,
    series: [{ label: 'engine', values: Array.from({ length: plies + 1 }, () => 0.5) }],
  };
}

const gameTags = { red: 'Engine A', black: 'Engine B', result: '1-0', event: 'fixture' };
const JIEQI_DEAL = 'xxxxkxxxx/9/1x5x1/x1x1x1x1x/9/9/X1X1X1X1X/1X5X1/9/XXXXKXXXX w R2A2C2P - 0 1';
const BANQI_DEAL = 'XXXXXXXX/XXXXXXXX/XXXXXXXX/XXXXXXXX - G1A2E2R2H2C2S5g1a2e2r2h2c2s5 0 1 ';

const studies = {
  GAMES001: {
    study: { id: 'GAMES001' },
    chapters: [
      {
        id: 'withChart',
        name: 'Game with chart',
        variant: 'xiangqi',
        tags: gameTags,
        root: tree(40),
        scoreSeries: series(40),
      },
      // PLANTED: a tagged game with no scoreSeries.
      {
        id: 'noChart01',
        name: 'Game without chart',
        variant: 'xiangqi',
        tags: gameTags,
        root: tree(40),
      },
      // PLANTED: an untagged engine game from the opening with no series.
      { id: 'untagged1', name: 'Untagged game', variant: 'duck-xiangqi', tags: {}, root: tree(60) },
      // PLANTED: a series one value short.
      {
        id: 'shortSer1',
        name: 'Short series',
        variant: 'xiangqi',
        tags: gameTags,
        root: tree(30),
        scoreSeries: series(29),
      },
      // PLANTED: a jieqi game with its chart but no stored decisions.
      {
        id: 'jieqiNoDc',
        name: 'Jieqi without luck',
        variant: 'jieqi',
        tags: gameTags,
        root: tree(50, JIEQI_DEAL),
        scoreSeries: series(50),
      },
      {
        id: 'banqiOk01',
        name: 'Banqi with luck',
        variant: 'banqi',
        tags: gameTags,
        root: tree(48, BANQI_DEAL),
        scoreSeries: series(48, 'black'),
        hasDecisions: true,
      },
      {
        id: 'allowed01',
        name: 'Allowlisted game',
        variant: 'xiangqi',
        tags: { result: '1-0' },
        root: tree(21),
      },
    ],
  },
  POSITION1: {
    study: { id: 'POSITION1' },
    chapters: [
      {
        id: 'composed1',
        name: 'Composition',
        variant: 'xiangqi',
        tags: {},
        root: tree(13, '3k2b2/4P4/crR1b2Rc/9/9/9/9/1C3N1C1/4p1r2/2p2K3 r - - 0 1'),
      },
      {
        id: 'tablebase',
        name: 'Tablebase line',
        variant: 'banqi',
        tags: {},
        root: tree(67, '8/7R/hS6/2H4r r - 0 1'),
      },
      {
        id: 'middlegam',
        name: 'Lichess sample',
        variant: 'chess',
        tags: { red: 'A', black: 'B', result: '*' },
        root: tree(8, '2rr2k1/p1q1bppp/bp2pn2/4B3/1Pp5/6P1/PQ1NPPBP/3RR1K1 b - - 0 20'),
      },
      { id: 'opening01', name: 'Opening line', variant: 'xiangqi', tags: {}, root: tree(4) },
      {
        id: 'gamebook1',
        name: 'Gamebook',
        variant: 'xiangqi',
        gamebook: true,
        tags: gameTags,
        root: tree(40),
      },
    ],
  },
  MISSING01: { error: 'HTTP 404 not_found' },
};

const embed = (study, chapter, ply = 10) => ({
  kind: 'embed',
  path: `/embed/study/${study}/${chapter}?ply=${ply}`,
  title: 'x',
});

/** The fixture article, in the shape articles-data serves: intro, sections, nested blocks. */
const article = {
  slug: 'fixture-article',
  intro: [{ kind: 'p', text: 'intro' }, embed('GAMES001', 'withChart')],
  sections: [
    {
      heading: 'Games',
      blocks: [
        embed('GAMES001', 'noChart01'),
        embed('GAMES001', 'untagged1'),
        embed('GAMES001', 'shortSer1'),
      ],
    },
    { heading: 'Luck', blocks: [embed('GAMES001', 'jieqiNoDc'), embed('GAMES001', 'banqiOk01')] },
    {
      heading: 'Positions',
      blocks: [
        {
          kind: 'stepper',
          steps: [embed('POSITION1', 'composed1'), embed('POSITION1', 'tablebase')],
        },
        embed('POSITION1', 'middlegam'),
        embed('POSITION1', 'opening01'),
        embed('POSITION1', 'gamebook1'),
        { kind: 'embed', path: '/embed/game/abc123', title: 'not a study' },
      ],
    },
    {
      heading: 'Broken',
      blocks: [
        embed('GAMES001', 'notThere'),
        embed('MISSING01', 'anything'),
        embed('GAMES001', 'allowed01'),
      ],
    },
  ],
};
// A translation is a deep copy; one string differs so the zh embed is its own row.
const zh = structuredClone(article);
zh.sections[0].blocks[0].title = '译文';

const allowlist = [
  { studyId: 'GAMES001', chapterId: 'allowed01', reason: 'fixture: deliberately chartless' },
];
const embeds = collectStudyEmbeds([
  { slug: 'fixture-article', lang: 'en', article },
  { slug: 'fixture-article', lang: 'zh-Hans', article: zh },
]);
const verdicts = judgeStudyCharts(embeds, studies, allowlist);
const verdictOf = (lang, chapterId) => {
  const v = verdicts.find((x) => x.lang === lang && x.path.includes(`/${chapterId}?`));
  assert.ok(v, `no verdict for ${lang} ${chapterId}`);
  return v.verdict;
};

test('every study embed is collected, nested ones included, game embeds skipped, per language', () => {
  assert.equal(embeds.length, 2 * 14);
  assert.ok(embeds.every((e) => e.studyId && e.chapterId && e.ply === 10));
  assert.deepEqual([...new Set(embeds.map((e) => e.lang))], ['en', 'zh-Hans']);
});

test('planted: a game chapter without scoreSeries fails, in every language', () => {
  for (const lang of ['en', 'zh-Hans']) {
    assert.equal(verdictOf(lang, 'noChart01'), 'no-chart');
    assert.equal(verdictOf(lang, 'untagged1'), 'no-chart');
  }
  assert.ok(FAILING_VERDICTS.has('no-chart'));
});

test('planted: a jieqi game with a series but hasDecisions false fails as no-decisions', () => {
  assert.equal(verdictOf('en', 'jieqiNoDc'), 'no-decisions');
  assert.ok(FAILING_VERDICTS.has('no-decisions'));
  const withLuck = structuredClone(studies);
  withLuck.GAMES001.chapters.find((c) => c.id === 'jieqiNoDc').hasDecisions = true;
  const again = judgeStudyCharts(embeds, withLuck, allowlist).find((v) =>
    v.path.includes('/jieqiNoDc?'),
  );
  assert.equal(again.verdict, 'ok');
});

test('planted: a series of the wrong length, a missing chapter and a missing study fail', () => {
  assert.equal(verdictOf('en', 'shortSer1'), 'bad-series');
  assert.equal(verdictOf('en', 'notThere'), 'unreadable');
  assert.equal(verdictOf('en', 'anything'), 'unreadable');
});

test('games with their data pass; positions need no chart; the allowlist is per chapter', () => {
  assert.equal(verdictOf('en', 'withChart'), 'ok');
  assert.equal(verdictOf('en', 'banqiOk01'), 'ok');
  for (const id of ['composed1', 'tablebase', 'middlegam', 'opening01', 'gamebook1']) {
    assert.equal(verdictOf('en', id), 'position', id);
  }
  assert.equal(verdictOf('en', 'allowed01'), 'allowlisted');
  const unlisted = judgeStudyCharts(embeds, studies, []).find((v) =>
    v.path.includes('/allowed01?'),
  );
  assert.equal(unlisted.verdict, 'no-chart');
});

test('the check as a whole fails on this fixture', () => {
  const failing = verdicts.filter((v) => FAILING_VERDICTS.has(v.verdict));
  assert.equal(failing.length, 2 * 6);
});

test('dealt and opening starts count as games; a set-up position with no tags does not', () => {
  assert.equal(isGameChapter({ tags: {}, root: tree(30, JIEQI_DEAL) }), true);
  assert.equal(isGameChapter({ tags: {}, root: tree(30, BANQI_DEAL) }), true);
  assert.equal(
    isGameChapter({
      tags: {},
      root: tree(30, 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1'),
    }),
    true,
  );
  assert.equal(
    isGameChapter({ tags: {}, root: tree(129, '2ba2b1P/9/3k1a3/N8/9/9/9/9/9/4K4 r - - 0 1') }),
    false,
  );
  // Gomoku names its first player `white`.
  assert.equal(
    isGameChapter({
      tags: { white: 'Rapfi 7', black: 'Rapfi 8', result: '1-0' },
      root: tree(53, '15/15/15 b'),
    }),
    true,
  );
});

// Known blind spots, named so nobody reads a green run as more than it is:
// - an untagged game from a set-up position (a handicap or a mid-game start
//   with no player tags) reads as a position and is never flagged;
// - an untagged game from an opening board outside OPENING_BOARDS (a variant
//   with its own setup and no tags) reads as a position;
// - the series is checked for length only, not for being the engine's values.
test('known blind spot: an untagged game from a set-up position passes as a position', () => {
  assert.equal(
    isGameChapter({ tags: {}, root: tree(80, '4k4/9/9/9/9/9/9/9/9/4K4 r - - 0 1') }),
    false,
  );
});

test('the committed allowlist names one chapter per entry, each with a reason', () => {
  const keys = new Set();
  for (const entry of STUDY_CHART_ALLOWLIST) {
    assert.match(entry.studyId, /^[A-Za-z0-9_-]{6,}$/);
    assert.match(entry.chapterId, /^[A-Za-z0-9_-]{6,}$/);
    assert.ok(entry.reason.length > 20, `${entry.studyId}/${entry.chapterId} needs a reason`);
    const key = `${entry.studyId}/${entry.chapterId}`;
    assert.ok(!keys.has(key), `duplicate allowlist entry ${key}`);
    keys.add(key);
  }
});
