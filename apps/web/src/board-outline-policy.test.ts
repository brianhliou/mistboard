import { describe, expect, it } from 'vitest';
import { type Article, type ArticleBlock, articles, findArticle } from './articles-data.js';
import { mountBanqiReplay } from './banqi-replay.js';
import type { Locale } from './i18n/locale.js';
import { mountJieqiReplay } from './jieqi-replay.js';

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
    // The jieqi and banqi rules pages no longer carry replay blocks (their
    // sample games are study embeds), so the Reveal replay is exercised on the
    // Vietnamese rules article's block and the Banqi replay on the one the
    // MistyBanqi post holds.
    const reveal = findArticle('luat-co-up');
    const flip = findArticle('mistybanqi');
    const revealBlock =
      reveal && articleBlocks(reveal).find((block) => block.kind === 'jieqi-replay');
    const flipBlock = flip && articleBlocks(flip).find((block) => block.kind === 'banqi-replay');
    if (revealBlock?.kind !== 'jieqi-replay') throw new Error('missing Jieqi replay');
    if (flipBlock?.kind !== 'banqi-replay') throw new Error('missing Banqi replay');

    const revealHost = document.createElement('div');
    const flipHost = document.createElement('div');
    const revealController = mountJieqiReplay(revealHost, revealBlock.spec);
    const flipController = mountBanqiReplay(flipHost, flipBlock.spec);

    expectOutlineFree({ label: 'jieqi:replay', svg: revealHost.innerHTML });
    expectOutlineFree({ label: 'banqi:replay', svg: flipHost.innerHTML });

    revealController.destroy();
    flipController.destroy();
  });
});
