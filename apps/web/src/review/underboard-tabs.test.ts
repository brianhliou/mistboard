import { describe, expect, it } from 'vitest';
import { downloadRow, underboardPanel } from './underboard-tabs.js';

function shareInputs(): { fen: HTMLInputElement; moves: HTMLTextAreaElement } {
  return {
    fen: document.createElement('input'),
    moves: document.createElement('textarea'),
  };
}

describe('underboard Share & export downloads', () => {
  it('renders one download link per format, dressed like the copy buttons', () => {
    const row = downloadRow([
      { text: 'PGN', href: '/api/games/r1/export.pgn', filename: 'mistboard-r1.pgn' },
      { text: 'JSON', href: '/api/games/r1/export.json', filename: 'mistboard-r1.json' },
    ]);
    const anchors = [...row.querySelectorAll('a')];
    expect(row.querySelector('.review-share__label')?.textContent).toBe('Download');
    expect(anchors.map((a) => a.textContent)).toEqual(['PGN', 'JSON']);
    expect(anchors.map((a) => a.getAttribute('href'))).toEqual([
      '/api/games/r1/export.pgn',
      '/api/games/r1/export.json',
    ]);
    expect(anchors.map((a) => a.getAttribute('download'))).toEqual([
      'mistboard-r1.pgn',
      'mistboard-r1.json',
    ]);
    for (const anchor of anchors)
      expect(anchor.classList.contains('review-share__copy')).toBe(true);
  });

  it('appends shareExtra rows after FEN / Share / Moves in the Share & export tab', () => {
    const { fen, moves } = shareInputs();
    const panel = underboardPanel(document.createElement('div'), {
      hasAnalysis: false,
      shareFenInput: fen,
      shareMovesInput: moves,
      gameUrl: 'https://mistboard.com/game/r1',
      shareExtra: [
        downloadRow([{ text: 'PGN', href: '/api/games/r1/export.pgn', filename: 'r1.pgn' }]),
      ],
    });
    const tabs = [...panel.querySelectorAll('.review-underboard-tab')].map((b) => b.textContent);
    expect(tabs).toEqual(['Share & export']);
    const labels = [...panel.querySelectorAll('.review-share__label')].map((el) => el.textContent);
    expect(labels).toEqual(['FEN', 'Share', 'Moves', 'Download']);
  });
});

describe('underboard Share & export without an engine FEN', () => {
  it('omits the FEN row instead of rendering it empty', () => {
    const panel = underboardPanel(document.createElement('div'), {
      hasAnalysis: false,
      shareMovesInput: document.createElement('textarea'),
      gameUrl: 'https://mistboard.com/game/r1',
    });
    const labels = [...panel.querySelectorAll('.review-share__label')].map((el) => el.textContent);
    expect(labels).toEqual(['Share', 'Moves']);
  });
});

describe('underboard Crosstable tab', () => {
  it('loads the head-to-head body once, on the first open', async () => {
    let loads = 0;
    const loaded = document.createElement('div');
    loaded.className = 'loaded-record';
    const panel = underboardPanel(document.createElement('div'), {
      hasAnalysis: true,
      players: { red: 'a', black: 'b' },
      crosstable: {
        load: async () => {
          loads += 1;
          return loaded;
        },
      },
      shareMovesInput: document.createElement('textarea'),
      gameUrl: 'https://mistboard.com/game/r1',
    });
    const button = [...panel.querySelectorAll<HTMLButtonElement>('.review-underboard-tab')].find(
      (b) => b.textContent === 'Crosstable',
    );
    expect(button).toBeDefined();
    expect(loads).toBe(0);
    expect(panel.textContent).toContain('Loading the head-to-head record');
    button?.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(loads).toBe(1);
    expect(panel.querySelector('.loaded-record')).not.toBeNull();
    button?.click();
    await Promise.resolve();
    expect(loads).toBe(1);
  });
});

describe('underboard initialTabId', () => {
  function panelWithTools(initialTabId?: string): HTMLElement {
    const lesson = document.createElement('div');
    return underboardPanel(document.createElement('div'), {
      hasAnalysis: false,
      shareMovesInput: document.createElement('textarea'),
      gameUrl: 'https://mistboard.com/game/r1',
      tools: [
        { id: 'comment', label: 'Comment', body: document.createElement('div') },
        { id: 'lesson', label: 'Lesson', body: lesson },
      ],
      ...(initialTabId ? { initialTabId } : {}),
    });
  }
  function activeTab(panel: HTMLElement): string | null | undefined {
    return panel.querySelector('.review-underboard-tab--active')?.textContent;
  }

  it('opens on the named tab, so a practice chapter lands on Lesson', () => {
    const panel = panelWithTools('lesson');
    expect(activeTab(panel)).toBe('Lesson');
    const bodies = [...panel.querySelectorAll('.review-underboard-bodies > *')] as HTMLElement[];
    const hidden = bodies.map((b) => b.hidden);
    // Exactly one body is showing, and it is the second (Lesson) one.
    expect(hidden.filter((h) => !h).length).toBe(1);
    expect(hidden[1]).toBe(false);
  });

  it('falls back to the first tab when the id is absent or unknown', () => {
    expect(activeTab(panelWithTools())).toBe('Comment');
    expect(activeTab(panelWithTools('no-such-tab'))).toBe('Comment');
  });
});
