import { describe, expect, it } from 'vitest';
import { createGameTable } from './game-table.js';
import { attachRoomInfoSheet } from './live-room-sheet.js';
import { CHAT_LINES_EVENT } from './review/spectator-chat.js';

function room(matches: boolean) {
  const media = { matches, addEventListener: () => {} } as unknown as MediaQueryList;
  const cluster = document.createElement('div');
  const metaPanel = document.createElement('aside');
  const table = createGameTable({ navMenu: true });
  cluster.append(metaPanel, table.el);
  document.body.replaceChildren(cluster);
  const sheet = attachRoomInfoSheet(cluster, metaPanel, table.refs.gameControls, media);
  const row = cluster.querySelector<HTMLButtonElement>('[data-room-info]');
  return { cluster, metaPanel, row, sheet };
}

describe('phone room info sheet', () => {
  it('shows the ☰ row on phones and toggles the sheet from it', () => {
    const { cluster, row } = room(true);
    expect(row?.hidden).toBe(false);
    row?.click();
    expect(cluster.dataset.roomSheet).toBe('open');
    row?.click();
    expect(cluster.dataset.roomSheet).toBeUndefined();
  });

  it('hides the row on wider screens, where the card sits in the rail', () => {
    const { row } = room(false);
    expect(row?.hidden).toBe(true);
  });

  it('closes on Escape, on the close button, and on a tap outside', () => {
    const { cluster, metaPanel, sheet } = room(true);
    sheet.open();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(cluster.dataset.roomSheet).toBeUndefined();
    sheet.open();
    metaPanel.querySelector<HTMLButtonElement>('.meta-panel__close')?.click();
    expect(cluster.dataset.roomSheet).toBeUndefined();
    sheet.open();
    metaPanel.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(cluster.dataset.roomSheet).toBe('open');
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(cluster.dataset.roomSheet).toBeUndefined();
  });

  it('marks ☰ unread for chat lines while closed, and clears on open', () => {
    const { cluster, metaPanel, sheet } = room(true);
    metaPanel.dispatchEvent(new CustomEvent(CHAT_LINES_EVENT, { bubbles: true }));
    expect(cluster.dataset.chatUnread).toBe('');
    sheet.open();
    expect(cluster.dataset.chatUnread).toBeUndefined();
    metaPanel.dispatchEvent(new CustomEvent(CHAT_LINES_EVENT, { bubbles: true }));
    expect(cluster.dataset.chatUnread).toBeUndefined();
  });
});
