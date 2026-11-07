import { PERSON_NAME_SCRIPTS, personNameForLocale } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { ensureLocaleCatalog } from './i18n/catalog.js';

import { cxaPointsFor, cxaRatingsFor } from './players/cxa-coverage.js';
import { CXA_POINTS } from './players/cxa-points.js';
import { CXA_RATINGS } from './players/cxa-ratings.js';
import { playerTitleFor, titledNames } from './players/player-title.js';
import { SANCTIONS } from './players/sanctions.js';
import { XIANGQIQIPU_PHOTOS } from './players/xiangqiqipu-photos.js';
import { displayName, playerPortrait } from './xiangqi-players.js';

const UNRESOLVED = ['周世杰', '陈富杰', '钟少鸿', '阮晋发', '陈有发', '黄勇发', '谢云'];

describe('curated player names', () => {
  it('checks every local title, rating, points, sanction and photo name, with explicit unresolved exceptions', () => {
    const names = new Set([
      ...titledNames(),
      ...Object.keys(CXA_POINTS),
      ...Object.keys(CXA_RATINGS),
      ...Object.keys(SANCTIONS),
      ...XIANGQIQIPU_PHOTOS.map((p) => p.name),
    ]);
    expect([...names].filter((name) => PERSON_NAME_SCRIPTS[name] === undefined).sort()).toEqual(
      [...UNRESOLVED].sort(),
    );
  });
  it('keeps Simplified keys for title and rating references while localizing display', () => {
    const source = { name: '许文章', nameEn: 'Xu Wenzhang' };
    const ratings = cxaRatingsFor(source.name);
    const title = playerTitleFor(source);
    for (const locale of ['zh-Hans', 'zh-Hant', 'en'] as const) {
      displayName(source, locale);
      expect(cxaRatingsFor(source.name)).toEqual(ratings);
      expect(playerTitleFor(source)).toBe(title);
      expect(source.name).toBe('许文章');
    }
    expect(ratings.length).toBeGreaterThan(0);
    expect(title).toBe('NM');
    expect(cxaPointsFor('赵奕帆')).toEqual([]);
    expect(personNameForLocale({ name: '赵奕帆', nameOwn: '趙奕帆' }, 'en')).toBe('趙奕帆');
  });
  it('localizes portrait alt text without changing source photo identities, credits or URLs', async () => {
    const previous = window.location.href;
    const photo = XIANGQIQIPU_PHOTOS.find((p) => p.name === '蔡佑广')!;
    expect(photo).toBeDefined();
    const before = JSON.stringify(photo);
    try {
      for (const locale of ['zh-Hans', 'zh-Hant'] as const) {
        await ensureLocaleCatalog(locale);
        window.history.replaceState({}, '', `/${locale.toLowerCase()}/players/test`);
        const portrait = playerPortrait({
          slug: photo.slug,
          name: photo.name,
          nameEn: 'Cai Youguang',
        });
        expect(portrait.querySelector('img')?.alt).toContain(
          locale === 'zh-Hant' ? '蔡佑廣' : '蔡佑广',
        );
        expect(portrait.querySelector('a')?.getAttribute('href')).toBe(photo.sourceUrl);
        expect(portrait.querySelector('a')?.textContent).toBe(photo.credit);
      }
    } finally {
      window.history.replaceState({}, '', previous);
    }
    expect(JSON.stringify(photo)).toBe(before);
  });
});
