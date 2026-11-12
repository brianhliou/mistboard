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
  it('puts round, date, time control and source on one line, escaped, with nothing to unfold', () => {
    const { host, controller } = mount({
      date: '2026-09-17 13:00',
      round: '第07轮',
      timeControl: '40分＋20秒',
      source: {
        label: 'DPXQ',
        url: 'http://www.dpxq.com/hldcg/search/view_m_143947.html',
      },
    });
    const header = host.querySelector('.xq-replay-header')!;
    expect(header.querySelector('.xq-replay-header-event')?.textContent).toBe('Verified event');
    expect(header.querySelector('.xq-replay-metadata')?.textContent).toBe(
      'Round 7 · 17 September 2026 · 40 min + 20 sec · DPXQ',
    );
    expect(header.querySelector('img')).toBeNull();
    expect(header.querySelector('details')).toBeNull();
    expect(header.querySelector('a')?.getAttribute('href')).toBe(
      'http://www.dpxq.com/hldcg/search/view_m_143947.html',
    );
    expect(header.nextElementSibling?.classList.contains('xq-replay-grid')).toBe(true);
    controller.destroy();
  });
  it('leaves out what the record lacks, refuses foreign source URLs, keeps legacy specs', () => {
    const { host, controller } = mount({
      round: 'Final <img src=x>',
      source: {
        label: 'DPXQ',
        url: 'https://www.dpxq.com.evil.test/hldcg/search/view_m_143947.html',
      },
    });
    expect(host.querySelector('.xq-replay-metadata')?.textContent).toBe('Round Final <img src=x>');
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('.xq-replay-header a')).toBeNull();
    expect(host.textContent).not.toContain('Not recorded');
    controller.destroy();
    const legacy = mount();
    expect(legacy.host.querySelector('.xq-replay-metadata')).toBeNull();
    expect(legacy.host.querySelector('.xq-replay-header')?.textContent).toBe('Verified event');
    legacy.controller.destroy();
  });
  it.each([
    ['zh-Hans', '第7轮', '40分＋20秒'],
    ['zh-Hant', '第7輪', '40分＋20秒'],
  ] as const)('localizes the %s line', async (lang, round, time) => {
    await ensureLocaleCatalog(lang);
    const { host, controller } = mount(
      { date: '2026-09-17', round: '第07轮', timeControl: '40分＋20秒' },
      lang,
    );
    const text = host.querySelector('.xq-replay-metadata')?.textContent ?? '';
    for (const word of [round, time, '2026']) expect(text).toContain(word);
    controller.destroy();
  });
});
