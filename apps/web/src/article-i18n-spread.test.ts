import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { translateArticleText } from './article-i18n.js';

// ZH_HANT starts from a spread of ZH_HANS, and in an object literal the later
// key wins: any Traditional entry written above the spread is silently
// replaced by its Simplified twin. On 2026-10-02 two posts' Traditional blocks
// landed above it and their zh-Hant pages shipped in Simplified.
describe('zh-Hant dictionary order', () => {
  it('opens with the zh-Hans spread, so no authored entry sits above it', () => {
    const path = ['src/article-i18n.ts', 'apps/web/src/article-i18n.ts']
      .map((candidate) => resolve(process.cwd(), candidate))
      .find((candidate) => existsSync(candidate));
    const source = readFileSync(path as string, 'utf8');
    const body = source.slice(source.indexOf('const ZH_HANT'));
    const firstProperty = body
      .split('\n')
      .slice(1)
      .map((line) => line.trim())
      .find((line) => line !== '' && !line.startsWith('//'));
    expect(firstProperty).toBe('...ZH_HANS,');
  });

  it('serves the Traditional entry where both scripts have one', () => {
    expect(translateArticleText('zh-Hant', 'Our Pikafish jieqi bot misjudged its reveals')).toBe(
      '我們的皮卡魚揭棋電腦誤判了翻子',
    );
  });
});
