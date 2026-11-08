import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';

// #621: measure the rendered font size, including rem conversion and media
// queries, for each label flagged by the phone audit. Use a fresh window for
// each viewport so computed-style caches cannot survive a resize.
const labels = [
  {
    file: 'profile-summary-card.css',
    className: 'profile-summary-card-badge',
    text: 'BOT',
    desktop: 10.4,
  },
  { file: 'account-profile.css', className: 'profile-rating-name', text: 'Xiangqi', desktop: 10 },
  { file: 'review/game-meta-card.css', className: 'game-meta-card__bot', text: 'BOT', desktop: 10 },
  { file: 'game-shell.css', className: 'clock-to-move', text: 'to move', desktop: 9 },
  {
    file: 'review/advantage-chart.css',
    className: 'advantage-chart__phase-label',
    text: 'Middlegame',
    desktop: 9,
  },
];

async function fontSize(
  file: string,
  className: string,
  text: string,
  width: number,
  height: number,
): Promise<number> {
  const window = new Window({ width, height });
  try {
    const style = window.document.createElement('style');
    style.textContent = `html { font-size: 16px; } ${readFileSync(new URL(file, import.meta.url), 'utf8')}`;
    window.document.head.append(style);
    const label = window.document.createElement('span');
    label.className = className;
    label.textContent = text;
    window.document.body.append(label);
    return Number.parseFloat(window.getComputedStyle(label).fontSize);
  } finally {
    await window.happyDOM.close();
  }
}

describe.each([
  { width: 390, height: 664 },
  { width: 360, height: 740 },
])('phone label floor at $width × $height', ({ width, height }) => {
  it.each(labels)('$className is at least 11px', async ({ file, className, text }) => {
    expect(await fontSize(file, className, text, width, height)).toBeGreaterThanOrEqual(11);
  });
});

describe('desktop label sizes', () => {
  it.each(labels)(
    '$className keeps its previous size',
    async ({ file, className, text, desktop }) => {
      expect(await fontSize(file, className, text, 1280, 800)).toBeCloseTo(desktop);
    },
  );
});
