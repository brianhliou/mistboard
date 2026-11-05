import { describe, expect, it } from 'vitest';
import {
  buildTenThousandGamesArticle,
  FEATURED_GAME,
  firstLastingThousandWeek,
  fullWeeks,
  type TenThousandGamesRecord,
} from './ten-thousand-games.js';
import record from './ten-thousand-games-record.json' with { type: 'json' };

const EARLIER = new Set(['dark-crazyhouse', 'dark-mini-xiangqi']);
const MONTH = '(?:January|February|March|April|May|June|July|August|September|October|November|December)';

// What a reader sees, without link targets, image paths and the chart's markup.
function readerText(article: ReturnType<typeof buildTenThousandGamesArticle>): string {
  const blocks = [...(article.intro ?? []), ...(article.sections ?? []).flatMap((s) => s.blocks ?? [])];
  const prose = blocks.map((b) => {
    if (b.kind === 'paragraph') return b.text;
    if (b.kind === 'table') return b.rows.flat().join(' ');
    return '';
  });
  return [...(article.tldr ?? []), ...prose].join('\n').replace(/\]\([^)]*\)/g, ']');
}

const longDate = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });

// The numbers and dates the record can produce, worked out here and not through
// the article's own helpers, so a mistake in those helpers does not hide itself.
function allowed(r: TenThousandGamesRecord) {
  const pct = (a: number, b: number) => `${Math.round((a / b) * 100)}%`;
  const jieqi = r.variants.find((v) => v.variant === 'jieqi')?.games ?? 0;
  const reached = r.tenThousandOn ?? r.capturedAt.slice(0, 10);
  const days = Math.round((Date.parse(reached) - Date.parse(r.firstThousandOn)) / 86_400_000);
  const milestone = r.tenThousandOn ? 10_000 : r.totalGames;
  const nextGames = r.tenThousandOn ? 9_000 : r.totalGames - 1_000;
  const numbers = [
    milestone, nextGames, days, r.players, r.playersWithOneGame, r.playersWithTenGames,
    r.playersWithHundredGames, r.mostGamesByOnePlayer, r.gamesAgainstBots, r.gamesWonAgainstBots,
    r.gamesBetweenPeople, r.countriesAndRegions,
    r.longestGameBetweenPeople.moves, r.longestGameBetweenPeople.minutes,
    r.atOneThousand.gamesBetweenPeople, r.peakWeek.games, r.peakWeek.gamesByItsBusiestPlayer,
    ...r.variants.map((v) => v.games),
    r.variants
      .filter((v) => EARLIER.has(v.variant))
      .reduce((sum, v) => sum + v.games, 0),
  ].map((n) => n.toLocaleString('en-US'));
  return {
    numbers: new Set([
      ...numbers,
      pct(jieqi, r.totalGames),
      pct(r.atOneThousand.jieqiGames, 1_000),
      pct(r.gamesWithThosePlayers, r.totalGames),
      // Terms of the post, not measurements.
      '1,000', '100',
    ]),
    dates: new Set([
      longDate(reached),
      longDate(r.peakWeek.weekStart),
      longDate(r.longestGameBetweenPeople.day),
      longDate(firstLastingThousandWeek(r).weekStart),
      // Where counting started: a fact of the method, not a measurement.
      'June 1',
    ]),
  };
}

function numbersOutsideRecord(text: string, r: TenThousandGamesRecord): string[] {
  const { numbers, dates } = allowed(r);
  const out: string[] = [];
  const withoutDates = text.replace(new RegExp(`${MONTH} \\d{1,2}`, 'g'), (date) => {
    if (!dates.has(date)) out.push(date);
    return '';
  });
  for (const [token] of withoutDates.matchAll(/\d[\d,]*%?/g)) {
    const clean = token.replace(/,$/, '');
    if (!numbers.has(clean)) out.push(clean);
  }
  return out;
}

