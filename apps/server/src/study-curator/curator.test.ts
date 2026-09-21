import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { StudyChapterRecord, StudyWithChapters } from '../persistence-studies.js';
import type { CuratorGame } from './annotate.js';
import {
  type CuratorDeps,
  type CuratorStudyStore,
  runStudyCurator,
  startStudyCurator,
} from './curator.js';
import {
  CENTRAL_CANNON_SCREEN_HORSES,
  ELEPHANT_OPENING,
  evalsOf,
  gameOf,
  recipeOf,
} from './fixtures.js';
import type { CuratorPlyEval } from './moments.js';
import { readCuratorMark } from './plan.js';

/** An in-memory study store that behaves like the persistence functions the curator calls. */
function fakeStudies() {
  const studies = new Map<string, StudyWithChapters>();
  let nextId = 1;
  const id = (prefix: string) => `${prefix}${nextId++}`;
  const find = (chapterId: string) => {
    for (const study of studies.values()) {
      const chapter = study.chapters.find((c) => c.id === chapterId);
      if (chapter) return { study, chapter };
    }
    return null;
  };
  const chapterOf = (
    studyId: string,
    ordinal: number,
    input: {
      name: string;
      i18n?: unknown;
      orientation: string;
      root: unknown;
      denorm?: unknown;
      tags?: unknown;
    },
  ): StudyChapterRecord =>
    ({
      id: id('c'),
      studyId,
      ordinal,
      name: input.name,
      i18n: (input.i18n ?? {}) as Record<string, unknown>,
      variant: 'xiangqi',
      orientation: input.orientation,
      root: input.root,
      denorm: input.denorm ?? {},
      tags: (input.tags ?? {}) as StudyChapterRecord['tags'],
      version: 1,
      gamebook: false,
      practice: false,
      practiceGoal: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }) as StudyChapterRecord;
  const calls: string[] = [];
  const store: CuratorStudyStore = {
    async getBySlug(slug) {
      return [...studies.values()].find((s) => s.slug === slug) ?? null;
    },
    async create(input) {
      const studyId = id('s');
      const study = {
        id: studyId,
        ownerId: input.ownerId,
        slug: input.slug ?? null,
        name: input.name,
        description: input.description,
        i18n: input.i18n ?? {},
        visibility: input.visibility,
        chapters: [chapterOf(studyId, 0, input.chapter)],
      } as unknown as StudyWithChapters;
      studies.set(studyId, study);
      calls.push(`create ${input.slug}`);
      return study;
    },
    async updateMeta(studyId, _owner, patch) {
      const study = studies.get(studyId);
      if (study) Object.assign(study, patch);
      calls.push(`meta ${studyId}`);
      return { ok: true };
    },
    async addChapter(studyId, _owner, input) {
      const study = studies.get(studyId);
      if (!study) return { ok: false, error: 'not_found' };
      const chapter = chapterOf(studyId, study.chapters.length, input);
      study.chapters.push(chapter);
      calls.push(`add ${chapter.id}`);
      return { ok: true, chapter };
    },
    async updateChapterTree(chapterId, _owner, patch) {
      const found = find(chapterId);
      if (!found) return { ok: false };
      found.chapter.root = patch.root;
      if (patch.denorm !== undefined) found.chapter.denorm = patch.denorm;
      calls.push(`tree ${chapterId}`);
      return { ok: true };
    },
    async renameChapter(chapterId, _owner, name) {
      const found = find(chapterId);
      if (found) found.chapter.name = name;
      return { ok: true };
    },
    async setChapterTags() {
      return { ok: true };
    },
    async setChapterOrientation() {
      return { ok: true };
    },
    async setChapterGamebook(chapterId, _owner, gamebook) {
      const found = find(chapterId);
      if (found) found.chapter.gamebook = gamebook;
      calls.push(`gamebook ${chapterId} ${gamebook}`);
      return { ok: true };
    },
    async deleteChapter(chapterId) {
      const found = find(chapterId);
      if (!found) return { ok: false };
      found.study.chapters = found.study.chapters.filter((c) => c.id !== chapterId);
      calls.push(`delete ${chapterId}`);
      return { ok: true };
    },
    async reorderChapters(studyId, _owner, chapterIds) {
      const study = studies.get(studyId);
      if (!study) return { ok: false };
      assert.deepEqual(
        [...chapterIds].sort(),
        study.chapters.map((c) => c.id).sort(),
        'reorder needs the exact id set',
      );
      study.chapters = chapterIds.map((cid) => study.chapters.find((c) => c.id === cid)!);
      calls.push(`reorder ${chapterIds.join(',')}`);
      return { ok: true };
    },
  };
  return { store, studies, calls };
}

