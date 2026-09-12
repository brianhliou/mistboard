import { describe, expect, it } from 'vitest';
import { ARTICLE_LANGS } from './article-i18n.js';
import { type ReplayStepperFamily, replayStepperCopy } from './replay-stepper-copy.js';

// The hover text on a judged move ("Blunder · 23.7% win chance given up · eval
// +0.74") is BUILT from a stored note by a regex, not held as prose. So the
// article translation-coverage gate cannot see it: that gate reads the article
// tree, and this string does not exist there. It reported 100% while every
// board on both Chinese pages said Blunder, Mistake and Inaccuracy in English.
//
// Same shape as the seoTitle gap that shipped an English <title> over Chinese
// prose: a checker pointed at the wrong surface reports green. The countermeasure
// is a test per generated surface, because there is no generic one.
const FAMILIES: ReplayStepperFamily[] = ['xiangqi', 'chess', 'shogi', 'jieqi'];
const GLYPHS = ['??', '?', '?!', '!!', '!', '!?'] as const;

describe('judged-move hover text is localized', () => {
  it('translates every glyph label in every zh script', () => {
    const english = replayStepperCopy('en' as never, 'xiangqi');
    const untranslated: string[] = [];
    for (const lang of ARTICLE_LANGS) {
      const copy = replayStepperCopy(lang, 'xiangqi');
      for (const glyph of GLYPHS) {
        const label = copy.judgment[glyph];
        expect(label, `[${lang}] no label for ${glyph}`).toBeTruthy();
        if (label === english.judgment[glyph]) untranslated.push(`[${lang}] ${glyph}: ${label}`);
      }
    }
    expect(untranslated, untranslated.join('\n')).toEqual([]);
  });

  it('covers every glyph the widget can render, so none falls back to blank', () => {
    // `!?` had no entry at all until this landed: nothing computes it, so it
    // only appears on authored annotations and its label was silently ''.
    for (const family of FAMILIES) {
      for (const lang of [...ARTICLE_LANGS, 'en' as never]) {
        const copy = replayStepperCopy(lang, family);
        for (const glyph of GLYPHS) {
          expect(copy.judgment[glyph], `${family}/${lang} is missing ${glyph}`).toBeTruthy();
        }
      }
    }
  });

  it('translates the cost and eval phrases, and keeps the number intact', () => {
    for (const lang of ARTICLE_LANGS) {
      const copy = replayStepperCopy(lang, 'xiangqi');
      const cost = copy.winChanceGivenUp('23.7');
      expect(cost).toContain('23.7');
      // The number must survive, and the sentence around it must not be English.
      expect(cost).not.toMatch(/win chance/i);
      expect(copy.evalPrefix).not.toBe('eval');
    }
  });
});
