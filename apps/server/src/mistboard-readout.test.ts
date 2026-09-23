import assert from 'node:assert/strict';
import test from 'node:test';
import { buildElephantChessPuzzleQualityReport } from './elephantchess-puzzle-quality-report.js';
import {
  buildMistboardReadout,
  ELEPHANTCHESS_PILOT_RUN_ID,
  type MistboardReadoutFacts,
  type MistboardReadoutProduct,
  type MistboardReadoutRuntime,
  readoutPeriods,
  readoutSnapshotKey,
  renderMistboardReadoutMarkdown,
  scheduledReadoutTrigger,
} from './mistboard-readout.js';
import type { PuzzleQualityAggregate } from './persistence-puzzle-quality.js';

const runtime: MistboardReadoutRuntime = {
  revision: 'abc123',
  activeGames: 0,
  databaseRequired: true,
  persistence: 'enabled',
  persistenceErrors: { count1m: 0, lastAt: null },
};

const baseProduct: MistboardReadoutProduct = {
  accountsCreated: 2,
  previousAccountsCreated: 1,
  completedGames: 8,
  previousCompletedGames: 5,
  completedGamesByMode: { pvp: 6, pve: 2 },
  completedGamesByVariant: [{ variant: 'xiangqi', count: 8 }],
  abortedGames: 0,
  humanPlayers: 4,
  previousHumanPlayers: 3,
  returningPlayers: 2,
  signedInPlayers: 1,
};

const emptyFacts: MistboardReadoutFacts = {
  product: baseProduct,
  puzzles: null,
  mining: null,
  engines: { tasks: {}, failedTasks: 0, activeWorkers: 0, staleWorkers: 0 },
};

function factsWithProduct(overrides: Partial<MistboardReadoutProduct>): MistboardReadoutFacts {
  return { ...emptyFacts, product: { ...baseProduct, ...overrides } };
}

function reportWith(
  facts: MistboardReadoutFacts,
  previousReport?: ReturnType<typeof buildMistboardReadout>,
) {
  return buildMistboardReadout({
    snapshotId: 'readout_case',
    trigger: 'weekly',
    now: new Date('2026-07-20T17:23:00Z'),
    runtime,
    facts,
    previousReport,
  });
}

test('readout periods use complete UTC days and a previous comparison week', () => {
  assert.deepEqual(readoutPeriods(new Date('2026-07-22T18:30:00Z')), {
    periodStart: new Date('2026-07-15T00:00:00Z'),
    periodEnd: new Date('2026-07-22T00:00:00Z'),
    previousPeriodStart: new Date('2026-07-08T00:00:00Z'),
  });
});

test('scheduled trigger emits weekly only on Monday UTC', () => {
  assert.equal(scheduledReadoutTrigger(new Date('2026-07-20T17:23:00Z')), 'weekly');
  assert.equal(scheduledReadoutTrigger(new Date('2026-07-21T17:23:00Z')), 'daily');
  assert.equal(
    readoutSnapshotKey('weekly', new Date('2026-07-20T17:23:00Z')),
    'readout:v1:weekly:2026-W30',
  );
});

test('decision fingerprint ignores snapshot identity and generation time', () => {
  const first = buildMistboardReadout({
    snapshotId: 'readout_one',
    trigger: 'manual',
    now: new Date('2026-07-22T10:00:00Z'),
    runtime,
    facts: emptyFacts,
  });
  const second = buildMistboardReadout({
    snapshotId: 'readout_two',
    trigger: 'manual',
    now: new Date('2026-07-22T20:00:00Z'),
    runtime,
    facts: emptyFacts,
  });
  assert.equal(first.decisionFingerprint, second.decisionFingerprint);
});

