import { createUser } from './persistence.js';
import { cloneStudy, createStudy, getStudyById } from './persistence-studies.js';
import { assert, definePersistenceTests, test } from './persistence-test-support.js';
import { applyCreate, applyPlan, editableOwners } from './study-edit-cli.js';

definePersistenceTests('study edit', () => {
  const now = new Date('2026-09-29T12:00:00.000Z');
  const tree = (...ucis: string[]) => {
    const root: { children: unknown[] } = { children: [] };
    let node = root;
    for (const uci of ucis) {
      const next = { uci, children: [] as unknown[] };
      node.children.push(next);
      node = next;
    }
    return { version: 1, root };
  };

  async function seed(handle: string) {
    const user = await createUser({
      id: `user_study_edit_${handle}`,
      email: `${handle}@example.com`,
      emailVerifiedAt: now,
      handle,
      displayName: handle,
      now,
    });
    const created = await createStudy({
      ownerId: user.id,
      name: 'Seed',
      description: 'old',
      visibility: 'public',
      chapter: { name: 'One', variant: 'xiangqi', orientation: 'red', root: tree('b3e3') },
    });
    assert.ok(created);
    return (await getStudyById(created.id))!;
  }

  test('applies a plan as the owner, adding, replacing, deleting and reordering', async () => {
    const study = await seed('edit-site');
    const first = study.chapters[0]!.id;
    await applyPlan(
      study,
      {
        study: study.id,
        ops: [
          {
            op: 'study',
            name: 'Seed v2',
            description: 'new',
            i18n: { 'zh-Hans': { name: '种子二', description: '新' } },
          },
          {
            op: 'add',
            ref: 'two',
            name: 'Two',
            orientation: 'black',
            gamebook: true,
            tree: tree('h3e3', 'h10g8'),
          },
          { op: 'add', ref: 'three', name: 'Three', tree: tree('c4c5') },
          { op: 'tree', chapter: first, tree: tree('b3e3', 'b10c8') },
          { op: 'rename', chapter: first, name: 'One, replayed', orientation: 'black' },
          { op: 'order', chapters: ['ref:three', first, 'ref:two'] },
        ],
      },
      ['edit-site'],
    );
    const after = (await getStudyById(study.id))!;
    assert.equal(after.name, 'Seed v2');
    assert.equal(after.description, 'new');
    assert.deepEqual(after.i18n, { 'zh-Hans': { name: '种子二', description: '新' } });
    assert.deepEqual(
      after.chapters.map((c) => c.name),
      ['Three', 'One, replayed', 'Two'],
    );
    assert.deepEqual(after.chapters[1]!.root, tree('b3e3', 'b10c8'));
    // `gamebook: true` makes a guess-the-move chapter; an add without it stays a plain one.
    // A rename's `orientation` turns an existing chapter's board.
    assert.deepEqual(
      after.chapters.map((c) => [c.name, c.orientation, c.gamebook]),
      [
        ['Three', 'red', false],
        ['One, replayed', 'black', false],
        ['Two', 'black', true],
      ],
    );

    const second = await getStudyById(study.id);
    await applyPlan(
      second!,
      { study: study.id, ops: [{ op: 'delete', chapter: after.chapters[0]!.id }] },
      ['edit-site'],
    );
    assert.equal((await getStudyById(study.id))!.chapters.length, 2);
  });

  test('refuses a study owned by a person and writes nothing', async () => {
    const study = await seed('edit-person');
    await assert.rejects(
      applyPlan(study, { study: study.id, ops: [{ op: 'study', name: 'Taken' }] }, ['edit-site']),
      /owned by @edit-person/,
    );
    assert.equal((await getStudyById(study.id))!.name, 'Seed');
  });

  test('--allow-owner edits that one person, and a rename sets its locale names', async () => {
    const study = await seed('edit-allowed');
    const first = study.chapters[0]!.id;
    const rename = {
      study: study.id,
      ops: [
        {
          op: 'rename' as const,
          chapter: first,
          expect: 'One',
          name: 'Unbroken · One',
          i18n: { 'zh-Hans': { name: '未被推翻 · 一' }, 'zh-Hant': { name: '未被推翻 · 一' } },
        },
      ],
    };
    await assert.rejects(
      applyPlan(study, rename, editableOwners('someone-else')),
      /owned by @edit-allowed/,
    );
    assert.equal((await getStudyById(study.id))!.chapters[0]!.name, 'One');
    await applyPlan(study, rename, editableOwners('edit-allowed'));
    const chapter = (await getStudyById(study.id))!.chapters[0]!;
    assert.equal(chapter.name, 'Unbroken · One');
    assert.deepEqual(chapter.i18n, {
      'zh-Hans': { name: '未被推翻 · 一' },
      'zh-Hant': { name: '未被推翻 · 一' },
    });
  });
  // A player study carries each game's Chinese name and tags; a plan made by
  // player-study.mjs --plan has to keep them through create and add.
  test('create and add keep each chapter translation', async () => {
    await seed('edit-i18n');
    const zh = (name: string) => ({ 'zh-Hans': { name, tags: { red: '左文静' } } });
    const created = await applyCreate(
      {
        owner: 'edit-i18n',
        name: 'Games',
        visibility: 'unlisted',
        chapter: { name: 'One', variant: 'xiangqi', tree: tree('b3e3'), i18n: zh('一') },
      },
      ['edit-i18n'],
    );
    await applyPlan(
      created,
      { study: created.id, ops: [{ op: 'add', name: 'Two', tree: tree('c4c5'), i18n: zh('二') }] },
      ['edit-i18n'],
    );
    const after = (await getStudyById(created.id))!;
    assert.equal(after.visibility, 'unlisted');
    assert.deepEqual(
      after.chapters.map((c) => c.i18n),
      [zh('一'), zh('二')],
    );
  });

  test('delete-study removes the study only by its name, as the last op', async () => {
    const study = await seed('edit-delete');
    const site = ['edit-delete'];
    await assert.rejects(
      applyPlan(study, { study: study.id, ops: [{ op: 'delete-study', expect: 'Other' }] }, site),
      /is named/,
    );
    await assert.rejects(
      applyPlan(
        study,
        {
          study: study.id,
          ops: [
            { op: 'delete-study', expect: study.name },
            { op: 'study', name: 'Later' },
          ],
        },
        site,
      ),
      /last op/,
    );
    assert.ok(await getStudyById(study.id));
    await applyPlan(
      study,
      {
        study: study.id,
        ops: [
          { op: 'study', name: 'DUPLICATE' },
          { op: 'delete-study', expect: 'DUPLICATE' },
        ],
      },
      site,
    );
    assert.equal(await getStudyById(study.id), null);
  });
  test('sets, clears and clones a chapter score series, and reads it back whole', async () => {
    const study = await seed('edit-series');
    const first = study.chapters[0]!.id;
    const scoreSeries = {
      side: 'red' as const,
      series: [
        { name: 'AB-JChess', color: 'a' as const, values: [0.5, 0.61, 0.7] },
        { name: 'jqe', color: 'b' as const, values: [0.5, 0.48, 0.52] },
      ],
    };
    assert.equal(study.chapters[0]!.scoreSeries, null);
    await applyPlan(
      study,
      {
        study: study.id,
        ops: [
          { op: 'tree', chapter: first, tree: tree('b3e3', 'b10c8') },
          { op: 'series', chapter: first, scoreSeries },
          {
            op: 'add',
            ref: 'two',
            name: 'Two',
            tree: tree('h3e3'),
            scoreSeries: {
              side: 'black',
              series: [{ name: 'jqe', color: 'b', values: [0.5, 0.4] }],
            },
          },
        ],
      },
      ['edit-series'],
    );
    const after = (await getStudyById(study.id))!;
    assert.deepEqual(after.chapters[0]!.scoreSeries, scoreSeries);
    assert.deepEqual(after.chapters[1]!.scoreSeries, {
      side: 'black',
      series: [{ name: 'jqe', color: 'b', values: [0.5, 0.4] }],
    });

    // A clone carries the graph with the tree.
    const reader = await createUser({
      id: 'user_study_edit_series_reader',
      email: 'series-reader@example.com',
      emailVerifiedAt: now,
      handle: 'series-reader',
      displayName: 'series-reader',
      now,
    });
    const cloned = await cloneStudy(study.id, reader.id);
    assert.ok(cloned.ok);
    assert.deepEqual(cloned.study.chapters[0]!.scoreSeries, scoreSeries);

    // A null series op clears it; the second chapter keeps its own.
    await applyPlan(
      after,
      { study: study.id, ops: [{ op: 'series', chapter: first, scoreSeries: null }] },
      ['edit-series'],
    );
    const cleared = (await getStudyById(study.id))!;
    assert.equal(cleared.chapters[0]!.scoreSeries, null);
    assert.ok(cleared.chapters[1]!.scoreSeries);
  });
});
