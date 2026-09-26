// The Chinese Xiangqi Association's match-fixing sanctions (rulings of
// September 2024, January 2025 and April 2026), keyed by the name the archive
// keys players on. The register is the match-fixing article's table
// (articles/content/xiangqi-match-fixing.ts); sanctions.test.ts fails if the
// two drift. Rule for pages (memory player_features_match_fixing_tiers):
// a sanctioned player's data page states the ruling in one neutral sentence,
// linked to the article, and never more than the ruling says.

export type Sanction = {
  /** As the article's table writes it: 'Life', 'Reprimand', or a term. */
  penalty: string;
};

export const MATCH_FIXING_ARTICLE_PATH = '/blog/xiangqi-match-fixing';

export const SANCTIONS: Readonly<Record<string, Sanction>> = {
  王天一: { penalty: 'Life' },
  赵鑫鑫: { penalty: 'Life' },
  郑惟桐: { penalty: 'Life' },
  洪智: { penalty: 'Life' },
  谢靖: { penalty: 'Life' },
  徐超: { penalty: 'Life' },
  汪洋: { penalty: 'Life' },
  王跃飞: { penalty: 'Life' },
  申鹏: { penalty: '8 years' },
  王廓: { penalty: '7 years 6 months' },
  孙逸阳: { penalty: '7 years' },
  赵金成: { penalty: '6 years' },
  蒋川: { penalty: '5 years' },
  张申宏: { penalty: '4 years 6 months' },
  孙勇征: { penalty: '4 years 3 months' },
  郝继超: { penalty: '4 years 3 months' },
  刘俊达: { penalty: '4 years 3 months' },
  俞易肖: { penalty: '4 years 3 months' },
  程鸣: { penalty: '4 years 3 months' },
  郑一泓: { penalty: '4 years' },
  党斐: { penalty: '3 years' },
  李少庚: { penalty: '3 years' },
  赵殿宇: { penalty: '3 years' },
  聂铁文: { penalty: '3 years' },
  武俊强: { penalty: '3 years' },
  苗利明: { penalty: '2 years' },
  黄竹风: { penalty: '2 years' },
  孙昕昊: { penalty: '2 years' },
  杨铭: { penalty: '2 years' },
  徐崇峰: { penalty: '2 years' },
  赵玮: { penalty: '1 year' },
  陆伟韬: { penalty: '1 year' },
  杨辉: { penalty: '1 year' },
  李小龙: { penalty: '1 year' },
  郑宇航: { penalty: '1 year' },
  马天越: { penalty: '1 year' },
  李艾东: { penalty: '1 year' },
  王宇航: { penalty: '6 months' },
  赵旸鹤: { penalty: '6 months' },
  崔革: { penalty: '6 months' },
  孟辰: { penalty: '6 months' },
  谢岿: { penalty: '6 months' },
  赵子雨: { penalty: '6 months' },
  曹岩磊: { penalty: 'Reprimand' },
  黄文俊: { penalty: 'Reprimand' },
  蔡佑广: { penalty: 'Reprimand' },
  梁运龙: { penalty: 'Reprimand' },
};

export function sanctionFor(name: string): Sanction | null {
  return SANCTIONS[name] ?? null;
}

/** A ban, as opposed to a reprimand. */
export function isBanned(sanction: Sanction | null): boolean {
  return sanction !== null && sanction.penalty !== 'Reprimand';
}

/** The ruling in one neutral clause: "banned for life", "banned for 3 years",
 *  "publicly reprimanded". Only what the ruling says. */
export function sanctionClause(sanction: Sanction): string {
  if (sanction.penalty === 'Reprimand') return 'publicly reprimanded';
  if (sanction.penalty === 'Life') return 'banned for life';
  return `banned for ${sanction.penalty}`;
}

/** The page's one sentence, without the link. */
export function sanctionSentence(sanction: Sanction): string {
  const clause = sanctionClause(sanction);
  return `${clause[0]!.toUpperCase()}${clause.slice(1)} by the Chinese Xiangqi Association in the 2024 to 2026 match-fixing case.`;
}
