import { describe, expect, it } from 'vitest';
import { t } from './i18n/catalog.js';
import { darkXiangqiReasonPhrase } from './live-dark-xiangqi.js';
import { duckReasonPhrase } from './live-duck-xiangqi.js';
import { xiangqiReasonPhrase } from './live-xiangqi.js';

// The live room's end line ("Red wins by …", "Draw by …") names the reason the
// kernel finished the game with. A reason missing from the map fell back to
// "the game rules", so a fog game that ended on the 60-ply clock, or a xiangqi
// game drawn the same way, read as if the site did not know why it ended.
const ROOM_REASONS = ['timeout', 'resignation', 'abandonment'];

describe('xiangqi-family live end reasons', () => {
  it('standard xiangqi names every reason its kernel emits', () => {
    for (const reason of [
      ...ROOM_REASONS,
      'checkmate',
      'stalemate',
      'repetition',
      'progress-clock',
      'chasing',
    ]) {
      expect(xiangqiReasonPhrase(reason), reason).not.toBe('result.gameRules');
    }
    expect(xiangqiReasonPhrase('progress-clock')).toBe('result.sixtyPliesNoCapture');
  });

  it('Fog Xiangqi names every reason its kernel emits', () => {
    for (const reason of [
      ...ROOM_REASONS,
      'general-captured',
      'stalemate',
      'repetition',
      'progress-clock',
    ]) {
      expect(darkXiangqiReasonPhrase(reason), reason).not.toBe('result.gameRules');
    }
    expect(darkXiangqiReasonPhrase('stalemate')).toBe('result.stalemate');
    expect(darkXiangqiReasonPhrase('repetition')).toBe('result.threefoldRepetition');
    expect(darkXiangqiReasonPhrase('progress-clock')).toBe('result.sixtyPliesNoCapture');
  });
});

describe('one wording for a game won by capturing the general', () => {
  // Fog said "Red wins by general capture." and Duck said "Red wins by general
  // captured." for the same event. Every variant now uses one key.
  it('Fog Xiangqi, Duck Xiangqi and xiangqi share the key and the phrase', () => {
    expect(darkXiangqiReasonPhrase('general-captured')).toBe('result.generalCapture');
    expect(duckReasonPhrase('general-captured')).toBe('result.generalCapture');
    expect(xiangqiReasonPhrase('general-captured')).toBe('result.generalCapture');
    expect(t('result.colorWinsBy', { color: 'Red', reason: t('result.generalCapture') })).toBe(
      'Red wins by capturing the general.',
    );
  });
});
