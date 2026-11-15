import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const NOTATION_CITATION =
  '[A notation for jieqi and banqi](https://zhuanlan.zhihu.com/p/638758588) (《天天象棋》揭棋和翻翻棋的记谱法). Proposes a way to record these games, which does not otherwise exist. Background only.';

// These name banqi, including Tencent's published notation title, never the
// animal game. Match exact sentences in exact files, with occurrence counts:
// exempting an article or translation file would hide a later naming regression.
// FFQ banqi (翻翻棋 is its mainland name) adds its own explicit entries.
const ALLOWED: Record<string, { sentence: string; count: number }[]> = {
  'apps/web/src/i18n/catalogs/play.zh-hans.ts': [
    { sentence: '翻翻棋最多允许连续捉子四次。这步棋会是第五次。请走别的着法。', count: 1 },
    { sentence: "'variant.ffqBanqi.name': '翻翻棋',", count: 1 },
  ],
  'apps/web/src/i18n/catalogs/play.zh-hant.ts': [
    { sentence: '翻翻棋最多允許連續捉子四次。這步棋會是第五次。請走別的著法。', count: 1 },
    { sentence: "'variant.ffqBanqi.name': '翻翻棋',", count: 1 },
  ],
  'apps/web/src/articles/content/fanfanqi.ts': [
    { sentence: 'Fanfanqi (翻翻棋, “flip-flip chess”)', count: 1 },
  ],
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
    // Fanfanqi rules translations: exact new source and translated sentences.
    // The rules title and its search title (翻翻棋规则：玩法、大小顺序与扣血).
    { sentence: '翻翻棋规则', count: 2 },
    { sentence: '翻翻棋在 4×8 的棋盘上进行，棋子暗置，双方从 60 点血开始。', count: 1 },
    { sentence: '想学翻翻棋，或想比较其血量规则与暗棋差异的玩家。', count: 1 },
    {
      sentence:
        'Fanfanqi (翻翻棋, “flip-flip chess”) is a shorter form of [banqi](/rules/banqi), scored by HP.',
      count: 2,
    },
    { sentence: '翻翻棋是一种以血量（HP）计分、对局更短的[暗棋](/rules/banqi)。', count: 1 },
    {
      sentence: '腾讯的《天天象棋》App 在 2016 年 7 月加入了以 60 点血计分的翻翻棋模式。',
      count: 1,
    },
    {
      sentence: '暗棋的炮可以像其他棋子一样走一格，翻翻棋的炮却不能：炮只能通过吃子来移动。',
      count: 1,
    },
    { sentence: '翻翻棋与暗棋的区别', count: 1 },
    { sentence: '来下翻翻棋', count: 1 },
    // The rules title and its search title (翻翻棋規則：玩法、大小順序與扣血).
    { sentence: '翻翻棋規則', count: 2 },
    { sentence: '翻翻棋在 4×8 的棋盤上進行，棋子暗置，雙方從 60 點血開始。', count: 1 },
    { sentence: '想學翻翻棋，或想比較其血量規則與暗棋差異的玩家。', count: 1 },
    { sentence: '翻翻棋是一種以血量（HP）計分、對局更短的[暗棋](/rules/banqi)。', count: 1 },
    {
      sentence: '騰訊的《天天象棋》App 在 2016 年 7 月加入了以 60 點血計分的翻翻棋模式。',
      count: 1,
    },
    {
      sentence: '暗棋的炮可以像其他棋子一樣走一格，翻翻棋的炮卻不能：炮只能透過吃子來移動。',
      count: 1,
    },
    { sentence: '翻翻棋與暗棋的區別', count: 1 },
    { sentence: '來下翻翻棋', count: 1 },
    // Fanfanqi launch (2026-11-17): the banqi house-rules link, two update notes
    // and the shared comparison table header.
    { sentence: '[翻翻棋](/rules/fanfanqi)就是炮可以打暗子的变体。', count: 1 },
    { sentence: '[翻翻棋](/rules/fanfanqi)就是炮可以打暗子的變體。', count: 1 },
    { sentence: '家规一节现在链接到翻翻棋：炮可以打暗子的变体。', count: 1 },
    { sentence: '家規一節現在連結到翻翻棋：炮可以打暗子的變體。', count: 1 },
    { sentence: '对照表现在加入了翻翻棋。', count: 1 },
    { sentence: '對照表現在加入了翻翻棋。', count: 1 },
    { sentence: "Fanfanqi: '翻翻棋',", count: 2 },
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
