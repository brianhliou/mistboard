import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import {
  type BanqiGameState,
  type BanqiTablebaseTable,
  banqiTablebaseTableFromBytes,
  banqiTablebaseUrl,
  parseBanqiFen,
} from '@mistboard/game';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isGzip, loadBanqiTablebase } from './banqi-tablebase-client.js';
import { createBanqiTablebasePanel } from './banqi-tablebase-panel.js';

// The shipped files (public/tablebase/banqi/v1), read straight from disk.
// Paths, not URLs: under jsdom `URL` is jsdom's class, which node:fs refuses.
const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), '../../public');
function fileBytes(key: string): Uint8Array {
  return new Uint8Array(readFileSync(`${PUBLIC}${banqiTablebaseUrl(key)}`));
}
async function diskLoad(key: string): Promise<BanqiTablebaseTable | null> {
  return banqiTablebaseTableFromBytes(key, new Uint8Array(gunzipSync(fileBytes(key))));
}

function position(fen: string): BanqiGameState {
  const parsed = parseBanqiFen(fen);
  if (!parsed.ok) throw new Error(`bad fen ${fen}`);
  return parsed.state;
}

// Chariot and horse (red) against chariot, horse and soldier (black), black to
// move: black wins in 67 plies, but the first capture is 45 away, so the
// 40-move rule draws it over the board.
const ROOT = '8/7r/Hs6/2h4R b - 0 1';
// Chariot and soldier against chariot, black to move: a 23-ply win.
const SHORT = '7r/8/2s5/2R5 b - 0 1';

function rows(el: HTMLElement): HTMLElement[] {
  return [...el.querySelectorAll<HTMLElement>('.bq-tablebase__row')];
}

