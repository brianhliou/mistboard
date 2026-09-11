// Announcement localization (zh-Hans / zh-Hant).
//
// Model: the English entry in announcements.ts stays the single source of truth
// and is authored exactly as it is today. A localized render substitutes any
// headline, body, or CTA that appears as a key in the per-language dictionary;
// anything missing falls back to the English string, so a new announcement
// renders in English until it is translated rather than rendering blank.
//
// This mirrors article-i18n.ts deliberately, including its failure mode: editing
// an English string detaches its translation silently. The guard is the same,
// announcement-i18n.coverage.test.ts fails on an orphaned key, which forces the
// dictionary edit to ride along with the copy change.
//
// Variant names follow the play catalog exactly (variant.*.name), so a reader
// sees the same term in the feed and in the lobby.
import { hasOwnKey } from '@mistboard/game';
import type { Announcement } from './announcements.js';
import type { Locale } from './i18n/locale.js';

export type AnnouncementLang = Extract<Locale, 'zh-Hans' | 'zh-Hant'>;

// No native read stands behind any of this, and none is coming. Decided
// 2026-08-29: machine translation is the standard here, not a provisional state
// awaiting review, because a queue nobody can clear is not a queue. Ship the
// Chinese with the English rather than holding either.
//
// A consistency pass against the strings this site already publishes caught three
// of its own errors, all from translating in isolation instead of reusing the
// vocabulary next door: 评级 for a move judgment (the product says 评注/評註,
// per review.zh-*.ts), 回合 for a ply (a full move; the article says 半回合), and
// 方差 for "variance" (the published article renders the same sentence with
// 运气). When translating a new string here, grep article-i18n.ts and
// i18n/catalogs/*.zh-*.ts for the terms first: a native read is scarce, internal
// consistency is free, and it is the same class of error either way.
export const ANNOUNCEMENT_LANGS: AnnouncementLang[] = ['zh-Hans', 'zh-Hant'];