// Red wins cleanly; black blunders at ply 4.
const GOOD = evalsOf([10, 20, 20, 20, 320, 300, 300, 300, 300, 300, 300], {
  3: { best: 'b10c8', pv: ['b10c8', 'i1h1'] },
});

function depsWith(games: CuratorGame[], analyses: Record<string, CuratorPlyEval[]>) {
  const fake = fakeStudies();
  const computed: string[] = [];
  const cached = new Set<string>();
  const deps: CuratorDeps = {
    listCandidates: async () => games,
    getAnalysis: async (game, compute) => {
      if (cached.has(game.id)) return analyses[game.id] ?? null;
      if (!compute) return null;
      computed.push(game.id);
      cached.add(game.id);
      return analyses[game.id] ?? null;
    },
    studies: fake.store,
    ownerId: 'owner',
    engineId: 'eng@5',
  };
  return { deps, fake, computed, cached };
}

test('a run filters by opening, spends its analysis budget, and fills the study over runs', async () => {
  const games = [
    gameOf('g1', CENTRAL_CANNON_SCREEN_HORSES, '1-0', { playedOn: '2026-09-15' }),
    gameOf('g2', CENTRAL_CANNON_SCREEN_HORSES, '1-0', { playedOn: '2026-09-10' }),
    gameOf('g3', ELEPHANT_OPENING, '1-0', { playedOn: '2026-09-12' }),
  ];
  const { deps, fake, computed } = depsWith(games, { g1: GOOD, g2: GOOD });
  const recipe = recipeOf({
    id: 'cc',
    opening: { name: 'Central Cannon', byPly: 8, red: ['C@e3'], black: ['H@c8', 'H@g8'] },
    chapters: { max: 5 },
  });

  const [first] = await runStudyCurator([recipe], deps, { maxAnalyses: 1 });
  assert.ok(first);
  assert.equal(first.candidates, 3);
  assert.equal(first.matched, 2);
  assert.equal(first.analysesStarted, 1);
  assert.deepEqual(computed, ['g1']);
  assert.equal(first.awaitingAnalysis, 1);
  assert.deepEqual(first.chapters, { added: 1, updated: 0, removed: 0, kept: 0 });
  const study = [...fake.studies.values()][0];
  assert.ok(study);
  assert.equal(study.slug, 'cc');
  assert.equal(study.chapters.length, 1);
  assert.equal(readCuratorMark(study.chapters[0]?.denorm)?.gameId, 'g1');

  const [second] = await runStudyCurator([recipe], deps, { maxAnalyses: 1 });
  assert.ok(second);
  assert.deepEqual(computed, ['g1', 'g2']);
  assert.deepEqual(second.chapters, { added: 1, updated: 0, removed: 0, kept: 1 });
  assert.equal(study.chapters.length, 2);
  assert.equal(second.studyId, study.id);

  // A third run has nothing to do and touches nothing.
  const before = fake.calls.length;
  const [third] = await runStudyCurator([recipe], deps, { maxAnalyses: 1 });
  assert.deepEqual(third?.chapters, { added: 0, updated: 0, removed: 0, kept: 2 });
  assert.equal(fake.calls.slice(before).filter((c) => !c.startsWith('reorder')).length, 0);
});