test('puzzle gates and qualified outliers become owned, deduplicated actions', () => {
  const puzzles = buildElephantChessPuzzleQualityReport({
    aggregates: [qualityAggregate({ sessions: 100, starts: 1_000, reveals: 60 })],
    pilotRunId: ELEPHANTCHESS_PILOT_RUN_ID,
    generatedAt: '2026-07-22T00:00:00Z',
  });
  const report = buildMistboardReadout({
    snapshotId: 'readout_gate',
    trigger: 'weekly',
    now: new Date('2026-07-20T17:23:00Z'),
    runtime,
    facts: { ...emptyFacts, puzzles },
  });

  assert.equal(report.verdict, 'action');
  assert.deepEqual(
    report.actions.map((action) => ({ code: action.code, issue: action.ownerIssue })),
    [
      { code: 'puzzle-outlier-set-changed', issue: 156 },
      { code: 'puzzle-plumbing-ready', issue: 156 },
      { code: 'puzzle-quality-gate-ready', issue: 156 },
    ],
  );
  assert.match(renderMistboardReadoutMarkdown(report), /1 sample-qualified outliers/);
});

test('collector failure produces unknown rather than healthy', () => {
  const report = buildMistboardReadout({
    snapshotId: 'readout_partial',
    trigger: 'daily',
    now: new Date('2026-07-22T17:23:00Z'),
    runtime,
    facts: {
      ...emptyFacts,
      product: null,
      collectorErrors: [{ section: 'product', code: 'collector_failed' }],
    },
  });
  assert.equal(report.verdict, 'unknown');
  assert.match(renderMistboardReadoutMarkdown(report), /Product activity unavailable/);
});

test('a cleared puzzle outlier set emits one transition action', () => {
  const previousPuzzles = buildElephantChessPuzzleQualityReport({
    aggregates: [qualityAggregate({ sessions: 100, starts: 1_000, reveals: 60 })],
    pilotRunId: ELEPHANTCHESS_PILOT_RUN_ID,
    generatedAt: '2026-07-20T00:00:00Z',
  });
  const previousReport = buildMistboardReadout({
    snapshotId: 'readout_previous_outliers',
    trigger: 'weekly',
    now: new Date('2026-07-20T17:23:00Z'),
    runtime,
    facts: { ...emptyFacts, puzzles: previousPuzzles },
  });
  const clearedPuzzles = buildElephantChessPuzzleQualityReport({
    aggregates: [qualityAggregate({ sessions: 100, starts: 1_000, reveals: 0 })],
    pilotRunId: ELEPHANTCHESS_PILOT_RUN_ID,
    generatedAt: '2026-07-21T00:00:00Z',
  });
  const clearedReport = buildMistboardReadout({
    snapshotId: 'readout_cleared_outliers',
    trigger: 'daily',
    now: new Date('2026-07-21T17:23:00Z'),
    runtime,
    facts: { ...emptyFacts, puzzles: clearedPuzzles },
    previousReport,
  });
  assert.equal(
    clearedReport.actions.filter((action) => action.code === 'puzzle-outliers-resolved').length,
    1,
  );
  assert.equal(
    clearedReport.actions.find((action) => action.code === 'puzzle-outliers-resolved')?.ownerIssue,
    156,
  );

  const nextReport = buildMistboardReadout({
    snapshotId: 'readout_after_clear',
    trigger: 'daily',
    now: new Date('2026-07-22T17:23:00Z'),
    runtime,
    facts: { ...emptyFacts, puzzles: clearedPuzzles },
    previousReport: clearedReport,
  });
  assert.equal(
    nextReport.actions.some((action) => action.code === 'puzzle-outliers-resolved'),
    false,
  );
});

