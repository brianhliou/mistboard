import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PERSON_NAME_SCRIPTS,
  personNameForLocale,
  personNamesInText,
} from './person-name-scripts.js';

test('page-script forms override planted wrong surname forms without changing identity', () => {
  for (const [name, hant, wrong] of [
    ['党斐', '党斐', '黨斐'],
    ['于幼华', '于幼華', '於幼華'],
    ['孙勇征', '孫勇征', '孫勇徵'],
    ['赵奕帆', '趙奕帆', '趙奕帆'],
  ]) {
    const source = { name: name!, nameOwn: wrong! };
    assert.equal(personNameForLocale(source, 'zh-Hant'), hant);
    assert.equal(personNameForLocale(source, 'zh-Hans'), name);
    assert.equal(personNameForLocale({ name: hant! }, 'zh-Hans'), name);
    assert.equal(source.name, name);
    assert.equal(personNameForLocale(source, 'en'), wrong);
  }
});
test('checked forms round-trip, unknown and unresolved names stay verbatim', () => {
  for (const [hans, hant] of Object.entries(PERSON_NAME_SCRIPTS)) {
    assert.equal(personNameForLocale({ name: hans }, 'zh-Hant'), hant);
  }
  for (const name of ['谢云', '周世杰', '钟少鸿', 'Unlisted Player']) {
    assert.equal(personNameForLocale({ name }, 'zh-Hant'), name);
  }
  assert.equal(
    personNamesInText('杨官璘对于幼华；党斐、孙勇征', 'zh-Hant'),
    '楊官璘对于幼華；党斐、孫勇征',
  );
  assert.equal(personNamesInText('趙奕帆、楊官璘', 'zh-Hans'), '赵奕帆、杨官璘');
});
