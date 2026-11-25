// "Fairy-Stockfish Level 8" was cut to "Fairy-Stockfish Le..." on a /games
// card (2026-10-21): the seat line has about 130px beside the BOT tag and the
// clock. Both Just finished and Playing now cards call the engine FSF and keep
// the full name in the tooltip; a Playing now seat is one line with the BOT tag
// beside the name.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildFinishedTile, buildSeatRow } from './current-games.js';
import type { CurrentGamePlayer } from './current-games-model.js';
import { cardSeatName } from './current-games-model.js';
import { FLAIR_KEYS } from './flair.js';
import { type FeaturedGame, type GameParticipant, localizedBotName } from './game-display.js';
import { hasAppTranslation } from './i18n/catalog.js';
import { SUPPORTED_LOCALES } from './i18n/locale.js';

function player(name: string, isEngine: boolean): CurrentGamePlayer {
  return { color: 'black', name, handle: null, isEngine };
}

function participant(color: GameParticipant['color'], displayName: string): GameParticipant {
  return { color, displayName, subjectType: 'user', subjectId: null, visibility: 'public' };
}

function finishedGame(participants: GameParticipant[], variant = 'xiangqi'): FeaturedGame {
  return {
    roomId: 'finished-room',
    variant,
    result: 'red-wins',
    termination: 'checkmate',
    plyCount: 2,
    whiteName: null,
    blackName: null,
    corpusId: null,
    endedAt: '2026-10-09T12:00:00.000Z',
    participants,
  };
}

describe('cardSeatName', () => {
  it('shortens a Fairy-Stockfish level to FSF', () => {
    expect(cardSeatName('Fairy-Stockfish Level 8')).toBe('FSF Level 8');
    expect(cardSeatName('Fairy-Stockfish Level 2')).toBe('FSF Level 2');
  });

  it('drops the game from Misty only when it is this game', () => {
    expect(cardSeatName('Misty Three Kingdoms Banqi Level 2', 'Three Kingdoms Banqi')).toBe(
      'Misty Level 2',
    );
    expect(cardSeatName('Misty Banqi', 'Banqi')).toBe('Misty');
    for (const name of [
      'Misty Banqi Level 2',
      'Misty Three Kingdoms Banqi fan',
      'Misty Banqiing',
    ]) {
      expect(cardSeatName(name, name.includes('Three') ? 'Three Kingdoms Banqi' : 'Jungle')).toBe(
        name,
      );
    }
  });

  it('leaves every other name alone', () => {
    for (const name of ['Pikafish Level 7', 'Guest', 'Fairy-Stockfish', 'Fairy-Stockfish fan']) {
      expect(cardSeatName(name)).toBe(name);
    }
  });
});

describe('/games seat names', () => {
  it('a live bot seat shows FSF with the BOT tag beside it and the full name as its tooltip', () => {
    const row = buildSeatRow(player('Fairy-Stockfish Level 8', true), {}, 'black');
    const name = row.querySelector<HTMLElement>('.current-game-seat-name');
    expect(name?.textContent).toBe('FSF Level 8');
    expect(name?.title).toBe('Fairy-Stockfish Level 8');
    const label = row.querySelector('.current-game-seat-label');
    expect(label?.lastElementChild?.classList.contains('current-game-bot')).toBe(true);
    expect(label?.contains(row.querySelector('.current-game-seat-clock'))).toBe(false);
  });

  it('a live Misty seat drops the game it is playing from her name', () => {
    const row = buildSeatRow(
      player('Misty Three Kingdoms Banqi Level 2', true),
      {},
      'black',
      'three-kingdoms-banqi',
    );
    const name = row.querySelector<HTMLElement>('.current-game-seat-name');
    expect(name?.textContent).toBe('Misty Level 2');
    expect(name?.title).toBe('Misty Three Kingdoms Banqi Level 2');
  });

  it('a titled, flaired person shows the badge before and the flair after the name', () => {
    const row = buildSeatRow(
      { ...player('Ann', false), handle: 'ann', title: 'xgm', flair: FLAIR_KEYS[0]! },
      {},
      'black',
    );
    const name = row.querySelector<HTMLElement>('a.current-game-seat-name');
    expect(name?.getAttribute('href')).toBe('/@/ann');
    expect(name?.title).toBe('Ann');
    expect(name?.firstElementChild?.classList.contains('title-badge')).toBe(true);
    expect(name?.querySelector('.player-name-text')?.textContent).toBe('Ann');
    expect(name?.lastElementChild?.classList.contains('flair')).toBe(true);
  });

  it('a person is never renamed, whatever the name', () => {
    const row = buildSeatRow(player('Fairy-Stockfish Level 8', false), {}, 'black');
    expect(row.querySelector('.current-game-seat-name')?.textContent).toBe(
      'Fairy-Stockfish Level 8',
    );
  });

  it('a finished card shows FSF and keeps the full name as its tooltip', () => {
    const tile = buildFinishedTile(
      finishedGame([participant('red', 'Ann'), participant('black', 'Fairy-Stockfish Level 3')]),
    );
    const seat = tile.querySelector<HTMLElement>('.current-game-finished-seat[data-seat="second"]');
    expect(seat?.querySelector('.current-game-finished-seat-name')?.textContent).toBe(
      'FSF Level 3',
    );
    expect(seat?.title).toBe('Fairy-Stockfish Level 3');
    expect(seat?.querySelector<HTMLElement>('.current-game-finished-seat-name')?.title).toBe(
      'Fairy-Stockfish Level 3',
    );
  });

  it('a finished card calls Misty by her level and keeps the game name as its tooltip', () => {
    const fullName = 'Misty Three Kingdoms Banqi Level 7';
    const tile = buildFinishedTile(
      finishedGame(
        [
          participant('red', 'Ann'),
          {
            ...participant('black', 'MistyThreeKingdomsBanqi level 7'),
            subjectType: 'engine-version',
            subjectId: 'misty-three-kingdoms-banqi-level-7',
          },
        ],
        'three-kingdoms-banqi',
      ),
    );
    const name = tile.querySelector<HTMLElement>(
      '.current-game-finished-seat[data-seat="second"] .current-game-finished-seat-name',
    );
    expect(name?.textContent).toBe('Misty Level 7');
    expect(name?.title).toBe(fullName);
  });
});