test('a dry run computes nothing and writes nothing', async () => {
  const { deps, fake, computed } = depsWith([gameOf('g1', CENTRAL_CANNON_SCREEN_HORSES, '1-0')], {
    g1: GOOD,
  });
  const [report] = await runStudyCurator([recipeOf()], deps, { maxAnalyses: 5, dryRun: true });
  assert.equal(report?.awaitingAnalysis, 1);
  assert.deepEqual(computed, []);
  assert.equal(fake.studies.size, 0);
});

test('a game that drops out of the filter is removed; a version bump rewrites in place', async () => {
  const g1 = gameOf('g1', CENTRAL_CANNON_SCREEN_HORSES, '1-0');
  const g2 = gameOf('g2', CENTRAL_CANNON_SCREEN_HORSES, '1-0', { playedOn: '2026-09-01' });
  const { deps, fake, cached } = depsWith([g1, g2], { g1: GOOD, g2: GOOD });
  cached.add('g1');
  cached.add('g2');
  const recipe = recipeOf({ id: 'r', chapters: { max: 5 } });
  await runStudyCurator([recipe], deps, { maxAnalyses: 0 });
  const study = [...fake.studies.values()][0];
  assert.ok(study);
  assert.equal(study.chapters.length, 2);
  const ids = study.chapters.map((c) => c.id);

  deps.listCandidates = async () => [g1];
  const [dropped] = await runStudyCurator([recipe], deps, { maxAnalyses: 0 });
  assert.deepEqual(dropped?.chapters, { added: 0, updated: 0, removed: 1, kept: 1 });
  assert.deepEqual(
    study.chapters.map((c) => c.id),
    [ids[0]],
  );

  const [bumped] = await runStudyCurator([{ ...recipe, version: 2 }], deps, { maxAnalyses: 0 });
  assert.deepEqual(bumped?.chapters, { added: 0, updated: 1, removed: 0, kept: 0 });
  assert.equal(study.chapters[0]?.id, ids[0]);
  assert.equal(readCuratorMark(study.chapters[0]?.denorm)?.recipeVersion, 2);
});

test('decisive-moment recipes create gamebook chapters', async () => {
  const { deps, fake, cached } = depsWith([gameOf('g1', CENTRAL_CANNON_SCREEN_HORSES, '1-0')], {
    g1: GOOD,
  });
  cached.add('g1');
  await runStudyCurator([recipeOf({ id: 'dm', mode: 'decisive-moments' })], deps, {
    maxAnalyses: 0,
  });
  const study = [...fake.studies.values()][0];
  assert.equal(study?.chapters[0]?.gamebook, true);
  assert.ok(fake.calls.includes(`gamebook ${study?.chapters[0]?.id} true`));
});

test('a disabled recipe is skipped', async () => {
  const { deps, fake } = depsWith([gameOf('g1', CENTRAL_CANNON_SCREEN_HORSES, '1-0')], {
    g1: GOOD,
  });
  const reports = await runStudyCurator([recipeOf({ enabled: false })], deps, { maxAnalyses: 5 });
  assert.deepEqual(reports, []);
  assert.equal(fake.studies.size, 0);
});

test('the scheduler tick is gated on the flag and never overlaps', async () => {
  let runs = 0;
  let enabled = false;
  const releases: (() => void)[] = [];
  const curator = startStudyCurator({
    intervalMs: 60 * 60 * 1000,
    isPersistenceInitialized: () => true,
    enabled: () => enabled,
    run: () =>
      new Promise((resolve) => {
        runs += 1;
        releases.push(() => resolve([]));
      }),
  });
  try {
    await curator.tick();
    assert.equal(runs, 0);
    enabled = true;
    const first = curator.tick();
    await curator.tick(); // overlaps: skipped
    assert.equal(runs, 1);
    releases.shift()?.();
    await first;
    const third = curator.tick();
    assert.equal(runs, 2);
    releases.shift()?.();
    await third;
  } finally {
    curator.stop();
  }
});