const ZH_HANS: Record<string, string> = {
  // ── 2026-09-11 (puzzles with more than one solution) ── 题目 / 将死 / 评分器 follow
  // article-i18n.ts for the same article.
  'Puzzles with more than one solution.': '有不止一个答案的题目。',
  'A solver found a real checkmate and the site told them to try again. The puzzle had two answers, and the grader knew one. Mate puzzles now follow the rule lichess settled on: every move of the solution must be the only mating move, except the last, where any mate counts. The 382 served puzzles that failed it are withdrawn, and the article walks through the position that started it.':
    '一位解题者找到了一个真正的将死，网站却让他再试一次。那道题有两个答案，而评分器只知道其中一个。将死题目现在采用 lichess 定下的规则：解法中的每一步都必须是唯一能将死的走法，最后一步除外，那一步任何将死都算。不符合这条规则的 382 道已上线题目已经撤下，文章从引发这件事的那个局面讲起。',
  // ── 2026-09-11 (statistics count visitor games) ── 统计 / 已完成对局 / 引擎对引擎的比赛 /
  // 测试对局 沿用 content.zh-hans.ts 的 stats.* 说法。
  'The statistics count visitor games only.': '统计只计入访客的对局。',
  'The games-played number on the home page and the statistics page now counts finished games between visitors, or a visitor and a bot, since the site opened in June. Engine matches, our own test games, and the games we played before anyone else had found the site are left out. That takes the number down to about a third of what it showed; the other two thirds was us.':
    '首页和统计页上的已完成对局数，现在只计入自六月网站上线以来访客之间、或访客与引擎之间已完成的对局。引擎对引擎的比赛、我们自己的测试对局，以及在还没有其他人发现这个网站之前我们自己下的棋，都不计入。这样一来，数字降到了原来所显示的三分之一左右；另外三分之二是我们自己。',
  'See the statistics': '查看统计',
  // ── 2026-09-11 (Duck Xiangqi launch) ── 蹩马腿 / 塞象眼 / 炮架 / 将帅照面 all
  // follow article-i18n.ts, and 鸭子象棋 follows variant.duckXiangqi.name.
  'Duck Xiangqi has launched.': '鸭子象棋已上线。',
  "Chinese chess with one duck that both players share. Make your move, then put the duck on any empty point. It blocks a horse's leg, an elephant's eye and the file between the generals, and it works as a cannon screen for whoever moves next, so the screen you build is never yours. There is no check: you win by capturing the general outright, and the two generals may now face each other down an open file, where flying the general is a capture. Play the eight-level bot or a friend.":
    '双方共用一只鸭子的象棋。先走一步棋，再把鸭子放到任意空点上。它能蹩马腿、塞象眼、挡住将帅之间的一路，也能给下一个走子的人当炮架，所以你搭的炮架永远不是给自己用的。这里没有将军：吃掉将帅才算赢；两位将帅也可以照面，此时飞将就是一步吃子。可挑战八级引擎或好友。',
  // ── 2026-09-11 (Elegant Pastime Manual) ── 残局 follows the app catalogs and the
  // study overlays; 古谱 is dpxq's own category word for these manuals.
  'All six volumes of the Elegant Pastime Manual are online.': '《适情雅趣》六卷已全部上线。',
  "The Elegant Pastime Manual is a Ming collection of xiangqi endgame compositions. Five hundred and forty-nine of its problems are here now, each on its own board, with the book's solution played out as the mainline and the original four-character title kept beside the English one. Around sixty are draw studies where the source gives its answer in prose rather than as a line, and those notes are quoted as written rather than guessed at. Positions come from dpxq.com and are credited on every composition. One problem is absent: the line recorded for number 479 stops being legal partway through, and half a solution is worse than none.":
    '《适情雅趣》是明代的一部象棋排局集。其中五百四十九局现已上线，每局独立成章，以书中着法作为主变，英文局名旁保留原四字标题。约六十局是和局类的排局，原书以文字而非着法给出答案，这些注文按原样引用，不作揣测。棋谱来源为 dpxq.com，每局均注明出处。另有一局缺席：第479局所记着法走到中途即不合规，而残缺的答案比没有更糟。',

  // ── 2026-09-06 (patron checkout) ── 沿用 08-13 条目的说法：「支持 Mistboard」页面、
  // 赞助、个人资料上的徽章、不影响对局；订阅 / 管理你的订阅 取自 content.zh-hans.ts。
  'Patron checkout is open.': '赞助结账已开放。',
  'The Support page takes monthly subscriptions now, at $5, $10, $20, or $50. A subscription puts a heart badge on your profile and does nothing else: no Patron-only content, no gameplay advantage. Core play and learning stay free and are meant to. Subscriptions pay for the servers and the development time. Cancel from the billing portal at any point and the period you already paid for runs out.':
    '「支持 Mistboard」页面现已开放每月订阅，金额为 5、10、20 或 50 美元。订阅只会在你的个人资料上加一枚心形徽章，除此之外没有别的：没有赞助者专属内容，也不影响对局。核心的对弈与学习功能始终免费，这是有意为之。订阅费用于支付服务器和开发时间。你可以随时在「管理你的订阅」处取消，已经付费的周期会走完。',
  'Become a Patron': '成为赞助者',
  // ── 2026-09-06 (practice endgames) ── 术语用棋界通行说法：残局、士象全、单车难破士象全。
  'Practice the basic endgames against the engine.': '与引擎对弈，练习基本残局。',
  'Thirty-two positions from the book endgames, each with a goal instead of a stored answer. The engine plays the defense and grades you on whether the win is still there after your move. A chariot cannot break the full defense and three soldiers can, which is the sort of claim you only believe after failing to prove it. Endgames come first because their verdicts are the part of xiangqi an English speaker has the least access to. More sets will follow.':
    '三十二个基本残局，每局只给目标，不给标准答案。引擎负责防守，并按你走完这一步之后胜势是否还在来评判。单车难破士象全，三兵却能破，这种结论只有在自己证明失败之后才会真正相信。先做残局，是因为这些定论正是英文读者最难接触到的部分。后面还会有更多。',
  'Try an exercise': '试做一题',
  // ── 2026-09-06 (Misty open source) ── 引擎名 Misty、包名 misty-chess 保持原文。
  'Misty is open source.': 'Misty 已开源。',
  'The Fog of War chess engine you play here is on GitHub under the GPL, and installs from PyPI as misty-chess. It is a build of the architecture behind Obscuro, the first superhuman Fog of War chess AI, whose own code was never released. The engine article now says how it works, what version 1.6 fixed, and what is still wrong with it.':
    '你在这里对弈的迷雾国际象棋引擎已以 GPL 协议发布在 GitHub 上，也可以从 PyPI 安装，包名是 misty-chess。它实现的是 Obscuro 背后的架构；Obscuro 是第一个达到超人水平的迷雾国际象棋 AI，其自身代码从未公开。引擎文章现在讲清楚了它如何工作、1.6 版修正了什么，以及它还有哪些问题。',
  'How Misty plays': 'Misty 如何思考',

  // ── 2026-09-04 (jieqi openings) ── 开局术语跟文章一致：仙人指路、炮二进四、揭子。
  'What strong jieqi players believe about the opening.': '强手眼中的揭棋开局。',
  'Jieqi has no opening book. What it has is an argument, running on Chinese forums for years among players with thousands of games, that has never appeared in English. Five first moves ranked, why a face-down piece is a one-shot option you can waste, and the pawn push weighed against the crossed cannon on all six things you might reveal. Our own fifty games disagree with the ranking, and the engine declines the list altogether.':
    '揭棋没有开局书。它有的是一场争论，多年来跑在中文论坛上，参与的人下过几千盘棋，而这场争论从未用英文写出来过。五个第一步的排名，为什么一个暗子是一次用掉就没有的权利，以及在你可能揭出的全部六种结果上，把仙人指路和炮二进四放在一起称一称。我们自己的五十盘棋并不同意这个排名，而引擎干脆连这份名单都不用。',

  // ── 2026-09-03 (jieqi platform, zh + vi) ── 揭子、复盘、分析棋盘 与文章用词一致。
  'What the site does with jieqi, on one page.': '这个站点为揭棋做的事，都在一页上。',
  'The jieqi page now says it in one place: play the engine or a friend, get a review that prices every flip separately from every choice you made, and run the same engine in your own browser on the analysis board. It reads in Simplified and Traditional Chinese too.':
    '揭棋页面现在把话说在一处：和引擎或朋友对弈，得到一份把每一次揭子的运气和你每一个选择分开计价的复盘，并在自己的浏览器里用同一个引擎打开分析棋盘。页面也有简体和繁体两版。',

  // ── 2026-09-03 (current games) ── 进行中的对局 is the nav label the
  // Watch menu renders (nav.currentGames), 通信对局 the correspondence
  // catalog's own word, 高级搜索 the renamed Tools entry (nav.gamesSearch).
  'Every game in progress, on one page.': '所有进行中的对局，都在一页上。',
  'Current games lists everything being played right now, across every variant: live games with their clocks, and correspondence games waiting on a move, each as a small board you can click into. Fog games appear as cards without a board until they end. When nothing is running, the page shows the open correspondence seeks and the most recent finished games instead. The games database moved to Advanced search under Tools.':
    '"进行中的对局"列出此刻正在进行的所有对局，涵盖每一种变体：带时钟的实时对局，以及等待走棋的通信对局，每局都是一张可以点进去的小棋盘。迷雾对局在结束前只显示为没有棋盘的卡片。没有对局进行时，页面转而显示公开的通信对局邀请和最近结束的对局。棋谱数据库移到了"工具"菜单下的"高级搜索"。',
  'See current games': '查看进行中的对局',

  // ── 2026-09-02 (embeds) ── 研习 / 题目 / 开发者 are the nav and footer
  // labels the site already renders (nav.studies, nav.puzzles,
  // footer.developers); Mistboard TV, iframe, API and OpenAPI stay in Latin.
  'Put a Mistboard board in your own page.': '把 Mistboard 的棋盘放进你自己的网页。',
  'Any finished game, Mistboard TV, the daily puzzle and the xiangqi analysis board now run inside an iframe, the way a study chapter already could. Copy a snippet from the developers page; no key needed. The read API behind the site is documented too, as an OpenAPI document at /api/openapi.json: games, watch feeds, puzzles, studies and the ladders.':
    '任何已结束的对局、Mistboard TV、每日题目和象棋分析棋盘，现在都能以 iframe 嵌入网页，和此前的研习章节一样。从开发者页面复制一段代码即可使用，无需密钥。网站背后的只读 API 也有了文档，以 OpenAPI 文档的形式发布在 /api/openapi.json：对局、观看列表、题目、研习和排行榜。',
  'See the developers page': '查看开发者页面',

  // ── 2026-09-02 ── 翻译 / 显示原文 / 机器翻译 are the exact labels the
  // forum buttons and badge render (forum.translate, forum.showOriginal,
  // forum.machineTranslation in the community catalog).
  'Read the forum in your language.': '用你的语言读论坛。',
  'Forum titles and posts written in Chinese now carry a Translate button for English readers, and English posts carry one for Chinese readers. A language model does the translating. The result is marked as machine translation, and one click brings the original back. Each post is translated once and then served from a cache, so the second reader never waits.':
    '中文写的论坛标题和帖子，现在为英文读者提供"翻译"按钮；英文帖子也为中文读者提供同样的按钮。翻译由语言模型完成，译文标为"机器翻译"，点一下就能切回原文。每个帖子只翻译一次，之后从缓存读取，第二位读者无需等待。',
  'Open the forum': '打开论坛',

  // ── 2026-09-01 ── 题目 is the site's own word for a puzzle
  // (nav.puzzles, puzzle.heading), 漏着 is the move judgment the review page
  // already prints for a blunder, and Pikafish stays in Latin as it does in the
  // engine entries below.
  'Where the puzzles come from.': '题目是怎么来的。',
  'Three thousand five hundred real games went through Pikafish looking for tactics. It found 10,503 blunders and published 1,211 of them. The whole pipeline is written up, including the parts that throw work away: two thirds of every blunder found dies because the position had more than one winning move, or because winning it took one obvious move.':
    '3,500 局真实对局交给 Pikafish 逐个局面搜索战术，找出 10,503 个漏着，最终发布了 1,211 道题。整条流水线都写下来了，包括被丢掉的那些部分：找到的漏着有三分之二会被淘汰，要么这个局面不止一种取胜着法，要么取胜只需一步显而易见的棋。',

  // ── 2026-09-01 ── 时限 matches the rated-games entry
  // below; 加每步五秒 is the increment as the site's own clocks read it.
  'A ten-minute clock, on every game.': '十分钟时限，每种棋都能选。',
  'Ten minutes with a five-second increment is now on the time control list for every variant, and xiangqi and jieqi start there. A full board runs thirty to forty moves a side, which three minutes does not cover. The faster paces are all still there.':
    '十分钟加每步五秒现已列入所有变体的时限选项，象棋和揭棋默认从这一档开始。整盘棋每方要走三四十步，三分钟不够用。原有的快棋时限都还在。',
  'Start a game': '开始一局',

  // ── 2026-08-30 ── Terms taken from the source the
  // games came from and from strings this site already publishes: 甲级联赛 and
  // 预选赛 are the event's own names, 台 is the board number inside a team
  // match (dpxq writes 第01台), 逐着浏览 matches the import announcement above.
  'Sixty-one games from the Division A qualifier.': '甲级联赛预选赛，六十一局。',
  "China's top xiangqi league runs its qualifier in Hangzhou every August, and this year's three rounds are now here to replay in English, with the club names and the players romanized. Ten clubs, four boards a match, and an engine a click away on any position. The league itself starts in September.":
    '中国象棋甲级联赛每年八月在杭州打预选赛，今年的三轮现在都可以在这里逐着浏览，队名和棋手名以英文呈现。十支队伍，每场四台，任意局面点一下就有引擎分析。联赛本身九月开赛。',
  'Open the qualifier': '打开预选赛',

  // ── 2026-08-29 ── Terms match the article's own
  // dictionary: 世界象棋锦标赛, 全国个人赛, 头衔.
  'The Xiangqi World Championship, and why it is not the senior title.':
    '世界象棋锦标赛，以及它为何不是最高头衔。',
  'Nineteen editions since 1990, eleven winners, and a title that stayed in China until last September. Every champion, an annotated game for ten of them, and the reason the Chinese national championship is the harder one to win.':
    '1990年以来十九届，十一位冠军，而这个头衔直到去年九月都留在中国。每一位冠军，其中十位各配一局讲解棋谱，以及中国全国个人赛为什么更难拿。',

  'Find a game': '找一局棋',
  // ── 2026-08-28 batch two ── Vocabulary taken from
  // strings this site already publishes, per the rule above: 复盘 is
  // watch.review, 妙手 is annotate.brilliantMove, 导入棋谱 is nav.import,
  // 棋谱 is nav.games, 论坛 is nav.forum.
  'Paste a game, get a board.': '粘贴一局棋，得到一张棋盘。',
  'Import takes a xiangqi game in whatever notation you happen to have: PGN, coordinates, WXF, or Chinese move text. It works out which one you pasted by replaying it, then hands you a browsable board with engine analysis. Nothing is published, and the game travels in the link.':
    '导入棋谱接受任何一种记谱法的象棋对局：PGN、坐标、WXF，或者「炮二平五」这样的中文着法。系统会把棋谱走一遍，据此判断你粘贴的是哪一种，然后给你一张可以逐着浏览、带引擎分析的棋盘。不会公开发布，整局棋都存在链接里。',
  'Import a game': '导入棋谱',
  'Brilliant moves are marked now.': '现在会标出妙手。',
  'Xiangqi review adds !! and ! beside the mistake glyphs it already showed. A move earns !! when you give material up and the engine agrees it does not come back. Blunders were never the only thing worth seeing in your own game.':
    '象棋复盘在原有的失误符号之外，新增了 !! 和 ! 。当你弃子而引擎认可这子确实收不回来时，这一着会被标为 !! 。自己的棋里值得看的，从来不只是漏着。',
  'Who Is the Greatest Xiangqi Player?': '谁是最伟大的象棋棋手？',
  'Nine hundred years of Chinese chess, and a championship only sixty-nine years old. Hu Ronghua, the men who came before the title existed, and the decade that was struck from the record.':
    '象棋有九百年历史，全国冠军赛却只有六十九年。胡荣华，在头衔出现之前的那些人，以及被从记录中抹去的十年。',

  // ── 2026-08-28 ── Vocabulary reused from strings the
  // site already publishes rather than translated in isolation: 视频库 is
  // videos.heading, 推荐 is the videos.sort.featured label.
  'A bigger video library, and one that reads Chinese.': '视频库更大了，也有了中文版。',
  'The library is up to 61 hand-picked videos, ordered best first instead of by the date they were added, and it now opens in Chinese at its own address. Every entry has been checked against YouTube, so nothing on the shelf is a dead link.':
    '视频库现有 61 个精选视频，改为按推荐程度排序，不再按收录日期排列，并且有了自己的中文网址。每个条目都已对照 YouTube 核对，库里不会有失效链接。',
  'Browse the library': '浏览视频库',
  // Copied verbatim from article-i18n.ts: the feed entry and the article
  // summary are the same sentence, and a reader who sees both should not get
  // two renderings of it.
  'Red’s opening cannon reaches the riverbank first, one move from firing down any of five files, and in fog you never see it coming. Whether that breaks the game came down to one elephant move, one poisoned defense, and a coin flip we priced with the engine.':
    '红方的起手炮抢先赶到河沿，只差一步就能沿五条纵线中的任何一条开火，而在迷雾里你根本看不见它的到来。这会不会毁掉整个棋种，最终落在一步飞象、一个有毒的防守，以及一次我们用引擎算清了价码的硬币对赌上。',

  // ── 2026-08-23 .. 2026-08-27 backfill ──
  'Set up any position, then share it.': '任意摆一个局面，然后分享出去。',
  'A head-to-head record on every finished game.': '每局终局都有对阵记录。',
  'Board coordinates, on every board that has them.': '棋盘坐标，凡是有坐标的棋盘都能显示。',
  'Follow a forum thread without refreshing it.': '关注论坛主题，不用反复刷新。',
  'Chess titles count for verification now.': '国际象棋头衔现在也可以认证。',
  'Studies read and write PGN.': '研习支持导入和导出 PGN。',
  'The Riverbank Cannon Problem.': '巡河炮问题。',
  'Puzzles are rated by how hard they play.': '题目难度改按实际难解程度评定。',
  'Pick a flair for your name.': '给你的名字挑一个个性图标。',
  'A board editor for eight variants: place pieces by hand, set the side to move, and hand the position straight to the analysis board. The analysis board also takes a FEN directly, and every position you build has its own link.':
    '八种变体都有了棋盘编辑器：手动摆子、指定轮谁走，再把局面直接交给分析棋盘。分析棋盘也可以直接读入 FEN，你摆出的每个局面都有自己的链接。',
  'The review page gains a Crosstable with your record against that opponent in that variant, engines included, and Share and export hands you the game as PGN or JSON.':
    '复盘页新增对阵表，显示你在该变体中与这位对手的交手记录，引擎也算在内；分享与导出可以把整局导出为 PGN 或 JSON。',
  'One switch in Display settings reaches the xiangqi family, the chess boards, jungle, and shogi. Xiangqi counts its files from each player’s own right, so the labels follow your move-notation setting and change sides when you flip the board.':
    '显示设置里的一个开关，现在管得到象棋系列、国际象棋类棋盘、斗兽棋和将棋。象棋的纵线从各自的右手边数起，所以标注会跟随你的着法记谱设置，并在翻转棋盘时换边。',
  'Watch a topic and the bell counts its unread replies. Quoting someone now tells them, and every source the bell reports has its own switch.':
    '关注一个主题，铃铛就会统计它的未读回复。引用他人现在也会通知对方，铃铛报告的每一类消息都有各自的开关。',
  'GM, IM, FM and the rest join the xiangqi titles. A verified title puts a badge beside your name wherever people are listed, and opens a coaching page students can find. Verification takes about two minutes.':
    'GM、IM、FM 等头衔加入了原有的象棋头衔。认证通过后，凡是列出棋手的地方，你的名字旁都会显示头衔徽章，并会开通一个学生能找到的教练页面。认证大约需要两分钟。',
  'Import a PGN to build a study, export one chapter or all of them, and add a finished game to a study from its link. The opening explorer sits beside the board while you work.':
    '导入 PGN 即可建立研习，可以导出单个章节或全部章节，也可以凭链接把一局终局加入研习。编写时，开局库就在棋盘旁边。',
  'A puzzle’s rating used to come from how many moves the mate took, which says little about how hard it is to find. It now comes from the position itself, so what you are served sits closer to your rating.':
    '题目的等级分以前取自杀棋的步数，而步数说明不了它有多难找。现在等级分来自局面本身，所以派给你的题目会更贴近你的水平。',
  'Choose a small icon that shows beside your handle across the site, from the variant markers and xiangqi characters the boards already use. The bell also reports new followers and incoming challenges now.':
    '从棋盘已经在用的变体标记和象棋棋子字中挑一个小图标，它会显示在全站你的用户名旁边。铃铛现在还会报告新的关注者和收到的挑战。',
  'Open the editor': '打开编辑器',
  'Open settings': '打开设置',
  'Edit your profile': '编辑资料页',
  // ── headlines ──
  'Both house bots play stronger.': '两台自家引擎都变强了。',
  'Four times as many xiangqi puzzles.': '象棋题目增至四倍。',
  'Move badges and best lines on every reviewable variant.':
    '所有支持复盘的棋类都有着法评注与最佳变化。',
  'Separating skill from luck in flip games.': '在翻子棋中区分棋力与运气。',
  'What Patron support will cost.': '赞助 Mistboard 的价格。',
  'A games database for xiangqi.': '象棋对局库。',
  'Perpetual check now loses in standard xiangqi.': '标准象棋中长将判负。',
  'Mistboard works on a phone.': 'Mistboard 已适配手机。',
  'Every composition has its own page.': '每则排局都有独立页面。',
  'Mistboard reads in Chinese.': 'Mistboard 已支持中文。',
  'Rated games at every time control.': '各种时限都可下等级分对局。',
  'An opening explorer for xiangqi.': '象棋开局库。',
  'Rated xiangqi is live.': '等级分象棋已上线。',
  'Secret in the Tangerine, both game volumes.': '《橘中秘》全部对局卷。',
  'Classical xiangqi, from the original woodblocks.': '古谱象棋，源自原始刻本。',
  'Correspondence play has launched.': '通信对局已上线。',
  'An analysis board for every game.': '每种棋类都有分析棋盘。',
  'Studies have launched.': '研习已上线。',
  'Mistboard TV is live.': 'Mistboard 电视已上线。',
  'Learn xiangqi from scratch.': '从零开始学象棋。',
  'Xiangqi puzzles have launched.': '象棋题目已上线。',
  'Xiangqi has launched.': '象棋已上线。',
  'Forum and global chat have launched.': '论坛与全站聊天已上线。',
  'Fortress has launched.': '堡垒象棋已上线。',
  'Read the updated rules': '阅读更新后的规则',
  'Storm the Fortress: the Soldier crosses the river again.': '堡垒象棋：兵重新需要过河。',
  'Two rule changes. The Soldier goes back to the xiangqi rule it should always have had: one point forward on your own half, and the sideways step only once it has crossed the river. Crossing is the commitment it costs something to make. The Treasure now stays home for good, moving and dropping only on its own half, so the piece you are storming for cannot parachute into the fight. Engine self-play across five rule sets and a thousand games says the Soldier is what makes this game sharp: draws fall from 34% to 9% and a typical game runs half again as long.':
    '两项规则改动。兵回到象棋本来的走法：在己方半场每次只向前走一点，过河之后才获得横走。过河是一次要付出代价的决断。宝从此留在家中，走子和打入都只限己方半场，被围攻的目标不能再空降到战场上。跨五套规则、上千局的引擎自战表明，真正让这个棋种变得锋利的是兵：和棋率从 34% 降到 9%，一局的长度增加约一半。',
  'Jungle Chess has launched.': '斗兽棋已上线。',
  'Flip Jungle has launched.': '翻翻棋已上线。',
  'Drop Mini Xiangqi has launched.': '投放迷你象棋已上线。',
  'Dark Crazyhouse has launched.': '迷雾疯狂屋已上线。',
  'Dark Crossroads Chess has launched.': '迷雾十字路口国际象棋已上线。',
  'Fog Shogi has launched.': '迷雾将棋已上线。',
  'Kriegspiel is open for alpha play.': '裁判棋已开放内测对局。',
  'Reveal Chess is open for alpha play.': '翻开国际象棋已开放内测对局。',
  'Fog Xiangqi is open for alpha play.': '迷雾象棋已开放内测对局。',
  'Banqi is open for alpha play.': '暗棋已开放内测对局。',
  'Jieqi is open for alpha play.': '揭棋已开放内测对局。',
  'Crossroads Chess has launched.': '十字路口国际象棋已上线。',
  'Fog Chess is open for alpha play.': '迷雾国际象棋已开放内测对局。',
  'Mistboard is in alpha.': 'Mistboard 处于内测阶段。',
  'Dark Mini Xiangqi is open for alpha play.': '迷雾迷你象棋已开放内测对局。',
  'Misty 1.0 has launched.': 'Misty 1.0 已上线。',

  // ── bodies ──
  'Misty runs version 1.6 in fog chess, which closes a queen hang it used to walk into. Pikafish now searches jieqi to full depth; it had been stopping early, which made it easier to beat than it should have been.':
    '迷雾国际象棋中的 Misty 已升级到 1.6 版，修正了以往会送后的一类失误。揭棋中的 Pikafish 现在会搜索到完整深度；此前它过早停止搜索，因此比应有的水平更容易被击败。',
  'The standard xiangqi set goes from 394 puzzles to 1,605, every one mined from a finished game and checked by the engine before it ships.':
    '标准象棋题库从 394 题增加到 1,605 题，每一题都取自已结束的对局，并在上线前经过引擎校验。',
  'The move-judgment badge now sits on the board for all six variants with analysis, not xiangqi alone, and a blunder names the move that refutes it. Jieqi reveal plies get the ranked candidates the engine scored instead of a line, since nothing past a flip is knowable.':
    '着法评注标记现在会显示在全部六种支持分析的棋类棋盘上，不再只有象棋，漏着还会指出反驳它的具体着法。揭棋的翻子半回合不再给出变化，而是列出引擎评分后的候选着法排名，因为翻子之后的局面无法预知。',
  'Half the moves in banqi, jieqi, and flip jungle are dice rolls, so a chess-style review blames you for variance. Game review splits every flip into the decision you made and the tile you got, and the article runs that over 52 human-versus-engine games.':
    '暗棋、揭棋和翻翻棋里，一半的着法其实是掷骰子，照搬国际象棋的复盘就会把运气算到你头上。对局复盘把每次翻子拆成你做的决策和你翻到的棋子，文章用 52 盘人机对局验证了这一点。',
  'The Support page lists the monthly amounts, what they include (a profile badge, no gameplay advantage), and the billing and refund terms in full. Checkout is not open yet.':
    '「支持 Mistboard」页面列出了每月的赞助金额、包含的内容（个人资料上的徽章，不影响对局），以及完整的计费与退款条款。结账尚未开放。',
  'Search finished games from three sources in one place: the historical corpus, the tournament boards we broadcast, and games played here.':
    '在同一处检索三个来源的已结束对局：历史棋谱库、我们直播的赛事棋盘，以及在本站下的对局。',
  'Repeating a check forever used to draw. The checker has to vary or lose the game, which is how the published rulesets score it and how the course has always taught it.':
    '此前一直重复将军会判和。现在长将的一方必须变着，否则判负，这与公布的规则以及本站课程一贯的讲法一致。',
  'Every page was swept at phone width: a full-size live board, lobby rows that still name the variant, and real touch targets on the controls you tap.':
    '每个页面都按手机宽度检查过：对局棋盘完整显示，大厅列表仍标明棋类，常用控件也有足够大的触控区域。',
  'Each endgame composition in the library is a page you can link to, and sharing one previews its own diagram rather than the site card.':
    '棋谱库中的每则排局都有可分享的链接，分享时预览的是该局自己的棋图，而不是站点的通用卡片。',
  'Playing, watching, the forum, and the xiangqi rules pages are all available in Simplified and Traditional Chinese. Switch languages in the settings menu.':
    '对局、观战、论坛和象棋规则页面均已提供简体中文与繁体中文。可在设置菜单中切换语言。',
  'Bullet, blitz, and rapid each keep their own rating now, instead of rated meaning 3+2 only. Correspondence stays casual on purpose.':
    '子弹、闪电和快速各自记录独立的等级分，不再只有 3+2 才算等级分对局。通信对局仍然只计休闲，这是有意为之。',
  'Open any position on the analysis board and see what has been played from it, with example games to study and the corpus it came from named on the panel.':
    '在分析棋盘上打开任意局面，即可看到从这里走出的着法统计，附示例对局，面板上也注明了数据出自哪个棋谱库。',
  'Choose Rated in the lobby. Your rating starts at 1500 and appears after it settles.':
    '在大厅选择「等级分」。等级分从 1500 起算，稳定后显示。',
  'Both volumes are playable move by move in English: 33 games with every printed variation.':
    '两卷都可用英文逐着打谱：33 局对弈，含书中全部变着。',
  'Read the earliest printings move by move, with every corrected misprint marked on the board.':
    '逐着阅读最早的刻本，所有勘正的讹误都标注在棋盘上。',
  'Post or accept a days-per-move seek, or send a friend a challenge link and play at your own pace.':
    '发布或接受「每着若干天」的约战，也可以把挑战链接发给好友，按自己的节奏下棋。',
  'Set up any position, import moves, run a local evaluation, or grade a finished game with server analysis.':
    '摆任意局面、导入着法、在本地运行评估，或用服务器分析为已结束的对局评分。',
  'Build shareable analysis boards: draw on the board, comment, branch variations, organize chapters, and publish interactive gamebook lessons.':
    '搭建可分享的分析棋盘：在盘面标注、写评注、分出变着、整理章节，并发布可互动的教学课程。',
  'Watch live games on the new Watch page, with a channel for every game and an Engines channel for bot-versus-bot matches.':
    '在新的「观战」页面看直播对局，每种棋类都有频道，另有引擎频道播放机器人之间的对弈。',
  'A free interactive course: 20 stages and 111 hands-on levels take you from how each piece moves to the named checkmate patterns.':
    '免费的互动课程：20 个阶段、111 个实操关卡，从每个棋子怎么走一直讲到有名的杀法。',
  'Tactics mined from real games, with puzzle ratings, hints, and a daily puzzle on the homepage.':
    '从真实对局中挖掘的战术题，配有题目等级分、提示，首页还有每日一题。',
  'Standard Chinese chess on the full 9 by 10 board is now first-class on Mistboard: play the Pikafish engine at three strengths, or challenge a friend.':
    '9×10 全盘的标准象棋已成为 Mistboard 的主要棋类：可与三档强度的 Pikafish 引擎对弈，也可以邀请好友。',
  'The forum is open for game analysis, engine talk, and site feedback, with the homepage global chat available for quick table-talk during live sessions.':
    '论坛已开放，可用于复盘、讨论引擎和反馈站点问题；首页的全站聊天则方便在对局时随口交流。',
  'Xiangqi with a pocket: every piece moves as in Chinese chess, plus crazyhouse-style drops and the new Treasure. Play the bot or challenge a friend.':
    '带手牌的象棋：所有棋子走法与象棋相同，另加疯狂屋式的打入和新增的「宝」。可与机器人对弈或邀请好友。',
  'Rank-based animal chess on a 7 by 9 board with rivers, dens, and traps is live. Challenge a friend or take on the Misty Jungle engine.':
    '按等级吃子的动物棋，7×9 棋盘，有河流、兽穴和陷阱，现已上线。可邀请好友，或挑战 Misty Jungle 引擎。',
  'Every animal starts face-down on a 4 by 4 board and flips as you play. Challenge a friend or the engine.':
    '4×4 棋盘上所有动物开局均背面朝上，边下边翻。可邀请好友或与引擎对弈。',
  'The 7 by 7 reserve fight is live with no enemy-palace drops, a full rules page, and a 114-ply FSF sample game to study.':
    '7×7 的手牌之争已上线：不可打入敌方九宫，附完整规则页，以及一局 114 着的 FSF 示例对局可供研究。',
  'Crazyhouse under Fog of War is now live for invite games, with private hands, captured pieces entering reserve, and drops into the fog.':
    '迷雾下的疯狂屋已开放邀请对局：手牌不公开，被吃的棋子进入手牌，并可打入迷雾之中。',
  'Crossroads Chess under Fog of War is now live for invite games, with hidden enemy pieces, no check warnings, and the far-rank Try.':
    '迷雾下的十字路口国际象棋已开放邀请对局：敌方棋子隐藏，没有将军提示，并保留冲到底线的「触阵」胜法。',
  'Shogi under Fog of War is now live for invite games, with private hands, drops into the fog, and king capture wins.':
    '迷雾下的将棋已开放邀请对局：手牌不公开，可打入迷雾，擒王即胜。',
  'The original hidden-information chess: see only your own pieces, try moves through the umpire, and challenge a friend to a match.':
    '最早的隐藏信息国际象棋：只看得见自己的棋子，通过裁判试着法，可邀请好友对局。',
  'Standard chess with a hidden starting arrangement: every piece but the king begins face-down and reveals its true identity the moment it moves. Challenge a friend to a match.':
    '开局摆法隐藏的国际象棋：除王以外的棋子开局均背面朝上，一走动就亮明真实身份。可邀请好友对局。',
  'Fog of War on the full 9 by 10 xiangqi board: each side sees only the points its pieces reach. Challenge a friend to a match.':
    '9×10 全盘象棋上的迷雾：每一方只看得见自己棋子能到达的点位。可邀请好友对局。',
  'Banqi on an 8 by 4 board: all 32 pieces start face-down and flip as you play. Challenge a friend to a match.':
    '8×4 棋盘上的暗棋：32 枚棋子开局均背面朝上，边下边翻。可邀请好友对局。',
  'Hidden-identity xiangqi: every non-general piece starts face-down and reveals as it moves. Take on PikaJieQi, our jieqi engine.':
    '隐藏身份的象棋：除将帅外的棋子开局均背面朝上，走动时翻开。可挑战我们的揭棋引擎 PikaJieQi。',
  'A 6 by 8 chess-xiangqi variant with checkmate and king-race wins is now live on Mistboard.':
    '融合国际象棋与象棋的 6×8 变体已在 Mistboard 上线，可将死取胜，也可比拼王的冲刺。',
  'Fog of War chess is live on Mistboard, with private vision, no check warnings, and king capture wins.':
    '迷雾国际象棋已在 Mistboard 上线：视野不公开，没有将军提示，擒王即胜。',
  'Casual dark chess is open. Rated beta is coming.': '休闲迷雾棋已开放，等级分公测即将推出。',
  'A smaller Fog of War variant on a 7 by 7 xiangqi board, with Misty engine support.':
    '7×7 象棋棋盘上的小型迷雾变体，支持 Misty 引擎。',
  'Our Fog of War dark chess engine is now live to play.': '我们的迷雾国际象棋引擎现已开放对弈。',

  // ── CTA labels ──
  'Search the games': '检索对局',
  'See the amounts': '查看赞助金额',
  'See the leaderboard': '查看排行榜',
  'Open volume one': '打开第一卷',
  'Browse the studies': '浏览研习',
  'Read the article': '阅读文章',
  'Open the board': '打开棋盘',
  'Browse studies': '浏览研习',
  'Watch now': '立即观战',
  'Start the course': '开始课程',
  'Solve puzzles': '做题',
  'Study the rules': '研读规则',
  'Join the forum': '加入论坛',
  'Read rules': '阅读规则',
  'Send feedback': '反馈意见',
  'Play the engine': '与引擎对弈',
};

