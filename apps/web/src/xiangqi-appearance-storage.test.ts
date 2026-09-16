import { describe, expect, it } from 'vitest';
import {
  inferredXiangqiPieceSet,
  normalizeXiangqiBoardLayout,
  normalizeXiangqiBoardTheme,
  normalizeXiangqiPieceSet,
  readStoredXiangqiBoardLayout,
  readStoredXiangqiBoardTheme,
  readStoredXiangqiNotation,
  readStoredXiangqiPieceSet,
  writeStoredXiangqiBoardLayout,
  writeStoredXiangqiBoardTheme,
  writeStoredXiangqiNotation,
  writeStoredXiangqiPieceSet,
} from './xiangqi-appearance-storage.js';

function installLocalStorage(): Storage {
  const values = new Map<string, string>();
  const storage: Storage = {
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    key(index: number) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    get length() {
      return values.size;
    },
  };
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: storage,
  });
  return storage;
}

describe('xiangqi appearance storage normalization', () => {
  it('defaults unknown board layouts to classic intersections', () => {
    expect(normalizeXiangqiBoardLayout(null)).toBe('intersection');
    expect(normalizeXiangqiBoardLayout('unknown')).toBe('intersection');
    expect(normalizeXiangqiBoardLayout('cell')).toBe('cell');
  });

  it('persists the opt-in square-grid layout', () => {
    installLocalStorage();
    writeStoredXiangqiBoardLayout('cell');
    expect(readStoredXiangqiBoardLayout()).toBe('cell');
  });

  it('uses International as the default board style and legacy migration target', () => {
    expect(normalizeXiangqiBoardTheme(null)).toBe('international');
    expect(normalizeXiangqiBoardTheme('unknown')).toBe('international');
    expect(normalizeXiangqiBoardTheme('paper-garden')).toBe('international');
    expect(normalizeXiangqiBoardTheme('tournament')).toBe('international');
    expect(normalizeXiangqiBoardTheme('blue')).toBe('international');
    expect(normalizeXiangqiBoardTheme('mono')).toBe('international');
    expect(normalizeXiangqiBoardTheme('traditional')).toBe('traditional');
  });

  it('migrates stored legacy board themes to International', () => {
    const storage = installLocalStorage();
    storage.setItem('mistboard.xiangqiBoardTheme', 'tournament');
    storage.setItem('mistboard.xiangqiBoardThemeVersion', '3');
    expect(readStoredXiangqiBoardTheme()).toBe('international');
    expect(storage.getItem('mistboard.xiangqiBoardTheme')).toBe('international');
    expect(storage.getItem('mistboard.xiangqiBoardThemeVersion')).toBe('4');
  });

  it('keeps explicit Traditional board style after the migration version is written', () => {
    installLocalStorage();
    writeStoredXiangqiBoardTheme('traditional');
    expect(readStoredXiangqiBoardTheme()).toBe('traditional');
  });

  it('migrates old animal piece-set values to Dobutsu', () => {
    expect(normalizeXiangqiPieceSet('animal')).toBe('animal-dobutsu');
    expect(normalizeXiangqiPieceSet('animal-seal')).toBe('animal-dobutsu');
    expect(normalizeXiangqiPieceSet('animal-origami')).toBe('animal-dobutsu');
  });

  it('infers hanzi pieces for zh interfaces and Chinese-reading regions', () => {
    expect(inferredXiangqiPieceSet('en', null)).toBe('international');
    expect(inferredXiangqiPieceSet('en', 'US')).toBe('international');
    expect(inferredXiangqiPieceSet('zh-Hans', null)).toBe('traditional');
    expect(inferredXiangqiPieceSet('zh-Hant', null)).toBe('traditional');
    for (const country of ['CN', 'TW', 'HK', 'MO', 'SG', 'MY', 'VN']) {
      expect(inferredXiangqiPieceSet('en', country)).toBe('traditional');
    }
  });

  it('follows the inference when nothing is stored', () => {
    const storage = installLocalStorage();
    expect(readStoredXiangqiPieceSet()).toBe('international');
    expect(storage.getItem('mistboard.xiangqiPieceSet')).toBeNull();
    expect(storage.getItem('mistboard.xiangqiPieceSetVersion')).toBe('4');
    document.cookie = 'mb_cc=CN';
    expect(readStoredXiangqiPieceSet()).toBe('traditional');
    expect(storage.getItem('mistboard.xiangqiPieceSet')).toBeNull();
    document.cookie = 'mb_cc=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  });

  it('clears the v3 rollout write so those browsers follow the inference', () => {
    const storage = installLocalStorage();
    storage.setItem('mistboard.xiangqiPieceSet', 'international');
    storage.setItem('mistboard.xiangqiPieceSetVersion', '3');
    document.cookie = 'mb_cc=TW';
    expect(readStoredXiangqiPieceSet()).toBe('traditional');
    expect(storage.getItem('mistboard.xiangqiPieceSet')).toBeNull();
    expect(storage.getItem('mistboard.xiangqiPieceSetVersion')).toBe('4');
    document.cookie = 'mb_cc=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  });

  it('keeps a non-default pick across the v4 rollout', () => {
    const storage = installLocalStorage();
    storage.setItem('mistboard.xiangqiPieceSet', 'symbols');
    storage.setItem('mistboard.xiangqiPieceSetVersion', '3');
    expect(readStoredXiangqiPieceSet()).toBe('symbols');
    expect(storage.getItem('mistboard.xiangqiPieceSetVersion')).toBe('4');
  });

  it('keeps an explicit International pick over the inference once v4 is written', () => {
    installLocalStorage();
    document.cookie = 'mb_cc=CN';
    writeStoredXiangqiPieceSet('international');
    expect(readStoredXiangqiPieceSet()).toBe('international');
    document.cookie = 'mb_cc=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  });

  it('keeps user changes after the rollout version is written', () => {
    installLocalStorage();
    writeStoredXiangqiPieceSet('traditional');
    expect(readStoredXiangqiPieceSet()).toBe('traditional');
  });

  it('accepts and persists the Chess-style prototype', () => {
    installLocalStorage();
    expect(normalizeXiangqiPieceSet('international-flat')).toBe('international-flat');
    writeStoredXiangqiPieceSet('international-flat');
    expect(readStoredXiangqiPieceSet()).toBe('international-flat');
  });

  it('previews a URL-pinned piece set without replacing the saved preference', () => {
    const storage = installLocalStorage();
    writeStoredXiangqiPieceSet('traditional');
    window.history.replaceState({}, '', '/?xqPieces=international-flat');
    expect(readStoredXiangqiPieceSet()).toBe('international-flat');
    expect(storage.getItem('mistboard.xiangqiPieceSet')).toBe('traditional');
    window.history.replaceState({}, '', '/');
  });
});

describe('xiangqi move notation preference', () => {
  it('defaults by locale and writes nothing until the reader chooses', () => {
    const storage = installLocalStorage();
    expect(readStoredXiangqiNotation('en')).toBe('algebraic');
    expect(readStoredXiangqiNotation('zh-Hans')).toBe('chinese');
    expect(readStoredXiangqiNotation('zh-Hant')).toBe('chinese');
    expect(storage.getItem('mistboard.xiangqiNotation')).toBeNull();
  });

  it('keeps an explicit choice across locales', () => {
    installLocalStorage();
    writeStoredXiangqiNotation('wxf');
    expect(readStoredXiangqiNotation('en')).toBe('wxf');
    expect(readStoredXiangqiNotation('zh-Hans')).toBe('wxf');
  });

  it('drops the version-1 site-written coordinate default but keeps a real choice', () => {
    const storage = installLocalStorage();
    storage.setItem('mistboard.xiangqiNotationVersion', '1');
    storage.setItem('mistboard.xiangqiNotation', 'coordinate');
    expect(readStoredXiangqiNotation('en')).toBe('algebraic');
    expect(storage.getItem('mistboard.xiangqiNotation')).toBeNull();
    expect(storage.getItem('mistboard.xiangqiNotationVersion')).toBe('2');

    // ICCS left the gear the same day; a stored choice of it reads as unset.
    storage.setItem('mistboard.xiangqiNotationVersion', '1');
    storage.setItem('mistboard.xiangqiNotation', 'iccs');
    expect(readStoredXiangqiNotation('zh-Hans')).toBe('chinese');
    expect(storage.getItem('mistboard.xiangqiNotation')).toBeNull();

    storage.setItem('mistboard.xiangqiNotationVersion', '1');
    storage.setItem('mistboard.xiangqiNotation', 'chinese');
    expect(readStoredXiangqiNotation('en')).toBe('chinese');
    expect(storage.getItem('mistboard.xiangqiNotationVersion')).toBe('2');
  });
});
