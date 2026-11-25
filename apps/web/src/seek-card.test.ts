// The seek card (/games, /correspondence) is a game card waiting for its second
// player: the poster above the board, its controls in the empty seat below it,
// so it has the game card's rows (seat, board, seat, one quiet line) and the
// same height beside one. The seat discs say the colours.
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

const disc = (row: Element | null | undefined) =>
  row?.querySelector<HTMLElement>('.current-game-seat-disc') ?? null;

describe('buildSeekCard', () => {
  it('puts the poster above the board and Accept in the empty seat below it', () => {
    for (const color of [undefined, 'first', 'second', 'random']) {
      const card = buildSeekCard(seek, { action: accept(), color, href: null });
      expect(rows(card)).toEqual([
        'poster',
        'board',
        'slot',
        'current-game-meta current-game-line',
      ]);
    }
    const card = buildSeekCard(seek, { action: accept(), href: null });
    const slot = card.querySelector('.current-game-seek-slot');
    expect(slot?.classList.contains('current-game-seat')).toBe(true);
    expect(slot?.querySelector('button.current-game-seek-action')?.textContent).toBe('Accept');
    expect(card.querySelector('.is-empty-seat, .current-game-seek-actions')).toBeNull();
  });

  it('gives Accept the disc of the side you would play and turns the board to it', () => {
    // The poster took Red: you play Black, at the bottom.
    const red = buildSeekCard(seek, { action: accept(), color: 'first', href: null });
    const slot = red.querySelector('.current-game-seek-slot');
    expect(disc(slot)?.classList.contains('seat-disc--black')).toBe(true);
    expect(disc(slot)?.getAttribute('aria-label')).toBe('Black');
    expect(disc(slot)?.nextElementSibling?.textContent).toBe('Accept');
    const poster = red.querySelector('.current-game-seat:not(.current-game-seek-slot)');
    expect(disc(poster)?.classList.contains('seat-disc--red')).toBe(true);
    expect(red.querySelector<HTMLElement>('.current-game-board')?.dataset.perspective).toBe(
      'second',
    );
    // The poster took Black: you play Red, and the board keeps Red at the bottom.
    const black = buildSeekCard(seek, { action: accept(), color: 'second', href: null });
    expect(disc(black.querySelector('.current-game-seek-slot'))?.className).toContain(
      'seat-disc--red',
    );
    expect(black.querySelector<HTMLElement>('.current-game-board')?.dataset.perspective).toBe(
      'first',
    );
    // Chess seats play white and black.
    const chess = buildSeekCard(
      { ...seek, gameSpecId: 'chess' },
      { action: accept(), color: 'second', href: null },
    );
    expect(disc(chess.querySelector('.current-game-seek-slot'))?.className).toContain(
      'seat-disc--white',
    );
  });

  it('marks random colours with a split disc on both seats and keeps the default board', () => {
    const card = buildSeekCard(seek, { action: accept(), color: 'random', href: null });
    const splits = card.querySelectorAll<HTMLElement>('.current-game-seek-random-disc');
    expect(splits).toHaveLength(2);
    for (const split of splits) {
      expect(split.title).toBe('Random colors');
      expect(split.getAttribute('aria-label')).toBe('Random colors');
      expect(split.getAttribute('role')).toBe('img');
      expect([...split.children].map((half) => half.className)).toEqual([
        'seat-disc seat-disc--red',
        'seat-disc seat-disc--black',
      ]);
    }
    expect(card.querySelector<HTMLElement>('.current-game-board')?.dataset.perspective).toBe(
      undefined,
    );
    expect(card.querySelector('.current-game-line')?.textContent).toBe('Xiangqi · 3 days per move');
  });

  it('draws no disc without a known side, and says the side in words where seats have no colour', () => {
    expect(buildSeekCard(seek, { action: accept(), href: null }).querySelector('.seat-disc')).toBe(
      null,
    );
    const mahjong = buildSeekCard(
      { ...seek, gameSpecId: 'xiangqi-mahjong' },
      { action: accept(), color: 'random', colorLabel: 'random colors', href: null },
    );
    expect(mahjong.querySelector('.seat-disc')).toBeNull();
    expect(mahjong.querySelector('.current-game-line')?.textContent).toMatch(/· random colors$/);
    // Where the discs say it, the line does not.
    const xiangqi = buildSeekCard(seek, {
      action: accept(),
      color: 'first',
      colorLabel: 'You play Black',
      href: null,
    });
    expect(xiangqi.querySelector('.current-game-line')?.textContent).toBe(
      'Xiangqi · 3 days per move',
    );
  });

  it('keeps the dashed waiting seat under the board when the card has no controls', () => {
    const card = buildSeekCard(seek, { color: 'first', href: '/correspondence' });
    expect(rows(card)).toEqual([
      'poster',
      'board',
      'waiting',
      'current-game-meta current-game-line',
    ]);
    expect(card.querySelector('.is-empty-seat')?.textContent).toBe('Waiting for an opponent');
    expect(disc(card.querySelector('.is-empty-seat'))?.className).toContain('seat-disc--black');
  });

  it('says variant and days per move in one line, Rated only when rated', () => {
    const line = (rated: boolean) =>
      buildSeekCard(
        { ...seek, rated },
        { action: accept(), color: 'random', details: ['expires in 2d'], href: null },
      ).querySelector('.current-game-line');
    expect(line(false)?.textContent).toBe('Xiangqi · 3 days per move · expires in 2d');
    expect(line(true)?.textContent).toBe('Xiangqi · 3 days per move · Rated · expires in 2d');
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

  it('gives game and seek cards in Playing now and /correspondence one seat height that holds Accept', () => {
    const seat = body(
      ':is(.current-games-section[data-section="playing"], .correspondence-grid)\n  .current-game-card:is(.is-slim, .is-seek)\n  > .current-game-seat',
    );
    const action = body(
      ':is(.current-games-section[data-section="playing"], .correspondence-grid)\n  .current-game-card.is-seek\n  > .current-game-seek-slot\n  > .current-game-seek-action',
    );
    // A 40px button in the seat row, overhanging into the board's 6px margin.
    expect(px(seat, 'min-height') - 2 * px(action, 'margin-block')).toBeGreaterThanOrEqual(40);
    expect(-px(action, 'margin-block')).toBeLessThan(6);
  });
});
