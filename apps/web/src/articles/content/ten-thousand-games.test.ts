import { describe, expect, it } from 'vitest';
import {
  botRows,
  botsWithoutARow,
  buildTenThousandGamesArticle,
  firstLastingThousandWeek,
  fullWeeks,
  type TenThousandGamesRecord,
  unnamedVariants,
} from './ten-thousand-games.js';
import record from './ten-thousand-games-record.json' with { type: 'json' };

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
  const endings = ['resignation', 'checkmate', 'timeout', 'stalemate'].map(
    (name) => r.endings.find((e) => e.ending === name)?.games ?? 0,
  );
  const stalematePlies = r.endings.find((e) => e.ending === 'stalemate')?.averagePlies ?? 0;
  const group = (rows: { games: number; peopleWon: number }[]) => ({
    games: rows.reduce((sum, b) => sum + b.games, 0),
    peopleWon: rows.reduce((sum, b) => sum + b.peopleWon, 0),
  });
  const named = [
    r.bots.filter((b) => b.variant === 'jieqi' && b.bot.startsWith('pikafish')),
    r.bots.filter((b) => b.variant === 'xiangqi' && b.bot === 'pikafish'),
    r.bots.filter((b) => b.bot.startsWith('fairy-stockfish')),
    r.bots.filter((b) => b.bot.startsWith('rapfi')),
    ...['misty', 'ab-jchess', 'jqe', 'katago', 'general-blunder'].map((id) =>
      r.bots.filter((b) => b.bot === id),
    ),
  ].map(group);
  const inRows = group(named);
  const earlier = {
    games: r.gamesAgainstBots - inRows.games,
    peopleWon: r.gamesWonAgainstBots - inRows.peopleWon,
  };
  const bots = [...named, earlier];
  const ends = r.bots.filter(
    (b) => b.variant === 'jieqi' && (b.bot === 'pikafish-level-1' || b.bot === 'pikafish'),
  );
  const blunder = r.bots.filter((b) => b.bot === 'general-blunder');
  const numbers = [
    milestone, nextGames, days, r.players, r.playersWithOneGame, r.playersWithTenGames,
    r.playersWithHundredGames, r.mostGamesByOnePlayer, r.gamesAgainstBots, r.gamesWonAgainstBots,
    r.gamesBetweenPeople, r.countriesAndRegions, r.gamesSeenFromBothSides, r.gamesAcrossBorders,
    ...endings, Math.round(stalematePlies / 2),
    ...bots.map((b) => b.games), ...blunder.flatMap((b) => [b.games, b.peopleWon]),
    r.atOneThousand.gamesBetweenPeople, r.peakWeek.games, r.peakWeek.gamesByItsBusiestPlayer,
    ...r.variants.map((v) => v.games),
  ].map((n) => n.toLocaleString('en-US'));
  return {
    numbers: new Set([
      ...numbers,
      pct(jieqi, r.totalGames),
      pct(r.atOneThousand.jieqiGames, 1_000),
      pct(r.gamesWithThosePlayers, r.totalGames),
      ...[...bots, ...ends].map((b) => pct(b.peopleWon, b.games)),
      // Terms of the post, not measurements.
      '1,000', '100',
    ]),
    dates: new Set([
      longDate(reached),
      longDate(r.peakWeek.weekStart),
      longDate(firstLastingThousandWeek(r).weekStart),
      // Where counting started: a fact of the method, not a measurement.
      'June 1',
    ]),
  };
}