describe('banqi tablebase panel', () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it('lists every move best first, names the winner and counts the moves that keep the win', async () => {
    const panel = createBanqiTablebasePanel(diskLoad);
    document.body.append(panel.el);
    panel.setActive(true);
    expect(await panel.setState(position(ROOT))).toBe(true);

    expect(panel.el.hidden).toBe(false);
    expect(panel.el.querySelector('.bq-tablebase__title')?.textContent).toBe('Tablebase');
    expect(panel.el.querySelector('.bq-tablebase__verdict')?.textContent).toBe('Black wins in 67');
    const list = rows(panel.el);
    expect(list).toHaveLength(9);
    const wins = list.filter((row) => row.dataset.result === 'win');
    expect(wins).toHaveLength(2);
    expect(panel.el.querySelector('.bq-tablebase__summary')?.textContent).toBe(
      '2 of 9 moves keep the win',
    );
    // Best first: the two wins lead, the fastest on top.
    expect(list.slice(0, 2).every((row) => row.dataset.result === 'win')).toBe(true);
    expect(list[0]?.querySelector('.bq-tablebase__distance')?.textContent).toMatch(
      /^Wins in 67 · next capture in \d+draw by 40-move rule$/,
    );
    // Every win from here is a draw over the board, and is marked.
    for (const row of wins) expect(row.dataset.clockDraw).toBe('');
    expect(panel.el.querySelector('.bq-tablebase__note')?.textContent).toBe(
      'The next capture is 45 moves away with best play, and the 40-move rule ends the game in 40, so over the board this is a draw.',
    );
    expect(panel.el.querySelector('.bq-tablebase__foot')?.textContent).toContain(
      'Repetition and chase rules cannot change a win.',
    );
    expect(panel.el.textContent).not.toContain('—');
  });

  it('leaves a short win unmarked', async () => {
    const panel = createBanqiTablebasePanel(diskLoad);
    panel.setActive(true);
    expect(await panel.setState(position(SHORT))).toBe(true);
    expect(panel.el.querySelector('.bq-tablebase__verdict')?.textContent).toBe('Black wins in 23');
    expect(panel.el.querySelector('[data-clock-draw]')).toBeNull();
    expect(panel.el.querySelector('.bq-tablebase__note')).toBeNull();
  });

  it('past the clock (study board only): says the rule has drawn it and drops the row tags', async () => {
    const panel = createBanqiTablebasePanel(diskLoad);
    panel.setActive(true);
    expect(await panel.setState(position('8/7r/Hs6/2h4R b - 43 1'))).toBe(true);
    expect(panel.el.querySelector('.bq-tablebase__verdict')?.textContent).toBe('Black wins in 67');
    expect(panel.el.querySelector('[data-clock-draw]')).toBeNull();
    expect(panel.el.querySelector('.bq-tablebase__note')?.textContent).toBe(
      'The 40-move rule has already drawn this game over the board (3 moves ago). The study board plays on so the line can be followed.',
    );
  });

  it('plays a clicked row and previews a hovered one', async () => {
    const panel = createBanqiTablebasePanel(diskLoad);
    const played = vi.fn();
    const hovered = vi.fn();
    panel.onPlayMove(played);
    panel.onHoverMove(hovered);
    panel.setActive(true);
    await panel.setState(position(ROOT));

    const best = rows(panel.el)[0];
    if (!best) throw new Error('no rows');
    best.dispatchEvent(new MouseEvent('mouseenter'));
    best.click();
    const move = { from: best.dataset.move?.slice(0, 2), to: best.dataset.move?.slice(2) };
    expect(hovered).toHaveBeenLastCalledWith(move, 'win');
    expect(played).toHaveBeenCalledWith(move);
    // Leaving for a position it does not cover clears the arrow with the table.
    await panel.setState(position('8/7r/Hs6/2c4R b - 0 1'));
    expect(hovered).toHaveBeenLastCalledWith(null, null);
    expect(panel.el.hidden).toBe(true);
  });

  it('a face-down tile anywhere: no lookup and no DOM', async () => {
    const load = vi.fn(diskLoad);
    const panel = createBanqiTablebasePanel(load);
    document.body.append(panel.el);
    panel.setActive(true);
    const root = position(ROOT);
    const withTile: BanqiGameState = {
      ...root,
      board: { ...root.board, d4: { color: 'red', role: 'soldier', faceDown: true } },
    };
    expect(await panel.setState(withTile)).toBe(false);
    // A covered piece itself face down.
    const hiddenHorse: BanqiGameState = {
      ...root,
      board: { ...root.board, a2: { color: 'red', role: 'horse', faceDown: true } },
    };
    expect(await panel.setState(hiddenHorse)).toBe(false);
    // The opening deal.
    const opening = parseBanqiFen(
      'XXXXXXXX/XXXXXXXX/XXXXXXXX/XXXXXXXX - G1A2E2R2H2C2S5g1a2e2r2h2c2s5 0 1',
    );
    if (!opening.ok) throw new Error(opening.error);
    expect(await panel.setState(opening.state)).toBe(false);

    expect(load).not.toHaveBeenCalled();
    expect(panel.el.hidden).toBe(true);
    expect(panel.el.childElementCount).toBe(0);
    expect(document.body.querySelector('.bq-tablebase__row')).toBeNull();
  });

  it('fetches nothing while the pane is closed, and shows the latest position on open', async () => {
    const load = vi.fn(diskLoad);
    const panel = createBanqiTablebasePanel(load);
    expect(await panel.setState(position(SHORT))).toBe(false);
    expect(await panel.setState(position(ROOT))).toBe(false);
    expect(load).not.toHaveBeenCalled();
    panel.setActive(true);
    await vi.waitFor(() => expect(panel.el.hidden).toBe(false));
    expect(panel.el.querySelector('.bq-tablebase__verdict')?.textContent).toBe('Black wins in 67');
    panel.setActive(false);
    expect(panel.el.hidden).toBe(true);
  });

  it('a late answer for a position the reader left is dropped', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const panel = createBanqiTablebasePanel(async (key) => {
      if (key === 'rh-rhs') await gate;
      return diskLoad(key);
    });
    panel.setActive(true);
    const slow = panel.setState(position(ROOT));
    expect(await panel.setState(position(SHORT))).toBe(true);
    release();
    expect(await slow).toBe(false);
    expect(panel.el.querySelector('.bq-tablebase__verdict')?.textContent).toBe('Black wins in 23');
  });

  it('a file that fails to load reads as not covered', async () => {
    const panel = createBanqiTablebasePanel(async () => {
      throw new Error('offline');
    });
    panel.setActive(true);
    expect(await panel.setState(position(ROOT))).toBe(false);
    expect(panel.el.hidden).toBe(true);
    expect(panel.el.childElementCount).toBe(0);
  });
});

describe('banqi tablebase client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads a file served decoded (Content-Encoding: gzip) and caches it for the page', async () => {
    const raw = gunzipSync(fileBytes('r-r'));
    const fetchMock = vi.fn(async () => new Response(new Uint8Array(raw)));
    vi.stubGlobal('fetch', fetchMock);
    const table = await loadBanqiTablebase('r-r');
    expect(table?.dtm.length).toBe(512);
    await loadBanqiTablebase('r-r');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/tablebase/banqi/v1/r-r.bin.gz');
  });

  it('a failed load is not cached', async () => {
    const fetchMock = vi.fn(async () => new Response('nope', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await loadBanqiTablebase('h-h')).toBeNull();
    expect(await loadBanqiTablebase('h-h')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('knows gzip by its magic bytes', () => {
    expect(isGzip(new Uint8Array(gzipSync(new Uint8Array([1, 2, 3]))))).toBe(true);
    expect(isGzip(new Uint8Array([1, 2, 3]))).toBe(false);
  });
});
