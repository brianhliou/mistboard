import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setStoredLocale } from './i18n/locale.js';
import { importXiangqiGame } from './review/xiangqi-import.js';
import { mountXiangqiImport, xiangqiImportTargetUrl } from './xiangqi-import-page.js';

// Node's native localStorage can shadow happy-dom's storage in the test worker.
beforeEach(() => {
  const values = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      clear: () => values.clear(),
    },
  });
});

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

const TAGGED_PGN = `[Event "Wuyang Cup"]
[Red "Hu Ronghua"]
[Black "Liu Dahua"]
[Result "1-0"]

1. C2.5 H8+7 2. H2+3 R9.8 1-0
`;

describe('import page target URL', () => {
  it('sends a pasted PGN to the analysis board with its moves', () => {
    const outcome = xiangqiImportTargetUrl(TAGGED_PGN);
    if ('error' in outcome) throw new Error(`expected a URL, got ${outcome.error}`);
    const url = new URL(outcome.url, 'https://mistboard.com');
    expect(url.pathname).toBe('/analysis/xiangqi');
    expect(url.searchParams.get('moves')).toBe('h3-e3 h10-g8 h1-g3 i10-h10');
    expect(url.searchParams.get('fen')).toBeNull();
  });

  it('reads bare movetext too, in any of the notations', () => {
    const wxf = xiangqiImportTargetUrl('C2.5 H8+7');
    const chinese = xiangqiImportTargetUrl('炮二平五 马8进7');
    if ('error' in wxf || 'error' in chinese) throw new Error('expected both to import');
    expect(new URL(chinese.url, 'https://x').searchParams.get('moves')).toBe(
      new URL(wxf.url, 'https://x').searchParams.get('moves'),
    );
  });

  it('carries a [FEN] start through, so the moves replay from the right position', () => {
    const fen = '3k5/9/9/9/9/9/9/9/9/4K1R2 w - - 0 1';
    const outcome = xiangqiImportTargetUrl(`[SetUp "1"]\n[FEN "${fen}"]\n\n1. g1-f1 *`);
    if ('error' in outcome) throw new Error(`expected a URL, got ${outcome.error}`);
    expect(new URL(outcome.url, 'https://x').searchParams.get('fen')).toBe(fen);
  });

  it('reports empty and unreadable input instead of navigating', () => {
    expect(xiangqiImportTargetUrl('   ')).toEqual({ error: 'Paste a game first.' });
    const junk = xiangqiImportTargetUrl('the quick brown fox');
    expect('error' in junk && junk.error.length > 0).toBe(true);
  });
});

const LOCALES = [
  {
    locale: 'en',
    heading: 'Import a game',
    label: 'Game',
    submit: 'Import',
    file: 'Import from a file',
    empty: 'Paste a game first.',
    large: 'That file is too large to import.',
    read: 'Could not read that file.',
    invalid: 'Unrecognized move notation.',
    noPgn: 'No moves found in this PGN.',
    fen: 'Could not read the [FEN] tag: bad',
    illegal: 'Move 1 ("b1b2") is not legal as coordinate.',
    variation: '"b1b2" is not a legal move here.',
    enter: 'Enter a game to import.',
    lede: 'Nothing is published',
    formats: 'Chinese notation',
    placeholder: 'or just:',
  },
  {
    locale: 'zh-Hans',
    heading: '导入棋谱',
    label: '棋谱',
    submit: '导入',
    file: '从文件导入',
    empty: '请先粘贴棋谱。',
    large: '该文件过大，无法导入。',
    read: '无法读取该文件。',
    invalid: '无法识别着法记谱格式。',
    noPgn: '此 PGN 中未找到着法。',
    fen: '无法读取 [FEN] 标签：bad',
    illegal: '第 1 步（“b1b2”）不符合坐标记谱的合法着法。',
    variation: '“b1b2”在当前局面不是合法着法。',
    enter: '请输入要导入的棋谱。',
    lede: '不会公开发布',
    formats: '中文记谱',
    placeholder: '也可直接粘贴：',
  },
  {
    locale: 'zh-Hant',
    heading: '匯入棋譜',
    label: '棋譜',
    submit: '匯入',
    file: '從檔案匯入',
    empty: '請先貼上棋譜。',
    large: '該檔案過大，無法匯入。',
    read: '無法讀取該檔案。',
    invalid: '無法辨識著法記譜格式。',
    noPgn: '此 PGN 中未找到著法。',
    fen: '無法讀取 [FEN] 標籤：bad',
    illegal: '第 1 步（「b1b2」）不符合座標記譜的合法著法。',
    variation: '「b1b2」在目前局面不是合法著法。',
    enter: '請輸入要匯入的棋譜。',
    lede: '不會公開發布',
    formats: '中文記譜',
    placeholder: '也可直接貼上：',
  },
] as const;

