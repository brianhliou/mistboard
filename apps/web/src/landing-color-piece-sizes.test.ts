import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Side-picker piece art is sized twice: the stacked desktop option and the
// phone setup row. A kind sized only for desktop rises out of its button on a
// phone (the xiangqi general, 2026-11-05).
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'landing-play.css'), 'utf8');

function pieceKinds(source: string, prefix: string): Set<string> {
  const kinds = new Set<string>();
  const pattern = new RegExp(`${prefix}\\.landing-color-piece\\.([a-z-]+)\\s*[,{]`, 'g');
  for (const match of source.matchAll(pattern)) kinds.add(match[1]!);
  return kinds;
}

describe('side-picker piece sizes', () => {
  it('every piece kind has a phone setup-row size', () => {
    const desktop = pieceKinds(css, '(?:^|\\n)');
    const phone = pieceKinds(css, '\\.landing-setup-row ');
    expect([...desktop].sort()).toEqual(['chess', 'jungle', 'stone', 'xiangqi']);
    expect([...desktop].filter((kind) => !phone.has(kind))).toEqual([]);
  });

  it('catches a kind with no phone size', () => {
    const planted = `${css}\n.landing-color-piece.planted {\n  width: 44px;\n}\n`;
    const phone = pieceKinds(planted, '\\.landing-setup-row ');
    expect(pieceKinds(planted, '(?:^|\\n)').has('planted')).toBe(true);
    expect(phone.has('planted')).toBe(false);
  });
});
