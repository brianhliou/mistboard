import { createUser } from './persistence.js';
import { createStudy, getStudyById } from './persistence-studies.js';
import { assert, definePersistenceTests, test } from './persistence-test-support.js';
import { applyPlan, editableOwners } from './study-edit-cli.js';

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
          { op: 'add', ref: 'two', name: 'Two', tree: tree('h3e3', 'h10g8') },
          { op: 'add', ref: 'three', name: 'Three', tree: tree('c4c5') },
          { op: 'tree', chapter: first, tree: tree('b3e3', 'b10c8') },
          { op: 'rename', chapter: first, name: 'One, replayed' },
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
});
