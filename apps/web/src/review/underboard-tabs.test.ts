import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadRow, shareRow, underboardPanel } from './underboard-tabs.js';

function shareInputs(): { fen: HTMLInputElement; moves: HTMLTextAreaElement } {
  return {
    fen: document.createElement('input'),
    moves: document.createElement('textarea'),
  };
}

describe('underboard native URL sharing', () => {
  const writeText = vi.fn<(text: string) => Promise<void>>();

  beforeEach(() => {
    vi.useFakeTimers();
    writeText.mockReset().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { languages: ['en'], clipboard: { writeText } });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  function urlRow(): { field: HTMLInputElement; button: HTMLButtonElement } {
    const field = document.createElement('input');
    const panel = underboardPanel(document.createElement('div'), {
      shareMovesInput: document.createElement('textarea'),
      shareUrlInput: field,
      gameUrl: 'https://mistboard.com/review/r1',
    });
    document.body.append(panel);
    const row = [...panel.querySelectorAll('.review-share__row')].find(
      (row) => row.querySelector('.review-share__label')?.textContent === 'Share',
    )!;
    return { field, button: row.querySelector('button')! };
  }

  it('shares the current position URL from the click without copying it', async () => {
    const share = vi.fn<(data?: ShareData) => Promise<void>>().mockResolvedValue(undefined);
    Object.assign(navigator, { share });
    const { field, button } = urlRow();
    field.value = 'https://mistboard.com/review/r1?ply=8';

    expect(button.textContent).toBe('Share');
    button.click();
    // Native share needs the user activation from this click, before any await.
    expect(share).toHaveBeenCalledExactlyOnceWith({ url: field.value });
    await vi.advanceTimersByTimeAsync(0);
    expect(writeText).not.toHaveBeenCalled();
    expect(button.textContent).toBe('Share');
  });

  it('copies the current URL when native sharing is unavailable', async () => {
    const { field, button } = urlRow();
    field.value = 'https://mistboard.com/review/r1?ply=12';
    expect(button.textContent).toBe('Copy');
    button.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(writeText).toHaveBeenCalledExactlyOnceWith(field.value);
    expect(button.textContent).toBe('Copied');
    await vi.advanceTimersByTimeAsync(1200);
    expect(button.textContent).toBe('Copy');
  });

  it('falls back to copying when native sharing is refused', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
    Object.assign(navigator, { share });
    const { field, button } = urlRow();
    button.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(share).toHaveBeenCalledExactlyOnceWith({ url: field.value });
    expect(writeText).toHaveBeenCalledExactlyOnceWith(field.value);
    expect(button.textContent).toBe('Copied');
    await vi.advanceTimersByTimeAsync(1200);
    expect(button.textContent).toBe('Share');
  });

  it('falls back to copying if native sharing throws synchronously', async () => {
    const share = vi.fn(() => {
      throw new TypeError('Sharing is unavailable');
    });
    Object.assign(navigator, { share });
    const { field, button } = urlRow();
    button.click();
    expect(share).toHaveBeenCalledExactlyOnceWith({ url: field.value });
    await vi.advanceTimersByTimeAsync(0);
    expect(writeText).toHaveBeenCalledExactlyOnceWith(field.value);
    expect(button.textContent).toBe('Copied');
  });

  it('copies the requested URL if the position changes while native sharing is pending', async () => {
    let rejectShare!: (error: Error) => void;
    const share = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectShare = reject;
        }),
    );
    Object.assign(navigator, { share });
    const { field, button } = urlRow();
    const requestedUrl = 'https://mistboard.com/review/r1?ply=8';
    field.value = requestedUrl;
    button.click();
    expect(share).toHaveBeenCalledExactlyOnceWith({ url: requestedUrl });
    field.value = 'https://mistboard.com/review/r1?ply=12';
    rejectShare(new Error('Share failed'));
    await vi.advanceTimersByTimeAsync(0);
    expect(writeText).toHaveBeenCalledExactlyOnceWith(requestedUrl);
    expect(button.textContent).toBe('Copied');
  });

  it('leaves the clipboard alone when the share sheet is cancelled', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('Cancelled', 'AbortError'));
    Object.assign(navigator, { share });
    const { field, button } = urlRow();
    button.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(share).toHaveBeenCalledExactlyOnceWith({ url: field.value });
    expect(writeText).not.toHaveBeenCalled();
    expect(button.textContent).toBe('Share');
    expect(document.activeElement).not.toBe(field);
  });

  it.each(['missing', 'denied'] as const)(
    'selects the URL for manual copying when the clipboard is %s',
    async (failure) => {
      if (failure === 'missing') Object.assign(navigator, { clipboard: undefined });
      else writeText.mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
      const { field, button } = urlRow();
      button.click();
      await vi.advanceTimersByTimeAsync(0);
      expect(button.textContent).toBe('Copy');
      expect(document.activeElement).toBe(field);
      expect(field.selectionStart).toBe(0);
      expect(field.selectionEnd).toBe(field.value.length);
    },
  );

  it('selects the URL when both native sharing and clipboard copying fail', async () => {
    Object.assign(navigator, { share: vi.fn().mockRejectedValue(new Error('Share failed')) });
    writeText.mockRejectedValue(new Error('Copy failed'));
    const { field, button } = urlRow();
    button.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(button.textContent).toBe('Share');
    expect(document.activeElement).toBe(field);
    expect(field.selectionEnd).toBe(field.value.length);
  });

  it.each(['FEN', 'Moves', 'Embed'])(
    'keeps the %s row copy-only even when native sharing is available',
    async (label) => {
      const share = vi.fn();
      Object.assign(navigator, { share });
      const field = document.createElement('textarea');
      field.value = 'Exported content';
      const row = shareRow(label, field);
      const button = row.querySelector('button')!;
      expect(button.textContent).toBe('Copy');
      button.click();
      await vi.advanceTimersByTimeAsync(0);
      expect(writeText).toHaveBeenCalledExactlyOnceWith(field.value);
      expect(share).not.toHaveBeenCalled();
    },
  );
});

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
