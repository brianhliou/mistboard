// zh-Hans and zh-Hant for the two jungle engine studies, generated beside the
// English rather than parsed back out of it.
//
// study-name-i18n.mjs exists because the studies it covers were built outside
// this repo and the API is the only handle on them, so it has to parse a
// generated English name and refuse anything that does not match. These two
// studies are built by scripts/jungle-katago-study.ts in this repo, so the
// builder knows the number, the seat and the outcome before it writes a word;
// emitting every language from those fields cannot drift and cannot half-match.
//
// Both scripts are written out by hand, as in lib/jungle-study-i18n.mjs. They
// are NOT derived from one another here: the site converts zh-Hans to zh-Hant
// with OpenCC plus a fork table (_i18n/glossary/zh-Hant.yml), and a hand-rolled
// character swap in this file would be a second, worse copy of that.
//
// Terminology follows the jungle rules page: 斗兽棋/鬥獸棋 for the game,
// 兽穴/獸穴 for the den, 步 for a ply, 子力 for material. Engine names stay Latin.

export type Script = 'zh-Hans' | 'zh-Hant';
export const SCRIPTS: readonly Script[] = ['zh-Hans', 'zh-Hant'];
export type Localized = Record<Script, string>;

const pair = (hans: string, hant: string): Localized => ({ 'zh-Hans': hans, 'zh-Hant': hant });

// ── the match study (0t8xpyv6) ───────────────────────────────────────────────

/** The eight named games, keyed by the English reason the builder chose. */
const MATCH_REASONS: Record<string, Localized> = {
  "the tiger's sideways jump, then the den": pair(
    '虎的横向跳河，随后入穴',
    '虎的橫向跳河，隨後入穴',
  ),
  'the shortest win as red': pair('执红最短的胜局', '執紅最短的勝局'),
  'the shortest win as black': pair('执黑最短的胜局', '執黑最短的勝局'),
  'a sideways jump as red': pair('执红的一次横向跳河', '執紅的一次橫向跳河'),
  'the longest win': pair('最长的胜局', '最長的勝局'),
  'the shortest draw': pair('最短的和局', '最短的和局'),
  'the longest draw, a repetition grind': pair(
    '最长的和局，重复局面的消耗战',
    '最長的和局，重複局面的消耗戰',
  ),
  'the second-shortest win as black': pair('执黑第二短的胜局', '執黑第二短的勝局'),
};

export function matchReason(reason: string): Localized | null {
  const named = MATCH_REASONS[reason];
  if (named) return named;
  let m = /^KataGo wins as (red|black), (\d+) plies$/.exec(reason);
  if (m) {
    const red = m[1] === 'red';
    return pair(
      `KataGo 执${red ? '红' : '黑'}获胜，${m[2]} 步`,
      `KataGo 執${red ? '紅' : '黑'}獲勝，${m[2]} 步`,
    );
  }
  m = /^draw, (\d+) plies$/.exec(reason);
  if (m) return pair(`和局，${m[1]} 步`, `和局，${m[1]} 步`);
  return null;
}

export function matchChapterName(game: number, reason: string): Localized | null {
  const r = matchReason(reason);
  if (!r) return null;
  return pair(`第 ${game} 局：${r['zh-Hans']}`, `第 ${game} 局：${r['zh-Hant']}`);
}

const END_REASON: Record<string, Localized> = {
  'den-entered': pair('入穴', '入穴'),
  repetition: pair('三次重复局面', '三次重複局面'),
  'no-progress': pair('200 步无吃子', '200 步無吃子'),
  'pieces-captured': pair('吃光对方棋子', '吃光對方棋子'),
  stalemate: pair('无子可动', '無子可動'),
};

export type MatchCommentFacts = {
  reason: string;
  plies: number;
  kataSeat: 'red' | 'black';
  winner: 'katago' | 'misty' | null;
  result: 'red' | 'black' | 'draw';
  endReason: string;
  captures: number;
  sideways: { ply: number; uci: string; side: 'katago' | 'misty' }[];
};

