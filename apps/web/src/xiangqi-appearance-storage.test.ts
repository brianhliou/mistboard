import { describe, expect, it } from 'vitest';
import {
  inferredXiangqiPieceSet,
  normalizeXiangqiBoardLayout,
  normalizeXiangqiBoardTheme,
  normalizeXiangqiPieceSet,
  readStoredXiangqiBoardColor,
  readStoredXiangqiBoardLayout,
  readStoredXiangqiBoardTheme,
  readStoredXiangqiNotation,
  readStoredXiangqiPieceSet,
  readStoredXiangqiPieceShadow,
  readStoredXiangqiRiverText,
  readStoredXiangqiStartMarkers,
  writeStoredXiangqiBoardColor,
  writeStoredXiangqiBoardLayout,
  writeStoredXiangqiNotation,
  writeStoredXiangqiPieceSet,
  writeStoredXiangqiPieceShadow,
  writeStoredXiangqiRiverText,
  writeStoredXiangqiStartMarkers,
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
    // Traditional is a colour plus a river text now (migrated on read below).
    expect(normalizeXiangqiBoardTheme('traditional')).toBe('international');
    expect(normalizeXiangqiBoardTheme('jungle')).toBe('jungle');
  });

  it('migrates stored legacy board themes to International', () => {
    const storage = installLocalStorage();
    storage.setItem('mistboard.xiangqiBoardTheme', 'tournament');
    storage.setItem('mistboard.xiangqiBoardThemeVersion', '3');
    expect(readStoredXiangqiBoardTheme()).toBe('international');
    expect(storage.getItem('mistboard.xiangqiBoardTheme')).toBe('international');
    expect(storage.getItem('mistboard.xiangqiBoardThemeVersion')).toBe('4');
  });

  it('derives the Jungle theme from the Jungle colour on the square grid', () => {
    const storage = installLocalStorage();
    storage.setItem('mistboard.xiangqiBoardColor', 'jungle');
    storage.setItem('mistboard.xiangqiBoardLayout', 'cell');
    storage.setItem('mistboard.xiangqiBoardLayoutVersion', '1');
    expect(readStoredXiangqiBoardTheme()).toBe('jungle');
    // Jungle needs cells: on the lined board it is the standard board.
    storage.setItem('mistboard.xiangqiBoardLayout', 'intersection');
    expect(readStoredXiangqiBoardTheme()).toBe('international');
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
    storage.setItem('mistboard.xiangqiPieceSet', 'wood');
    storage.setItem('mistboard.xiangqiPieceSetVersion', '3');
    expect(readStoredXiangqiPieceSet()).toBe('wood');
    expect(storage.getItem('mistboard.xiangqiPieceSetVersion')).toBe('4');
  });

  it('clears a retired set so the browser follows the inference again', () => {
    for (const retired of ['western', 'symbols']) {
      const storage = installLocalStorage();
      storage.setItem('mistboard.xiangqiPieceSet', retired);
      storage.setItem('mistboard.xiangqiPieceSetVersion', '4');
      document.cookie = 'mb_cc=TW';
      expect(readStoredXiangqiPieceSet()).toBe('traditional');
      expect(storage.getItem('mistboard.xiangqiPieceSet')).toBeNull();
      expect(storage.getItem('mistboard.xiangqiPieceSetVersion')).toBe('4');
      document.cookie = 'mb_cc=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
      expect(readStoredXiangqiPieceSet()).toBe('international');
    }
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

describe('xiangqi board colour, river text and start marker storage', () => {
  it('defaults to the International colour and round-trips a preset', () => {
    const storage = installLocalStorage();
    expect(readStoredXiangqiBoardColor()).toBe('international');
    expect(storage.getItem('mistboard.xiangqiBoardColor')).toBeNull();
    writeStoredXiangqiBoardColor('slate');
    expect(readStoredXiangqiBoardColor()).toBe('slate');
    writeStoredXiangqiBoardColor('international');
    expect(storage.getItem('mistboard.xiangqiBoardColor')).toBe('international');
    // Retired values (the custom picker's hexes, the strong presets) fall back.
    for (const retired of ['#2a3b4c', 'walnut', 'theme', 'not-a-colour']) {
      storage.setItem('mistboard.xiangqiBoardColor', retired);
      expect(readStoredXiangqiBoardColor(), retired).toBe('international');
    }
  });

  it('previews a colour or a river text from the URL without saving it', () => {
    const storage = installLocalStorage();
    window.history.replaceState({}, '', '/?xqBoardColor=birch&xqRiver=brand');
    expect(readStoredXiangqiBoardColor()).toBe('birch');
    expect(readStoredXiangqiRiverText()).toBe('brand');
    expect(storage.getItem('mistboard.xiangqiBoardColor')).toBeNull();
    expect(storage.getItem('mistboard.xiangqiRiverText')).toBeNull();
    window.history.replaceState({}, '', '/');
  });

  it('has no river text by default and remembers each choice', () => {
    const storage = installLocalStorage();
    expect(readStoredXiangqiRiverText()).toBe('off');
    for (const text of ['classic', 'brand', 'off'] as const) {
      writeStoredXiangqiRiverText(text);
      expect(readStoredXiangqiRiverText()).toBe(text);
    }
    storage.setItem('mistboard.xiangqiRiverText', 'wordart');
    expect(readStoredXiangqiRiverText()).toBe('off');
  });

  it('shows start markers by default and remembers turning them off', () => {
    installLocalStorage();
    expect(readStoredXiangqiStartMarkers()).toBe(true);
    writeStoredXiangqiStartMarkers(false);
    expect(readStoredXiangqiStartMarkers()).toBe(false);
    writeStoredXiangqiStartMarkers(true);
    expect(readStoredXiangqiStartMarkers()).toBe(true);
  });

  it('draws the piece shadow by default without storing it, and remembers turning it off', () => {
    const storage = installLocalStorage();
    expect(readStoredXiangqiPieceShadow()).toBe(true);
    // Reading the default writes nothing: a later change of default reaches
    // every browser that never chose.
    expect(storage.getItem('mistboard.xiangqiPieceShadow')).toBeNull();
    writeStoredXiangqiPieceShadow(false);
    expect(storage.getItem('mistboard.xiangqiPieceShadow')).toBe('off');
    expect(readStoredXiangqiPieceShadow()).toBe(false);
    writeStoredXiangqiPieceShadow(true);
    expect(storage.getItem('mistboard.xiangqiPieceShadow')).toBe('on');
    expect(readStoredXiangqiPieceShadow()).toBe(true);
    storage.setItem('mistboard.xiangqiPieceShadow', 'sometimes');
    expect(readStoredXiangqiPieceShadow()).toBe(true);
  });

  it('previews the piece shadow from ?xqShadow= without saving it', () => {
    const storage = installLocalStorage();
    window.history.replaceState({}, '', '/?xqShadow=off');
    expect(readStoredXiangqiPieceShadow()).toBe(false);
    writeStoredXiangqiPieceShadow(true);
    // The preview still wins over a stored pick until a click ends it.
    expect(readStoredXiangqiPieceShadow()).toBe(false);
    window.history.replaceState({}, '', '/?xqShadow=on');
    storage.setItem('mistboard.xiangqiPieceShadow', 'off');
    expect(readStoredXiangqiPieceShadow()).toBe(true);
    window.history.replaceState({}, '', '/');
    expect(readStoredXiangqiPieceShadow()).toBe(false);
  });
});

// The Traditional board theme folded into a colour and a river text on
// 2026-10-08. A browser that picked it must see the same board afterwards.
describe('migrating the Traditional board theme', () => {
  it('turns a stored Traditional into its colour plus 楚河 漢界, whichever reader runs first', () => {
    for (const first of ['theme', 'color', 'river'] as const) {
      const storage = installLocalStorage();
      storage.setItem('mistboard.xiangqiBoardTheme', 'traditional');
      storage.setItem('mistboard.xiangqiBoardThemeVersion', '4');
      if (first === 'color') readStoredXiangqiBoardColor();
      if (first === 'river') readStoredXiangqiRiverText();
      expect(readStoredXiangqiBoardTheme(), first).toBe('international');
      expect(readStoredXiangqiBoardColor(), first).toBe('traditional');
      expect(readStoredXiangqiRiverText(), first).toBe('classic');
      expect(storage.getItem('mistboard.xiangqiBoardTheme')).toBe('international');
      // The version is untouched, so no other pick is reset.
      expect(storage.getItem('mistboard.xiangqiBoardThemeVersion')).toBe('4');
    }
  });

  it('keeps the square-grid layout of a Traditional square grid', () => {
    const storage = installLocalStorage();
    storage.setItem('mistboard.xiangqiBoardTheme', 'traditional');
    storage.setItem('mistboard.xiangqiBoardThemeVersion', '4');
    storage.setItem('mistboard.xiangqiBoardLayout', 'cell');
    storage.setItem('mistboard.xiangqiBoardLayoutVersion', '1');
    expect(readStoredXiangqiBoardTheme()).toBe('international');
    expect(readStoredXiangqiBoardLayout()).toBe('cell');
    expect(readStoredXiangqiBoardColor()).toBe('traditional');
  });

  it('never overwrites a colour or river text the reader already picked', () => {
    const storage = installLocalStorage();
    storage.setItem('mistboard.xiangqiBoardTheme', 'traditional');
    storage.setItem('mistboard.xiangqiBoardColor', 'slate');
    storage.setItem('mistboard.xiangqiRiverText', 'brand');
    expect(readStoredXiangqiBoardColor()).toBe('slate');
    expect(readStoredXiangqiRiverText()).toBe('brand');
    expect(readStoredXiangqiBoardTheme()).toBe('international');
  });

  it('leaves an International browser following the defaults', () => {
    const storage = installLocalStorage();
    storage.setItem('mistboard.xiangqiBoardTheme', 'international');
    storage.setItem('mistboard.xiangqiBoardThemeVersion', '4');
    expect(readStoredXiangqiBoardTheme()).toBe('international');
    expect(readStoredXiangqiBoardColor()).toBe('international');
    expect(readStoredXiangqiRiverText()).toBe('off');
    expect(storage.getItem('mistboard.xiangqiBoardColor')).toBeNull();
    expect(storage.getItem('mistboard.xiangqiRiverText')).toBeNull();
  });
});

// The Jungle board theme became the Jungle colour on 2026-10-08. A browser that
// stored it must see the same Jungle board afterwards.
describe('migrating the Jungle board theme', () => {
  it('turns a stored Jungle theme into the Jungle colour, whichever reader runs first', () => {
    for (const first of ['theme', 'color', 'layout'] as const) {
      const storage = installLocalStorage();
      storage.setItem('mistboard.xiangqiBoardTheme', 'jungle');
      storage.setItem('mistboard.xiangqiBoardThemeVersion', '4');
      storage.setItem('mistboard.xiangqiBoardLayout', 'cell');
      storage.setItem('mistboard.xiangqiBoardLayoutVersion', '1');
      // A colour picked before Jungle was hidden under it, so Jungle wins.
      storage.setItem('mistboard.xiangqiBoardColor', 'slate');
      if (first === 'color') readStoredXiangqiBoardColor();
      if (first === 'layout') readStoredXiangqiBoardLayout();
      expect(readStoredXiangqiBoardTheme(), first).toBe('jungle');
      expect(readStoredXiangqiBoardColor(), first).toBe('jungle');
      expect(readStoredXiangqiBoardLayout(), first).toBe('cell');
      expect(storage.getItem('mistboard.xiangqiBoardTheme')).toBe('international');
      expect(storage.getItem('mistboard.xiangqiRiverText')).toBeNull();
    }
  });

  it('puts a Jungle browser on the square grid even if its layout key was lined', () => {
    const storage = installLocalStorage();
    storage.setItem('mistboard.xiangqiBoardTheme', 'jungle');
    storage.setItem('mistboard.xiangqiBoardLayout', 'intersection');
    storage.setItem('mistboard.xiangqiBoardLayoutVersion', '1');
    expect(readStoredXiangqiBoardLayout()).toBe('cell');
    expect(readStoredXiangqiBoardTheme()).toBe('jungle');
  });

  it('migrates once: a later colour pick is not overwritten', () => {
    const storage = installLocalStorage();
    storage.setItem('mistboard.xiangqiBoardTheme', 'jungle');
    expect(readStoredXiangqiBoardColor()).toBe('jungle');
    storage.setItem('mistboard.xiangqiBoardColor', 'oak');
    expect(readStoredXiangqiBoardColor()).toBe('oak');
    expect(readStoredXiangqiBoardTheme()).toBe('international');
  });
});
