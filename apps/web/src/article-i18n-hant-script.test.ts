import { describe, expect, it } from 'vitest';
import { translateArticleText, translationKeys } from './article-i18n.js';

// ZH_HANT opens with the Simplified spread, so a key with no Traditional entry
// serves Simplified text on a Traditional page and nothing else notices.
// Blind spot: this is a fixed list of characters that are never Traditional,
// the ones the 2026-11 audit found, so a Simplified character outside it
// passes. Characters that exist in both scripts (后, 于, 党, 里) stay out.
const SIMPLIFIED_ONLY =
  '静刘报摄陈丽时凤兰将国际规则荣华杨义来吕钦红赵许银汉蒋孙谢郑张强苏届运动会黄颖砚伟东泽韩传号吴跃飞继鹏阳达鸣聂铁风铭玮陆韬辉龙马旸鹤岿广军兽';
// Spellings a Traditional page cites on purpose: the mainland name of Jungle
// and a Japanese magazine title.
const CITED_SPELLINGS = ['斗兽棋', '詰将棋パラダイス'];

// A name is written in the script its owner uses, so a mainland player stays
// Simplified on a Traditional page (champion-name-script.test.ts pins the rule).
const MAINLAND_NAMES =
  '刘俊达 吕钦 孙勇征 孙昕昊 孙逸阳 张申宏 杨官璘 杨辉 杨铭 聂铁文 蒋川 许文章 许银川 谢岿 谢靖 赵国荣 赵子雨 赵攀伟 赵旸鹤 赵殿宇 赵玮 赵金成 赵鑫鑫 郑一泓 郑宇航 郑惟桐 陈幸琳 陈泓盛 陆伟韬 马天越 黄光颖 黄文俊 黄竹风 左文静 徐天红 于幼华 吴丹 吕皓 苏奕霖 张强 黄蕾蕾 陈丽淳 朱国平 郭玉军 李来群 李义庭 梁运龙 胡荣华 王跃飞 程鸣 郝继超 陶汉明 申鹏 韩传号 柳大华 王永强 程宇东 时凤兰 靳玉砚 武俊强 李艾东 蔡佑广 李小龙 刘泽昊 郑奕宸 张瑞 张佳雯 张婷婷 刘程'.split(
    ' ',
  );

function simplifiedOnlyIn(text: string): string[] {
  let body = text;
  for (const spelling of [...CITED_SPELLINGS, ...MAINLAND_NAMES]) {
    body = body.replaceAll(spelling, '');
  }
  return [...new Set([...body].filter((ch) => SIMPLIFIED_ONLY.includes(ch)))];
}

describe('zh-Hant serves Traditional text', () => {
  it('flags a planted Simplified string and passes its Traditional form', () => {
    expect(simplifiedOnlyIn('揭棋规则')).toEqual(['规', '则']);
    expect(simplifiedOnlyIn('揭棋規則')).toEqual([]);
    // A listed name passes; the Simplified word beside it still fails.
    expect(simplifiedOnlyIn('杨官璘的象棋規則')).toEqual([]);
    expect(simplifiedOnlyIn('杨官璘的象棋规则')).toEqual(['规', '则']);
  });

  it('has no Simplified-only character in any article string', () => {
    const bad = translationKeys('zh-Hant')
      .map((key) => translateArticleText('zh-Hant', key))
      .filter((text) => simplifiedOnlyIn(text).length > 0);
    expect(bad).toEqual([]);
  });

  it('has no Simplified-only character in any interface string', async () => {
    const { domains } = await import('./i18n/locales/zh-hant.js');
    const catalogs = Object.values(domains);
    expect(catalogs.length).toBeGreaterThan(5);
    const bad = catalogs
      .flatMap((catalog) => Object.values(catalog))
      .filter((text): text is string => typeof text === 'string')
      .filter((text) => simplifiedOnlyIn(text).length > 0);
    expect(bad).toEqual([]);
  });
});
