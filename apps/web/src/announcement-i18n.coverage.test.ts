import { describe, expect, it } from 'vitest';
import {
  ANNOUNCEMENT_LANGS,
  announcementTranslationKeys,
  hasAnnouncementTranslation,
  localizeAnnouncement,
  localizeAnnouncementString,
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
  it.each([
    ['zh-Hans', '翻翻兽棋已上线。'],
    ['zh-Hant', '翻翻獸棋已上線。'],
  ] as const)('uses the localized Flip Jungle launch name in %s', (locale, headline) => {
    expect(localizeAnnouncementString('Flip Jungle has launched.', locale)).toBe(headline);
  });

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

it('localizes person occurrences in copy without changing announcement identity', () => {
  const entry = {
    date: '2026-11-06',
    kind: 'update' as const,
    headline: '杨官璘对于幼华、孙勇征、党斐、赵奕帆',
    body: '趙奕帆',
    href: '/players/source-identity',
  };
  const source = JSON.stringify(entry);
  const hant = localizeAnnouncement(entry, 'zh-Hant');
  expect(hant.headline).toBe('楊官璘对于幼華、孫勇征、党斐、趙奕帆');
  expect(localizeAnnouncement(entry, 'zh-Hans').body).toBe('赵奕帆');
  expect(hant.href).toBe(entry.href);
  expect(localizeAnnouncement(entry, 'en')).toBe(entry);
  expect(JSON.stringify(entry)).toBe(source);
});
