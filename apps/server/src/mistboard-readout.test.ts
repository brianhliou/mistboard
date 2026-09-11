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
  assert.doesNotMatch(markdown, /Players:/);
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