test('a checkpoint already cleared last time does not re-announce itself', () => {
  // The regression this file exists to prevent: sessions only go up, so the
  // level stays true forever and every verdict from the crossing onward was
  // pinned at watch.
  const puzzles = buildElephantChessPuzzleQualityReport({
    aggregates: [qualityAggregate({ sessions: 100, starts: 40 })],
    pilotRunId: ELEPHANTCHESS_PILOT_RUN_ID,
    generatedAt: '2026-07-20T00:00:00Z',
  });
  const crossing = reportWith({ ...emptyFacts, puzzles });
  assert.equal(
    crossing.actions.some((action) => action.code === 'puzzle-plumbing-ready'),
    true,
  );
  assert.equal(crossing.verdict, 'watch');

  const stillReady = buildElephantChessPuzzleQualityReport({
    aggregates: [qualityAggregate({ sessions: 414, starts: 239 })],
    pilotRunId: ELEPHANTCHESS_PILOT_RUN_ID,
    generatedAt: '2026-07-21T00:00:00Z',
  });
  const later = reportWith({ ...emptyFacts, puzzles: stillReady }, crossing);
  assert.equal(
    later.actions.some((action) => action.code === 'puzzle-plumbing-ready'),
    false,
  );
  assert.equal(later.verdict, 'healthy');
});

test('a previous report with no puzzle section does not replay an old crossing', () => {
  const puzzles = buildElephantChessPuzzleQualityReport({
    aggregates: [qualityAggregate({ sessions: 414, starts: 239 })],
    pilotRunId: ELEPHANTCHESS_PILOT_RUN_ID,
    generatedAt: '2026-07-21T00:00:00Z',
  });
  const blindPrevious = reportWith({
    ...emptyFacts,
    puzzles: null,
    collectorErrors: [{ section: 'puzzles', code: 'collector_failed' }],
  });
  const report = reportWith({ ...emptyFacts, puzzles }, blindPrevious);
  assert.equal(
    report.actions.some((action) => action.code === 'puzzle-plumbing-ready'),
    false,
  );
});

test('a halved week raises an action and a doubled week raises a watch', () => {
  const dropped = reportWith(factsWithProduct({ completedGames: 22, previousCompletedGames: 46 }));
  assert.equal(dropped.verdict, 'action');
  assert.match(dropped.actions[0]!.text, /fell to 22 from 46/);

  const surged = reportWith(
    factsWithProduct({ completedGames: 78, previousCompletedGames: 22, humanPlayers: 17 }),
  );
  assert.equal(surged.verdict, 'watch');
  assert.match(surged.actions[0]!.text, /rose to 78 from 22.*17 players/);

  const stopped = reportWith(factsWithProduct({ completedGames: 0, previousCompletedGames: 46 }));
  assert.equal(stopped.actions[0]!.code, 'product-activity-stopped');
});

test('a week that doubled on one player is not a surge to chase', () => {
  // The 2026-09-21 weekly: 156 from 69, 129 of them one jieqi regular. Without
  // that player the week is 27 games, below the week before.
  const onePlayer = reportWith(
    factsWithProduct({
      completedGames: 156,
      previousCompletedGames: 69,
      humanPlayers: 36,
      topPlayerGames: 129,
    }),
  );
  assert.equal(onePlayer.actions.length, 0);
  assert.equal(onePlayer.verdict, 'healthy');
  assert.match(
    renderMistboardReadoutMarkdown(onePlayer),
    /Busiest player: 129 of the 156 completed games \(83%\)/,
  );

  // The same totals spread across people still fire.
  const manyPeople = reportWith(
    factsWithProduct({
      completedGames: 156,
      previousCompletedGames: 69,
      humanPlayers: 36,
      topPlayerGames: 9,
    }),
  );
  assert.equal(manyPeople.actions[0]?.code, 'product-activity-surged');

  // A snapshot from before the fact existed keeps the old behaviour.
  const unknown = reportWith(
    factsWithProduct({ completedGames: 156, previousCompletedGames: 69, humanPlayers: 36 }),
  );
  assert.equal(unknown.actions[0]?.code, 'product-activity-surged');
});