function recordProblems(r: TenThousandGamesRecord): string[] {
  const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);
  const out: string[] = [];
  if (sum(r.weeks.map((w) => w.games)) !== r.totalGames) out.push('weeks do not sum to the total');
  if (sum(r.variants.map((v) => v.games)) !== r.totalGames) out.push('variants do not sum to the total');
  if (r.gamesAgainstBots + r.gamesBetweenPeople !== r.totalGames) out.push('modes do not sum to the total');
  if (r.longestGameBetweenPeople.roomId !== FEATURED_GAME) out.push('the featured game is no longer the longest');
  if (r.longestGameBetweenPeople.termination !== 'repetition') out.push('the featured game did not end by repetition');
  const peak = fullWeeks(r).reduce((best, w) => (w.games > best.games ? w : best));
  if (peak.weekStart !== r.peakWeek.weekStart || peak.games !== r.peakWeek.games) {
    out.push('peak week is not the largest full week');
  }
  if (r.tenThousandOn !== null && r.totalGames < 10_000) out.push('crossing dated below 10,000');
  if (r.gamesWonAgainstBots >= r.gamesAgainstBots) out.push('more wins than games against bots');
  return out;
}

const article = buildTenThousandGamesArticle(record);

describe('the 10,000 games post holds to its record', () => {
  it('prints no number the record cannot produce', () => {
    expect(numbersOutsideRecord(readerText(article), record)).toEqual([]);
  });

  it('catches a hand-typed number and a wrong date', () => {
    const typed = readerText(article).replace(
      record.peakWeek.games.toLocaleString('en-US'),
      '2,746',
    );
    expect(numbersOutsideRecord(typed, record)).toContain('2,746');
    expect(numbersOutsideRecord('On October 3 we played.', record)).toContain('October 3');
  });

  it('catches prose left over from an older record', () => {
    const moved = { ...record, players: record.players + 1 };
    expect(numbersOutsideRecord(readerText(article), moved)).toContain(
      record.players.toLocaleString('en-US'),
    );
  });

  it('has a record that adds up', () => {
    expect(recordProblems(record)).toEqual([]);
  });

  it('catches a record that does not add up', () => {
    expect(recordProblems({ ...record, totalGames: record.totalGames + 1 })).toContain(
      'weeks do not sum to the total',
    );
    const lowPeak = { ...record, peakWeek: { ...record.peakWeek, games: 1 } };
    expect(recordProblems(lowPeak)).toContain('peak week is not the largest full week');
    expect(recordProblems({ ...record, tenThousandOn: '2026-11-08' })).toContain(
      'crossing dated below 10,000',
    );
    expect(
      recordProblems({
        ...record,
        longestGameBetweenPeople: { ...record.longestGameBetweenPeople, roomId: 'jq_other' },
      }),
    ).toContain('the featured game is no longer the longest');
    expect(
      recordProblems({
        ...record,
        longestGameBetweenPeople: { ...record.longestGameBetweenPeople, termination: 'agreement' },
      }),
    ).toContain('the featured game did not end by repetition');
    expect(
      recordProblems({ ...record, gamesWonAgainstBots: record.gamesAgainstBots }),
    ).toContain('more wins than games against bots');
  });

  it('keeps the claim that every later week passed 1,000 true', () => {
    const later = fullWeeks(record).filter(
      (w) => w.weekStart >= firstLastingThousandWeek(record).weekStart,
    );
    expect(later.length).toBeGreaterThan(0);
    expect(later.every((w) => w.games >= 1_000)).toBe(true);
  });

  it('publishes only once the record has crossed 10,000', () => {
    if (article.status !== 'published') return;
    expect(record.tenThousandOn).not.toBeNull();
    expect(record.totalGames).toBeGreaterThanOrEqual(10_000);
  });

  it('names no retired variant by an internal id', () => {
    expect(readerText(article)).not.toMatch(/dark-|jungle-flip/);
  });
});