const ZH_HANT: Record<string, string> = {
  // ── 2026-09-11 (puzzles with more than one solution) ── 題目 / 將死 / 評分器 follow
  // article-i18n.ts for the same article.
  'Puzzles with more than one solution.': '有不止一個答案的題目。',
  'A solver found a real checkmate and the site told them to try again. The puzzle had two answers, and the grader knew one. Mate puzzles now follow the rule lichess settled on: every move of the solution must be the only mating move, except the last, where any mate counts. The 382 served puzzles that failed it are withdrawn, and the article walks through the position that started it.':
    '一位解題者找到了一個真正的將死，網站卻讓他再試一次。那道題有兩個答案，而評分器只知道其中一個。將死題目現在採用 lichess 定下的規則：解法中的每一步都必須是唯一能將死的走法，最後一步除外，那一步任何將死都算。不符合這條規則的 382 道已上線題目已經撤下，文章從引發這件事的那個局面講起。',
  // ── 2026-09-11 (statistics count visitor games) ── 統計 / 已完成對局 / 引擎對引擎的比賽 /
  // 測試對局 沿用 content.zh-hant.ts 的 stats.* 說法。
  'The statistics count visitor games only.': '統計只計入訪客的對局。',
  'The games-played number on the home page and the statistics page now counts finished games between visitors, or a visitor and a bot, since the site opened in June. Engine matches, our own test games, and the games we played before anyone else had found the site are left out. That takes the number down to about a third of what it showed; the other two thirds was us.':
    '首頁和統計頁上的已完成對局數，現在只計入自六月網站上線以來訪客之間、或訪客與引擎之間已完成的對局。引擎對引擎的比賽、我們自己的測試對局，以及在還沒有其他人發現這個網站之前我們自己下的棋，都不計入。這樣一來，數字降到了原來所顯示的三分之一左右；另外三分之二是我們自己。',
  'See the statistics': '查看統計',
  // ── 2026-09-11 (Duck Xiangqi launch) ── see the ZH_HANS note above.
  'Duck Xiangqi has launched.': '鴨子象棋已上線。',
  "Chinese chess with one duck that both players share. Make your move, then put the duck on any empty point. It blocks a horse's leg, an elephant's eye and the file between the generals, and it works as a cannon screen for whoever moves next, so the screen you build is never yours. There is no check: you win by capturing the general outright, and the two generals may now face each other down an open file, where flying the general is a capture. Play the eight-level bot or a friend.":
    '雙方共用一隻鴨子的象棋。先走一步棋，再把鴨子放到任意空點上。它能蹩馬腿、塞象眼、擋住將帥之間的一路，也能給下一個走子的人當炮架，所以你搭的炮架永遠不是給自己用的。這裡沒有將軍：吃掉將帥才算贏；兩位將帥也可以照面，此時飛將就是一步吃子。可挑戰八級引擎或好友。',
  // ── 2026-09-11 (Elegant Pastime Manual) ──
  'All six volumes of the Elegant Pastime Manual are online.': '《適情雅趣》六卷已全部上線。',
  "The Elegant Pastime Manual is a Ming collection of xiangqi endgame compositions. Five hundred and forty-nine of its problems are here now, each on its own board, with the book's solution played out as the mainline and the original four-character title kept beside the English one. Around sixty are draw studies where the source gives its answer in prose rather than as a line, and those notes are quoted as written rather than guessed at. Positions come from dpxq.com and are credited on every composition. One problem is absent: the line recorded for number 479 stops being legal partway through, and half a solution is worse than none.":
    '《適情雅趣》是明代的一部象棋排局集。其中五百四十九局現已上線，每局獨立成章，以書中著法作為主變，英文局名旁保留原四字標題。約六十局是和局類的排局，原書以文字而非著法給出答案，這些註文按原樣引用，不作揣測。棋譜來源為 dpxq.com，每局均註明出處。另有一局缺席：第479局所記著法走到中途即不合規，而殘缺的答案比沒有更糟。',

  // ── 2026-09-06 (patron checkout) ── 沿用 08-13 條目的說法：「支持 Mistboard」頁面、
  // 贊助、個人資料上的徽章、不影響對局；訂閱 / 管理你的訂閱 取自 content.zh-hant.ts。
  'Patron checkout is open.': '贊助結帳已開放。',
  'The Support page takes monthly subscriptions now, at $5, $10, $20, or $50. A subscription puts a heart badge on your profile and does nothing else: no Patron-only content, no gameplay advantage. Core play and learning stay free and are meant to. Subscriptions pay for the servers and the development time. Cancel from the billing portal at any point and the period you already paid for runs out.':
    '「支持 Mistboard」頁面現已開放每月訂閱，金額為 5、10、20 或 50 美元。訂閱只會在你的個人資料上加一枚心形徽章，除此之外沒有別的：沒有贊助者專屬內容，也不影響對局。核心的對弈與學習功能始終免費，這是有意為之。訂閱費用於支付伺服器和開發時間。你可以隨時在「管理你的訂閱」處取消，已經付費的週期會走完。',
  'Become a Patron': '成為贊助者',
  // ── 2026-09-06 (practice endgames) ── 術語用棋界通行說法：殘局、士象全、單車難破士象全。
  'Practice the basic endgames against the engine.': '與引擎對弈，練習基本殘局。',
  'Thirty-two positions from the book endgames, each with a goal instead of a stored answer. The engine plays the defense and grades you on whether the win is still there after your move. A chariot cannot break the full defense and three soldiers can, which is the sort of claim you only believe after failing to prove it. Endgames come first because their verdicts are the part of xiangqi an English speaker has the least access to. More sets will follow.':
    '三十二個基本殘局，每局只給目標，不給標準答案。引擎負責防守，並按你走完這一步之後勝勢是否還在來評判。單車難破士象全，三兵卻能破，這種結論只有在自己證明失敗之後才會真正相信。先做殘局，是因為這些定論正是英文讀者最難接觸到的部分。後面還會有更多。',
  'Try an exercise': '試做一題',
  // ── 2026-09-06 (Misty open source) ── 引擎名 Misty、套件名 misty-chess 保持原文。
  'Misty is open source.': 'Misty 已開源。',
  'The Fog of War chess engine you play here is on GitHub under the GPL, and installs from PyPI as misty-chess. It is a build of the architecture behind Obscuro, the first superhuman Fog of War chess AI, whose own code was never released. The engine article now says how it works, what version 1.6 fixed, and what is still wrong with it.':
    '你在這裡對弈的迷霧國際象棋引擎已以 GPL 授權發布在 GitHub 上，也可以從 PyPI 安裝，套件名稱是 misty-chess。它實作的是 Obscuro 背後的架構；Obscuro 是第一個達到超人水準的迷霧國際象棋 AI，其自身程式碼從未公開。引擎文章現在講清楚了它如何運作、1.6 版修正了什麼，以及它還有哪些問題。',
  'How Misty plays': 'Misty 如何思考',

  // ── 2026-09-04 (jieqi openings) ── 開局術語與文章一致：仙人指路、炮二進四、揭子。
  'What strong jieqi players believe about the opening.': '強手眼中的揭棋開局。',
  'Jieqi has no opening book. What it has is an argument, running on Chinese forums for years among players with thousands of games, that has never appeared in English. Five first moves ranked, why a face-down piece is a one-shot option you can waste, and the pawn push weighed against the crossed cannon on all six things you might reveal. Our own fifty games disagree with the ranking, and the engine declines the list altogether.':
    '揭棋沒有開局書。它有的是一場爭論，多年來跑在中文論壇上，參與的人下過幾千盤棋，而這場爭論從未用英文寫出來過。五個第一步的排名，為什麼一個暗子是一次用掉就沒有的權利，以及在你可能揭出的全部六種結果上，把仙人指路和炮二進四放在一起稱一稱。我們自己的五十盤棋並不同意這個排名，而引擎乾脆連這份名單都不用。',

  // ── 2026-09-03 (jieqi platform, zh + vi) ── 揭子、複盤、分析棋盤 與文章用詞一致。
  'What the site does with jieqi, on one page.': '這個站點為揭棋做的事，都在一頁上。',
  'The jieqi page now says it in one place: play the engine or a friend, get a review that prices every flip separately from every choice you made, and run the same engine in your own browser on the analysis board. It reads in Simplified and Traditional Chinese too.':
    '揭棋頁面現在把話說在一處：和引擎或朋友對弈，得到一份把每一次揭子的運氣和你每一個選擇分開計價的複盤，並在自己的瀏覽器裡用同一個引擎打開分析棋盤。頁面也有簡體和繁體兩版。',

  // ── 2026-09-03 (current games) ── Traditional forms of the Simplified
  // entry above: 進行中的對局 (nav.currentGames), 通訊對局, 進階搜尋.
  'Every game in progress, on one page.': '所有進行中的對局，都在一頁上。',
  'Current games lists everything being played right now, across every variant: live games with their clocks, and correspondence games waiting on a move, each as a small board you can click into. Fog games appear as cards without a board until they end. When nothing is running, the page shows the open correspondence seeks and the most recent finished games instead. The games database moved to Advanced search under Tools.':
    '「進行中的對局」列出此刻正在進行的所有對局，涵蓋每一種變體：帶時鐘的即時對局，以及等待走棋的通訊對局，每局都是一張可以點進去的小棋盤。迷霧對局在結束前只顯示為沒有棋盤的卡片。沒有對局進行時，頁面轉而顯示公開的通訊對局邀請和最近結束的對局。棋譜資料庫移到了「工具」選單下的「進階搜尋」。',
  'See current games': '查看進行中的對局',

  // ── 2026-09-02 (embeds) ── Same terms as the Simplified entry above, in
  // the Traditional forms the site renders: 研習 / 題目 / 開發者.
  'Put a Mistboard board in your own page.': '把 Mistboard 的棋盤放進你自己的網頁。',
  'Any finished game, Mistboard TV, the daily puzzle and the xiangqi analysis board now run inside an iframe, the way a study chapter already could. Copy a snippet from the developers page; no key needed. The read API behind the site is documented too, as an OpenAPI document at /api/openapi.json: games, watch feeds, puzzles, studies and the ladders.':
    '任何已結束的對局、Mistboard TV、每日題目和象棋分析棋盤，現在都能以 iframe 嵌入網頁，和此前的研習章節一樣。從開發者頁面複製一段程式碼即可使用，無需金鑰。網站背後的唯讀 API 也有了文件，以 OpenAPI 文件的形式發布在 /api/openapi.json：對局、觀看列表、題目、研習和排行榜。',
  'See the developers page': '查看開發者頁面',

  // ── 2026-09-02 ── Same terms as the Simplified entry above, in the
  // Traditional forms the forum buttons render: 翻譯 / 顯示原文 / 機器翻譯.
  'Read the forum in your language.': '用你的語言讀論壇。',
  'Forum titles and posts written in Chinese now carry a Translate button for English readers, and English posts carry one for Chinese readers. A language model does the translating. The result is marked as machine translation, and one click brings the original back. Each post is translated once and then served from a cache, so the second reader never waits.':
    '中文寫的論壇標題和帖子，現在為英文讀者提供「翻譯」按鈕；英文帖子也為中文讀者提供同樣的按鈕。翻譯由語言模型完成，譯文標為「機器翻譯」，點一下就能切回原文。每個帖子只翻譯一次，之後從快取讀取，第二位讀者無需等待。',
  'Open the forum': '開啟論壇',

  // ── 2026-09-01 ── Same terms as the Simplified entry
  // above, in the Traditional forms this site publishes: 題目 and 漏著.
  'Where the puzzles come from.': '題目是怎麼來的。',
  'Three thousand five hundred real games went through Pikafish looking for tactics. It found 10,503 blunders and published 1,211 of them. The whole pipeline is written up, including the parts that throw work away: two thirds of every blunder found dies because the position had more than one winning move, or because winning it took one obvious move.':
    '3,500 局真實對局交給 Pikafish 逐個局面搜尋戰術，找出 10,503 個漏著，最終發布了 1,211 道題。整條流水線都寫下來了，包括被丟掉的那些部分：找到的漏著有三分之二會被淘汰，要麼這個局面不止一種取勝著法，要麼取勝只需一步顯而易見的棋。',

  // ── 2026-09-01 ── Same terms as the Simplified entry above.
  'A ten-minute clock, on every game.': '十分鐘時限，每種棋都能選。',
  'Ten minutes with a five-second increment is now on the time control list for every variant, and xiangqi and jieqi start there. A full board runs thirty to forty moves a side, which three minutes does not cover. The faster paces are all still there.':
    '十分鐘加每步五秒現已列入所有變體的時限選項，象棋和揭棋預設從這一檔開始。整盤棋每方要走三四十步，三分鐘不夠用。原有的快棋時限都還在。',
  'Start a game': '開始一局',

  // ── 2026-08-30 ── Same terms as the Simplified
  // entry above.
  'Sixty-one games from the Division A qualifier.': '甲級聯賽預選賽，六十一局。',
  "China's top xiangqi league runs its qualifier in Hangzhou every August, and this year's three rounds are now here to replay in English, with the club names and the players romanized. Ten clubs, four boards a match, and an engine a click away on any position. The league itself starts in September.":
    '中國象棋甲級聯賽每年八月在杭州打預選賽，今年的三輪現在都可以在這裡逐著瀏覽，隊名和棋手名以英文呈現。十支隊伍，每場四台，任意局面點一下就有引擎分析。聯賽本身九月開賽。',
  'Open the qualifier': '打開預選賽',

  // ── 2026-08-29 ── Same terms as the article's
  // Traditional dictionary.
  'The Xiangqi World Championship, and why it is not the senior title.':
    '世界象棋錦標賽，以及它為何不是最高頭銜。',
  'Nineteen editions since 1990, eleven winners, and a title that stayed in China until last September. Every champion, an annotated game for ten of them, and the reason the Chinese national championship is the harder one to win.':
    '1990年以來十九屆，十一位冠軍，而這個頭銜直到去年九月都留在中國。每一位冠軍，其中十位各配一局講解棋譜，以及中國全國個人賽為什麼更難拿。',

  // ── 2026-08-28 batch two ── Same vocabulary rule:
  // 復盤 is watch.review, 妙手 is annotate.brilliantMove, 匯入棋譜 is
  // nav.import, 棋譜 is nav.games, 論壇 is nav.forum.
  'Paste a game, get a board.': '貼上一局棋，得到一張棋盤。',
  'Import takes a xiangqi game in whatever notation you happen to have: PGN, coordinates, WXF, or Chinese move text. It works out which one you pasted by replaying it, then hands you a browsable board with engine analysis. Nothing is published, and the game travels in the link.':
    '匯入棋譜接受任何一種記譜法的象棋對局：PGN、座標、WXF，或者「炮二平五」這樣的中文著法。系統會把棋譜走一遍，據此判斷你貼上的是哪一種，然後給你一張可以逐著瀏覽、帶引擎分析的棋盤。不會公開發布，整局棋都存在連結裡。',
  'Import a game': '匯入棋譜',
  'Brilliant moves are marked now.': '現在會標出妙手。',
  'Xiangqi review adds !! and ! beside the mistake glyphs it already showed. A move earns !! when you give material up and the engine agrees it does not come back. Blunders were never the only thing worth seeing in your own game.':
    '象棋復盤在原有的失誤符號之外，新增了 !! 和 ! 。當你棄子而引擎認可這子確實收不回來時，這一著會被標為 !! 。自己的棋裡值得看的，從來不只是漏著。',
  'Find a game': '找一局棋',
  'Who Is the Greatest Xiangqi Player?': '誰是最偉大的象棋棋手？',
  'Nine hundred years of Chinese chess, and a championship only sixty-nine years old. Hu Ronghua, the men who came before the title existed, and the decade that was struck from the record.':
    '象棋有九百年歷史，全國冠軍賽卻只有六十九年。胡榮華，在頭銜出現之前的那些人，以及被從記錄中抹去的十年。',

  // ── 2026-08-28 ── Same vocabulary rule: 影片庫 is
  // videos.heading, 推薦 is the videos.sort.featured label.
  'A bigger video library, and one that reads Chinese.': '影片庫更大了，也有了中文版。',
  'The library is up to 61 hand-picked videos, ordered best first instead of by the date they were added, and it now opens in Chinese at its own address. Every entry has been checked against YouTube, so nothing on the shelf is a dead link.':
    '影片庫現有 61 部精選影片，改為按推薦程度排序，不再按收錄日期排列，並且有了自己的中文網址。每個項目都已對照 YouTube 核對，庫裡不會有失效連結。',
  'Browse the library': '瀏覽影片庫',
  // Copied verbatim from article-i18n.ts: the feed entry and the article
  // summary are the same sentence, and a reader who sees both should not get
  // two renderings of it.
  'Red’s opening cannon reaches the riverbank first, one move from firing down any of five files, and in fog you never see it coming. Whether that breaks the game came down to one elephant move, one poisoned defense, and a coin flip we priced with the engine.':
    '紅方的起手炮搶先趕到河沿，只差一步就能沿五條縱線中的任何一條開火，而在迷霧裡你根本看不見它的到來。這會不會毀掉整個棋種，最終落在一步飛象、一個有毒的防守，以及一次我們用引擎算清了價碼的硬幣對賭上。',

  // ── 2026-08-23 .. 2026-08-27 backfill ──
  'Set up any position, then share it.': '任意擺一個局面，然後分享出去。',
  'A head-to-head record on every finished game.': '每局終局都有對陣記錄。',
  'Board coordinates, on every board that has them.': '棋盤座標，凡是有座標的棋盤都能顯示。',
  'Follow a forum thread without refreshing it.': '關注論壇主題，不用反覆重新整理。',
  'Chess titles count for verification now.': '國際象棋頭銜現在也可以認證。',
  'Studies read and write PGN.': '研習支援匯入和匯出 PGN。',
  'The Riverbank Cannon Problem.': '巡河炮問題。',
  'Puzzles are rated by how hard they play.': '題目難度改按實際難解程度評定。',
  'Pick a flair for your name.': '給你的名字挑一個個性圖示。',
  'A board editor for eight variants: place pieces by hand, set the side to move, and hand the position straight to the analysis board. The analysis board also takes a FEN directly, and every position you build has its own link.':
    '八種變體都有了棋盤編輯器：手動擺子、指定輪誰走，再把局面直接交給分析棋盤。分析棋盤也可以直接讀入 FEN，你擺出的每個局面都有自己的連結。',
  'The review page gains a Crosstable with your record against that opponent in that variant, engines included, and Share and export hands you the game as PGN or JSON.':
    '復盤頁新增對陣表，顯示你在該變體中與這位對手的交手記錄，引擎也算在內；分享與匯出可以把整局匯出為 PGN 或 JSON。',
  'One switch in Display settings reaches the xiangqi family, the chess boards, jungle, and shogi. Xiangqi counts its files from each player’s own right, so the labels follow your move-notation setting and change sides when you flip the board.':
    '顯示設定裡的一個開關，現在管得到象棋系列、國際象棋類棋盤、鬥獸棋和將棋。象棋的縱線從各自的右手邊數起，所以標註會跟隨你的著法記譜設定，並在翻轉棋盤時換邊。',
  'Watch a topic and the bell counts its unread replies. Quoting someone now tells them, and every source the bell reports has its own switch.':
    '關注一個主題，鈴鐺就會統計它的未讀回覆。引用他人現在也會通知對方，鈴鐺報告的每一類訊息都有各自的開關。',
  'GM, IM, FM and the rest join the xiangqi titles. A verified title puts a badge beside your name wherever people are listed, and opens a coaching page students can find. Verification takes about two minutes.':
    'GM、IM、FM 等頭銜加入了原有的象棋頭銜。認證通過後，凡是列出棋手的地方，你的名字旁都會顯示頭銜徽章，並會開通一個學生能找到的教練頁面。認證大約需要兩分鐘。',
  'Import a PGN to build a study, export one chapter or all of them, and add a finished game to a study from its link. The opening explorer sits beside the board while you work.':
    '匯入 PGN 即可建立研習，可以匯出單個章節或全部章節，也可以憑連結把一局終局加入研習。編寫時，開局庫就在棋盤旁邊。',
  'A puzzle’s rating used to come from how many moves the mate took, which says little about how hard it is to find. It now comes from the position itself, so what you are served sits closer to your rating.':
    '題目的等級分以前取自殺棋的步數，而步數說明不了它有多難找。現在等級分來自局面本身，所以派給你的題目會更貼近你的水準。',
  'Choose a small icon that shows beside your handle across the site, from the variant markers and xiangqi characters the boards already use. The bell also reports new followers and incoming challenges now.':
    '從棋盤已經在用的變體標記和象棋棋子字中挑一個小圖示，它會顯示在全站你的使用者名稱旁邊。鈴鐺現在還會報告新的追蹤者和收到的挑戰。',
  'Open the editor': '開啟編輯器',
  'Open settings': '開啟設定',
  'Edit your profile': '編輯資料頁',
  // ── headlines ──
  'Both house bots play stronger.': '兩台自家引擎都變強了。',
  'Four times as many xiangqi puzzles.': '象棋題目增至四倍。',
  'Move badges and best lines on every reviewable variant.':
    '所有支援覆盤的棋類都有著法評註與最佳變化。',
  'Separating skill from luck in flip games.': '在翻子棋中區分棋力與運氣。',
  'What Patron support will cost.': '贊助 Mistboard 的價格。',
  'A games database for xiangqi.': '象棋對局庫。',
  'Perpetual check now loses in standard xiangqi.': '標準象棋中長將判負。',
  'Mistboard works on a phone.': 'Mistboard 已適配手機。',
  'Every composition has its own page.': '每則排局都有獨立頁面。',
  'Mistboard reads in Chinese.': 'Mistboard 已支援中文。',
  'Rated games at every time control.': '各種時限都可下等級分對局。',
  'An opening explorer for xiangqi.': '象棋開局庫。',
  'Rated xiangqi is live.': '等級分象棋已上線。',
  'Secret in the Tangerine, both game volumes.': '《橘中祕》全部對局卷。',
  'Classical xiangqi, from the original woodblocks.': '古譜象棋，源自原始刻本。',
  'Correspondence play has launched.': '通信對局已上線。',
  'An analysis board for every game.': '每種棋類都有分析棋盤。',
  'Studies have launched.': '研習已上線。',
  'Mistboard TV is live.': 'Mistboard 電視已上線。',
  'Learn xiangqi from scratch.': '從零開始學象棋。',
  'Xiangqi puzzles have launched.': '象棋題目已上線。',
  'Xiangqi has launched.': '象棋已上線。',
  'Forum and global chat have launched.': '論壇與全站聊天已上線。',
  'Fortress has launched.': '堡壘象棋已上線。',
  'Read the updated rules': '閱讀更新後的規則',
  'Storm the Fortress: the Soldier crosses the river again.': '堡壘象棋：兵重新需要過河。',
  'Two rule changes. The Soldier goes back to the xiangqi rule it should always have had: one point forward on your own half, and the sideways step only once it has crossed the river. Crossing is the commitment it costs something to make. The Treasure now stays home for good, moving and dropping only on its own half, so the piece you are storming for cannot parachute into the fight. Engine self-play across five rule sets and a thousand games says the Soldier is what makes this game sharp: draws fall from 34% to 9% and a typical game runs half again as long.':
    '兩項規則改動。兵回到象棋本來的走法：在己方半場每次只向前走一點，過河之後才獲得橫走。過河是一次要付出代價的決斷。寶從此留在家中，走子和打入都只限己方半場，被圍攻的目標不能再空降到戰場上。跨五套規則、上千局的引擎自戰表明，真正讓這個棋種變得鋒利的是兵：和棋率從 34% 降到 9%，一局的長度增加約一半。',
  'Jungle Chess has launched.': '鬥獸棋已上線。',
  'Flip Jungle has launched.': '翻翻棋已上線。',
  'Drop Mini Xiangqi has launched.': '打入迷你象棋已上線。',
  'Dark Crazyhouse has launched.': '迷霧瘋狂屋已上線。',
  'Dark Crossroads Chess has launched.': '迷霧十字路口西洋棋已上線。',
  'Fog Shogi has launched.': '迷霧將棋已上線。',
  'Kriegspiel is open for alpha play.': '裁判棋已開放內測對局。',
  'Reveal Chess is open for alpha play.': '翻開西洋棋已開放內測對局。',
  'Fog Xiangqi is open for alpha play.': '迷霧象棋已開放內測對局。',
  'Banqi is open for alpha play.': '暗棋已開放內測對局。',
  'Jieqi is open for alpha play.': '揭棋已開放內測對局。',
  'Crossroads Chess has launched.': '十字路口西洋棋已上線。',
  'Fog Chess is open for alpha play.': '迷霧國際象棋已開放內測對局。',
  'Mistboard is in alpha.': 'Mistboard 處於內測階段。',
  'Dark Mini Xiangqi is open for alpha play.': '迷霧迷你象棋已開放內測對局。',
  'Misty 1.0 has launched.': 'Misty 1.0 已上線。',

  // ── bodies ──
  'Misty runs version 1.6 in fog chess, which closes a queen hang it used to walk into. Pikafish now searches jieqi to full depth; it had been stopping early, which made it easier to beat than it should have been.':
    '迷霧國際象棋中的 Misty 已升級到 1.6 版，修正了以往會送后的一類失誤。揭棋中的 Pikafish 現在會搜尋到完整深度；此前它過早停止搜尋，因此比應有的水準更容易被擊敗。',
  'The standard xiangqi set goes from 394 puzzles to 1,605, every one mined from a finished game and checked by the engine before it ships.':
    '標準象棋題庫從 394 題增加到 1,605 題，每一題都取自已結束的對局，並在上線前經過引擎校驗。',
  'The move-judgment badge now sits on the board for all six variants with analysis, not xiangqi alone, and a blunder names the move that refutes it. Jieqi reveal plies get the ranked candidates the engine scored instead of a line, since nothing past a flip is knowable.':
    '著法評註標記現在會顯示在全部六種支援分析的棋類棋盤上，不再只有象棋，漏著還會指出反駁它的具體著法。揭棋的翻子半回合不再給出變化，而是列出引擎評分後的候選著法排名，因為翻子之後的局面無法預知。',
  'Half the moves in banqi, jieqi, and flip jungle are dice rolls, so a chess-style review blames you for variance. Game review splits every flip into the decision you made and the tile you got, and the article runs that over 52 human-versus-engine games.':
    '暗棋、揭棋和翻翻棋裡，一半的著法其實是擲骰子，照搬國際象棋的覆盤就會把運氣算到你頭上。對局覆盤把每次翻子拆成你做的決策和你翻到的棋子，文章用 52 盤人機對局驗證了這一點。',
  'The Support page lists the monthly amounts, what they include (a profile badge, no gameplay advantage), and the billing and refund terms in full. Checkout is not open yet.':
    '「支持 Mistboard」頁面列出了每月的贊助金額、包含的內容（個人資料上的徽章，不影響對局），以及完整的計費與退款條款。結帳尚未開放。',
  'Search finished games from three sources in one place: the historical corpus, the tournament boards we broadcast, and games played here.':
    '在同一處檢索三個來源的已結束對局：歷史棋譜庫、我們轉播的賽事棋盤，以及在本站下的對局。',
  'Repeating a check forever used to draw. The checker has to vary or lose the game, which is how the published rulesets score it and how the course has always taught it.':
    '此前一直重複將軍會判和。現在長將的一方必須變著，否則判負，這與公布的規則以及本站課程一貫的講法一致。',
  'Every page was swept at phone width: a full-size live board, lobby rows that still name the variant, and real touch targets on the controls you tap.':
    '每個頁面都按手機寬度檢查過：對局棋盤完整顯示，大廳列表仍標明棋類，常用控制項也有足夠大的觸控區域。',
  'Each endgame composition in the library is a page you can link to, and sharing one previews its own diagram rather than the site card.':
    '棋譜庫中的每則排局都有可分享的連結，分享時預覽的是該局自己的棋圖，而不是站點的通用卡片。',
  'Playing, watching, the forum, and the xiangqi rules pages are all available in Simplified and Traditional Chinese. Switch languages in the settings menu.':
    '對局、觀戰、論壇和象棋規則頁面均已提供簡體中文與繁體中文。可在設定選單中切換語言。',
  'Bullet, blitz, and rapid each keep their own rating now, instead of rated meaning 3+2 only. Correspondence stays casual on purpose.':
    '子彈、閃電和快速各自記錄獨立的等級分，不再只有 3+2 才算等級分對局。通信對局仍然只計休閒，這是刻意為之。',
  'Open any position on the analysis board and see what has been played from it, with example games to study and the corpus it came from named on the panel.':
    '在分析棋盤上開啟任意局面，即可看到從這裡走出的著法統計，附範例對局，面板上也註明了資料出自哪個棋譜庫。',
  'Choose Rated in the lobby. Your rating starts at 1500 and appears after it settles.':
    '在大廳選擇「等級分」。等級分從 1500 起算，穩定後顯示。',
  'Both volumes are playable move by move in English: 33 games with every printed variation.':
    '兩卷都可用英文逐著打譜：33 局對弈，含書中全部變著。',
  'Read the earliest printings move by move, with every corrected misprint marked on the board.':
    '逐著閱讀最早的刻本，所有勘正的訛誤都標註在棋盤上。',
  'Post or accept a days-per-move seek, or send a friend a challenge link and play at your own pace.':
    '發布或接受「每著若干天」的約戰，也可以把挑戰連結發給好友，按自己的節奏下棋。',
  'Set up any position, import moves, run a local evaluation, or grade a finished game with server analysis.':
    '擺任意局面、匯入著法、在本機執行評估，或用伺服器分析為已結束的對局評分。',
  'Build shareable analysis boards: draw on the board, comment, branch variations, organize chapters, and publish interactive gamebook lessons.':
    '搭建可分享的分析棋盤：在盤面標註、寫評註、分出變著、整理章節，並發布可互動的教學課程。',
  'Watch live games on the new Watch page, with a channel for every game and an Engines channel for bot-versus-bot matches.':
    '在新的「觀戰」頁面看直播對局，每種棋類都有頻道，另有引擎頻道播放機器人之間的對弈。',
  'A free interactive course: 20 stages and 111 hands-on levels take you from how each piece moves to the named checkmate patterns.':
    '免費的互動課程：20 個階段、111 個實作關卡，從每個棋子怎麼走一直講到有名的殺法。',
  'Tactics mined from real games, with puzzle ratings, hints, and a daily puzzle on the homepage.':
    '從真實對局中挖掘的戰術題，配有題目等級分、提示，首頁還有每日一題。',
  'Standard Chinese chess on the full 9 by 10 board is now first-class on Mistboard: play the Pikafish engine at three strengths, or challenge a friend.':
    '9×10 全盤的標準象棋已成為 Mistboard 的主要棋類：可與三檔強度的 Pikafish 引擎對弈，也可以邀請好友。',
  'The forum is open for game analysis, engine talk, and site feedback, with the homepage global chat available for quick table-talk during live sessions.':
    '論壇已開放，可用於覆盤、討論引擎和回報站點問題；首頁的全站聊天則方便在對局時隨口交流。',
  'Xiangqi with a pocket: every piece moves as in Chinese chess, plus crazyhouse-style drops and the new Treasure. Play the bot or challenge a friend.':
    '帶手牌的象棋：所有棋子走法與象棋相同，另加瘋狂屋式的打入和新增的「寶」。可與機器人對弈或邀請好友。',
  'Rank-based animal chess on a 7 by 9 board with rivers, dens, and traps is live. Challenge a friend or take on the Misty Jungle engine.':
    '按等級吃子的動物棋，7×9 棋盤，有河流、獸穴和陷阱，現已上線。可邀請好友，或挑戰 Misty Jungle 引擎。',
  'Every animal starts face-down on a 4 by 4 board and flips as you play. Challenge a friend or the engine.':
    '4×4 棋盤上所有動物開局均背面朝上，邊下邊翻。可邀請好友或與引擎對弈。',
  'The 7 by 7 reserve fight is live with no enemy-palace drops, a full rules page, and a 114-ply FSF sample game to study.':
    '7×7 的手牌之爭已上線：不可打入敵方九宮，附完整規則頁，以及一局 114 著的 FSF 範例對局可供研究。',
  'Crazyhouse under Fog of War is now live for invite games, with private hands, captured pieces entering reserve, and drops into the fog.':
    '迷霧下的瘋狂屋已開放邀請對局：手牌不公開，被吃的棋子進入手牌，並可打入迷霧之中。',
  'Crossroads Chess under Fog of War is now live for invite games, with hidden enemy pieces, no check warnings, and the far-rank Try.':
    '迷霧下的十字路口西洋棋已開放邀請對局：敵方棋子隱藏，沒有將軍提示，並保留衝到底線的「觸陣」勝法。',
  'Shogi under Fog of War is now live for invite games, with private hands, drops into the fog, and king capture wins.':
    '迷霧下的將棋已開放邀請對局：手牌不公開，可打入迷霧，擒王即勝。',
  'The original hidden-information chess: see only your own pieces, try moves through the umpire, and challenge a friend to a match.':
    '最早的隱藏資訊西洋棋：只看得見自己的棋子，透過裁判試著法，可邀請好友對局。',
  'Standard chess with a hidden starting arrangement: every piece but the king begins face-down and reveals its true identity the moment it moves. Challenge a friend to a match.':
    '開局擺法隱藏的西洋棋：除王以外的棋子開局均背面朝上，一走動就亮明真實身分。可邀請好友對局。',
  'Fog of War on the full 9 by 10 xiangqi board: each side sees only the points its pieces reach. Challenge a friend to a match.':
    '9×10 全盤象棋上的迷霧：每一方只看得見自己棋子能到達的點位。可邀請好友對局。',
  'Banqi on an 8 by 4 board: all 32 pieces start face-down and flip as you play. Challenge a friend to a match.':
    '8×4 棋盤上的暗棋：32 枚棋子開局均背面朝上，邊下邊翻。可邀請好友對局。',
  'Hidden-identity xiangqi: every non-general piece starts face-down and reveals as it moves. Take on PikaJieQi, our jieqi engine.':
    '隱藏身分的象棋：除將帥外的棋子開局均背面朝上，走動時翻開。可挑戰我們的揭棋引擎 PikaJieQi。',
  'A 6 by 8 chess-xiangqi variant with checkmate and king-race wins is now live on Mistboard.':
    '融合西洋棋與象棋的 6×8 變體已在 Mistboard 上線，可將死取勝，也可比拼王的衝刺。',
  'Fog of War chess is live on Mistboard, with private vision, no check warnings, and king capture wins.':
    '迷霧國際象棋已在 Mistboard 上線：視野不公開，沒有將軍提示，擒王即勝。',
  'Casual dark chess is open. Rated beta is coming.': '休閒迷霧棋已開放，等級分公測即將推出。',
  'A smaller Fog of War variant on a 7 by 7 xiangqi board, with Misty engine support.':
    '7×7 象棋棋盤上的小型迷霧變體，支援 Misty 引擎。',
  'Our Fog of War dark chess engine is now live to play.': '我們的迷霧國際象棋引擎現已開放對弈。',

  // ── CTA labels ──
  'Search the games': '檢索對局',
  'See the amounts': '查看贊助金額',
  'See the leaderboard': '查看排行榜',
  'Open volume one': '開啟第一卷',
  'Browse the studies': '瀏覽研習',
  'Read the article': '閱讀文章',
  'Open the board': '開啟棋盤',
  'Browse studies': '瀏覽研習',
  'Watch now': '立即觀戰',
  'Start the course': '開始課程',
  'Solve puzzles': '做題',
  'Study the rules': '研讀規則',
  'Join the forum': '加入論壇',
  'Read rules': '閱讀規則',
  'Send feedback': '回報意見',
  'Play the engine': '與引擎對弈',
};

