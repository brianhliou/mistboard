import { describe, expect, it } from 'vitest';
import { gameOutcome } from '../game-display.js';
import {
  buildReviewMeta,
  labelize,
  reviewMetaPlayers,
  reviewOutcomeLine,
  reviewResultLabel,
  reviewTimeControlLabel,
} from './game-review-meta.js';

describe('reviewTimeControlLabel', () => {
  it('formats a clock+increment like the xiangqi reference', () => {
    expect(reviewTimeControlLabel({ initialMs: 300_000, incrementMs: 0 })).toBe('5:00+0');
    expect(reviewTimeControlLabel({ initialMs: 180_000, incrementMs: 2000 })).toBe('3:00+2');
  });

  it('reports untimed when both fields are absent', () => {
    expect(reviewTimeControlLabel({ initialMs: null, incrementMs: null })).toBe('Untimed');
    expect(reviewTimeControlLabel({})).toBe('Untimed');
  });

  it('falls back to a nested timeControl object when the flat fields are absent', () => {
    expect(reviewTimeControlLabel({ timeControl: { initialMs: 300_000, incrementMs: 3000 } })).toBe(
      '5:00+3',
    );
  });
});

describe('reviewResultLabel', () => {
  it('maps the fixed-color outcomes', () => {
    expect(reviewResultLabel('red-wins')).toBe('Red wins');
    expect(reviewResultLabel('black-wins')).toBe('Black wins');
    expect(reviewResultLabel('white-wins')).toBe('White wins');
    expect(reviewResultLabel('draw')).toBe('Draw');
  });

  it('brands the Jungle family dark side "Blue" when the variant is passed', () => {
    expect(reviewResultLabel('black-wins', 'jungle')).toBe('Blue wins');
    expect(reviewResultLabel('black-wins', 'jungle-flip')).toBe('Blue wins');
    expect(reviewResultLabel('red-wins', 'jungle')).toBe('Red wins');
    // Non-jungle variants keep the literal color word.
    expect(reviewResultLabel('black-wins', 'xiangqi')).toBe('Black wins');
  });

  it('labelizes an unknown token instead of guessing a color', () => {
    expect(reviewResultLabel('abandoned')).toBe('Abandoned');
  });
});

describe('reviewOutcomeLine', () => {
  it('reads like the live room meta card for a decisive result', () => {
    expect(reviewOutcomeLine({ winner: 'Black' }, 'checkmate')).toBe(
      'Checkmate • Black is victorious',
    );
    expect(reviewOutcomeLine({ winner: 'Red' }, 'king-captured')).toBe(
      'King captured • Red is victorious',
    );
    expect(reviewOutcomeLine({ winner: 'Blue' }, 'elimination')).toBe(
      'Elimination • Blue is victorious',
    );
  });

  it('formats draws as "Draw • <reason>"', () => {
    expect(reviewOutcomeLine({ draw: true }, 'no-progress')).toBe('Draw • No progress');
    expect(reviewOutcomeLine({ draw: true }, '')).toBe('Draw');
  });

  it('degrades gracefully when the termination is missing', () => {
    expect(reviewOutcomeLine({ winner: 'Black' }, '')).toBe('Black is victorious');
  });

  // The old signature took the English label and stripped " wins" to recover
  // the winner, which handed back the whole label once it was translated.
  it('takes the outcome as data, so a translated winner word survives', async () => {
    const { ensureLocaleCatalog } = await import('../i18n/catalog.js');
    await ensureLocaleCatalog('zh-Hans');
    window.history.pushState(null, '', '/zh-hans/');
    try {
      expect(reviewOutcomeLine(gameOutcome('red-wins'), 'checkmate')).toBe('将死 • 红方获胜');
      expect(reviewOutcomeLine(gameOutcome('draw'), 'repetition')).toBe('和棋 • 重复局面');
    } finally {
      window.history.pushState(null, '', '/');
    }
  });
});