export function matchChapterComment(f: MatchCommentFacts): Localized | null {
  const why = matchReason(f.reason);
  const end = END_REASON[f.endReason];
  if (!why || !end) return null;
  const build = (i: Script): string => {
    const t = i === 'zh-Hans';
    const red = t ? '红' : '紅';
    const black = t ? '黑' : '黑';
    const kata = f.kataSeat === 'red' ? red : black;
    const misty = f.kataSeat === 'red' ? black : red;
    const ending =
      f.winner === null
        ? `${f.plies} 步后以${end[i]}成和。`.replace('步后', t ? '步后' : '步後')
        : `${f.winner === 'katago' ? 'KataGo-AnimalChess' : 'MistyJungle 0.0.6'}（${
            f.result === 'red' ? red : black
          }方）在第 ${f.plies} 步以${end[i]}${t ? '获胜' : '獲勝'}。`;
    const jumps = f.sideways.length
      ? `${t ? '虎的横向跳河，也就是旧规则不允许的那一步' : '虎的橫向跳河，也就是舊規則不允許的那一步'}：${f.sideways
          .map(
            (j) =>
              `${j.uci}（${t ? '第' : '第'} ${j.ply} 步，${j.side === 'katago' ? 'KataGo' : 'Misty'}）`,
          )
          .join('、')}。`
      : t
        ? '本局没有出现虎的横向跳河。'
        : '本局沒有出現虎的橫向跳河。';
    return `${why[i]}。KataGo-AnimalChess ${t ? '执' : '執'}${kata}，MistyJungle ${
      t ? '执' : '執'
    }${misty}。${ending}共 ${f.captures} 次吃子。${jumps}`;
  };
  return pair(build('zh-Hans'), build('zh-Hant'));
}

export const MATCH_STUDY_I18N: Record<Script, { name: string; description: string }> = {
  'zh-Hans': {
    name: 'KataGo-AnimalChess 对 MistyJungle',
    description:
      'KataGo-AnimalChess（hzyhhzy、Kouza）是一个用于斗兽棋的自我对弈神经网络。在每着用时相同的条件下，它以 82 胜 0 负 118 和击败 MistyJungle，这里是全部 200 局。对局在 Mistboard 让虎拥有狮的横向跳河之后进行。八局有名字的排在最前，随后是其余对局，分出胜负的在前。',
  },
  'zh-Hant': {
    name: 'KataGo-AnimalChess 對 MistyJungle',
    description:
      'KataGo-AnimalChess（hzyhhzy、Kouza）是一個用於鬥獸棋的自我對弈類神經網路。在每著用時相同的條件下，牠以 82 勝 0 負 118 和擊敗 MistyJungle，這裡是全部 200 局。對局在 Mistboard 讓虎擁有獅的橫向跳河之後進行。八局有名字的排在最前，隨後是其餘對局，分出勝負的在前。',
  },
};

// ── the June benchmark study (xzzhAld5) ──────────────────────────────────────

