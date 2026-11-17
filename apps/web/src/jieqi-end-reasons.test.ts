import { describe, expect, it } from 'vitest';
import { terminationLabel } from './game-display.js';
import { ensureLocaleCatalog, t } from './i18n/catalog.js';
import { finishBadgesForResult } from './live-finish-badges.js';
import { jieqiReasonPhrase } from './live-jieqi.js';
import { MOVE_ENDED_TERMINATIONS } from './showcase-clock.js';

describe('jieqi check and chase endings', () => {
  it('keeps legacy chasing as check and labels the new reason as chase', () => {
    expect(jieqiReasonPhrase('chasing')).toBe('result.perpetualCheck');
    expect(jieqiReasonPhrase('perpetual-chase')).toBe('result.perpetualChase');
    expect(t(jieqiReasonPhrase('chasing'), undefined, 'en')).toBe('perpetual check');
    expect(t(jieqiReasonPhrase('perpetual-chase'), undefined, 'en')).toBe('perpetual chase');
    expect(terminationLabel('chasing', 'jieqi', 'en')).toBe('Perpetual check');
    expect(terminationLabel('perpetual-chase', 'jieqi', 'en')).toBe('Perpetual chase');
  });

  it('uses the established Chinese terms in both live and replay strings', async () => {
    for (const [locale, check, chase] of [
      ['zh-Hans', '长将', '长捉'],
      ['zh-Hant', '長將', '長捉'],
    ] as const) {
      await ensureLocaleCatalog(locale);
      expect(t(jieqiReasonPhrase('chasing'), undefined, locale)).toBe(check);
      expect(t(jieqiReasonPhrase('perpetual-chase'), undefined, locale)).toBe(chase);
      expect(terminationLabel('chasing', 'jieqi', locale)).toBe(check);
      expect(terminationLabel('perpetual-chase', 'jieqi', locale)).toBe(chase);
    }
  });

  it('marks a chase as a move ending and gives the losing general the chase badge', () => {
    expect(MOVE_ENDED_TERMINATIONS.has('perpetual-chase')).toBe(true);
    const badges = finishBadgesForResult({
      variant: 'jieqi',
      colors: ['red', 'black'],
      winner: 'black',
      reason: 'perpetual-chase',
      generalSquare: (color) => (color === 'red' ? 'd1' : 'e10'),
    });
    expect(badges.find((badge) => badge.kind === 'loser')).toMatchObject({
      square: 'd1',
      icon: 'loss',
      label: 'Perpetual chase',
    });
  });
});
