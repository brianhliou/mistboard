import { describe, expect, it } from 'vitest';
import { detectScriptLanguage, translationNeeded } from './forum-language.js';

describe('forum-language', () => {
  it('classifies by writing system, ignoring URLs and handles', () => {
    expect(detectScriptLanguage('这个开局的炮二平五很常见')).toBe('zh');
    expect(detectScriptLanguage('Cannon to the centre file is the classic opening.')).toBe('latin');
    expect(detectScriptLanguage('The 炮 (cannon) and 马 (horse) work together here.')).toBe(
      'latin',
    );
    expect(detectScriptLanguage('看这局 https://mistboard.com/game/abc123 @alice 第十回合')).toBe(
      'zh',
    );
    expect(detectScriptLanguage('1. C2=5')).toBe('unknown');
    expect(detectScriptLanguage('')).toBe('unknown');
  });

  it('offers translation only across the script/locale boundary', () => {
    expect(translationNeeded('炮二平五好棋', 'en')).toBe(true);
    expect(translationNeeded('炮二平五好棋', 'zh-Hans')).toBe(false);
    expect(translationNeeded('炮二平五好棋', 'zh-Hant')).toBe(false);
    expect(translationNeeded('Cannon to the centre', 'en')).toBe(false);
    expect(translationNeeded('Cannon to the centre', 'zh-Hans')).toBe(true);
    expect(translationNeeded('Cannon to the centre', 'zh-Hant')).toBe(true);
    expect(translationNeeded('1. C2=5', 'zh-Hans')).toBe(false);
  });

  it('decides from the author own lines, never from what they quoted', () => {
    // Post #6 of the live weekly jieqi arena topic: an English quote, one
    // Chinese line of the author's own.
    const quoteReply = [
      '> brianhliou-dev wrote:',
      '> Haha yes, 3 p.m. UTC+8. Most of our current players are in Asia, so we picked a time that works there.',
      '> ',
      '> So would you play?!',
      '你是这个网站的作者吗',
    ].join('\n');
    expect(translationNeeded(quoteReply, 'en')).toBe(true);
    expect(translationNeeded(quoteReply, 'zh-Hans')).toBe(false);
    expect(translationNeeded(quoteReply, 'zh-Hant')).toBe(false);
    expect(translationNeeded('> alice wrote:\n> Cannon to the centre', 'zh-Hans')).toBe(false);
  });
});
