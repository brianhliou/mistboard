import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PRACTICE_SECTIONS,
  practiceCatalogSlugs,
  XIANGQI_ENDGAME_PRACTICE_SLUGS,
} from './index.js';

test('every catalogue slug is unique', () => {
  // A duplicate slug would resolve two cards to the same study and silently
  // drop one from the shelf, since the resolver keys a Map by slug.
  const slugs = practiceCatalogSlugs();
  assert.equal(new Set(slugs).size, slugs.length, `duplicate slug in: ${slugs.join(', ')}`);
});

test('slugs match the format the admin route accepts', () => {
  // The route validates /^[a-z0-9]+(?:-[a-z0-9]+)*$/. A catalogue entry the
  // seeder cannot actually set is a card that can never resolve.
  for (const slug of practiceCatalogSlugs()) {
    assert.match(slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `${slug} would be rejected as invalid_slug`);
  }
});

test('every card carries a title and a blurb', () => {
  for (const section of PRACTICE_SECTIONS) {
    assert.ok(section.title.trim(), `section ${section.id} has no title`);
    for (const card of section.cards) {
      assert.ok(card.title.trim(), `${card.slug} has no title`);
      assert.ok(card.blurb.trim(), `${card.slug} has no blurb`);
    }
  }
});

test('the endgame section lists exactly the sets the seeder writes, in shelf order', () => {
  // The catalogue and the set definitions are two lists naming the same five
  // studies. A set defined and not listed is a study nobody can reach; a card
  // with no set behind it resolves to nothing and drops off the shelf.
  const endgames = PRACTICE_SECTIONS.find((section) => section.id === 'endgames');
  assert.ok(endgames, 'the endgames section should exist');
  assert.deepEqual(
    endgames.cards.map((card) => card.slug),
    XIANGQI_ENDGAME_PRACTICE_SLUGS,
  );
});

test('every card subtitle is a short line, not a sentence', () => {
  // The shelf is title plus one line in lichess's manner ("Pin it to win it").
  // A blurb that grows into a description wraps beside the icon at desktop
  // width; the long form belongs to the study page.
  for (const section of PRACTICE_SECTIONS) {
    for (const card of section.cards) {
      assert.ok(card.blurb.length <= 32, `${card.slug}: "${card.blurb}" is over 32 characters`);
      assert.ok(!/[.;:]$/.test(card.blurb), `${card.slug}: a subtitle is not a sentence`);
    }
  }
});