test('a high abort share fires on the crossing, once', () => {
  // Steady volume, so the week-over-week rules stay quiet.
  const steady = { completedGames: 60, previousCompletedGames: 60 };
  const quiet = reportWith(factsWithProduct({ ...steady, abortedGames: 10 }));
  assert.equal(quiet.actions.length, 0);

  // 40% of 100 terminal games, crossing from a quiet week.
  const crossed = reportWith(factsWithProduct({ ...steady, abortedGames: 40 }), quiet);
  assert.equal(crossed.actions[0]?.code, 'product-abort-share-high');
  assert.match(
    crossed.actions[0]!.text,
    /40% of games ended without a result.*40 aborted, 60 completed/,
  );
  assert.equal(crossed.verdict, 'watch');
  assert.match(
    renderMistboardReadoutMarkdown(crossed),
    /Aborted before a result: 40 \(40% of 100 that ended\)/,
  );

  // Still high the next day: the level holds, the action does not repeat.
  const held = reportWith(
    factsWithProduct({ completedGames: 55, previousCompletedGames: 60, abortedGames: 42 }),
    crossed,
  );
  assert.equal(held.actions.length, 0);

  // Too few games for a share to mean anything.
  const tiny = reportWith(
    factsWithProduct({ completedGames: 8, previousCompletedGames: 8, abortedGames: 12 }),
    quiet,
  );
  assert.equal(tiny.actions.length, 0);
});

test('week over week noise at low volume raises nothing', () => {
  // 4 to 9 is a doubling in ratio terms and pure Poisson noise in reality.
  const report = reportWith(factsWithProduct({ completedGames: 9, previousCompletedGames: 4 }));
  assert.equal(report.actions.length, 0);
  assert.equal(report.verdict, 'healthy');

  const halved = reportWith(factsWithProduct({ completedGames: 4, previousCompletedGames: 9 }));
  assert.equal(halved.actions.length, 0);
});

test('a stale engine worker alerts on the increase, not on the level', () => {
  // A hard-crashed worker leaves a running row forever, so a level rule here
  // would latch exactly like the puzzle checkpoint did.
  const facts: MistboardReadoutFacts = {
    ...emptyFacts,
    engines: { tasks: {}, failedTasks: 0, activeWorkers: 1, staleWorkers: 1 },
  };
  const first = reportWith(facts);
  assert.equal(first.verdict, 'action');
  assert.equal(first.actions[0]!.code, 'engine-workers-stale');

  const second = reportWith(facts, first);
  assert.equal(second.actions.length, 0);

  const worse = reportWith(
    { ...emptyFacts, engines: { tasks: {}, failedTasks: 0, activeWorkers: 1, staleWorkers: 3 } },
    second,
  );
  assert.equal(worse.actions[0]!.code, 'engine-workers-stale');
});

test('an unservable broadcast board alerts on the increase and names the rows', () => {
  // A board that 500s stays broken until code or data changes, so it latches
  // like a stale worker; the first sweep after the section lands fires on any
  // count because a pre-section snapshot has no baseline.
  const broken = (n: number): MistboardReadoutFacts => ({
    ...emptyFacts,
    broadcasts: {
      boards: 376,
      unservableBoards: n,
      unservableBoardIds: Array.from({ length: n }, (_, i) => `tour-r01-b${i}`),
    },
  });
  const first = reportWith(broken(2));
  assert.equal(first.verdict, 'action');
  assert.equal(first.actions[0]!.code, 'broadcast-boards-unservable');
  assert.match(first.actions[0]!.text, /2 of 376 stored broadcast boards/);
  assert.match(first.actions[0]!.text, /tour-r01-b0, tour-r01-b1/);
  assert.match(
    renderMistboardReadoutMarkdown(first),
    /Broadcasts: 376 stored boards, 2 unservable/,
  );

  const second = reportWith(broken(2), first);
  assert.equal(second.actions.length, 0);

  const worse = reportWith(broken(3), second);
  assert.equal(worse.actions[0]!.code, 'broadcast-boards-unservable');

  const fixed = reportWith(broken(0), worse);
  assert.equal(fixed.actions.length, 0);
  assert.equal(fixed.verdict, 'healthy');

  // A snapshot from before the section existed renders without the line.
  const legacy = reportWith(emptyFacts);
  assert.doesNotMatch(renderMistboardReadoutMarkdown(legacy), /Broadcasts:/);
});

