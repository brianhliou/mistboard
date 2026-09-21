import type { UserAccount } from './persistence.js';
import { createUser } from './persistence.js';
import {
  addChapter,
  cloneStudy,
  createStudy,
  deleteChapter,
  deleteStudy,
  getStudyById,
  getStudyLikeState,
  listFavoriteStudies,
  listFeaturedStudies,
  listStudiesForOwner,
  listTopPublicStudies,
  renameChapter,
  reorderStudyChapters,
  setChapterGamebook,
  setChapterOrientation,
  setChapterTags,
  setStudyFeatured,
  setStudyLike,
  updateChapterTree,
  updateStudyMeta,
} from './persistence-studies.js';
import { assert, definePersistenceTests, test } from './persistence-test-support.js';

definePersistenceTests('studies', () => {
  const now = new Date('2026-07-11T12:00:00.000Z');

  async function makeUser(suffix: string): Promise<UserAccount> {
    return createUser({
      id: `user_study_${suffix}`,
      email: `study-${suffix}@example.com`,
      emailVerifiedAt: now,
      handle: `study-${suffix}`,
      displayName: `Study ${suffix}`,
      now,
    });
  }

  const tree = { version: 1, root: { children: [{ uci: 'b3e3', children: [] }] } };

  async function makeStudy(ownerId: string, name = 'My study') {
    return createStudy({
      ownerId,
      name,
      description: 'notes',
      visibility: 'private',
      chapter: { name: 'Chapter 1', variant: 'xiangqi', orientation: 'red', root: tree },
    });
  }

  test('creates a study with a first chapter and reads it back', async () => {
    const user = await makeUser('create');
    const created = await makeStudy(user.id);
    assert.ok(created);
    assert.equal(created.name, 'My study');
    assert.equal(created.visibility, 'private');
    assert.equal(created.chapters.length, 1);
    const chapter = created.chapters[0]!;
    assert.equal(chapter.variant, 'xiangqi');
    assert.equal(chapter.version, 0);
    assert.equal(chapter.gamebook, false);
    assert.deepEqual(chapter.root, tree);

    const fetched = await getStudyById(created.id);
    assert.ok(fetched);
    assert.equal(fetched.chapters.length, 1);
    assert.deepEqual(fetched.chapters[0]!.root, tree);
  });

  test('retags a chapter, replacing rather than merging, and enforces ownership', async () => {
    // Chapter tags were write-once: settable at creation, then permanent, with
    // no PATCH field and no UI editor. An import that got a player name wrong
    // could only be fixed by deleting the chapter.
    const owner = await makeUser('retag');
    const stranger = await makeUser('retag-stranger');
    const study = await makeStudy(owner.id);
    assert.ok(study);
    const chapterId = study.chapters[0]!.id;

    const set = await setChapterTags(chapterId, owner.id, {
      red: 'Xu Chao',
      black: 'Huang Xueqian',
      result: '1-0',
      event: '2019 World Championship',
    });
    assert.ok(set.ok);
    assert.equal(set.chapter.tags.red, 'Xu Chao');
    assert.equal(set.chapter.tags.event, '2019 World Championship');

    // Replacement, not merge: dropping a key must actually clear it, or a tag
    // set by mistake can never be removed.
    const replaced = await setChapterTags(chapterId, owner.id, { red: 'Xu Chao' });
    assert.ok(replaced.ok);
    assert.equal(replaced.chapter.tags.red, 'Xu Chao');
    assert.equal(replaced.chapter.tags.black, undefined);

    const reread = await getStudyById(study.id);
    assert.ok(reread);
    assert.equal(reread.chapters[0]!.tags.black, undefined);

    const denied = await setChapterTags(chapterId, stranger.id, { red: 'Nobody' });
    assert.equal(denied.ok, false);
    assert.equal(denied.ok === false && denied.error, 'forbidden');
  });

  test('saves a chapter tree, bumps the version, and enforces ownership', async () => {
    const owner = await makeUser('owner');
    const stranger = await makeUser('stranger');
    const study = await makeStudy(owner.id);
    assert.ok(study);
    const chapterId = study.chapters[0]!.id;
    const nextTree = { version: 1, root: { children: [{ uci: 'h3e3', children: [] }] } };

    const ok = await updateChapterTree(chapterId, owner.id, { root: nextTree });
    assert.ok(ok.ok);
    // deepEqual, not string compare: JSONB does not preserve object key order.
    assert.equal(ok.chapter.version, 1);
    assert.deepEqual(ok.chapter.root, nextTree);

    const forbidden = await updateChapterTree(chapterId, stranger.id, { root: nextTree });
    assert.equal(forbidden.ok, false);
    assert.ok(!forbidden.ok && forbidden.error === 'forbidden');
  });

  test('rejects a stale version with a conflict (optimistic concurrency)', async () => {
    const owner = await makeUser('conflict');
    const study = await makeStudy(owner.id);
    assert.ok(study);
    const chapterId = study.chapters[0]!.id;
    const t = { version: 1, root: { children: [] } };

    // Two writers both read version 0; the first wins, the second is stale.
    const first = await updateChapterTree(chapterId, owner.id, { root: t, baseVersion: 0 });
    assert.ok(first.ok);
    const stale = await updateChapterTree(chapterId, owner.id, { root: t, baseVersion: 0 });
    assert.equal(stale.ok, false);
    assert.ok(!stale.ok && stale.error === 'conflict');

    // Re-reading the current version lets the save through.
    const retry = await updateChapterTree(chapterId, owner.id, { root: t, baseVersion: 1 });
    assert.ok(retry.ok);
  });

  test('lists an owner studies with chapter counts and name previews', async () => {
    const owner = await makeUser('list');
    await makeStudy(owner.id, 'A');
    const multi = await makeStudy(owner.id, 'B');
    assert.ok(multi);
    await addChapter(multi.id, owner.id, {
      name: 'Chapter 2',
      i18n: { 'zh-Hant': { name: '第二章' } },
      variant: 'xiangqi',
      orientation: 'red',
      root: tree,
    });
    const studies = await listStudiesForOwner(owner.id);
    assert.equal(studies.length, 2);
    // Most-recently-updated first: 'B' got a second chapter after 'A' was created.
    const [first, second] = studies;
    assert.equal(first!.name, 'B');
    assert.equal(first!.chapterCount, 2);
    assert.deepEqual(first!.chapterNames, ['Chapter 1', 'Chapter 2']);
    // The preview carries each chapter's translation overlay, so a card can
    // localize its chapter names instead of showing the base text to everyone.
    assert.deepEqual(first!.chapterPreview, [
      { name: 'Chapter 1', i18n: {} },
      { name: 'Chapter 2', i18n: { 'zh-Hant': { name: '第二章' } } },
    ]);
    assert.equal(second!.chapterCount, 1);
    assert.deepEqual(second!.chapterNames, ['Chapter 1']);
  });

  test('lists public studies newest-updated first and keeps like writes idempotent', async () => {
    const firstOwner = await makeUser('popular-first');
    const secondOwner = await makeUser('popular-second');
    const fanOne = await makeUser('fan-one');
    const fanTwo = await makeUser('fan-two');
    const first = await makeStudy(firstOwner.id, 'First public study');
    const second = await makeStudy(secondOwner.id, 'Second public study');
    assert.ok(first && second);
    await updateStudyMeta(first.id, firstOwner.id, { visibility: 'public' });
    await updateStudyMeta(second.id, secondOwner.id, { visibility: 'public' });

    assert.deepEqual(await setStudyLike(first.id, fanOne.id, true), {
      likeCount: 1,
      likedByViewer: true,
    });
    await setStudyLike(first.id, fanOne.id, true);
    await setStudyLike(first.id, fanTwo.id, true);
    await setStudyLike(second.id, fanOne.id, true);

    // Recency, not likes, orders the list: `second` was published after
    // `first`, so it leads despite having fewer likes.
    const ranked = await listTopPublicStudies(5);
    assert.deepEqual(
      ranked.map((study) => [study.name, study.likeCount]),
      [
        ['Second public study', 1],
        ['First public study', 2],
      ],
    );
    assert.deepEqual(await getStudyLikeState(first.id, fanTwo.id), {
      likeCount: 2,
      likedByViewer: true,
    });
    assert.deepEqual(await setStudyLike(first.id, fanTwo.id, false), {
      likeCount: 1,
      likedByViewer: false,
    });
  });

  test('does not list or accept likes on non-public studies', async () => {
    const owner = await makeUser('private-like-owner');
    const fan = await makeUser('private-like-fan');
    const study = await makeStudy(owner.id, 'Private study');
    assert.ok(study);
    assert.equal(await setStudyLike(study.id, fan.id, true), null);
    assert.equal(
      (await listTopPublicStudies()).some((entry) => entry.id === study.id),
      false,
    );
  });

  test('lists a user favorites (liked public studies) and filters by name', async () => {
    const owner = await makeUser('fav-owner');
    const fan = await makeUser('fav-fan');
    const cannon = await makeStudy(owner.id, 'Cannon Openings');
    const horse = await makeStudy(owner.id, 'Horse Tactics');
    const unliked = await makeStudy(owner.id, 'Cannon Endgames');
    assert.ok(cannon && horse && unliked);
    for (const study of [cannon, horse, unliked]) {
      await updateStudyMeta(study.id, owner.id, { visibility: 'public' });
    }
    // Fan likes two of the three public studies.
    await setStudyLike(cannon.id, fan.id, true);
    await setStudyLike(horse.id, fan.id, true);

    const favorites = await listFavoriteStudies(fan.id);
    assert.deepEqual(favorites.map((study) => study.name).sort(), [
      'Cannon Openings',
      'Horse Tactics',
    ]);
    assert.equal(favorites[0]!.ownerDisplayName, 'Study fav-owner');

    // Name search is a case-insensitive substring, scoped to the favorites.
    const matched = await listFavoriteStudies(fan.id, 30, 'cannon');
    assert.deepEqual(
      matched.map((study) => study.name),
      ['Cannon Openings'],
    );

    // The public index honors the same filter (and 'Cannon Endgames' is unliked
    // but still public, so it shows there).
    const publicCannon = await listTopPublicStudies(30, 'cannon');
    assert.deepEqual(publicCannon.map((study) => study.name).sort(), [
      'Cannon Endgames',
      'Cannon Openings',
    ]);
  });

  test('curates only public studies and clears the pick when visibility closes', async () => {
    const owner = await makeUser('featured-owner');
    const study = await makeStudy(owner.id, 'Featured Cannon Manual');
    assert.ok(study);

    assert.deepEqual(await setStudyFeatured(study.id, true), {
      ok: false,
      error: 'not_public',
    });

    await updateStudyMeta(study.id, owner.id, { visibility: 'public' });
    const selected = await setStudyFeatured(study.id, true);
    assert.ok(selected.ok && selected.featuredAt instanceof Date);
    const selectedAgain = await setStudyFeatured(study.id, true);
    assert.ok(selectedAgain.ok);
    assert.equal(
      selectedAgain.featuredAt?.toISOString(),
      selected.featuredAt.toISOString(),
      'idempotent selection should preserve staff ordering',
    );

    const featured = await listFeaturedStudies(30, 'featured cannon');
    assert.deepEqual(
      featured.map((entry) => entry.id),
      [study.id],
    );

    await updateStudyMeta(study.id, owner.id, { visibility: 'unlisted' });
    assert.equal((await getStudyById(study.id))?.featuredAt, null);
    assert.deepEqual(
      (await listFeaturedStudies(30, 'featured cannon')).map((entry) => entry.id),
      [],
    );
  });

  test('clones a readable study to a new owner as a private copy, curator mark stripped', async () => {
    const author = await makeUser('clone-author');
    const reader = await makeUser('clone-reader');
    const source = await makeStudy(author.id, 'Curated');
    assert.ok(source);
    await updateStudyMeta(source.id, author.id, { visibility: 'unlisted' });
    const second = await addChapter(source.id, author.id, {
      name: 'Chapter 2',
      variant: 'xiangqi',
      orientation: 'black',
      root: tree,
      denorm: { curator: { recipeId: 'r', gameId: 'g' }, other: 1 },
      tags: { red: 'A', black: 'B' },
    });
    assert.ok(second.ok);
    await setChapterGamebook(second.chapter.id, author.id, true);

    const cloned = await cloneStudy(source.id, reader.id);
    assert.ok(cloned.ok);
    assert.notEqual(cloned.study.id, source.id);
    assert.equal(cloned.study.ownerId, reader.id);
    assert.equal(cloned.study.visibility, 'private');
    assert.equal(cloned.study.slug, null);
    assert.equal(cloned.study.name, 'Curated');
    assert.equal(cloned.study.chapters.length, 2);
    const copy = cloned.study.chapters[1]!;
    assert.notEqual(copy.id, second.chapter.id);
    assert.equal(copy.name, 'Chapter 2');
    assert.equal(copy.orientation, 'black');
    assert.equal(copy.gamebook, true);
    assert.deepEqual(copy.tags, { red: 'A', black: 'B' });
    assert.deepEqual(copy.denorm, { other: 1 });
    // The reader owns the copy and can edit it; the source is untouched.
    const edited = await renameChapter(copy.id, reader.id, 'Mine');
    assert.ok(edited.ok);
    const original = await getStudyById(source.id);
    assert.equal(original?.chapters[1]?.name, 'Chapter 2');
    assert.equal(original?.ownerId, author.id);

    // A private study clones only for its owner; a stranger sees not_found.
    await updateStudyMeta(source.id, author.id, { visibility: 'private' });
    const denied = await cloneStudy(source.id, reader.id);
    assert.ok(!denied.ok && denied.error === 'not_found');
    const own = await cloneStudy(source.id, author.id);
    assert.ok(own.ok);
    const missing = await cloneStudy('nope1234', reader.id);
    assert.ok(!missing.ok);
  });

  test('adds, renames, and deletes chapters (owner only, keeps at least one)', async () => {
    const owner = await makeUser('chapters');
    const stranger = await makeUser('chapters-stranger');
    const study = await makeStudy(owner.id);
    assert.ok(study);
    const studyId = study.id;

    const added = await addChapter(studyId, owner.id, {
      name: 'Chapter 2',
      variant: 'xiangqi',
      orientation: 'red',
      root: tree,
    });
    assert.ok(added.ok);
    assert.equal(added.chapter.name, 'Chapter 2');
    assert.equal(added.chapter.ordinal, 1);

    const bad = await addChapter(studyId, stranger.id, {
      name: 'x',
      variant: 'xiangqi',
      orientation: 'red',
      root: tree,
    });
    assert.ok(!bad.ok && bad.error === 'forbidden');

    let full = await getStudyById(studyId);
    assert.equal(full?.chapters.length, 2);

    const renamed = await renameChapter(added.chapter.id, owner.id, 'Renamed');
    assert.ok(renamed.ok && renamed.chapter.name === 'Renamed');

    const gb = await setChapterGamebook(added.chapter.id, owner.id, true);
    assert.ok(gb.ok && gb.chapter.gamebook === true);
    const gbBad = await setChapterGamebook(added.chapter.id, stranger.id, false);
    assert.ok(!gbBad.ok && gbBad.error === 'forbidden');

    // Orientation is the chapter's own, so it survives a reload rather than
    // living in whoever-opened-it's session.
    const flipped = await setChapterOrientation(added.chapter.id, owner.id, 'black');
    assert.ok(flipped.ok && flipped.chapter.orientation === 'black');
    const reloaded = await getStudyById(studyId);
    assert.equal(reloaded?.chapters.find((c) => c.id === added.chapter.id)?.orientation, 'black');
    const flipBad = await setChapterOrientation(added.chapter.id, stranger.id, 'red');
    assert.ok(!flipBad.ok && flipBad.error === 'forbidden');

    assert.ok((await deleteChapter(added.chapter.id, owner.id)).ok);
    full = await getStudyById(studyId);
    assert.equal(full?.chapters.length, 1);

    // The last chapter cannot be deleted — a study always has at least one.
    const lastDel = await deleteChapter(full!.chapters[0]!.id, owner.id);
    assert.ok(!lastDel.ok && lastDel.error === 'last_chapter');
  });

  test('reorders the complete chapter set and rejects stale or foreign orders', async () => {
    const owner = await makeUser('reorder');
    const stranger = await makeUser('reorder-stranger');
    const study = await makeStudy(owner.id);
    assert.ok(study);
    const second = await addChapter(study.id, owner.id, {
      name: 'Chapter 2',
      variant: 'xiangqi',
      orientation: 'red',
      root: tree,
    });
    const third = await addChapter(study.id, owner.id, {
      name: 'Chapter 3',
      variant: 'xiangqi',
      orientation: 'red',
      root: tree,
    });
    assert.ok(second.ok && third.ok);
    const firstId = study.chapters[0]!.id;
    assert.ok(
      (
        await reorderStudyChapters(study.id, owner.id, [
          third.chapter.id,
          firstId,
          second.chapter.id,
        ])
      ).ok,
    );
    const reordered = await getStudyById(study.id);
    assert.deepEqual(
      reordered?.chapters.map((chapter) => chapter.name),
      ['Chapter 3', 'Chapter 1', 'Chapter 2'],
    );

    const stale = await reorderStudyChapters(study.id, owner.id, [firstId, second.chapter.id]);
    assert.ok(!stale.ok && stale.error === 'invalid_order');
    const duplicate = await reorderStudyChapters(study.id, owner.id, [
      firstId,
      firstId,
      third.chapter.id,
    ]);
    assert.ok(!duplicate.ok && duplicate.error === 'invalid_order');
    const forbidden = await reorderStudyChapters(study.id, stranger.id, [
      firstId,
      second.chapter.id,
      third.chapter.id,
    ]);
    assert.ok(!forbidden.ok && forbidden.error === 'forbidden');
  });

  test('updates study meta (owner only) and cascades on delete', async () => {
    const owner = await makeUser('meta');
    const stranger = await makeUser('meta-stranger');
    const study = await makeStudy(owner.id);
    assert.ok(study);

    const bad = await updateStudyMeta(study.id, stranger.id, { visibility: 'public' });
    assert.ok(!bad.ok && bad.error === 'forbidden');

    const good = await updateStudyMeta(study.id, owner.id, {
      visibility: 'public',
      name: 'Renamed',
    });
    assert.ok(good.ok && good.study.visibility === 'public' && good.study.name === 'Renamed');

    assert.equal(await deleteStudy(study.id, stranger.id), false);
    assert.equal(await deleteStudy(study.id, owner.id), true);
    assert.equal(await getStudyById(study.id), null);
  });
  test('locale overrides round-trip on the study and its chapters', async () => {
    // Slice 1 of study i18n: translations are an overlay on the base columns, so
    // a curated Chinese-first study can serve English readers (and vice versa)
    // without forking the study or its move tree.
    const user = await makeUser('i18n');
    const created = await createStudy({
      ownerId: user.id,
      name: '橘中秘',
      description: '明代象棋譜',
      i18n: { en: { name: 'Secret in the Tangerine', description: 'A Ming xiangqi manual.' } },
      visibility: 'private',
      chapter: {
        name: '大列手砲局',
        i18n: { en: { name: 'The great opposing cannons' } },
        variant: 'xiangqi',
        orientation: 'red',
        root: tree,
      },
    });
    assert.ok(created);
    assert.deepEqual(created.i18n, {
      en: { name: 'Secret in the Tangerine', description: 'A Ming xiangqi manual.' },
    });
    assert.deepEqual(created.chapters[0]!.i18n, { en: { name: 'The great opposing cannons' } });

    // Re-read from Postgres, not just the RETURNING row.
    const fetched = await getStudyById(created.id);
    assert.equal(
      (fetched?.i18n as { en?: { name?: string } })?.en?.name,
      'Secret in the Tangerine',
    );
    assert.equal(fetched?.name, '橘中秘', 'base column stays the fallback');

    // An added chapter carries its own overrides.
    const added = await addChapter(created.id, user.id, {
      name: '屏風馬破當頭包局',
      i18n: { en: { name: 'Screen horses beat the central cannon' } },
      variant: 'xiangqi',
      orientation: 'red',
      root: tree,
    });
    assert.ok(added.ok);
    assert.equal(
      (added.chapter.i18n as { en?: { name?: string } })?.en?.name,
      'Screen horses beat the central cannon',
    );

    // Translating a chapter must not require restating its base name.
    const translated = await renameChapter(added.chapter.id, user.id, null, {
      en: { name: 'Screen horses' },
      'zh-Hans': { name: '屏风马破当头炮局' },
    });
    assert.ok(translated.ok);
    assert.equal(translated.chapter.name, '屏風馬破當頭包局', 'base name untouched');
    assert.equal(
      (translated.chapter.i18n as { 'zh-Hans'?: { name?: string } })['zh-Hans']?.name,
      '屏风马破当头炮局',
    );

    // A meta update that omits i18n leaves existing translations alone.
    const meta = await updateStudyMeta(created.id, user.id, { visibility: 'public' });
    assert.ok(meta.ok);
    assert.equal(
      (meta.study.i18n as { en?: { name?: string } })?.en?.name,
      'Secret in the Tangerine',
    );
  });

  test('a study with no translations reads back an empty overlay', async () => {
    const user = await makeUser('i18n-none');
    const created = await makeStudy(user.id);
    assert.ok(created);
    assert.deepEqual(created.i18n, {});
    assert.deepEqual(created.chapters[0]!.i18n, {});
  });
  test('a chapter PATCH carrying both a tree and translations applies both', async () => {
    // Regression: the route saved the tree and returned, silently dropping the
    // i18n in the same body — a 200 that wrote half the payload.
    const user = await makeUser('i18n-combined');
    const created = await createStudy({
      ownerId: user.id,
      name: '橘中秘',
      description: '',
      visibility: 'private',
      chapter: { name: '大列手砲局', variant: 'xiangqi', orientation: 'red', root: tree },
    });
    assert.ok(created);
    const chapter = created.chapters[0]!;

    const meta = await renameChapter(chapter.id, user.id, null, {
      'zh-Hans': { name: '大列手炮局' },
    });
    assert.ok(meta.ok);
    const newTree = { version: 1, root: { children: [{ uci: 'h3e3', children: [] }] } };
    const saved = await updateChapterTree(chapter.id, user.id, { root: newTree });
    assert.ok(saved.ok);
    assert.equal(
      (saved.chapter.i18n as { 'zh-Hans'?: { name?: string } })['zh-Hans']?.name,
      '大列手炮局',
      'a later tree save must not clear translations',
    );
    assert.deepEqual(saved.chapter.root, newTree);
  });
});
