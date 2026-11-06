import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildArticlePage } from './articles.js';

afterEach(() => vi.unstubAllEnvs());

function playButtons(page: HTMLElement): (string | null)[][][] {
  return [...page.querySelectorAll('.article-cta-row')].map((row) =>
    [...row.querySelectorAll('a.article-cta')].map((a) => [a.textContent, a.getAttribute('href')]),
  );
}

describe('Three Kingdoms Banqi rules page buttons', () => {
  it('offers no bot in either row while the variant has none', () => {
    vi.stubEnv('VITE_THREE_KINGDOMS_BANQI_ENABLED', 'true');
    const friendOnly = [
      ['Play Three Kingdoms Banqi', '/?play=friend&gameSpecId=three-kingdoms-banqi'],
    ];
    expect(playButtons(buildArticlePage('three-kingdoms-banqi'))).toEqual([friendOnly, friendOnly]);
  });

  it('offers the bot in both rows once the engine flag is on', () => {
    vi.stubEnv('VITE_THREE_KINGDOMS_BANQI_ENABLED', 'true');
    vi.stubEnv('VITE_THREE_KINGDOMS_BANQI_ENGINE', 'true');
    const both = [
      ['Play Three Kingdoms Banqi', '/?play=computer&gameSpecId=three-kingdoms-banqi'],
      ['Play a friend', '/?play=friend&gameSpecId=three-kingdoms-banqi'],
    ];
    expect(playButtons(buildArticlePage('three-kingdoms-banqi'))).toEqual([both, both]);
  });
});
