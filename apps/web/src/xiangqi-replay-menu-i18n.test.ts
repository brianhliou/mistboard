import { beforeEach, describe, expect, it } from 'vitest';
import type { ArticleLang } from './article-i18n.js';
import { mountXiangqiReplay, type XiangqiReplaySpec } from './xiangqi-replay.js';

// The article board's ⋮ menu speaks the article's language, like the rest of
// the board (move list, verdicts, the analysis link). Its three items were
// English on every page, Chinese articles included.

const spec: XiangqiReplaySpec = {
  iccs: 'h2e2 h9g7',
  red: 'Red',
  black: 'Black',
  event: 'Menu',
  resultText: '*',
  annotations: { byPly: {} },
};

let host: HTMLElement;
beforeEach(() => {
  document.body.replaceChildren();
  host = document.createElement('div');
  document.body.append(host);
});

function menuOf(lang?: ArticleLang): { items: string[]; more: string | null } {
  const controller = mountXiangqiReplay(host, spec, { lang });
  const items = [...host.querySelectorAll('.xq-replay-menu-item')].map(
    (el) => el.textContent ?? '',
  );
  const more = host.querySelector('.stepper-button-menu')?.getAttribute('aria-label') ?? null;
  controller.destroy();
  return { items, more };
}

describe('article board menu language', () => {
  it('is English on an English page', () => {
    expect(menuOf()).toEqual({
      items: ['Flip the board', 'Back to the start', 'Jump to the end'],
      more: 'More',
    });
  });

  it('is Simplified Chinese on a zh-hans page, in the site terms', () => {
    expect(menuOf('zh-Hans')).toEqual({
      items: ['翻转棋盘', '回到开始', '跳到最后一步'],
      more: '更多',
    });
  });

  it('is Traditional Chinese on a zh-hant page, in the site terms', () => {
    expect(menuOf('zh-Hant')).toEqual({
      items: ['翻轉棋盤', '回到開始', '跳到最後一步'],
      more: '更多',
    });
  });

  it('still flips, rewinds and jumps from the translated items', () => {
    mountXiangqiReplay(host, spec, { lang: 'zh-Hans' });
    const item = (label: string) =>
      [...host.querySelectorAll<HTMLButtonElement>('.xq-replay-menu-item')].find(
        (el) => el.textContent === label,
      )!;
    item('跳到最后一步').click();
    expect(host.querySelector<HTMLButtonElement>('.stepper-button-next')?.disabled).toBe(true);
    item('回到开始').click();
    expect(host.querySelector<HTMLButtonElement>('.stepper-button-prev')?.disabled).toBe(true);
    const topSeat = () => host.querySelector('.xq-replay-board-col')?.firstElementChild?.className;
    const before = topSeat();
    item('翻转棋盘').click();
    expect(topSeat()).not.toBe(before);
  });
});
