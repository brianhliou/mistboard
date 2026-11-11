// The World Xiangqi Championship record, held once and rendered twice: as the
// timeline figure and as the table beneath it, exactly as the national record
// is. Both read from WORLD_CHAMPIONS below.
//
// It shares the national championship's renderer rather than copying it. The two
// charts say the same kind of thing about two different competitions, and a
// second implementation is how they start disagreeing about what a bar means.

import {
  type ChampionRecord,
  type ChampionTimelineOptions,
  championTableRows,
  xiangqiChampionTimelineSvg,
} from './xiangqi-champion-timeline.js';

/**
 * Every edition of the men's standard event, held roughly every two years since
 * 1990 by the World Xiangqi Federation.
 *
 * The rhythm is biennial-odd until 2019, then 2022 (the pandemic pushed 2021),
 * then 2023 and 2025 back on odd years.
 */
export const WORLD_EDITIONS: readonly number[] = [
  1990, 1991, 1993, 1995, 1997, 1999, 2001, 2003, 2005, 2007, 2009, 2011, 2013, 2015, 2017, 2019,
  2022, 2023, 2025,
];

/** The one interruption, so the chart hatches it the way the national one does. */
export const WORLD_EDITION_GAPS: ReadonlyArray<{
  from: number;
  to: number;
  label?: string;
  reason: string;
}> = [{ from: 2021, to: 2021, label: 'pandemic', reason: 'the pandemic' }];

/** Ordered by first title, matching the order of the article's sections. */
export const WORLD_CHAMPIONS: readonly ChampionRecord[] = [
  { name: 'Lü Qin', zh: '吕钦', years: [1990, 1995, 1997, 2001, 2005] },
  { name: 'Zhao Guorong', zh: '赵国荣', years: [1991] },
  { name: 'Xu Tianhong', zh: '徐天红', years: [1993] },
  { name: 'Xu Yinchuan', zh: '许银川', years: [1999, 2003, 2007] },
  {
    name: 'Zhao Xinxin',
    zh: '赵鑫鑫',
    years: [2009],
    sanction: 'banned for life, 2025',
  },
  { name: 'Jiang Chuan', zh: '蒋川', years: [2011], sanction: 'five-year ban, 2026' },
  { name: 'Wang Tianyi', zh: '王天一', years: [2013, 2017, 2022], sanction: 'convicted, banned' },
  { name: 'Zheng Weitong', zh: '郑惟桐', years: [2015], sanction: 'banned for life, 2025' },
  { name: 'Xu Chao', zh: '徐超', years: [2019], sanction: 'banned for life, 2026' },
  { name: 'Meng Chen', zh: '孟辰', years: [2023], sanction: 'six-month ban, 2025' },
  {
    name: 'Lại Lý Huynh',
    // His name is Vietnamese and written in Latin script; 赖理兄 is the
    // Chinese-language rendering the federation and the Chinese press use.
    zh: '赖理兄',
    years: [2025],
  },
];

/** Editions each player won, for prose that must not disagree with the chart. */
export function worldTitleCount(name: string): number {
  return WORLD_CHAMPIONS.find((c) => c.name === name)?.years.length ?? 0;
}

/** Winners carrying a published ruling, which is the article's second subject. */
export function sanctionedWorldChampions(): readonly ChampionRecord[] {
  return WORLD_CHAMPIONS.filter((c) => c.sanction);
}

export function worldChampionTableRows(): string[][] {
  return championTableRows(WORLD_CHAMPIONS, WORLD_EDITIONS);
}

export function xiangqiWorldTitleTimelineSvg(
  options: Omit<ChampionTimelineOptions, 'records' | 'editions' | 'gaps'> = {},
): string {
  return xiangqiChampionTimelineSvg({
    ...options,
    records: WORLD_CHAMPIONS,
    editions: WORLD_EDITIONS,
    gaps: WORLD_EDITION_GAPS,
  });
}