function numbersOutsideRecord(text: string, r: TenThousandGamesRecord): string[] {
  const { numbers, dates } = allowed(r);
  const out: string[] = [];
  const withoutDates = text
    .replace(new RegExp(`${MONTH} \\d{1,2}`, 'g'), (date) => {
      if (!dates.has(date)) out.push(date);
      return '';
    })
    // A bot's levels are part of its name, not a measurement.
    .replace(/[Ll]evels?\s\d(-\u2060?\d)?/g, '')
    // So is a feature's name.
    .replace(/\b3D\b/g, '');
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
  const peak = fullWeeks(r).reduce((best, w) => (w.games > best.games ? w : best));
  if (peak.weekStart !== r.peakWeek.weekStart || peak.games !== r.peakWeek.games) {
    out.push('peak week is not the largest full week');
  }
  if (r.tenThousandOn !== null && r.totalGames < 10_000) out.push('crossing dated below 10,000');
  if (r.gamesWonAgainstBots >= r.gamesAgainstBots) out.push('more wins than games against bots');
  if (r.gamesSeenFromBothSides > r.gamesBetweenPeople) out.push('more games seen than played');
  if (r.gamesAcrossBorders > r.gamesSeenFromBothSides) out.push('more border games than seen');
  if (sum(r.bots.map((b) => b.games)) > r.gamesAgainstBots) out.push('more bot games than played');
  if (sum(r.endings.map((e) => e.games)) !== r.totalGames) out.push('endings do not sum to the total');
  if (botsWithoutARow(r).length > 0) out.push('a bot has no row in the table');
  // The table leaves out the few June games against pre-account engines, so
  // it may fall short of the prose totals by at most 1% and never exceed them.
  const table = botRows(r);
  const tableGames = sum(table.map((row) => row.games));
  if (tableGames > r.gamesAgainstBots || tableGames < r.gamesAgainstBots * 0.99) {
    out.push('the bot table does not match the bot games');
  }
  if (sum(table.map((row) => row.peopleWon)) > r.gamesWonAgainstBots) {
    out.push('the bot table has more wins than the prose');
  }
  const end = (name: string) => r.endings.find((e) => e.ending === name);
  const four = ['resignation', 'checkmate', 'timeout', 'stalemate'].map(end);
  if (four.some((e) => !e)) out.push('an ending the prose names is missing');
  // The prose orders these four and calls no legal move a loss and the longest.
  const games = four.map((e) => e?.games ?? 0);
  if (games.some((g, i) => i > 0 && g > games[i - 1])) out.push('the endings are out of order');
  if (four.some((e) => (e?.averagePlies ?? 0) > (end('stalemate')?.averagePlies ?? 0))) {
    out.push('stalemate is not the longest of the four');
  }
  if ((end('stalemate')?.draws ?? 0) > 0) out.push('a game with no legal move was drawn');
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
    expect(recordProblems({ ...record, totalGames: 9_999, tenThousandOn: '2026-11-08' })).toContain(
      'crossing dated below 10,000',
    );
    expect(
      recordProblems({ ...record, gamesWonAgainstBots: record.gamesAgainstBots }),
    ).toContain('more wins than games against bots');
  });

  it('catches claims about bots, endings and borders that stop being true', () => {
    const newBot = {
      ...record,
      bots: [...record.bots, { bot: 'new-bot', variant: 'xiangqi', games: 1, peopleWon: 0 }],
    };
    expect(recordProblems(newBot)).toContain('a bot has no row in the table');
    const tooMany = {
      ...record,
      bots: record.bots.map((b) => (b.bot === 'jqe' ? { ...b, games: b.games + 100 } : b)),
    };
    expect(recordProblems(tooMany)).toContain('the bot table does not match the bot games');
    const endings = record.endings.map((e) =>
      e.ending === 'stalemate' ? { ...e, draws: 1 } : e,
    );
    expect(recordProblems({ ...record, endings })).toContain('a game with no legal move was drawn');
    const shorter = record.endings.map((e) =>
      e.ending === 'stalemate' ? { ...e, averagePlies: 1 } : e,
    );
    expect(recordProblems({ ...record, endings: shorter })).toContain(
      'stalemate is not the longest of the four',
    );
    expect(
      recordProblems({ ...record, gamesAcrossBorders: record.gamesSeenFromBothSides + 1 }),
    ).toContain('more border games than seen');
  });

  it('changes the ending when a game crosses a border', () => {
    const crossed = readerText(buildTenThousandGamesArticle({ ...record, gamesAcrossBorders: 3 }));
    expect(crossed).toContain(`3 of the ${record.gamesSeenFromBothSides} games`);
    expect(crossed).not.toContain('same country or region');
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
    expect(unnamedVariants(record)).toEqual([]);
  });

  it('notices a variant the table has no row for', () => {
    const variants = [...record.variants, { variant: 'dark-shogi', games: 1 }];
    expect(unnamedVariants({ ...record, variants })).toContain('dark-shogi');
  });

  it('names no retired variant by an internal id', () => {
    expect(readerText(article)).not.toMatch(/dark-|jungle-flip/);
  });
});
