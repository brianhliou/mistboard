import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { XIANGQI_ENDGAME_CORPUS, xiangqiEndgamePracticeSets } from '@mistboard/game';
import { PRACTICE_SETS, practiceChapterBody } from './seed-xiangqi-practice-study.js';
import {
  ENDGAME_STUDY_LANGS,
  endgameStudyTranslationKeys,
  hasEndgameStudyTranslation,
  localizedChapterName,
  localizedPracticeComment,
  localizedRootComment,
  PRACTICE_SET_I18N,
} from './xiangqi-endgame-study-i18n.js';

// Two directions, the same pair article-i18n and announcement-i18n check.
//
// 1. Every string the corpus actually uses resolves in both zh scripts. Adding a
//    corpus entry fails here until it is translated, which is the reminder that
//    the study ships trilingual now.
// 2. No dictionary key is orphaned. Editing an English note detaches its
//    translation silently (the lookup just misses and the whole comment falls
//    back to English), so the orphan is the only observable trace.

function liveStrings(): Set<string> {
  const strings = new Set<string>();
  for (const entry of XIANGQI_ENDGAME_CORPUS) {
    strings.add(entry.attacker);
    strings.add(entry.defender);
    if (entry.note) strings.add(entry.note);
    if (entry.engineDispute) strings.add(entry.engineDispute);
  }
  return strings;
}

describe('endgame study translation coverage', () => {
  it('every corpus string resolves in all zh scripts', () => {
    const missing: string[] = [];
    for (const text of liveStrings()) {
      for (const lang of ENDGAME_STUDY_LANGS) {
        if (!hasEndgameStudyTranslation(lang, text)) {
          missing.push(`[${lang}] ${text.slice(0, 60)}`);
        }
      }
    }
    assert.deepEqual(missing, [], `untranslated endgame strings:\n${missing.join('\n')}`);
  });

  it('dictionaries contain only strings the corpus uses', () => {
    const live = liveStrings();
    const orphans = ENDGAME_STUDY_LANGS.flatMap((lang) =>
      endgameStudyTranslationKeys(lang)
        .filter((key) => !live.has(key))
        .map((key) => `[${lang}] ${key.slice(0, 60)}`),
    );
    assert.deepEqual(orphans, [], `orphaned endgame translation keys:\n${orphans.join('\n')}`);
  });

  it('renders a full chapter name and comment for every entry', () => {
    for (const entry of XIANGQI_ENDGAME_CORPUS) {
      for (const lang of ENDGAME_STUDY_LANGS) {
        const name = localizedChapterName(entry, lang);
        assert.ok(name, `${entry.id} has no ${lang} chapter name`);
        // A name that still carries Latin letters means a material phrase fell
        // through to English inside an otherwise translated string.
        assert.ok(!/[A-Za-z]/.test(name), `${entry.id} ${lang} name is half English: ${name}`);

        const comment = localizedRootComment(entry, { depth: 26, mate: 4, cp: null }, 6, lang);
        assert.ok(comment, `${entry.id} has no ${lang} root comment`);
      }
    }
  });

  it('drops the overlay rather than emitting half a translation', () => {
    // The contract the seeder relies on: an entry carrying prose with no
    // translation yields null, so the chapter keeps its English comment whole.
    const entry = { ...XIANGQI_ENDGAME_CORPUS[0]!, note: 'an untranslated note' };
    assert.equal(localizedRootComment(entry, undefined, 0, 'zh-Hans'), null);
  });
});

// The practice studies are the same corpus cut five ways, so they get the same
// two-directional guard. These tests are the reason the split cannot silently
// un-translate the corpus a second time: they fail on a set with no study-level
// translation and on a chapter whose material the dictionaries do not know.
describe('practice study translation coverage', () => {
  it('every practice set has a name and description in both scripts', () => {
    for (const set of PRACTICE_SETS) {
      const i18n = PRACTICE_SET_I18N[set.slug];
      assert.ok(i18n, `no PRACTICE_SET_I18N entry for ${set.slug}`);
      for (const lang of ENDGAME_STUDY_LANGS) {
        assert.ok(i18n[lang]?.name, `${set.slug} has no ${lang} name`);
        assert.ok(i18n[lang]?.description, `${set.slug} has no ${lang} description`);
      }
    }
  });

  it('PRACTICE_SET_I18N has no entry for a set that no longer exists', () => {
    const slugs = new Set<string>(PRACTICE_SETS.map((set) => set.slug));
    const orphans = Object.keys(PRACTICE_SET_I18N).filter((slug) => !slugs.has(slug));
    assert.deepEqual(orphans, [], `orphaned practice set translations: ${orphans.join(', ')}`);
  });

  it('every exercise gets a localized name and comment in both scripts', () => {
    for (const chapter of xiangqiEndgamePracticeSets().flatMap((set) => set.chapters)) {
      const body = practiceChapterBody(chapter);
      for (const lang of ENDGAME_STUDY_LANGS) {
        assert.ok(body.i18n?.[lang]?.name, `${chapter.id} has no ${lang} chapter name`);
        const comment = body.root.root.annotations.comments[0];
        assert.ok(comment?.i18n?.[lang], `${chapter.id} has no ${lang} root comment`);
      }
    }
  });

  it('chapter names are unique within every set, the key the seeder matches on', () => {
    for (const set of xiangqiEndgamePracticeSets()) {
      const names = set.chapters.map((chapter) => practiceChapterBody(chapter).name);
      assert.equal(new Set(names).size, names.length, `${set.slug} chapter names collide`);
    }
  });

  it('every set the definition holds has a name, and every name a set', () => {
    assert.deepEqual(
      PRACTICE_SETS.map((set) => set.slug),
      xiangqiEndgamePracticeSets().map((set) => set.slug),
    );
  });

  it('a practice comment never states the verdict the exercise asks for', () => {
    // The reading study's comment opens with 红胜（例胜）/和棋（例和）. That text in a
    // practice chapter is the answer to the exercise, printed above the board.
    for (const entry of XIANGQI_ENDGAME_CORPUS) {
      for (const lang of ENDGAME_STUDY_LANGS) {
        const comment = localizedPracticeComment(entry, lang);
        if (!comment) continue;
        assert.ok(
          !/例勝|例胜|例和/.test(comment),
          `${entry.id} ${lang} comment gives the verdict away: ${comment}`,
        );
      }
    }
  });
});
