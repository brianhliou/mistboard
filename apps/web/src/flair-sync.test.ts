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
  FLAIR_KEYS as WEB_FLAIR_KEYS,
} from './flair.js';

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
      const hasPiece = !!icon.querySelector('svg.flair-piece-svg path, svg.flair-piece-svg text');
      expect(hasMask || hasPiece, `${key} renders an empty icon`).toBe(true);
      expect(icon.querySelector('img'), `${key} renders the mask art as a picture`).toBeNull();
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