for (const copy of LOCALES) {
  describe(`${copy.locale} import`, () => {
    it('localizes validation and parser failures, retaining notation details', () => {
      setStoredLocale(copy.locale);
      const cases = [
        [' ', copy.empty],
        ['x'.repeat(4 * 1024 * 1024 + 1), copy.large],
        ['nonsense', copy.invalid],
        ['[Event "Empty"]', copy.noPgn],
        ['[FEN "bad"]\n1. g1-f1', copy.fen],
        ['b1b2', copy.illegal],
        ['1. C2.5 (b1b2) H8+7', copy.variation],
      ];
      for (const [input, error] of cases) expect(xiangqiImportTargetUrl(input!)).toEqual({ error });
      expect(importXiangqiGame(' ').error).toBe(copy.enter);
      expect(importXiangqiGame('b1b2').error).toBe(copy.illegal);
    });

    it('preserves the exact successful FEN and moves URL in every locale', () => {
      setStoredLocale(copy.locale);
      const fen = '3k5/9/9/9/9/9/9/9/9/4K1R2 w - - 0 1';
      const result = xiangqiImportTargetUrl(`[FEN "${fen}"]\n1. g1-f1`);
      if ('error' in result) throw new Error(result.error);
      const url = new URL(result.url, 'https://mistboard.com');
      expect(url.pathname).toBe('/analysis/xiangqi');
      expect(url.searchParams.get('fen')).toBe(fen);
      expect(url.searchParams.get('moves')).toBe('g1-f1');
    });

    it('renders copy, paste and file errors, and navigates on successful imports', async () => {
      setStoredLocale(copy.locale);
      const navigate = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
      const host = document.createElement('div');
      mountXiangqiImport(host);
      expect(host.querySelector('h1')?.textContent).toBe(copy.heading);
      expect(host.querySelector('label')?.textContent).toBe(copy.label);
      expect(host.querySelector('button[type="submit"]')?.textContent).toBe(copy.submit);
      expect(host.querySelector('.xiangqi-import-lede')?.textContent).toContain(copy.lede);
      expect(host.querySelector('.xiangqi-import-formats')?.textContent).toContain(copy.formats);
      expect([...host.querySelectorAll('code')].map((node) => node.textContent)).toEqual([
        'C2.5',
        '炮二平五',
        'h3e3',
      ]);
      const textarea = host.querySelector('textarea')!;
      expect(textarea.placeholder).toContain(copy.placeholder);
      const form = host.querySelector('form')!;
      const error = host.querySelector('[role="alert"]')!;
      const submit = () => form.dispatchEvent(new Event('submit', { cancelable: true }));
      submit();
      expect(error.textContent).toBe(copy.empty);
      textarea.value = 'nonsense';
      submit();
      expect(error.textContent).toBe(copy.invalid);
      const file = host.querySelector<HTMLInputElement>('input[type="file"]')!;
      expect(file.getAttribute('aria-label')).toBe(copy.file);
      const pick = (size: number, text: () => Promise<string>) => {
        Object.defineProperty(file, 'files', { configurable: true, value: [{ size, text }] });
        file.dispatchEvent(new Event('change'));
      };
      const read = vi.fn(async () => TAGGED_PGN);
      pick(4 * 1024 * 1024 + 1, read);
      expect(error.textContent).toBe(copy.large);
      expect(read).not.toHaveBeenCalled();
      pick(10, async () => {
        throw new Error('disk failure');
      });
      await vi.waitFor(() => expect(error.textContent).toBe(copy.read));
      pick(10, async () => 'nonsense');
      await vi.waitFor(() => expect(error.textContent).toBe(copy.invalid));
      expect(textarea.value).toBe('nonsense');
      expect(navigate).not.toHaveBeenCalled();
      pick(100, read);
      await vi.waitFor(() => expect(navigate).toHaveBeenCalledOnce());
      expect(error.textContent).toBe('');
      expect(navigate).toHaveBeenCalledWith(
        expect.stringContaining('moves=h3-e3+h10-g8+h1-g3+i10-h10'),
      );
      textarea.value = TAGGED_PGN;
      submit();
      expect(navigate).toHaveBeenCalledTimes(2);
    });
  });
}
