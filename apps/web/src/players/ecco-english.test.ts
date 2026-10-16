import { describe, expect, it } from 'vitest';
import { eccoEnglish } from './ecco-english.js';

// Every distinct opening string in the broadcast data on 2026-09-25. Each
// main name must translate; a new string that does not shows the Chinese
// until its terms join the glossary.
const REAL_OPENINGS = [
  'E40 对兵局',
  'C70 五七炮对屏风马进３卒',
  'B20 中炮对左三步虎',
  'A60 过宫炮局',
  'E42 对兵互进右马局',
  'E21 仙人指路转左中炮对卒底炮飞左象 红先上仕',
  'E11 仙人指路飞相对卒底炮',
  'E16 仙人指路转左中炮对卒底炮飞右象 互进边马',
  'C15 中炮巡河车对屏风马 红不进左马',
  'E20 仙人指路转左中炮对卒底炮飞左象',
  'A28 飞相转屏风马对左中炮',
  'A61 过宫炮对进左马',
  'A42 起马转边炮对进７卒',
  'E37 仙人指路转左中炮对卒底炮飞左象 红右边马',
  'E04 仙人指路对士角炮或过宫炮',
  'C06 中炮左边马对屏风马 红左横车',
  'E45 对兵互进右马局 红边炮',
  'A45 起马互进七兵局',
  'E10 仙人指路对卒底炮',
  'C72 五七炮互进三兵对屏风马边卒右马外盘河',
  'B24 中炮过河炮对左三步虎',
  'C73 五七炮互进三兵对屏风马边卒右马外盘河 红左横车',
  'E47 对兵转兵底炮对右中炮',
  'E43 对兵互进右马局 红飞相',
  'A51 仕角炮对进左马',
  'A26 飞相进七兵对右士角炮',
  'E03 仙人指路对中炮',
  'B25 中炮两头蛇对左三步虎',
  'A20 飞相对左士角炮',
  'C71 五七炮对屏风马进３卒右马外盘河',
  'E36 仙人指路转左中炮对卒底炮飞左象 红双直车右边马对黑连进７卒右横车',
  'C02 中炮七路马对屏风马 红左马盘河',
  'E09 两头蛇对进右马转卒底炮',
  'E31 仙人指路转左中炮对卒底炮飞左象 黑连进７卒',
  'D54 中炮左直车对后补列炮',
  'B07 中炮对左炮封车',
  'C44 中炮过河车互进七兵对屏风马平炮兑车 红左马盘河对黑退边炮上右士',
  'C48 中炮过河车互进七兵对屏风马平炮兑车 红仕角炮对黑退边炮',
  'E44 对兵互进右马局 红横车',
  'A38 飞相互进七兵局',
  'E02 仙人指路进右马对飞象',
  'A53 仕角炮转反宫马对右中炮',
  'E46 对兵转兵底炮',
  'A27 飞相对左中炮',
  'B31 中炮对反宫马',
  'B42 五六炮左正马对反宫马 黑右直车',
  'A36 飞相对进７卒',
  'C51 五六炮左边马对屏风马',
  'E41 对兵进右马局',
  'C92 五八炮互进三兵对屏风马 红左正马',
  'C01 中炮七路马对屏风马',
  'C78 五七炮互进三兵对屏风马边卒右马外盘河 红左横车对黑兑边卒',
  'A21 飞相对右士角炮',
  'C80 中炮巡河炮对屏风马',
  'C97 五八炮互进三兵对屏风马 红左边马平炮压马对黑边卒',
  'E12 仙人指路转右中炮对卒底炮',
  'D40 中炮对左三步虎转列炮',
  'A63 过宫炮对左中炮',
  'A11 顺相局',
  'A39 飞相对进３卒',
  'A24 飞相横车对右士角炮',
  'C04 中炮七路马对屏风马 红进中兵对黑双炮过河',
  'A44 起马转中炮对进７卒',
  'D36 中炮进三兵对左炮封车转列炮 红两头蛇',
  'A23 飞相左边马对右士角炮',
  'C16 中炮巡河车对屏风马 红进左马',
  'B51 五七炮对反宫马左直车',
  'A50 仕角炮局',
  'C18 中炮过河车七路马对屏风马',
  'D29 顺炮直车对横车 红两头蛇对黑双横车',
  'E01 仙人指路对飞象',
  'A10 飞相局',
  'C31 中炮过河车互进七兵对屏风马上士',
  'C77 五七炮互进三兵对屏风马边卒右马外盘河 红左横车对黑飞右象',
  'A16 飞相进七兵对进右马',
  'C14 中炮右横车对屏风马 红进中兵',
  'D28 顺炮直车对横车 红两头蛇',
  'A64 过宫炮直车对左中炮',
  'C46 中炮过河车互进七兵对屏风马平炮兑车 红左边炮对黑退边炮上右士右直车',
  'A13 飞相对进左马',
  'E14 仙人指路转左中炮对卒底炮飞右象',
  'E08 两头蛇对进右马',
  'E33 仙人指路转左中炮对卒底炮飞左象 红左直车右边马对黑连进７卒右横车',
  'C95 五八炮互进三兵对屏风马 红左边马对黑兑７卒',
] as const;

