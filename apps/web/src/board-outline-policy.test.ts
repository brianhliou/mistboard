import { describe, expect, it } from 'vitest';
import { BANQI_LUCK_GAME } from './articles/content/banqi-luck-game.js';
import { type Article, type ArticleBlock, articles } from './articles-data.js';
import { mountBanqiReplay } from './banqi-replay.js';
import type { Locale } from './i18n/locale.js';
import { mountJieqiReplay } from './jieqi-replay.js';
import { JIEQI_SAMPLE_GAME } from './jieqi-sample-game.js';

type SvgSample = { label: string; svg: string };

function renderSvg(svg: string | ((locale: Locale) => string), locale: Locale = 'en'): string {
  return typeof svg === 'function' ? svg(locale) : svg;
}

function articleBlocks(article: Article): ArticleBlock[] {
  return [...(article.intro ?? []), ...article.sections.flatMap((section) => section.blocks ?? [])];
}

function articleSvgSamples(article: Article): SvgSample[] {
  const samples: SvgSample[] = [];
  if (article.thumbnail?.kind === 'svg') {
    samples.push({ label: `${article.slug}:thumbnail`, svg: renderSvg(article.thumbnail.svg) });
  }
  for (const [index, block] of articleBlocks(article).entries()) {
    if (block.kind === 'raw-svg') {
      samples.push({ label: `${article.slug}:raw-svg:${index}`, svg: renderSvg(block.svg) });
    } else if (block.kind === 'animated-svg') {
      for (const [frame, svg] of [block.svg, block.reducedSvg].entries()) {
        samples.push({
          label: `${article.slug}:animated-svg:${index}:${frame}`,
          svg: renderSvg(svg),
        });
      }
    } else if (block.kind === 'svg-row') {
      for (const [item, entry] of block.items.entries()) {
        samples.push({
          label: `${article.slug}:svg-row:${index}:${item}`,
          svg: renderSvg(entry.svg),
        });
      }
    } else if (block.kind === 'raw-svg-stepper') {
      for (const [step, entry] of block.steps.entries()) {
        samples.push({
          label: `${article.slug}:raw-svg-stepper:${index}:${step}`,
          svg: renderSvg(entry.svg),
        });
      }
    }
  }
  return samples;
}

function duplicatePerimeterOutlines(svg: string): string[] {
  const host = document.createElement('div');
  host.innerHTML = svg;
  const rects = [...host.querySelectorAll('rect')];
  const geometry = (rect: Element): string =>
    ['x', 'y', 'width', 'height', 'rx'].map((name) => rect.getAttribute(name) ?? '').join('|');
  const backgroundGeometry = new Set(
    rects.filter((rect) => rect.getAttribute('fill') !== 'none').map(geometry),
  );

  return rects
    .filter((rect) => {
      const stroke = rect.getAttribute('stroke');
      return (
        rect.getAttribute('fill') === 'none' &&
        stroke !== null &&
        stroke !== 'none' &&
        !rect.hasAttribute('stroke-dasharray') &&
        backgroundGeometry.has(geometry(rect))
      );
    })
    .map((rect) => rect.outerHTML);
}

function expectOutlineFree(sample: SvgSample): void {
  expect(duplicatePerimeterOutlines(sample.svg), sample.label).toEqual([]);
}

describe('board outer-outline policy', () => {
  it('keeps every Xiangqi-family article thumbnail and diagram outline-free', () => {
    const samples = articles
      .filter((article) => article.boardFamily === 'xiangqi')
      .flatMap(articleSvgSamples);
    expect(samples.length).toBeGreaterThan(0);
    for (const sample of samples) expectOutlineFree(sample);
  });

  it('keeps the Reveal and Banqi replay widgets outline-free', () => {
    // No article carries a Reveal or Banqi replay block any more (sample games
    // are study or game embeds), so each widget is mounted on the game it was
    // built around.
    const revealBlock = {
      spec: {
        red: JIEQI_SAMPLE_GAME.red,
        black: JIEQI_SAMPLE_GAME.black,
        event: JIEQI_SAMPLE_GAME.event,
        resultText: JIEQI_SAMPLE_GAME.result,
        deal: JIEQI_SAMPLE_GAME.deal,
        moves: JIEQI_SAMPLE_GAME.moves,
      },
    };
    const flipSpec = {
      red: 'Red',
      black: 'Black',
      event: 'Fixture',
      resultText: 'Red wins',
      deal: BANQI_LUCK_GAME.deal,
      moves: BANQI_LUCK_GAME.moves,
    };

    const revealHost = document.createElement('div');
    const flipHost = document.createElement('div');
    const revealController = mountJieqiReplay(revealHost, revealBlock.spec);
    const flipController = mountBanqiReplay(flipHost, flipSpec);

    expectOutlineFree({ label: 'jieqi:replay', svg: revealHost.innerHTML });
    expectOutlineFree({ label: 'banqi:replay', svg: flipHost.innerHTML });

    revealController.destroy();
    flipController.destroy();
  });
});
