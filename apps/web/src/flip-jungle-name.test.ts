import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const NOTATION_CITATION =
  '[A notation for jieqi and banqi](https://zhuanlan.zhihu.com/p/638758588) (《天天象棋》揭棋和翻翻棋的记谱法). Proposes a way to record these games, which does not otherwise exist. Background only.';

// These name banqi, including Tencent's published notation title, never the
// animal game. Match exact sentences in exact files, with occurrence counts:
// exempting an article or translation file would hide a later naming regression.
// FFQ banqi must add its own explicit entries when it reaches this branch.
const ALLOWED: Record<string, { sentence: string; count: number }[]> = {
  'apps/web/src/articles/content/jieqi-openings.ts': [{ sentence: NOTATION_CITATION, count: 1 }],
  'apps/web/src/articles/content/khai-cuoc-co-up.ts': [
    { sentence: NOTATION_CITATION, count: 1 },
    {
      sentence:
        '[Một cách ghi biên bản cho cờ úp và cờ lật](https://zhuanlan.zhihu.com/p/638758588) (《天天象棋》揭棋和翻翻棋的记谱法). Đề xuất một cách ghi lại các ván cờ này, thứ vốn chưa tồn tại. Chỉ mang tính tham khảo.',
      count: 1,
    },
  ],
  'apps/web/src/article-i18n.ts': [
    { sentence: NOTATION_CITATION, count: 2 },
    {
      sentence:
        '[《天天象棋》揭棋和翻翻棋的记谱法](https://zhuanlan.zhihu.com/p/638758588)。提出了一套记谱方式，此前并不存在。仅作背景参考。',
      count: 1,
    },
    {
      sentence:
        '[《天天象棋》揭棋和翻翻棋的記譜法](https://zhuanlan.zhihu.com/p/638758588)。提出了一套記譜方式，此前並不存在。僅作背景參考。',
      count: 1,
    },
    {
      sentence:
        '翻翻棋（暗棋）和揭棋是象棋自己的翻子游戏，翻开一枚棋子是为了揭示它是什么，与它归谁无关。',
      count: 1,
    },
    {
      sentence:
        '翻翻棋（暗棋）和揭棋是象棋自己的翻子游戲，翻開一枚棋子是為了揭示它是什麼，與它歸誰無關。',
      count: 1,
    },
  ],
};

function repoRoot(): string {
  let dir = process.cwd();
  while (!existsSync(join(dir, 'apps/web/src'))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`repo root not found from ${process.cwd()}`);
    dir = parent;
  }
  return dir;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : sourceFiles(path);
    }
    // Scan every source format, including CSS/JSON and comments, but not tests.
    return /\.(?:test|spec|slowtest)\.[^.]+$/.test(entry.name) ? [] : [path];
  });
}

describe('Flip Jungle Chinese name regression guard', () => {
  it('reserves 翻翻棋 for the exact allowlisted banqi sentences', () => {
    const root = repoRoot();
    const files = new Map(
      sourceFiles(join(root, 'apps/web/src')).map((path) => [
        relative(root, path),
        readFileSync(path, 'utf8'),
      ]),
    );
    expect(files.size, 'scanner found no web source').toBeGreaterThan(500);

    for (const [path, entries] of Object.entries(ALLOWED)) {
      expect(files.has(path), `stale allowlist path: ${path}`).toBe(true);
      let text = files.get(path)!;
      for (const { sentence, count } of entries) {
        expect(text.split(sentence).length - 1, `${path}: ${sentence}`).toBe(count);
        // Keep line numbers intact for the failure report below.
        text = text.replaceAll(sentence, ' '.repeat(sentence.length));
      }
      files.set(path, text);
    }

    const offenders = [...files].flatMap(([path, text]) =>
      text
        .split('\n')
        .flatMap((line, index) =>
          line.includes('翻翻棋') ? [`${path}:${index + 1}: ${line.trim()}`] : [],
        ),
    );
    expect(offenders, 'Flip Jungle must use 翻翻兽棋 / 翻翻獸棋').toEqual([]);
  });
});