describe('eccoEnglish', () => {
  it.each(REAL_OPENINGS)('translates %s', (opening) => {
    const result = eccoEnglish(opening);
    expect(result.code).toMatch(/^[A-E]\d{2}$/);
    expect(result.en).toBeTruthy();
    // Never a half-translated string.
    expect(result.en).not.toMatch(/[㐀-鿿０-９]/);
    expect(`${result.code} ${result.zh}`).toBe(opening);
  });

  it.each([
    ['E40 对兵局', 'Pawn vs Pawn Opening'],
    ['C70 五七炮对屏风马进３卒', 'Five-Seven Cannons vs Screen Horses with 3rd Pawn Advanced'],
    ['B20 中炮对左三步虎', 'Central Cannon vs Left Three-Step Tiger'],
    ['A60 过宫炮局', 'Cross-Palace Cannon Opening'],
    ['A10 飞相局', 'Elephant Opening'],
    ['E11 仙人指路飞相对卒底炮', 'Pawn Opening with Elephant vs Pawn-Base Cannon'],
    ['A51 仕角炮对进左马', 'Palcorner Cannon vs Left Horse'],
    ['A20 飞相对左士角炮', 'Elephant Opening vs Left Palcorner Cannon'],
    ['B31 中炮对反宫马', 'Central Cannon vs Sandwiched Horses'],
    ['B07 中炮对左炮封车', 'Central Cannon vs Left Cannon Blockade'],
    [
      'C15 中炮巡河车对屏风马 红不进左马',
      'Central Cannon with Riverbank Chariot vs Screen Horses: Red Left Horse Held Back',
    ],
    [
      'C72 五七炮互进三兵对屏风马边卒右马外盘河',
      'Five-Seven Cannons with Both 3rd Pawns Advanced vs Screen Horses with Edge Pawn, Right Outer Riverbank Horse',
    ],
    [
      'E16 仙人指路转左中炮对卒底炮飞右象 互进边马',
      'Pawn Opening into Left Central Cannon vs Pawn-Base Cannon with Right Elephant: Both Edge Horses',
    ],
    ['E04 仙人指路对士角炮或过宫炮', 'Pawn Opening vs Palcorner Cannon or Cross-Palace Cannon'],
    [
      'D29 顺炮直车对横车 红两头蛇对黑双横车',
      'Same Direction Cannons with Filed Chariot vs Ranked Chariot: Red Double-Headed Snake vs Black Double Ranked Chariots',
    ],
    [
      'D40 中炮对左三步虎转列炮',
      'Central Cannon vs Left Three-Step Tiger into Opposite Direction Cannons',
    ],
  ])('%s -> %s', (opening, en) => {
    expect(eccoEnglish(opening).en).toBe(en);
  });

  it('splits the code from the name', () => {
    expect(eccoEnglish('C70 五七炮对屏风马进３卒')).toEqual({
      code: 'C70',
      en: 'Five-Seven Cannons vs Screen Horses with 3rd Pawn Advanced',
      zh: '五七炮对屏风马进３卒',
    });
  });

  it('returns null English when any main-name term is unknown', () => {
    // 鸳鸯炮 (Mandarin Duck Cannons) is not in the glossary.
    expect(eccoEnglish('B99 中炮对鸳鸯炮')).toEqual({ code: 'B99', en: null, zh: '中炮对鸳鸯炮' });
    expect(eccoEnglish('中炮对鸳鸯炮').code).toBeNull();
  });

  it('drops an untranslatable sub-variation but keeps the main name', () => {
    expect(eccoEnglish('C06 中炮左边马对屏风马 红左横车对黑鸳鸯炮').en).toBe(
      'Central Cannon with Left Edge Horse vs Screen Horses',
    );
  });

  it('reads 对兵 as the pawn-vs-pawn opening only at the start', () => {
    // A 对 separator followed by a 兵 move must not be swallowed as 对兵.
    expect(eccoEnglish('A00 飞相对兵底炮').en).toBe('Elephant Opening vs Pawn-Base Cannon');
  });

  it('handles empty and code-only strings', () => {
    expect(eccoEnglish('')).toEqual({ code: null, en: null, zh: '' });
    expect(eccoEnglish('C70')).toEqual({ code: 'C70', en: null, zh: '' });
  });
});
