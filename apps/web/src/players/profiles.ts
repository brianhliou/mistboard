// Authored facts per player, by slug: what the archive cannot derive (a photo,
// a birth year, a title the official lists have not caught up with, the
// written profile). A player with no entry here still has a page.
// Sources and rights: docs-private/players/<slug>/facts.md.

export type PlayerProfile = {
  /** Square-ish photo for the page and the index rows. */
  photo?: string;
  photoCredit?: string;
  born?: string;
  /** Short title tag shown before the name, lichess-style: GM, NM. */
  title?: PlayerTitle;
  /** The written profile, when one exists. */
  profileHref?: string;
};

export type PlayerTitle = 'GM' | 'NM';

export const PLAYER_TITLE_LABEL: Readonly<Record<PlayerTitle, string>> = {
  GM: '特级大师 · Grandmaster',
  NM: '象棋大师 · National master',
};

export const PLAYER_PROFILES: Readonly<Record<string, PlayerProfile>> = {
  'yin-sheng': {
    photo: '/article-thumbs/yin-sheng-2022-face.jpg',
    photoCredit: '浙江省第十七届运动会 via Sohu',
    born: '2005, Wenling, Zhejiang',
    title: 'NM',
    profileHref: '/blog/yin-sheng',
  },
  'cao-yanlei': {
    photo: '/article-thumbs/cao-yanlei-2024-face.jpg',
    photoCredit: '象棋字典 via Sohu',
    born: '1991, Sanmenxia, Henan',
    // CXA 国家大师 (2021 registration list). His grandmaster title is the WXF's,
    // for Macau, which this tag set does not carry; facts.md § Titles.
    title: 'NM',
    profileHref: '/blog/cao-yanlei',
  },
};