test('a top event dpxq lists and we do not relay alerts the day it appears, not every day', () => {
  const women = {
    dpxqTour: '12776',
    name: '2026年全国象棋女子甲级联赛',
    startsOn: '2026-09-23',
    endsOn: '2026-09-27',
    section: 'live' as const,
    hasGameList: false,
  };
  const asian = {
    ...women,
    dpxqTour: '12526',
    name: '亚洲象棋个人锦标赛',
    section: 'upcoming' as const,
  };
  const withEvents = (
    untrackedEvents: NonNullable<MistboardReadoutFacts['broadcasts']>['untrackedEvents'],
  ): MistboardReadoutFacts => ({
    ...emptyFacts,
    broadcasts: { boards: 376, unservableBoards: 0, unservableBoardIds: [], untrackedEvents },
  });

  const first = reportWith(withEvents([women]));
  assert.equal(first.actions[0]!.code, 'broadcast-events-untracked');
  assert.match(
    first.actions[0]!.text,
    /2026年全国象棋女子甲级联赛 \(dpxq 12776, live, 09-23 to 09-27\)/,
  );
  assert.match(
    renderMistboardReadoutMarkdown(first),
    /Broadcasts: 376 stored boards, 0 unservable, 1 top event on dpxq not relayed/,
  );

  const second = reportWith(withEvents([women]), first);
  assert.equal(second.actions.length, 0, 'the standing list does not re-fire');

  const third = reportWith(withEvents([women, asian]), second);
  assert.equal(third.actions.length, 1);
  assert.match(third.actions[0]!.text, /dpxq lists 1 top event we do not relay: 亚洲/);

  const unreadable = reportWith(withEvents(null), third);
  assert.equal(unreadable.actions.length, 0);
  assert.match(renderMistboardReadoutMarkdown(unreadable), /dpxq index unreadable/);
});

test('the alert key holds steady while counters move under an unchanged problem', () => {
  const first = reportWith(
    factsWithProduct({ completedGames: 22, previousCompletedGames: 46, humanPlayers: 9 }),
  );
  const second = reportWith(
    factsWithProduct({ completedGames: 21, previousCompletedGames: 47, humanPlayers: 8 }),
  );
  assert.notEqual(first.decisionFingerprint, second.decisionFingerprint);
  assert.equal(first.alertKey, second.alertKey);
  assert.notEqual(first.alertKey, reportWith(emptyFacts).alertKey);
});

test('the weekly markdown carries players, split, variants and a trend', () => {
  const report = reportWith({
    ...factsWithProduct({
      completedGames: 78,
      previousCompletedGames: 22,
      humanPlayers: 17,
      previousHumanPlayers: 7,
      returningPlayers: 4,
      signedInPlayers: 5,
      abortedGames: 2,
      completedGamesByMode: { pvp: 45, pve: 33, eve: 12 },
      completedGamesByVariant: [
        { variant: 'jieqi', count: 43 },
        { variant: 'xiangqi', count: 15 },
        { variant: 'jungle', count: 11 },
        { variant: 'banqi', count: 4 },
        { variant: 'dark-xiangqi', count: 4 },
        { variant: 'jungle-flip', count: 1 },
      ],
    }),
    trend: [
      { periodEnd: '2026-08-24T00:00:00Z', completedGames: 46, humanPlayers: null },
      { periodEnd: '2026-08-31T00:00:00Z', completedGames: 22, humanPlayers: 7 },
    ],
  });
  const markdown = renderMistboardReadoutMarkdown(report);
  assert.match(markdown, /Players: 17 \(\+10 week over week\), 4 returning, 5 signed in/);
  assert.match(markdown, /Modes: pvp 45, pve 33, plus 12 bot-vs-bot outside the count above/);
  assert.match(markdown, /Variants: jieqi 43,.*and 1 more/);
  assert.match(markdown, /Aborted before a result: 2/);
  assert.match(markdown, /trend, oldest first: 46 22 78/);
});

