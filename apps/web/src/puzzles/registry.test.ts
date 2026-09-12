/**
 * Conformance: every variant that ships a playable puzzle corpus has a
 * registered PuzzleBoardAdapter, and the registry is fail-closed for
 * everything else.
 *
 * The corpus enumeration is derived, not hand-listed, from BOTH sources:
 *  - the SEED assets (packages/game/seed, via @mistboard/game/puzzle-seed) —
 *    since #183 this is what the server actually serves (synced into the
 *    `puzzles` table; served directly when persistence is off), and
 *  - the `*_PUZZLES` fixture exports scanned off the @mistboard/game namespace
 *    (small verbatim subsets of the seed kept for kernel/unit tests).
 * A corpus variant with no adapter fails here loudly instead of throwing at
 * runtime when a deep link paints the board.
 */

import * as game from '@mistboard/game';
import { loadAllSeedPuzzles } from '@mistboard/game/puzzle-seed';
import { describe, expect, it } from 'vitest';
import {
  allPuzzleBoardAdapters,
  isPuzzleVariant,
  PUZZLE_VARIANT_IDS,
  puzzleBoardAdapter,
} from './registry.js';

type CorpusPuzzle = { id: string; variant: string; initial: unknown; solution: unknown[] };

function isCorpusPuzzle(value: unknown): value is CorpusPuzzle {
  if (!value || typeof value !== 'object') return false;
  const puzzle = value as Record<string, unknown>;
  return (
    typeof puzzle.id === 'string' &&
    typeof puzzle.variant === 'string' &&
    puzzle.initial !== undefined &&
    Array.isArray(puzzle.solution)
  );
}

// Every non-empty `*_PUZZLES` fixture export whose members are playable
// puzzles, PLUS the seed corpus the server actually serves (#183). Scanning
// both keeps the derivation honest: fixtures alone could shrink to a subset of
// the served variants, the seed alone would miss a fixture-only regression.
function playableCorpora(): Array<[name: string, puzzles: CorpusPuzzle[]]> {
  const corpora: Array<[string, CorpusPuzzle[]]> = [];
  for (const [name, value] of Object.entries(game as Record<string, unknown>)) {
    if (!name.endsWith('PUZZLES') || !Array.isArray(value) || value.length === 0) continue;
    if (!value.every(isCorpusPuzzle)) continue;
    corpora.push([name, value]);
  }
  const seed = [...loadAllSeedPuzzles()];
  if (seed.length > 0 && seed.every(isCorpusPuzzle)) {
    corpora.push(['SEED_PUZZLES', seed]);
  }
  return corpora;
}

describe('puzzle board adapter registry', () => {
  it('finds the playable puzzle corpora (guards the scan itself)', () => {
    const names = playableCorpora().map(([name]) => name);
    // If this shrinks to nothing the derivation below would vacuously pass, so
    // pin the known family corpora as a floor: the fixture registries that still
    // ship puzzles, plus the served seed corpus. FORTRESS_XIANGQI_PUZZLES left
    // this list on 2026-09-03 when Fortress stopped shipping puzzles; the scan
    // skips empty arrays, so an empty registry is invisible to it by design.
    expect(names).toEqual(
      expect.arrayContaining(['JUNGLE_PUZZLES', 'XIANGQI_PUZZLES', 'SEED_PUZZLES']),
    );
  });

  it('registers an adapter for every variant that ships puzzles', () => {
    const variantsWithPuzzles = new Set<string>();
    for (const [, puzzles] of playableCorpora()) {
      for (const puzzle of puzzles) variantsWithPuzzles.add(puzzle.variant);
    }
    expect(variantsWithPuzzles.size).toBeGreaterThan(0);
    for (const variant of variantsWithPuzzles) {
      expect(isPuzzleVariant(variant), `variant "${variant}" has puzzles but no adapter`).toBe(
        true,
      );
      expect(puzzleBoardAdapter(variant).variant).toBe(variant);
    }
  });

  it('keeps every adapter structurally complete and keyed by its own variant', () => {
    expect(allPuzzleBoardAdapters()).toHaveLength(PUZZLE_VARIANT_IDS.length);
    for (const variant of PUZZLE_VARIANT_IDS) {
      const adapter = puzzleBoardAdapter(variant);
      expect(adapter.variant).toBe(variant);
      expect(adapter.labelKey.length).toBeGreaterThan(0);
      expect(adapter.markerId.length).toBeGreaterThan(0);
      expect(typeof adapter.paintBoard).toBe('function');
      expect(typeof adapter.animateMove).toBe('function');
      expect(typeof adapter.applyMove).toBe('function');
      expect(typeof adapter.moveLabel).toBe('function');
      expect(typeof adapter.sideIconSvg).toBe('function');
    }
  });

  it('fails closed on unknown variants (no fallback board)', () => {
    expect(isPuzzleVariant('banqi')).toBe(false);
    expect(() => puzzleBoardAdapter('banqi')).toThrow(/no board adapter/i);
    expect(() => puzzleBoardAdapter('')).toThrow(/no board adapter/i);
    // Prototype keys must not resolve through the registry object.
    expect(isPuzzleVariant('toString')).toBe(false);
    expect(() => puzzleBoardAdapter('constructor')).toThrow(/no board adapter/i);
  });
});
