// The seek card (/games, /correspondence) is a game card waiting for its second
// player: its controls take the empty seat, so it has the game card's rows
// (seat, board, seat, one quiet line) and the same height beside one.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildSeekCard, type SeekCardSeek } from './seek-card.js';

const seek: SeekCardSeek = {
  id: 'seek_1',
  gameSpecId: 'xiangqi',
  daysPerMove: 3,
  creatorName: 'Poster',
};

function accept(): HTMLButtonElement {
  const button = document.createElement('button');
  button.textContent = 'Accept';
  return button;
}

function rows(card: HTMLElement): string[] {
  return [...card.children]
    .filter((el) => !el.classList.contains('current-game-open'))
    .map((el) =>
      el.classList.contains('current-game-seek-slot')
        ? 'slot'
        : el.classList.contains('is-empty-seat')
          ? 'waiting'
          : el.classList.contains('current-game-seat')
            ? 'poster'
            : el.classList.contains('current-game-board')
              ? 'board'
              : el.className,
    );
}

describe('buildSeekCard', () => {
  it('puts Accept in the empty seat above the board, with no button row', () => {
    const card = buildSeekCard(seek, { action: accept(), href: null });
    expect(rows(card)).toEqual(['slot', 'board', 'poster', 'current-game-meta current-game-line']);
    const slot = card.querySelector('.current-game-seek-slot');
    expect(slot?.classList.contains('current-game-seat')).toBe(true);
    expect(slot?.querySelector('button.current-game-seek-action')?.textContent).toBe('Accept');
    expect(card.querySelector('.is-empty-seat, .current-game-seek-actions')).toBeNull();
  });

  it('puts the slot under the board when it is your seat there', () => {
    const card = buildSeekCard(seek, {
      action: accept(),
      href: null,
      side: 'second',
      waitingAtBottom: true,
    });
    expect(rows(card)).toEqual(['poster', 'board', 'slot', 'current-game-meta current-game-line']);
  });

  it('keeps the dashed waiting seat when the card has no controls', () => {
    const card = buildSeekCard(seek, { href: '/correspondence' });
    expect(rows(card)).toEqual([
      'waiting',
      'board',
      'poster',
      'current-game-meta current-game-line',
    ]);
    expect(card.querySelector('.is-empty-seat')?.textContent).toBe('Waiting for an opponent');
  });

  it('says variant, days per move and side in one line, Rated only when rated', () => {
    const line = (rated: boolean) =>
      buildSeekCard(
        { ...seek, rated },
        { action: accept(), details: ['random colors'], href: null },
      ).querySelector('.current-game-line');
    expect(line(false)?.textContent).toBe('Xiangqi · 3 days per move · random colors');
    expect(line(true)?.textContent).toBe('Xiangqi · 3 days per move · Rated · random colors');
    expect(line(false)?.getAttribute('title')).toBe(line(false)?.textContent);
    expect(line(false)?.textContent).not.toMatch(/Casual|Open seek/);
    const card = buildSeekCard(seek, { action: accept(), href: null });
    expect(card.querySelectorAll('.current-game-meta')).toHaveLength(1);
    expect(card.querySelector('.current-game-kind, .current-game-chip')).toBeNull();
  });

  it('says one day per move in the singular', () => {
    const card = buildSeekCard({ ...seek, daysPerMove: 1 }, { href: null });
    expect(card.querySelector('.current-game-line')?.textContent).toBe('Xiangqi · 1 day per move');
  });

  it('leads the line with who your own seek waits for once controls take the seat', () => {
    const card = buildSeekCard(seek, {
      action: accept(),
      href: null,
      waiting: document.createTextNode('Link challenge'),
    });
    expect(card.querySelector('.current-game-line')?.textContent).toBe(
      'Link challenge · Xiangqi · 3 days per move',
    );
  });

  it('puts a notice and then the status line under the meta', () => {
    const notice = document.createElement('p');
    notice.className = 'notice';
    const status = document.createElement('p');
    status.className = 'status';
    const card = buildSeekCard(seek, { action: accept(), href: null, notice, status });
    expect(rows(card).slice(-3)).toEqual([
      'current-game-meta current-game-line',
      'notice',
      'status',
    ]);
  });
});

describe('seek card styles', () => {
  const css = readFileSync('src/current-games.css', 'utf8');
  const body = (selector: string): string => {
    const at = css.indexOf(`${selector} {`);
    if (at < 0) throw new Error(`no rule for ${selector}`);
    return css.slice(at, css.indexOf('}', at));
  };
  const px = (rule: string, prop: string): number =>
    Number(rule.match(new RegExp(`${prop}:\\s*(-?\\d+)px`))?.[1] ?? Number.NaN);

  it('makes Accept and the other seat controls at least 40px tall', () => {
    expect(
      px(
        body('.current-game-card .current-game-seek-slot > .current-game-seek-action'),
        'min-height',
      ),
    ).toBeGreaterThanOrEqual(40);
    expect(
      px(body('.current-game-card .current-game-seek-slot .correspondence-ghost'), 'min-height'),
    ).toBeGreaterThanOrEqual(40);
    expect(px(body('.current-game-seek-accept'), 'min-height')).toBeGreaterThanOrEqual(40);
  });

  it('gives game and seek cards in Playing now one seat height that holds Accept', () => {
    const seat = body(
      '.current-games-section[data-section="playing"]\n  .current-game-card:is(.is-slim, .is-seek)\n  > .current-game-seat',
    );
    const action = body(
      '.current-games-section[data-section="playing"]\n  .current-game-card.is-seek\n  > .current-game-seek-slot\n  > .current-game-seek-action',
    );
    // A 40px button in the seat row, overhanging into the board's 6px margin.
    expect(px(seat, 'min-height') - 2 * px(action, 'margin-block')).toBeGreaterThanOrEqual(40);
    expect(-px(action, 'margin-block')).toBeLessThan(6);
  });
});
