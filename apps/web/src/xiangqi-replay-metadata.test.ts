import { afterEach, describe, expect, it } from 'vitest';
import { ensureLocaleCatalog } from './i18n/catalog.js';
import { mountXiangqiReplay, type XiangqiReplaySpec } from './xiangqi-replay.js';

const base: XiangqiReplaySpec = {
  iccs: 'h2e2 h9g7',
  red: 'Red',
  black: 'Black',
  event: 'Verified event',
  resultText: '*',
  annotations: { byPly: {} },
};
afterEach(() => document.body.replaceChildren());
function mount(metadata?: unknown, lang?: 'zh-Hans' | 'zh-Hant') {
  const host = document.createElement('div');
  document.body.append(host);
  const controller = mountXiangqiReplay(
    host,
    { ...base, ...(metadata ? { metadata } : {}) } as XiangqiReplaySpec,
    { lang },
  );
  return { host, controller };
}
describe('recorded replay metadata header', () => {
  it('separates event and labelled metadata from board while escaping source text', () => {
    const { host, controller } = mount({
      date: '2026-09-17 13:00',
      round: 'Round 7 <img src=x>',
      timeControl: '40分＋20秒',
      source: { label: 'DPXQ', url: 'http://www.dpxq.com/hldcg/search/view_m_143947.html' },
    });
    const header = host.querySelector('.xq-replay-header')!;
    expect(header.querySelector('.xq-replay-header-event')?.textContent).toBe('Verified event');
    expect(header.querySelector('dl')?.textContent).toContain('Round 7 <img src=x>');
    expect(header.querySelector('img')).toBeNull();
    expect(header.textContent).toContain('40 min + 20 sec');
    expect(header.querySelector('.xq-replay-clock')?.textContent).toBe(
      'Time control: 40 min + 20 sec',
    );
    const details = header.querySelector('details');
    expect(details?.open).toBe(false);
    expect(details?.querySelector('summary')?.textContent).toBe('Game details');
    expect(details?.querySelector('dl')).not.toBeNull();
    expect(header.querySelector('a')?.getAttribute('href')).toBe(
      'http://www.dpxq.com/hldcg/search/view_m_143947.html',
    );
    expect(header.nextElementSibling?.classList.contains('xq-replay-grid')).toBe(true);
    controller.destroy();
  });
  it('does not guess missing values or allow arbitrary source URLs; legacy specs remain valid', () => {
    const { host, controller } = mount({
      source: {
        label: 'DPXQ',
        url: 'https://www.dpxq.com.evil.test/hldcg/search/view_m_143947.html',
      },
    });
    expect(host.querySelectorAll('.xq-replay-metadata dd')).toHaveLength(4);
    expect(
      [...host.querySelectorAll('.xq-replay-metadata dd')].every(
        (d) => d.textContent === 'Not recorded',
      ),
    ).toBe(true);
    expect(host.querySelector('.xq-replay-header a')).toBeNull();
    controller.destroy();
    const legacy = mount();
    expect(legacy.host.querySelector('dl')).toBeNull();
    expect(legacy.host.querySelector('.xq-replay-header')?.textContent).toBe('Verified event');
    legacy.controller.destroy();
  });
  it.each([
    ['zh-Hans', '日期', '轮次', '用时', '未记录'],
    ['zh-Hant', '日期', '輪次', '用時', '未記錄'],
  ] as const)('localizes the %s header', async (lang, date, round, time, missing) => {
    await ensureLocaleCatalog(lang);
    const { host, controller } = mount({}, lang);
    const text = host.querySelector('.xq-replay-header')?.textContent;
    for (const word of [date, round, time, missing]) expect(text).toContain(word);
    controller.destroy();
  });
});