describe('reviewMetaPlayers', () => {
  it('normalizes participants and tags engines', () => {
    expect(
      reviewMetaPlayers([
        { color: 'red', name: 'Alice', rating: 2200, kind: 'account' },
        { color: 'black', name: 'Pikafish', rating: null, kind: 'engine' },
      ]),
    ).toEqual([
      { color: 'red', name: 'Alice', rating: 2200, isEngine: false, score: null, profile: null },
      {
        color: 'black',
        name: 'Pikafish',
        rating: null,
        isEngine: true,
        score: null,
        profile: null,
      },
    ]);
  });

  it('links a user seat by handle and a bot seat by bot id, and leaves the rest plain', () => {
    expect(
      reviewMetaPlayers([
        { color: 'red', name: 'Alice', rating: null, kind: 'account', handle: 'alice' },
        { color: 'black', name: 'Misty', rating: null, kind: 'account', botId: 'misty' },
      ]),
    ).toEqual([
      {
        color: 'red',
        name: 'Alice',
        rating: null,
        isEngine: false,
        score: null,
        profile: { kind: 'user', handle: 'alice' },
      },
      {
        // `kind` is 'account' for a bot too, so botId is the only thing that can
        // both raise the BOT tag and address the /bot page.
        color: 'black',
        name: 'Misty',
        rating: null,
        isEngine: true,
        score: null,
        profile: { kind: 'bot', botId: 'misty' },
      },
    ]);
  });

  it('never builds a user link from a seat that carries no handle', () => {
    // A guest, a corpus seat, and a redacted 'Anonymous' row all arrive with no
    // handle; none of them may be linked off the display name.
    expect(
      reviewMetaPlayers([
        { color: 'red', name: 'Anonymous', rating: null, kind: 'account' },
        { color: 'black', name: 'Guest', rating: null, kind: 'guest' },
      ]).map((player) => player.profile),
    ).toEqual([null, null]);
  });

  it('scores the rows off the seat the result names', () => {
    expect(
      reviewMetaPlayers(
        [
          { color: 'red', name: 'Alice', kind: 'account' },
          { color: 'black', name: 'Bob', kind: 'account' },
        ],
        undefined,
        'black-wins',
      ).map((player) => player.score),
    ).toEqual(['0', '1']);
  });

  it('scores a flip game by seat, not by the ink the seat flipped', () => {
    // Banqi/Flip Jungle: the first-mover seat is still called 'red' after it
    // flips black, and 'red-wins' still means that seat. Scoring through the ink
    // would hand the point to the loser in every game that flips.
    expect(
      reviewMetaPlayers(
        [
          { color: 'red', name: 'First', kind: 'account' },
          { color: 'black', name: 'Second', kind: 'account' },
        ],
        { red: 'black', black: 'red' },
        'red-wins',
      ),
    ).toEqual([
      { color: 'black', name: 'First', rating: null, isEngine: false, score: '1', profile: null },
      { color: 'red', name: 'Second', rating: null, isEngine: false, score: '0', profile: null },
    ]);
  });

  it('leaves the rows bare when the game has no settled result', () => {
    const bare = (result: string | null | undefined): (string | null | undefined)[] =>
      reviewMetaPlayers(
        [
          { color: 'red', name: 'Alice', kind: 'account' },
          { color: 'black', name: 'Bob', kind: 'account' },
        ],
        undefined,
        result,
      ).map((player) => player.score);
    expect(bare(undefined)).toEqual([null, null]);
    expect(bare('aborted')).toEqual([null, null]);
    // A winner who is not one of these two seats scores nobody rather than
    // handing both players a 0.
    expect(bare('white-wins')).toEqual([null, null]);
  });

  it('can bind first/second seats to their flip-revealed inks', () => {
    expect(
      reviewMetaPlayers(
        [
          { color: 'red', name: 'First', kind: 'account' },
          { color: 'black', name: 'Second', kind: 'engine' },
        ],
        { red: 'black', black: 'red' },
      ),
    ).toEqual([
      { color: 'black', name: 'First', rating: null, isEngine: false, score: null, profile: null },
      { color: 'red', name: 'Second', rating: null, isEngine: true, score: null, profile: null },
    ]);
  });

  it('is empty when no participants were persisted', () => {
    expect(reviewMetaPlayers(undefined)).toEqual([]);
  });
});

describe('labelize', () => {
  it('title-cases kebab tokens', () => {
    expect(labelize('king-captured')).toBe('King Captured');
  });
});

describe('buildReviewMeta', () => {
  it('renders a meta card + spectator room from the envelope', () => {
    const { metaCard, details } = buildReviewMeta({
      markerId: 'xiangqi',
      variantName: 'Xiangqi',
      status: 'Red wins by Checkmate',
      game: {
        roomId: 'xq_test',
        rated: true,
        initialMs: 300_000,
        incrementMs: 0,
        endedAt: null,
        players: [
          { color: 'red', name: 'Alice', rating: 2200, kind: 'account' },
          { color: 'black', name: 'Bob', rating: 2100, kind: 'account' },
        ],
      },
    });
    expect(metaCard.classList.contains('game-meta-card')).toBe(true);
    expect(metaCard.textContent).toContain('5:00+0');
    expect(metaCard.textContent).toContain('Rated');
    expect(metaCard.textContent).toContain('Xiangqi');
    expect(metaCard.textContent).toContain('Alice');
    expect(metaCard.textContent).toContain('Red wins by Checkmate');
    expect(details.classList.contains('review-spectator-chat')).toBe(true);
  });

  it('marks the winning row and scores both seats from the envelope result', () => {
    const { metaCard } = buildReviewMeta({
      markerId: 'xiangqi',
      variantName: 'Xiangqi',
      status: 'Checkmate • Red is victorious',
      game: {
        roomId: 'xq_test',
        result: 'red-wins',
        players: [
          { color: 'red', name: 'Alice', kind: 'account' },
          { color: 'black', name: 'Bob', kind: 'account' },
        ],
      },
    });
    const rows = metaCard.querySelectorAll('.game-meta-card__player');
    expect(
      [...rows].map((row) => row.querySelector('.game-meta-card__score')?.textContent),
    ).toEqual(['1', '0']);
    expect([...rows].map((row) => row.classList.contains('game-meta-card__player--won'))).toEqual([
      true,
      false,
    ]);
  });

  it('scores a draw on both rows and marks neither as the winner', () => {
    const { metaCard } = buildReviewMeta({
      markerId: 'xiangqi',
      variantName: 'Xiangqi',
      status: 'Draw • no progress',
      game: {
        roomId: 'xq_draw',
        result: 'draw',
        players: [
          { color: 'red', name: 'Alice', kind: 'account' },
          { color: 'black', name: 'Bob', kind: 'account' },
        ],
      },
    });
    const rows = metaCard.querySelectorAll('.game-meta-card__player');
    expect(
      [...rows].map((row) => row.querySelector('.game-meta-card__score')?.textContent),
    ).toEqual(['½', '½']);
    expect(metaCard.querySelectorAll('.game-meta-card__player--won')).toHaveLength(0);
  });
});
