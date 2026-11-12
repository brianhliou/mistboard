import { beforeEach, describe, expect, it } from 'vitest';
// The web bundle cannot import server code, so apps/web/src/flair.ts
// hand-maintains a mirror of the server's flair allowlist
// (apps/server/src/flair.ts), which is what actually gates the write. This test
// imports the server source directly (same pattern as
// variant-registry-sync.test.ts) so a flair added to one side and not the other
// fails here instead of shipping as a picker option the server rejects with a
// 400, or a stored key the profile renders as an empty disc.
import {
  FLAIR_KEYS as SERVER_FLAIR_KEYS,
  isFlairKey as serverIsFlairKey,
} from '../../server/src/flair.js';
import {
  buildFlairIcon,
  buildFlairIconIfSet,
  flairLabel,
  flairPickerGroups,
  FLAIR_KEYS as WEB_FLAIR_KEYS,
} from './flair.js';
import { XIANGQI_PIECE_SETS } from './xiangqi-piece-sets.js';

describe('flair allowlist: web mirror <-> server authority', () => {
  beforeEach(() => {
    // This environment has no localStorage unless one is installed; the display
    // preference read needs a real one to exercise both sides of the toggle.
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: memoryStorage(),
    });
  });

  it('holds exactly the same keys in the same order', () => {
    expect(WEB_FLAIR_KEYS).toEqual([...SERVER_FLAIR_KEYS]);
  });

  it('accepts every web key on the server side', () => {
    for (const key of WEB_FLAIR_KEYS) {
      expect(
        serverIsFlairKey(key),
        `${key} is offered by the picker but the server rejects it`,
      ).toBe(true);
    }
  });

  it('renders every key with a non-empty label and no placeholder glyph', () => {
    for (const key of WEB_FLAIR_KEYS) {
      const label = flairLabel(key, 'en');
      expect(label, `${key} has no label`).toBeTruthy();
      // A key present in FLAIR_KEYS but missing from both def maps falls
      // through to returning the key itself, which would ship as a label like
      // "piece-red-horse". Catch that here rather than in a screenshot.
      expect(label, `${key} fell through to its raw key as a label`).not.toBe(key);

      const icon = buildFlairIcon(key, { labelled: true });
      expect(icon.dataset.flair).toBe(key);
      expect(icon.getAttribute('aria-label')).toBe(label);
      // Variant flair paints a mask over currentColor; piece flair draws the
      // board's own piece SVG. Both have failed by rendering nothing visible:
      // an empty --flair-mask paints a solid block, and the mask art in an
      // <img> paints a blank white square. Assert each carries real content.
      const mask = icon.querySelector<HTMLElement>('.flair-mask');
      const hasMask = !!mask && /^url\(/.test(mask.style.getPropertyValue('--flair-mask'));
      // Glyph sets draw <path>; the artwork sets, Jungle and some chess pieces
      // draw <image> or <path> too, so any of those counts as content.
      const hasPiece = !!icon.querySelector(
        'svg.flair-piece-svg path, svg.flair-piece-svg text, svg.flair-piece-svg image',
      );
      expect(hasMask || hasPiece, `${key} renders an empty icon`).toBe(true);
      expect(icon.querySelector('img'), `${key} renders the mask art as a picture`).toBeNull();
    }
  });

  it('covers every board piece set, Jungle and chess, keeping the Traditional keys', () => {
    const count = (prefix: string) => WEB_FLAIR_KEYS.filter((key) => key.startsWith(prefix)).length;
    expect(count('piece-')).toBe(XIANGQI_PIECE_SETS.length * 14);
    expect(count('jungle-')).toBe(16);
    expect(count('chess-')).toBe(12);
    // Stored on accounts since flair launched; a rename orphans every wearer.
    for (const key of ['piece-red-general', 'piece-black-soldier']) {
      expect(WEB_FLAIR_KEYS).toContain(key);
    }
    expect(WEB_FLAIR_KEYS).not.toContain('piece-traditional-red-general');
  });

  it('draws each set-named key in its own set, not the viewer default', () => {
    // A lacquer key is the lacquer artwork (an <image> of that set's file); the
    // Traditional and Simplified keys are baked glyph outlines.
    const lacquer = buildFlairIcon('piece-lacquer-red-chariot');
    expect(lacquer.querySelector('image')?.getAttribute('href')).toContain(
      '/piece-sets/xiangqi/lacquer/red-chariot.svg',
    );
    const dobutsu = buildFlairIcon('piece-animal-dobutsu-black-horse');
    expect(dobutsu.querySelector('image')?.getAttribute('href')).toContain('animal-dobutsu');
    expect(buildFlairIcon('piece-red-chariot').querySelector('image')).toBeNull();
    expect(buildFlairIcon('piece-red-chariot').querySelector('path')).not.toBeNull();

    const jungle = buildFlairIcon('jungle-black-tiger');
    expect(jungle.className).toContain('flair-piece');
    expect(jungle.querySelector('svg.flair-piece-svg image')?.getAttribute('href')).toContain(
      '/piece-sets/jungle/dobutsu/black-tiger.png',
    );
    const chess = buildFlairIcon('chess-white-knight');
    expect(chess.className).toContain('flair-piece');
    expect(chess.querySelector('svg.flair-piece-svg')?.getAttribute('viewBox')).toBe('0 0 45 45');
  });

  it('names pieces with the set, colour and xiangqi role words', () => {
    expect(flairLabel('piece-red-chariot', 'en')).toBe('Red Chariot 俥');
    expect(flairLabel('piece-lacquer-red-chariot', 'en')).toBe('Lacquer red chariot');
    expect(flairLabel('piece-international-black-general', 'en')).toBe(
      'International black general',
    );
    expect(flairLabel('jungle-black-tiger', 'en')).toBe('Jungle Chess blue tiger');
    expect(flairLabel('chess-white-knight', 'en')).toBe('Chess white knight');
    for (const key of WEB_FLAIR_KEYS) {
      const label = flairLabel(key, 'en');
      // House style: no em dashes, and xiangqi pieces never take chess names.
      expect(label, key).not.toContain('\u2014');
      if (key.startsWith('piece-')) {
        expect(label, key).not.toMatch(/\b(king|rook|knight|pawn|bishop|queen)\b/i);
      }
    }
  });

  it('groups the picker in board-settings order and covers every key once', () => {
    const groups = flairPickerGroups('en');
    expect(groups.map((group) => group.id)).toEqual([
      'variants',
      ...XIANGQI_PIECE_SETS.map((entry) => `xiangqi-${entry.id}`),
      'jungle',
      'chess',
    ]);
    expect(groups.flatMap((group) => group.keys)).toEqual([...WEB_FLAIR_KEYS]);
    expect(groups.find((group) => group.id === 'xiangqi-lacquer')?.label).toBe('Xiangqi: Lacquer');
    for (const group of groups) {
      expect(group.label, group.id).toBeTruthy();
      if (group.perRow) expect(group.keys.length).toBe(group.perRow * 2);
    }
  });

  // The viewer-facing toggle: someone who turns player flairs off must stop
  // seeing other people's, while the picker keeps showing their own choices.
  it('honours the playerFlairs display preference on the display path only', async () => {
    const { writeDisplayPreference } = await import('./display-preferences.js');
    const key = WEB_FLAIR_KEYS[0]!;

    writeDisplayPreference('playerFlairs', true);
    expect(buildFlairIconIfSet(key)).not.toBeNull();

    writeDisplayPreference('playerFlairs', false);
    expect(buildFlairIconIfSet(key)).toBeNull();
    // The picker path is deliberately ungated.
    expect(buildFlairIcon(key)).not.toBeNull();

    writeDisplayPreference('playerFlairs', true);
  });

  it('marks flair decorative unless it is asked to stand alone', () => {
    const decorative = buildFlairIcon(WEB_FLAIR_KEYS[0]!);
    expect(decorative.getAttribute('aria-hidden')).toBe('true');
    expect(decorative.hasAttribute('aria-label')).toBe(false);

    const standalone = buildFlairIcon(WEB_FLAIR_KEYS[0]!, { labelled: true });
    expect(standalone.getAttribute('role')).toBe('img');
    expect(standalone.hasAttribute('aria-hidden')).toBe(false);
  });
});

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

it('renders and validates Gomoku and existing Fog Chess and Atomic Xiangqi flair with matching marker art', () => {
  for (const [id, file] of [
    ['gomoku', 'gomoku'],
    ['dark-chess', 'fog-chess'],
    ['atomic-xiangqi', 'atomic'],
  ] as const) {
    const key = `variant-${id}`;
    expect(serverIsFlairKey(key)).toBe(true);
    expect(WEB_FLAIR_KEYS).toContain(key);
    const icon = buildFlairIcon(key, { labelled: true });
    expect(
      icon.querySelector<HTMLElement>('.flair-mask')?.style.getPropertyValue('--flair-mask'),
    ).toBe(`url('/variant-markers/final/${file}.png')`);
    expect(icon.getAttribute('aria-label')).not.toBe(key);
  }
});
