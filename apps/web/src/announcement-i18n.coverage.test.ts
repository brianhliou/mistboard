import { describe, expect, it } from 'vitest';
import {
  ANNOUNCEMENT_LANGS,
  announcementTranslationKeys,
  hasAnnouncementTranslation,
} from './announcement-i18n.js';
import { allAnnouncements } from './announcements.js';

// Announcements are authored in English and translated in announcement-i18n.ts.
// Two directions are checked, and both matter:
//
// 1. Every live string resolves in every zh script. A new announcement fails
//    here until it is translated, which is the reminder that the feed is
//    trilingual now.
// 2. No dictionary key is orphaned. Editing an English headline detaches its
//    translation silently (the lookup just misses and falls back to English),
//    so the orphaned key is the only observable trace. Failing on it forces the
//    dictionary edit to ride along with the copy change.
function truncate(text: string): string {
  return text.length > 64 ? `${text.slice(0, 61)}...` : text;
}

function liveStrings(): Set<string> {
  const strings = new Set<string>();
  for (const entry of allAnnouncements()) {
    strings.add(entry.headline);
    if (entry.body) strings.add(entry.body);
    if (entry.cta) strings.add(entry.cta);
  }
  return strings;
}

describe('announcement translation coverage', () => {
  it('every announcement string resolves in all zh scripts', () => {
    const missing: string[] = [];
    for (const text of liveStrings()) {
      for (const lang of ANNOUNCEMENT_LANGS) {
        if (!hasAnnouncementTranslation(lang, text)) missing.push(`[${lang}] ${truncate(text)}`);
      }
    }
    expect(missing, `untranslated announcement strings:\n${missing.join('\n')}`).toEqual([]);
  });

  it('dictionaries contain only strings used by current announcements', () => {
    const live = liveStrings();
    const orphans = ANNOUNCEMENT_LANGS.flatMap((lang) =>
      announcementTranslationKeys(lang)
        .filter((key) => !live.has(key))
        .map((key) => `[${lang}] ${truncate(key)}`),
    );
    expect(orphans, `orphaned announcement translation keys:\n${orphans.join('\n')}`).toEqual([]);
  });
});
