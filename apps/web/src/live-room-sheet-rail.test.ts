import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { attachRoomInfoSheet } from './live-room-sheet.js';

// The room's left rail drew a stray rule above the game card on wide screens
// (2026-10-27, first seen on Xiangqi Mahjong; every live room had it). The base
// `.panel-section` carries a top border that `:first-child` takes off, and the
// phone sheet's close button (prepended by attachRoomInfoSheet, display: none
// off phones) made the card's section the second child, so the border came back.

const css = ['styles.css', 'live-review.css']
  .map((file) => readFileSync(resolve(__dirname, file), 'utf-8'))
  .join('\n');

describe('room rail game card', () => {
  it('draws no rule above the first section once the sheet close button is prepended', () => {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.replaceChildren(style);
    const cluster = document.createElement('div');
    const metaPanel = document.createElement('aside');
    metaPanel.className = 'side-panel meta-panel';
    const section = document.createElement('section');
    section.className = 'panel-section';
    const second = document.createElement('section');
    second.className = 'panel-section';
    metaPanel.append(section, second);
    const anchor = document.createElement('div');
    cluster.append(metaPanel, anchor);
    document.body.replaceChildren(cluster);
    const media = { matches: false, addEventListener: () => {} } as unknown as MediaQueryList;
    attachRoomInfoSheet(cluster, metaPanel, anchor, media);

    expect(metaPanel.firstElementChild?.className).toBe('meta-panel__close');
    const first = getComputedStyle(section);
    expect(first.borderTopWidth).toBe('0px');
    expect(first.paddingTop).toBe('0px');
    // A later section keeps its divider.
    expect(getComputedStyle(second).borderTopWidth).toBe('1px');
  });
});