// A bot seat read "Pikafish Level 3" beside a translated BOT tag on a /games
// card under Traditional Chinese. The engine's name stays in Latin letters;
// "Level N" takes the term the bot pages publish (bots.levelName).
describe('/games bot levels per locale', () => {
  afterEach(() => vi.unstubAllGlobals());

  function useLocale(locale: string): void {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => (key === 'mistboard.locale' ? locale : null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
  }

  // Keyed by every served locale; a new locale without a row fails here
  // instead of passing on the English fallback.
  const EXPECTED: Record<string, { live: string; finished: string; fullFsf: string }> = {
    en: { live: 'Pikafish Level 3', finished: 'FSF Level 3', fullFsf: 'Fairy-Stockfish Level 3' },
    'zh-Hans': {
      live: 'Pikafish 第 3 级',
      finished: 'FSF 第 3 级',
      fullFsf: 'Fairy-Stockfish 第 3 级',
    },
    'zh-Hant': {
      live: 'Pikafish 第 3 級',
      finished: 'FSF 第 3 級',
      fullFsf: 'Fairy-Stockfish 第 3 級',
    },
  };
  const ENGLISH_LEVEL = /\b[Ll]evel\b/;

  it('has an expectation for every served locale', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...SUPPORTED_LOCALES].sort());
  });

  it.each(SUPPORTED_LOCALES)('%s: a live bot seat names its level in the locale', (locale) => {
    const row = EXPECTED[locale];
    if (!row) throw new Error(`no expected bot name for locale ${locale}`);
    useLocale(locale);
    const seat = buildSeatRow(player('Pikafish Level 3', true), {}, 'black');
    const name = seat.querySelector<HTMLElement>('.current-game-seat-name');
    expect(name?.textContent).toBe(row.live);
    expect(name?.title).toBe(row.live);
    if (locale !== 'en') {
      expect(name?.textContent).not.toMatch(ENGLISH_LEVEL);
      expect(hasAppTranslation(locale, 'bots.levelName')).toBe(true);
    }
  });

  it.each(SUPPORTED_LOCALES)('%s: a finished bot seat names its level in the locale', (locale) => {
    const row = EXPECTED[locale];
    if (!row) throw new Error(`no expected bot name for locale ${locale}`);
    useLocale(locale);
    const tile = buildFinishedTile(
      finishedGame([
        participant('red', 'Ann'),
        { ...participant('black', 'Fairy-Stockfish Level 3'), subjectType: 'bot' },
      ]),
    );
    const seat = tile.querySelector<HTMLElement>('.current-game-finished-seat[data-seat="second"]');
    expect(seat?.querySelector('.current-game-finished-seat-name')?.textContent).toBe(row.finished);
    expect(seat?.title).toBe(row.fullFsf);
  });

  it('never renames a person, under any locale', () => {
    useLocale('zh-Hant');
    const seat = buildSeatRow(player('Pikafish Level 3', false), {}, 'black');
    expect(seat.querySelector('.current-game-seat-name')?.textContent).toBe('Pikafish Level 3');
    const tile = buildFinishedTile(
      finishedGame([participant('red', 'Ann'), participant('black', 'Ann Level 3')]),
    );
    expect(
      tile.querySelector('.current-game-finished-seat[data-seat="second"]')?.textContent,
    ).toContain('Ann Level 3');
  });

  it('the English-level check catches the name seen on /games (planted)', () => {
    expect('Pikafish Level 3').toMatch(ENGLISH_LEVEL);
    expect('Pikafish 第 3 級').not.toMatch(ENGLISH_LEVEL);
  });
});

describe('localizedBotName', () => {
  it('translates only the rung and keeps the engine name', () => {
    expect(localizedBotName('Pikafish Level 3', 'zh-Hant')).toBe('Pikafish 第 3 級');
    expect(localizedBotName('Misty Level 7', 'zh-Hans')).toBe('Misty 第 7 级');
    expect(localizedBotName('Rapfi Level 12', 'zh-Hans')).toBe('Rapfi 第 12 级');
    expect(localizedBotName('Misty Jungle level 3', 'en')).toBe('Misty Jungle Level 3');
  });

  it('leaves a name without a rung alone', () => {
    for (const name of ['AB-JChess', 'Fairy-Stockfish', 'Misty', 'Level 3', 'jqe']) {
      expect(localizedBotName(name, 'zh-Hant')).toBe(name);
    }
  });
});