test('a stored v1 product renders without undefined or NaN', () => {
  // /readouts renders stored snapshots, so this renderer meets payloads written
  // before the player counts existed. The first prod load of the page printed
  // "Players: undefined (NaN week over week)" because every test until this one
  // built a fresh report.
  const v1Product = {
    accountsCreated: 3,
    previousAccountsCreated: 4,
    completedGames: 78,
    previousCompletedGames: 22,
    completedGamesByMode: { pve: 78, eve: 253 },
    completedGamesByVariant: [{ variant: 'jieqi', count: 44 }],
  } as unknown as MistboardReadoutProduct;
  const markdown = renderMistboardReadoutMarkdown(
    reportWith({ ...emptyFacts, product: v1Product }),
  );
  assert.doesNotMatch(markdown, /undefined|NaN/);
  assert.doesNotMatch(markdown, /players:/i);
  assert.match(markdown, /Completed games: 78 \(\+56 week over week\)/);
});

test('a cleared checkpoint reads as cleared rather than zero remaining', () => {
  const puzzles = buildElephantChessPuzzleQualityReport({
    aggregates: [qualityAggregate({ sessions: 414, starts: 239 })],
    pilotRunId: ELEPHANTCHESS_PILOT_RUN_ID,
    generatedAt: '2026-07-21T00:00:00Z',
  });
  const markdown = renderMistboardReadoutMarkdown(reportWith({ ...emptyFacts, puzzles }));
  assert.match(markdown, /Checkpoints: plumbing cleared, 761 starts to quality gate/);
});

test('serialized readouts exclude prohibited identity and secret keys', () => {
  const report = buildMistboardReadout({
    snapshotId: 'readout_redaction',
    trigger: 'daily',
    now: new Date('2026-07-22T17:23:00Z'),
    runtime,
    facts: emptyFacts,
  });
  const prohibited = new Set([
    'email',
    'handle',
    'ip',
    'sessionId',
    'cookie',
    'token',
    'databaseUrl',
    'failureReason',
  ]);
  const keys = collectKeys(report);
  assert.deepEqual(
    [...keys].filter((key) => prohibited.has(key)),
    [],
  );
});

function qualityAggregate(overrides: Partial<PuzzleQualityAggregate> = {}): PuzzleQualityAggregate {
  return {
    puzzleId: 'xq-pilot-1',
    variant: 'xiangqi',
    sourceKind: 'mined',
    miningCandidateId: 'candidate-1',
    miningRunId: ELEPHANTCHESS_PILOT_RUN_ID,
    sessions: 0,
    starts: 0,
    solves: 0,
    cleanSolves: 0,
    reveals: 0,
    abandons: 0,
    bounces: 0,
    inProgress: 0,
    wrongAttempts: 0,
    hints: 0,
    votesUp: 0,
    votesDown: 0,
    averageCompletionSeconds: null,
    signedInAttempts: 0,
    signedInSolves: 0,
    rating: 1_600,
    ratingDeviation: 350,
    ...overrides,
  };
}

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      keys.add(key);
      collectKeys(item, keys);
    }
  }
  return keys;
}

test('the operations section carries the broadcast viewer peak only when the runtime has one', () => {
  const without = renderMistboardReadoutMarkdown(reportWith(emptyFacts));
  assert.doesNotMatch(without, /Broadcast viewers/);

  const report = buildMistboardReadout({
    snapshotId: 'readout_viewers',
    trigger: 'weekly',
    now: new Date('2026-07-20T17:23:00Z'),
    runtime: { ...runtime, broadcastViewersPeak: 14 },
    facts: emptyFacts,
  });
  assert.equal(report.production.broadcastViewersPeak, 14);
  assert.match(renderMistboardReadoutMarkdown(report), /Broadcast viewers: peak 14 open streams/);
});
