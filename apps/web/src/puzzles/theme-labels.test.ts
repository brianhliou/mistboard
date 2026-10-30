import { JUNGLE_PUZZLE_THEMES, XIANGQI_PUZZLE_THEMES } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { EN_PLAY } from '../i18n/catalogs/play.js';
import { ZH_HANS_PLAY } from '../i18n/catalogs/play.zh-hans.js';
import { ZH_HANT_PLAY } from '../i18n/catalogs/play.zh-hant.js';
import { PUZZLE_THEME_LABEL_KEYS, puzzleThemeLabel } from './queue-panel.js';

const CATALOGS: Record<string, Readonly<Record<string, string>>> = {
  en: EN_PLAY,
  'zh-hans': ZH_HANS_PLAY,
  'zh-hant': ZH_HANT_PLAY,
};

const CJK = /[㐀-鿿]/;

/** Each `<locale>:<theme id>` with no real label: no key, or a key a catalogue lacks. */
function unlabeledThemes(ids: readonly string[]): string[] {
  const missing: string[] = [];
  const keys = PUZZLE_THEME_LABEL_KEYS as Record<string, string | undefined>;
  for (const id of ids) {
    const key = keys[id];
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      const value = key ? catalog[key] : undefined;
      const readable =
        typeof value === 'string' &&
        value.trim() !== '' &&
        (locale === 'en' ? !CJK.test(value) : CJK.test(value));
      if (!readable) missing.push(`${locale}:${id}`);
    }
  }
  return missing;
}

describe('puzzle theme labels', () => {
  it('gives every theme the miners can emit a name in en, zh-hans and zh-hant', () => {
    expect(unlabeledThemes([...XIANGQI_PUZZLE_THEMES, ...JUNGLE_PUZZLE_THEMES])).toEqual([]);
  });

  it('flags a planted theme with no label', () => {
    // The check must fail an id the miner could add without a catalogue entry.
    expect(unlabeledThemes(['matein5'])).toEqual([
      'en:matein5',
      'zh-hans:matein5',
      'zh-hant:matein5',
    ]);
  });

  it('reads as words in English, never as the raw id', () => {
    expect(puzzleThemeLabel('matein2')).toBe('Mate in 2');
    expect(puzzleThemeLabel('crushing')).toBe('Crushing');
    expect(puzzleThemeLabel('middlegame')).toBe('Middlegame');
    expect(puzzleThemeLabel('winning-material')).toBe('Winning material');
  });
});