/** The saved games' own result lines, which the builder uses as chapter names. */
const BENCHMARK_NAMES: Record<string, Localized> = {
  "MistyJungle wins, up 82 and a lion in red's den": pair(
    'MistyJungle 领先 82 分，狮入红方兽穴获胜',
    'MistyJungle 領先 82 分，獅入紅方獸穴獲勝',
  ),
  "MistyJungle reaches red's den after an 80-ply squeeze": pair(
    'MistyJungle 经过 80 步的挤压后进入红方兽穴',
    'MistyJungle 經過 80 步的擠壓後進入紅方獸穴',
  ),
  'MistyJungle wins the den race despite losing material': pair(
    'MistyJungle 子力落后，仍赢下入穴竞赛',
    'MistyJungle 子力落後，仍贏下入穴競賽',
  ),
  'MistyJungle grinds out a long red win and reaches the den': pair(
    'MistyJungle 执红磨出一盘长局，最终入穴',
    'MistyJungle 執紅磨出一盤長局，最終入穴',
  ),
  'Red converts a one-piece edge, lion into the den': pair(
    '红方兑现一子优势，狮入兽穴',
    '紅方兌現一子優勢，獅入獸穴',
  ),
  "Down 16 in material, red's rat reaches the den first": pair(
    '红方子力落后 16 分，鼠先一步入穴',
    '紅方子力落後 16 分，鼠先一步入穴',
  ),
  'MistyJungle converts a tablebase-won endgame': pair(
    'MistyJungle 兑现一个残局库判胜的局面',
    'MistyJungle 兌現一個殘局庫判勝的局面',
  ),
};

const BENCHMARK_EVENTS: Record<string, Localized> = {
  'MistyJungle (black) vs the strongest open-source engine I could run': pair(
    'MistyJungle（执黑）对我能运行的最强开源引擎',
    'MistyJungle（執黑）對我能執行的最強開源引擎',
  ),
  'Saved benchmark game: MistyJungle as black': pair(
    '保存的基准对局：MistyJungle 执黑',
    '保存的基準對局：MistyJungle 執黑',
  ),
  'Saved benchmark game: MistyJungle as red': pair(
    '保存的基准对局：MistyJungle 执红',
    '保存的基準對局：MistyJungle 執紅',
  ),
  'Saved benchmark game: long conversion': pair(
    '保存的基准对局：漫长的兑现',
    '保存的基準對局：漫長的兌現',
  ),
  'MistyJungle vs itself at 8M nodes per move': pair(
    'MistyJungle 以每着 800 万节点自我对弈',
    'MistyJungle 以每著 800 萬節點自我對弈',
  ),
  'MistyJungle converts a tablebase-won endgame': pair(
    'MistyJungle 兑现一个残局库判胜的局面',
    'MistyJungle 兌現一個殘局庫判勝的局面',
  ),
};

export function benchmarkChapterName(name: string): Localized | null {
  return BENCHMARK_NAMES[name] ?? null;
}

export function benchmarkComment(
  event: string,
  resultText: string,
  plies: number,
): Localized | null {
  const ev = BENCHMARK_EVENTS[event];
  const res = BENCHMARK_NAMES[resultText];
  if (!ev || !res) return null;
  return pair(
    `${ev['zh-Hans']}。${res['zh-Hans']}。共 ${plies} 步。对局在 2026 年 6 月进行，当时 Mistboard 上的虎只能纵向跳河。`,
    `${ev['zh-Hant']}。${res['zh-Hant']}。共 ${plies} 步。對局在 2026 年 6 月進行，當時 Mistboard 上的虎只能縱向跳河。`,
  );
}

export const BENCHMARK_STUDY_I18N: Record<Script, { name: string; description: string }> = {
  'zh-Hans': {
    name: 'MistyJungle 基准对局，2026 年 6 月',
    description:
      'brianhliou.com 上《斗兽棋：传统搜索击败学习型评估》一文所用的对局：MistyJungle 对上它能匹配到的最强传统引擎，以及它以每着 800 万节点自我对弈。对局采用 Mistboard 在 2026 年 9 月之前使用的虎只能纵向跳河的规则；按现行规则，每一步依然合法。',
  },
  'zh-Hant': {
    name: 'MistyJungle 基準對局，2026 年 6 月',
    description:
      'brianhliou.com 上《鬥獸棋：傳統搜尋擊敗學習型評估》一文所用的對局：MistyJungle 對上牠能匹配到的最強傳統引擎，以及牠以每著 800 萬節點自我對弈。對局採用 Mistboard 在 2026 年 9 月之前使用的虎只能縱向跳河的規則；按現行規則，每一步依然合法。',
  },
};
