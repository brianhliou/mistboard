import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SoundKind } from './live-state.js';
import { DEFAULT_SOUND_SET, isSynthesizedSet, SOUND_SETS, soundFileFor } from './sound-sets.js';

const ALL_KINDS: SoundKind[] = [
  'move',
  'capture',
  'captured',
  'cannon-capture',
  'castle',
  'king-capture',
  'king-fall',
  'win',
  'lose',
  'draw',
  'low-time',
  'game-start',
];

describe('sound set registry', () => {
  it('orders the menu sets around the wood default', () => {
    expect(DEFAULT_SOUND_SET).toBe('wood');
    expect(SOUND_SETS.map((set) => set.id)).toEqual([
      'wood',
      'mist',
      'piano',
      'sfx',
      'futuristic',
      'nes',
    ]);
  });

  it('every mapped file exists on disk for every file set', () => {
    for (const set of SOUND_SETS) {
      if (isSynthesizedSet(set.id)) continue;
      for (const kind of ALL_KINDS) {
        const spec = soundFileFor(set.id, kind);
        if (!spec) continue; // unmapped kinds fall back to synth by design
        const path = resolve(__dirname, '..', 'public', spec.file.replace(/^\//, ''));
        expect(existsSync(path), `${set.id}/${kind} -> ${spec.file} missing on disk`).toBe(true);
      }
    }
  });

  it('synthesized sets resolve no files (pure synth)', () => {
    for (const set of SOUND_SETS.filter((entry) => isSynthesizedSet(entry.id))) {
      for (const kind of ALL_KINDS) {
        expect(soundFileFor(set.id, kind)).toBeNull();
      }
    }
  });

  it('maps Wood terminal cues to their matched acoustic family', () => {
    expect(soundFileFor('wood', 'win')).toEqual({
      file: '/sound/wood/win.ogg',
    });
    expect(soundFileFor('wood', 'lose')).toEqual({
      file: '/sound/wood/loss.ogg',
    });
    expect(soundFileFor('wood', 'draw')).toEqual({
      file: '/sound/wood/draw.ogg',
    });
  });
});
