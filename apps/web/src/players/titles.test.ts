import { describe, expect, it } from 'vitest';
import { playerTitleFor, titledNames } from './player-title.js';
import { SANCTIONS } from './sanctions.js';
import {
  CXA_GRADES,
  CXA_REVOKED,
  TITLE_SOURCES,
  type TitleConfidence,
  WXF_TITLES,
} from './titles.js';

const RANK: Record<TitleConfidence, number> = { aggregator: 1, press: 2, official: 3 };

describe('title data', () => {
  it('gives every CXA grade a source, and the grade the confidence of its best one', () => {
    for (const [name, grade] of Object.entries(CXA_GRADES)) {
      expect(grade.sources.length, name).toBeGreaterThan(0);
      const best = Math.max(...grade.sources.map((id) => RANK[TITLE_SOURCES[id].confidence]));
      expect(RANK[grade.confidence], name).toBe(best);
    }
  });

  it('keeps no grade or WXF title for a revoked player', () => {
    for (const name of Object.keys(CXA_REVOKED)) {
      expect(CXA_GRADES[name], name).toBeUndefined();
      expect(WXF_TITLES[name], name).toBeUndefined();
    }
  });
});

describe('playerTitleFor', () => {
  it('hides a tag exactly where a ruling revoked the grade', () => {
    for (const name of Object.keys(CXA_REVOKED)) {
      expect(playerTitleFor({ name }), name).toBe(null);
    }
    // Every life ban is among the revoked.
    for (const [name, sanction] of Object.entries(SANCTIONS)) {
      if (sanction.penalty === 'Life') expect(CXA_REVOKED[name], name).toBeDefined();
    }
    // A ban outside the revoking tiers leaves the grade the CXA gave.
    expect(playerTitleFor({ name: '郑一泓' })).toBe('GM');
    expect(playerTitleFor({ name: '李少庚' })).toBe('GM');
    expect(playerTitleFor({ name: '黄竹风' })).toBe('GM');
    expect(playerTitleFor({ name: '孟辰' })).toBe('GM');
  });

  it('puts the authored profile first, then the CXA grade, then the WXF title', () => {
    // National master 2023 (official); a 2025 GM is reported by the press
    // only, so the grade stays NM until a CXA notice confirms it.
    expect(playerTitleFor({ name: '尹昇' })).toBe('NM');
    expect(playerTitleFor({ name: '尹昇', nameEn: 'Yin Sheng' })).toBe('NM');
    expect(playerTitleFor({ slug: 'yin-sheng', name: '尹昇' })).toBe('NM');
    // CXA national master, WXF grandmaster for Macau: the CXA grade decides.
    expect(WXF_TITLES.曹岩磊?.title).toBe('IGM');
    expect(playerTitleFor({ name: '曹岩磊' })).toBe('NM');
    // CXA GM, WXF IM: the CXA grade decides.
    expect(WXF_TITLES.党国蕾?.title).toBe('IM');
    expect(playerTitleFor({ name: '党国蕾' })).toBe('GM');
  });

  it('shows no tag for a grade only an aggregator lists', () => {
    expect(CXA_GRADES.孟繁睿?.confidence).toBe('aggregator');
    expect(playerTitleFor({ name: '孟繁睿' })).toBe(null);
  });

  it('maps a WXF title for a player outside the CXA', () => {
    expect(playerTitleFor({ name: '赖理兄' })).toBe('GM'); // International Grandmaster
    expect(playerTitleFor({ name: '黄学谦' })).toBe('GM');
    expect(playerTitleFor({ name: '冯家俊' })).toBe('IM');
    expect(playerTitleFor({ name: '葛振衣' })).toBe('FM');
    expect(playerTitleFor({ name: '某某某' })).toBe(null);
  });

  it('lists every titled name for the server bake', () => {
    const names = new Set(titledNames());
    for (const name of [...Object.keys(CXA_GRADES), ...Object.keys(WXF_TITLES)]) {
      expect(names.has(name), name).toBe(true);
    }
  });
});
