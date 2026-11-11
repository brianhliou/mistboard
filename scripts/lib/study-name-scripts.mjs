import { tsImport } from 'tsx/esm/api';

const { personNameForLocale, personNamesInText } = await tsImport(
  '../../packages/game/src/person-name-scripts.ts',
  import.meta.url,
);

// First-party study tag identities; page-script display decided 2026-11-06.
const STUDY_PEOPLE = {
  'Hu Ronghua': '胡荣华',
  'Yang Guanlin': '杨官璘',
  'Li Yiting': '李义庭',
  'Liu Dahua': '柳大华',
  'Li Laiqun': '李来群',
  'Lü Qin': '吕钦',
  'Zhao Guorong': '赵国荣',
  'Xu Tianhong': '徐天红',
  'Tao Hanming': '陶汉明',
  'Xu Yinchuan': '许银川',
  'Li Xuesong': '李雪松',
  'Yu Youhua': '于幼华',
  'Sun Yongzheng': '孙勇征',
  'Wang Yubo': '王禹博',
  'Su Yilin': '苏奕霖',
  'Liu Boliang': '刘伯良',
  'Wu Guilin': '吴贵临',
  'Fung Ka-chun': '冯家俊',
  'Lại Lý Huynh': '赖理兄',
  'Zhao Xinxin': '赵鑫鑫',
  'Jiang Chuan': '蒋川',
  'Wang Tianyi': '王天一',
  'Zheng Weitong': '郑惟桐',
  'Xu Chao': '徐超',
  'Meng Chen': '孟辰',
  'Lei Kam Fun': '李锦欢',
  'Huang Xueqian': '黄学谦',
  'Wang Kuo': '王廓',
  'Nguyễn Vũ Quân': '阮武君',
  'Nguyễn Thành Bảo': '阮成保',
};
const WRONG_FORMS = { 黨斐: '党斐', 於幼華: '于幼华', 孫勇徵: '孙勇征' };

export function studyPersonText(text, locale) {
  const repaired = text.replace(/黨斐|於幼華|孫勇徵/gu, (name) => WRONG_FORMS[name]);
  return personNamesInText(repaired, locale);
}

// Repair the existing generated provenance template without converting people as prose.
function provenanceText(text, locale) {
  const named = studyPersonText(text, locale);
  if (locale !== 'zh-Hant') return named;
  const parts = named.split(' · ');
  if (parts.length < 3 || !/^\d{4}-\d{2}-\d{2}$/.test(parts[1].trim())) return named;
  const cut = parts[0].lastIndexOf('· ');
  if (cut === -1) return named;
  const event = parts[0]
    .slice(cut + 2)
    .replaceAll('锦标赛', '錦標賽')
    .replaceAll('个人', '個人')
    .replaceAll('团体', '團體')
    .replaceAll('国', '國')
    .replaceAll('届', '屆')
    .replaceAll('赛', '賽')
    .replaceAll('华', '華')
    .replaceAll('农', '農')
    .replaceAll('实', '實')
    .replaceAll('业', '業')
    .replaceAll('吴', '吳')
    .replaceAll('县', '縣');
  parts[0] = parts[0].slice(0, cut + 2) + event;
  const stop = parts[2].indexOf('。');
  if (stop !== -1)
    parts[2] =
      parts[2].slice(0, stop + 1) +
      parts[2]
        .slice(stop + 1)
        .replaceAll('为', '為')
        .replaceAll('万', '萬')
        .replaceAll('与', '與');
  return parts.join(' · ');
}

export function studyPersonTag(source, translated, locale) {
  const identity = STUDY_PEOPLE[source];
  if (identity) return personNameForLocale({ name: identity }, locale);
  return studyPersonText(translated ?? source, locale);
}

/** Pure overlay repair. Base text, tags and all non-Chinese fields survive. */
export function repairStudyNameOverlays(source) {
  const next = JSON.parse(JSON.stringify(source));
  const changes = [];
  function set(object, key, value, path) {
    if (object[key] === value) return;
    changes.push({ path, before: object[key] ?? null, after: value });
    object[key] = value;
  }
  function overlay(i18n, path, tags) {
    for (const locale of ['zh-Hans', 'zh-Hant']) {
      const value = i18n?.[locale];
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      for (const key of ['name', 'description']) {
        if (typeof value[key] === 'string')
          set(value, key, studyPersonText(value[key], locale), `${path}.${locale}.${key}`);
      }
      if (!value.tags || typeof value.tags !== 'object' || Array.isArray(value.tags)) continue;
      for (const key of ['red', 'black']) {
        if (typeof value.tags[key] !== 'string') continue;
        set(
          value.tags,
          key,
          studyPersonTag(tags?.[key], value.tags[key], locale),
          `${path}.${locale}.tags.${key}`,
        );
      }
    }
  }
  overlay(next.i18n, 'i18n', next.tags);
  function visit(node, path) {
    if (!node || typeof node !== 'object') return;
    for (const [i, comment] of (node.annotations?.comments ?? []).entries()) {
      for (const locale of ['zh-Hans', 'zh-Hant']) {
        const text = comment.i18n?.[locale];
        if (typeof text === 'string')
          set(
            comment.i18n,
            locale,
            provenanceText(text, locale),
            `${path}.comments.${i}.${locale}`,
          );
      }
    }
    for (const [i, child] of (node.children ?? []).entries()) visit(child, `${path}.children.${i}`);
  }
  visit(next.root?.root, 'root');
  return { next, changes };
}