const ANNOUNCEMENT_DICTS: Record<AnnouncementLang, Record<string, string>> = {
  'zh-Hans': ZH_HANS,
  'zh-Hant': ZH_HANT,
};

function dictFor(locale: Locale): Record<string, string> | null {
  return locale === 'zh-Hans' || locale === 'zh-Hant' ? ANNOUNCEMENT_DICTS[locale] : null;
}

/** Translate one announcement string, falling back to the English source. */
export function localizeAnnouncementString(text: string, locale: Locale): string {
  return dictFor(locale)?.[text] ?? text;
}

/**
 * Localized copy of an announcement. English (or any locale without a
 * dictionary) returns the entry untouched, so callers can render the result
 * unconditionally.
 */
export function localizeAnnouncement(entry: Announcement, locale: Locale): Announcement {
  const dict = dictFor(locale);
  if (!dict) return entry;
  return {
    ...entry,
    headline: dict[entry.headline] ?? entry.headline,
    body: entry.body === undefined ? undefined : (dict[entry.body] ?? entry.body),
    cta: entry.cta === undefined ? undefined : (dict[entry.cta] ?? entry.cta),
  };
}

export function hasAnnouncementTranslation(lang: AnnouncementLang, text: string): boolean {
  return hasOwnKey(ANNOUNCEMENT_DICTS[lang], text);
}

export function announcementTranslationKeys(lang: AnnouncementLang): string[] {
  return Object.keys(ANNOUNCEMENT_DICTS[lang]);
}
