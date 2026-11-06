import {
  CHAMPIONS,
  sanctionedWorldChampions,
  WORLD_CHAMPIONS,
  WORLD_EDITIONS,
  worldTitleCount,
} from '@mistboard/board-render';
import { describe, expect, it } from 'vitest';
import { articleProse } from '../article-prose.js';
import { articles } from '../articles-data.js';
import { xiangqiWorldChampionshipArticle as article } from './content/xiangqi-world-championship.js';

// Every count in this article is checked against the record it describes, the
// way the champions article's claims are. That test found six false statements
// in prose that read perfectly well, which is the argument for this one: a
// number in a sentence is not checked by anyone, including the person who wrote
// it, and this article's first draft already carried one. It enumerated the
// sanctioned world champions as "three banned for life, one convicted, and the
// 2023 winner drew six months", which is five men. There are six; Jiang Chuan's
// five-year ban had been dropped.
const prose = articleProse(article)
  .map((entry) => entry.text)
  .join('\n');

describe('the world championship article states the record correctly', () => {
  it('counts the editions and the winners', () => {
    expect(WORLD_EDITIONS.length).toBe(19);
    expect(WORLD_CHAMPIONS.length).toBe(11);
    expect(prose).toContain('Nineteen editions, eleven winners');
  });

  it('gives every title to exactly one winner', () => {
    const claimed = WORLD_CHAMPIONS.flatMap((c) => c.years);
    expect(new Set(claimed).size, 'an edition is claimed twice').toBe(claimed.length);
    expect([...claimed].sort((a, b) => a - b)).toEqual([...WORLD_EDITIONS]);
  });

  it('has the three who owned it right', () => {
    expect(worldTitleCount('Lü Qin')).toBe(5);
    expect(worldTitleCount('Xu Yinchuan')).toBe(3);
    expect(worldTitleCount('Wang Tianyi')).toBe(3);
    const three =
      worldTitleCount('Lü Qin') + worldTitleCount('Xu Yinchuan') + worldTitleCount('Wang Tianyi');
    expect(three, 'the "eleven of nineteen" claim').toBe(11);
    expect(prose).toContain('eleven of the nineteen editions');
  });

  it('never states a national title year the champion did not win', () => {
    // The check that was missing. A section said Jiang Chuan was national
    // champion "in 2006 and 2013"; he won in 2010, and nothing objected,
    // because every existing assertion compared the article against the WORLD
    // record while this claim was about the national one.
    //
    // Scoped to the sentence that makes the claim, so a year mentioned for any
    // other reason (a game date, another man's title) is not swept in.
    const wrong: string[] = [];
    for (const section of article.sections) {
      const champion = CHAMPIONS.find((c) => section.heading?.includes(c.zh));
      if (!champion) continue;
      const text = (section.blocks ?? [])
        .map((b) => (b as { text?: string }).text ?? '')
        .join(' ');
      for (const sentence of text.split(/(?<=[.])\s+/)) {
        if (!/national (title|champion)/i.test(sentence)) continue;
        // A sentence about a national title routinely names world-title years
        // too ("World champion in 1991 and four times national champion"), so
        // the bar is that a year must belong to ONE of his two records. Jiang
        // Chuan's "2006 and 2013" belonged to neither: he won the national in
        // 2010 and the world in 2011.
        const his = new Set([
          ...champion.years,
          ...(WORLD_CHAMPIONS.find((w) => w.name === champion.name)?.years ?? []),
        ]);
        for (const year of sentence.match(/\b(19|20)\d{2}\b/g) ?? []) {
          if (!his.has(Number(year))) {
            wrong.push(
              `${champion.name}: "${sentence.trim().slice(0, 88)}" names ${year}, ` +
                `but his titles are national ${champion.years.join(', ')} / world ` +
                  `${WORLD_CHAMPIONS.find((w) => w.name === champion.name)?.years.join(', ') ?? 'none'}`,
            );
          }
        }
      }
    }
    expect(wrong, `national title years that are not his:\n${wrong.join('\n')}`).toEqual([]);
  });

  it('is right that Hu Ronghua never won it', () => {
    // The comparison the section turns on, and the easiest thing to get wrong,
    // because he is the dominant name in the sibling article.
    expect(WORLD_CHAMPIONS.some((c) => c.name === 'Hu Ronghua')).toBe(false);
    expect(CHAMPIONS.find((c) => c.name === 'Hu Ronghua')?.years.length).toBeGreaterThan(5);
    expect(worldTitleCount('Lü Qin')).toBe(CHAMPIONS.find((c) => c.name === 'Lü Qin')?.years.length);
  });

  it('counts the overlap with the national title', () => {
    const national = new Set(CHAMPIONS.map((c) => c.name));
    const both = WORLD_CHAMPIONS.filter((c) => national.has(c.name));
    const neither = WORLD_CHAMPIONS.filter((c) => !national.has(c.name));
    expect(both.length).toBe(9);
    expect(neither.map((c) => c.name).sort()).toEqual(['Lại Lý Huynh', 'Meng Chen']);
    expect(prose).toContain('Nine of the eleven world champions');
  });

  it('enumerates the sanctioned winners without dropping one', () => {
    const sanctioned = sanctionedWorldChampions();
    expect(sanctioned.length, 'six men carry a ruling').toBe(6);
    const life = sanctioned.filter((c) => /banned for life/.test(c.sanction ?? '')).length;
    expect(life).toBe(3);
    expect(sanctioned.filter((c) => /convicted/.test(c.sanction ?? '')).length).toBe(1);
    expect(sanctioned.filter((c) => /five-year/.test(c.sanction ?? '')).length).toBe(1);
    expect(sanctioned.filter((c) => /six-month/.test(c.sanction ?? '')).length).toBe(1);
    expect(prose).toContain('eight championships and six men');
    expect(prose).toContain('three banned for life, one convicted in court, one given five years');
  });

  it('is right that every edition from 2009 to 2023 has a ruling on it', () => {
    const window = WORLD_EDITIONS.filter((y) => y >= 2009 && y <= 2023);
    expect(window.length, 'eight championships').toBe(8);
    const sanctioned = sanctionedWorldChampions();
    const uncovered = window.filter((y) => !sanctioned.some((c) => c.years.includes(y)));
    expect(uncovered, `editions in that window with a clean winner: ${uncovered}`).toEqual([]);
  });

  it('does not say those men are still serving bans', () => {
    // A six-month ban handed down in 2025 is not being served in 2026. The first
    // draft said "is serving a ban" of all six, which was true of most and not
    // of the man it named last.
    expect(prose).not.toContain('is serving a ban');
    expect(prose).toContain('published ruling against him');
  });

  it('only claims "longest" if it is longest across BOTH articles', () => {
    // The 2025 board carried "the longest game in either of these two articles"
    // and was, until a 274-ply game joined the page. A cross-article superlative
    // is a claim about a file this one does not import, so it has to be checked
    // against that file rather than against this one.
    const pliesIn = (slug: string) =>
      (articles.find((a) => a.slug === slug)?.sections ?? [])
        .flatMap((s) => s.blocks ?? [])
        .filter((b) => b?.kind === 'xq-replay')
        .map((b) => (b as unknown as { spec: { iccs: string } }).spec.iccs.trim().split(/\s+/).length);

    const here = pliesIn('xiangqi-world-championship');
    const sibling = pliesIn('xiangqi-champions');
    expect(here.length, 'no boards to compare').toBeGreaterThan(0);
    expect(sibling.length, 'the sibling article has no boards').toBeGreaterThan(0);

    if (!/longest game in either/.test(prose)) return;
    expect(
      Math.max(...here),
      'this article claims the longest game in either article',
    ).toBeGreaterThan(Math.max(...sibling));
  });

  it('is right about the national list it points at', () => {
    // The cross-reference states a number from the OTHER article's data, which
    // is the easiest kind of claim to leave behind when that data changes.
    const since2005 = CHAMPIONS.filter((c) =>
      [...c.years, ...(c.shared ?? [])].some((y) => y >= 2005),
    );
    expect(since2005.length).toBe(13);
    expect(since2005.filter((c) => c.sanction).length).toBe(10);
    expect(prose).toContain('ten of the thirteen men who have won since 2005');
  });

  it('dates the title leaving China correctly', () => {
    const span = (WORLD_EDITIONS.at(-1) ?? 0) - (WORLD_EDITIONS[0] ?? 0);
    expect(span, 'thirty-five years of the event').toBe(35);
    expect(prose).toContain('thirty-five years the event has existed');
    const huynh = WORLD_CHAMPIONS.find((c) => c.name === 'Lại Lý Huynh');
    expect(huynh?.years).toEqual([2025]);
  });
});
