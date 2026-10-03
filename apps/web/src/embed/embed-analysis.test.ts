// The game embed's analysis marks, end to end below the DOM: which variants carry them,
// that the embed only ever READS the analysis cache, and what the real jieqi game's
// ply-27 reveal blunder becomes on the sheet and the board.
import { GAME_SPECS } from '@mistboard/game';
import { afterEach, describe, expect, it, vi } from 'vitest';
import jieqiAnalysis from '../review/fixtures/jieqi-23d2a761.analysis.json' with { type: 'json' };
import jieqiDecisions from '../review/fixtures/jieqi-23d2a761.decisions.json' with { type: 'json' };
import {
  EMBED_ANALYSIS_VARIANTS,
  embedAnalysisVariant,
  loadEmbedAnalysis,
} from './embed-analysis.js';

const ROOM = 'jq_23d2a761-b37d-4bf0-a786-3ce7edf7e0fd';

type Call = { url: string; method: string };

function stubApi(routes: Record<string, unknown>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? 'GET' });
    const key = Object.keys(routes).find((suffix) => url.endsWith(suffix));
    const body = key ? routes[key] : undefined;
    return {
      ok: body !== undefined,
      status: body === undefined ? 204 : 200,
      json: async () => body,
    };
  });
  return calls;
}

const noMoves = { playedMoves: async () => [], events: async () => [] };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('EMBED_ANALYSIS_VARIANTS', () => {
  it('names every game spec, with marks exactly where the server stores analysis', () => {
    const ids = GAME_SPECS.map((spec) => spec.id).sort();
    expect(Object.keys(EMBED_ANALYSIS_VARIANTS).sort()).toEqual(ids);
    const withMarks = ids.filter((id) => EMBED_ANALYSIS_VARIANTS[id] !== null);
    expect(withMarks).toEqual([
      'atomic-xiangqi',
      'banqi',
      'dark-chess',
      'fortress-xiangqi',
      'jieqi',
      'jungle',
      'jungle-flip',
      'xiangqi',
    ]);
  });

  it('fails closed on an id it does not know', () => {
    expect(embedAnalysisVariant('kriegspiel')).toBeNull();
    expect(embedAnalysisVariant('toString')).toBeNull();
    expect(embedAnalysisVariant('dark-xiangqi')).toBeNull();
  });

  it('keeps fog chess to words and badges: no eval best move quoted, no board arrows', () => {
    expect(EMBED_ANALYSIS_VARIANTS['dark-chess']).toMatchObject({
      quoteEvalBestMove: false,
      arrows: false,
    });
  });
});

describe('loadEmbedAnalysis', () => {
  it('reads the cache with GETs only, and is null when the game was never analysed', async () => {
    const calls = stubApi({});
    expect(await loadEmbedAnalysis('jieqi', ROOM, noMoves)).toBeNull();
    expect(calls.map((c) => c.method)).toEqual(['GET', 'GET']);
    expect(calls.map((c) => c.url).sort()).toEqual([
      `/api/jieqi/games/${ROOM}/analysis`,
      `/api/jieqi/games/${ROOM}/decisions`,
    ]);
  });

  it('marks the real ply-27 reveal blunder: alternatives on ply 26, the badge on ply 27', async () => {
    const calls = stubApi({
      [`/api/jieqi/games/${ROOM}/analysis`]: jieqiAnalysis,
      [`/api/jieqi/games/${ROOM}/decisions`]: jieqiDecisions,
    });
    const loaded = await loadEmbedAnalysis('jieqi', ROOM, {
      // The reveal b3-d3 (board squares, as the tenant timeline records it).
      playedMoves: async () => [{ ply: 27, from: 'b3', to: 'd3' }],
      events: async () => [],
    });
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
    // The sheet keeps the verdict on the move itself.
    expect(loaded?.annotations.get(27)).toEqual({
      suffix: '??',
      suffixClass: 'blunder',
      note: 'Blunder. e2-d1 was best.',
    });
    // Ply 26, the position the reveal was played from: the best move blue, the
    // runner-ups grey, best last so it paints on top; no badge.
    const before = loaded?.overlayAtPly(26);
    expect(before?.arrows.map((a) => `${a.from}-${a.to}`)).toEqual(['e2-d3', 'e2-f3', 'e2-d1']);
    expect(before?.arrows.at(-1)?.className).toBe('xq-arrow--best');
    expect(before?.glyphs).toEqual([]);
    // Ply 27, the blunder's own position: the ?? badge where the piece landed, and no
    // alternative arrows.
    expect(loaded?.overlayAtPly(27)).toEqual({
      arrows: [],
      glyphs: [{ square: 'd3', kind: 'glyph', text: '??', className: 'xq-marker--blunder' }],
    });
    // A position whose next move was fine stays clean.
    expect(loaded?.overlayAtPly(24)).toEqual({ arrows: [], glyphs: [] });
    expect(loaded?.annotations.has(25)).toBe(false);
  });

  it('still marks quiet moves when the decision layer is not cached', async () => {
    stubApi({ [`/api/jieqi/games/${ROOM}/analysis`]: jieqiAnalysis });
    const loaded = await loadEmbedAnalysis('jieqi', ROOM, noMoves);
    expect(loaded).not.toBeNull();
    // Reveals stay ungraded without the decision layer, as on the review page.
    expect(loaded?.annotations.get(27)).toBeUndefined();
  });

  it('ungrades a move that WAS the engine best move, as the review does', async () => {
    // Red played b3-e3, the engine's own pick, and two searches disagree about it.
    const analysis = {
      engineId: 'test',
      depth: 12,
      plies: [
        { ply: 0, cp: 250, mate: null, best: 'b3e3' },
        { ply: 1, cp: -300, mate: null, best: 'h8e8' },
      ],
    };
    stubApi({ '/api/xiangqi/games/xq_1/analysis': analysis });
    const played = await loadEmbedAnalysis('xiangqi', 'xq_1', {
      playedMoves: async () => [{ ply: 1, from: 'b3', to: 'e3' }],
      events: async () => [],
    });
    expect(played?.annotations.get(1)).toBeUndefined();
    expect(played?.overlayAtPly(0)).toEqual({ arrows: [], glyphs: [] });
    expect(played?.overlayAtPly(1)).toEqual({ arrows: [], glyphs: [] });

    const other = await loadEmbedAnalysis('xiangqi', 'xq_1', {
      playedMoves: async () => [{ ply: 1, from: 'h3', to: 'e3' }],
      events: async () => [],
    });
    expect(other?.annotations.get(1)).toEqual({
      suffix: '??',
      suffixClass: 'blunder',
      note: 'Blunder. b3-e3 was best.',
    });
    // The best move on the position it could have been played from; the badge on the
    // blunder's landing square.
    expect(other?.overlayAtPly(0).arrows).toEqual([
      expect.objectContaining({ from: 'b3', to: 'e3', className: 'xq-arrow--best' }),
    ]);
    expect(other?.overlayAtPly(1)).toEqual({
      arrows: [],
      glyphs: [{ square: 'e3', kind: 'glyph', text: '??', className: 'xq-marker--blunder' }],
    });
  });

  it('never fetches for a variant without stored analysis', async () => {
    const calls = stubApi({});
    expect(await loadEmbedAnalysis('dark-xiangqi', 'dx_1', noMoves)).toBeNull();
    expect(calls).toEqual([]);
  });
});
