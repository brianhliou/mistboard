// Article localization (zh-Hans / zh-Hant).
//
// Model: the English Article in articles-data.ts is the single structural source
// of truth. A translated render is produced by deep-cloning the article and
// substituting any string that appears as a key in the per-language dictionary.
// Board geometry (squares, piece roles, orientation, arrows) never matches a key,
// so only human-readable content (title, summary, headings, prose, board labels,
// CTA labels) is swapped. No duplicated structure → no drift when the English
// article changes shape.
//
// Dictionaries are authored from docs-private/translation-experiment-dark-chess-zh.md
// (head term 迷雾国际象棋 / 迷霧國際象棋 validated against the zh chess-variant
// community; Traditional carries the Taiwan lexical forks, not a glyph conversion).
import { hasOwnKey } from '@mistboard/game';
import type { Article } from './articles-data.js';
import { contentLocalePrefix, type Locale, localizedHref } from './i18n/locale.js';

export type ArticleLang = Extract<Locale, 'zh-Hans' | 'zh-Hant'>;

export const ARTICLE_LANGS: ArticleLang[] = ['zh-Hans', 'zh-Hant'];

// URL prefix per language. `/zh-hans/blog/<slug>`, `/zh-hant/blog/<slug>`.
export const ARTICLE_LANG_PREFIX: Record<ArticleLang, string> = {
  'zh-Hans': contentLocalePrefix('zh-Hans'),
  'zh-Hant': contentLocalePrefix('zh-Hant'),
};

// Articles cross the localized publication boundary only after their English
// copy is frozen, every prose string exists in both zh scripts, and a
// maintainer explicitly opts the slug in. Native quality review is tracked
// separately. This list drives runtime links, prerendering, and the coverage
// contract. A partial dictionary may exist while work is in progress, but it
// is never a promise that the public article is localized.
export const TRANSLATED_ARTICLE_SLUGS = [
  // Machine-drafted 2026-09-03, not native-reviewed, locked the day the English
  // copy published. The openings article's dictionary was already complete and
  // waiting: the lock requires a PUBLISHED article, so it could not be listed
  // while its English page was still a draft.
  'jieqi-platform',
  'jieqi-openings',
  // Machine-drafted 2026-09-01, not native-reviewed. Locked once its English
  // copy settled: the piece is mostly worked examples, and the caption on
  // each stepper is the only part of an xq-replay that article-prose.ts
  // extracts, so the narrative was moved out of spec.resultText before this
  // slug was added. Editing any string here now orphans its key and fails
  // the coverage test, which is the point.
  'how-puzzle-mining-works',
  // Machine-drafted 2026-08-30, not native-reviewed, shipped on Brian's explicit
  // call after the risk was raised. This page carries more of that risk than the
  // others: it names living people with criminal convictions, and the readers
  // best placed to catch an error in the Chinese are the ones reading it.
  'xiangqi-match-fixing',
  // Machine-drafted, not native-reviewed (2026-08-27). Opted in anyway because
  // most titled xiangqi players read Chinese, so English-only was the wrong
  // default for THIS page specifically. Re-review when a reader is available.
  'titled-players',
  // Machine-drafted, not native-reviewed (2026-08-29), by explicit decision.
  // Champion names stay in simplified for the Traditional reader, because a
  // person's name is written in the script that person uses and all twenty-two
  // are mainland players; champion-name-script.test.ts enforces that.
  'xiangqi-champions',

  // Machine-drafted, not native-reviewed (2026-08-29). Same standing as the
  // page above, and the same name rule, except that this page's champions are
  // not all mainland: see the zh-Hant block's note.
  'xiangqi-world-championship',
  'riverbank-cannon',
  'skill-vs-luck',
  'fog-chess',
  'fog-xiangqi',
  'chess',
  'xiangqi',
  'dark-draft960',
  'shogi4',
  'mini-xiangqi',
  'dark-mini-xiangqi',
  'drop-mini-xiangqi',
  'jieqi',
  'banqi',
  'mistybanqi',
  'jungle',
  'jungle-flip',
  'fortress-xiangqi',
  'misty',
  'server-enforced-fog',
] as const;

const TRANSLATED_ARTICLE_SLUG_SET = new Set<string>(TRANSLATED_ARTICLE_SLUGS);

export function isArticleTranslationPublished(slug: string): boolean {
  return TRANSLATED_ARTICLE_SLUG_SET.has(slug);
}

export function publishedArticleLang(
  slug: string,
  requested: ArticleLang | undefined,
): ArticleLang | undefined {
  return requested && isArticleTranslationPublished(slug) ? requested : undefined;
}

export function localizedArticleHref(article: Article, locale: Locale): string {
  const base = article.kind === 'rules' ? 'rules' : 'blog';
  const targetLocale =
    (locale === 'zh-Hans' || locale === 'zh-Hant') && !isArticleTranslationPublished(article.slug)
      ? 'en'
      : locale;
  return localizedHref(`/${base}/${article.slug}`, targetLocale);
}

const ZH_HANS: Record<string, string> = {
  // Gate-ladder figure labels. localizeSvgMarkup swaps <text> nodes through
  // this dictionary at render, but article-prose.ts gives a raw-svg block only
  // its caption, so nothing demanded these and the figure shipped in English.
  // The eight reason identifiers stay Latin: the caption calls them the value
  // stored on the candidate, and they should match the database.
  'THE GATE, IN EVALUATION ORDER': '判定关卡，按求值顺序',
  'best mates in one, or no other move mates': '最佳着法一步将死，或没有其他着法能将死',
  unique: '唯一',
  'win%(best) below 0.8': '最佳胜率低于 0.8',
  rejected: '拒绝',
  'no second move exists': '不存在第二选择',
  'second move mates': '次佳着法也能将死',
  'gap below 200cp': '差距低于 200cp',
  'win%(second) at or below 0.6': '次佳胜率不高于 0.6',
  'gap of 250cp or more': '差距达到 250cp 或以上',
  'anything left over': '其余情况',
  // Replay headers and result lines. article-prose.ts extracts these as of
  // 2026-09-02; before that only a stepper's caption counted, so these shipped
  // in English beside translated prose with the coverage test green.
  'World Championship Game 11, Sochi 2014': '世界冠军赛第 11 局，2014 年索契',
  'Anand resigns. Carlsen (White) wins the match.': '阿南德认输。卡尔森（白方）赢得这场比赛。',
  'Sacrifice the Horse in 13': '弃马十三着',
  'Classic manual, 1632': '古谱，1632 年',
  "Checkmate on move 13. Red's paired cannons pin the general on the open central file.":
    '第 13 回合将死。红方双炮沿着打通的中路把将困死。',
  'Engine self-play · depth 10': '引擎自对弈 · 深度 10',
  'Red’s horse leaps to f5 and checkmates the black general on e7. Red wins.':
    '红马跃到 f5，将死 e7 的黑将。红方胜。',
  'Misty DMX · Fog of War self-play': 'Misty DMX · 迷雾自对弈',
  'Black’s cannon takes the horse on c1; the Red general must recapture, and the waiting chariot runs the open c-file to capture it. Black wins.':
    '黑炮吃掉 c1 的马；红将必须回吃，等在一旁的车顺着打开的 c 线冲下来把它吃掉。黑方胜。',
  'PikaJieQi self-play': 'PikaJieQi 自对弈',
  'Red works through the reveals and delivers checkmate on move 36.':
    '红方在一次次揭子中推进，第 36 回合将死。',
  'Black is up material — five pieces to three — but cannot touch Red’s elephant, the highest piece left, while it picks off Black’s pieces one by one. Black resigns. In Banqi, rank beats raw material.':
    '黑方子力占优，五子对三子，却动不了红方的象，那是场上仅存的最大子，而它正一个一个地吃掉黑方的子。黑方认输。在暗棋里，大小压过纯粹的子力。',
  'Engine self-play · 2.5 s per move': '引擎自对弈 · 每步 2.5 秒',
  'Black mates on move 43 with the soldier to b1, the same soldier that crossed the river on move 4. Red’s general has nowhere to go: its own soldier blocks a2, and Black covers both b1 and b2.':
    '黑方第 43 回合以兵到 b1 将死，正是第 4 回合过河的那个兵。红帅无处可走：己方的兵挡住 a2，而 b1 和 b2 都在黑方控制之下。',
  // ── how-puzzle-mining-works (2026-09-01) ──
  // Machine-drafted, not native-reviewed, per the standing decision above.
  // Terms are taken from what this site already publishes rather than invented:
  // 题目 is nav.puzzles, 漏着 is the review page's blunder glyph, 着法 is
  // replay.moves, 半回合 is the ply the riverbank article uses, 复核 for the
  // second engine pass. 厘兵 is a coinage for centipawn and the article defines
  // it in place, which is why that paragraph must not be cut in translation.
  'I built a xiangqi puzzle miner': '我做了一个象棋题目挖掘器',
  'A miner that reads real xiangqi games, finds the moves people got wrong, and keeps the positions where exactly one move wins. About one blunder in nine survives it. Here is the algorithm, the code, and some of what it kept and threw away.':
    '一个挖掘器：读入真实的象棋对局，找出人们下错的着法，保留那些恰好只有一步棋能赢的局面。大约每九个漏着里有一个能留下来。下面是算法、代码，以及它留下和丢掉的一些例子。',
  'Mistboard needed xiangqi puzzles and I could not find a corpus to use, so I wrote a miner. It reads real games, finds the moments somebody threw the game away, and keeps the positions where exactly one move wins.':
    'Mistboard 需要象棋题目，而我找不到现成的题库可用，于是写了一个挖掘器。它读入真实对局，找出有人把棋葬送掉的那一刻，保留恰好只有一步棋能赢的局面。',
  'About one blunder in nine makes it through. The reasons the other eight fail turn out to be a working definition of a puzzle, which is the interesting part and most of what is below.':
    '大约每九个漏着里有一个能通过。另外八个失败的原因，恰好构成了一道题目该是什么样子的定义，这才是有意思的部分，也是下文的主要内容。',
  'The games': '棋谱从哪里来',
  'They come from [ElephantChess](https://elephantchess.io/about/datasets), which publishes its own site’s games as anonymised monthly dumps under GPL-3.0. Amateur games, which matters: strong players do not blunder often enough to be a supply.':
    '它们来自 [ElephantChess](https://elephantchess.io/about/datasets)，该网站以 GPL-3.0 协议按月发布自己站内对局的匿名数据集。业余对局，这一点很重要：高手漏着的频率不足以支撑一个题库。',
  'A run freezes its game list before any engine time is spent, sampled across ratings, time controls, results and lengths so it does not turn out to be all blitz. Nothing is added to a run once it starts.':
    '每一轮挖掘在花掉任何引擎时间之前，都会先把棋谱清单冻结，并按等级分、时限、结果和长度采样，以免全是快棋。一轮开始之后就不再往里加棋。',
  'The algorithm': '算法',
  'Two passes: a cheap one over every position of every game, and an expensive one over the few that survive it.':
    '两遍扫描：一遍便宜的，跑遍每一局的每一个局面；一遍昂贵的，只跑通过了前一遍的少数局面。',
  'The cheap pass replays a game and stops at every position after ply 8, asking Pikafish for its top two moves at 60,000 nodes. That is roughly depth 10 to 14, and it is shallow on purpose, because it runs everywhere.':
    '便宜的那一遍把棋谱重演一次，在第 8 个半回合之后的每个局面停下，用 60,000 个节点向 Pikafish 要它认为最好的两步棋。这大约相当于 10 到 14 层深度，浅是故意的，因为这一遍要跑遍所有局面。',
  'A position becomes a candidate when the move actually played loses at least 250 centipawns against the engine’s best, and the position it leaves behind is winning by at least 250 centipawns for the other side. A blunder that leaves the game equal is not a puzzle. There is nothing to find.':
    '当实际走出的那一步比引擎的最佳着法差至少 250 厘兵，并且它留下的局面对另一方而言至少领先 250 厘兵时，这个局面就成为候选。一个只把棋下成均势的漏着不是题目，那里没有东西可找。',
  'A centipawn is a hundredth of a soldier, the unit engines use for material. Xiangqi has no pawn, so the name comes from chess along with the scale. The values this site uses put a horse or a cannon at 450 and a chariot at 900, which makes a 250-centipawn swing about half a horse.':
    '厘兵是一个兵的百分之一，引擎用来衡量子力的单位。象棋里没有国际象棋那种兵，所以这个名字连同它的标度都是从国际象棋借来的。本站采用的子力价值把马或炮记作 450，车记作 900，因此 250 厘兵的落差大约是半个马。',
  'Two filters keep that pass honest. Positions already decided by 800 centipawns are skipped, because winning a won game harder is not a tactic. And no game gives up more than three candidates, so one collapse cannot flood the corpus with variations on itself.':
    '另有两个过滤器让这一遍保持诚实。已经以 800 厘兵分出胜负的局面会被跳过，因为把一盘已经赢定的棋赢得更多不算战术。而且每一局最多只交出三个候选，这样一次崩盘就不会用同一个局面的各种变化淹没题库。',
  'The expensive pass takes each candidate back to the engine at depth 20 and 600,000 nodes, ten times the budget, handed over as a bare FEN with no move history. Same position, no context, so the engine cannot lean on the search it just did.':
    '昂贵的那一遍把每个候选送回引擎，用 20 层深度和 600,000 个节点，是前一遍预算的十倍，而且只交给它一个不带走子历史的 FEN。同一个局面，没有上下文，引擎无法依赖它刚才做过的搜索。',
  'Then the line is built one solver move at a time, and every move has to be uniquely best on its own. That is what separates a puzzle from a plausible sequence. A principal variation is one line the engine liked from one search. It says nothing about whether move three was forced, and a solver who finds a different move three and is told they are wrong has been lied to.':
    '然后解答线路一步一步地搭起来，每一步都必须自己单独是唯一最佳。这才是一道题目和一串看起来合理的着法之间的区别。主变只是引擎在一次搜索里喜欢的一条线路，它没有说第三步是不是被迫的；一个找到了另一种第三步却被判为错误的解题者，是被骗了。',
  'Uniqueness is not a centipawn gap. Two moves 50 centipawns apart are both fine, and demanding one punishes a solver for choosing correctly. What makes a move **the** answer is that every alternative is wrong: it gives the win away, or it wins materially less. The test is a hand-tuned cascade rather than anything principled, and it fails closed, so anything it cannot separate is thrown away.':
    '唯一性不是厘兵差。相差 50 厘兵的两步棋都不错，硬要挑出一步只会因为解题者选对了而惩罚他。让一步棋成为**那个**答案的，是其余每一种选择都是错的：要么把胜势让掉，要么赢得的子力明显更少。这个判定是一串手工调出来的阈值，谈不上有什么原理，而且它是分不开就拒绝，所以凡是它分不开的都会被丢掉。',
  'The gate in evaluation order. Green passes the move, grey rejects it, and the label on the right is the reason stored on the candidate.':
    '判定关卡按求值顺序排列。绿色表示这一步通过，灰色表示被拒绝，右边的标签是记录在候选上的原因。',
  'The code': '代码',
  'The cheap pass, condensed. One detail halves it: judging a move needs the position’s value before and after, and both are already there if the scans stay in order, because the move played is worth the negation of the next position’s score. One search per position, not two.':
    '便宜的那一遍，精简版。有一个细节把它的开销减半：判断一步棋需要知道局面在这一步之前和之后的分值，而只要扫描保持顺序，这两个值就都已经在手上了，因为走出的这一步的价值就是下一个局面分值的相反数。每个局面搜索一次，而不是两次。',
  'And the gate. Every branch that returns false here is a way a real blunder fails to be a puzzle.':
    '还有判定关卡。这里每一个返回 false 的分支，都是一个真实的漏着未能成为题目的方式。',
  'What it keeps': '它留下什么',
  '**Two thirds of the puzzles open with a move that captures nothing.** If you hunt for tactics by scanning the captures first, which is what most of us do, you are looking at the wrong third of the board most of the time. Step through this one: the chariot goes the length of the board and takes nothing on the way.':
    '**三分之二的题目以一步不吃子的棋开始。** 如果你像我们大多数人那样，先扫一遍能吃子的着法去找战术，那你多数时候看的是棋盘上错误的那三分之一。把这一题走一遍看看：车从棋盘的一端走到另一端，一路上什么都没吃。',
  'Red plays the chariot the length of the board, taking nothing. Black brings the horse back to c3 to cover the mate, and it does not cover it.':
    '红方把车从棋盘的一端走到另一端，什么也没吃。黑方把马退回 c3 想守住杀棋，而它守不住。',
  '**Only about a tenth involve giving material away.** Sacrifices are the tactics people remember, so I had assumed they would be a larger slice. In real games between real players, the winning move is usually just a move. Here is one of the tenth, and the solver is the one behind: a horse and a cannon down before it starts.':
    '**只有大约十分之一涉及弃子。** 弃子是人们记得住的那种战术，所以我原本以为它的比例会更大。在真实棋手之间的真实对局里，取胜的那一步通常就只是一步棋。这是十分之一里的一个，而且落后的正是解题的一方：开始时少一马一炮。',
  'Red gave a chariot for an advisor and a horse, so it finishes 1,150 centipawns down instead of 900. The material never comes back. The mate just arrives first.':
    '红方用一个车换回一士一马，所以它从落后 900 厘兵变成落后 1,150 厘兵。子力再也没有追回来，只是杀棋先到了。',
  '**Not every puzzle ends in mate.** About 40% end with the solver simply winning, and those are the ones a mate-shaped intuition misses. This one opens with a move that takes nothing, hands a soldier back, and collects an advisor and both horses for it.':
    '**并不是每道题目都以将死收尾。** 大约 40% 是以解题方单纯取得胜势结束的，而这些正是一心找杀棋的直觉会漏掉的。这一题以一步不吃子的棋开始，交还一个兵，换回一个士和两个马。',
  'Black ends a thousand centipawns up, an advisor and both horses against one soldier. There is no mate here and no threat of one. It is still a puzzle.':
    '黑方最终领先一千厘兵，一士两马对一兵。这里没有杀棋，也没有杀棋的威胁，它仍然是一道题目。',
  'And one that takes nothing for four plies. Red is 150 centipawns down here and the engine calls the position level.':
    '还有一题连着四个半回合什么都不吃。红方在这里落后 150 厘兵，而引擎认为局面是均势。',
  'The chariot steps quietly to d3, the general is walked to the back rank, and the advisor on d8 falls. Red goes from 150 down to an engine score of +917, with Black left holding two legal moves.':
    '车悄悄走到 d3，将被逼到底线，d8 的士随之落下。红方从落后 150 变成引擎给出的 +917，而黑方只剩下两步合法着法。',
  'What it throws out': '它丢掉什么',
  'The rejects define a puzzle better than the keeps do, because each one is a real blunder that failed for exactly one reason.':
    '被丢掉的那些比留下的更能说清一道题目是什么，因为每一个都是一个真实的漏着，而且恰好因为一个原因失败。',
  Outcome: '结果',
  'Share of candidates': '占候选的比例',
  'Rejected: near-tie': '拒绝：几乎并列',
  'Rejected: too short': '拒绝：太短',
  'Rejected: promised mate not reached': '拒绝：许诺的杀棋没有兑现',
  'Rejected: not unique, or not winning': '拒绝：不唯一，或者并非胜势',
  'Survived to the audit': '进入复核',
  'Measured over 10,503 candidates from 3,500 games in August 2026. The shares have held within about two points across three runs; the totals will not survive the next one.':
    '数据取自 2026 年 8 月、来自 3,500 局棋的 10,503 个候选。这些比例在三轮挖掘之间的浮动大约在两个百分点以内；绝对数字则活不过下一轮。',
  '**Near-tie is the biggest, about a third.** The player had a winning move and so did something else. Both work, so there is no answer to check against and no puzzle, even though the blunder was real and the position was winning.':
    '**几乎并列是最大的一类，约占三分之一。** 走棋的一方有一步能赢的棋，而另外还有一步也能赢。两步都成立，于是没有可以用来对照的答案，也就没有题目，尽管那个漏着是真实的，局面也确实是胜势。',
  '**Too short is another third**, and it gives the clearest example in the corpus of what the miner is for. Below is a position it rejected. Black is to move, the engine scores it as a forced mate against a second-best line of +1407, and exactly one of Black’s twenty legal moves does it.':
    '**太短是另外三分之一**，它给出了整个题库里最能说明这个挖掘器是干什么的例子。下面是一个被拒绝的局面。轮黑方走，引擎把它判为必然的杀棋，次优线路是 +1407，而黑方二十步合法着法里恰好只有一步能做到。',
  'The horse drops to c3 and it is mate. Unique, crushing, correct, and rejected, because the whole win is one move and one move is a spot-check rather than a puzzle.':
    '马落到 c3，杀棋。唯一、致命、正确，然后被拒绝，因为整个取胜过程只有一步棋，而一步棋是一次抽查，不是一道题目。',
  'The other way to fail is to have too many answers rather than too few. Red is to move below and the horse on e8 mates two different ways, c9 or g9. The stepper plays one of them. Either wins, so there is nothing to check a solver against, and the candidate is thrown out.':
    '另一种失败方式是答案太多而不是太少。下面轮红方走，e8 的马有两种不同的将死方法，c9 或者 g9。这个走子器演示其中一种。两种都能赢，于是没有东西可以用来对照解题者的答案，这个候选就被丢掉了。',
  'The horse mates on c9. It also mates on g9. Two answers is not one answer, so this is not a puzzle.':
    '马在 c9 将死。它在 g9 也能将死。两个答案不是一个答案，所以这不是一道题目。',
  '**Promised mate not reached** is the narrow one, and it is not a rule against non-mate puzzles. It fires only when the engine returned a mate score, so the line promised a mate, and replaying it inside the seven-ply cap never got there. The promise could not be checked, so the candidate goes. A position with an ordinary winning evaluation never enters that branch at all, and ships as one of the winning-advantage puzzles above.':
    '**许诺的杀棋没有兑现**是范围最窄的一类，它并不是一条针对非杀棋题目的规则。它只在引擎返回杀棋分值时触发，也就是说这条线路许诺了一个杀棋，而在七个半回合的上限内把它重演一遍却没有走到。这个许诺无法验证，于是候选被丢弃。评分只是普通胜势的局面根本不会进入这个分支，它们会作为上面那种胜势题目发布出去。',
  'What a puzzle turns out to be': '一道题目到头来是什么',
  'Most winning positions have several winning moves, and that is what disqualifies them: a third of everything found died on that alone. A puzzle is a position with one answer, deep enough that finding it takes work, and stable enough that a stronger engine still agrees an hour later.':
    '大多数胜势局面都有好几步能赢的棋，而这正是它们被淘汰的原因：找到的全部候选里有三分之一只栽在这一点上。一道题目是这样一个局面：它只有一个答案，深到需要下功夫才找得到，稳到一小时后一个更强的引擎仍然同意。',
  'That is a much narrower thing than a mistake. Nine out of ten mistakes do not qualify.':
    '这比一个错误要窄得多。十个错误里有九个不够格。',
  'One caveat I would rather say than hide: the gate has never been checked against a human. Its four thresholds came from reading rejected positions, not from measuring whether the puzzles they admit are any good, and the win-rate curve they act on is inherited from chess. Solve rates and reveal rates are recorded per puzzle, so the data to grade it exists.':
    '有一点我宁可说出来而不是藏着：这套判定关卡从来没有拿真人检验过。它的四个阈值来自翻看被拒绝的局面，而不是来自衡量它放行的题目到底好不好，而这些阈值所依据的胜率曲线是从国际象棋继承来的。每道题目的解出率和看答案率都有记录，所以用来给它打分的数据是存在的。',
  'Solve xiangqi puzzles': '做象棋题目',
  'Play twelve of them': '试走其中十二题',
  'How Mistboard mines xiangqi puzzles from real games': 'Mistboard 如何从真实对局中挖掘象棋题目',
  // The xq-replay specs: title, event, resultText and the two seat labels.
  // article-prose.ts extracts only a stepper's caption, so these are invisible
  // to the coverage test, but deepTranslate walks the whole article and will
  // pick them up from here. Without them a widget header renders half and half.
  'A quiet key move': '不吃子的关键着法',
  'Behind, and giving more away': '落后，还要再送',
  'Winning, not mating': '取胜，而不是将死',
  'Level, then winning': '先是均势，然后取胜',
  'Rejected: two answers': '拒绝：两个答案',
  'Mined puzzle, mate in two': '挖掘出的题目，两步杀',
  'Mined puzzle, winning advantage': '挖掘出的题目，取得胜势',
  'Mate in one, thrown away': '一步杀，被丢掉',
  'Two mates in one, thrown away': '两种一步杀，被丢掉',
  'Mate in two.': '两步杀。',
  'Winning advantage, no mate.': '取得胜势，没有杀棋。',
  'Rejected: too short.': '拒绝：太短。',
  'Rejected: two winning answers.': '拒绝：两个都能赢的答案。',
  Solver: '解题方',
  Defence: '防守方',

  // -- Titled players (recruitment page) --
  // MACHINE-DRAFTED 2026-08-27, NOT NATIVE-REVIEWED. Brian cannot validate zh
  // (see memory user_not_fluent_chinese) and no reviewer was available, so this
  // shipped on a best-effort basis. Terminology is matched to the site's own
  // catalog (题目 / 论坛 / 排行榜 / 视频库 / 主播 / 教练 / 研习) rather than
  // invented. Re-review when a native reader is available.
  'Bring your title to Mistboard': '把你的头衔带到 Mistboard',
  // Drives the localized <title>; not covered by the prose test, so it is easy to miss.
  'For titled xiangqi and chess players': '致象棋与国际象棋的头衔棋手',
  'Verified titled players get a gold badge beside their name, a coaching page students can find, and a front page that will carry their work. Verification takes about two minutes.':
    '通过认证的头衔棋手，名字旁会显示金色徽章，可以开设让学员找得到的教练主页，作品也有机会登上首页。认证大约只需两分钟。',
  'Verified titled players get a gold badge beside their name, a coaching page students can find, and a front page that will carry their work. Verification takes about two minutes: start at [mistboard.com/verify-title](/verify-title).':
    '通过认证的头衔棋手，名字旁会显示金色徽章，可以开设让学员找得到的教练主页，作品也有机会登上首页。认证大约只需两分钟：请前往 [mistboard.com/verify-title](/verify-title)。',
  'Mistboard accepts WXF and CXA titles (XGM, XIM, XNM, XWGM, XWIM) and FIDE titles (GM, IM, FM, CM, WGM, WIM, WFM, WCM). Link your federation profile, give your real name, note the results behind the claim, and an admin reviews it personally.':
    'Mistboard 接受世界象棋联合会（WXF）与中国象棋协会（CXA）的头衔（XGM、XIM、XNM、XWGM、XWIM），以及国际棋联（FIDE）的头衔（GM、IM、FM、CM、WGM、WIM、WFM、WCM）。请附上你的协会个人页面链接、写明真实姓名，并说明支持该头衔的成绩，每份申请都由管理员亲自审核。',
  'What you get': '你能获得什么',
  '**The badge.** Gold, beside your name, everywhere you appear: games, profile, ladders, forum, studies. Every player who sees you play sees the title first.':
    '**头衔徽章。** 金色，就在你的名字旁边，出现在你所到之处：对局、资料页、排行榜、论坛、研习。每一个看你下棋的人，都会先看到你的头衔。',
  '**Your own coaching page.** Publish at [/coach](/coach) with your headline, languages, rate, and contact details. Students reach you directly and pay you directly. Mistboard takes nothing: no commission, no processing fees, no cut of your lesson.':
    '**属于你的教练主页。** 在 [/coach](/coach) 发布你的简介、授课语言、收费与联系方式。学员直接联系你，也直接付款给你。Mistboard 分文不取：没有佣金，没有手续费，不从你的课时费里抽走一分钱。',
  '**The front page.** Write an annotated study and it can lead the homepage under your name. Your analysis is what players come here to read, and there is no queue in front of you.':
    '**首页版位。** 写一份讲解研习，它就有机会以你的名义登上首页。棋手来这里就是为了读你的分析，而且你前面没有人排队。',
  '**The video library.** If you make xiangqi videos, [/videos](/videos) will carry them and send viewers your way.':
    '**视频库。** 如果你制作象棋视频，[/videos](/videos) 会收录它们，并把观众带向你。',
  '**A place in the streamer directory.** Stream here and get listed.':
    '**主播目录中的一席。** 在这里直播，就会被收录。',
  '**Your own byline.** Send something longer and it gets edited and published under your name, with your title beside it.':
    '**署名文章。** 写一篇长一点的稿子寄来，我们会编辑后以你的名义发表，并在名字旁标上你的头衔。',
  'Why Mistboard': '为什么选择 Mistboard',
  'Mistboard is where xiangqi is played in English. Free, open source, no ads, no paywall, no premium tier. Every board, every puzzle, every lesson is open to everyone who shows up.':
    'Mistboard 是用英语下象棋的地方。免费、开源，没有广告，没有付费墙，也没有会员等级。每一副棋盘、每一道题目、每一节课，对每一个来到这里的人都开放。',
  'That audience has never had a serious English-language home, and it has never had titled players to learn from. You would be among the first, on a site built to put your name in front of them rather than bury it.':
    '这批棋迷从来没有一个像样的英语大本营，也从来没有头衔棋手可以请教。你会是最早的一批，而这个网站从一开始就是为了把你的名字摆到他们面前，而不是埋起来。',
  'Verify your title': '认证你的头衔',
  'Ask me something first': '有问题先问我',
  // -- Fortress Xiangqi --
  'Fortress Xiangqi Rules': '堡垒象棋规则',
  'Shigenobu Kusumoto, working in Osaka, invented [Mini Xiangqi](/rules/mini-xiangqi) in 1973. A Japanese designer took a Chinese game and built it a smaller board, the same move he made for his own country’s game with minishogi. Fortress Xiangqi runs that trade in the other direction. Shogi has had drops for centuries and xiangqi never has, so this is what xiangqi looks like when it borrows them.':
    '楠本茂信在大阪发明了[小象棋](/rules/mini-xiangqi)，时间是 1973 年。一位日本设计者拿起一款中国棋，为它造了一张更小的棋盘，正如他为本国的将棋做过五五将棋。堡垒象棋把这趟交流反向跑了一遍。将棋有打入已有数百年，象棋从来没有，这就是象棋借来打入之后的样子。',
  'A compact Xiangqi variant with captured pieces in reserve, piece drops, and one new piece: the Treasure.':
    '一种紧凑的象棋变体，带有持子、打入，以及一个新棋子「宝」。',
  'Fortress Xiangqi is a compact [Xiangqi](/rules/xiangqi) variant designed by Brian H. Liou in 2026 as a Mistboard original. It keeps the familiar pieces, adds one new piece called the Treasure, and gives each player an open reserve. Capture an enemy piece and you can later drop it back as your own.':
    '堡垒象棋是 Brian H. Liou 于 2026 年为 Mistboard 原创设计的紧凑型[象棋](/rules/xiangqi)变体。它保留熟悉的棋子，加入一个名为「宝」的新棋子，并让双方拥有公开持子。吃掉敌子后，可以在之后将它作为己方棋子打回棋盘。',
  'Captured material stays in the game, so every exchange changes both the board and the reserves. A defensive trade now may supply the attacker you need later.':
    '被吃的子仍留在对局中，因此每次兑子都会同时改变盘面和持子。现在用于防守的兑子，之后可能提供进攻所需的棋子。',
  'The board is 7 files (a to g) by 8 ranks, with a river between ranks 4 and 5. Each side has a 3 by 3 palace, but the two palaces sit in opposite corners: Red holds the bottom left (a1 to c3) and Black holds the top right (e6 to g8). The whole setup has 180 degree rotational symmetry.':
    '棋盘为 7 路（a 至 g）、8 横线，河界位于第 4 与第 5 横线之间。双方各有一个 3×3 九宫，但两个九宫分处对角：红方占左下角（a1 至 c3），黑方占右上角（e6 至 g8）。整个布局具有 180 度旋转对称性。',
  'The starting position. Red holds the bottom-left palace, Black the top-right, and the Treasure starts on each palace corner.':
    '初始局面。红方占左下九宫，黑方占右上九宫，双方的「宝」都从各自九宫的角上出发。',
  'Red moves first. This is open information: both players see the whole board and both reserves.':
    '红方先行。这是完全信息游戏：双方都能看到整个棋盘和双方的持子。',
  'The Chariot, Cannon, Horse, Elephant, Advisor, and General move as they do in [xiangqi](/rules/xiangqi). The Soldier is the one standard piece with a changed move, and the Treasure is new. In the diagrams below, a green dot marks a quiet destination, a green ring marks a capture, and a red cross marks a point the piece cannot reach.':
    '车、炮、马、象、士和将帅都按[象棋](/rules/xiangqi)规则移动。兵是唯一走法有变化的标准棋子，宝则是新棋子。在下图中，绿点表示不吃子的落点，绿圈表示吃子，红叉表示该棋子无法到达的点。',
  '**Chariot:** slides any distance orthogonally, the strongest piece on the board. Here it can take the soldier on d7.':
    '**车：**沿横线或竖线移动任意距离，是棋盘上最强的棋子。此处它可以吃掉 d7 的兵。',
  '**Cannon:** moves like the Chariot on open lines, but captures only by jumping exactly one screen piece, friend or enemy. On the right, the cannon on d2 takes the chariot on d7 over its own soldier screen.':
    '**炮：**在空线上走法与车相同，但吃子时必须恰好跳过一个炮架，不论敌我。右图中，d2 的炮隔着己方兵作炮架，吃掉 d7 的车。',
  '**Horse:** steps one point orthogonally, then one point diagonally outward. If the orthogonal step is occupied, that whole direction is blocked. On the right, the soldier on d5 takes away both forward destinations.':
    '**马：**先沿横向或纵向走一步，再向外斜走一步。如果第一步的位置被占据，该方向就会蹩马腿。右图中，d5 的兵封住了马向前的两个落点。',
  '**Elephant:** moves exactly two points diagonally, is blocked by an occupied midpoint (the elephant eye), and can never cross the river.':
    '**象：**沿对角线恰好走两点，中点（象眼）有子时会被塞象眼，而且永远不能过河。',
  '**Advisor:** moves one point diagonally and stays inside the palace.':
    '**士：**沿对角线走一点，并且始终留在九宫内。',
  '**General:** moves one point orthogonally and stays inside the palace. One xiangqi rule retires itself here: because the palaces sit in opposite corners, the two generals never share a file, so the facing-generals rule never comes into play.':
    '**将帅：**沿横向或纵向走一点，并且始终留在九宫内。有一条象棋规则在这里自然失效：两个九宫位于对角，两位将帅永远不会处于同一路，因此不会出现将帅照面的情况。',
  '**Soldier:** moves one point forward, never backward. Once it crosses the river it may also step one point sideways, exactly as in xiangqi. The Treasure is the other piece the river holds back: it never crosses at all.':
    '**兵：**每次向前走一点，不能后退。过河之后还可以横走一点，与象棋完全相同。宝是另一个被河界挡住的棋子：它永远不能过河。',
  '**Treasure:** the one new piece. It steps one point in any of the eight directions and never promotes. It roams its own half freely, but it never crosses the river, moving or dropping. It is the piece you are storming for, and it stays in the fortress.':
    '**宝：**唯一的新棋子。它向八个方向各走一点，不会升变。它可以在己方半场自由活动，但无论是走子还是打入，都永远不能过河。它就是被围攻的目标，始终留在城中。',
  'Left, the Treasure has all eight steps, including the capture on e4. Right, standing on the last rank of its own half, the three squares across the river are closed to it.':
    '左图，宝有全部八种走法，包括吃 e4 的一步。右图，它站在己方半场最后一线，河对岸的三个点对它是封闭的。',
  'There are no promotions. The river matters three ways: the Soldier gains its sideways step by crossing it, and neither the Elephant nor the Treasure may cross it at all.':
    '没有升变。河界有三重意义：兵过河后获得横走，而象和宝都完全不能过河。',
  'Capture, hold, drop': '吃子、持子、打入',
  'When you capture any piece other than the General, it changes to your color and enters your reserve. Both reserves are open information, have no size limit, and keep pieces for as long as needed. On your turn, either move a piece on the board or drop one piece from your reserve onto an empty point. Generals are never captured or held in reserve.':
    '吃掉将帅以外的任何敌子后，它会变成你的颜色并进入持子。双方持子都是公开信息，没有数量上限，也可保留任意久。轮到你时，可以移动盘面棋子，也可以把一枚持子打入空点。将帅不会被吃，也不会进入持子。',
  'Chariots, Horses, Cannons, and Soldiers may drop on any empty point. Advisors, Elephants, and Treasures keep their normal territory restrictions.':
    '车、马、炮和兵可以打入任何空点。士、象和宝仍须遵守各自通常的区域限制。',
  'Where a captured piece may land. The Chariot, Horse, Cannon and Soldier drop on any empty point; the Elephant and the Treasure are held to your own half, and the Advisor to your own palace.':
    '被吃的棋子可以落在哪里。车、马、炮和兵可以打入任何空点；象和宝只能留在己方半场，士只能留在己方九宫。',
  'A dropped piece is live immediately. A drop may give check or deliver checkmate, and a Soldier dropped past the river arrives with its sideways step already earned. The one limit is the usual one: no move, drop included, may leave your own general in check.':
    '打入的棋子立即生效。打入可以将军或将死，打入到河对岸的兵一落子就已经具备横走。唯一限制与平常相同：任何着法，包括打入，都不能让己方将帅处于被将军状态。',
  'How games end': '对局如何结束',
  'Checkmate wins. A player with no legal move also loses, even when not in check. There is no fifty-move or no-progress draw.':
    '将死获胜。即使没有被将军，一方若无合法着法也判负。这里没有五十回合规则或无进展和棋。',
  'On the third occurrence of the same position, a player who gave check on every one of their moves in the repeating cycle loses. If neither player was the sole perpetual checker, the repetition is drawn.':
    '同一局面第三次出现时，若一方在重复循环中的每一步都将军，该方判负。若双方都不是唯一的长将方，则重复局面判和。',
  'Games can also end by timeout, resignation, or abandonment.':
    '对局也可能因超时、认输或弃局而结束。',
  'This engine game shows both new rules at work. Three soldiers cross the river and gain their sideways step, and on move 23 Red drops its captured Treasure on d1, back inside its own half, because that is the only half it may enter.':
    '这盘引擎对局同时展示了两条新规则。三个兵过河并获得横走，第 23 回合红方把吃到的宝打回 d1，落在己方半场，因为那是它唯一能进入的一半。',
  'This game was chosen from twenty engine games played the same way. All twenty are in the [companion study](/study/NUVBVjFf), one chapter each, with a note on where the engine’s evaluation says the game turned.':
    '这盘棋选自二十盘以同样方式生成的引擎对局。二十盘全部收录在[配套研究](/study/NUVBVjFf)里，每盘一章，并注明引擎评估认为局势发生转折的时刻。',

  // -- How Misty Plays --
  'Misty is the bot you play on Mistboard in Fog of War chess. It is not allowed to peek. The server sends it the same kind of limited view a human player gets, then Misty has to choose a move from that uncertainty.':
    'Misty 是你在 Mistboard 迷雾国际象棋中对弈的机器人。它不允许偷看。服务器只会向它发送与人类玩家同类的受限视野，然后 Misty 必须在这种不确定性中选择着法。',
  'It plays under the same fog you do': '它和你在同一片迷雾下对弈',
  'Misty never sees the canonical board. Each move, it gets only what the side to move can legally observe under Fog of War: its own pieces, the squares they see, and the captures in view. Everything else is hidden. It plays under the same rules you do, and you can verify that: Mistboard is open source, so anyone can audit the server code that enforces the fog before the engine sees a position.':
    'Misty 永远看不到规范真实棋盘。每一步，它只会得到轮到走棋的一方在迷雾国际象棋规则下可以合法观察的内容：自己的棋子、这些棋子能看见的格子，以及视野内发生的吃子。其余一切都被隐藏。它与你遵守相同规则，而且这一点可以验证：Mistboard 是开源的，任何人都能审计在引擎看到局面之前执行迷雾规则的服务器代码。',
  'A classical chess engine like Stockfish has one advantage: it can see the whole board. It picks its move by searching the game tree, looking ahead through the lines both sides could play and backing up the best line (minimax). The search assumes a single true position and a single true continuation.':
    'Stockfish 这样的经典国际象棋引擎有一个优势：它能看到整个棋盘。它通过搜索博弈树来选择着法，向前推演双方可能走出的变化，再回传最佳变化的价值（极小化极大算法）。这种搜索假设只有一个真实局面和一条真实的延续。',
  "Under fog there is no single position to search. Misty can't see the opponent's pieces, so the board it has to reason about is a belief set: many legal boards consistent with what it has observed. A move that wins on one board can hang the king on another. Misty samples from that set, searches those worlds, and looks for a move that holds up across them.":
    '迷雾下不存在一个可供搜索的单一局面。Misty 看不到对手的棋子，因此它必须推理的是一个信念集合：许多与已观察信息一致的合法棋盘。同一步棋可能在一个棋盘上获胜，却在另一个棋盘上白送国王。Misty 从集合中采样，搜索这些可能世界，并寻找在它们之中都站得住脚的着法。',
  'Sampling boards and searching them is the straightforward part. Combining the answers is where fog chess stops behaving like chess, and Misty borrows its method from poker: it minimizes regret across the sampled worlds, converging toward a strategy an opponent cannot exploit, instead of taking the move with the best average score. Obscuro, the strongest published Fog of War chess engine, works the same way. The hard part is keeping that model faithful to what has actually been observed while the clock is running.':
    '采样棋盘并搜索它们是相对直接的部分。真正让迷雾国际象棋不再像国际象棋的，是如何汇总这些答案；Misty 的方法借自扑克：它在采样出的各个可能世界上最小化遗憾值，逐步收敛到一个对手无法利用的策略，而不是选择平均分最高的着法。公开发表的最强迷雾国际象棋引擎 Obscuro 采用同样的思路。难点在于，在时钟不停走动时，让这个模型始终忠于已经观察到的信息。',
  "What's hard": '难点在哪里',
  'Two things. The first is the possible-board set itself. A few plies into a foggy middlegame, "every consistent board" blows up fast. Misty has to keep that uncertainty under control inside a live-game time budget.':
    '有两个难点。第一个就是可能棋盘的集合本身。迷雾中局只走几个回合步后，「所有一致的棋盘」数量就会迅速爆炸。Misty 必须在实时对局的时间预算内控制这种不确定性。',
  'The second is picking a move over that set. Scoring one move means weighing it across thousands of possible boards at once, and the obvious way to do that, averaging the outcomes, quietly buries disasters. A move that loses the king on a small slice of boards may barely move the average, but it still loses those games outright. Reasoning well over a distribution of boards, rather than a single board, is most of what the engine does.':
    '第二个难点是在这个集合上选择着法。为一步棋评分，意味着同时衡量它在数千个可能棋盘上的表现；最直观的办法是取结果平均值，却会悄悄掩埋灾难。如果一步棋只在少部分棋盘上丢王，平均分可能几乎不变，但那些对局仍会直接输掉。引擎的大部分工作，就是针对棋盘分布而非单一棋盘进行可靠推理。',
  'What changed in the current release': '当前版本有哪些变化',
  'The current production engine is Misty 1.6. Most of the work since the first public release has been hardening, not a new personality: avoid rare king walks into hidden captures, avoid major-piece hangs in fog, stop stale search memory from leaking into a new live position, see fog-castles during search, and steer away from unstable early lines with a small opening book. Version 1.6 closes one specific queen hang. The safety check that vetoes catastrophic captures was subtracting the value of the piece being taken, so giving up a queen for a defended rook scored as a small loss rather than a disaster, and Misty walked into it in two real games before the floor that catches it shipped.':
    '当前生产引擎是 Misty 1.6。首次公开发布后的大部分工作都在加固，而不是塑造新个性：避免国王偶尔走进隐藏吃子范围，避免大子在迷雾中白送，阻止过期的搜索记忆泄漏到新的实时局面，在搜索中看见迷雾下的王车易位，并用小型开局库避开不稳定的早期变化。1.6 版修正了一处特定的白送皇后问题：否决灾难性吃子的安全检查会先减去被吃棋子的价值，于是用皇后换一个有保护的车只被算作小亏而不是灾难；在这道下限修好之前，Misty 在两盘真实对局中都走进了这个陷阱。',
  'The engine is open source': '引擎已开源',
  "Misty's source is on GitHub under the GPL, and it installs from PyPI as misty-chess. What ships is the fog chess engine itself: the belief enumerator, the search, the guards that veto a catastrophic move at commit time, and the test suite that holds the Rust and Python implementations to byte-for-byte agreement at every ply. The variant siblings and the research lab stay private.":
    'Misty 的源代码以 GPL 协议发布在 GitHub 上，也可以从 PyPI 安装，包名是 misty-chess。公开的部分就是迷雾国际象棋引擎本身：信念枚举器、搜索、在提交着法时否决灾难性选择的守卫，以及要求 Rust 与 Python 两套实现在每一步都逐字节一致的测试套件。变体同系引擎与研究实验代码仍然是私有的。',
  'Obscuro is not public. So as far as I can find, Misty is the only Fog of War chess engine built on that architecture that anyone else can run, read, or take apart, and that is most of the reason to publish it.':
    'Obscuro 并未公开。因此据我所知，Misty 是唯一一个基于该架构、并且其他人可以运行、阅读和拆解的迷雾国际象棋引擎，这也是把它开源的主要理由。',
  'Misty on GitHub': 'GitHub 上的 Misty',
  'That does not make Misty solved or perfectly safe. It means the cheap fog-specific failures that made earlier versions look silly are much rarer, so games against it test your understanding instead of your patience.':
    '这并不意味着 Misty 已被彻底解决或绝对安全。它意味着那些让早期版本显得可笑的低级迷雾特有错误已经少见得多，因此与它对弈考验的是你的理解，而不是耐心。',
  'Where it stands': '它目前处于什么水平',
  "Misty is the strongest Fog of War chess engine I've seen available to play, but version numbers are not ratings. The yardstick that matters is human play, and I won't put a number on it until a serious human match earns one.":
    'Misty 是我见过可以直接对弈的最强迷雾国际象棋引擎，但版本号不是等级分。真正有意义的标尺是人类实战；在一场严肃的人机比赛给出依据之前，我不会为它标上数字。',
  "What's next": '下一步是什么',
  'Misty itself stays focused on Fog of War chess. The same redacted engine protocol now supports variant-specific siblings, including Misty DMX for Dark Mini Xiangqi and MistyBanqi for Banqi, but those are separate engines with their own rules and evaluation problems.':
    'Misty 本身会继续专注于迷雾国际象棋。同一套脱敏引擎协议现在也支持针对特定变体的同系引擎，包括迷雾迷你象棋的 Misty DMX 和暗棋的 MistyBanqi，但它们是独立引擎，各有自己的规则与评估问题。',
  "Misty is live on Mistboard, and every serious game against it sharpens the estimate of where it stands. Play one, and you're part of the benchmark.":
    'Misty 已在 Mistboard 上线，每一盘严肃的人机对局都会让我们更准确地估计它的水平。来下一盘，你也会成为这项基准的一部分。',
  'All articles': '全部文章',
  'For engine builders': '致引擎开发者',
  "If you build Fog of War engines, I'd like to play yours against Misty. There's almost no public head-to-head data between engines for this variant, and engine-vs-engine games are the cleanest way to see where any of them stand. Get in touch and we'll set up a match.":
    '如果你在开发迷雾国际象棋引擎，我希望让它与 Misty 对弈。这个变体几乎没有公开的引擎正面对战数据，而引擎之间的比赛是判断各自水平最清晰的方式。联系我们，我们可以安排一场比赛。',
  'Get in touch': '联系我们',
  References: '参考资料',
  '[Obscuro (Zhang & Sandholm, ICLR 2026)](https://arxiv.org/abs/2506.01242). The academic neighbor is Reconnaissance Blind Chess, whose engine lineage runs StrangeFish (CMU, 2018), ReBeL (FAIR, 2020), Penumbra (Georgia Tech), and Obscuro (CMU, 2026).':
    '[Obscuro（Zhang 与 Sandholm，ICLR 2026）](https://arxiv.org/abs/2506.01242)。与之相邻的学术领域是侦察盲棋，其引擎谱系包括 StrangeFish（CMU，2018）、ReBeL（FAIR，2020）、Penumbra（Georgia Tech）和 Obscuro（CMU，2026）。',

  // -- Programming Fog Chess with Server-Side Truth --
  'Truth stays server-side': '真实局面留在服务器端',
  'The triptych is the architecture in miniature. The center board exists only on the server. White and Black each receive a different projection, and neither projection contains the full truth with a visual layer hiding it.':
    '这组三联棋盘就是整个架构的缩影。中央棋盘只存在于服务器上。白方与黑方各自收到不同的投影视图，任何一份投影都不是用视觉图层遮住完整真实局面。',
  'The rule is simple: compute truth once, project the allowed view per seat, and keep the full event log private until the game is over.':
    '规则很简单：只计算一次真实状态，再为每个席位投影其获准看到的视图，并在对局结束前将完整事件日志保持私密。',
  'That single boundary supports live PvP, engine games, calibration, tournaments, and review. This article stays focused on the player-facing live room: what each browser receives, who can receive it, and when the record becomes public.':
    '这一条边界同时支撑实时玩家对战、引擎对局、校准、赛事和复盘。本文聚焦面向玩家的实时房间：每个浏览器会收到什么、谁可以接收，以及对局记录何时公开。',
  'How views are computed': '视图如何计算',
  'For a player, the boundary is `PlayerView`: visible squares, visible pieces, legal moves, status, and clock for that seat. Opponent pieces outside the visibility set are not hidden fields. They are absent.':
    '对玩家而言，这条边界就是 `PlayerView`：该席位可见的格子、可见棋子、合法着法、状态和时钟。可见范围之外的对方棋子不是被藏在字段里，而是根本不存在于数据中。',
  'The important part is the direction of dependency. The client can render fog because it receives a visibility mask, but it cannot remove fog to recover pieces it was never sent.':
    '关键在于依赖方向。客户端因为收到可见性掩码而能够渲染迷雾，却无法通过移除迷雾来恢复从未发送给它的棋子。',
  'Sample data payload': '示例数据载荷',
  'The live move stream uses `event-appended`, a per-move frame. This is the white payload from the position above, shortened to the fields that matter:':
    '实时走子流使用 `event-appended`，每步发送一帧。下面是上方局面中发给白方的载荷，已缩减为关键字段：',
  '**Core fields:** `seat` identifies the recipient, `seq` orders the stream, `state.board` is the redacted board, `state.visibleSquares` is the clear-vs-fog mask, and `state.status` carries the canonical turn/result state.':
    '**核心字段：**`seat` 标识接收者，`seq` 为数据流排序，`state.board` 是脱敏后的棋盘，`state.visibleSquares` 是清晰区域与迷雾区域的掩码，`state.status` 携带规范的轮次与结果状态。',
  'If the appended event is visible to this seat, the frame includes one filtered `event`. If the move is hidden, `event` is omitted and the projected `state` still advances. The player knows a turn happened, not what happened in the fog.':
    '如果新增事件对该席位可见，这一帧会包含一个经过过滤的 `event`。如果走子被隐藏，`event` 会被省略，但投影后的 `state` 仍会推进。玩家知道一回合已经发生，却不知道迷雾中发生了什么。',
  'Snapshots still exist for first connect, explicit recovery, and final resync. They carry the filtered event history needed to hydrate the client, so they are larger than per-move frames.':
    '首次连接、显式恢复和最终重新同步仍会使用快照。快照携带客户端初始化所需的过滤事件历史，因此比逐步帧更大。',
  'Player move': '玩家走子',
  'A move request is just coordinates:': '走子请求只有坐标：',
  'The server validates the request against canonical state, applies the move, appends an event, and projects the next view. The client never decides whether hidden information exists, whether an invisible move happened, or whether the game is over.':
    '服务器根据规范状态验证请求，执行走子，追加事件，再投影下一份视图。客户端永远不负责判断是否存在隐藏信息、是否发生了不可见走子，或对局是否结束。',
  'Seat-gated live rooms': '按席位控制的实时房间',
  'During a live game, the server sends game data only to the two seats. After each move, it projects one view for White and one view for Black, then sends each view only to a socket that has proven it controls that seat.':
    '实时对局期间，服务器只向两个对局席位发送游戏数据。每步之后，它分别为白方和黑方投影一份视图，再将每份视图只发送给已经证明自己控制该席位的套接字。',
  'Seat proof': '席位证明',
  'A socket gets live room data only after it proves control of the white or black seat. Anonymous seats use random bearer tokens; the server stores a SHA-256 token hash and compares the presented token in constant time.':
    '套接字只有在证明自己控制白方或黑方席位后，才能获得实时房间数据。匿名席位使用随机不记名令牌；服务器保存 SHA-256 令牌哈希，并以恒定时间比较提交的令牌。',
  'Account seats': '账号席位',
  'Signed-in seats add the account session check on top of the seat claim. The token proves this browser can reclaim the seat; the session proves the account still matches the seat assignment.':
    '已登录席位会在席位声明之上增加账号会话检查。令牌证明该浏览器可以取回席位；会话则证明账号仍与席位分配相符。',
  'No live spectator view': '没有实时观战视图',
  'Non-players do not get a live spectator projection. A socket without a valid seat is rejected before room data is sent, and the live replay endpoint returns 403 until the game reaches a terminal state.':
    '非对局玩家不会获得实时观战投影。没有有效席位的套接字会在房间数据发送前被拒绝，而实时回放端点会一直返回 403，直到对局进入终局状态。',
  'Postgame review': '赛后复盘',
  'When the game becomes terminal, the privacy rule changes. The room no longer rejects non-players after the result, and the game page becomes the durable public review surface.':
    '对局进入终局状态后，隐私规则随之改变。结果产生后，房间不再拒绝非对局玩家，游戏页面则成为持久的公开复盘界面。',
  'A spectator who opens the room during play gets no board. The same person can open the finished game page after the result and inspect the event log. That is the product rule: private while decisions are live, reviewable once the record is settled.':
    '观众在对局进行时打开房间，看不到棋盘。结果产生后，同一个人可以打开已结束的游戏页面并检查事件日志。这就是产品规则：决策仍在进行时保持私密，记录确定后可以复盘。',
  'That split is important for rated play. A rated result can point at a public completed game without giving non-players access to live hidden information.':
    '这种区分对计分对局很重要。计分结果可以指向一盘公开的已完成对局，同时不让非对局玩家接触实时隐藏信息。',
  'It also keeps reconnect and review on the same foundation. Live reconnect rebuilds a filtered player view from the event log. Postgame review uses the same log after the hidden-information constraint has expired.':
    '它也让重连与复盘建立在同一基础上。实时重连从事件日志重建过滤后的玩家视图；隐藏信息限制失效后，赛后复盘使用同一份日志。',
  'Scope and verification': '范围与验证',
  'This is not a full anti-cheat claim. It is the narrower integrity claim this architecture can prove: during live play, hidden truth is not sent to unauthorized browser paths; after the game ends, the record is reviewable.':
    '这并不是一项完整的反作弊声明，而是该架构能够证明的、更具体的完整性保证：实时对局期间，隐藏真实状态不会发送到未经授权的浏览器路径；对局结束后，记录可供复盘。',
  'Anonymous casual seats are bearer-token seats, not account-grade identity, and there is no live spectator mode for hidden-information games.':
    '匿名休闲席位依靠不记名令牌，并不具备账号级身份保证；隐藏信息游戏也没有实时观战模式。',
  'Mistboard covers this boundary with WebSocket and payload regression tests that drive real moves and assert on the bytes each seat receives.':
    'Mistboard 用 WebSocket 与载荷回归测试覆盖这条边界：测试会执行真实走子，并断言每个席位实际收到的字节。',
  'That is the line Mistboard defends: during play, there is no browser-side truth to unmask. After play, there is a public record to inspect.':
    '这就是 Mistboard 守住的界线：对局期间，浏览器端没有可以揭开的真实局面；对局结束后，则有公开记录可供检查。',

  // -- How MistyBanqi Plays (engine article) --
  'How MistyBanqi Plays': 'MistyBanqi 是怎么下棋的',
  'MistyBanqi is the engine you play in Banqi on Mistboard: a classical search engine with a hand-written evaluation. How it thinks, and the blind spot worth knowing: it can draw a game it has already won.':
    'MistyBanqi 是你在 Mistboard 上对弈暗棋时面对的引擎：一个采用手写评估的经典搜索引擎。它如何思考，以及一个值得知道的盲点：它会把已经赢定的棋下成和棋。',
  'How it thinks': '它如何思考',
  "Banqi hides information in its own way: every tile starts face-down, and flipping one reveals a random piece from the bag of what's left. So unlike chess, the engine's search tree mixes ordinary moves with chance events. MistyBanqi treats a flip as a chance node, averaging over the pieces the tile might turn out to be, and otherwise searches like a classical chess engine: it looks ahead through the lines both sides could play and backs up the value of the best one.":
    '暗棋以自己独特的方式隐藏信息：每枚棋子起初都背面朝下，翻开一枚，就会从剩下的棋子里随机翻出一枚。因此和国际象棋不同，引擎的搜索树里既有普通着法，也有随机事件。MistyBanqi 把翻子当作一个概率节点，对这枚棋子可能翻出的各种身份取加权平均；其余部分则像经典国际象棋引擎那样搜索：向前推演双方可能走的着法，再把最佳一路的价值回传上来。',
  "What it can't do is judge a position by feel. Every leaf of that search gets scored by a hand-written evaluation: material on a corrected value table (the cannon, which captures by jumping a screen, is the most dangerous piece on the board), how many squares each piece controls, how exposed the general is, and a handful of other terms. The engine is only as good as those terms, which is where the weakness below comes from.":
    '它做不到的是凭感觉判断局面。这棵搜索树的每个叶子节点，都由一套手写的评估来打分：基于一张修正过的子力价值表的子力（炮靠隔子吃，是盘面上最危险的棋子）、每枚棋子控制多少格、将帅有多暴露，以及另外一些项。引擎的水平完全取决于这些项的好坏——下面要讲的弱点正源于此。',
  'Most of the time, it wins': '大多数时候，它会赢',
  "MistyBanqi will beat most people, and it does it the way a classical engine does: by calculating captures several moves deep. Step through a game where it clears the board. Banqi swings with the flips, so it even fell behind on material early here, then worked its way back until the opponent had no piece left to move. Tiles flip to their dealt piece the first time they're turned over.":
    'MistyBanqi 能赢过大多数人，而它取胜的方式正是经典引擎的方式：往前算上好几步的吃子。逐步回放下面这盘它把对手清光的棋。暗棋的局势随翻子起伏，这盘里它开局甚至一度子力落后，随后一步步扳了回来，直到对手没有棋子可走。每枚棋子第一次被翻开时，会翻出它所发到的身份。',
  'That kind of capture-by-capture calculation is the strong half of its game. The blind spot is the other half: what happens when the win needs no more captures, just patience.':
    '这种一子一子算下去的计算，是它棋力强的那一半。盲点是另一半：当胜利不再需要吃子、只需要耐心时，会发生什么。',
  'It can draw a game it has won': '它会把赢定的棋下成和棋',
  'Here is the same engine in a position it has completely won. It is up ten pieces to two, with nothing left to capture, and the only task is to walk the win home. It draws instead.':
    '同样这个引擎，下面处在一个它已经完全赢定的局面。它以十子对两子领先，已经没有子可吃，唯一要做的就是把胜势走到底。结果它却下成了和棋。',
  "Nothing in the evaluation rewards converting a won position over just holding material, so a position it's winning by a mile and a position it has actually won score about the same. With no term pushing it to make progress, it shuffles, and Banqi's threefold-repetition rule ends the game a draw.":
    '评估里没有任何一项会因为「把优势转化为胜利」而比「单纯守住子力」给更高的分，于是一个遥遥领先的局面和一个真正已经赢下的局面，得分几乎一样。既然没有哪一项促使它取得进展，它就只是来回挪子，而暗棋的三次重复局面规则便把这盘判成和棋。',
  "There's an upshot for you here. If you're losing on material, you're not necessarily lost: herd one of its strong pieces into a perpetual chase, and MistyBanqi may walk into the draw it can't see it should decline.":
    '这对你有个实用的启示。如果你子力落后，并不一定就输了：用长捉缠住它的一枚大子，MistyBanqi 可能就一头走进那个它看不出自己本该拒绝的和棋。',
  'It can also lose its own general': '它也可能丢掉自己的将帅',
  'A related blind spot involves the general. A soldier is the only piece that can capture it, and the engine is slow to make room for a general boxed into a corner. It will sometimes march a piece off to the far side of the board while a lone enemy soldier walks up and traps it. Same gap as the draw above: the evaluation has no real sense of a slow, quiet threat building several moves away.':
    '另一个相关的盲点和将帅有关。只有兵（卒）能吃将帅，而当将帅被逼到角落时，引擎迟迟不为它腾出退路。有时它会把一枚棋子调到棋盘另一头，任由一枚孤零零的敌方兵走上来把将帅困死。这和上面的和棋是同一类毛病：评估对一个缓慢、安静、还要好几步才成形的威胁，没有真正的感觉。',
  'How each of these was found, reproduced, and measured is written up in detail in the engineering post linked below.':
    '这些问题各自是如何被发现、复现并量化的，下面链接的工程博客文章里有详细记录。',
  'Why these exist, and what’s next': '为什么会有这些问题，以及下一步',
  "These are the limits of a hand-written evaluation: it can only value what someone thought to encode, and conversion and slow king-hunts are exactly the long-horizon calls that are hard to write down. The fix the strongest Dark Chess programs use is a learned evaluation, trained from game outcomes, which lets the engine judge these on its own. That's the eventual next step for MistyBanqi. Until a learned version clears the current engine's bar in testing, the hand-written one is what you play: strong, and honest about where it cracks.":
    '这些是手写评估的局限：它只能给有人想到要编码进去的东西打分，而「把胜势转化为胜利」和「缓慢围猎将帅」恰恰是那种很难写成规则的长程判断。最强的暗棋程序采用的解法，是一套从对局胜负中学习得到的评估，让引擎能自己判断这些。这也是 MistyBanqi 终将迈出的下一步。在学习版于测试中越过现有引擎这道门槛之前，你面对的仍是手写版：强，且对自己会在哪里出问题保持坦诚。',
  'Play it': '来下一盘',
  'MistyBanqi is live on Mistboard. Take it on at the strength you pick, or read the full writeup of how it was built and measured.':
    'MistyBanqi 已在 Mistboard 上线。来按你选择的强度挑战它，或阅读它如何被构建与衡量的完整记录。',
  'The engineering story': '工程幕后故事',
  Human: '人类',
  'Human vs engine · mistboard.com': '人类对引擎 · mistboard.com',
  'Human vs engine': '人类对引擎',
  'Draw by repetition · MistyBanqi up 10 pieces to 2': '重复局面和棋 · MistyBanqi 十子对两子领先',
  'MistyBanqi wins · the opponent is left with no piece to move':
    'MistyBanqi 获胜 · 对手已无子可走',
  "MistyBanqi (Red) is up ten pieces to two, a trivially won position, but its evaluation gives no reward for converting a win over holding material, so it shuffles instead of pressing and the game is drawn by threefold repetition. If you're losing on material against it, this is the escape: herd a strong piece into a perpetual chase and it may let the draw happen.":
    'MistyBanqi（红方）以十子对两子领先，是一个轻松赢定的局面，但它的评估并不会因为「把优势转化为胜利」而比「守住子力」给更高的分，于是它只来回挪子、不去逼抢，最终因三次重复局面被判和棋。如果你对它子力落后，这就是脱身之道：用长捉缠住一枚大子，它也许就放任和棋发生。',
  'MistyBanqi (the first player) won this one outright, leaving the opponent with nothing to move. Banqi swings hard with the flips: it fell behind on material early here, then calculated its way back and cleared the board. Grinding down a position like this, capture by capture, is the strong half of its game.':
    'MistyBanqi（先手）干净利落地赢下了这盘，让对手无子可走。暗棋的局势随翻子剧烈起伏：这盘里它开局子力落后，随后凭计算一步步扳回，把对手清光。像这样一子一子地碾下去，是它棋力强的那一半。',

  // -- Article index cards --
  'How Misty Plays': 'Misty 是怎么下棋的',
  "Misty is Mistboard's Fog of War chess engine: how it sees, searches possible boards, avoids hidden catastrophes, and where the current version stands.":
    'Misty 是 Mistboard 的迷雾国际象棋引擎：它如何观察、搜索可能局面、避开隐藏灾难，以及当前版本处在什么水平。',
  'How Mistboard keeps hidden information on the server: canonical state, seat-scoped views, private live rooms, and public postgame review.':
    'Mistboard 如何把隐藏信息留在服务器端：规范真实局面、按座位投影视野、私密实时房间，以及公开的赛后复盘。',

  // -- Drop Mini Xiangqi (rules) --
  'Drop Mini Xiangqi Rules': '投放迷你象棋规则',
  'Mini Xiangqi with reserves: captured pieces enter your hand, then drop back outside the enemy palace.':
    '带持子的迷你象棋：被吃的棋子进入你的手牌，然后可以打回棋盘，但不能打入对方九宫。',
  'Drop Mini Xiangqi is [Mini Xiangqi](/rules/mini-xiangqi) with a reserve. The board is still 7 by 7, Red still moves first, and the general is protected by check and checkmate. The new rule is simple: captured pieces become yours, wait in your hand, and can return to the board as drops.':
    '投放迷你象棋是在[迷你象棋](/rules/mini-xiangqi)里加入持子。棋盘仍是 7×7，红方仍先走，将帅仍受将军与将死规则保护。新规则很简单：你吃掉的棋子会变成你的棋子，进入手牌，并可以通过打入回到棋盘。',
  'That reserve turns captures into future initiative. A quiet exchange can become a cannon drop, a soldier screen, or a new chariot lane several moves later.':
    '持子会把吃子变成之后的主动权。一次安静的交换，几步之后可能变成一次炮的打入、一个兵的炮架，或一条新的车路。',
  'Board and pieces': '棋盘与棋子',
  'The starting position, board, and movement are Mini Xiangqi. There are no advisors or elephants, no river, and each general remains inside its 3 by 3 palace.':
    '初始局面、棋盘与走法都沿用迷你象棋。没有士象、没有河界，每一方的将帅仍留在自己的 3×3 九宫内。',
  'This is open information. Both players see the whole board and both reserves. Unlike Dark Mini Xiangqi, there is no fog and no hidden move record.':
    '这是信息公开的游戏。双方都能看到整个棋盘和双方持子。不同于迷雾迷你象棋，这里没有迷雾，也没有隐藏的走子记录。',
  'Captures and reserves': '吃子与持子',
  'When you capture a non-general piece, it leaves the board, changes to your color, and enters your reserve. Generals are never captured and never enter a reserve: attacks on the general are checks, and a player in check must answer the threat.':
    '当你吃掉一枚非将帅棋子时，它离开棋盘，改为你的颜色，并进入你的持子。将帅永远不会被吃进持子：攻击将帅是将军，被将军的一方必须应对威胁。',
  'Instead of moving a board piece, you may drop one piece from your reserve onto an empty point outside the enemy palace. A dropped piece is live immediately: it can give check on the drop turn and moves normally on later turns.':
    '你可以不移动棋盘上的棋子，而是从持子中选择一枚，打入到对方九宫以外的空交叉点。打入的棋子立即生效：它可以在打入当手将军，之后也按正常走法移动。',
  'Drop restrictions': '打入限制',
  "Drops must land on empty points, and they cannot land inside the opponent's 3 by 3 palace. The current Mistboard rules allow chariots, horses, cannons, and soldiers in reserve. Generals never enter reserve.":
    '打入必须落在空交叉点，且不能落入对方的 3×3 九宫。目前 Mistboard 规则允许车、马、炮、兵进入持子。将帅永不进入持子。',
  'A dropped soldier follows Mini Xiangqi soldier movement after it lands: one point forward or sideways, never backward. Drops may give check immediately, and a drop is illegal if it leaves your own general in check.':
    '打入的兵落子后按迷你象棋的兵法移动：向前或横向走一个交叉点，永不后退。打入可以立即将军；如果一次打入会让自己的将帅仍处于被将军状态，则该打入不合法。',
  'Check and endings': '将军与终局',
  'Win by checkmate. As in Mini Xiangqi, a player with no legal move loses rather than drawing by stalemate. Games can also end by repetition, the no-capture rule, timeout, resignation, or abandonment.':
    '以将死获胜。与迷你象棋一样，没有合法着法的一方判负，而不是因困毙作和。对局也可能因重复局面、无吃子规则、超时、认输或弃局而结束。',
  'Step through this longer engine-lab game. It uses the current no-enemy-palace drop rule, shows both sides using reserves to defend and counterattack, and ends only after Black converts a late chariot attack.':
    '逐步重演这盘较长的引擎实验对局。它采用当前的不得打入对方九宫规则，展示双方如何用持子防守和反击，最终由黑方在后期车攻中转化胜势。',
  'FSF Red': 'FSF 红方',
  'FSF Black': 'FSF 黑方',
  'Fairy-Stockfish lab, no-enemy-palace drops': 'Fairy-Stockfish 实验局，不得打入对方九宫',
  "Black checkmates with 57...g1-f1. The final chariot capture beats Red's last defensive drop on f1.":
    '黑方以 57...g1-f1 将死。最后的车吃子击破了红方在 f1 的最后一次防守打入。',
  'Drop Mini Xiangqi is open for alpha play on Mistboard. You can play the Fairy Stockfish bot, create an invite for a friend, or find an open game from the homepage play panel by choosing Drop Mini Xiangqi in the Variant row.':
    '投放迷你象棋已在 Mistboard 开放 Alpha 对弈。你可以在首页对弈面板的“Variant”一行选择投放迷你象棋，对战 Fairy Stockfish 机器人、创建好友邀请，或寻找一局公开对局。',
  'Play the bot': '对战机器人',
  'Find opponent': '寻找对手',
  // -- Mini Xiangqi (rules) --
  'Mini Xiangqi rules, the 7×7 primer behind Dark Mini Xiangqi: no advisors or elephants, no river, sideways soldiers, and checkmate to win.':
    '迷你象棋规则，迷雾迷你象棋的 7×7 入门基础：没有士象、没有河界、兵可横走，以将死取胜。',
  'Mini Xiangqi was invented in 1973 by Shigenobu Kusumoto of Osaka, Japan. Xiangqi itself is many centuries older: see [Xiangqi rules](/rules/xiangqi). Mini Xiangqi is a simplified, reduced version of it, with a smaller board, fewer pieces, and no river.':
    '迷你象棋由日本大阪的楠本茂信于 1973 年发明。象棋本身要早上许多个世纪，见[象棋规则](/rules/xiangqi)。迷你象棋是它的简化精简版本：棋盘更小、棋子更少，且没有河界。',
  'This page describes the open-information base game. Mini Xiangqi is not playable on Mistboard; this is reference only.':
    '本页介绍的是信息公开的底层游戏。迷你象棋不能在 Mistboard 上对弈，本页仅作参考。',
  'Board and setup': '棋盘与布局',
  'Mini Xiangqi is xiangqi compressed onto a 7 by 7 board with a smaller army. The advisors and elephants are dropped and there is no river, but each general still keeps a 3 by 3 palace.':
    '迷你象棋是把象棋压缩到 7×7 棋盘、并削减子力的版本。去掉了士和象，也没有河界，但每一方的将帅仍保有一个 3×3 的九宫。',
  'Piece movement': '棋子走法',
  'Every piece except the soldier moves exactly as it does in [xiangqi](/rules/xiangqi).':
    '除兵（卒）以外，每种棋子的走法都与[象棋](/rules/xiangqi)完全相同。',
  '**Soldier:** a soldier moves and captures one point forward or sideways, never backward. With no river to cross, it has that sideways freedom from its very first move, unlike a soldier on the full xiangqi board.':
    '**兵（卒）：**兵向前或横向走一个交叉点并以此吃子，永不后退。由于没有河界可过，它从第一步起就拥有横走的自由，这与完整象棋棋盘上的兵不同。',
  'Facing generals are illegal here too. The two generals may never sit on the same open file with nothing between them, so a move that would expose that line is not allowed.':
    '将帅对脸在这里同样不合法。双方的将帅不能处在中间无子的同一条纵线上，因此任何会暴露这条直线的走法都不被允许。',
  'Winning and draws': '胜负与和棋',
  'Checkmate wins. As in xiangqi, a player who has no legal move loses rather than drawing by stalemate, and perpetual check or perpetual chase is not a free draw: a player who repeats an endless attack loses instead.':
    '将死即获胜。与象棋一样，没有合法走法的一方判负，而非因困毙而和棋；长将或长捉也不能用来免费求和：不断重复同样进攻的一方反而判负。',
  'A game is drawn when neither side has enough material to checkmate, when a long run of moves passes with no capture (xiangqi caps this much like chess’s fifty-move rule), or by a repetition that breaks none of the perpetual rules. These outcomes follow from the position, not from one player choosing to stop.':
    '当任何一方都没有足够的子力将死对方、长时间无吃子（象棋对此设有上限，类似国际象棋的五十回合规则），或出现不违反上述长打规则的重复局面时，对局判和。这些结果都由局面决定，而非某一方主动选择停手。',
  'A complete game': '一盘完整对局',
  'Mini Xiangqi has no canon of famous human games, so to watch the full army work together, step through a game in which Fairy-Stockfish, a strong open-source engine, plays both sides with full information. Notice how fast the chariots and cannons open lines: on a tight 7 by 7 board with no river, the generals come under fire far sooner than in full xiangqi.':
    '迷你象棋没有著名的人类对局传统，因此若想看全部子力协同作战，可以逐步重演一盘由强大的开源引擎 Fairy-Stockfish 在完全信息下执双方对弈的棋局。注意车和炮开线有多快：在紧凑、无河界的 7×7 棋盘上，将帅遭受火力的时间远比完整象棋来得早。',
  'Mini Xiangqi is not one of the games you can play here. Xiangqi is: the full 9 by 10 game this one reduces, against an engine or a friend.':
    '迷你象棋不在本站可下的棋类之列，象棋则可以：那是被它精简的完整 9×10 棋局，可以对战引擎或好友。',
  'Play xiangqi': '下象棋',

  // -- Dark Mini Xiangqi (rules) --
  'Mini Xiangqi under Fog of War: each side sees only the points its pieces reach on the 7×7 board, and the general falls by capture.':
    '战争迷雾下的迷你象棋：在 7×7 棋盘上，每一方只能看到己方棋子可及的交叉点，将帅由被吃而落败。',
  'Fog Xiangqi readers who want the smaller experimental ruleset Mistboard is testing first.':
    '想了解 Mistboard 正在先行测试的小型实验规则的迷雾象棋读者。',
  '[Mini Xiangqi](/rules/mini-xiangqi) played with Fog of War: each player sees only their own pieces and the enemy pieces their army can reach. The board is 7 by 7, and the game ends by capturing the opposing general. If you know Mini Xiangqi, the sections below explain only what fog changes.':
    '在战争迷雾下进行的[迷你象棋](/rules/mini-xiangqi)：每位玩家只能看到己方棋子，以及己方子力可及的敌方棋子。棋盘为 7×7，以吃掉对方将帅结束对局。如果你已经会下迷你象棋，下面各节只讲解迷雾改变了什么。',
  'Board and fog': '棋盘与迷雾',
  'The board and army are the same as Mini Xiangqi. Fog of War then hides the board: you see your own pieces and every point they can reach, and everything else is fog.':
    '棋盘和子力与迷你象棋相同。战争迷雾随后遮住棋盘：你能看到己方棋子以及它们可及的每个交叉点，其余一切都是迷雾。',
  'The opening position from three angles. Red and Black each see only their own side clearly, while the server holds the true board in the middle. Vision is recomputed after every move, so opening a line or losing a piece immediately changes what each player knows.':
    '从三个视角看开局局面。红方与黑方各自只能清楚看到自己的一侧，而中间由服务器掌握真实棋盘。每走一步后视野都会重新计算，因此打开一条线路或失去一枚棋子都会立刻改变各方所掌握的信息。',
  'You never see enemy pieces outside your vision, whether a fogged point is empty, or the identity of a shrouded blocker.':
    '你永远看不到视野之外的敌方棋子，也看不到被迷雾遮住的交叉点是否为空，更看不到被遮蔽的阻挡子是什么。',
  'Capture the general to win. There is no checkmate and no check warning, so you can move into danger, leave your general exposed, or let the generals face each other across an open file.':
    '吃掉将帅即获胜。没有将死，也没有将军提示，因此你可以走入危险、让自己的将帅暴露，甚至让双方将帅在一条无遮挡的纵线上对脸。',
  "There is no stalemate draw: if the side to move has no legal move, it loses. With no check to freeze you, this almost never happens. Draws are judged from the true position, not either player's view: the game draws on threefold repetition, and also after 60 plies (30 moves by each side) without a capture.":
    '这里没有困毙判和：若轮到走子的一方没有合法着法，则判负。由于没有将军来限制你，这种情况几乎不会发生。和棋依据真实局面判断，而非任何一方各自的视野：对局会在三次重复局面时判和，也会在连续 60 个半回合（双方各 30 回合）无吃子时判和。',
  'Two pieces interact with fog in ways worth seeing up close.':
    '有两种棋子与迷雾的互动值得近距离一看。',
  'A cannon captures by jumping exactly one screen and landing on the first enemy piece beyond it. Under fog the rule is **screen shrouded, target revealed**: the screen shows as occupied but unidentified, the empty gap behind it stays fogged, and the capturable target is revealed as the enemy piece.':
    '炮吃子时正好越过一个炮架，落在其后的第一枚敌方棋子上。在迷雾下，规则是**炮架被遮、目标可见**：炮架显示为被占据但身份不明，其后的空隙仍处于迷雾中，而可吃的目标会直接显示为敌方棋子。',
  Horses: '马',
  'A horse moves one point orthogonally and then one diagonally outward, and cannot move if the leg point in between is occupied. If a hidden piece blocks the leg, the leg point shows as occupied but unidentified, and the destinations behind it drop out of your view.':
    '马先沿横竖方向走一个交叉点，再斜向外走一个交叉点；如果中间的马腿位置被占据，它就不能走。如果有一枚隐藏的棋子蹩住马腿，马腿位置会显示为被占据但身份不明，其后的落点则从你的视野中消失。',
  'A complete game under fog': '一盘迷雾下的完整对局',
  'To see the whole army work under Fog of War, step through a game where Mistboard’s engine, Misty DMX, plays both sides. Each ply is shown three ways: what Red can see, the server’s true board, and what Black can see.':
    '想看全部子力在战争迷雾下协同作战，可以逐步重演一盘由 Mistboard 引擎 Misty DMX 执双方对弈的棋局。每一手都以三种方式呈现：红方所见、服务器上的真实棋盘，以及黑方所见。',
  'Dark Mini Xiangqi is open for alpha play. You can play Misty DMX, create an invite, or find an opponent from the homepage play panel by choosing Dark Mini Xiangqi in the Variant row.':
    '迷雾迷你象棋现已开放 Alpha 对弈。你可以在首页对弈面板的“Variant”一行选择迷雾迷你象棋，然后对战 Misty DMX、创建邀请，或寻找对手。',
  'Play Misty': '对战 Misty',
  'Play Misty DMX': '对战 Misty DMX',
  'Create invite': '创建邀请',

  // -- Shogi4 (4x4 Shogi) --
  'Shogi4 (4×4 Shogi) Rules': 'Shogi4（4×4 将棋）规则',
  "The complete rules of Shogi4 (4x4 Shogi), Oca Studios' public-domain animal drop-shogi on a 4×4 board: how the Carp, Tapir, Raccoon-dog, Fox, and royal move, plus the friendly-jump, evolution, drops, and king-capture wins.":
    'Shogi4（4×4 将棋）的完整规则，由 Oca Studios 发布并进入公有领域的 4×4 棋盘动物打入将棋：鲤鱼、貘、狸、狐与王的走法，以及跳越友子、进化、打入与吃王取胜。',
  "Shogi4, also called 4x4 Shogi, is a drop-shogi played with animal tiles on a 4×4 board. It plays much like ordinary shogi shrunk to sixteen squares: pieces step in marked directions, captured pieces switch sides and drop back into play, and you win by taking the king. The one rule shogi players won't recognize is that a piece may hop over a friendly piece, added so your own pieces don't jam each other on a board this small.":
    'Shogi4（又称 4×4 将棋）是一种在 4×4 棋盘上用动物棋子进行的打入将棋。它玩起来很像缩小到十六格的普通将棋：棋子按棋面标示的方向走动，被吃的棋子改换阵营并可重新打入棋盘，吃掉王即获胜。唯一一条将棋玩家会感到陌生的规则是：棋子可以跳越一枚己方棋子，这是为了避免在这么小的棋盘上自己的棋子互相堵塞而加入的。',
  'Oca Studios released Shogi4 into the public domain in its "Four" series, free as a print-and-play set and as an app. Each player has five pieces: a Carp, a Tapir, a Raccoon-dog, a Fox, and a royal (a Crane for the first player, a Pheasant for the second).':
    'Oca Studios 在其「Four」系列中将 Shogi4 发布到公有领域，作为可打印自玩的套装和应用免费提供。每位玩家有五枚棋子：鲤鱼、貘、狸、狐，以及一枚王（先手为鹤，后手为雉）。',
  'The board and setup': '棋盘与摆子',
  "The board is 4×4, with a farm to either side that holds captured pieces. A tile's owner is shown by its facing: the first player's tiles point up the board, the second player's point down.":
    '棋盘为 4×4，两侧各有一个农场用来存放被吃的棋子。棋子的归属由朝向表示：先手的棋子朝向棋盘上方，后手的朝向下方。',
  'Every piece moves one square per turn, in the directions printed on its tile. On reaching the far row, each non-royal piece evolves, flipping to its evolved side. The pairs below show the base piece, then its evolved form, with a dot on every square each can reach (forward is up).':
    '每枚棋子每回合走一格，方向按棋面所印。到达最远一行时，每枚非王棋子都会进化，翻到其进化面。下面每一对依次展示基础棋子及其进化形态，并在各自能到达的每个格子上标一个点（上方为前进方向）。',
  '**Carp → Koi.** The Carp steps one square straight forward, a pawn. It evolves into a Koi, which moves as a silver from shogi.':
    '**鲤鱼 → Koi。**鲤鱼向正前方走一格，相当于将棋中的步兵。它进化为 Koi，走法与将棋中的银将相同。',
  '**Tapir → Baku.** The Tapir steps forward or to a forward diagonal. It evolves into a Baku, a silver.':
    '**貘 → Baku。**貘向前方或前斜方走一格。它进化为 Baku，走法同银将。',
  '**Raccoon-dog → Tanuki.** The Raccoon-dog steps one diagonal. It evolves into a Tanuki, a silver.':
    '**狸 → Tanuki。**狸向斜方走一格。它进化为 Tanuki，走法同银将。',
  '**Fox → Kitsune.** The Fox steps one orthogonal. It evolves into a Kitsune, which moves as a gold from shogi.':
    '**狐 → Kitsune。**狐向横竖方向走一格。它进化为 Kitsune，走法与将棋中的金将相同。',
  '**Crane / Pheasant.** The royal steps one square in any of the eight directions, a king. The two royals differ only in theme. It never evolves, and capturing it ends the game.':
    '**鹤 / 雉。**王可向八个方向中的任意一个走一格，相当于国际象棋的王。两种王仅在主题上不同。它永不进化，被吃掉即终局。',
  'Jumping over a friendly piece': '跳越友方棋子',
  'A piece can leap over a friendly piece. If an ally sits on the next square in a direction the piece moves, the piece jumps it and lands on the square just beyond, empty or capturing an enemy there. It works in any direction the piece itself moves: straight for a Carp, on the diagonal for a Raccoon-dog, any of the eight for the royal.':
    '棋子可以跳越一枚己方棋子。如果在该棋子可走的某个方向上、紧邻的格子里有一枚友方棋子，它便可越过这枚棋子，落到再往前的那一格上：该格可以为空，也可以吃掉那里的敌方棋子。这适用于棋子本身能走的任意方向：鲤鱼沿直线，狸沿斜线，王则可沿八个方向中的任意一个。',
  'Capturing, farms, and drops': '吃子、农场与打入',
  'Move onto an enemy to capture it; it switches sides into your farm, reverting to its base form if it was evolved.':
    '走到敌方棋子所在的格子即可吃掉它；它会改换阵营进入你的农场，若此前已进化，则恢复为基础形态。',
  "Instead of moving, drop a piece from your farm onto any empty square, except those on the far row (the opponent's back rank).":
    '你也可以不走子，而是从农场中取出一枚棋子打入任意空格，但最远一行（对方底线）除外。',
  Winning: '取胜',
  'Capturing the royal is the only way to win. No check, no checkmate: the game ends the moment a royal is taken.':
    '吃掉王是唯一的取胜方式。没有将军，也没有将死：王一旦被吃，对局立即结束。',
  'There is no stalemate. Because moving the king into capture range is legal, a lack of safe moves never ends the game: you simply make the unsafe move and play on until a king is taken. A side with no legal move at all, boxed in with nothing to drop, loses rather than draws.':
    '不存在逼和。由于把王走入可被吃的范围是合法的，缺少安全着法绝不会结束对局：你只管走那步不安全的棋，继续对弈，直到有一方的王被吃。若一方完全没有合法着法（被困住且无子可打入），则判负，而非和棋。',
  'Repetition and draws': '重复与和棋',
  "The original rules address neither repetition nor a move-count limit. Our convention fills the gap: a position reached three times is an automatic draw. That rule is ours, not Oca's, and changes none of the rules above.":
    '原始规则既未规定重复局面，也未规定步数上限。我们的约定补上了这一空缺：同一局面出现三次即自动判和。这条规则是我们定的，并非 Oca 的，且不改变上述任何规则。',
  "Fairy-Stockfish self-play on the friendly-jump engine (this site's patched build). White wins in 73 plies; the mating move is itself a friendly jump.":
    'Fairy-Stockfish 在支持越友规则的引擎（本站修补版）上进行的自我对弈。白方在 73 个半回合内取胜；制胜的那一步本身就是一次跳越友子。',
  'Starting position': '初始局面',
  'Source and license': '来源与许可',
  'Shogi4 and its tile art are by Oca Studios, which released its whole "Four" series into the public domain. The [BoardGameGeek entry](https://boardgamegeek.com/boardgame/146291/shogi4) is a catalog reference.':
    'Shogi4 及其棋子美术由 Oca Studios 创作，该工作室已将其整个「Four」系列发布到公有领域。[BoardGameGeek 条目](https://boardgamegeek.com/boardgame/146291/shogi4)可作为目录参考。',
  "We recovered the exact rules from Oca's official Shogi4 app, decompiling it to read the move logic directly: the friendly-jump geometry, the single drop ban, and king-capture as the sole win all come from there. Oca's public rules page and starting-position graphic (now reachable only through the [Internet Archive](https://web.archive.org/web/20240926113424/https://www.ocastudios.com/four/shogi/), since the live site is down) corroborate the board and the basic moves.":
    '我们通过反编译 Oca 官方的 Shogi4 应用、直接读取其走子逻辑，还原出了确切的规则：跳越友子的几何规则、唯一的打入禁区，以及以吃王作为唯一取胜方式，都来自于此。Oca 的公开规则页面和初始局面图（由于其网站已关闭，现在只能通过 [Internet Archive](https://web.archive.org/web/20240926113424/https://www.ocastudios.com/four/shogi/) 访问）也印证了棋盘和基本走法。',
  'Playing Shogi4': '开始游玩 Shogi4',
  "Shogi4 isn't playable on the site yet; for now this page is the rules reference. Browse the rest of the rules, or compare it with the chess and xiangqi primers.":
    'Shogi4 目前还不能在本站对弈；现阶段本页作为规则参考。你可以浏览其余规则，或将它与国际象棋和象棋入门相互对照。',

  // -- Dark Draft960 --
  'Dark Draft960': '迷雾选阵960',
  'The draft': '选阵',
  "The server deals each player three random Chess960 back ranks. You pick one. Your opponent independently picks one of theirs. The drafts are sealed. Neither side sees the other's offers or choice.":
    '服务器为每位玩家发出三种随机的国际象棋960 底线阵型。你从中选一种，对手也各自从自己的三种中选一种。双方的选阵都是密封的：任何一方都看不到对方的候选阵型或最终选择。',
  "Say both players picked offer A. Each side sees only its own back rank; the opponent's stays in fog. Only the server holds both.":
    '假设双方都选了候选 A。每一方只能看到自己的底线阵型，对方的则隐藏在迷雾中。只有服务器同时掌握双方的阵型。',
  '960 × 960 = **921,600** possible starts. Standard chess is one of them.':
    '960 × 960 = **921,600** 种可能的开局。标准国际象棋只是其中之一。',
  'Dark Draft960 is a future variant, not playable yet. There is no set release date.':
    '迷雾选阵960 是一个未来的变体，目前尚不可对弈，也没有确定的发布日期。',

  // -- Xiangqi primer (rules) --
  'Xiangqi Rules': '象棋规则',
  // seoTitle: drives the localized <title>. Without an entry the zh pages would
  // regress to the English seoTitle, since seoTitle is outside articleProse.
  'Xiangqi Rules: How to Play Chinese Chess': '象棋规则：中国象棋怎么下',
  'Red and Black alternate moves, with Red first. Each side begins with 16 pieces: one general, two advisors, two elephants, two horses, two chariots, two cannons, and five soldiers. The goal is to checkmate the opposing general.':
    '红黑双方轮流走子，红方先行。每一方开局有 16 枚棋子：一个将（帅）、两个士（仕）、两个象（相）、两个马、两个车、两个炮（砲）和五个兵（卒）。目标是将死对方的将帅。',
  'The board has 9 files and 10 ranks. In the traditional presentation, pieces sit on the intersections of the lines rather than inside squares.':
    '棋盘有 9 条纵线和 10 条横线。在传统的呈现方式中，棋子落在线的交叉点上，而不是格子内。',
  "The **palace** is the 3 by 3 box on each player's back side. Generals and advisors must stay inside their own palace. The **river** divides the board in half. Elephants cannot cross it, and soldiers gain sideways movement after crossing it.":
    '**九宫**是每一方底线一侧的 3×3 区域。将帅与士仕必须留在己方九宫之内。**楚河汉界**将棋盘分为两半。象（相）不能过河，而兵（卒）过河之后可以横向走子。',
  "A piece captures by landing on an enemy-occupied point, and no piece may move through an occupied point. The cannon's capturing jump is the only exception. The pieces are listed below in the traditional order.":
    '棋子通过落在敌方占据的交叉点上来吃子，而任何棋子都不能穿过被占据的交叉点。炮的吃子跳跃是唯一的例外。下面按传统顺序列出各棋子。',
  '**General:** moves one point horizontally or vertically and can never leave its own palace. The two generals may never face each other along an open file with nothing between them: a move that would expose that line is illegal. In effect, a general guards the file in front of it like a chariot.':
    '**将（帅）：**横向或纵向走一个交叉点，永远不能离开己方九宫。双方的将帅不能在中间无子的同一条纵线上对脸：任何让这条直线暴露出来的走法都是不合法的。实际上，将帅就像一只车那样守住它正前方的纵线。',
  '**Advisor:** moves one point diagonally and, like the general, stays inside the palace. Both advisors share just five possible points. Their main job is to protect the general, but they can also become a liability by blocking its escape or serving as a cannon screen.':
    '**士（仕）：**斜向走一个交叉点，与将帅一样必须留在九宫内。两枚士共同只能到达五个点。它们的主要职责是保护将帅，但也可能堵住将帅的逃路，或成为对方炮的炮架。',
  "**Elephant:** moves exactly two points diagonally and cannot cross the river, so the two elephants share only seven possible points on their own half. It does not jump: a piece on the midpoint of the diagonal, the elephant's eye, blocks the move.":
    '**象（相）：**沿斜线正好走两个交叉点，且不能过河，因此两枚象在己方半边共同只能到达七个点。它不能跳越：如果斜线中点（象眼）上有棋子，这步走法就被挡住。',
  "**Horse:** moves one point orthogonally and then one point diagonally outward, like a chess knight, but it does not jump. If the orthogonal point it steps through, the horse's leg, is occupied, the horse cannot move in that direction.":
    '**马：**先沿横竖方向走一个交叉点，再斜向外走一个交叉点，走「日」字，类似国际象棋的马，但它不能跳越。如果它经过的那个横竖交叉点（马腿）被占据（蹩马腿），马便不能朝那个方向走。',
  '**Chariot:** moves any distance horizontally or vertically and cannot jump, exactly like a rook. It is the strongest piece on the board.':
    '**车：**横向或纵向走任意距离，不能越子，与国际象棋的车完全相同。它是棋盘上最强的棋子。',
  '**Cannon:** moves like a chariot when it is not capturing. To capture, it jumps over exactly one piece, friend or foe, called the screen, and lands on an enemy piece beyond it.':
    '**炮（砲）：**不吃子时走法与车相同。吃子时，它正好越过一枚棋子（不分敌我），这枚棋子称为炮架，并落在其后的一枚敌方棋子上。',
  '**Soldier:** moves one point straight forward and never backward. After crossing the river it may also move one point sideways. It never promotes.':
    '**兵（卒）：**向正前方走一个交叉点，永不后退。过河之后，它还可以横向走一个交叉点。它不会升变。',
  'Check, checkmate, and endings': '将军、将死与终局',
  'A general is in **check** when an enemy piece attacks it. Every move must leave your own general safe, so a player in check must move the general, capture the attacker, or block the attack. If no legal answer exists, it is checkmate and the checked player loses.':
    '当敌方棋子攻击将帅时，即为**将军**。每一步都必须保证己方将帅安全，因此被将军的一方必须移动将帅、吃掉进攻棋子或挡住攻击。若没有合法应法，便是将死，被将军的一方告负。',
  'A player with no legal move also loses, even when the general is not in check. In Western chess that position is a stalemate draw; in xiangqi it is a win for the player who made the last move.':
    '即使将帅没有被将军，完全没有合法走法的一方也会告负。在西洋国际象棋中这是逼和；在象棋中则由走出上一着的一方获胜。',
  'Tournament rules use detailed procedures for perpetual check, perpetual chase, and other repeated attacks. Mistboard uses two automatic draw rules: the same position three times, or 60 consecutive plies without a capture.':
    '正式比赛规则对长将、长捉和其他重复进攻有详细判定程序。Mistboard 采用两条自动和棋规则：同一局面出现三次，或连续 60 个半回合没有吃子。',
  "To see the pieces work together, step through a famous trap from a manual printed in 1632. Red gives up a horse; when Black grabs it, Red's chariots and cannons pour through the gap and checkmate on the thirteenth move.":
    '想看棋子如何协同作战，可以逐步重演一则出自 1632 年棋谱的著名陷阱。红方故意送出一匹马，黑方一旦贪吃，红方的车炮便乘虚而入，在第十三着将死对手。',
  'Mini Xiangqi': '迷你象棋',
  'Dark Mini Xiangqi': '迷雾迷你象棋',

  // -- Chess primer --
  'Chess Rules': '国际象棋规则',
  'Chess is a two-player strategy game played for centuries. It descends from the Indian game chaturanga of around the 6th century and reached Europe through Persia and the Islamic world; its modern form, with the long-range queen and bishop, took shape in Europe in the late 1400s.':
    '国际象棋是一种已有数百年历史的双人策略游戏。它源自约公元 6 世纪的印度游戏恰图兰加，经由波斯和伊斯兰世界传入欧洲；其现代形式（拥有远程的后和象）于 15 世纪末在欧洲成形。',
  'Board setup': '棋盘布置',
  'Chess is played on an 8 by 8 board of alternating light and dark squares.':
    '国际象棋在 8×8 的棋盘上进行，棋盘由深浅相间的方格组成。',
  'White moves first, then players alternate. Each side fills the two rows nearest it, with the queen starting on her own color. On your turn, move one piece to a legal square: you cannot land on your own piece, and landing on an enemy piece captures it, removing it from the board.':
    '白方先走，之后双方轮流走子。每一方在最靠近自己的两排摆满棋子，后摆在与自身同色的格子上。轮到你时，将一枚棋子走到一个合法的格子：你不能落在自己的棋子上，而落在敌方棋子上即可将其吃掉，并把它从棋盘上移走。',
  'Each piece moves in its own way. In every diagram below, the highlighted squares are the legal moves and captures for the marked white piece.':
    '每种棋子都有各自的走法。在下面每一幅图中，高亮的格子表示被标记的白方棋子的合法走法与吃子。',
  '**King:** moves one square in any direction. In regular chess, a king may not move onto a square attacked by the opponent.':
    '**王：**可向任意方向走一格。在普通国际象棋中，王不能走到被对方攻击的格子上。',
  '**Queen:** moves any number of squares horizontally, vertically, or diagonally. Other pieces block her path.':
    '**后：**可沿横线、竖线或斜线走任意格数。其他棋子会挡住它的去路。',
  '**Rook:** moves any number of squares horizontally or vertically. It cannot jump, so the first occupied square in a line stops it.':
    '**车：**可沿横线或竖线走任意格数。它不能跳子，因此一条线上第一个被占据的格子就会挡住它。',
  '**Bishop:** moves any number of squares diagonally. Because diagonals stay on one color, each bishop stays on light squares or dark squares for the whole game.':
    '**象：**可沿斜线走任意格数。由于斜线始终保持同一种颜色，每个象在整盘棋中都只走浅色格或只走深色格。',
  '**Knight:** moves in an L shape: two squares one way and one square sideways. The knight is the only piece that jumps over other pieces.':
    '**马：**走「L」形：朝一个方向走两格，再横向走一格。马是唯一能跳过其他棋子的棋子。',
  '**Pawn:** the pawn moves and captures differently from every other piece. It moves straight forward into an empty square, one square at a time, or two squares from its starting position. It can never move backward or sideways, and a piece directly in front of it blocks it completely. It captures only diagonally forward, one square (the green rings below), never straight ahead. Two further pawn rules, promotion and en passant, appear under Special moves below.':
    '**兵：**兵的走法和吃法与其他所有棋子都不同。它向正前方走入一个空格，每次一格，或在起始位置时一次走两格。它永远不能后退或横走，正前方若紧挨着一枚棋子便会被完全挡住。它只能向斜前方吃子，一格（见下图的绿色圆环），绝不向正前方吃子。另有两条与兵有关的规则：升变与吃过路兵，见下文的「特殊走法」。',
  'Check and checkmate': '将军与将死',
  'In regular chess, the king is protected by check and checkmate. A king is **in check** when an enemy piece attacks it. The checked player must make a legal move that leaves the king safe.':
    '在普通国际象棋中，王受到将军与将死规则的保护。当敌方棋子攻击王时，王即处于**被将军**的状态。被将军的一方必须走一步合法着法，使王重新安全。',
  'Most checks are answered in one of three ways: move the king, block the line of attack, or capture the attacking piece. If none of those legal answers works, the game ends by **checkmate**.':
    '应对将军通常有三种方法：移动王、挡住攻击线路，或吃掉发动攻击的棋子。如果这些合法应法都行不通，对局便以**将死**告终。',
  'In regular chess the king is never actually captured: the game ends at checkmate, with the king still on the board.':
    '在普通国际象棋中，王从不会真的被吃掉：对局在将死时结束，此时王仍留在棋盘上。',
  'Special moves': '特殊走法',
  'Castling is a one-move king-and-rook move. The king moves two squares toward a rook, and that rook moves to the square the king crossed. In regular chess, the pieces must be unmoved, the path must be empty, and the king cannot castle out of, through, or into check.':
    '王车易位是一步同时移动王和车的走法。王朝着一只车的方向走两格，那只车则移动到王越过的格子上。在普通国际象棋中，参与易位的王与车此前都不能动过，中间的格子必须为空，且王不能在被将军时易位、不能穿过被攻击的格子易位，也不能易位到被攻击的格子上。',
  'Queenside castling works the same way on the other side: the king moves two squares toward the rook, and the rook lands next to it.':
    '后翼易位在另一侧以同样方式进行：王朝着车走两格，车则落到王的旁边。',
  Promotion: '升变',
  'When a pawn reaches the farthest rank, it promotes into a queen, rook, bishop, or knight.':
    '当兵到达最远的一条横线时，它会升变为后、车、象或马。',
  'En passant is the unusual pawn capture. If an enemy pawn moves two squares from its starting rank and lands beside your pawn, your pawn may capture it diagonally as if it had moved only one square. This chance exists only on the very next move.':
    '吃过路兵是一种特殊的兵吃子。如果敌方的兵从起始横线一次走两格，并停在你的兵旁边，你的兵可以斜向吃掉它，就好像它只走了一格一样。这个机会只在紧接着的下一步存在。',
  'Not every game is won. Some end in a draw, where neither side wins.':
    '并非每盘棋都分出胜负。有些以和棋告终，即双方都不获胜。',
  Stalemate: '逼和',
  'Stalemate is when the player to move has no legal move but their king is not in check. It is a draw, not a win, even if one side is far ahead. Below it is Black to move: the king on a8 is not in check, yet every square it could step to is covered by the white queen, and Black has nothing else to move. The game is drawn.':
    '逼和是指轮到走子的一方没有任何合法着法，但其王并未被将军。它判作和棋，而非取胜，即使一方大占优势也是如此。下图轮到黑方走子：a8 的王没有被将军，但它能走到的每一个格子都被白后控制，而黑方又无其他棋子可走。对局判和。',
  'Other draws': '其他和棋',
  '**Threefold repetition:** the same position, with the same player to move, occurs three times. Either player can then claim a draw.':
    '**三次重复局面：**同一局面在同一方走子的情况下出现三次。此时任一方都可以提出和棋。',
  '**Fifty-move rule:** fifty moves by each side pass with no capture and no pawn move. The clock resets whenever a pawn moves or a piece is taken.':
    '**五十回合规则：**双方各走五十回合而无任何吃子、也无任何兵的走动。每当有兵走动或有棋子被吃，计数便重新归零。',
  '**Insufficient material:** neither side has enough force to deliver checkmate, such as king versus king, or king and a lone bishop or knight against a bare king.':
    '**子力不足：**任何一方都没有足够的子力完成将死，例如单王对单王，或一王加单象或单马对单王。',
  '**Agreement:** both players simply agree to a draw.': '**协议和棋：**双方直接同意作和。',
  'A famous game': '一盘名局',
  'To see the pieces work together in a real game, step through Game 11 of the 2014 World Championship in Sochi. Playing White, Magnus Carlsen grinds down Viswanathan Anand in a Berlin endgame to clinch the title; Anand resigns on move 45.':
    '想看棋子在实战中如何协同，可以逐步重演 2014 年索契世界冠军赛的第 11 局。执白的马格努斯·卡尔森在柏林防御残局中逐步磨垮维斯瓦纳坦·阿南德，锁定冠军；阿南德在第 45 回合认输。',
  'Where to next': '接下来去哪',
  'All rules': '全部规则',
  'Fog Chess Concepts': '迷雾国际象棋概念',
  // section headings
  'The starting position': '开局局面',
  'What you see': '你能看到什么',
  'Win condition: king capture': '胜负条件：吃王',
  Draws: '和棋',
  'Edge cases': '特殊情形',
  'Reading the fog': '读懂迷雾',
  'A sample game': '一盘示例对局',
  // sub-headings
  Castling: '王车易位',
  'Pawn vision': '兵的视野',
  'En passant': '吃过路兵',
  'Pawn moves': '兵的走动',
  Captures: '吃子',
  'Each side sees the squares its own pieces could legally move to (under [regular chess rules](https://en.wikipedia.org/wiki/Rules_of_chess)), plus the squares they stand on. Everything else is fog.':
    '每一方能看到己方棋子（按[普通国际象棋规则](https://zh.wikipedia.org/zh-hans/国际象棋规则)）可以合法走到的格子，以及棋子当前所在的格子。其余一切都笼罩在迷雾之中。',
  "Here's the same rule, piece by piece.": '同一条规则，逐子来看。',
  'Vision moves with pieces. When a piece moves, the squares it used to cover go dark (unless another piece still sees them), and the squares it now reaches light up.':
    '视野随棋子移动。当一个棋子走动时，它原先覆盖的格子会重新陷入黑暗（除非另有棋子仍能看到它们），而它新触及的格子则会亮起。',
  "Notice the rook on d7 sees the queen on b7 and the king on h7, but not a7. A piece's vision ends where its movement ends.":
    '注意 d7 的车能看到 b7 的后和 h7 的王，却看不到 a7。棋子的视野止于它走法的尽头。',
  'The game ends when a king is captured. No check, no checkmate, no warning.':
    '当一方的王被吃掉时，对局即告结束。没有将军，没有将死，也没有任何预警。',
  "Mistboard auto-draws games on threefold repetition (same true position three times, same side to move, same castling and en-passant rights) and the 50-move rule (fifty full moves with no pawn move or capture). Both apply to the true position, not either player's view. There is no stalemate draw and no insufficient-material draw.":
    'Mistboard 会在三次重复局面（同一真实局面出现三次，且轮到走子的一方相同、王车易位权与吃过路兵权也相同）或五十回合规则（连续五十个回合无兵的走动、也无吃子）时自动判和。两条规则都针对真实局面，而非任何一方各自的视野。这里没有逼和，也没有子力不足判和。',
  'A king may castle out of, through, or into check.':
    '王可以在被将军时易位，可以穿过被攻击的格子易位，也可以易位到被攻击的格子上。',
  'Pawns see forward push squares when those squares are empty. They see diagonal squares only when an enemy piece is actually there to capture.':
    '兵在前方格为空时能看到可推进的格子。只有当斜前方真的有敌方棋子可吃时，兵才会看到那个斜线格。',
  'White does not see a4 or b4: black pawns block those pushes, so they are not legal moves. Some rulesets reveal blocked pawn squares; Mistboard does not.':
    '白方看不到 a4 或 b4：黑兵挡住了这些推进，所以它们不是合法走法。有些规则会显示被阻挡的兵推进格；Mistboard 不会。',
  "En passant is chess's strangest move, so our vision rule bends for it: the capturing pawn sees the captured pawn on its adjacent square. The window is one move only. Pass on the capture and the chance is gone.":
    '吃过路兵是国际象棋中最奇特的一步，因此我们的视野规则为它破了个例：执行吃子的兵能看到相邻格子上那个将被吃掉的对方兵。这个窗口只持续一步。若放弃这次吃子，机会便不复存在。',
  'The goal is not perfect certainty. A good fog chess player learns which hidden worlds are dangerous enough to respect, then chooses moves that survive those worlds.':
    '目标不是获得完美确定性。优秀的迷雾棋手会判断哪些隐藏局面危险到必须尊重，然后选择在那些局面中也能成立的走法。',
  'A pawn sees where it can push. Fog on a push square means an opponent piece or pawn is blocking it.':
    '兵能看到它可以推进到的格子。若推进格被迷雾遮住，就说明那里有对方的棋子或兵挡着。',
  "Same signal in opening play. After 1.d4 e6 2.Nf3 Bb4, b4 leaves White's view: the b2-pawn no longer pushes there. A Black piece just landed on b4. Pawn, knight, or bishop, and White can't tell which. But c3 and d2 are visible empty, so a bishop would capture the king next move. White has to defend on that assumption.":
    '开局中也有同样的信号。在 1.d4 e6 2.Nf3 Bb4 之后，b4 离开了白方的视野：b2 的兵不再能推进到那里。说明刚有一枚黑方棋子落在了 b4。可能是兵、马或象，白方无从判断是哪一个。但 c3 与 d2 都清晰可见且为空，因此一枚象下一步就能吃掉白王。白方只能按这个最坏的假设来防守。',
  "When the opponent takes one of your pieces, the capture square falls to fog. You can't see what took. Here: White pawn on d5, with four Black attackers around it (c6 pawn, e6 pawn, c7 knight, d7 rook). After 1...exd5, the d5 pawn vanishes. Which Black piece took it?":
    '当对方吃掉你的一枚棋子时，被吃的那个格子会随即陷入迷雾。你看不到是谁吃的。例如：白方有一个兵在 d5，周围有四个黑方攻击者（c6 兵、e6 兵、c7 马、d7 车）。在 1...exd5 之后，d5 的兵消失了。是哪一枚黑子吃掉了它？',
  'Add a White bishop on h3. Its diagonal keeps e6 in view. After the same 1...exd5, White loses d5 and the bishop sees e6 fall empty. So the e-pawn took.':
    '现在在 h3 添一枚白象。它的斜线让 e6 始终处在视野内。同样走 1...exd5 之后，白方失去 d5，而那枚象看到 e6 变空了。于是可知：是 e 路的兵吃的。',
  "Here is a complete game between Mistboard's engine and a human, shown from both player views and the server's full position.":
    '下面是一盘 Mistboard 引擎对阵真人的完整对局，同时展示双方视野和服务器上的完整局面。',
  'Read the rules': '阅读规则',
  // board labels
  "WHITE'S VIEW": '白方视野',
  'SERVER TRUTH': '服务器真相',
  "BLACK'S VIEW": '黑方视野',
  PAWN: '兵',
  KNIGHT: '马',
  BISHOP: '象',
  ROOK: '车',
  QUEEN: '后',
  KING: '王',
  BEFORE: '之前',
  AFTER: '之后',
  'EMPTY AHEAD': '前方空旷',
  'BLOCKED AHEAD': '前方受阻',
  'The board': '棋盘',
  'The pieces': '棋子',
  'Back to all rules': '返回全部规则',
  // section headings
  'Win condition: general capture': '胜负条件：擒获将帅',
  'Play status': '对弈状态',
  // sub-headings
  Cannons: '炮（砲）',
  'Facing generals': '将帅对脸',
  'Horse legs': '蹩马腿',
  'Elephant eyes': '塞象眼',
  // paragraphs
  'At the start, you see your own pieces and every legal destination they control. Everything else is fog. Your opponent sees a different board from the same true position.':
    '开局时，你能看到己方棋子以及它们所控制的每一个合法落点。其余一切都是迷雾。你的对手会从同一个真实局面看到一张不同的棋盘。',
  'Vision is recomputed from the true position after every move, so hidden blockers, cannon screens, horse legs, elephant eyes, and newly opened lines immediately change what you know.':
    '每走一步之后，视野都会根据真实局面重新计算，因此隐藏的阻挡子、炮架、马腿、象眼，以及新打开的线路都会立刻改变你所掌握的信息。',
  'Capture the general to win. Checks and checkmates are not announced, and the server does not warn a player who has moved into danger.':
    '擒获将帅即获胜。将军与将死都不会被告知，并且当一方走入危险时，服务器也不会发出警告。',
  "Games auto-draw on threefold repetition and after 60 plies with no capture. Both are judged from the true position, not either player's view. There is no stalemate draw: if the side to move has no legal move, it loses, and with no check to freeze you, this almost never happens.":
    '对局会在三次重复局面，以及连续 60 个半回合无吃子时自动判和。两者都依据真实局面判断，而非任何一方各自的视野。这里没有困毙判和：若轮到走子的一方没有合法着法，则判负；而由于没有将军来限制你，这种情况几乎不会发生。',
  'A cannon moves like a chariot when it is not capturing. To capture, it jumps exactly one screen and lands on the first enemy piece beyond it. Under fog, the screen appears as unknown occupancy and the target is visible as the enemy piece.':
    '炮（砲）不吃子时走法与车相同。吃子时，它正好越过一个炮架，落在其后的第一枚敌方棋子上。在迷雾下，炮架显示为未知的占据状态，目标则作为敌方棋子可见。',
  'A horse can move only when the adjacent leg square is clear. If a hidden piece blocks that leg, the destination disappears from your visible set and the leg square appears as a ? marker.':
    '只有当相邻的马腿位置空着时，马才能走动。如果有一枚隐藏的棋子蹩住了那条马腿，落点就会从你的可见集合中消失，而马腿位置则显示为一个「?」标记。',
  'An elephant moves two points diagonally and cannot cross the river. If a hidden piece sits on the midpoint eye, the diagonal destination disappears and the eye square appears as a ? marker.':
    '象（相）沿斜线走两个交叉点，且不能过河。如果有一枚隐藏的棋子塞在中点的象眼上，斜线落点就会消失，而象眼位置则显示为一个「?」标记。',
  'This public production game ends with the rule that most clearly separates Fog Xiangqi from ordinary xiangqi. Red sends a chariot to d10, Black’s general captures it, and the open file lets Red’s general fly from d1 to d10 for the win.':
    '这盘公开的生产环境对局，以一条最能区分迷雾象棋与普通象棋的规则收尾。红方把车杀到 d10，黑将吃掉它，随后开放的纵线让红帅从 d1 飞到 d10 取胜。',
  'Red has the lower army. Step through Red’s view, the server truth, and Black’s view.':
    '红方棋子位于下方。逐步查看红方视野、服务器真相和黑方视野。',
  'Black’s cannon jumps a screen and captures the horse on b1.': '黑炮越过炮架，吃掉 b1 的红马。',
  'Red’s chariot immediately captures that cannon.': '红车立即吃掉这门黑炮。',
  'Red’s roaming cannon captures Black’s horse on g8.': '红方游走的炮吃掉 g8 的黑马。',
  'Black’s remaining horse catches the cannon on c9.': '黑方剩下的马在 c9 吃掉红炮。',
  'Red’s chariot crashes into d10 and captures an advisor beside the general.':
    '红车杀入 d10，吃掉黑将身旁的士。',
  'Black’s general captures the chariot on d10. The entire d-file between the two generals is now open.':
    '黑将在 d10 吃掉红车。此时两位将帅之间的整条 d 线完全畅通。',
  'Red’s general flies from d1 to d10 and captures Black’s general. Fog Xiangqi ends immediately.':
    '红帅从 d1 飞到 d10，擒获黑将。迷雾象棋对局立即结束。',
  '[Open the original game](/dark-xiangqi/game/dxq_ef889df8-a1eb-4d0a-bd0a-ffd7e8bc30f4).':
    '[打开原始对局](/dark-xiangqi/game/dxq_ef889df8-a1eb-4d0a-bd0a-ffd7e8bc30f4)。',
  // -- Jieqi (rules) --
  Setup: '布局',
  "Set each general face-up on its normal palace point. Shuffle each side's other fifteen pieces and deal them face-down onto the remaining starting points. Neither player knows any hidden identities, including their own.":
    '将双方的将帅各自正面朝上摆在九宫内通常的位置。把每一方其余十五枚棋子洗混，背面朝下地发到剩余的起始位置上。任何一方都不知道任何暗子的身份，包括自己的暗子。',
  'First moves use starting points': '首步按起始位置行棋',
  'Before reveal, a dark piece uses the role of the starting point it occupies, not its hidden identity. A dark piece on a corner point plays like a chariot; dark pieces on horse, advisor, elephant, cannon, and soldier points use those matching moves.':
    '翻明之前，暗子按其所在起始位置对应的兵种行棋，而不是按它隐藏的真实身份。位于角点的暗子像车一样走；位于马、士、象、炮、兵起始位置上的暗子，则分别按这些兵种的走法行棋。',
  'The normal restrictions still apply to that first move: horse legs, elephant eyes, cannon screens, palace limits for advisor points, and the river limit for elephant points. Once the move resolves, the piece flips face-up for both players.':
    '通常的限制对这首步同样适用：蹩马腿、塞象眼、炮架，士位受九宫限制，象位受河界限制。这步走完后，该棋子即对双方翻为正面朝上。',
  'Revealed pieces use identity': '翻明后的棋子按真实身份行棋',
  "After reveal, use the piece's identity from its current point. Advisors may leave the palace, and elephants may cross the river. Their movement shapes do not change: advisors step one point diagonally; elephants move two points diagonally and are still eye-blocked.":
    '翻明之后，棋子从它当前所在的位置按其真实身份行棋。士可以离开九宫，象可以过河。它们的走子形状不变：士斜走一个交叉点；象斜走两个交叉点，并且仍会被塞象眼。',
  'Horses, chariots, and cannons move normally. Soldiers use the normal river rule from wherever they reveal: forward only before crossing, forward or sideways after crossing, never backward.':
    '马、车、炮按常规走法行棋。兵（卒）则从它翻明的位置起套用通常的过河规则：过河前只能向前，过河后可向前或横走，永不后退。',
  'Captured dark pieces': '被吃掉的暗子',
  'If a dark piece is captured before revealing, only the capturer learns what it was. The owner sees one dark piece leave the board, but not its identity. Later, the capturer can rule out that hidden identity elsewhere.':
    '如果一枚暗子在翻明之前被吃掉，只有吃子的一方知道它是什么。棋子的主人只看到一枚暗子离开棋盘，却看不到它的身份。此后，吃子的一方便可以排除其他位置上存在这个隐藏身份的可能。',
  'Mistboard uses capturer-only reveal: the player who takes a dark piece learns its identity, while the former owner does not.':
    'Mistboard 采用仅向吃子方揭示的规则：吃掉暗子的一方会得知其身份，而原持有者不会得知。',
  'Checks, wins, and draws': '将军、胜负与和棋',
  "Every occupied point is visible, so players can see when a general is attacked. An unmoved dark piece attacks using its starting point's role. Once it moves, it reveals immediately, and any attack from the destination uses its revealed identity.":
    '每个被占据的交叉点都是可见的，因此双方都能看出将帅何时受到攻击。尚未走动的暗子按其起始位置对应的兵种发动攻击。一旦走动，它立即翻明；任何来自落点的攻击都按翻明后的真实身份计算。',
  'Normal check rules apply: a move may not leave your own general attacked, and a player in check must answer the threat. You win by checkmate or by leaving the opponent with no legal move. The facing-generals rule still applies, and dark pieces block the file like any other piece.':
    '通常的将军规则依然适用：走子后不能让己方将帅受到攻击，被将军时必须应对。将死对方，或让对方无合法走法，即可获胜。将帅对脸规则仍然有效，暗子也和其他棋子一样会挡住纵线。',
  'Mistboard automatically draws after 120 plies, or 60 moves by each player, without a capture. Repeated positions do not trigger a separate automatic draw.':
    '连续 120 个半回合，也就是双方各走 60 步而没有吃子时，Mistboard 自动判和。重复局面不会另外触发自动和棋。',
  'Step through a self-play game. Dark pieces appear as colored backs and reveal their identity the first time they move. Red wins by checkmate.':
    '逐步查看一盘自我对弈。暗子以彩色背面显示，第一次走动时翻明身份。红方以将死获胜。',
  'The board is half a xiangqi board: thirty-two squares in a 4x8 grid, shown here with the long side horizontal. Unlike xiangqi, pieces sit inside the squares rather than on intersections, and the thirty-two shuffled pieces exactly fill the board, every one face-down.':
    '棋盘是半张象棋棋盘：4×8 共三十二个方格，此处以长边横置显示。与象棋不同，棋子放在方格之内，而不是交叉点上；洗匀后的三十二枚棋子恰好填满棋盘，每一枚都背面朝下。',
  'Colors are not assigned in advance. The first player opens the game by flipping any piece: whatever color comes up is theirs, and the opponent plays the other.':
    '颜色不会事先分配。先行的一方翻开任意一枚棋子来开局：翻出什么颜色，那一方就执该色，对手执另一色。',
  Turns: '回合',
  'On your turn, do exactly one of two things: **flip** any face-down tile, or **move** one of your revealed pieces one square up, down, left, or right. A move may land on an empty square or capture an enemy when the rank rules allow it. A flip reveals the piece to both players, even if it belongs to your opponent. There is no passing.':
    '轮到你时，只能做两件事之一：**翻开**任意一枚背面朝下的棋子，或把一枚己方已翻开的棋子向上、下、左、右移动一格。移动可落到空格，也可在等级规则允许时吃掉敌子。翻子会向双方亮出该棋子，即使它属于对手。不能跳过回合。',
  'Capture by rank': '按等级吃子',
  'Face-down tiles cannot be captured. The cannon uses a different attack, so it sits outside the ladder when capturing. The dashed slot shows only how other pieces treat a cannon as a target: it ranks between the horse and soldier.':
    '背面朝下的棋子不能被吃。炮使用不同的攻击方式，因此进攻时不属于等级序列。虚线位置只表示其他棋子把炮当作目标时如何计算：炮排在马与卒之间。',
  'The cannon': '炮',
  'The cannon ignores rank when it captures. Instead of taking an adjacent piece, it travels along a row or column, jumps exactly one intervening piece called the screen, and captures the first piece beyond it if that piece is a revealed enemy. The screen may be friendly, enemy, or face-down. Without a capture, the cannon moves one square like every other piece. Because it needs a screen, it cannot capture an adjacent piece.':
    '炮吃子时不论等级。它不吃相邻棋子，而是沿一行或一列越过恰好一枚作为炮架的棋子，并在炮架另一侧第一枚棋子是已翻开的敌子时将其吃掉。炮架可以是己方、敌方或背面朝下的棋子。不吃子时，炮与其他棋子一样只走一格。由于吃子需要炮架，它不能吃相邻棋子。',
  'You win when your opponent has no legal move, usually because every enemy piece is captured, sometimes because they are boxed in. The general is not royal: capturing it is progress, not the win, and play continues until one side is wiped out or stuck.':
    '当对手轮到自己却无棋可走时，你获胜——通常是因为敌方棋子被全部吃光，有时则是被困死、无路可走。这里的将不是王棋：吃掉它只是进展，而非胜利，棋局会一直进行到一方被吃光或被困死为止。',
  'Mistboard draws a game two ways: 40 plies (single moves) with no flip or capture, or threefold repetition, the same position three times. A flip or capture resets both counters because it changes the position irreversibly.':
    'Mistboard 有两种自动和棋：连续 40 个半回合没有翻子或吃子，或同一局面出现三次。翻子或吃子会不可逆地改变局面，因此会重置两个计数。',
  'Play MistyBanqi': '对战 MistyBanqi',
  'Challenge a friend': '挑战好友',
  'MistyBanqi · Strongest': 'MistyBanqi · 最强',
  'MistyBanqi (Red) wins by resignation · 49 moves': 'MistyBanqi（红方）因对手认输获胜 · 49 回合',
  'Three rules give the game its character: the rat captures the elephant, only the rat can swim, and the lion and tiger leap the rivers.':
    '三条规则赋予了这盘棋的特色：老鼠能吃大象，只有老鼠能下水，狮和虎能跳过河。',
  'Strongest at the left, weakest at the right.': '最强在左，最弱在右。',
  'One square, four directions.': '一格，四个方向。',
  'The river is not a move for a land animal.': '对陆地动物来说，河格不是可走的一步。',
  'The rat can step off the bank into the river.': '鼠可以从岸上走进河里。',
  'In the water it is safe: the wolf is not a target, and it cannot reach the rat either.':
    '在水中它很安全：狼不是它可吃的目标，狼也吃不到它。',
  'The lion clears either river sideways.': '狮可以横向跳过任意一条河。',
  'The same jump lengthwise, landing on the wolf and taking it.':
    '同样的跳跃沿河的长边进行，落在狼所在格并把它吃掉。',
  'The tiger clears the river the long way.': '虎沿河的长边跳过整条河。',
  'The tiger on the lion’s square: no sideways jump.': '同一格换成虎：没有横向跳跃。',
  'The rat takes the elephant.': '鼠吃掉象。',
  'The elephant cannot take the rat back.': '象无法反过来吃掉鼠。',
  'A revealed animal steps one square.': '已翻开的动物走一格。',
  Traps: '陷阱',
  'On red’s trap the lion is rank 0, so a cat takes it.':
    '站在红方陷阱上的狮等级归零，因此连猫也能吃掉它。',
  'Red’s own trap costs red nothing: the cat still cannot touch the elephant.':
    '红方停在自己的陷阱上毫无损失：猫依然吃不到象。',
  'One step into the den ends the game. Rank does not matter, and neither does the trap square.':
    '走进兽穴一步即可结束对局。等级无关紧要，脚下是不是陷阱格也无关紧要。',
  'Step a piece onto one of your opponent’s three trap squares and it loses all rank while it stands there, so any defending piece can take it, down to a rat capturing a trapped elephant. Only an enemy’s traps do this: a piece can sit on one of its own traps and keeps its full rank.':
    '把一枚棋子走进对方三个陷阱格之一，它在停留期间会丧失全部等级，因此任何防守方棋子都能吃掉它，哪怕是老鼠吃掉落入陷阱的大象。只有敌方的陷阱才有此效果：棋子可以停在自己的陷阱上，并保持全部等级。',
  'You win immediately by moving any piece into the enemy den, capturing every enemy piece, or leaving your opponent with no legal move. You cannot move into your own den.':
    '任何一枚棋子走进敌方兽穴、吃光敌方所有棋子，或让对手无合法着法，你都立即获胜。棋子不能走进己方兽穴。',
  'Games draw on threefold repetition, or when 100 half-moves (50 by each player) pass with no capture.':
    '若同一局面出现三次，或连续 100 个半回合（每方 50 步）无吃子，则判和。',
  'This engine game shows a lion leap, a rat swim and capture an elephant, and the final entry into Blue’s den.':
    '这盘引擎对局展示狮子跳河、老鼠游水并吃掉大象，以及最后进入蓝方兽穴。',
  'One of each animal in two colors is shuffled and placed face-down on the sixteen squares. Nobody knows what is under a tile until it is flipped. The first tile the first player flips sets that player’s color; the other player takes the other color.':
    '两种颜色各一套八种动物，洗匀后背面朝上放在十六个格子里。在翻开之前，谁也不知道棋子下面是什么。先行者翻开的第一枚棋子决定其颜色，另一位玩家执另一色。',
  'On your turn, do one thing: flip one face-down tile, or move one of your revealed animals one square up, down, left, or right. Face-down tiles block movement and cannot be captured. You cannot pass.':
    '轮到你时只能做一件事：翻开一枚背面朝上的棋子，或把己方一枚已翻开的动物上下左右走一格。暗子会阻挡移动，也不能被吃。不能跳过回合。',
  'A flip reveals both the animal and its color to both players.':
    '翻开后，双方都能看到该动物及其颜色。',
  'Captures and trades': '吃子与兑子',
  'Both colors use the same ladder. Strongest to weakest: elephant, lion, tiger, leopard, wolf, dog, cat, rat. A higher-ranked animal captures a lower-ranked enemy by moving onto its square. A weaker animal cannot capture a stronger one.':
    '两种颜色使用同一等级顺序。从强到弱是：象、狮、虎、豹、狼、狗、猫、鼠。高等级动物可以走到相邻低等级敌子所在格将其吃掉，低等级动物不能吃高等级动物。',
  'The rat and elephant reverse the usual order: a rat can capture an elephant, while an elephant cannot capture a rat.':
    '鼠和象颠倒通常的等级关系：鼠可以吃象，象不能吃鼠。',
  'You win when your opponent has no animals left, or starts a turn with no legal flip or move. If the last animal of each color is removed in an equal-rank trade, the game is drawn.':
    '当对手没有动物剩下，或回合开始时既不能翻棋也不能走棋，你获胜。若双方最后一只动物在同级兑子中一同离场，则判和。',
  'Games draw on threefold repetition, or when 40 half-moves (20 by each player) pass with no flip, capture, or trade.':
    '若同一局面出现三次，或连续 40 个半回合（每方 20 步）没有翻棋、吃子或同归于尽，则判和。',
  'Mistboard also ends a fully revealed, one-animal-each position when neither side can force a win. Equal ranks are always dead because any meeting removes both; some unequal-rank chases are also unwinnable. These positions are drawn immediately.':
    '当棋子全部翻开、双方各剩一只动物且谁也无法强制获胜时，Mistboard 也会结束对局。同级棋子必为死局，因为相遇会双双离场；某些不同等级的追逐也无法取胜。这些局面立即判和。',
  'This engine game shows two equal-rank trades: first the Lions, then the Elephants. Blue wins after Red’s last animal leaves the board.':
    '这盘引擎对局展示两次同级兑子：先是双方的狮子，再是双方的大象。红方最后一只动物离场后，蓝方获胜。',
  'Engine vs engine': '引擎对引擎',
  'Red wins by reaching the den · 69 plies': '红方进入兽穴获胜 · 69 个半回合',
  'Red’s rat has already taken Blue’s elephant in the open, and with the strongest piece off the board Red walks a piece straight into Blue’s undefended den. Reaching the enemy den ends the game at once, no matter what material is left.':
    '红方的老鼠已经在空地上吃掉了蓝方的大象，最强的棋子离场后，红方径直把一枚棋子走进蓝方无人防守的兽穴。进入对方兽穴会立刻结束对局，无论场上还剩多少子力。',
  'Engine self-play': '引擎自我对弈',
  'Blue wins by elimination · 36 plies': '蓝方吃光对手获胜 · 36 个半回合',
  'Both lions and both elephants have already traded off the board, and the pieces that survived all belong to Blue. Red has nothing left that can move, so the game ends: with no piece to move and no tile to flip, Red loses.':
    '两只狮子和两头大象都已同归于尽离场，存活下来的棋子全部属于蓝方。红方再无可走之子，于是对局结束：既没有棋子可走，也没有棋子可翻，红方告负。',

  // -- Branded rules names --
  'Fog Chess Rules': '迷雾国际象棋规则',
  // The seoTitle: English carries two names for this game and Chinese carries
  // one, so both English keys land on the same Chinese title. That is the
  // point of seoTitle -- 'fog of war chess' is what players type.
  'Fog of War Chess Rules': '迷雾国际象棋规则',
  'Fog Chess rules: chess under Fog of War, where each side sees only the squares its pieces reach, there are no check warnings, and the king falls by capture.':
    '迷雾国际象棋规则：战争迷雾下的国际象棋。每一方只能看到己方棋子可及的格子，没有将军提示，王被吃掉即负。',
  "[Fog Chess](https://en.wikipedia.org/wiki/Dark_chess) is Mistboard's public name for dark chess, also called Fog of War chess. Jens Bæk Nielsen and Torben Osted invented it in 1989. It is the implicit-fog version of the idea: no umpire, no scan action. Each side's visibility is derived from where its pieces can legally move.":
    '[迷雾国际象棋](https://en.wikipedia.org/wiki/Dark_chess)是 Mistboard 对 dark chess / Fog of War chess 的公开名称。Jens Bæk Nielsen 与 Torben Osted 于 1989 年发明了它。它属于隐式迷雾：没有裁判，也没有侦察动作。每一方的视野完全由己方棋子的合法走法范围推导而来。',
  'The rules of xiangqi: palaces, the river, cannon screens, facing generals, and a famous game to play through. Now playable on Mistboard against the Pikafish engine or a friend.':
    '象棋规则：九宫、楚河汉界、炮架、将帅照面，以及一盘可逐步回放的名局。现在可在 Mistboard 上与 Pikafish 引擎或好友对弈。',
  'Xiangqi, also known as Chinese chess, took its modern form in China during the Song dynasty (960 to 1279), when the cannon joined the board. Its ancestors run back several centuries earlier, and it shares a common root with chess, shogi, and janggi in the older Indian game chaturanga. It is now among the most widely played board games in the world.':
    '象棋的现代形态在宋代（960 至 1279 年）的中国成型，炮也在这一时期加入棋盘。它的前身可以追溯到更早几个世纪，并与国际象棋、将棋、朝鲜象棋同源于更古老的印度游戏恰图兰卡。今天它是世界上参与人数最多的棋类游戏之一。',
  'Fog Xiangqi Rules': '迷雾象棋规则',
  'Fog of War Xiangqi Rules': '迷雾象棋规则',
  'Brian H. Liou designed Fog Xiangqi in 2026 as a Mistboard original. Fog of War has been played on the chess board since Jens Bæk Nielsen and Torben Osted invented dark chess in 1989, and chess.com runs it as a standard variant today. Nobody had carried it across to xiangqi. The cannon is the piece that makes it strange. It captures only by jumping over another piece, so under fog you are firing at something you cannot see, across a screen you are not certain is still there.':
    '迷雾象棋由 Brian H. Liou 于 2026 年设计，是 Mistboard 的原创变体。战争迷雾早在 1989 年就由 Jens Bæk Nielsen 和 Torben Osted 发明的「黑棋」引入国际象棋，如今也是 chess.com 的常规变体，却从未有人把它移植到象棋上。真正让它变得奇特的是炮。炮只能隔子吃子，所以在迷雾中，你既看不见目标，也无法确定炮架是否还在。',
  'Fog Xiangqi rules: xiangqi under Fog of War, where each side sees only the points its pieces reach, hidden blockers matter, and the general falls by capture.':
    '战争迷雾下的象棋：每一方只能看到己方棋子可及的点位，隐藏阻挡会影响视野，擒获将帅即获胜。',
  'Fog Xiangqi is xiangqi under Fog of War. Pieces keep their normal movement, but unseen enemy pieces stay hidden and danger is not announced. Capture the general to win.':
    '迷雾象棋是在战争迷雾下对弈的象棋。棋子保留正常走法，但看不见的敌方棋子会被隐藏，危险不会被提示。擒获将帅即获胜。',
  'If Xiangqi is new to you, start with [Xiangqi Rules](/rules/xiangqi). If you already play xiangqi, the sections below explain only what fog changes.':
    '如果你还不熟悉象棋，请先阅读[象棋规则](/rules/xiangqi)。如果你已经会下象棋，下面只解释迷雾改变了什么。',
  'Orthodox xiangqi forbids facing generals. Fog Xiangqi allows the position; if one general sees the other on a clear file, it can capture across that file.':
    '正统象棋禁止将帅照面。迷雾象棋允许这个局面；如果一方将帅在无阻挡的直线上看见对方，就可以沿这条线直接擒获。',
  'Banqi Rules': '暗棋规则',
  'Banqi Rules (Chinese Dark Chess)': '暗棋规则：玩法详解与免费在线对弈',
  'Use [Xiangqi Rules](/rules/xiangqi) for the base game. This page covers what changes.':
    '基础规则请参考[象棋规则](/rules/xiangqi)。本页只说明变化之处。',
  Jieqi: '揭棋',
  'Fog Chess': '迷雾国际象棋',
  'Standard chess rules, the primer behind Fog Chess: castling, promotion, en passant, the draw rules, and a famous game to play through.':
    '普通国际象棋规则，也就是迷雾国际象棋背后的基础：王车易位、升变、吃过路兵、和棋规则，以及一盘可逐步回放的名局。',
  'Chess is the open-information base game. Add Fog of War for Fog Chess, where enemy pieces outside your vision disappear and the king falls by capture.':
    '国际象棋是信息公开的底层游戏。为它加上战争迷雾，便得到迷雾国际象棋：你视野之外的敌方棋子会消失，而王由被吃而落败。',
  'Read Fog Chess': '阅读迷雾国际象棋',
  "Fog Chess with a sealed opening draft: each player picks one of three Chess960 back ranks and never sees the other's.":
    '带密封开局选择的迷雾国际象棋：每位玩家从三个 Chess960 底线阵型中选择一个，且永远看不到对手选择了哪个。',
  'Programming Fog Chess with Server-Side Truth': '用服务器端真实局面实现迷雾国际象棋',
  'Fog Chess adds one hidden-information rule to chess: each side sees only the squares its own pieces reach. The implementation question is where that rule runs. On Mistboard, it runs on the server, so the browser receives a `PlayerView`, not a full board with fog painted over it.':
    '迷雾国际象棋给国际象棋增加了一条隐藏信息规则：每一方只能看到己方棋子可及的格子。实现问题在于这条规则在哪里运行。在 Mistboard 上，它运行在服务器端，所以浏览器收到的是一个 `PlayerView`，而不是盖着迷雾图层的完整棋盘。',
  'Play Misty in Fog Chess, or read the rules article for the player-facing version of the same visibility model.':
    '来玩 Misty 的迷雾国际象棋，或阅读面向玩家的规则文章，了解同一套视野模型。',
  'Read Fog Chess Rules': '阅读迷雾国际象棋规则',
  'Jungle Chess Rules (Dou Shou Qi, Animal Chess)': '斗兽棋规则：玩法详解与免费在线对弈',
  "Jungle Chess, also called Dou Shou Qi or Animal Chess: eight ranked animals on a 7 by 9 board, rivers only the rat can cross, and a race to the opponent's den. Play rated games and analyse them free in your browser.":
    '斗兽棋（又称动物棋）规则详解：棋盘 7×9，八种按等级排列的动物，只有老鼠能过的河，以及冲入对方兽穴的竞赛。免费在线对弈，支持等级分与复盘分析。',
  'Jungle has been played online for years, mostly in apps and on Chinese game portals. Rated games, a post-game review, and an engine that tells you where it went wrong have not come with it. The serious Jungle engine work sits in academic papers and endgame tablebases, nowhere you can actually play. Mistboard puts all three in one place.':
    '斗兽棋在网上已经玩了很多年，大多在手机应用和国内游戏平台上。但等级分对局、赛后复盘，以及一台能告诉你哪一步走错的引擎，一直没有跟上。真正认真的斗兽棋引擎研究留在学术论文和残局库里，没有落在任何能实际对弈的地方。Mistboard 把这三件事放在了一起。',
  'Jungle Chess is a two-player strategy game about rank and terrain. Each side commands eight animals and tries to reach the enemy den or eliminate the enemy army.':
    '斗兽棋是一种围绕等级与地形展开的双人策略游戏。双方各指挥八种动物，目标是进入敌方兽穴或消灭敌方全部棋子。',
  'Flip Jungle Rules (Flip Dou Shou Qi)': '翻翻棋规则：玩法详解与免费在线对弈',
  'The 4×4 flip version of Jungle Chess, also called flip Dou Shou Qi or flip animal chess. Every animal starts face-down, you flip to reveal, and equal ranks trade off the board. Play it free in your browser.':
    '斗兽棋的 4×4 翻面版本，又称翻翻棋。所有动物开局均背面朝上，翻开即亮明身份，等级相同的双方同归于尽、一起离场。免费在线对弈，无需注册。',
  'Jieqi Rules (Reveal Xiangqi)': '揭棋规则：玩法详解与免费在线对弈',
  'Jieqi, the hidden-piece Chinese chess variant, explained in English. Every piece but the general starts face-down, moves first as the point it stands on, then reveals. Play it free in your browser.':
    '揭棋规则详解：除将帅外的棋子都隐藏身份，首次按所在起始位置的棋子走法行棋，然后翻开并按真实身份行棋。免费在线对弈，无需注册。',
  "Jieqi, also called Reveal Xiangqi, keeps xiangqi's board and checkmate goal, but hides every non-general piece. A dark piece first moves, attacks, and captures by the starting point it occupies. After that move, it reveals and plays by identity.":
    '揭棋保留象棋的棋盘和将死目标，但隐藏所有非将帅棋子的身份。暗子首次按它所在起始位置的棋子走法移动、攻击和吃子，走完后翻开，之后按真实身份行棋。',
  'Banqi, also called Chinese dark chess or blind chess: the 4 by 8 half-board game with face-down pieces, rank captures, and screen-jumping cannons. Play it free in your browser.':
    '暗棋规则详解：在 4×8 半盘上进行，棋子背面朝上，按等级吃子，炮隔子跳吃，也没有王棋。免费在线对弈，无需注册。',
  'Banqi, also called Chinese dark chess or blind chess, is a fast hidden-piece game played on half a xiangqi board. All thirty-two pieces begin shuffled and face-down. The first flip assigns colors. After that, each turn is a choice: flip a tile or move a revealed piece. Captures follow rank, except for the cannon.':
    '暗棋是在半张象棋棋盘上进行的快节奏隐藏棋子游戏。三十二枚棋子全部洗匀并背面朝上。第一次翻子决定双方颜色。之后每回合都在两种行动中选择：翻开棋子，或移动一枚已翻开的棋子。除炮外，吃子按等级进行。',
  'Although it uses [Xiangqi](/rules/xiangqi) pieces, it is a separate game: pieces move one square, the general is not royal, and face-down tiles cannot be captured. This page describes the exact rules used on Mistboard.':
    '虽然它使用[象棋](/rules/xiangqi)棋子，但它是独立的游戏：棋子每次移动一格，将不是王棋，背面朝下的棋子不能被吃。本页说明 Mistboard 采用的确切规则。',
  'Most pieces capture by stepping one square onto an adjacent revealed enemy. They may capture the same rank or any lower rank. On Mistboard, the order is General > Advisor > Elephant > Chariot > Horse > Soldier. Two exceptions connect the ends of the ladder: a soldier can capture the general, and the general cannot capture soldiers.':
    '大多数棋子通过走一格到相邻的已翻开敌子上来吃子。它们可以吃同级或任何更低等级的棋子。Mistboard 的顺序是：将 > 士 > 象 > 车 > 马 > 卒。两个例外连接等级两端：卒可以吃将，将不能吃卒。',
  'Step through a real game between Mistboard’s strongest bot and a human. Red falls behind early, but its elephant becomes the highest-ranked piece left and turns the game around. Each tile reveals its dealt piece when it is first flipped.':
    '逐步回放 Mistboard 最强机器人与人类的一盘真实对局。红方开局落后，但它的象成为盘面剩余棋子中等级最高的一枚，并逆转了比赛。每枚棋子第一次翻开时会显示其被分配的身份。',
  "MistyBanqi is the bot you play in [Banqi](/rules/banqi) on Mistboard. It's a classical engine: it searches ahead and scores positions with a hand-written evaluation, no neural network, and it's open source. It will outplay most people. It also has a few honest blind spots, and the one worth knowing is that it can draw a game it has completely won.":
    'MistyBanqi 是你在 Mistboard 上对弈[暗棋](/rules/banqi)时面对的机器人。它是一个经典引擎：向前搜索，用手写评估为局面打分，没有神经网络，而且开源。它能赢过大多数人，但也有几个坦诚的盲点，其中最值得了解的是：它会把已经完全赢定的棋下成和棋。',
  'The board is seven files wide and nine ranks deep. Your den sits at the center of your back rank, ringed by three trap squares. Two rivers, each a 2×3 block of water, split the middle of the board. Red moves first from the fixed starting position below.':
    '棋盘宽七列、深九行。你的兽穴位于底线中央，周围有三个陷阱格。两条河流各占 2×3 格，分开棋盘中部。红方从下方的固定初始局面先行。',
  'Ranks and captures': '等级与吃子',
  'Each side has the same eight animals. Strongest to weakest: elephant, lion, tiger, leopard, wolf, dog, cat, rat. A piece captures an adjacent enemy of equal or lower rank.':
    '双方各有相同的八种动物。从强到弱是：象、狮、虎、豹、狼、狗、猫、鼠。棋子可吃相邻的同级或低级敌子。',
  'The rank exception connects the ends of the ladder: a rat on land can capture an elephant, while an elephant cannot capture a rat.':
    '等级例外连接序列两端：陆地上的鼠可以吃象，象不能吃鼠。',
  'On land, the lowest-ranked rat can capture the highest-ranked elephant.':
    '在陆地上，等级最低的鼠可以吃等级最高的象。',
  'How the animals move': '动物如何移动',
  'Every animal moves one square up, down, left, or right. Animals never move diagonally. Most animals stay on land, so they cannot enter a river. The rat, lion, and tiger are the three movement exceptions.':
    '每种动物都向上、下、左或右移动一格，不能斜走。大多数动物只能留在陆地，不能进入河流。鼠、狮和虎是三个移动例外。',
  Rat: '鼠',
  'The rat is the only animal that can enter water. A rat in a river can move and capture another rat there, but no piece can capture across the shoreline: a land rat cannot capture into water, and a water rat cannot capture onto land.':
    '鼠是唯一能进入水中的动物。河中的鼠可以移动，也可吃掉另一只河中的鼠，但任何棋子都不能隔着水岸吃子：陆地上的鼠不能吃进水中，水中的鼠也不能吃上陆地。',
  Lion: '狮',
  'The lion can move one land square normally, or leap straight across a river horizontally or vertically. It lands on the first square beyond the water and may capture an animal there if rank allows.':
    '狮可以在陆地上正常移动一格，也可水平或垂直跳过整条河。它落在水面另一侧的第一格，等级允许时可吃掉那里的动物。',
  Tiger: '虎',
  'The tiger can move one land square normally or leap vertically across a river. Unlike the lion, it cannot leap horizontally. A rat of either color on any water square in the path blocks either animal’s jump.':
    '虎可以在陆地上正常移动一格，也可纵向跳过河流。与狮不同，它不能横向跳河。路径上任何水格里只要有一只任意颜色的鼠，就会阻止两种动物跳跃。',
  'A rat in the river blocks the leap.': '河中的鼠会挡住跳跃。',
  'Flip Jungle is a compact hidden-piece relative of [Jungle Chess](/rules/jungle). All sixteen animals begin face-down on a 4×4 board. There are no rivers, dens, or traps: reveal tiles, move your animals, and eliminate the other color.':
    '翻翻棋是[斗兽棋](/rules/jungle)的紧凑型隐藏棋子变体。十六枚动物棋子全部背面朝上放在 4×4 棋盘上。这里没有河流、兽穴或陷阱：翻开棋子、移动动物，并消灭另一种颜色。',
  'A lion captures a lower-ranked wolf.': '狮吃掉等级较低的狼。',
  'Equal ranks work differently. When an animal captures an enemy of its own rank, both pieces leave the board, and neither side keeps the square.':
    '同等级的处理方式不同。当动物吃与自己同等级的敌子时，两枚棋子都离开棋盘，双方都不占据该格。',
  'Equal animals remove each other.': '同等级动物会一起离场。',
  'Play on Mistboard': '在 Mistboard 上对弈',
  'Play vs computer': '对战电脑',
  // Machine-drafted like the rest of this dictionary (see the note at the top
  // of TRANSLATED_ARTICLE_SLUGS); not native-reviewed.
  'Every xiangqi champion since 1956': '1956年以来的每一位全国象棋冠军',
  'Xiangqi is playable on Mistboard: find a casual or rated game against another player, take on the engine ladder, or challenge a friend. No account required. Signing in unlocks rated games.':
    '象棋可在 Mistboard 上对弈：与其他玩家进行休闲或积分对局，挑战引擎等级阶梯，或邀请好友。无需账户即可对弈，登录后可进行积分对局。',
  'Find an opponent': '寻找对手',
  'Fortress Xiangqi is playable on Mistboard. Play against an engine or challenge a friend. No account required.':
    '堡垒象棋可在 Mistboard 上对弈。挑战引擎或邀请好友，无需账户。',
  'Banqi is playable on Mistboard. Play against an engine or challenge a friend. No account required.':
    '暗棋可在 Mistboard 上对弈。挑战引擎或邀请好友，无需账户。',
  'Jungle Chess is playable on Mistboard. Play against an engine or challenge a friend. No account required.':
    '斗兽棋可在 Mistboard 上对弈。挑战引擎或邀请好友，无需账户。',
  'Flip Jungle is playable on Mistboard. Play against an engine or challenge a friend. No account required.':
    '翻翻棋可在 Mistboard 上对弈。挑战引擎或邀请好友，无需账户。',
  'Jieqi is playable on Mistboard. Play against an engine or challenge a friend. No account required.':
    '揭棋可在 Mistboard 上对弈。挑战引擎或邀请好友，无需账户。',
  'Fog Xiangqi is playable on Mistboard. Play against an engine or challenge a friend. No account required.':
    '迷雾象棋可在 Mistboard 上对弈。挑战引擎或邀请好友，无需账户。',
  'Fog Chess is playable on Mistboard. Play against an engine or challenge a friend. No account required.':
    '迷雾国际象棋可在 Mistboard 上对弈。挑战引擎或邀请好友，无需账户。',
  'FIRST FLIP ASSIGNS COLOR': '首次翻子决定颜色',
  'CANNON SCREEN CAPTURE': '炮隔子吃',
  'CAPTURED PIECE KNOWLEDGE': '被吃暗子信息',
  HIGH: '高',
  LOW: '低',
  General: '将',
  Advisor: '士',
  Elephant: '象',
  Chariot: '车',
  Horse: '马',
  Cannon: '炮',
  Soldier: '卒',
  'RED KNOWS': '红方知道',
  'BLACK KNOWS': '黑方知道',
  'the captured piece was a horse': '被吃的是马',
  'one dark piece disappeared': '一枚暗子消失了',
  'Attacking, the cannon jumps a screen and ignores rank.': '炮进攻时隔一子跳吃，不看等级。',
  'As a target it ranks here: taken by horse and up, never by a soldier.':
    '作为目标时，炮排在这里：马以上可吃，卒不可吃。',
  'CAPTURE RANK LADDER': '吃子等级序列',
  // skill-vs-luck (drafted; native validation pending before the slug joins TRANSLATED_ARTICLE_SLUGS)
  '/article-thumbs/skill-vs-luck-summary.png': '/article-thumbs/skill-vs-luck-summary.zh-hans.png',
  'for each tile the square could be:\n    put that tile under the square\n    play the flip\n    evaluate the position\naverage the results, weighted by count':
    '对这个格子可能是的每一枚棋：\n    把那枚棋放到格子下\n    走这步翻子\n    评估局面\n按数量加权，取平均',
  'decision loss = best - played      (skill, always >= 0)\nluck          = realized - played  (the dice, signed)':
    '决策损失 decision loss = best - played      （实力，恒 >= 0）\n运气　　 luck          = realized - played  （骰子，带符号）',
  'BEFORE: THE G3 TILE, FACE DOWN': '翻子前：g3 背面朝下',
  'AFTER: MY OWN SOLDIER': '翻子后：我自己的卒',
  'as played': '实际对局',
  'if every flip ran average': '每次翻子按平均',
  'accumulated luck': '累积运气',
  'the +37 flip': '+37 的那次翻子',
  'Red better': '红优',
  'Black better': '黑优',
  // The left column is also the identifier in the formula below, so it keeps the
  // English word and gains a gloss rather than being replaced.
  played: 'played（所走）',
  best: 'best（最佳）',
  realized: 'realized（实际）',
  'the average value of the flip you chose': '你所选翻子的平均价值',
  'the same average for the best move available': '当前最佳着法的同一种平均',
  'what your actual tile produced': '实际翻出的棋子带来的结果',
  'black soldier': '黑卒',
  'red soldier': '红卒',
  'red chariot': '红车',
  'red elephant': '红象',
  'red advisor': '红士',
  'red cannon': '红炮',
  'black horse': '黑马',
  'black chariot': '黑车',
  'black elephant': '黑象',
  'black advisor': '黑士',
  'black cannon': '黑炮',
  'black general': '黑将',
  'human record': '人类战绩',
  '14 wins, 33 losses, 5 draws': '14 胜 33 负 5 和',
  'net luck toward the human, in the wins': '胜局中偏向人类的净运气',
  '+28 points on average': '平均 +28 个百分点',
  'net luck toward the human, in the losses': '负局中偏向人类的净运气',
  '−9 points on average': '平均 −9 个百分点',
  'The game from the intro, live on Mistboard': '开头那盘棋，在 Mistboard 上公开',
  'Black wins · 156 plies · net luck +88 to Black': '黑胜 · 156 个半回合 · 净运气 +88 偏向黑方',
  'Black wins when Red runs out of moves. The decision numbers say Red earned the better game; the tiles said otherwise, starting with the flip at ply 6.':
    '红方无棋可走，黑方获胜。决策数字说红方下出的棋更好；棋子们说了反话，从第 6 个半回合的那次翻子开始。',
  'Separating Skill from Luck in Flip Games': '把翻子棋的实力和运气分开',
  // The seoTitle, which names the three variants where the on-page title does not.
  'Game Review for Banqi, Jieqi and Flip Jungle: Skill vs Luck':
    '暗棋、揭棋和翻翻棋的对局复盘：实力与运气',
  'Half the moves in banqi, jieqi, and flip jungle are dice rolls, so a chess-style review blames you for variance. Mistboard’s game review splits every flip into the decision and the tile: luck-stripped accuracy, a luck line on the advantage graph, and what 52 human-versus-engine games say about who really earned their wins.':
    '暗棋、揭棋和翻翻棋里，一半的着法其实是掷骰子，照搬国际象棋的复盘就会把运气算到你头上。Mistboard 的对局复盘把每次翻子拆成决策和翻出的棋子两部分：去除运气的准确率、优势图上的运气曲线，以及 52 盘人机对局告诉我们谁的胜利才是真本事。',
  'Mistboard’s game review now splits every flip into the decision you made and the tile you got. The first thing I did was run it over my own old games. It found a banqi win of mine against our own bot, from two months back, and handed the credit to the tiles.':
    'Mistboard 的对局复盘现在会把每次翻子拆成两部分：你做的决策，和你翻出的棋子。我做的第一件事，就是拿它跑了一遍自己的旧棋。它翻出了我两个月前赢自家引擎的一盘暗棋，然后把功劳记在了翻出的棋子上。',
  'The review scores everything in win chance, its 0-to-100 estimate of your odds of winning the game. My flips came out **76 points better than average**. The bot’s came out 12 points worse. I made the worse decisions, by a wide margin. I won anyway.':
    '复盘用胜率来计分：它对你赢下这盘棋的把握给出 0 到 100 的估计。我的翻子总共比平均**好出 76 个百分点**。引擎的差了 12 个百分点。论决策我下得明显更差。可我还是赢了。',
  'The flip that decided it, from the real game. One face-down tile on g3, twelve possible pieces. This article is about pricing that moment honestly.':
    '决定胜负的那次翻子，来自真实对局。g3 上一枚背面朝下的棋子，可能是十二种身份中的任何一种。这篇文章要做的，就是诚实地给这一刻定价。',
  'Most game review tools cannot say any of that.': '大多数复盘工具一句都说不出来。',
  'A flip is a decision plus a dice roll': '翻子是一次决策加一次掷骰',
  'Half the moves in a banqi game turn over a face-down tile. One move, two parts: choosing which tile to turn, and finding out what it is. Jieqi’s reveals and flip jungle’s flips are the same problem wearing different pieces; banqi is the worked example throughout because its bag is the purest.':
    '暗棋里一半的着法是翻开一枚背面朝下的棋子。一步棋，两件事：选哪枚翻，以及翻出来是什么。揭棋的揭子和翻翻棋的翻子是同一个问题换了棋子；全文用暗棋做例子，因为它的随机性最纯粹。',
  'A chess-style review grades the swing of the whole move. Flip the corner tile, find the enemy general, and the review calls it a blunder. It was a bad tile, not a bad decision.':
    '照搬国际象棋的复盘会给整步棋的胜率波动打分。翻开角落那枚棋，翻出对方的将，复盘就记你一个漏着。可那是一枚坏棋子，不是一个坏决策。',
  'This is why banqi reviews on Mistboard show no centipawn loss: it cannot be separated from the tiles, so next to numbers that can be, it reads as noise.':
    '这就是 Mistboard 的暗棋复盘不显示厘兵损失的原因：它没法和翻出的棋子分开，放在那些可以分开的数字旁边，就只是噪音。',
  'Backgammon solved this decades ago': '西洋双陆棋几十年前就解决了这件事',
  'Backgammon software prices every roll against the average roll and reports a luck-adjusted result, so a match report can tell you that you played better and lost. GnuBG and eXtreme Gammon both do it. Poker has the same idea in all-in EV.':
    '西洋双陆棋的软件会把每次掷骰和平均掷骰作比较，报告一个剔除运气后的结果，所以一份战报可以告诉你：你下得更好，但你输了。GnuBG 和 eXtreme Gammon 都这么做。扑克里的 all-in EV 是同一个思路。',
  'Chess never built any of this because chess has no dice. Banqi is a chess-family game with dice in it, and it inherited chess’s tools, which have no luck column.':
    '国际象棋从没造过这些东西，因为它没有骰子。暗棋是象棋家族里带骰子的一员，却继承了国际象棋的工具，而那些工具里没有运气这一栏。',
  'The average tile in the bag': '剩下棋子里的平均一枚',
  'Banqi’s chance is countable. Both players can see which tiles are still face down, and the full set of pieces is known, so at any flip you can list every tile that square could be. That makes the honest baseline computable:':
    '暗棋的随机性是数得清的。双方都看得到哪些棋子还背面朝下，整副棋的构成也是公开的，所以任何一次翻子，你都能列出那个格子上可能翻出的每一枚棋。这让诚实的基准变得可以计算：',
  'That average is what your decision was worth **before the dice**. Three numbers per flip:':
    '这个平均值，就是你的决策在**掷骰之前**的价值。每次翻子三个数字：',
  'per flip': '每次翻子',
  meaning: '含义',
  'Zero luck is exactly the average tile in the bag, by construction, not by an engine’s opinion.':
    '运气为零，恰好就是翻出剩下棋子里的平均一枚。这是由构造保证的事实，不是引擎的看法。',
  'The flip from the intro, enumerated': '开头那次翻子，逐一枚举',
  'Ply 6 of the game this article opens with: I turn the tile on g3. Twenty-seven tiles are still face down, twelve kinds, and each one leads to a different game.':
    '本文开头那盘棋的第 6 个半回合：我翻开 g3 上的棋子。此时还有二十七枚背面朝下，共十二种身份，每一种都通向一盘不同的棋。',
  'what the g3 tile could be': 'g3 这枚棋可能是什么',
  count: '数量',
  'win% for Black': '黑方胜率',
  'The same flip is worth anywhere from 13% (my own general, deep in contested ground) to 82% (my own soldier, safe and useful there). The weighted average is 45%. **That number is the decision**, and it is what accuracy grades.':
    '同一次翻子的价值从 13%（翻出我自己的将，深陷争夺之地）到 82%（我自己的卒，在那里既安全又有用）不等。加权平均是 45%。**这个数字才是决策本身**，准确率打分打的就是它。',
  'The highlighted row is what the bag actually handed me. Realized 82, played 45, luck plus 37, and none of it to my credit.':
    '高亮的那一行就是实际翻出的结果。实际 82，决策 45，运气 +37，而这份运气没有一点是我挣来的。',
  'Engines are biased about their own dice': '引擎对自己的骰子有偏心',
  'The obvious shortcut is to ask the engine what a flip move is worth and call the difference luck. Our jieqi engine showed why not: it over-values its reveals and plays greedy, gambling lines. Averaging fixed positions, each with the tile already decided, keeps the chance node out of the search entirely, so the bias has nowhere to live.':
    '最省事的捷径，是直接问引擎一步翻子值多少，再把差值叫作运气。我们的揭棋引擎演示了为什么不行：它高估自己的揭子，下出贪婪、赌博式的着法。而对一组身份已经确定的固定局面取平均，让概率节点完全不进搜索，偏心就无处安身。',
  'The flip that deals you your color': '决定你执哪色的那次翻子',
  'The first flip of the game decides which color you play: whatever ink comes up, that side is yours. The counterfactuals for that flip vary your own army, so the decomposition prices "which side did I get" as luck. That sounds wrong for about ten seconds, and then it sounds exactly right.':
    '开局第一次翻子决定你执哪种颜色：翻出什么色，你就执什么色。这次翻子的反事实会改变你自己的整支军队，所以这套拆分把"我分到哪一边"也计成运气。乍听之下不太对劲，想上十来秒就完全对了。',
  'What the review draws': '复盘画出什么',
  'The game from the intro. Solid: the game as played, from Red’s side. Dashed: the same game with every flip at its average. The gap is the luck.':
    '开头那盘棋。实线：实际进行的对局，从红方视角。虚线：同一盘棋，每次翻子都按平均值计。两线之间的差距就是运气。',
  'The advantage graph gets a second line. Solid is the game as it happened. Dashed is the same game with every flip scored at its average tile. Between flips the two lines move together, because ordinary moves affect both versions equally. At each flip the gap changes by exactly that flip’s luck, so by the end the gap is the whole game’s luck added up.':
    '优势图多了一条线。实线是实际发生的对局。虚线是同一盘棋，每次翻子都按平均的那一枚计分。两次翻子之间，两条线同步移动，因为普通着法对两个版本的影响完全一样。每到一次翻子，差距就恰好按那次翻子的运气变化，所以到终局时，两线的差距就是整盘棋的运气总和。',
  'That is why the dashed line here runs one way while the solid line swings. My luck kept landing in the same direction, flip after flip, so the gap only grew. Scored on decisions alone the bot was winning nearly throughout, and once the dashed line says the game should be completely won it pins at the top.':
    '这也是为什么图里的虚线一路朝一个方向走，而实线上下翻腾。我的运气一次又一次落在同一侧，差距只增不减。只看决策的话，引擎几乎全程占优；一旦虚线认定这盘棋照理已经完胜，它就顶在最上沿不动了。',
  'The move list carries the split per move. Every flip gets a dice badge with its luck, next to the eval, and decisions are graded separately: move 3 below is the +37% flip, marked dubious as a choice even though it won me the game.':
    '着法列表把这份拆分标到每一步上。每次翻子都带一个骰子标记，写着它的运气，就在评估值旁边；决策则单独打分：下图第 3 步就是那次 +37% 的翻子，虽然它帮我赢了棋，作为选择却被标为可疑。',
  'The exhibit game’s move list. Move 3 is the +37% flip, dubious as a decision.':
    '示例对局的着法列表。第 3 步是那次 +37% 的翻子，作为决策被标为可疑。',
  'The review move list: each flip carries a dice badge with its luck percentage beside the eval, and move 3, the +37% flip, is graded ?! as a decision.':
    '复盘着法列表：每次翻子的评估值旁都有骰子标记标出运气百分比；第 3 步即 +37% 的那次翻子，作为决策被标为 ?!。',
  'And accuracy is graded on the decision numbers only, so a lucky flip does not improve it and an unlucky one does not hurt it. The summary for this game reads exactly the way the story went: the bot played clean, I did not, and the result said otherwise.':
    '而准确率只按决策数字打分，翻得走运不会加分，翻得倒霉也不会扣分。这盘棋的总结和故事本身完全一致：引擎下得干净，我则不然，而结果却说了反话。',
  'The same game’s luck-stripped summary. dev-testing is me, on my test account.':
    '同一盘棋去除运气后的总结。dev-testing 是我，用的是我的测试账号。',
  'The luck-stripped accuracy summary for the exhibit game: MistyBanqi 95% accuracy with no mistakes, dev-testing 89% with nine inaccuracies, two mistakes, and two blunders.':
    '示例对局去除运气后的准确率总结：MistyBanqi 准确率 95%，零失误；dev-testing 89%，九次失准、两次错着、两次漏着。',
  'The receipts': '证据',
  'The win I opened with: 156 plies against the bot, and the graph tells on me. At ply 6 the 45% flip came up worth 82%. No decision in the game moved the needle that far.':
    '开头那场胜利：对引擎的 156 个半回合，图把我供了出来。第 6 个半回合，那次值 45% 的翻子翻出了 82%。整盘棋里没有任何一个决策能把指针拨得这么远。',
  'In total: my flips **plus 76**, the bot’s minus 12, and my flip decisions gave away 74 points against the bot’s zero. The dashed line has me losing most of the game. The solid line has me winning. The bag overruled the play. The whole game is [open on Mistboard](/banqi/game/bq_7e8ce2e7-8e64-4453-b9fd-9dcc4bd52fa9), replay below.':
    '总账：我的翻子**+76**，引擎的 −12；翻子决策上我送掉 74 个百分点，引擎送掉 0。虚线里我大半盘都在输。实线里我赢了。棋子推翻了棋艺。整盘棋[在 Mistboard 上公开](/banqi/game/bq_7e8ce2e7-8e64-4453-b9fd-9dcc4bd52fa9)，下方可以回放。',
  'Step to ply 6: the flip worth 45% on average that came up worth 82%.':
    '走到第 6 个半回合：平均价值 45% 的那次翻子，翻出了 82%。',
  'It cuts the other way too. In [another game](/banqi/game/bq_123a6232-6f9f-4677-90ae-a75d5700a446) I lost, one flip at ply 19 cost 34 points of win chance on its own. My decisions that game were ordinary. The old review would have marked that flip as the losing blunder. The new one marks it as the moment the game was decided by something that was not a choice.':
    '反过来也一样。在我输掉的[另一盘棋](/banqi/game/bq_123a6232-6f9f-4677-90ae-a75d5700a446)里，光是第 19 个半回合的一次翻子，就烧掉了 34 个百分点的胜率。那盘棋我的决策平平。旧式复盘会把那次翻子记为致败漏着。新的复盘把它记为：胜负在此刻被一件不由你选择的事定了下来。',
  'Fifty-two games of evidence': '五十二盘棋的证据',
  'We ran the decomposition over 52 recent human-versus-Misty banqi games from the site.':
    '我们把这套拆分跑遍了站上最近 52 盘人类对 Misty 的暗棋。',
  'across 52 human vs Misty games': '52 盘人类对 Misty 的对局',
  value: '数值',
  'The bot is stronger, and beating it has usually taken help from the bag. If you have beaten it, the review will now tell you how much help you got.':
    '引擎更强，赢它通常都借了棋子的力。如果你赢过它，现在复盘会告诉你借了多少。',
  'Jieqi rolls different dice': '揭棋掷的是另一种骰子',
  'Jieqi gets the same treatment with a different pool. A jieqi reveal draws from your own remaining dark pieces, so you know the color and not the piece. A banqi tile is dark to both players, color included. Different bags, same arithmetic, and jungle’s flip variant makes a third. Every one of them gets the dashed line.':
    '揭棋用同一套办法，只是抽取的范围不同。揭棋的揭子从你自己剩余的暗子里抽，所以你知道颜色，不知道身份。暗棋的棋子对双方都是暗的，连颜色也是。范围不同，算法相同，斗兽棋的翻棋版本（翻翻棋）是第三家。它们每一个都有那条虚线。',
  'For the builders': '写给实现者',
  'Three choices keep the numbers honest. First, **a counterfactual must not change what is in the bag**. Relabel the flipped square from a soldier to a cannon and you have quietly added a cannon to the game and removed a soldier, which rebalances the position by two pieces and inflates the average. So the implementation swaps: the counterfactual tile trades places with a face-down square that really holds one, and the hidden set stays exactly the game’s.':
    '三个选择让这些数字保持诚实。第一，**反事实不能改变剩下棋子的构成**。把翻开的格子从卒改标成炮，你就悄悄往棋局里加了一枚炮、拿走了一枚卒，局面因此偏移两枚棋子的分量，平均值也被抬高。所以实现里用的是交换：让反事实身份和一个确实藏着这枚棋的背面格子对调，隐藏棋子的集合始终恰好等于这盘棋的集合。',
  'Second, **one bounded scale**. Everything is win chance from the flipping player’s side: it adds up across a game, a flip that ends the game scores exactly 100, 50, or 0, and a flip that walks into mate has no centipawn value anyway. Search budgets are node counts rather than time, so the same game grades identically on any machine.':
    '第二，**一把有界的尺子**。一切都用翻子一方视角的胜率来计：它可以在整盘棋上累加；直接终局的翻子恰好计 100、50 或 0；而一步翻进杀局的棋本来就没有厘兵值可言。搜索预算按节点数而非时间计，同一盘棋在任何机器上打出的分都一样。',
  'Third, **under-count on purpose**. The decision ceiling considers only the engine’s top move, so a better move the engine ranked second is missed and decision loss is only ever understated. The review can fail to flag a mistake. It cannot invent one.':
    '第三，**故意往少里算**。决策上限只考虑引擎的第一选择，被引擎排在第二的更好着法会被漏掉，所以决策损失只会被低估。复盘可能漏报一个失误，但绝不会凭空捏造一个。',
  'Where the numbers stop': '数字到哪里为止',
  'The win percentages come from our banqi engine at a fixed search budget, and that engine is also the opponent in these games, so its own flips grade as near-perfect partly because it agrees with itself. Read "the bot lost zero points" with that in mind. The human numbers have no such problem.':
    '这些胜率出自我们的暗棋引擎在固定搜索预算下的评估，而这个引擎同时也是这些对局里的对手，所以它自己的翻子被打成近乎完美，部分原因不过是它在认同自己的选择。看到"引擎零损失"时，请记住这一点。人类一侧的数字没有这个问题。',
  'One more honest limit: subtracting luck point-by-point treats win chance as linear, which it is not. The directions are trustworthy. The second decimal is not.':
    '还有一条诚实的边界：逐点扣除运气，等于把胜率当成线性的，而它并不是线性的。方向可信。小数点后第二位不可信。',
  'Try it on your own games': '拿你自己的棋试试',
  'Open any finished banqi, jieqi, or jungle flip game on Mistboard, yours or anyone’s from the [watch page](/watch), and request computer analysis. The luck numbers appear per flip in the move list, and the dashed line shows the game the bag would have given you.':
    '在 Mistboard 打开任何一盘下完的暗棋、揭棋或翻翻棋，你自己的，或[观战页](/watch)上任何人的，然后请求电脑分析。运气数字会逐翻子出现在着法列表里，虚线则画出棋子们本该给你的那盘棋。',
  'Sometimes it agrees you were robbed. Sometimes it takes your win away. It did both to me in a single pass over my old games.':
    '有时它承认你是被抢了。有时它把你的胜利收走。在对我旧棋的一轮扫描里，这两件事它都做了。',
  'Play Banqi': '下暗棋',
  'Play Jieqi': '下揭棋',
  'Play Jungle Flip': '下翻翻棋',
  // riverbank-cannon (drafted 2026-08-23; machine battery applied, native read pending)
  'The Riverbank Cannon Problem': '巡河炮问题',
  'Fog Xiangqi Opening Theory: The Riverbank Cannon': '迷雾象棋开局理论：巡河炮',
  'Red’s opening cannon reaches the riverbank first, one move from firing down any of five files, and in fog you never see it coming. Whether that breaks the game came down to one elephant move, one poisoned defense, and a coin flip we priced with the engine.':
    '红方的起手炮抢先赶到河沿，只差一步就能沿五条纵线中的任何一条开火，而在迷雾里你根本看不见它的到来。这会不会毁掉整个棋种，最终落在一步飞象、一个有毒的防守，以及一次我们用引擎算清了价码的硬币对赌上。',
  'Fog xiangqi is xiangqi with two changes: you only see the points your own pieces could move to, and there is no check. Capture the general and the game ends.':
    '迷雾象棋就是改了两条规则的象棋：你只能看见自己棋子能走到的交叉点，而且没有将军。擒获将帅，对局即告结束。',
  'That makes Red’s first move alarming. Slide the opening cannon to the riverbank and it is one move from firing down any of five files: two chariots, two elephants, and behind the center soldier, the general. One capture ends the game. I built this variant, and I wondered if it was dead on arrival.':
    '这让红方的第一步变得令人不安。起手把炮拉上河沿，它就只差一步便能沿五条纵线中的任何一条开火：两个车、两个象，还有中卒身后的将。吃一子就能终结对局。这个变体是我做的，我一度怀疑它是不是一落地就死了。',
  'The dots are the five firing points. From each one the cannon shoots the piece behind the soldier screen: chariot, elephant, general, elephant, chariot.':
    '圆点是五个开火点。从每个点上，炮都隔着一枚卒作炮架，打中它身后的那枚棋子：车、象、将、象、车。',
  'So I checked, against the real rules kernel and our fog engine. Short version: the threat is worse than it looks, the natural defense is a trap, and the game survives.':
    '于是我去验证了，用的是真实的规则内核和我们的迷雾引擎。简短版结论：威胁比看上去更凶，最自然的防守是个陷阱，而这个棋种活了下来。',
  'The rush is invisible': '速攻是隐形的',
  'The b-file route announces itself: Black’s cannon watches that file and sees something land on the riverbank. Red does not have to go that way. Up the empty d-file, nothing Black owns sees a single point: d3, d5, e5, mate on move 4. The only warning is that a red piece left home, which describes every game ever played.':
    '走 b 路会自报行踪：黑方的炮盯着这条纵线，能看见有东西落到河沿上。但红方不必走那条路。沿着空空的 d 路上去，黑方没有任何棋子能看见其中任何一个点：d3、d5、e5，第 4 回合擒将。唯一的警报只是「有一枚红子离开了原位」，而这句话描述的是古往今来的每一盘棋。',
  'One move before mate. Left: the truth. Right: everything Black can see. The cannon never enters the picture.':
    '擒将前一步。左：真实局面。右：黑方能看见的一切。炮自始至终没有进入画面。',
  'So the defense cannot wait for a warning; it has to be played every game. The rest of the article draws the visible route so the diagrams read easily. The threats are the same either way.':
    '所以防守不能等警报响了再做，它必须每盘都走。本文其余部分为了图示清晰，一律画可见的那条路线。两条路线的威胁完全相同。',
  'The natural defense is a landmine': '最自然的防守是颗地雷',
  'There is exactly one screen between cannon and general: Black’s own center soldier. A cannon needs exactly one, so any second body on the center file kills the mate. The natural pick is advisor up. It seals the center and nothing else, and it plants a mine: Red slides to an elephant wing and takes.':
    '炮与将之间恰好隔着一个炮架：黑方自己的中卒。炮吃子恰好需要一个炮架，所以在中路上再垫进任何一枚棋子，擒将就不成立了。最顺手的选择是补士。它封住中路，除此之外什么也不做，还埋下一颗地雷：红炮平到一侧象所在的纵线，隔着卒把象吃掉。',
  'Red guessed the wing whose advisor stayed home. The cannon fires along the back rank through it, the marked flight point loses to the same shot, and the sealing advisor blocks the only parry. All 41 legal replies lose, engine-checked. The other wing costs only an elephant.':
    '红方猜中了士还留在原位的那一翼。炮沿底线隔着这枚士开火，标记的出逃点同样挨这记炮，而支上去的那枚士又恰好堵住了唯一的解法。经引擎穷举，41 种合法应着全部败北。红方猜向另一翼时，黑方只损失一个象。',
  'There is a save: play the poisoned wing’s elephant to the middle immediately, and both grabs die. But that is the move you should have opened with. The advisor spends a whole move doing a fraction of the elephant’s job, and while you fix it, Red takes a rim chariot for free.':
    '有一手解救：立刻把有毒一翼的象飞上中路，两个吃象点就同时失效。但这本该是你开局的第一步。补士花掉整整一步，却只做了飞象工作的一小部分，而在你补救的同时，红方白吃一个边线的车。',
  'One elephant move holds everything': '一步飞象守住一切',
  'The move that works is the standard developing move of xiangqi: elephant to the middle.':
    '真正管用的，是象棋里最标准的出子着法：飞中象。',
  'Second screen on the center file, so the snipe is marked dead; both elephant home points covered by the recapture.':
    '中路多了第二个炮架，狙击宣告失效（图中打叉处）；两个象位原点都有回吃保护。',
  'Snipe dead, both elephant wings covered, one move. Xiangqi theory reached this square centuries before the fog did. A cannon to the same point works too.':
    '狙击废了，两翼的象都有保护，只用一步。象棋理论比迷雾早几百年就走到了这个点上。把炮走到同一个点同样管用。',
  'The chariot gamble': '赌车',
  'That leaves the edges: from the riverbank corner the cannon shoots the chariot through the edge soldier, and the elephant does nothing about it.':
    '剩下的是两条边线：炮从河沿的边角隔着边卒打车，而中象对此无能为力。',
  'Move order decides this. The mate cannot arrive before Red’s third move, so the elephant is still in time on Black’s second. The edges cannot wait: Red picks his corner on his second move, and a soldier pushed after that is too late. So soldier first, elephant second. The pushed soldier watches the one point the cannon must fire from, and eats it on arrival.':
    '这件事由行棋次序决定。擒将最早也要等到红方第三步，所以黑方第二步飞象还来得及。边线却等不起：红方第二步就要选定边角，之后再推的卒已经迟了。所以先挺卒，再飞象。推上去的卒正好盯住炮必须开火的那个点，炮一落地就被吃掉。',
  'The same push, one move apart. Played first, the soldier watches the arrival point and the cannon dies on landing. Played second, the cannon shoots the chariot straight over it: a pushed soldier still counts as one screen.':
    '同一步挺卒，只差一个回合。先走，卒盯住落点，炮一落地就死。后走，炮直接隔着它把车打掉：推过的卒照样只算一个炮架。',
  'That leaves one honest gamble. Red commits blind to a corner on move two: half the time it is the watched one and he trades his cannon for a soldier, half the time he wins a chariot. Played out by the engine, the branches roughly cancel. One fair coin flip per game, and only if Red commits immediately: given a third move, Black closes both edges.':
    '于是只剩一场堂堂正正的赌局。红方第二步盲选一个边角：一半概率选中被盯住的那边，用炮换一个卒；另一半概率赢下一个车。交给引擎跑完后续，两条分支大致相抵。每盘只有一次公平的掷硬币，而且红方必须立刻下注：只要多给黑方一步，两条边线就都关上了。',
  'When the cannon dies': '炮死之后',
  'Half the flips, Red loses the cannon to the soldier. He recaptures the soldier (the engine did, in every playout), and the recapture is a gift: it is now the screen, and Black’s cannon shoots the corner chariot straight through it. The engine scores this -0.55 for Red: attack over, a cannon down, nothing to show.':
    '掷硬币的一半结果里，红炮死在卒的手上。红方回吃这个卒（引擎在每一盘推演里都这么走了），而这步回吃是份大礼：它自己成了炮架，黑炮隔着它一炮打穿角上的车。引擎给红方打出 -0.55：攻势结束，净亏一炮，一无所获。',
  'After the recapture on a5, Black’s cannon steps to the edge and fires through Red’s own soldier. Misty found this follow-up in every playout.':
    '红方在 a5 回吃之后，黑炮平到边线，隔着红方自己的兵开火。Misty 在每一盘推演里都找到了这个后续。',
  'Can Red defend the shot? Two ways, neither happy. Declining the recapture keeps two screens on the file, but the crossed soldier just keeps eating and the shot reopens a move later, one soldier cheaper. Recapturing and then blocking with the horse holds the chariot. In six engine playouts from the fired tripwire, the whole sequence played itself out, capture, recapture, counter-shot and all, and Black converted five (the Tripwire games in the companion study). The block:':
    '红方挡得住这一炮吗？有两条路，都不痛快。不回吃可以在这条线上留住两个炮架，可过河的黑卒会继续一路吃过去，一步之后炮线重新打开，红方还多丢一个兵。回吃之后再跳马垫线，车是保住了。在从绊索触发开始的六盘引擎推演里，整套流程自动上演，吃、回吃、反击炮一样不缺，黑方拿下了其中五盘（配套研究里的 Tripwire 系列对局）。垫挡是这样的：',
  'When the chariot falls': '车丢之后',
  'The other half, Black is a chariot down. The engine scores positions from -1, lost, to +1, won; it calls this one -0.75, which is roughly one win in eight. Close to lost, not over. And the landed cannon looks scarier than it is: every capture it has loses on the spot to a recapture. Its real power is the freeze: the horse and the elephant beside it are holding the back rank shut, and if either ever moves, the next shot is the general.':
    '另一半结果里，黑方净亏一个车。引擎给局面打分从 -1（必败）到 +1（必胜）；它给这个局面打 -0.75，大约是八盘赢一盘。接近输定，但还没完。而且落在角上的炮看着比实际吓人：它能吃的每一子，吃完都会立刻被回吃。它真正的威力是冻结：旁边的马和象正把底线关得死死的，两者只要有一个动了，下一炮打的就是将。',
  'The cannon’s bites (arrows left) are answered: the central elephant retakes on one point, the general on the other. But the horse and elephant are the back rank’s screens now. Move either and the cannon mates. Leave them home.':
    '炮能吃的两个点（左侧箭头）都有回应：一个点由中象回吃，另一个点由将亲自回吃。但马和象现在就是底线的炮架。动其中任何一个，炮就擒将。让它们待在家里。',
  'So how does Black fight? The engine showed three ideas. First, patience: touch nothing on the back rank. Second, an immediate simplification: in our first playouts its opening move from here, every game, was to snipe Red’s home horse with its own cannon, over Red’s home cannon as the screen, trading cannon for horse to blunt the attack. Third, counterattack on the other wing, where your own cannons still have a game; the next section shows the sharpest version. And it escapes: of the ten forced-grab games, Black won two outright (Rim gambit games 2 and 8 in the companion study, in 84 and 56 plies) and held three more to the ply cap. One win in eight is the eval; in the decided games, the practice was one in four.':
    '那黑方怎么打？引擎给出了三条思路。第一，耐心：底线上什么都不碰。第二，立刻简化：在我们最初的推演里，它从这个局面走的第一步，每一盘都是用自己的炮隔着红方还在原位的炮，把红方原位的马狙掉，以炮换马，钝化攻势。第三，在另一翼反击，你自己的炮在那边还有戏；下一节会展示最锋利的版本。而且这局面逃得出去：十盘强制抓车的对局里，黑方直接赢下两盘（配套研究里的 Rim gambit 第 2、第 8 局，分别用了 84 着和 56 着），另有三盘撑到了着数上限。八分之一的胜率是评估值；在分出胜负的对局里，实战是四分之一。',
  'Whoever moves the wall first dies': '谁先挪墙谁先死',
  'One pattern decided games in every branch, and it travels to any fog game with long-range pieces: a cannon on its firing point is also the block against the enemy cannon opposite. Whoever steps away first, the other fires through the hole. And the fog baits you to step away: from the wall, an enemy soldier looks free. Take it and you are mated on the reply.':
    '有一个模式在每条分支里都决定过胜负，而且它适用于任何带远程棋子的迷雾棋：站在开火点上的炮，同时也是挡住对面敌炮的墙。谁先离开，对方就从缺口里开火。而迷雾偏偏会引诱你离开：站在墙上望过去，敌方的卒像是白送的。吃了它，下一着你就被擒将。',
  'Which answers a fair question: why not go to the riverbank yourself as Black? You can, and it punishes any Red who grabs. Red has exactly one sound reply: seal his own center before touching anything. Then the battery never fires.':
    '这也回答了一个合理的问题：黑方为什么不自己也去河沿？可以去，而且它能惩罚任何伸手抓子的红方。红方只有一条稳妥的应法：先封住自己的中路，再碰任何东西。这样一来，这门反架炮永远开不了火。',
  'The line: cannon to the riverbank, Black answers with his own battery, Red seals with the elephant before grabbing. The battery is now two screens from the general (the cross) and frozen where it stands; move it and Red’s cannon fires. The engine puts Red a quarter point up here (+0.25, against 0.00 in the soldier line) and sends its cannon to the edges (the arrow). A weapon for greedy opponents, not a default.':
    '变化如下：红炮上河沿，黑方用自己的反架炮回应，红方在抓子之前先飞相封中。这门反架炮与红帅之间现在隔着两个炮架（打叉处），被冻结在原地；它一动，红炮就开火。引擎认为红方在此领先四分之一个点（+0.25，对比挺卒主线的 0.00），并把炮转向两条边线（箭头处）。这是对付贪心对手的武器，不是默认选择。',
  'What the engine says': '引擎怎么说',
  'I forced the rush onto the board and let Misty play both sides, thirty games: twenty through the snipe attempt, ten through the chariot grab. The snipe never fired once; Black sealed within three moves in eighteen of twenty. The rush games went Black 9, Red 4, seven ply-cap draws; the forced grabs went Red 5, Black 2, three caps. Then I made Black answer the same forced rush with this article’s exact line, eight more games: Black won six, no draws. The line does not just suit humans; it outscored the engine’s own defensive choices. Here is one of those games in full:':
    '我把速攻强制摆上棋盘，让 Misty 执双方下了三十盘：二十盘走狙击尝试，十盘走抓车。狙击一次也没有打响；二十盘里有十八盘，黑方三步之内就完成了封堵。速攻组的战绩是黑方 9 胜、红方 4 胜、7 盘达到着数上限；强制抓车组是红方 5 胜、黑方 2 胜、3 盘到上限。然后我让黑方用本文教的这条线应对同样的强制速攻，又下了八盘：黑方赢了六盘，没有和棋。这条线不只是适合人类；它拿下的分数比引擎自己选的防守还多。下面是其中一盘的完整棋谱：',
  'All the games behind this article are in the [companion study](/study/3LGIVr59): the theory lines, twenty forced-rush games and ten forced rim-gambit games with the engine on both sides, and sixteen free self-play games. Flip the study board to Black’s fogged view and step through what he actually saw.':
    '本文背后的所有对局都收录在[配套研究](/study/3LGIVr59)里：理论变化、二十盘强制速攻与十盘强制边线抓车的引擎对局，以及十六盘自由自对弈。把研究棋盘切到黑方的迷雾视角，一步步看他当时究竟看见了什么。',
  'Left to choose freely, sixteen more games, Red won eleven of the twelve decisive and never once played the rush. Lean samples, so treat the counts as direction. The position evaluations are firmer ground: they hold still under a sixteen-fold compute increase.':
    '完全放开让它自由选择，再下十六盘，十二盘分出胜负的对局里红方赢了十一盘，而且一次也没有走过速攻。样本不大，这些计数只当方向看。局面评估值则站得更稳：算力加到十六倍，数值纹丝不动。',
  position: '局面',
  'engine verdict': '引擎判定',
  'game start, Red to move': '开局局面，红方走子',
  '+0.06 Red: a real but small first-move edge': '+0.06 红优：真实但很小的先手优势',
  'theory settled: seal up, rush cannon on e5': '理论定型：封堵完成，速攻炮停在 e5',
  '0.00: dead even, the rush fully answered': '0.00：完全均势，速攻被彻底化解',
  'Red won the chariot flip': '红方赌赢了车',
  '-0.75 for Black: close to lost, still fighting': '黑方 -0.75：接近输定，仍有抵抗',
  'Red lost the cannon flip': '红方赌输了炮',
  '-0.55 for Red: clearly losing': '红方 -0.55：明显败势',
  'counter-battery vs a Red who seals first': '反架炮对先封中的红方',
  '+0.25 Red: the battery concedes more than the soldier line':
    '+0.25 红优：反架炮比挺卒主线让出更多',
  'One last check: I forced Black through the line this article teaches against a free Red, eight games. Black won five of the seven decisive, against one of twelve when choosing freely. The three insurance moves cost nothing.':
    '最后一项检验：我强制黑方按本文教的线走，对手是自由行棋的红方，共八盘。七盘分出胜负的对局黑方赢了五盘，而自由选择时是十二盘里赢一盘。这三步保险着法毫无代价。',
  'Average the flip branches and the committed rush is worth about +0.10 to Red, the same ballpark as the +0.06 he starts with: the whole first-move advantage, spent in one gamble. Initiative in fog is real, probably bigger than in chess, because defense is paid blind. The rush is the loudest way to spend it, and the loudest way is answerable.':
    '把赌局的两条分支取平均，孤注一掷的速攻对红方约值 +0.10，和开局自带的 +0.06 属于同一量级：整份先手优势，在一场赌局里一次花光。迷雾中的主动权是真实的，多半比国际象棋里还大，因为防守是闭着眼睛付账的。速攻是花掉主动权最响亮的方式，而最响亮的方式是有解的。',
  'The line to learn': '该学的那条线',
  'Black’s three moves: edge soldier, central elephant, far-side horse. The dot is the watched firing point, the cross is the dead snipe, the arrows are the elephant’s cover.':
    '黑方的三步：挺边卒、飞中象、跳远端马。圆点是被盯住的开火点，叉是已失效的狙击，箭头是中象的保护范围。',
  'As Black: edge soldier, elephant to the middle, horse to the other edge. After three moves the only target left is the chariot on the edge you did not push, and only if Red committed on move two. Never seal with the advisor. And before you move any piece near a landed cannon, count screens: most losses we found came from moving a piece that was quietly holding a firing line shut.':
    '执黑：挺边卒，飞中象，马跳向另一侧边线。三步之后，剩下的唯一目标就是你没推卒那一侧的车，而且只有红方第二步就下注时才吃得到。永远不要用士封中。在挪动落地炮附近的任何棋子之前，先数炮架：我们找到的大多数败局，都来自挪动了一枚正默默封着某条火线的棋子。',
  'As Red: the rush beats anyone who has not read this far, and it is even money against anyone who has. If you play it, commit to an edge on move two or not at all, and seal your own center before cashing any grab: every scripted Red that grabbed first got mated.':
    '执红：速攻能赢下所有没读到这里的人，对读过的人则是对半开的赌注。如果你要走它，第二步就选定边线，否则干脆别选，并且在兑现任何抓取之前先封住自己的中路：脚本里每一个先抓子的红方都被擒了将。',
  'Step through it yourself': '亲手走一遍',
  'Every line and every game in this article is in the companion study, on a board you can flip to either side’s fogged view. When you are ready, Misty will punish you while you learn the line. No account required.':
    '本文的每条变化、每盘对局都在配套研究里，棋盘可以切换到任何一方的迷雾视角。准备好之后，Misty 会在你练这条线的时候好好教训你。无需账户。',
  'Open the companion study': '打开配套研究',
  'THE TRUTH': '真实局面',
  'WHAT BLACK SEES': '黑方所见',
  'THE POISONED ADVISOR': '有毒的补士',
  'ONE MOVE, THREE FILES': '一步守三线',
  'SOLDIER FIRST': '先挺卒',
  'SOLDIER TOO LATE': '挺卒已迟',
  'ONE SLIDE FROM EVERYTHING': '一步之遥',
  'THE THREE-MOVE ANSWER': '三步答案',
  'THE BATTERY, FROZEN': '冻结的反架炮',
  'THE RECAPTURE IS A GIFT': '回吃是份大礼',
  'THE FREEZE': '冻结',
  'The stealth rush': '隐形速攻',
  'Kernel-verified line': '经规则内核验证的变化',
  'Red captures the general on move 4. Black developed normally and saw nothing.':
    '红方在第 4 回合擒获黑将。黑方正常出子，全程什么都没看见。',
  'Red saves the chariot': '红方保车',
  'The horse steps to the edge as a second screen and the shot is dead. Red is still a cannon for a soldier down with nothing to attack. The engine scores the branch -0.55 either way and calls the recapture the least bad move on the board: the block saves a piece, not the game.':
    '马跳到边线充当第二个炮架，这一炮就打不响了。红方仍然是用一炮换了一卒，且无攻可组。引擎给这条分支的评分横竖都是 -0.55，并认为回吃是全盘最不坏的一步：垫挡救的是一枚子，不是这盘棋。',
  'The counter-battery': '反架炮',
  'Black skipped the elephant and parked a cannon on the center file. Red cannot see it, grabs the chariot, and is mated on the reply.':
    '黑方跳过飞象，把一门炮架在了中路。红方看不见它，伸手抓了车，下一着帅就被擒。',
  'Rush vs the recommended line, game 7 of 8': '速攻对推荐线，八盘中的第七盘',
  'Engine-vs-engine playout, full record': '引擎对引擎推演，完整棋谱',
  'Both sides forced through their first three moves, then free. Black follows the line this article teaches; the snipe never comes, heavy trades follow, and Black finishes with a deflection: chariot takes the advisor beside the general, the general recaptures, and the second chariot takes the general.':
    '双方前三步按脚本强制，之后自由行棋。黑方走的正是本文教的线；狙击始终没有到来，随后是大量兑子，最后黑方用一记引离收尾：车吃掉帅旁边的仕，帅回吃，另一个车擒帅。',
  'Misty (rush forced)': 'Misty（强制速攻）',
  'Misty (this article’s line)': 'Misty（本文推荐线）',
  Red: '红方',
  Black: '黑方',

  // -- Every Xiangqi Champion (xiangqi-champions) --
  // MACHINE-DRAFTED 2026-08-28, NOT NATIVE-REVIEWED, by explicit decision.
  // Champion names are deliberately NOT converted for the Traditional reader:
  // a person's name is written in the script that person uses, and all
  // twenty-two are mainland players. champion-name-script.test.ts enforces it.
  // Chart labels and table cells are keys too, so the figure and the ruling
  // column localize with the prose instead of staying English under it.
  // seoTitle: drives the localized <title> and og:title. It sits OUTSIDE
  // articleProse, so the coverage contract cannot see it missing; the zh
  // pages shipped an English <title> over Chinese prose until this landed.
  'Every Xiangqi Champion: Chinese Chess Title Holders and Their Games':
    '历届全国象棋冠军：中国象棋冠军名录与对局讲解',
  'Every Xiangqi Champion': '历届全国象棋冠军',
  'Every winner of the Chinese national xiangqi championship since 1956, and an annotated game for thirteen of them. Plus the nine hundred years before the title existed, and the decade that has been struck from the record.':
    '1956年以来中国象棋全国个人赛的每一位冠军，其中十三位各配一局讲解棋谱。另有这个头衔出现之前的九百年，以及被从纪录里抹去的十年。',
  'Ask who the greatest chess player was and you get an argument with a shape to it: Fischer or Kasparov or Carlsen, measured against a title that has passed hand to hand since 1886. Ask the same about xiangqi and most English answers stop at the question.':
    '问国际象棋史上谁最强，你会得到一场有章法的争论：菲舍尔、卡斯帕罗夫还是卡尔森，衡量的标尺是一个自1886年起代代相传的头衔。同样的问题放到象棋上，多数英文的回答止步于提问本身。',
  'There is an answer, and almost nobody disputes it. Hu Ronghua won fourteen national championships, took the first at fifteen and the last at fifty-five, and won or shared every one of the ten championships held between 1960 and 1979. What is harder to explain is why the title he dominated is only sixty-nine years old, in a game that was already being played in its modern form when the Song dynasty fell. What follows is every winner, and a game for thirteen of them in the order they first took the title. Our own engine annotates the boards; the analysis is Pikafish at a million nodes a position.':
    '答案是有的，而且几乎无人异议。胡荣华拿过十四次全国冠军，十五岁夺得第一次，五十五岁夺得最后一次，1960年到1979年间举办的十届全国赛，冠军全部由他独得或并列分享。更难解释的是，他统治的这个头衔为什么只有六十九年历史，而这门棋在南宋灭亡之时就已经是今天的模样。下面列出每一位冠军，并按他们首次夺冠的先后，为其中十三位各选一局棋。棋谱讲解由我们自己的引擎完成，分析用的是 Pikafish，每个局面一百万个节点。',
  'Before there was a title': '头衔出现之前',
  'Xiangqi reached its modern form at the end of the Northern Song: sixteen pieces a side, nine files by ten ranks, the river, the palace, the general and advisors confined to it. By the Southern Song it was played widely enough that Wen Tianxiang, the statesman the Mongols executed in 1283, grew up in a family of players and left a book of forty endgame problems. Nine hundred years of the game, and composed positions like his are nearly all that survives: not one record of a game anyone actually played.':
    '象棋在北宋末年定型为今天的样子：每方十六子，纵九横十，有河界，有九宫，将帅与士不出九宫。到南宋时它已流传甚广，被蒙古人于1283年处死的文天祥就出身棋弈之家，留下过一部四十局的残局谱。九百年的棋史，存下来的几乎只有这类拟局：没有一份真人对局的记录。',
  'What survives from the Ming onward is manuals: 橘中秘 of 1632, the most reprinted xiangqi text of the Ming and Qing, and 百局象棋谱 of 1801 with its hundred and seven positions named after proverbs. You can name the authors. You cannot say who was strongest, because nobody was keeping score. The first era with contested titles ran through the 1920s and 1930s and had no federation: newspapers organised the matches, and the winners were given names rather than trophies. Zhou Deyu finished three points clear when East China played North China in February 1931 and was crowned 七省棋王, Chess King of Seven Provinces, the seven being how many provinces the four players came from. Huang Songxuan then played him twenty games, finished one ahead, and Guangdong crowned him 九省棋王, Chess King of Nine Provinces. A title race settled by nickname inflation is not a system, but it was the closest the game had.':
    '明代以后留下来的是棋谱：1632年的《橘中秘》，明清两代翻刻最多的象棋著作；1801年的《百局象棋谱》，收有一百零七局以成语命名的排局。作者的名字你说得出来。谁最强你说不出来，因为没有人在记分。第一个争夺头衔的时代横跨二十世纪二三十年代，却没有任何协会：比赛由报纸组织，赢家得到的是名号而不是奖杯。1931年2月华东对华北，周德裕净胜三分，被加冕为七省棋王，这七省指的是四名参赛者来自几个省。随后黄松轩与他对弈二十局，多胜一局，广东便封他为九省棋王。靠名号加码决出的头衔算不上一套制度，但那已是当时最接近制度的东西。',
  'Xie Xiaxun organised those matches and is the figure worth knowing. He played Western chess well enough to win a five-nation tournament at Shamian in 1936 with eighteen wins, one loss and one draw. In October 1937 he went to Southeast Asia as a national envoy and spent two years playing for the war: simultaneous displays, blindfold games, boards laid out with people as the pieces. He raised more than fifty million in banknotes and silver, and sent three thousand young overseas Chinese home to fight. In 1939 he played Zhou Enlai in Chongqing, and the drawn game they published in the Ta Kung Pao was titled 共抒国难, relieving the national crisis together. He died in 1987, aged ninety-nine.':
    '这些比赛的组织者是谢侠逊，他是那个时代最值得认识的人物。他的国际象棋也下得好，1936年在沙面举行的五国赛上以十八胜一负一和夺冠。1937年10月他以国家使节的身份前往东南亚，用两年时间为抗战下棋：车轮战、盲棋、以人作棋子摆开的棋局。他募得五千余万的钞票与银两，并送三千名华侨青年回国参战。1939年他在重庆与周恩来对弈，两人的和局发表于《大公报》，题为共抒国难。1987年他去世，享年九十九岁。',
  "Then, in August 1956, the State Sports Commission made xiangqi an official sport and published the first competition rules. That December, in Beijing, the first national championship was played. Xiangqi was the only competitive event; go and Western chess were demonstrations. It has been played fifty-seven times since, missing 1961 and 1963 to the famine, 1967-1973 to the Cultural Revolution, 1976 to Mao's death, 2021-2022 to the pandemic, and 2024 to want of a sponsor.":
    '1956年8月，国家体委将象棋列为正式体育项目，并颁布了第一部比赛规则。当年12月，第一届全国象棋锦标赛在北京举行。象棋是唯一的竞赛项目，围棋和国际象棋只作表演。此后共举办五十七届，其间1961和1963年因饥荒停办，1967至1973年因文革停办，1976年因毛泽东逝世停办，2021和2022年因疫情停办，2024年因无人赞助停办。',
  'Every national champion, 1956 to 2025': '历届全国冠军，1956至2025',
  'Fifty-seven editions, twenty-two winners. One row per player, in the order they first took the title, with a bar over the years they held it.':
    '五十七届，二十二位冠军。每位棋手一行，按首次夺冠的先后排列，横条覆盖他保有头衔的年份。',
  'Hatched columns are years with no championship. The number after each name is that player’s title count.':
    '斜线填充的列是没有举办全国赛的年份。每个名字后面的数字是该棋手的夺冠次数。',
  'Three things fall out of the shape. Hu Ronghua holds the middle of the chart for forty years, in two long runs either side of a gap that history took rather than a rival, then four scattered singles that land after the men who replaced him had themselves come and gone. The 1980s and 1990s are the only stretch where four or five names trade the title year to year. And from 2005 the bars turn red: thirteen men have won it since, and ten of them have a ruling against them.':
    '从图形里能看出三件事。胡荣华占据图表中段长达四十年，分成两段长跑，中间的空档是历史造成的而不是对手造成的，此后又是四次零散夺冠，落在取代他的那批人自己也来了又走之后。八十年代和九十年代是唯一一段四五个名字逐年轮流拿冠军的时期。而从2005年起横条转红：此后共有十三人夺冠，其中十人身上有处罚决定。',
  'Thirteen of these men have an annotated game further down the page, one each, in the same order. The nine without one are here because a list of champions that leaves people out is not a list of champions.':
    '这十三人在本页下方各有一局讲解棋谱，顺序相同。另外九人没有棋谱，之所以列出，是因为漏掉人的冠军名单算不上冠军名单。',
  Champion: '冠军',
  Titles: '夺冠次数',
  Years: '年份',
  'Association ruling': '协会处罚',
  'The same record as the figure, with the years written out. An asterisk marks the one shared title, in 1962. Every entry in the last column is a published ruling of the Chinese Xiangqi Association, not an allegation; the section below explains them.':
    '与上图相同的纪录，年份写全。星号标出唯一一次并列冠军，在1962年。最后一列里的每一条都是中国象棋协会已公布的处罚决定，不是指控；下文一节会加以说明。',
  'Yang Guanlin 杨官璘, 1956': '杨官璘，1956',
  "Four national titles: 1956, 1957, 1959, and a fourth in 1962 shared with the boy who had just taken the game off him. He came out of Guangdong, played for money in Hong Kong between 1949 and 1951, and by the time the sport was organised he was good enough that it called him 第一国手, the nation's foremost player. Other players called him 魔叔, Magic Uncle. His reputation rested on endgames, which is a polite way of saying he beat people in positions everyone had agreed were drawn.":
    '四次全国冠军：1956、1957、1959，第四次在1962年，与刚刚把冠军从他手里拿走的那个少年并列。他出自广东，1949到1951年间在香港以棋为生，等到这项运动被正式组织起来时，他已经强到被称作第一国手。棋界叫他魔叔。他的名声建立在残局上，说得客气些是这样，说白了就是他能在所有人都认定是和棋的局面里赢下对手。',
  'He was the answer for most of a decade, and for longer than the record suggests. Five years after Hu Ronghua took the title off him, Yang was still beating him.':
    '在近十年的时间里他就是那个答案，而且比纪录显示的还要久。胡荣华从他手里拿走冠军五年之后，杨官璘还在赢他。',
  'Yang Guanlin vs Hu Ronghua, 12 November 1965. Ninety moves of endgame, and move 41 is the cannon swing that finally breaks it.':
    '杨官璘对胡荣华，1965年11月12日。九十个回合的残局较量，第41回合的平炮终于撕开了局面。',
  'Li Yiting 李义庭, 1958': '李义庭，1958',
  'They called him 小神童, the little prodigy, and he had earned it by sixteen: a four-game match against Yang Guanlin in 1954 that finished two apiece. He beat Yang again at the first national championship, in the tournament Yang went on to win, and took the title himself in 1958 at twenty.':
    '人称小神童，他十六岁就当得起这个名号：1954年与杨官璘四局对抗，二比二打平。在首届全国赛上他又赢了杨官璘一局，而那届冠军最终归杨官璘；1958年他二十岁，自己拿下了冠军。',
  'Then he stopped. Poor health and the politics of the late 1960s ended his competitive career in 1966, at twenty-eight, which is the whole reason a player this good has one championship. He coached afterwards, and the player he pushed forward was Liu Dahua, two sections down.':
    '然后他就停了。健康不佳加上六十年代后期的政治，让他的竞技生涯在1966年结束，那年他二十八岁，这就是一位这么强的棋手只有一次冠军的全部原因。此后他做教练，他推上来的棋手是柳大华，在下面第二节。',
  'Li Yiting vs Yang Guanlin, 27 December 1956. Li was eighteen, and our engine grades him 99.0, the highest of any player here.':
    '李义庭对杨官璘，1956年12月27日。李义庭当时十八岁，我们的引擎给他打出99.0分，是本页所有棋手中最高的。',
  'Hu Ronghua 胡荣华, 1960': '胡荣华，1960',
  'Fourteen national titles, the first at fifteen and the last at fifty-five, and every one of the ten championships held between 1960 and 1979, one of them shared. They called him 胡司令, Commander Hu. He played out of Shanghai, on his own, against the strongest player every other province could field, and he did it by rebuilding the openings underneath the game: the flying elephant, the anti-palace horse and the same-direction cannon are all mainstream today because Hu kept winning with them.':
    '十四次全国冠军，第一次十五岁，最后一次五十五岁，1960到1979年间举办的十届冠军全部有他，其中一届并列。棋界叫他胡司令。他代表上海出战，孤身一人对抗其他各省能派出的最强棋手，而他做到这一点的办法，是把棋的开局体系整个重建了一遍：飞相局、反宫马、顺炮，今天都是主流，因为胡荣华一直用它们赢棋。',
  'This is the game he arrived with. Round three of his first national tournament, Black against the reigning champion.':
    '这是他登场的那一局。首次参加全国赛的第三轮，执黑对阵卫冕冠军。',
  'Yang Guanlin vs Hu Ronghua, 28 October 1960. Move 24 is the one to watch: a cannon Yang cannot take, marked brilliant.':
    '杨官璘对胡荣华，1960年10月28日。第24回合值得一看：一步杨官璘吃不得的炮，被标为妙手。',
  'And this is thirty-four years later, in a tournament he did not win, against a man who had taken two national titles of his own in between.':
    '这是三十四年之后，在一场他没有夺冠的比赛里，对手是这期间自己拿过两次全国冠军的人。',
  'Hu Ronghua vs Liu Dahua, 15 October 1994. Hu at forty-eight, six years before his fourteenth title.':
    '胡荣华对柳大华，1994年10月15日。胡荣华时年四十八，距离他第十四次夺冠还有六年。',
  'Liu Dahua 柳大华, 1980': '柳大华，1980',
  'Two titles, 1980 and 1981, and the man who ended the longest run in the game: Hu had won every championship held for twenty years when Liu took the 1980 tournament off him. He is from Huangpi, in Hubei, and the sport knows him as 东方电脑, the Eastern Computer, for a memory that let him play nineteen simultaneous games blindfold in 1995. That was a world record until one of the champions further down this page broke it with twenty.':
    '两次冠军，1980和1981年，他也是终结了这项运动中最长连霸的人：柳大华拿下1980年那届时，此前二十年举办的全国赛冠军全是胡荣华的。他是湖北黄陂人，棋界称他东方电脑，因为他的记忆力让他在1995年下出十九盘同时进行的盲棋。那是当时的世界纪录，直到本页下面的一位冠军以二十盘打破它。',
  'He beat Li Laiqun in the 1980 tournament, then Yang Guanlin five days later.':
    '他在1980年那届比赛中赢了李来群，五天后又赢了杨官璘。',
  'Li Laiqun vs Liu Dahua, 29 August 1980. Li would take four titles of his own starting two years later.':
    '李来群对柳大华，1980年8月29日。两年后李来群将开始自己的四次夺冠。',
  'Yang Guanlin vs Liu Dahua, 3 September 1980. The outgoing era losing to the incoming one in under thirty-five moves.':
    '杨官璘对柳大华，1980年9月3日。将去的时代在三十五个回合之内输给了将来的时代。',
  'Li Laiqun 李来群, 1982': '李来群，1982',
  "Four titles between 1982 and 1991, and the first of them mattered past his own career. Li is from Handan in Hebei, and 1982 was the first time the men's championship crossed the Yellow River: until then it had belonged to the south, to Guangdong and Shanghai and Hubei. He went through that tournament unbeaten, and through Hu Ronghua directly rather than around him.":
    '1982到1991年间四次夺冠，其中第一次的意义超出了他个人的生涯。李来群是河北邯郸人，1982年是男子全国冠军第一次跨过黄河：在此之前它一直属于南方，属于广东、上海和湖北。那届比赛他全程不败，而且是正面赢过胡荣华，不是绕开他。',
  "Chinese writers reach for two images for his game: a needle wrapped in cotton, and a python's coils. Both mean the same thing, which is that the position has already closed before you notice it closing.":
    '中文的棋评用两个比喻形容他的棋：绵里藏针，以及蟒蛇缠身。两者说的是同一件事，就是等你察觉局面在收紧时，它已经收紧完了。',
  'Li Laiqun vs Hu Ronghua, 7 December 1982, from the championship Li won. Move 23 is the cannon push, and Hu has nothing after it.':
    '李来群对胡荣华，1982年12月7日，出自李来群夺冠的那届比赛。第23回合是那步进炮，此后胡荣华无棋可下。',
  'Lü Qin 吕钦, 1986': '吕钦，1986',
  'Five national titles and five world titles, more of the latter than anyone before or since. Guangdong called him 羊城少帅, the Young Marshal of Guangzhou, and paired him with Xu Yinchuan as 岭南双雄, the twin heroes of Lingnan. In almost any other era that record is the headline of the sport. Here it reads as a long second place behind Hu Ronghua.':
    '五次全国冠军，五次世界冠军，后者的数量前无古人后无来者。广东叫他羊城少帅，又把他与许银川并称岭南双雄。放在几乎任何别的年代，这份纪录都是这项运动的头条。在这里，它读起来是长期屈居胡荣华之后的第二名。',
  "Lü Qin vs Yu Youhua, 23 November 1986. The only game where both players are marked brilliant: Lü Qin's cannon on 21, Yu Youhua's horse on 32.":
    '吕钦对于幼华，1986年11月23日。本页唯一一局双方都被标出妙手的棋：吕钦第21回合的炮，于幼华第32回合的马。',
  'Xu Tianhong 徐天红, 1989': '徐天红，1989',
  'National champion in 1989, world champion in 1993 with six wins, three draws and no losses. He is from Taizhou in Jiangsu, and the sport calls him 笑面佛, the Smiling Buddha, because he smiles right through a game. What is behind the smile is the opposite of friendly: tight openings, very few holes, and a habit of grinding advantages too small to see into wins.':
    '1989年全国冠军，1993年世界冠军，六胜三和不败。他是江苏泰州人，棋界叫他笑面佛，因为他整局棋都在笑。笑容背后的东西一点也不友善：开局严密，几乎没有破绽，习惯把小到看不见的优势磨成胜势。',
  'The year after his national title he met a fifteen-year-old from Guangdong, at the same age and on the same stage where Hu Ronghua had beaten Yang Guanlin thirty years earlier. This time the champion won.':
    '拿到全国冠军的第二年，他遇上一位十五岁的广东少年，年龄相同，舞台也相同，三十年前胡荣华就是在这里赢了杨官璘。这一次赢的是冠军。',
  'Xu Tianhong vs Xu Yinchuan, 19 October 1990. No blunder from either side, which is the game Xu Tianhong wanted.':
    '徐天红对许银川，1990年10月19日。双方都没有漏着，这正是徐天红要的那种棋。',
  'Zhao Guorong 赵国荣, 1990': '赵国荣，1990',
  'Four national titles spread across eighteen years, 1990 to 2008, plus the 1991 world championship. He learned in Harbin under Wang Jialiang, who was known as the Northeast Tiger, so the sport made Zhao the New Northeast Tiger. What people mean by it is that he plays bigger against stronger opponents, and that he fused the careful northern game with the sharper southern one.':
    '四次全国冠军分布在十八年里，从1990到2008年，另加1991年的世界冠军。他在哈尔滨师从王嘉良，王嘉良人称东北虎，于是棋界把赵国荣叫作新东北虎。这个说法的意思是他越遇强手下得越大，也是说他把稳健的北派与锋利的南派融到了一起。',
  'Zhao Guorong vs Hu Ronghua, 22 October 1989, the year before his first title. Move 30 is the chariot swing, and Hu does not recover.':
    '赵国荣对胡荣华，1989年10月22日，夺得首个冠军的前一年。第30回合是那步平车，此后胡荣华没能挽回。',
  'Xu Yinchuan 许银川, 1993': '许银川，1993',
  "Six national titles and three world titles. He won the first at eighteen, second only to Hu's fifteen, and spent the 1990s and 2000s as the best player in the country not named Hu Ronghua. Like Yang Guanlin before him he built it on endgames, and like Yang he came out of Guangdong. He is one of the three men to have won a national title since 2005 with no ruling against him.":
    '六次全国冠军，三次世界冠军。他十八岁拿下第一次，仅次于胡荣华的十五岁，整个九十年代和本世纪头十年，他都是国内除胡荣华之外最强的棋手。和他之前的杨官璘一样，他把棋建立在残局上；也和杨官璘一样，他出自广东。2005年以后夺得全国冠军而身上没有处罚决定的，只有三人，他是其中之一。',
  "Here he is against the man who ended Hu's run.": '下面是他对阵终结了胡荣华连霸的那个人。',
  'Xu Yinchuan vs Liu Dahua, 11 October 1995. The only game here in which our engine finds neither a blunder nor a mistake from either player.':
    '许银川对柳大华，1995年10月11日。这是本页唯一一局，我们的引擎在双方身上都没有找到漏着或失着。',
  'Tao Hanming 陶汉明, 1994': '陶汉明，1994',
  'The only champion here who came up outside the system. Tao grew up on the street chess stalls of Haicheng in Liaoning, turned professional late, and in 1994 became the first amateur-trained player to win the national title, playing for Jilin and taking it from Lü Qin on tiebreak in the final round. The sport named him 绿林棋王, chess king of the greenwood, which is the Chinese phrase for outlaws in the forest, and it is a verdict on his game rather than his upbringing: unorthodox, and ferocious in the middlegame.':
    '本页唯一一位从体制外走上来的冠军。陶汉明在辽宁海城的街头棋摊上长大，很晚才转为职业，1994年成为第一个以业余出身夺得全国冠军的棋手，他代表吉林出战，在最后一轮凭小分从吕钦手里拿走了冠军。棋界给他的名号是绿林棋王，这是评他的棋而不是评他的出身：不循常规，中局凶悍。',
  'His game is wild by the standards of every other champion in this sequence, built on prepared surprises rather than accumulation. Here he is two years after the title, against a two-time champion.':
    '以本篇其他任何一位冠军的标准衡量，他的棋都算野，靠的是准备好的意外而不是积累。下面是他夺冠两年之后，对阵一位两届冠军。',
  'Tao Hanming vs Liu Dahua, 21 October 1996. More chances for both players than a positional grind offers, and Tao was better at taking them.':
    '陶汉明对柳大华，1996年10月21日。双方的机会都比一盘阵地磨局多，而陶汉明更善于抓住它们。',
  'Yu Youhua 于幼华, 2002': '于幼华，2002',
  'One title, in 2002, at forty-one, taken in the middle of the years that belonged to Hu Ronghua, Lü Qin and Xu Yinchuan. A Guangzhou newspaper writer had named him 拼命三郎 two decades earlier, roughly the desperado, after the 1981 championship: he finished sixth and did not draw a single one of his thirteen games. He plays for complications and accepts what comes with them.':
    '一次冠军，在2002年，时年四十一岁，夺自属于胡荣华、吕钦和许银川的那些年份中间。二十年前，一位广州的报纸作者在1981年全国赛之后给他起了拼命三郎这个名号：那届他名列第六，十三局棋一盘和棋也没有下过。他为复杂局面而战，并接受随之而来的一切。',
  'Xu Tianhong vs Yu Youhua, 3 November 2002, from the championship Yu finally won. The Smiling Buddha against the desperado.':
    '徐天红对于幼华，2002年11月3日，出自于幼华终于夺冠的那届比赛。笑面佛对拼命三郎。',
  'Sun Yongzheng 孙勇征, 2011': '孙勇征，2011',
  'One title, in 2011, won without losing a game: five wins and six draws. He is where the list stops being straightforward. On 12 January 2025 the Chinese Xiangqi Association banned him for four years and three months and revoked his grandmaster title, in the same announcement that sanctioned forty-one people.':
    '一次冠军，在2011年，全程不败：五胜六和。到他这里，这份名单不再是直截了当的了。2025年1月12日，中国象棋协会禁赛他四年三个月，并撤销其特级大师称号，同一份公告处罚了四十一人。',
  'Every man who won the national championship from 2010 to 2023 now has a ruling against him. What that means for the list is at the foot of the page.':
    '2010年到2023年间夺得全国冠军的每一个人，如今身上都有处罚决定。这对这份名单意味着什么，写在本页末尾。',
  'Xu Tianhong vs Sun Yongzheng, 18 October 2010, the year before his title. Sixty plies, the shortest game here.':
    '徐天红对孙勇征，2010年10月18日，夺冠的前一年。六十着，是本页最短的一局。',
  'Wang Yubo 王禹博, 2025': '王禹博，2025',
  'The twenty-second man to win it, in Jinan in December 2025, a first title for a Beijing player coached by the grandmaster Zhang Qiang. His is the only game below in which the opponent appears nowhere else, and that is a consequence of the section above rather than an editorial choice.':
    '第二十二位夺冠者，2025年12月在济南夺冠，是北京棋手第一次拿到这个头衔，他的教练是特级大师张强。下面这局是唯一一局对手在别处再未出现的棋，这是上一节所述情况的后果，不是编排上的选择。',
  'Wang Yubo vs Su Yilin, 6 December 2025, the opening round of the championship he won. Move 32 is the horse advance the engine marks.':
    '王禹博对苏奕霖，2025年12月6日，他夺冠那届的首轮。第32回合是引擎标出的那步跃马。',
  'The decade that was struck': '被抹去的十年',
  'The red bars in the chart are the reason this list needs a footnote. Between 2024 and 2026 the Chinese Xiangqi Association worked through a match-fixing case the Chinese press calls 录音门, the recording gate, and it has [a page of its own](/blog/xiangqi-match-fixing): the investigation, everyone sanctioned, the reasoning, and the sources.':
    '图表里的红条就是这份名单需要加注的原因。2024到2026年间，中国象棋协会处理了一起中文媒体称为录音门的假棋案，它另有[专页](/blog/xiangqi-match-fixing)：调查经过、全部受罚者、来龙去脉与资料来源。',
  'Set that against the table above and the damage is easier to see than to state. Thirteen men have won the national championship since 2005 and ten of them have a ruling against them, including every single winner from 2010 to 2023. Xu Yinchuan, Zhao Guorong and Wang Yubo are the three who do not.':
    '把这些对照上面的表格，损害看得见，反而说不清楚。2005年以来共有十三人夺得全国冠军，其中十人身上有处罚决定，包括2010到2023年间的每一位冠军。没有处罚的三人是许银川、赵国荣和王禹博。',
  'The names stay in the table. A list that quietly dropped them would be a worse record of what happened, and these are published findings from the sport’s own governing body rather than allegations. What the rulings do not tell you is which games were fixed, or how a player at that level is supposed to be caught, and that is a longer story than a list of champions can hold.':
    '这些名字留在表格里。悄悄删掉他们，只会让这份纪录更差，何况这些是这项运动自身管理机构公布的认定结论，不是指控。处罚决定没有告诉你的是，哪些棋是假的，以及到了那个水平的棋手究竟应该怎样才能被查出来，那是一份冠军名单装不下的更长的故事。',
  'The world title, and the same names': '世界冠军，还是这些名字',
  'Where that leaves the list': '这份名单如今的样子',
  'Sixty-nine years, fifty-seven championships, twenty-two winners. For the first fifty of those years the question had a clear answer and it was usually Hu Ronghua. For the fifteen after that it has an answer the sport has since taken back. Wang Yubo’s title in December 2025 is the first since Xu Yinchuan in 2009 that nobody has had to qualify.':
    '六十九年，五十七届，二十二位冠军。头五十年里这个问题有明确的答案，而且答案通常是胡荣华。之后的十五年，答案存在，但这项运动后来自己收了回去。王禹博2025年12月的冠军，是2009年许银川之后第一个不需要任何人加以说明的冠军。',
  'Every game on this page is a chapter in a study you can work through properly: the full move tree, the engine’s lines as branches you can walk, one chapter per champion in the same order, and the 2025 world final at the end.':
    '本页的每一局棋都是一份研究里的一章，你可以在那里从头到尾走一遍：完整的着法树、引擎的变化作为可以走进去的分支、每位冠军一章且顺序相同，末尾还有2025年的世界赛决赛。',
  'Learn how the pieces move': '学习各子的走法',
  'Play through the whole study': '走一遍完整研究',
  'Yang Guanlin 杨官璘': '杨官璘',
  'Li Yiting 李义庭': '李义庭',
  'Hu Ronghua 胡荣华': '胡荣华',
  'Liu Dahua 柳大华': '柳大华',
  'Li Laiqun 李来群': '李来群',
  'Lü Qin 吕钦': '吕钦',
  'Xu Tianhong 徐天红': '徐天红',
  'Zhao Guorong 赵国荣': '赵国荣',
  'Xu Yinchuan 许银川': '许银川',
  'Tao Hanming 陶汉明': '陶汉明',
  'Yu Youhua 于幼华': '于幼华',
  'Hong Zhi 洪智': '洪智',
  'Zhao Xinxin 赵鑫鑫': '赵鑫鑫',
  'Jiang Chuan 蒋川': '蒋川',
  'Sun Yongzheng 孙勇征': '孙勇征',
  'Wang Tianyi 王天一': '王天一',
  'Xie Jing 谢靖': '谢靖',
  'Zheng Weitong 郑惟桐': '郑惟桐',
  'Xu Chao 徐超': '徐超',
  'Wang Yang 汪洋': '汪洋',
  'Wang Kuo 王廓': '王廓',
  'Wang Yubo 王禹博': '王禹博',
  'Cultural Revolution': '文化大革命',
  title: '冠军',
  'shared title': '并列冠军',
  'title, champion later banned': '冠军，其后被禁赛',
  'no championship held': '未举办',
  'banned for life, 2026': '终身禁赛，2026',
  'banned for life, 2025': '终身禁赛，2025',
  'five-year ban, 2026': '禁赛五年，2026',
  'banned four years three months, 2025': '禁赛四年三个月，2025',
  'convicted, banned': '判罪并禁赛',
  'banned seven years six months, 2025': '禁赛七年六个月，2025',

  // -- Champions embeds: spec strings (player, event) and the sideline label.
  // These live INSIDE the replay spec, which articleProse deliberately skips as a
  // known gap, so the coverage gate never asked for them and the zh pages showed
  // English names over Chinese prose. deepTranslate walks them like any string.
  // Names are people: same in both scripts (champion-name-script.test.ts).
  'Hu Ronghua': '胡荣华',
  'Li Laiqun': '李来群',
  'Li Yiting': '李义庭',
  'Liu Dahua': '柳大华',
  'Lü Qin': '吕钦',
  'Su Yilin': '苏奕霖',
  'Sun Yongzheng': '孙勇征',
  'Tao Hanming': '陶汉明',
  'Wang Yubo': '王禹博',
  'Xu Tianhong': '徐天红',
  'Xu Yinchuan': '许银川',
  'Yang Guanlin': '杨官璘',
  'Yu Youhua': '于幼华',
  'Zhao Guorong': '赵国荣',
  '1956 National Individual Championship': '1956年全国象棋个人锦标赛',
  '1960 National Individual Championship': '1960年全国象棋个人锦标赛',
  '1965 National Individual Championship': '1965年全国象棋个人锦标赛',
  '1980 National Individual Championship': '1980年全国象棋个人锦标赛',
  '1982 National Individual Championship': '1982年全国象棋个人锦标赛',
  '1986 National Individual Championship': '1986年全国象棋个人锦标赛',
  '1989 National Individual Championship': '1989年全国象棋个人锦标赛',
  '1990 National Individual Championship': '1990年全国象棋个人锦标赛',
  '1994 National Individual Championship': '1994年全国象棋个人锦标赛',
  '1995 National Individual Championship': '1995年全国象棋个人锦标赛',
  '1996 National Individual Championship': '1996年全国象棋个人锦标赛',
  '2002 National Individual Championship': '2002年全国象棋个人锦标赛',
  '2010 National Individual Championship': '2010年全国象棋个人锦标赛',
  '2025 National Individual Championship': '2025年全国象棋个人锦标赛',

  // -- World championship (xiangqi-world-championship) --
  // MACHINE-DRAFTED 2026-08-29, NOT NATIVE-REVIEWED, same standing as the
  // national champions page above. Player names, event names, the chart's gap
  // label and the ruling column are keys too, so the figure and the table
  // localize with the prose instead of sitting in English under Chinese.
  // seoTitle is here as well: it sits outside articleProse, so the coverage
  // contract cannot see it missing.

  'The Xiangqi World Championship': '世界象棋锦标赛',
  'Xiangqi World Championship: Every Winner, and Why It Is Not the Senior Title':
    '世界象棋锦标赛：历届冠军，以及它为何不是最高头衔',
  'Every winner of the Xiangqi World Championship since 1990, why the Chinese national title is the harder one, and how a Vietnamese player took it out of China for the first time in 2025.':
    '1990年以来世界象棋锦标赛的每一位冠军，为什么中国全国个人赛才是更难拿的头衔，以及2025年一位越南棋手如何第一次把它带出中国。',
  'Readers who have met the national champions and want to know what the international title is worth.':
    '已经认识全国冠军、想知道这个国际头衔分量如何的读者。',
  'The World Xiangqi Championship has been held roughly every two years since 1990, organised by the World Xiangqi Federation. English readers tend to assume it is the senior title, the way the world chess championship is. It is not, and the reason is worth understanding before the list makes sense.':
    '世界象棋锦标赛由世界象棋联合会主办，1990年以来大致每两年举办一届。英文读者往往默认它是象棋界的最高头衔，就像国际象棋世界冠军赛那样。事实并非如此，而弄清楚原因，下面这份名单才读得懂。',
  'The Chinese national championship is the harder one to win. Almost everyone capable of winning either is Chinese, and only a handful of them qualify for the world event. For its first thirty-five years the world title was, in practice, a smaller Chinese championship with guests, and then in 2025 it left China for the first time.':
    '更难拿的是中国全国个人赛。有能力拿下这两个头衔中任何一个的棋手几乎都是中国人，而其中只有少数几位能获得世锦赛的参赛资格。在最初的三十五年里，世界冠军实际上是一场规模更小、外加几位客人的中国锦标赛，直到2025年，它第一次离开了中国。',
  'Every world champion, 1990 to 2025': '历届世界冠军，1990至2025',
  'Nineteen editions, eleven winners. One row per player, in the order they first took the title, with a bar over the years they held it.':
    '十九届，十一位冠军。每位棋手一行，按首次夺冠的先后排列，横条覆盖他持有头衔的年份。',
  'Two things fall out of the shape. The left half belongs to three men, and the right half turns red at 2009 and stays red until the last row.':
    '从这个形状里能看出两件事。左半边属于三个人；右半边从2009年起变红，一直红到最后一行。',
  'The same record as the figure, with the years written out. Every entry in the last column is a published ruling of the Chinese Xiangqi Association, not an allegation; the section below explains them.':
    '与上图相同的纪录，把年份逐一写出。最后一列的每一条都是中国象棋协会已公布的处罚决定，不是指控；下面有一节专门说明。',
  'The national title, and every champion since 1956': '全国冠军，以及1956年以来的每一位',
  'Lü Qin 吕钦, 1990': '吕钦，1990',
  'Five world titles across fifteen years and five Chinese national titles, 1986 to 2004. Guangdong called him 羊城少帅, the Young Marshal of Guangzhou, and later paired him with Xu Yinchuan as 岭南双雄, the twin heroes of Lingnan. He is the most decorated player on this page and was never, in any single year, the best player in China.':
    '十五年间五夺世界冠军，另有五个全国个人赛冠军，从1986年到2004年。广东称他为羊城少帅，后来又把他与许银川并称岭南双雄。他是本页荣誉最多的棋手，却从来没有在任何一个年份里成为中国最强的棋手。',
  'That sentence is the article in miniature. Hu Ronghua was ahead of him at home for most of his career and never entered this event; Lü Qin won it five times. Wu Guilin of Chinese Taipei was the strongest player outside the mainland for two decades and the recurring answer to who could actually beat these men, and Lü Qin beat him in 1990, 1995 and 1997.':
    '这句话就是整篇文章的缩影。胡荣华在国内大部分时间都压着他，却从未参加过这项赛事；吕钦却拿了五次。中华台北的吴贵临二十年间是大陆之外最强的棋手，也是"究竟谁能赢这些人"这个问题反复出现的答案，而吕钦在1990、1995和1997年都赢了他。',
  'Lü Qin vs Wu Guilin, 1997, from the fifth championship and the third of his five titles.':
    '吕钦对吴贵临，1997年，第五届世锦赛，也是他五个冠军中的第三个。',
  'Zhao Guorong 赵国荣, 1991': '赵国荣，1991',
  'World champion in 1991 and four times Chinese national champion, spread across eighteen years from 1990 to 2008, which is a longer span at the top than anyone here except Hu Ronghua managed. He learned in Harbin under Wang Jialiang, known as the Northeast Tiger, and the sport made him the New Northeast Tiger in turn.':
    '1991年的世界冠军，四次全国个人赛冠军，跨越1990年到2008年共十八年，这个在顶端停留的跨度，除胡荣华外本页无人能及。他在哈尔滨师从王嘉良，人称东北虎，棋坛后来又把他叫作新东北虎。',
  'He is one of three men on this list with no ruling against him.':
    '他是这份名单上三位没有受到任何处罚的棋手之一。',
  'Zhao Guorong vs Wu Guilin, 1991, from the championship he won.':
    '赵国荣对吴贵临，1991年，出自他夺冠的那届比赛。',
  'Xu Tianhong 徐天红, 1993': '徐天红，1993',
  'World champion in 1993 in Beijing with seven and a half points from nine, the year after taking the Chinese national title. He is from Taizhou in Jiangsu, and the sport calls him 笑面佛, the Smiling Buddha, because he smiles right through a game. What is behind the smile is tight openings and a habit of grinding advantages too small to see into wins.':
    '1993年在北京夺得世界冠军，九轮拿下七点五分，这是他获得全国个人赛冠军的第二年。他是江苏泰州人，棋坛称他笑面佛，因为他从头到尾都在笑。笑容背后是滴水不漏的布局，以及把小到看不见的优势一点点磨成胜势的功夫。',
  'He is the one champion here without a game, and that is a fact about the archives rather than about him. Four games survive from the 1993 edition in the databases this article draws on, and none of them are his. Showing a game from another event would be a different claim than the one this page makes.':
    '他是本页唯一没有配棋谱的冠军，这说的是棋谱库的问题，不是他的问题。本文所用的数据库里，1993年那届只留下四局棋，没有一局是他的。拿另一项赛事的棋来充数，说的就不是这一页要说的事了。',
  'Xu Yinchuan 许银川, 1999': '许银川，1999',
  'Three world titles, 1999, 2003 and 2007, alongside six Chinese national championships. He won his first national title at eighteen, second only to Hu Ronghua’s fifteen, and spent two decades as the best player in the country not named Hu Ronghua.':
    '三个世界冠军，1999、2003和2007年，另有六个全国个人赛冠军。他十八岁首夺全国冠军，仅次于胡荣华的十五岁，并且有二十年时间是这个国家里除胡荣华之外最强的棋手。',
  'Like Lü Qin he came out of Guangdong, like Lü Qin he built his game on endgames, and like Lü Qin he is one of the three men here with a clean record.':
    '他和吕钦一样出自广东，一样把棋建立在残局功夫上，也一样是本页三位纪录清白的棋手之一。',
  'Xu Yinchuan vs Nguyễn Vũ Quân, 2007, from the last of his three titles. Our engine grades him 98.5, the cleanest game on this page.':
    '许银川对阮武君，2007年，出自他三个冠军中的最后一个。我们的引擎给他打出98.5分，是本页最干净的一局。',
  'Zhao Xinxin 赵鑫鑫, 2009': '赵鑫鑫，2009',
  'From Taizhou in Zhejiang, national champion at nineteen in 2007, and world champion at twenty-one in 2009 with fifteen points from nine games. He is still the youngest man to have won this title, and taking it completed the set of national, Asian and world championships that Chinese xiangqi calls a grand slam.':
    '浙江台州人，2007年十九岁夺得全国冠军，2009年二十一岁夺得世界冠军，九局拿下十五分。他至今仍是拿下这个头衔最年轻的棋手，而这一冠也让他集齐全国、亚洲与世界三项冠军，中国象棋界称之为大满贯。',
  'He was banned for life on 12 January 2025, in the ruling that sanctioned forty-one people at once.':
    '2025年1月12日，他在一次处罚四十一人的决定中被终身禁赛。',
  'Zhao Xinxin vs Nguyễn Thành Bảo, 2009, from the championship he won.':
    '赵鑫鑫对阮成保，2009年，出自他夺冠的那届比赛。',
  'Jiang Chuan 蒋川, 2011': '蒋川，2011',
  'Born in Yongjia, Zhejiang, in 1984. He took the Chinese national title in 2010 and the world title in Jakarta the year after, and he was the first player to pass 2700 on the rating list.':
    '1984年生于浙江永嘉。2010年夺得全国个人赛冠军，次年在雅加达夺得世界冠军，他也是等级分榜上第一个突破2700分的棋手。',
  'He is better known outside the tournament hall for blindfold play. On 3 January 2011 he took nineteen boards at once against Liu Dahua’s record and beat it with twenty, ending a mark that had stood since February 1995; he went to twenty-two in 2013 and to twenty-six after that, which is where the Guinness entry sits. He drew a five-year ban in April 2026.':
    '在赛场之外，他更为人知的是盲棋。2011年1月3日，他为冲击柳大华的纪录一次盲战十九台，最终以二十台破纪录，终结了自1995年2月起保持的那个数字；2013年他打到二十二台，此后又打到二十六台，吉尼斯纪录就停在这里。2026年4月，他被处以五年禁赛。',
  'Jiang Chuan vs Lei Kam Fun, 2011, from the championship he won.':
    '蒋川对李锦欢，2011年，出自他夺冠的那届比赛。',
  'Wang Tianyi 王天一, 2013': '王天一，2013',
  'Three world titles and four Chinese national ones, and ten consecutive years at the top of the world rating list. In May 2023 he became the first player to hold a live rating above 2800. Beijing called him 外星人, the alien, for arriving from outside the provincial team system and beating everyone anyway.':
    '三个世界冠军，四个全国个人赛冠军，连续十年位居世界等级分榜首。2023年5月，他成为第一个实时等级分突破2800的棋手。北京称他外星人，因为他不是从省队体系里出来的，却照样把所有人都赢了。',
  'The Chinese Xiangqi Association banned him for life in September 2024 and revoked his grandmaster title. A court in Hangzhou convicted him a year later.':
    '2024年9月，中国象棋协会对他终身禁赛并撤销其特级大师称号。一年后，杭州一家法院对他作出有罪判决。',
  'The opponent below is the reason to show this particular game: Wang Kuo is himself a Chinese national champion, and the strongest man Wang Tianyi faced across his three world finals.':
    '选这一局的理由在于对手：王廓本人也是全国个人赛冠军，是王天一三次世锦赛决赛中遇到过的最强对手。',
  'Wang Tianyi vs Wang Kuo, 2022, from the third of his three titles.':
    '王天一对王廓，2022年，出自他三个冠军中的第三个。',
  'Zheng Weitong 郑惟桐, 2015': '郑惟桐，2015',
  'Born in Chengdu in 1994. He took the Chinese national title in 2014 and again in 2015, then the world title in the same year, which is the harder order to do it in. He went to Tsinghua by recommendation in 2020 and won the individual gold at the 2023 Asian Games, China’s two hundredth medal of those Games.':
    '1994年生于成都。2014年和2015年连夺全国个人赛冠军，同年再夺世界冠军，这个先后顺序是更难的那一种。2020年他被保送清华大学，并在2023年亚运会上夺得个人金牌，那是中国队在那届亚运会上的第两百枚奖牌。',
  'He was banned for life on 12 January 2025. His title year also produced the longest game in either of these articles, and the opponent is the reason to show it.':
    '2025年1月12日，他被终身禁赛。他夺冠的那一年也留下了这两篇文章里最长的一局棋，而选它的理由在于对手。',
  'Lại Lý Huynh vs Zheng Weitong, 2015. Two hundred and seventy-four plies, and the man who loses it here takes the world title himself ten years later.':
    '赖理兄对郑惟桐，2015年。两百七十四个回合，而在这里落败的人，十年后自己拿下了世界冠军。',
  'Xu Chao 徐超, 2019': '徐超，2019',
  'From Wujiang in Suzhou, born 1981, playing from the age of seven and national youth champion at sixteen. He waited a long time for the senior title and took it in 2017 by beating the defending champion Wang Tianyi, becoming the nineteenth man to win the Chinese championship. The world title followed in Vancouver in 2019.':
    '苏州吴江人，1981年生，七岁学棋，十六岁获得全国少年冠军。成年组的头衔他等了很久，2017年他战胜卫冕冠军王天一夺得全国个人赛冠军，成为第十九位全国冠军。世界冠军随之而来，2019年在温哥华。',
  'He was banned for life in April 2026.': '2026年4月，他被终身禁赛。',
  'Xu Chao vs Huang Xueqian, 2019, the final round. This is the game that won it: nine judged moves between them, and six of those are blunders.':
    '徐超对黄学谦，2019年，最后一轮。这就是夺冠的那一局：两人合计有九步棋被引擎判定为失误，其中六步是漏着。',
  'Meng Chen 孟辰, 2023': '孟辰，2023',
  'Born in Anshan, Liaoning, in 1988, and one of only two men on this list who never won the Chinese national championship. He took the 2023 world title in Houston by beating Lại Lý Huynh in a tiebreak, which is the second time on this page that the future champion loses to a champion before becoming one.':
    '1988年生于辽宁鞍山，是这份名单上仅有的两位从未夺得全国个人赛冠军的棋手之一。2023年他在休斯敦的加赛中战胜赖理兄，夺得世界冠军，这也是本页第二次出现未来的冠军先输给一位冠军、然后自己成为冠军。',
  'He drew a six-month ban in January 2025, the lightest ruling here.':
    '2025年1月，他被处以六个月禁赛，是本页最轻的一项处罚。',
  'Meng Chen vs Lại Lý Huynh, 2023. The second time the future champion loses to a champion before becoming one.':
    '孟辰对赖理兄，2023年。未来的冠军先输给一位冠军、然后自己成为冠军，这是第二次。',
  'Why the national title is the harder one': '为什么全国冠军更难拿',
  'Lü Qin has five of the nineteen titles, Xu Yinchuan three and Wang Tianyi three, so eleven of the nineteen editions belong to three men. Nine of the eleven world champions also won the Chinese national championship. The two who did not are Meng Chen, who took the 2023 world title, and Lại Lý Huynh, who is Vietnamese and could never have entered the Chinese event.':
    '十九个冠军里，吕钦占五个，许银川三个，王天一三个，也就是说十九届中有十一届属于三个人。十一位世界冠军中有九位同时也拿过全国个人赛冠军。没拿过的两位，一位是2023年夺冠的孟辰，另一位是赖理兄，他是越南人，本来就不可能参加中国的比赛。',
  'That is the whole argument in one line. The world field is drawn from the same pool as the national field, minus most of it. China sends a small delegation, the rest of the entry is the strongest players from everywhere else, and for thirty-five years everywhere else was not close. A player who can win in Beijing can usually win in Singapore or Vancouver; the reverse has almost never been true.':
    '一句话就能说完整个论证。世锦赛的参赛者与全国赛出自同一个池子，只是被砍掉了绝大部分。中国只派出一支小型代表队，其余名额来自世界其他地方最强的棋手，而三十五年来，世界其他地方差得很远。能在北京夺冠的棋手，通常也能在新加坡或温哥华夺冠；反过来则几乎从未发生。',
  'The comparison English readers reach for is the wrong way round. The world title here is closer to a strong invitational than to a world championship, and the national championship is the thing with the deep field, the long history and the names everyone knows. Lü Qin has five world titles and never finished a year as the best player in China; Hu Ronghua, who was that player for two decades, never won this event at all.':
    '英文读者习惯拿来类比的那组关系，方向正好反了。这里的世界冠军更接近一项高水平邀请赛，而不是世界锦标赛；全国个人赛才是那个参赛面深、历史长、名字人人都认得的比赛。吕钦有五个世界冠军，却从未在哪一年成为中国最强的棋手；而二十年里一直是那个人的胡荣华，根本没有拿过这项赛事的冠军。',
  'The decade with a ruling on it': '被处罚覆盖的那十年',
  'Every edition from 2009 to 2023 was won by a man who now has a published ruling against him. That is eight championships and six men: three banned for life, one convicted in court, one given five years, and one given six months.':
    '从2009年到2023年，每一届的冠军如今都背着一份已公布的处罚决定。这是八届比赛、六个人：三人终身禁赛，一人被法院判罪，一人五年禁赛，一人六个月禁赛。',
  'The rulings came out of the match-fixing case the Chinese press calls 录音门, the recording gate, which the Chinese Xiangqi Association worked through between 2024 and 2026. It has [a page of its own](/blog/xiangqi-match-fixing): the investigation, everyone sanctioned, the reasoning, and the sources. The findings are by the sport’s own governing body rather than allegations, and they are about those players’ careers rather than about specific world championship games.':
    '这些处罚出自中国媒体称为录音门的假棋案，中国象棋协会在2024年到2026年间陆续处理完毕。它另有[专页](/blog/xiangqi-match-fixing)：调查经过、全部受罚者、来龙去脉与资料来源。这些认定是这项运动自己的管理机构作出的，不是指控；针对的是这些棋手的职业生涯，而不是某一局具体的世锦赛对局。',
  'The names stay in the table and the sections stay on the page. A list that quietly dropped them would be a worse record of what happened, and what the rulings do not tell you is which games were fixed. The [national championship list](/blog/xiangqi-champions) tells the same decade from the other side, where ten of the thirteen men who have won since 2005 carry a ruling.':
    '名字留在表里，章节留在页面上。悄悄把他们删掉的名单，是一份更差的历史记录；而这些处罚并没有告诉你哪些棋是假的。[全国冠军名单](/blog/xiangqi-champions)从另一侧讲述同样的十年，那里2005年以来夺冠的十三人中有十人背着处罚。',
  'Shanghai, September 2025': '上海，2025年9月',
  'The 2025 championship was played in Shanghai in September, and won by Lại Lý Huynh of Vietnam, who beat Yin Sheng of China in the final on the twenty-seventh. He is the first man from outside China to take the standard title in the thirty-five years the event has existed.':
    '2025年的世锦赛9月在上海举行，越南的赖理兄夺冠，他在27日的决赛中战胜了中国的殷升。在这项赛事存在的三十五年里，他是第一个把慢棋冠军拿走的非中国棋手。',
  'Lại Lý Huynh vs Fung Ka-chun, 23 September 2025, four days before the final. Two hundred and seventeen plies, and the engine has him level as late as move ninety.':
    '赖理兄对冯家俊，2025年9月23日，决赛前四天。两百一十七个回合，引擎认为直到第九十回合双方仍然均势。',
  'It is tempting to read the two facts together, as though the bans opened a door. That reading is too neat. He was born in Vĩnh Long in 1990, won the world rapid title in 2022, and reached this final in 2023 before losing it to Meng Chen in a tiebreak. He appears twice more on this page, losing to Zheng Weitong in 2015 and to Meng Chen in 2023, which is a decade of arriving before he won anything. Vietnam has been the second strongest xiangqi nation for a generation without much English notice.':
    '把这两件事连起来读很有诱惑力，好像是禁赛替他打开了门。这个读法太齐整了。他1990年生于永隆，2022年拿下世界快棋冠军，2023年就打进过这项决赛，在加赛中输给孟辰。他在本页还出现过两次，2015年输给郑惟桐，2023年输给孟辰，也就是说他在拿到任何东西之前已经来了十年。越南做了一代人的世界第二象棋强国，英文世界却几乎没有注意到。',
  'Where that leaves the title': '这个头衔的分量',
  'Nineteen editions, eleven winners, and a question that had the same answer for thirty-five years. The world title had never left China. Now it has, in the same decade the sport spent voiding its own results, and those two things are worth keeping separate.':
    '十九届，十一位冠军，还有一个三十五年来答案不变的问题。世界冠军从未离开过中国。现在它离开了，而这十年正是这项运动忙着推翻自己成绩的十年，这两件事值得分开来看。',
  'What the title is worth is a separate question again, and the honest answer is that it has always been worth less than the championship held in Beijing. That is not a slight on the men who won it. It is what happens when one country is this far ahead of the rest, and it is the thing 2025 has started to change.':
    '这个头衔究竟值多少，又是另一个问题，老实的回答是：它一直不如在北京举行的那个比赛。这不是贬低夺得它的棋手。当一个国家领先其他国家这么多时，事情本来就会是这样，而2025年开始改变的正是这一点。',
  'Nine of the ten games on this page are chapters in a study you can work through properly: the full move tree, the engine’s lines as branches you can walk, one chapter per champion in the order they appear here.':
    '本页十局棋中有九局收进了一份可以逐步研读的研习：完整的着法树，引擎给出的变化作为可以走进去的分支，每位冠军一章，顺序与本页相同。',
  pandemic: '疫情',
  'six-month ban, 2025': '禁赛六个月，2025',
  'Meng Chen 孟辰': '孟辰',
  'Lại Lý Huynh 赖理兄': '赖理兄',
  'Zhao Xinxin': '赵鑫鑫',
  'Jiang Chuan': '蒋川',
  'Wang Tianyi': '王天一',
  'Zheng Weitong': '郑惟桐',
  'Xu Chao': '徐超',
  'Meng Chen': '孟辰',
  'Lại Lý Huynh': '赖理兄',
  'Wu Guilin': '吴贵临',
  'Nguyễn Vũ Quân': '阮武君',
  'Nguyễn Thành Bảo': '阮成保',
  'Lei Kam Fun': '李锦欢',
  'Wang Kuo': '王廓',
  'Huang Xueqian': '黄学谦',
  'Fung Ka-chun': '冯家俊',
  '1991 2nd World Xiangqi Championship': '1991年第二届世界象棋锦标赛',
  '1997 5th World Xiangqi Championship': '1997年第五届世界象棋锦标赛',
  '2007 10th World Xiangqi Championship': '2007年第十届世界象棋锦标赛',
  '2009 11th World Xiangqi Championship': '2009年第十一届世界象棋锦标赛',
  '2011 12th World Xiangqi Championship': '2011年第十二届世界象棋锦标赛',
  '2015 14th World Xiangqi Championship': '2015年第十四届世界象棋锦标赛',
  '2019 16th World Xiangqi Championship': '2019年第十六届世界象棋锦标赛',
  '2022 17th World Xiangqi Championship': '2022年第十七届世界象棋锦标赛',
  '2023 18th World Xiangqi Championship': '2023年第十八届世界象棋锦标赛',
  '2025 19th World Xiangqi Championship': '2025年第十九届世界象棋锦标赛',
  // ---- jieqi-openings (machine-drafted 2026-08-30, not native-reviewed) ----
  'Jieqi on Mistboard': 'Mistboard 上的揭棋',
  'Jieqi and xiangqi players who want to know what the first move is worth, and English speakers who have never seen this material because it has only ever existed in Chinese.':
    '想知道第一步值多少的揭棋和象棋棋手，以及从未接触过这些内容的英文读者：这些材料此前只存在于中文之中。',
  'What Strong Jieqi Players Believe About the Opening': '高手眼中的揭棋开局',
  'Jieqi Opening Theory: The First Move, Ranked': '揭棋开局：第一步怎么走，附排序',
  'Jieqi has no opening book. It has an argument about the first move, running on Chinese forums among players with thousands of games, never written down in English. Why a face-down piece is a one-shot option you can waste, five openings ranked, and the pawn push weighed against the crossed cannon on all six reveals.':
    '揭棋没有开局谱。它有的是一场关于第一步的争论，在中文论坛上持续多年，参与者都是对局上千盘的棋手，却从未有人用英文写下来。为什么一枚暗子是只能用一次的权利、五种开局的排序，以及仙人指路与过河炮在六种翻出结果下的逐一比较。',
  'Jieqi has no opening book. No catalog of variations, no agreed piece-value table, nothing to memorize. One of the strongest players who writes about the game, a level-two Chinese xiangqi player claiming 90% over three thousand games, started the missing book and got one chapter in.':
    '揭棋没有开局谱。没有变例目录，没有公认的子力价值表，没有需要背的东西。写这个游戏写得最好的棋手之一，一位自称三千盘胜率九成的中国象棋二级棋士，动手写了那本缺失的书，写完第一章就停了。',
  'What exists is an argument about the first move, running on Chinese forums for years, never written down in English. Here it is, with the sources at the bottom. Treat it as what strong players believe: none of it has been measured.':
    '真正存在的是一场关于第一步的争论，在中文论坛上持续多年，从未有人用英文写下来。以下就是这场争论，出处列在文末。请把它当作高手们的看法：其中没有一条经过实测。',
  'Every piece but the two generals starts face-down and shuffled. Neither player knows their own.':
    '除双方将帅外，所有棋子开局时都是打乱后反扣的。双方都不知道自己的棋子是什么。',
  'A dark piece moves as the point it stands on': '暗子按它所在的位置行棋',
  'A face-down piece moves, attacks, and captures as the piece belonging to the point it sits on, not as whatever it turns out to be. A dark piece on a cannon point moves like a cannon and captures like a cannon. Then it flips and plays as itself. The [rules page](/rules/jieqi) has the rest.':
    '暗子的走法、攻击和吃子，都按它所在起始位置那枚棋子来算，而不是按它翻开后的真实身份。炮位上的暗子走起来像炮，吃子也像炮。走完这一步它就翻开，之后按真实身份行棋。其余规则见[规则页](/rules/jieqi)。',
  'So a face-down piece holds one use of its square’s power. A dark piece on a chariot point is a chariot for exactly one move, and then it is whatever it actually is, which might be a pawn. That single move is the most valuable thing about it, and you get to spend it once.':
    '所以一枚暗子握着它所在位置那种棋力的一次使用权。车位上的暗子就是一步之内的车，走完之后它是什么就是什么，也许只是一个兵。那一步是它身上最值钱的东西，而你只能花掉一次。',
  'Flipping costs two things. The square’s power goes, and so does the concealment: your opponent does not know what the piece is either, so while it stays down it threatens as its point in their reading of the position too. What you buy is that the piece plays as itself from then on, which is often a downgrade. The common mistake is spending an expensive option on a cheap job, and it costs nothing you can see on the board.':
    '翻子要付两样代价。位置带来的棋力没了，隐蔽也没了：对手同样不知道这枚子是什么，所以只要它还扣着，在对手眼里它就按所在位置构成威胁。你换来的是这枚子此后按真实身份行棋，而这往往是降级。最常见的错误，是把一份昂贵的权利花在一件廉价的差事上，而且棋盘上看不出你亏了什么。',
  'The same move, before and after. Face-down on a cannon point it slides the file and takes the horse behind the screen. Play that capture and you have spent a cannon’s only shot to win a horse, and what stands on the point is a soldier. Strong players call that trade a loss.':
    '同一步棋的前后。扣着的时候，炮位上的暗子能沿直线滑动，隔着炮架吃掉那只马。真走了这一吃，你就用掉了炮仅有的一发，换来一只马，而落点上站着的是一个兵。高手把这笔交易算作亏。',
  'The first move is therefore two decisions. You choose which option to spend, and you take a lottery ticket on what stands up.':
    '所以第一步是两个决定。你选择花掉哪一份权利，同时抽一张关于翻出什么的彩票。',
  'Five first moves, ranked': '五种第一步的排序',
  'From the largest jieqi thread on Zhihu, ranked by a player with more than four hundred games.':
    '出自知乎上最大的揭棋讨论，排序者有四百多盘对局。',
  'Where they are, from Red’s side. Left board, left to right: the edge pawn, the 3- or 7-file pawn push, the central pawn, and the cannon point crossing the river. Right board: both cannons firing over the black cannons to take both horses.':
    '它们在棋盘上的位置，以红方视角。左图从左到右：边兵、三路或七路的仙人指路、中兵，以及过河的炮位。右图：双炮隔着黑方的炮打掉双马。',
  'Option cost explains both ends of that list. The pawn push is first because a pawn point’s one move is the cheapest thing in the game to spend. Taking two horses with two cannons is last because it spends the two most expensive options on the board for two horses.':
    '权利的成本解释了这份名单的两头。仙人指路排第一，因为兵位的那一步是全盘最便宜的花费。双炮打双马排最后，因为它用掉了盘上最贵的两份权利，只换来两只马。',
  'The middle two rank on position. The central pawn is the sensitive one: turn over a chariot there and a revealed cannon can kill it, but turn over a cannon and you can probe the centre and both edges for chariots, and those follow-ups are settled enough that players call them 定式, set patterns. The edge pawn is just as cheap and buys much less. It opens a path for the edge horse and announces that it is doing so, and a horse turned over on the edge is stuck where it stands.':
    '中间两种靠局面排序。中兵是敏感的一手：这里翻出车，对方翻出的炮就能打死它；翻出炮，你却可以试探中路和两翼找车，而这些后续走法成熟到棋手称之为定式。边兵一样便宜，买到的却少得多。它给边马让出一条路，同时把这个意图明说出来，而边上翻出的马会卡死在原地。',
  'Our own games disagree with the list. Across fifty jieqi games here that ran past ten moves, humans playing Red opened with the central pawn in fourteen of twenty-five, and with the recommended pawn push in three. Whatever the forums say, players open in the middle.':
    '我们自己的对局和这份名单并不一致。在 Mistboard 上五十盘走过十回合的揭棋里，执红的人类棋手二十五盘中有十四盘走中兵，走推荐的仙人指路只有三盘。不管论坛怎么说，棋手们从中路开局。',
  'PikaJieQi, our build of Pikafish’s jieqi branch, declines the list altogether. In twenty of its twenty-five games as Red it opened from a back-rank horse point, h1 to g3 or b1 to c3, a development move none of the five covers. Read that carefully before treating it as a verdict. It is one engine at two settings repeating itself, not twenty independent opinions. The humans lost almost every game, so nothing here settles which opening is better. And PikaJieQi runs a hand-written evaluation with no neural network, so its opening preference reflects the heuristics someone wrote into it rather than anything it learned. What it does suggest is that the list answers a narrower question than it appears to.':
    'PikaJieQi 是我们基于 Pikafish 揭棋分支的构建，它干脆不用这份名单。它执红的二十五盘里有二十盘从底线马位起手，h1 到 g3 或 b1 到 c3，这是五种开局都没有涵盖的一种出子走法。把它当成结论之前请读仔细。那是同一个引擎在两档强度下重复自己，不是二十个独立意见。人类几乎盘盘皆输，所以这些数据判定不了哪种开局更好。而且 PikaJieQi 用的是手写评估函数，没有神经网络，所以它的开局偏好反映的是有人写进去的启发式规则，而不是它自己学到的东西。它提示的是，这份名单回答的问题比看上去要窄。',
  'The pawn push beats the crossed cannon on 13 of 15': '十五种翻出里，仙人指路有十三种胜过过河炮',
  'A player rated 揭7 on two accounts weighed the top two against each other: the pawn push against the cannon point crossing the river. Whichever you pick, the piece you move is your own and you do not know what it is until it lands. Fifteen sit face-down on your side, five pawns and two each of chariot, horse, cannon, advisor and elephant, so the odds on what stands up are countable.':
    '一位在两个账号上都打到揭7的棋手，把排在前面的两种开局逐一比较：仙人指路对过河的炮位。无论选哪一种，你动的都是自己的暗子，落子之前你不知道它是什么。你这边有十五枚暗子：五个兵，车马炮士象各两枚，所以翻出什么的概率是可以算的。',
  'On a pawn, the crossed cannon eats once and gives up two or three reveals in exchange. On a chariot, holding a dark cannon in reserve beats holding a dark pawn. The rest it simply plays less efficiently, and the advisor is the one case it wins, slightly.':
    '翻出兵时，过河炮吃到一子，却让对方翻出两三枚作为代价。翻出车时，手里留一枚暗炮胜过留一枚暗兵。其余几种它只是走得效率更低，而士是它唯一略占上风的一种。',
  'Thirteen of the fifteen favour the pawn push, about 87%, and the count understates it: the crossed cannon’s one win is slight while several of the pawn push’s are decisive. The verdicts are theirs, the weights are mine from the piece counts, and nobody has run that comparison past an engine.':
    '十五枚里有十三枚站在仙人指路一边，约百分之八十七，而这个数字还说低了：过河炮唯一的那次胜出只是略胜，仙人指路的几次却是决定性的。判断出自那位棋手，权重是我按棋子数算的，而这场比较从来没有引擎跑过。',
  'Those odds hold on move one. The deck does not refill, so every reveal narrows what is left, and a player counting what has already turned over is working from better numbers later in the game.':
    '这些概率只在第一步成立。这副牌不会补充，所以每翻开一枚，剩下的范围就窄一分，而记住已经翻出过什么的棋手，到后面用的是比这张表更准的数字。',
  'A chariot is worth about two cannons': '一车约值两炮',
  'In xiangqi a chariot trades roughly for a horse and a cannon. In jieqi the same players put it higher, closer to two cannons, and arguably above a horse, cannon and advisor together. The general has no fixed guard here: any piece can be anything, so the wall in front of a jieqi general is whatever happened to land there, and a chariot walks through it.':
    '在象棋里，一车大致换一马一炮。在揭棋里，同样这批棋手把它抬得更高，接近两炮，甚至高于马炮士三子之和。这里的将帅没有固定的护卫：任何一枚子都可能是任何东西，所以揭棋里将帅面前的那道墙，只是碰巧落在那里的棋子，而车会直接穿过去。',
  'Protect yours. Holding one chariot against two, refuse the trade, even with both of theirs still face-down. This is also why the two dark pieces on the back chariot points usually stay down: they defend, and they are the most expensive unspent options either player holds.':
    '护住自己的车。手里一车对人家两车时，不要兑，哪怕对方两车都还扣着。这也是为什么底线两个车位上的暗子通常一直不翻：它们既是防守，也是双方手里最贵的、尚未动用的权利。',
  'With a chariot: the river bank, then the file': '有车之后：先控河沿，再占肋道',
  'One sequence in jieqi behaves like a line. With a chariot out, take the opponent’s river bank, occupy a file, and prepare the attack that comes with exposing your own general. Experienced opponents know the answer: fly an elephant and jump a horse quickly, so the back chariot point covers the approach.':
    '揭棋里只有一条路数像定式。车出来之后，控制对方的河沿，占住一路，再准备那种亮帅助攻的进攻。有经验的对手知道怎么应：赶紧飞象跳马，让底线的车位守住通路。',
  'A chariot-led file attack against a fast elephant-and-horse screen is as close as this opening gets to established theory.':
    '车领衔的肋道进攻，对上快速成型的象马屏障，这是揭棋开局最接近成型理论的东西。',
  'Black races for a chariot of their own': '黑方要抢自己的车',
  'Everything above is Red’s choice. Red’s edge is larger here than in xiangqi, because chariots can sit face-down and arrive in the middlegame.':
    '上面说的都是红方的选择。红方的先手优势在揭棋里比象棋更大，因为车可以一直扣着，留到中局才出现。',
  'When Red’s pawn push turns over a chariot, develop a horse and race for a chariot of your own. There is no better answer, and strong players do not pretend there is one.':
    '红方仙人指路翻出车时，跳正马，去抢自己的车。没有更好的应法，高手也不假装有。',
  'When your chariots arrive late anyway, drop the development order. Pawn, then horse, then advisor is a peacetime plan. Get both horses out instead, so your pieces defend each other.':
    '如果你的车终究来得晚，就别守出子次序了。先兵后马再上士是太平时候的计划。把双马都跳出来，让各子互相生根。',
  'Stop flipping once three major pieces are out': '三个大子出来之后就别再翻了',
  'Once three major pieces are revealed and active, attack with them. Flipping past that point hands the initiative to whoever is already developed, because a flip is a move that threatens nothing while your opponent uses theirs. On Tiantian Xiangqi the rated jieqi clock is tighter than the xiangqi one and carries no per-move increment, so the player still turning pieces over in a sharp position tends to lose on time as well.':
    '三个大子翻开并投入战斗之后，就用它们进攻。过了这个点还在翻子，等于把主动权交给已经出好子的一方，因为翻一步什么也威胁不到，而对手那一步是有用的。天天象棋的揭棋定级赛用时比象棋更紧，而且没有每步加秒，所以在尖锐局面里还在翻子的一方，往往还会超时告负。',
  Sources: '出处',
  'Three Chinese-language posts. Titles are given in English, with the original after, so you can search for them.':
    '三篇中文帖子。下面同时给出英文译名和原标题，方便检索。',
  '[Notes on Jieqi, Part 1](https://zhuanlan.zhihu.com/p/347466882) (揭棋心得 Part.1). The closest thing to a jieqi book that exists, and it is one chapter. Source for the piece values, the chariot, and what spending an option costs.':
    '[揭棋心得 Part.1](https://zhuanlan.zhihu.com/p/347466882)。目前最接近一本揭棋书的东西，只有一章。子力价值、车的分量，以及花掉一份权利的代价都出自这里。',
  '[What do you make of Tiantian Xiangqi’s jieqi mode?](https://www.zhihu.com/question/53501615) (如何看待天天象棋推出的“揭棋”玩法？). The largest jieqi discussion anywhere. Source for the ranking, the reveal-by-reveal case, and the chariot plan.':
    '[如何看待天天象棋推出的“揭棋”玩法？](https://www.zhihu.com/question/53501615)。目前最大的揭棋讨论。排序、逐一翻出的比较，以及有车之后的路数都出自这里。',
  '[A notation for jieqi and banqi](https://zhuanlan.zhihu.com/p/638758588) (《天天象棋》揭棋和翻翻棋的记谱法). Proposes a way to record these games, which does not otherwise exist. Background only.':
    '[《天天象棋》揭棋和翻翻棋的记谱法](https://zhuanlan.zhihu.com/p/638758588)。提出了一套记谱方式，此前并不存在。仅作背景参考。',
  'There is no jieqi opening database and no published statistics. The fifty games cited above are our own, they are mostly humans losing to Pikafish, and they are nowhere near enough to settle whether the pawn push really outperforms the crossed cannon. They are enough to say what people here actually play.':
    '揭棋没有开局数据库，也没有公开的统计。上面引用的五十盘是我们自己的对局，大多是人类输给 Pikafish，远不足以判定仙人指路是否真的胜过过河炮。它们只够说明这里的人实际在下什么。',
  Opening: '开局',
  Verdict: '评价',
  'Pawn push (仙人指路)': '仙人指路',
  'Crossed cannon (炮二进四)': '过河炮（炮二进四）',
  'Central pawn (冲中兵)': '冲中兵',
  'Edge pawn (九尾龟)': '边兵（九尾龟）',
  'Both cannons take horses': '双炮打双马',
  'Standard. No bad reveal.': '标准着法。翻出什么都不算坏。',
  'Good on a pawn, bad on a horse.': '翻出兵好，翻出马差。',
  'Risky. Exposed in the middle.': '有风险，中路容易受攻。',
  'Poor. An edge horse is stuck.': '差。边上翻出的马会卡死。',
  'Losing. A weak player’s gamble against a strong one.': '亏。是弱手对强手的赌博。',
  'What flips up': '翻出什么',
  Odds: '概率',
  'Better opening': '更优的开局',
  Pawn: '兵',
  'Pawn push': '仙人指路',
  'Crossed cannon': '过河炮',
  // -- The xiangqi match-fixing case --
  // Machine-drafted 2026-08-30, not native-reviewed, same standing as the two
  'The Xiangqi Match-Fixing Case': '象棋假棋案',
  'Xiangqi Match-Fixing: 录音门, the Bans, and the Convictions': '象棋假棋案：录音门、禁赛与判决',
  'Between 2024 and 2026 the Chinese Xiangqi Association sanctioned 49 people for buying and selling games, and a Hangzhou court convicted six grandmasters of bribery. What happened, why it paid, who ruled, and what is still unproven.':
    '2024到2026年间，中国象棋协会因买棋卖棋处罚了49人，杭州一家法院以行贿受贿判决六名特级大师有罪。事情经过、为何有利可图、谁作出认定，以及哪些至今未获证实。',
  'Ten of the thirteen men who have won the Chinese national xiangqi championship since 2005 carry a published ruling against them, including every winner from 2010 to 2023. The man who was China’s top-rated player from 2014 to 2023 was banned for life and then convicted in court. This is how that happened, and what it does and does not establish.':
    '2005年以来夺得全国象棋个人赛冠军的十三人中，有十人已被公开处罚，其中包括2010到2023年间的每一位冠军。2014到2023年间等级分居全国第一的棋手先被终身禁赛，随后被法院判决有罪。以下是事情的经过，以及哪些已被认定、哪些没有。',
  'It is assembled from Chinese-language reporting, which carries far more of it than the English coverage does. Where something is alleged rather than found, or charged rather than decided, this page says so.':
    '本页取材于中文报道，中文报道所载远比英文详尽。凡属指称而非认定、属指控而非判决者，本页都会写明。',
  'Players paid each other to lose': '棋手互相出钱买输赢',
  'The January 2025 and April 2026 rulings use the same formula: those sanctioned took part in 买棋 and 卖棋, buying and selling games, by way of 行贿 and 受贿, giving and taking bribes. The first notice, in September 2024, says only 买棋卖棋 and 操纵比赛, manipulating competition. Money moved from player to player, in cash, sometimes through intermediaries.':
    '2025年1月和2026年4月的两份处罚用的是同一套措辞：受罚者以行贿、受贿等方式，不同程度参与买棋、卖棋。2024年9月的第一份通报只写买棋卖棋和操纵比赛。钱在棋手之间流动，多为现金，有时经中间人转手。',
  'It was not a gambling case, though English write-ups often reach for the word. The charges are offering and accepting bribes as a non-state functionary, and no ruling or indictment describes betting.':
    '这不是赌博案，尽管英文报道常用这个词。指控的罪名是对非国家工作人员行贿罪和非国家工作人员受贿罪，没有任何处罚或起诉书提到下注。',
  'Why buying a game paid for itself': '买一盘棋为什么划算',
  'Rating points were not just a ranking. Under the system in force at the time they fed appearance and per-game fees, which made them the number a professional was paid on. That produced an asymmetry: a top-rated player gained almost nothing from beating a weaker one and lost a great deal from slipping, while the weaker player earned so little that a fee for losing beat the result. On CCTV, the player Cai Yi 才溢 illustrated the gap as perhaps ¥20,000 a game for a marquee name in a sponsored team event against ¥4,000 for an ordinary master. That rating system was abolished on 30 January 2026 and replaced with a rolling 52-week ranking.':
    '等级分不只是排名。在当时施行的制度下，它关系到出场费与对局费，也就成了职业棋手实际拿钱的依据。这带来一种不对称：等级分高的棋手赢下低分对手几乎没有收益，掉分却损失惨重；低分棋手所得本就微薄，输棋换来的报酬反而胜过战绩本身。棋手才溢在央视节目中举例说，有赞助的团体赛里，名将一盘或可得两万元，普通大师约四千元。该等级分制度已于2026年1月30日废止，改为按52周滚动计算的排名。',
  'The sport administration’s chess and card centre gave three motives in all: promotion through the grade titles, private division of prize money, and inflating the rating itself. Results were arranged to hit the norms for 特级大师, grandmaster, with players negotiating prices across a national individual championship, and in team events the same trade bought qualification as 运动健将, Master of Sport, which the coverage calls 搭便车, free-riding.':
    '国家体育总局棋牌运动管理中心共列出三项动机：晋升技术等级称号、私分奖金，以及提升等级分本身。为达到特级大师的标准，棋手在全国个人赛期间与多名对手谈价钱安排结果；在团体赛中，同样的交易被用来换取运动健将资格，报道称之为搭便车。',
  'Which is why paying to win a game you would probably have won anyway is not irrational. You are not buying the point. You are buying the rating that sets next season’s fee and the title that outlasts any single event, and against those, tens of thousands of yuan for one game is cheap.':
    '所以，为一盘本来多半也能赢下的棋付钱，并非不理智。买的不是这一分，而是决定下个赛季酬劳的等级分，以及比任何一届赛事都长久的称号。相较之下，一盘棋几万元并不算贵。',
  'A recording, and a whistleblower nobody could dismiss': '一段录音，和一位无法被忽视的举报人',
  'In April 2023 recordings of phone calls between two grandmasters, Hao Jichao 郝继超 and Wang Yuefei 王跃飞, appeared online. On them the two discuss buying and selling games, engine cheating, and manipulating rating points. Wang Tianyi is named on the tapes but was not on the calls. The Chinese press named the affair after them: 录音门, the recording gate.':
    '2023年4月，两名特级大师郝继超与王跃飞的通话录音在网上流出。录音中两人谈及买棋卖棋、软件作弊与操纵等级分。王天一在录音里被提到，但并非通话当事人。中文媒体因此把这起事件称为录音门。',
  'Liu Dahua 柳大华, then 73 and the holder of a one-against-nineteen blindfold record, had been saying for years that opponents’ moves were 相当的精准，和软件一模一样, uncannily precise, identical to the software. On 17 October 2023 he and Dang Fei 党斐 made a 实名举报, a real-name accusation, against Guo Liping 郭莉萍, a deputy director at the sport administration’s chess and card centre. That turned a leaked tape into a governance scandal. Liu was attacked online for it and brought two private criminal prosecutions, one for criminal insult and one for defamation, winning both. Dang Fei is on the list below, at three years.':
    '柳大华当时73岁，保持着一对十九的盲棋纪录。多年来他一直说，对手的着法相当的精准，和软件一模一样。2023年10月17日，他与党斐实名举报国家体育总局棋牌运动管理中心副主任郭莉萍。一段外流录音由此变成了治理层面的风波。柳大华为此在网上遭到攻击，他提起两起刑事自诉，一起以侮辱罪、一起以诽谤罪，均获胜诉。党斐本人也在下面的名单里，被禁赛三年。',
  'How the recordings reached the internet is reported by one outlet and confirmed by none: that Hao Jichao made them himself, gave them to Hong Zhi 洪智 after a suspension he considered unjust, and that Hong passed them on. Hong Zhi was himself convicted in 2025 and banned for life the following April.':
    '录音如何流到网上，只有一家媒体报道过，无人证实：郝继超自己录下这些通话，在一次他认为不公的停赛处理之后交给洪智，再由洪智转出。洪智本人于2025年被判决有罪，次年4月被终身禁赛。',
  Date: '日期',
  'What happened': '事件',
  'The spine of the case. Liu Dahua’s earlier private complaints are his own account rather than a documented date.':
    '本案的主线。柳大华更早的私下反映出自他本人的说法，并无确切日期可考。',
  'Two processes, one case': '两条并行的程序，同一起案件',
  'The disciplinary track and the criminal track are separate. They ran on different timetables, and the six convicted are six of the forty-nine banned rather than a different group.':
    '纪律处理与刑事追诉是两条独立的程序，时间表也不相同。被判刑的六人正是被处罚的四十九人中的六位，并非另一批人。',
  'A third track went nowhere in public. Three officials left the chess and card centre while the case ran: its director Zhu Guoping 朱国平 and its discipline secretary Guo Yujun 郭玉军 in November 2024, and Guo Liping in December. No removal notice mentions this case, and no official has been reported as charged or sanctioned in connection with it.':
    '第三条线在公开层面没有下文。案件进行期间，棋牌运动管理中心有三名官员去职：主任朱国平与纪检书记郭玉军于2024年11月，郭莉萍于同年12月。没有一份免职通知提到本案，也没有任何官员被报道因此被追究或处罚。',
  'The Chinese Xiangqi Association has sanctioned 49 people in three batches: two in September 2024, forty-one in January 2025, and six in April 2026. That is 8 lifetime bans, 37 timed bans and 4 public reprimands. Revocation of the technical grade title accompanies 19 of the 45 bans rather than all of them. Only the three timed bans in the April 2026 notice carry published start and end dates, all running from 24 July 2024; the January notice publishes no dates at all, so when most of those bans expire is not a matter of public record.':
    '中国象棋协会分三批处罚了49人：2024年9月两人，2025年1月四十一人，2026年4月六人。其中终身禁赛8人、限期禁赛37人、通报批评4人。45项禁赛中有19项同时撤销技术等级称号，并非全部。只有2026年4月通报里的三项限期禁赛公布了起止日期，均自2024年7月24日起算；1月的通报完全没有公布日期，因此其中多数禁赛何时期满并无公开记录。',
  'The association published almost every name. Where a player also appears on the champion lists, his national title years are in the last column.':
    '协会公布了几乎每一个名字。若该棋手同时出现在冠军名单上，其全国冠军年份列在最后一栏。',
  Player: '棋手',
  Penalty: '处罚',
  'National title': '全国冠军',
  'The 47 the association named. The other two were withheld because they were under 18 when the conduct occurred. Revocation of the technical grade title accompanies 19 of the 45 bans, not all of them.':
    '协会具名公布的47人。另外两人因涉案时未满18周岁而未公布姓名。45项禁赛中有19项同时撤销技术等级称号，并非全部。',
  'Hao Jichao, whose recordings started the case, is in the four-year-three-month tier, and was never criminally charged: the sporting penalty is the only one he carries. Xu Chongfeng’s two-year ban ran out on 23 July 2026, and the shorter bans from the January batch will have ended before it.':
    '录音出自郝继超之手，他被禁赛四年三个月，且从未被刑事追诉，所受的只有体育处罚。徐崇峰的两年禁赛已于2026年7月23日期满，而1月那批中更短的禁赛应当更早结束。',
  'Separately, the Shangcheng District People’s Court in Hangzhou convicted six grandmasters on 24 September 2025 of offering and accepting bribes as non-state functionaries, under Articles 163 and 164 of the criminal law. The Chinese press calls it the sport’s first criminal corruption case.':
    '另一条线上，杭州市上城区人民法院于2025年9月24日以对非国家工作人员行贿罪、非国家工作人员受贿罪判决六名特级大师有罪，依据刑法第163条与第164条。中文媒体称之为中国象棋反腐第一案。',
  Convicted: '被判刑者',
  Sentence: '刑期',
  'Reported from the 24 September 2025 verdict. No judgment text was released: these figures trace to the prosecution’s case, and only Hong Zhi’s was separately reported as a court outcome. Fines were imposed on Wang Tianyi and Zhao Xinxin; no amounts have ever been published.':
    '据2025年9月24日宣判的报道整理。判决书未公开：这些数字源自检方的指控，其中只有洪智一项另有作为法院结果的报道。王天一与赵鑫鑫另被并处罚金，金额从未公布。',
  'The strongest player in the world was buying': '最强的棋手是买家',
  'Wang Tianyi was China’s top-rated player from 2014 to 2023, known simply as 象棋第一人, the number one. The prosecution charged 22 separate acts of giving bribes totalling ¥942,000, against 2 acts of taking them totalling ¥116,000. Nineteen of the 22 payments ran through Wang Yuefei.':
    '王天一在2014到2023年间等级分居全国第一，被称为象棋第一人。检方指控他行贿22笔、合计94.2万元，受贿2笔、合计11.6万元。22笔中有19笔经由王跃飞。',
  'Eight yuan paid for every one received. He was not a weak player selling games he would have lost: he was the best player in the world, buying them. He pleaded guilty, was banned for life a year before the verdict, and apologised publicly in October 2025.':
    '每收一元，付出八元。他不是卖掉本就要输的棋的弱手，而是最强的棋手在买棋。他当庭认罪认罚，在宣判前一年已被终身禁赛，并于2025年10月公开致歉。',
  'Hong Zhi was the only one of the six who contested the charge. His appeal was rejected on 10 February 2026, and because he was taken into custody on sentencing day, roughly a year after Wang Tianyi, he will be released considerably later despite the shorter term.':
    '六人中只有洪智不认罪。他的上诉于2026年2月10日被驳回；由于他在宣判当日才被收押，比王天一晚约一年，尽管刑期较短，出狱时间反而晚得多。',
  'The cheating nobody charged': '无人指控的作弊',
  'Engine cheating runs through every account of this affair and appears in no ruling. It is the substance of the recordings, of Liu Dahua’s accusation, and of the press investigations, while the findings cite only bribery and the buying and selling of games. Nothing published resolves it either way.':
    '软件作弊贯穿这起事件的每一种叙述，却不见于任何处罚。它是录音的内容，是柳大华举报的内容，也是媒体调查的内容；而官方认定只提行贿受贿与买棋卖棋。已公开的材料无法证实，也无法证伪。',
  'What exists is testimony. Liu Dahua says that at a league match in Ordos in October 2018 he was standing beside Hao Jichao’s game against a teammate of his own when he twice heard a voice call a move, 卒5平4, pawn five to the fourth file, and that Hao then played it. He suspected smartwatches as the capture device, and says that at an earlier fixture where watches were collected before play, Hao lost two games. This is his account, and no finding confirms any of it.':
    '现有的只是证言。柳大华说，2018年10月鄂尔多斯的一场联赛中，他站在郝继超对阵自己队友的棋边，两次听到有人报出卒5平4，随后郝继超便走了这步棋。他怀疑智能手表被用作采集工具，并说在更早一场赛前收走手表的比赛中，郝继超输了两盘。这是他本人的说法，没有任何认定加以证实。',
  'Xu Yinchuan, who won six national titles and three world titles and is named in none of the three notices, is quoted as saying 有了软件以后，就感觉自己的棋跟软件比就根本没法下, that once the software existed his own play felt unplayable measured against it. He is describing what engines did to a professional’s confidence in preparation rather than accusing anyone, which is worth keeping distinct.':
    '六获全国冠军、三夺世界冠军的许银川，未出现在三份通报中的任何一份里。据引述，他说有了软件以后，就感觉自己的棋跟软件比就根本没法下。他讲的是引擎对一名职业棋手备战时信心的冲击，而不是在指控谁，这两件事应当分开。',
  'Tao Hanming, the 1994 champion, spoke out against software cheating in January 2016 and retracted the next day, saying he had spoken out of turn after drinking. A friend later told Jiemian the drink was cover for pressure. Which version to believe is the kind of thing a disciplinary finding settles, and none did.':
    '1994年的冠军陶汉明在2016年1月公开抨击软件作弊，次日又收回，称自己酒后失言。后来一位友人对界面新闻表示，酒是压力之下的托词。该信哪一种说法，本该由纪律认定来解决，而始终没有。',
  'No result has been struck from the record': '没有一项成绩被从记录中抹去',
  'No ruling says which individual games were bought. What was revoked is the personal technical grade, the 特级大师 or 大师 rank, which is a title conferred on a player rather than a tournament result. No championship or team title appears to have been annulled, and the champion lists on this site are unchanged. Ratings are a special case: none were struck, but the whole rating system was abolished on 30 January 2026 and replaced.':
    '没有任何处罚指明具体哪一盘棋被买。被撤销的是个人的技术等级称号，即特级大师或大师，那是授予棋手个人的头衔，而非赛事成绩。看不到任何冠军或团体名次被取消，本站的冠军名单也未作改动。等级分是个特例：并无个别分数被抹去，但整套等级分制度已于2026年1月30日废止并被取代。',
  'So the names stay on those pages with the finding beside them. Dropping them would assert something the rulings do not: that the games themselves were not real.':
    '因此这些名字仍留在那些页面上，旁边附着相应的认定。删掉他们，等于断言处罚并未认定的事：那些对局本身是假的。',
  'Where the sport is now': '这项运动如今的处境',
  'The league came back. The 2025 national men’s league ran its preliminary from 30 July 2025 and opened the main stage in Harbin on 3 August, with revised eligibility rules and a reformed format: 25 teams, ten advancing to a double round-robin, four boards played in two waves of two, and a blitz tiebreak deciding drawn matches. Whether the format was designed against collusion is not stated anywhere official, but a match that cannot end level is harder to arrange.':
    '联赛回来了。2025年全国象棋男子甲级联赛自2025年7月30日起进行预赛，8月3日在哈尔滨开始正赛，参赛资格经过修订，赛制也作了改革：25支队伍，十支晋级双循环，四台棋分两轮各两台进行，平局由超快棋决胜。这一赛制是否为防串通而设，官方并无说明；但一场不可能打平的比赛，确实更难安排。',
  'Thirty-seven of the bans expire. Eight do not. The 2025 national championship was won by Wang Yubo 王禹博, the first title since Xu Yinchuan’s in 2009 that comes with no asterisk on it, and the 2025 world title left China for the first time.':
    '三十七项禁赛有期满之日，八项没有。2025年全国个人赛冠军是王禹博，这是自2009年许银川之后第一个无需加注的冠军；同年的世界冠军也首次离开中国。',
  'Every national champion since 1956': '1956年以来的每一位全国冠军',
  'Every world champion since 1990': '1990年以来的每一位世界冠军',
  'All of it is Chinese-language reporting, listed so a reader who reads Chinese can check it rather than take our word for it.':
    '全部取自中文报道，在此列出，以便读得懂中文的读者自行核对，而不必只听我们的说法。',
  Source: '来源',
  'What it carries': '所载内容',
  'Several claims here rest on thinner ground than the rest, and the text says so where they appear: five of the six sentences trace to the prosecution rather than a released judgment, all of Liu Dahua’s testimony and the Xu Yinchuan quotation are single-sourced accounts, the route the recordings took to the internet is one outlet’s investigation, the officials’ departures are not officially tied to this case, and the absence of any annulled result is inferred from silence rather than stated in a ruling.':
    '本页有几处依据较薄，正文中已在相应位置注明：六项刑期中有五项源自检方而非已公开的判决书；柳大华的全部证言与许银川那句引述均为单一来源；录音流入网络的经过出自一家媒体的调查；官员去职并未被官方与本案相联系；而没有成绩被取消这一点，是从无人提及推出的，并非哪份处罚写明。',
  // The three tables. Every cell is its own key, because deepTranslate matches
  // whole strings; the roster's player column drops the romanisation and keeps
  // the Chinese name, which is what the champion tables already do.
  '~2012 onward': '2012年前后起',
  'Liu Dahua privately alleges engine cheating': '柳大华私下指认软件作弊',
  'April 2023': '2023年4月',
  'The Hao Jichao and Wang Yuefei recordings appear online': '郝继超与王跃飞的通话录音在网上流出',
  'July 2023': '2023年7月',
  'The association opens a formal investigation and forms a task force':
    '中国象棋协会立案调查并成立专案组',
  'August 2023': '2023年8月',
  'Wang Tianyi withdraws from the Hangzhou Asian Games, citing health':
    '王天一以身体原因退出杭州亚运会',
  '17 October 2023': '2023年10月17日',
  'Liu Dahua makes a real-name accusation against a sport-administration official':
    '柳大华实名举报体育总局一名官员',
  '24 July 2024': '2024年7月24日',
  'The date the April 2026 bans run from; the January notice publishes none':
    '2026年4月处罚的起算日；1月的通报未公布日期',
  '19 September 2024': '2024年9月19日',
  'First sanctions: Wang Tianyi and Wang Yuefei, life': '首批处罚：王天一、王跃飞终身禁赛',
  '12 January 2025': '2025年1月12日',
  'Second batch: 41 people': '第二批：41人',
  '24 September 2025': '2025年9月24日',
  'Six grandmasters convicted in Hangzhou': '六名特级大师在杭州被判有罪',
  '13 April 2026': '2026年4月13日',
  'Third batch: 6 people': '第三批：6人',
  Life: '终身禁赛',
  'Wang Yuefei 王跃飞': '王跃飞',
  'Shen Peng 申鹏': '申鹏',
  '8 years': '8年',
  '7 years 6 months': '7年6个月',
  'Sun Yiyang 孙逸阳': '孙逸阳',
  '7 years': '7年',
  'Zhao Jincheng 赵金成': '赵金成',
  '6 years': '6年',
  '5 years': '5年',
  'Zhang Shenhong 张申宏': '张申宏',
  '4 years 6 months': '4年6个月',
  '4 years 3 months': '4年3个月',
  'Hao Jichao 郝继超': '郝继超',
  'Liu Junda 刘俊达': '刘俊达',
  'Yu Yixiao 俞易肖': '俞易肖',
  'Cheng Ming 程鸣': '程鸣',
  'Zheng Yihong 郑一泓': '郑一泓',
  '4 years': '4年',
  'Dang Fei 党斐': '党斐',
  '3 years': '3年',
  'Li Shaogeng 李少庚': '李少庚',
  'Zhao Dianyu 赵殿宇': '赵殿宇',
  'Nie Tiewen 聂铁文': '聂铁文',
  'Wu Junqiang 武俊强': '武俊强',
  'Miao Liming 苗利明': '苗利明',
  '2 years': '2年',
  'Huang Zhufeng 黄竹风': '黄竹风',
  'Sun Xinhao 孙昕昊': '孙昕昊',
  'Yang Ming 杨铭': '杨铭',
  'Xu Chongfeng 徐崇峰': '徐崇峰',
  'Zhao Wei 赵玮': '赵玮',
  '1 year': '1年',
  'Lu Weitao 陆伟韬': '陆伟韬',
  'Yang Hui 杨辉': '杨辉',
  'Li Xiaolong 李小龙': '李小龙',
  'Zheng Yuhang 郑宇航': '郑宇航',
  'Ma Tianyue 马天越': '马天越',
  'Li Aidong 李艾东': '李艾东',
  'Wang Yuhang 王宇航': '王宇航',
  '6 months': '6个月',
  'Zhao Yanghe 赵旸鹤': '赵旸鹤',
  'Cui Ge 崔革': '崔革',
  'Xie Kui 谢岿': '谢岿',
  'Zhao Ziyu 赵子雨': '赵子雨',
  'Cao Yanlei 曹岩磊': '曹岩磊',
  Reprimand: '通报批评',
  'Huang Wenjun 黄文俊': '黄文俊',
  'Cai Youguang 蔡佑广': '蔡佑广',
  'Liang Yunlong 梁运龙': '梁运龙',
  '4 years 9 months': '4年9个月',
  '2 years 9 months': '2年9个月',
  '2 years 7 months': '2年7个月',
  '2 years 6 months': '2年6个月',
  '[Xinhua](https://www.news.cn/sports/20260413/5a609df239414cb1b7118b2aa88518d0/c.html), [Caixin](https://china.caixin.com/2026-04-13/102433594.html)':
    '[新华社](https://www.news.cn/sports/20260413/5a609df239414cb1b7118b2aa88518d0/c.html)、[财新](https://china.caixin.com/2026-04-13/102433594.html)',
  'The April 2026 rulings': '2026年4月的处罚',
  '[China News Service](https://www.chinanews.com.cn/ty/2025/01-13/10352255.shtml), [China Daily](https://cn.chinadaily.com.cn/a/202501/12/WS6783355ea310b59111dad5af.html)':
    '[中新网](https://www.chinanews.com.cn/ty/2025/01-13/10352255.shtml)、[中国日报](https://cn.chinadaily.com.cn/a/202501/12/WS6783355ea310b59111dad5af.html)',
  'The 41-person batch, January 2025': '2025年1月的41人处罚',
  '[National Business Daily](https://www.nbd.com.cn/articles/2024-09-19/3562788.html)':
    '[每日经济新闻](https://www.nbd.com.cn/articles/2024-09-19/3562788.html)',
  'Wang Tianyi’s life ban, September 2024': '2024年9月王天一被终身禁赛',
  '[Yangtse Evening Post](https://www.yzwb.net/news/ty/202509/t20250924_268789.html), [Sina Sports](https://sports.sina.cn/others/qipai/2025-09-25/detail-infrsnht5787840.d.html)':
    '[扬子晚报](https://www.yzwb.net/news/ty/202509/t20250924_268789.html)、[新浪体育](https://sports.sina.cn/others/qipai/2025-09-25/detail-infrsnht5787840.d.html)',
  'The verdict and the six sentences': '宣判与六人刑期',
  '[Tencent News](https://news.qq.com/rain/a/20250924A04LFX00)':
    '[腾讯新闻](https://news.qq.com/rain/a/20250924A04LFX00)',
  'Hong Zhi’s refusal to plead guilty, via his counsel': '洪智不认罪，经其辩护人确认',
  '[CCTV](https://news.cctv.cn/2025/01/13/ARTIeFfY6eKYaRLubq3G5ZQp250113.shtml)':
    '[央视新闻](https://news.cctv.cn/2025/01/13/ARTIeFfY6eKYaRLubq3G5ZQp250113.shtml)',
  'The appearance-fee figures and the four motives': '出场费数字与各项动机',
  '[Jiemian](https://m.jiemian.com/article/12366112.html)':
    '[界面新闻](https://m.jiemian.com/article/12366112.html)',
  'Liu Dahua’s account, and how the recordings spread': '柳大华的说法，以及录音如何流传',
  '[Guancha](https://www.guancha.cn/sports/2025_01_12_761863.shtml)':
    '[观察者网](https://www.guancha.cn/sports/2025_01_12_761863.shtml)',
  'The fullest timeline of the affair': '事件最完整的时间线',
  // Jieqi platform page. Machine-drafted 2026-09-03 and not native-reviewed,
  // shipped on the standard set on 2026-08-29: a translation does not wait for a
  // read that is not coming. Locked the same day its English copy published, so
  // any later English edit orphans a key here and fails the coverage test.
  'Play jieqi against the engine or a friend, free and without an account, then review the game with analysis that separates your choices from your luck.':
    '免费和引擎或朋友下揭棋，不用注册，下完还能复盘，分析会把你的选择和你的运气分开算。',
  'Jieqi is [xiangqi](/rules/xiangqi) with every piece face-down. A piece moves as whatever normally starts on its square, then flips and keeps that identity for the rest of the game. You begin without knowing what anything is, including your own pieces. The [rules page](/rules/jieqi) has the details.':
    '揭棋就是把每个子都翻扣过去的[象棋](/rules/xiangqi)。暗子按它所在那个点原本摆的子走，走完就翻开，之后一直是翻出来的那个子。开局时你不知道任何一个子是什么，连自己的也不知道。[规则页](/rules/jieqi)有详细说明。',
  'It is a young game, out of Hong Kong and Guangdong, and it has spread over the last couple of decades mostly among Chinese and Vietnamese players. For what to actually open with, see [what strong players believe about the opening](/blog/jieqi-openings).':
    '这是一门年轻的棋，出自香港和广东，最近二三十年主要在华人和越南棋手之间传开。至于开局到底该走什么，见[强手眼中的揭棋开局](/blog/jieqi-openings)。',
  'Play the engine': '和引擎下',
  'Play a friend': '和朋友下',
  'Plain discs are still face-down. Each one turns over the first time it moves and is stuck with whatever it turns out to be.':
    '素面的圆子仍然是暗子。每个子第一次走动时翻开，翻出什么就是什么，再也换不掉。',
  'Mistboard · 5+5 casual': 'Mistboard · 5+5 非计分',
  'Black delivers checkmate on move 73.': '黑方在第 73 回合将死。',
  'That is [a real game on this site](/jieqi/game/jq_96f40ebb-1347-4c31-babe-d777c4a88ddf), not a demo, and every screenshot below comes from it.':
    '那是[本站的一盘真实对局](/jieqi/game/jq_96f40ebb-1347-4c31-babe-d777c4a88ddf)，不是演示，下面每一张截图都来自这盘棋。',
  'Play the engine at 1+1, 3+2 or 5+5, or send a friend a link. Free, no sign-up, nothing to install.':
    '用 1+1、3+2 或 5+5 和引擎下，或者把链接发给朋友。免费，不用注册，什么都不用装。',
  'Review your games': '复盘你的对局',
  'Ask for analysis on a finished game and the review separates what you chose from what you drew, which is the part a chess site has no reason to do. You also get the usual: a graph of the whole game, an accuracy score for each player, and every inaccuracy, mistake and blunder marked with the move that was better. It runs on our servers and takes a few minutes.':
    '对下完的棋点一次分析，复盘会把你选的和你揭到的分开来讲，这一块是国际象棋网站没有理由去做的。常规的东西也都有：整盘棋的优势曲线、双方各自的准确率，以及每一个不准确、失误和严重失误，都标出更好的着法。分析在我们的服务器上跑，要几分钟。',
  'The game above, graded.': '还是上面那盘棋，评过分了。',
  'A game summary: the advantage graph swinging back and forth across the game, beside accuracy cards reading Pikafish 86 percent with thirteen inaccuracies, two mistakes and one blunder, and Guest 91 percent with six inaccuracies, two mistakes and one blunder.':
    '一份对局总结：优势曲线在整盘棋里来回摆动，旁边是准确率卡片，Pikafish 86%，十三个不准确、两个失误、一个严重失误；Guest 91%，六个不准确、两个失误、一个严重失误。',
  'It tells you how lucky each flip was': '它会告诉你每次揭子运气有多好',
  'Half your moves turn a piece over, and you never know what you are turning over. So the engine works out what each piece that tile could have been would have been worth, and compares it to what you actually got. The gap is your luck on that flip.':
    '你有一半的着法是在翻子，而翻之前你并不知道翻的是什么。所以引擎会算出那个点上每一种可能的子分别值多少，再和你实际翻到的比一比。差出来的那一块，就是你这一揭的运气。',
  'Move 19 played the 39% move when 52% was there, so it is marked. Move 21 played the best one and still got a +43% gift from the flip.':
    '第 19 回合走了 39% 的着法，而当时有 52% 的可走，所以被标了出来。第 21 回合走的是最佳着法，同时还从揭子里白拿了 +43%。',
  'A jieqi review move list. Move 19 is a flip carrying a dice badge reading minus 21 percent, above four ranked candidate moves at 52, 39, 34 and 29 percent with the played move marked second. Move 21 carries plus 43 percent, move 21 for black plus 6 percent, and move 22 minus 10 percent.':
    '一份揭棋复盘的着法列表。第 19 回合是一次揭子，带着一个写着 -21% 的骰子标记，下面是四个排好序的候选着法，分别为 52%、39%、34% 和 29%，实战着法排在第二。第 21 回合是 +43%，黑方第 21 回合是 +6%，第 22 回合是 -10%。',
  'The percentage on each move is what it was worth before you flipped, averaged over every piece that tile could have been. The dice is what the flip actually gave you on top of that. So a move can be the best choice available and still come with a large plus or minus beside it: the first number is your decision, the second is the draw.':
    '每个着法旁边的百分数，是你揭开之前它值多少，按那个点上每一种可能的子取平均。骰子则是这一揭在此之外实际给了你多少。所以一个着法可以既是当时最好的选择，旁边又挂着一个很大的正数或负数：第一个数是你的决定，第二个数是你抽到的签。',
  'When your move is the top one, you chose well. Moves are only marked as mistakes when a better one was on the list.':
    '只要你走的是排第一的那个，你就选对了。只有当列表里存在更好的着法时，一个着法才会被标成失误。',
  'Your accuracy is then built from the choices alone, so a lucky flip cannot flatter it and an unlucky one cannot spoil it.':
    '准确率只由这些选择算出来，所以揭得好不会把它抬高，揭得差也不会把它拉低。',
  'And it runs in your browser': '而且它就在你的浏览器里跑',
  'The analysis board runs the same engine on your own machine, drawing its best moves on the board as you try a line. Nothing is queued, nothing is sent anywhere, and it needs no account. [The engine is open source](https://github.com/brianhliou/pikafish-jieqi-wasm), so if a number here looks wrong you can go and read the code that produced it.':
    '分析棋盘把同一个引擎放在你自己的机器上跑，你摆一条变化，它就把最佳着法画在棋盘上。不用排队，什么都不会传出去，也不需要账号。[引擎是开源的](https://github.com/brianhliou/pikafish-jieqi-wasm)，所以这里的某个数字如果看着不对，你可以直接去读算出它的那段代码。',
  'Running in a browser tab.': '就在一个浏览器标签页里跑。',
  'The analysis board with the local engine switched on: PikaJieQi at depth 18 and 335,000 nodes per second, three candidate lines each with an evaluation, and arrows for each drawn on the jieqi board.':
    '打开本地引擎后的分析棋盘：PikaJieQi 深度 18，每秒 335,000 个节点，三条候选变化各带一个评分，并在揭棋棋盘上分别画出箭头。',
  'Open the analysis board': '打开分析棋盘',
  'The engine': '关于引擎',
  'PikaJieQi is a fork of [Pikafish](https://github.com/official-pikafish/Pikafish), the open-source xiangqi engine, on its jieqi branch. Classical alpha-beta search with a hand-written evaluation and no neural network. What makes it a jieqi engine rather than a xiangqi one is that it treats every face-down piece as a chance node, scoring a move as the average over each piece that tile could still be. It only ever sees the face-down board, and a test fails the build if a hidden identity ever leaks into what it is sent.':
    'PikaJieQi 是开源象棋引擎 [Pikafish](https://github.com/official-pikafish/Pikafish) 揭棋分支的一个分叉。经典的 alpha-beta 搜索，配一套手写评估函数，没有神经网络。让它成为揭棋引擎而不是象棋引擎的地方在于：它把每一个暗子当作一个概率节点，一个着法的分数，是那个点上所有仍然可能的子分别算分之后的平均。它自始至终只看得到那张暗着的棋盘，只要有任何一个隐藏身份漏进发给它的数据里，就会有一个测试让构建失败。',
  "It is beatable, and the game at the top of this page is one it lost. You can watch it play itself in [these engine games](/study/wd6c7qvG). Almost all of modern Pikafish's strength lives in its neural network and jieqi has no good one: we trained a net and it never came out stronger than the hand-written evaluation, so this is an open problem rather than a chore nobody got round to. If you train nets, or know jieqi well enough to say where its judgement goes wrong, that is the help we would most like.":
    '它是能被打败的，本页最上面那盘棋就是它输的。你可以在[这些引擎对局](/study/wd6c7qvG)里看它自己和自己下。现代 Pikafish 的力量几乎全在它的神经网络里，而揭棋没有一张好网络：我们训练过一张，始终没有强过手写的评估函数，所以这是一个还没解决的问题，不是没人愿意干的杂活。如果你会训练网络，或者对揭棋熟到能指出它判断错在哪里，那是我们最想要的帮助。',
  'On Mistboard': '在 Mistboard 上',
  'Play the engine or a friend': '和引擎或朋友对弈',
  'Free, no account': '免费，不用账号',
  'Full-game analysis': '整盘分析',
  'Every finished game': '每一盘下完的棋',
  'Luck measured separately': '运气单独算',
  'Every flip priced': '每一次揭子都定价',
  'Engine in your browser': '引擎在你的浏览器里',
  'No queue, no account': '不排队，不用账号',
  'Studies with your own deals': '用自己的暗子布局做研习',
  Yes: '有',
  'Open-source engine': '开源引擎',
  'Rated ladder': '等级分天梯',
  'Open, signed in': '开放，需登录',
  'Common questions': '常见问题',
  'What is jieqi?': '揭棋是什么？',
  'Xiangqi with every piece except the general face-down. A piece moves as whatever normally starts on its square, then turns over and keeps that identity. It is called cờ úp in Vietnamese and 揭棋 in Chinese.':
    '就是除了将帅之外每个子都翻扣过去的象棋。暗子按它所在那个点原本摆的子走，走完翻开，之后一直是那个子。越南语叫 cờ úp，中文叫揭棋。',
  'How is jieqi different from xiangqi?': '揭棋和象棋差在哪里？',
  'Same board, same pieces, same moves, same goal. You just do not know which piece is which, so about half your moves flip one over and find out.':
    '同一张棋盘、同样的子、同样的走法、同样的目标。只是你不知道哪个子是哪个，所以大约一半的着法是翻开一个子看看。',
  'Is jieqi just luck?': '揭棋是不是全靠运气？',
  'The flips are random; what you do with them is not. Your accuracy score is built only from your choices, so a good draw cannot flatter it and a bad one cannot spoil it.':
    '揭子是随机的，你拿它做什么不是。你的准确率只由你的选择算出来，所以揭得好不会把它抬高，揭得差也不会把它拉低。',
  'Can a computer play jieqi well?': '电脑下揭棋下得好吗？',
  'Reasonably, not brilliantly. Ours is beatable by a strong human, mainly because no neural network has been trained for jieqi.':
    '还行，但谈不上出色。我们这个会被强棋手打败，主要是因为还没有为揭棋训练出神经网络。',
  'Can the engine see my hidden pieces?': '引擎看得到我的暗子吗？',
  'No. It gets the same face-down board you do and is never told the deal. A test fails the build if an identity ever leaks into what it is sent.':
    '看不到。它拿到的是和你一样的暗着的棋盘，从来不会被告知这一局是怎么摆的。只要有一个身份漏进发给它的数据里，就会有一个测试让构建失败。',
  'Is the shuffle fair?': '洗子公平吗？',
  'The deal is random, made on the server, and told to nobody: not you, not your opponent, not the engine.':
    '这一局怎么摆是随机的，在服务器上定，并且不告诉任何人：不告诉你，不告诉你的对手，也不告诉引擎。',
  'Where can I play jieqi online for free?': '哪里可以免费在线下揭棋？',
  'Here, against the engine or a friend. No account, nothing to install, and you can review the game with engine analysis afterwards.':
    '就在这里，和引擎或者朋友下。不用账号，什么都不用装，下完还能用引擎分析复盘。',
  'Start playing': '开始下棋',
  'Play Jieqi Online, with Engine Analysis': '在线下揭棋，带引擎分析',
  // Replay outcome lines. These sit directly under the replay header and were
  // invisible to the coverage gate until 2026-09-03, because article-prose.ts
  // read a spec's title, event and resultText but not its outcome. The jieqi
  // rules page has been serving this line in English on both zh pages since it
  // was locked.
  'Black wins by checkmate · 73 moves': '黑方将死获胜 · 73 回合',
  'Red wins by checkmate · 36 moves': '红方将死获胜 · 36 回合',
};

const ZH_HANT: Record<string, string> = {
  // Traditional starts from the complete Simplified key set, then every
  // authored Taiwan lexical or glyph fork below overrides that shared value.
  // Keep this spread first so new Traditional entries cannot be overwritten.
  ...ZH_HANS,
  // Gate-ladder figure labels. localizeSvgMarkup swaps <text> nodes through
  // this dictionary at render, but article-prose.ts gives a raw-svg block only
  // its caption, so nothing demanded these and the figure shipped in English.
  // The eight reason identifiers stay Latin: the caption calls them the value
  // stored on the candidate, and they should match the database.
  'THE GATE, IN EVALUATION ORDER': '判定關卡，按求值順序',
  'best mates in one, or no other move mates': '最佳著法一步將死，或沒有其他著法能將死',
  unique: '唯一',
  'win%(best) below 0.8': '最佳勝率低於 0.8',
  rejected: '拒絕',
  'no second move exists': '不存在第二選擇',
  'second move mates': '次佳著法也能將死',
  'gap below 200cp': '差距低於 200cp',
  'win%(second) at or below 0.6': '次佳勝率不高於 0.6',
  'gap of 250cp or more': '差距達到 250cp 或以上',
  'anything left over': '其餘情況',
  // Replay headers and result lines. article-prose.ts extracts these as of
  // 2026-09-02; before that only a stepper's caption counted, so these shipped
  // in English beside translated prose with the coverage test green.
  'World Championship Game 11, Sochi 2014': '世界冠軍賽第 11 局，2014 年索契',
  'Anand resigns. Carlsen (White) wins the match.': '阿南德認輸。卡爾森（白方）贏得這場比賽。',
  'Sacrifice the Horse in 13': '棄馬十三著',
  'Classic manual, 1632': '古譜，1632 年',
  "Checkmate on move 13. Red's paired cannons pin the general on the open central file.":
    '第 13 回合將死。紅方雙炮沿著打通的中路把將困死。',
  'Engine self-play · depth 10': '引擎自對弈 · 深度 10',
  'Red’s horse leaps to f5 and checkmates the black general on e7. Red wins.':
    '紅馬躍到 f5，將死 e7 的黑將。紅方勝。',
  'Misty DMX · Fog of War self-play': 'Misty DMX · 迷霧自對弈',
  'Black’s cannon takes the horse on c1; the Red general must recapture, and the waiting chariot runs the open c-file to capture it. Black wins.':
    '黑炮吃掉 c1 的馬；紅將必須回吃，等在一旁的車順著打開的 c 線衝下來把它吃掉。黑方勝。',
  'PikaJieQi self-play': 'PikaJieQi 自對弈',
  'Red works through the reveals and delivers checkmate on move 36.':
    '紅方在一次次揭子中推進，第 36 回合將死。',
  'Black is up material — five pieces to three — but cannot touch Red’s elephant, the highest piece left, while it picks off Black’s pieces one by one. Black resigns. In Banqi, rank beats raw material.':
    '黑方子力佔優，五子對三子，卻動不了紅方的象，那是場上僅存的最大子，而它正一個一個地吃掉黑方的子。黑方認輸。在暗棋裡，大小壓過純粹的子力。',
  'Engine self-play · 2.5 s per move': '引擎自對弈 · 每步 2.5 秒',
  'Black mates on move 43 with the soldier to b1, the same soldier that crossed the river on move 4. Red’s general has nowhere to go: its own soldier blocks a2, and Black covers both b1 and b2.':
    '黑方第 43 回合以兵到 b1 將死，正是第 4 回合過河的那個兵。紅帥無處可走：己方的兵擋住 a2，而 b1 和 b2 都在黑方控制之下。',
  // ── how-puzzle-mining-works (2026-09-01) ──
  // Script conversion of the Simplified above, not an independent translation:
  // the coverage test requires the two to stay parallel in length and to carry
  // an identical ASCII token stream (the counts, Pikafish, FEN, the squares,
  // the markdown link and the ** markers).
  'I built a xiangqi puzzle miner': '我做了一個象棋題目挖掘器',
  'A miner that reads real xiangqi games, finds the moves people got wrong, and keeps the positions where exactly one move wins. About one blunder in nine survives it. Here is the algorithm, the code, and some of what it kept and threw away.':
    '一個挖掘器：讀入真實的象棋對局，找出人們下錯的著法，保留那些恰好只有一步棋能贏的局面。大約每九個漏著裡有一個能留下來。下面是算法、代碼，以及它留下和丟掉的一些例子。',
  'Mistboard needed xiangqi puzzles and I could not find a corpus to use, so I wrote a miner. It reads real games, finds the moments somebody threw the game away, and keeps the positions where exactly one move wins.':
    'Mistboard 需要象棋題目，而我找不到現成的題庫可用，於是寫了一個挖掘器。它讀入真實對局，找出有人把棋葬送掉的那一刻，保留恰好只有一步棋能贏的局面。',
  'About one blunder in nine makes it through. The reasons the other eight fail turn out to be a working definition of a puzzle, which is the interesting part and most of what is below.':
    '大約每九個漏著裡有一個能通過。另外八個失敗的原因，恰好構成了一道題目該是什麼樣子的定義，這才是有意思的部分，也是下文的主要內容。',
  'The games': '棋譜從哪裡來',
  'They come from [ElephantChess](https://elephantchess.io/about/datasets), which publishes its own site’s games as anonymised monthly dumps under GPL-3.0. Amateur games, which matters: strong players do not blunder often enough to be a supply.':
    '它們來自 [ElephantChess](https://elephantchess.io/about/datasets)，該網站以 GPL-3.0 協議按月發布自己站內對局的匿名數據集。業餘對局，這一點很重要：高手漏著的頻率不足以支撐一個題庫。',
  'A run freezes its game list before any engine time is spent, sampled across ratings, time controls, results and lengths so it does not turn out to be all blitz. Nothing is added to a run once it starts.':
    '每一輪挖掘在花掉任何引擎時間之前，都會先把棋譜清單凍結，並按等級分、時限、結果和長度採樣，以免全是快棋。一輪開始之後就不再往裡加棋。',
  'The algorithm': '算法',
  'Two passes: a cheap one over every position of every game, and an expensive one over the few that survive it.':
    '兩遍掃描：一遍便宜的，跑遍每一局的每一個局面；一遍昂貴的，只跑通過了前一遍的少數局面。',
  'The cheap pass replays a game and stops at every position after ply 8, asking Pikafish for its top two moves at 60,000 nodes. That is roughly depth 10 to 14, and it is shallow on purpose, because it runs everywhere.':
    '便宜的那一遍把棋譜重演一次，在第 8 個半回合之後的每個局面停下，用 60,000 個節點向 Pikafish 要它認為最好的兩步棋。這大約相當於 10 到 14 層深度，淺是故意的，因為這一遍要跑遍所有局面。',
  'A position becomes a candidate when the move actually played loses at least 250 centipawns against the engine’s best, and the position it leaves behind is winning by at least 250 centipawns for the other side. A blunder that leaves the game equal is not a puzzle. There is nothing to find.':
    '當實際走出的那一步比引擎的最佳著法差至少 250 厘兵，並且它留下的局面對另一方而言至少領先 250 厘兵時，這個局面就成為候選。一個只把棋下成均勢的漏著不是題目，那裡沒有東西可找。',
  'A centipawn is a hundredth of a soldier, the unit engines use for material. Xiangqi has no pawn, so the name comes from chess along with the scale. The values this site uses put a horse or a cannon at 450 and a chariot at 900, which makes a 250-centipawn swing about half a horse.':
    '厘兵是一個兵的百分之一，引擎用來衡量子力的單位。象棋裡沒有國際象棋那種兵，所以這個名字連同它的標度都是從國際象棋借來的。本站採用的子力價值把馬或炮記作 450，車記作 900，因此 250 厘兵的落差大約是半個馬。',
  'Two filters keep that pass honest. Positions already decided by 800 centipawns are skipped, because winning a won game harder is not a tactic. And no game gives up more than three candidates, so one collapse cannot flood the corpus with variations on itself.':
    '另有兩個過濾器讓這一遍保持誠實。已經以 800 厘兵分出勝負的局面會被跳過，因為把一盤已經贏定的棋贏得更多不算戰術。而且每一局最多只交出三個候選，這樣一次崩盤就不會用同一個局面的各種變化淹沒題庫。',
  'The expensive pass takes each candidate back to the engine at depth 20 and 600,000 nodes, ten times the budget, handed over as a bare FEN with no move history. Same position, no context, so the engine cannot lean on the search it just did.':
    '昂貴的那一遍把每個候選送回引擎，用 20 層深度和 600,000 個節點，是前一遍預算的十倍，而且只交給它一個不帶走子歷史的 FEN。同一個局面，沒有上下文，引擎無法依賴它剛才做過的搜索。',
  'Then the line is built one solver move at a time, and every move has to be uniquely best on its own. That is what separates a puzzle from a plausible sequence. A principal variation is one line the engine liked from one search. It says nothing about whether move three was forced, and a solver who finds a different move three and is told they are wrong has been lied to.':
    '然後解答線路一步一步地搭起來，每一步都必須自己單獨是唯一最佳。這才是一道題目和一串看起來合理的著法之間的區別。主變只是引擎在一次搜索裡喜歡的一條線路，它沒有說第三步是不是被迫的；一個找到了另一種第三步卻被判為錯誤的解題者，是被騙了。',
  'Uniqueness is not a centipawn gap. Two moves 50 centipawns apart are both fine, and demanding one punishes a solver for choosing correctly. What makes a move **the** answer is that every alternative is wrong: it gives the win away, or it wins materially less. The test is a hand-tuned cascade rather than anything principled, and it fails closed, so anything it cannot separate is thrown away.':
    '唯一性不是厘兵差。相差 50 厘兵的兩步棋都不錯，硬要挑出一步只會因為解題者選對了而懲罰他。讓一步棋成為**那個**答案的，是其餘每一種選擇都是錯的：要麼把勝勢讓掉，要麼贏得的子力明顯更少。這個判定是一串手工調出來的閾值，談不上有什麼原理，而且它是分不開就拒絕，所以凡是它分不開的都會被丟掉。',
  'The gate in evaluation order. Green passes the move, grey rejects it, and the label on the right is the reason stored on the candidate.':
    '判定關卡按求值順序排列。綠色表示這一步通過，灰色表示被拒絕，右邊的標簽是記錄在候選上的原因。',
  'The code': '代碼',
  'The cheap pass, condensed. One detail halves it: judging a move needs the position’s value before and after, and both are already there if the scans stay in order, because the move played is worth the negation of the next position’s score. One search per position, not two.':
    '便宜的那一遍，精簡版。有一個細節把它的開銷減半：判斷一步棋需要知道局面在這一步之前和之後的分值，而只要掃描保持順序，這兩個值就都已經在手上了，因為走出的這一步的價值就是下一個局面分值的相反數。每個局面搜索一次，而不是兩次。',
  'And the gate. Every branch that returns false here is a way a real blunder fails to be a puzzle.':
    '還有判定關卡。這裡每一個返回 false 的分支，都是一個真實的漏著未能成為題目的方式。',
  'What it keeps': '它留下什麼',
  '**Two thirds of the puzzles open with a move that captures nothing.** If you hunt for tactics by scanning the captures first, which is what most of us do, you are looking at the wrong third of the board most of the time. Step through this one: the chariot goes the length of the board and takes nothing on the way.':
    '**三分之二的題目以一步不吃子的棋開始。** 如果你像我們大多數人那樣，先掃一遍能吃子的著法去找戰術，那你多數時候看的是棋盤上錯誤的那三分之一。把這一題走一遍看看：車從棋盤的一端走到另一端，一路上什麼都沒吃。',
  'Red plays the chariot the length of the board, taking nothing. Black brings the horse back to c3 to cover the mate, and it does not cover it.':
    '紅方把車從棋盤的一端走到另一端，什麼也沒吃。黑方把馬退回 c3 想守住殺棋，而它守不住。',
  '**Only about a tenth involve giving material away.** Sacrifices are the tactics people remember, so I had assumed they would be a larger slice. In real games between real players, the winning move is usually just a move. Here is one of the tenth, and the solver is the one behind: a horse and a cannon down before it starts.':
    '**只有大約十分之一涉及棄子。** 棄子是人們記得住的那種戰術，所以我原本以為它的比例會更大。在真實棋手之間的真實對局裡，取勝的那一步通常就只是一步棋。這是十分之一裡的一個，而且落後的正是解題的一方：開始時少一馬一炮。',
  'Red gave a chariot for an advisor and a horse, so it finishes 1,150 centipawns down instead of 900. The material never comes back. The mate just arrives first.':
    '紅方用一個車換回一士一馬，所以它從落後 900 厘兵變成落後 1,150 厘兵。子力再也沒有追回來，只是殺棋先到了。',
  '**Not every puzzle ends in mate.** About 40% end with the solver simply winning, and those are the ones a mate-shaped intuition misses. This one opens with a move that takes nothing, hands a soldier back, and collects an advisor and both horses for it.':
    '**並不是每道題目都以將死收尾。** 大約 40% 是以解題方單純取得勝勢結束的，而這些正是一心找殺棋的直覺會漏掉的。這一題以一步不吃子的棋開始，交還一個兵，換回一個士和兩個馬。',
  'Black ends a thousand centipawns up, an advisor and both horses against one soldier. There is no mate here and no threat of one. It is still a puzzle.':
    '黑方最終領先一千厘兵，一士兩馬對一兵。這裡沒有殺棋，也沒有殺棋的威脅，它仍然是一道題目。',
  'And one that takes nothing for four plies. Red is 150 centipawns down here and the engine calls the position level.':
    '還有一題連著四個半回合什麼都不吃。紅方在這裡落後 150 厘兵，而引擎認為局面是均勢。',
  'The chariot steps quietly to d3, the general is walked to the back rank, and the advisor on d8 falls. Red goes from 150 down to an engine score of +917, with Black left holding two legal moves.':
    '車悄悄走到 d3，將被逼到底線，d8 的士隨之落下。紅方從落後 150 變成引擎給出的 +917，而黑方只剩下兩步合法著法。',
  'What it throws out': '它丟掉什麼',
  'The rejects define a puzzle better than the keeps do, because each one is a real blunder that failed for exactly one reason.':
    '被丟掉的那些比留下的更能說清一道題目是什麼，因為每一個都是一個真實的漏著，而且恰好因為一個原因失敗。',
  Outcome: '結果',
  'Share of candidates': '占候選的比例',
  'Rejected: near-tie': '拒絕：幾乎並列',
  'Rejected: too short': '拒絕：太短',
  'Rejected: promised mate not reached': '拒絕：許諾的殺棋沒有兌現',
  'Rejected: not unique, or not winning': '拒絕：不唯一，或者並非勝勢',
  'Survived to the audit': '進入複核',
  'Measured over 10,503 candidates from 3,500 games in August 2026. The shares have held within about two points across three runs; the totals will not survive the next one.':
    '數據取自 2026 年 8 月、來自 3,500 局棋的 10,503 個候選。這些比例在三輪挖掘之間的浮動大約在兩個百分點以內；絕對數字則活不過下一輪。',
  '**Near-tie is the biggest, about a third.** The player had a winning move and so did something else. Both work, so there is no answer to check against and no puzzle, even though the blunder was real and the position was winning.':
    '**幾乎並列是最大的一類，約占三分之一。** 走棋的一方有一步能贏的棋，而另外還有一步也能贏。兩步都成立，於是沒有可以用來對照的答案，也就沒有題目，儘管那個漏著是真實的，局面也確實是勝勢。',
  '**Too short is another third**, and it gives the clearest example in the corpus of what the miner is for. Below is a position it rejected. Black is to move, the engine scores it as a forced mate against a second-best line of +1407, and exactly one of Black’s twenty legal moves does it.':
    '**太短是另外三分之一**，它給出了整個題庫裡最能說明這個挖掘器是幹什麼的例子。下面是一個被拒絕的局面。輪黑方走，引擎把它判為必然的殺棋，次優線路是 +1407，而黑方二十步合法著法裡恰好只有一步能做到。',
  'The horse drops to c3 and it is mate. Unique, crushing, correct, and rejected, because the whole win is one move and one move is a spot-check rather than a puzzle.':
    '馬落到 c3，殺棋。唯一、致命、正確，然後被拒絕，因為整個取勝過程只有一步棋，而一步棋是一次抽查，不是一道題目。',
  'The other way to fail is to have too many answers rather than too few. Red is to move below and the horse on e8 mates two different ways, c9 or g9. The stepper plays one of them. Either wins, so there is nothing to check a solver against, and the candidate is thrown out.':
    '另一種失敗方式是答案太多而不是太少。下面輪紅方走，e8 的馬有兩種不同的將死方法，c9 或者 g9。這個走子器演示其中一種。兩種都能贏，於是沒有東西可以用來對照解題者的答案，這個候選就被丟掉了。',
  'The horse mates on c9. It also mates on g9. Two answers is not one answer, so this is not a puzzle.':
    '馬在 c9 將死。它在 g9 也能將死。兩個答案不是一個答案，所以這不是一道題目。',
  '**Promised mate not reached** is the narrow one, and it is not a rule against non-mate puzzles. It fires only when the engine returned a mate score, so the line promised a mate, and replaying it inside the seven-ply cap never got there. The promise could not be checked, so the candidate goes. A position with an ordinary winning evaluation never enters that branch at all, and ships as one of the winning-advantage puzzles above.':
    '**許諾的殺棋沒有兌現**是範圍最窄的一類，它並不是一條針對非殺棋題目的規則。它只在引擎返回殺棋分值時觸發，也就是說這條線路許諾了一個殺棋，而在七個半回合的上限內把它重演一遍卻沒有走到。這個許諾無法驗證，於是候選被丟棄。評分只是普通勝勢的局面根本不會進入這個分支，它們會作為上面那種勝勢題目發布出去。',
  'What a puzzle turns out to be': '一道題目到頭來是什麼',
  'Most winning positions have several winning moves, and that is what disqualifies them: a third of everything found died on that alone. A puzzle is a position with one answer, deep enough that finding it takes work, and stable enough that a stronger engine still agrees an hour later.':
    '大多數勝勢局面都有好幾步能贏的棋，而這正是它們被淘汰的原因：找到的全部候選裡有三分之一只栽在這一點上。一道題目是這樣一個局面：它只有一個答案，深到需要下功夫才找得到，穩到一小時後一個更強的引擎仍然同意。',
  'That is a much narrower thing than a mistake. Nine out of ten mistakes do not qualify.':
    '這比一個錯誤要窄得多。十個錯誤裡有九個不夠格。',
  'One caveat I would rather say than hide: the gate has never been checked against a human. Its four thresholds came from reading rejected positions, not from measuring whether the puzzles they admit are any good, and the win-rate curve they act on is inherited from chess. Solve rates and reveal rates are recorded per puzzle, so the data to grade it exists.':
    '有一點我寧可說出來而不是藏著：這套判定關卡從來沒有拿真人檢驗過。它的四個閾值來自翻看被拒絕的局面，而不是來自衡量它放行的題目到底好不好，而這些閾值所依據的勝率曲線是從國際象棋繼承來的。每道題目的解出率和看答案率都有記錄，所以用來給它打分的數據是存在的。',
  'Solve xiangqi puzzles': '做象棋題目',
  'Play twelve of them': '試走其中十二題',
  'How Mistboard mines xiangqi puzzles from real games': 'Mistboard 如何從真實對局中挖掘象棋題目',
  // The xq-replay specs: title, event, resultText and the two seat labels.
  // article-prose.ts extracts only a stepper's caption, so these are invisible
  // to the coverage test, but deepTranslate walks the whole article and will
  // pick them up from here. Without them a widget header renders half and half.
  'A quiet key move': '不吃子的關鍵著法',
  'Behind, and giving more away': '落後，還要再送',
  'Winning, not mating': '取勝，而不是將死',
  'Level, then winning': '先是均勢，然後取勝',
  'Rejected: two answers': '拒絕：兩個答案',
  'Mined puzzle, mate in two': '挖掘出的題目，兩步殺',
  'Mined puzzle, winning advantage': '挖掘出的題目，取得勝勢',
  'Mate in one, thrown away': '一步殺，被丟掉',
  'Two mates in one, thrown away': '兩種一步殺，被丟掉',
  'Mate in two.': '兩步殺。',
  'Winning advantage, no mate.': '取得勝勢，沒有殺棋。',
  'Rejected: too short.': '拒絕：太短。',
  'Rejected: two winning answers.': '拒絕：兩個都能贏的答案。',
  Solver: '解題方',
  Defence: '防守方',
  // -- The xiangqi match-fixing case --
  // champion pages. Player names stay in SIMPLIFIED for the Traditional reader:
  'The Xiangqi Match-Fixing Case': '象棋假棋案',
  'Xiangqi Match-Fixing: 录音门, the Bans, and the Convictions': '象棋假棋案：錄音門、禁賽與判決',
  'Between 2024 and 2026 the Chinese Xiangqi Association sanctioned 49 people for buying and selling games, and a Hangzhou court convicted six grandmasters of bribery. What happened, why it paid, who ruled, and what is still unproven.':
    '2024到2026年間，中國象棋協會因買棋賣棋處罰了49人，杭州一家法院以行賄受賄判決六名特級大師有罪。事情經過、為何有利可圖、誰作出認定，以及哪些至今未獲證實。',
  'Ten of the thirteen men who have won the Chinese national xiangqi championship since 2005 carry a published ruling against them, including every winner from 2010 to 2023. The man who was China’s top-rated player from 2014 to 2023 was banned for life and then convicted in court. This is how that happened, and what it does and does not establish.':
    '2005年以來奪得全國象棋個人賽冠軍的十三人中，有十人已被公開處罰，其中包括2010到2023年間的每一位冠軍。2014到2023年間等級分居全國第一的棋手先被終身禁賽，隨後被法院判決有罪。以下是事情的經過，以及哪些已被認定、哪些沒有。',
  'It is assembled from Chinese-language reporting, which carries far more of it than the English coverage does. Where something is alleged rather than found, or charged rather than decided, this page says so.':
    '本頁取材於中文報道，中文報道所載遠比英文詳盡。凡屬指稱而非認定、屬指控而非判決者，本頁都會寫明。',
  'Players paid each other to lose': '棋手互相出錢買輸贏',
  'The January 2025 and April 2026 rulings use the same formula: those sanctioned took part in 买棋 and 卖棋, buying and selling games, by way of 行贿 and 受贿, giving and taking bribes. The first notice, in September 2024, says only 买棋卖棋 and 操纵比赛, manipulating competition. Money moved from player to player, in cash, sometimes through intermediaries.':
    '2025年1月和2026年4月的兩份處罰用的是同一套措辭：受罰者以行賄、受賄等方式，不同程度參與買棋、賣棋。2024年9月的第一份通報只寫買棋賣棋和操縱比賽。錢在棋手之間流動，多為現金，有時經中間人轉手。',
  'It was not a gambling case, though English write-ups often reach for the word. The charges are offering and accepting bribes as a non-state functionary, and no ruling or indictment describes betting.':
    '這不是賭博案，儘管英文報道常用這個詞。指控的罪名是對非國家工作人員行賄罪和非國家工作人員受賄罪，沒有任何處罰或起訴書提到下注。',
  'Why buying a game paid for itself': '買一盤棋為什麼划算',
  'Rating points were not just a ranking. Under the system in force at the time they fed appearance and per-game fees, which made them the number a professional was paid on. That produced an asymmetry: a top-rated player gained almost nothing from beating a weaker one and lost a great deal from slipping, while the weaker player earned so little that a fee for losing beat the result. On CCTV, the player Cai Yi 才溢 illustrated the gap as perhaps ¥20,000 a game for a marquee name in a sponsored team event against ¥4,000 for an ordinary master. That rating system was abolished on 30 January 2026 and replaced with a rolling 52-week ranking.':
    '等級分不只是排名。在當時施行的制度下，它關係到出場費與對局費，也就成了職業棋手實際拿錢的依據。這帶來一種不對稱：等級分高的棋手贏下低分對手幾乎沒有收益，掉分卻損失慘重；低分棋手所得本就微薄，輸棋換來的報酬反而勝過戰績本身。棋手才溢在央視節目中舉例說，有贊助的團體賽裡，名將一盤或可得兩萬元，普通大師約四千元。該等級分制度已於2026年1月30日廢止，改為按52週滾動計算的排名。',
  'The sport administration’s chess and card centre gave three motives in all: promotion through the grade titles, private division of prize money, and inflating the rating itself. Results were arranged to hit the norms for 特级大师, grandmaster, with players negotiating prices across a national individual championship, and in team events the same trade bought qualification as 运动健将, Master of Sport, which the coverage calls 搭便车, free-riding.':
    '國家體育總局棋牌運動管理中心共列出三項動機：晉升技術等級稱號、私分獎金，以及提升等級分本身。為達到特級大師的標準，棋手在全國個人賽期間與多名對手談價錢安排結果；在團體賽中，同樣的交易被用來換取運動健將資格，報道稱之為搭便車。',
  'Which is why paying to win a game you would probably have won anyway is not irrational. You are not buying the point. You are buying the rating that sets next season’s fee and the title that outlasts any single event, and against those, tens of thousands of yuan for one game is cheap.':
    '所以，為一盤本來多半也能贏下的棋付錢，並非不理智。買的不是這一分，而是決定下個賽季酬勞的等級分，以及比任何一屆賽事都長久的稱號。相較之下，一盤棋幾萬元並不算貴。',
  'A recording, and a whistleblower nobody could dismiss': '一段錄音，和一位無法被忽視的舉報人',
  'In April 2023 recordings of phone calls between two grandmasters, Hao Jichao 郝继超 and Wang Yuefei 王跃飞, appeared online. On them the two discuss buying and selling games, engine cheating, and manipulating rating points. Wang Tianyi is named on the tapes but was not on the calls. The Chinese press named the affair after them: 录音门, the recording gate.':
    '2023年4月，兩名特級大師郝继超與王跃飞的通話錄音在網上流出。錄音中兩人談及買棋賣棋、軟件作弊與操縱等級分。王天一在錄音裡被提到，但並非通話當事人。中文媒體因此把這起事件稱為錄音門。',
  'Liu Dahua 柳大华, then 73 and the holder of a one-against-nineteen blindfold record, had been saying for years that opponents’ moves were 相当的精准，和软件一模一样, uncannily precise, identical to the software. On 17 October 2023 he and Dang Fei 党斐 made a 实名举报, a real-name accusation, against Guo Liping 郭莉萍, a deputy director at the sport administration’s chess and card centre. That turned a leaked tape into a governance scandal. Liu was attacked online for it and brought two private criminal prosecutions, one for criminal insult and one for defamation, winning both. Dang Fei is on the list below, at three years.':
    '柳大华當時73歲，保持著一對十九的盲棋紀錄。多年來他一直說，對手的著法相當的精準，和軟件一模一樣。2023年10月17日，他與党斐實名舉報國家體育總局棋牌運動管理中心副主任郭莉萍。一段外流錄音由此變成了治理層面的風波。柳大华為此在網上遭到攻擊，他提起兩起刑事自訴，一起以侮辱罪、一起以誹謗罪，均獲勝訴。党斐本人也在下面的名單裡，被禁賽三年。',
  'How the recordings reached the internet is reported by one outlet and confirmed by none: that Hao Jichao made them himself, gave them to Hong Zhi 洪智 after a suspension he considered unjust, and that Hong passed them on. Hong Zhi was himself convicted in 2025 and banned for life the following April.':
    '錄音如何流到網上，只有一家媒體報道過，無人證實：郝继超自己錄下這些通話，在一次他認為不公的停賽處理之後交給洪智，再由洪智轉出。洪智本人於2025年被判決有罪，次年4月被終身禁賽。',
  Date: '日期',
  'What happened': '事件',
  'The spine of the case. Liu Dahua’s earlier private complaints are his own account rather than a documented date.':
    '本案的主線。柳大华更早的私下反映出自他本人的說法，並無確切日期可考。',
  'Two processes, one case': '兩條並行的程序，同一起案件',
  'The disciplinary track and the criminal track are separate. They ran on different timetables, and the six convicted are six of the forty-nine banned rather than a different group.':
    '紀律處理與刑事追訴是兩條獨立的程序，時間表也不相同。被判刑的六人正是被處罰的四十九人中的六位，並非另一批人。',
  'A third track went nowhere in public. Three officials left the chess and card centre while the case ran: its director Zhu Guoping 朱国平 and its discipline secretary Guo Yujun 郭玉军 in November 2024, and Guo Liping in December. No removal notice mentions this case, and no official has been reported as charged or sanctioned in connection with it.':
    '第三條線在公開層面沒有下文。案件進行期間，棋牌運動管理中心有三名官員去職：主任朱国平與紀檢書記郭玉军於2024年11月，郭莉萍於同年12月。沒有一份免職通知提到本案，也沒有任何官員被報道因此被追究或處罰。',
  'The Chinese Xiangqi Association has sanctioned 49 people in three batches: two in September 2024, forty-one in January 2025, and six in April 2026. That is 8 lifetime bans, 37 timed bans and 4 public reprimands. Revocation of the technical grade title accompanies 19 of the 45 bans rather than all of them. Only the three timed bans in the April 2026 notice carry published start and end dates, all running from 24 July 2024; the January notice publishes no dates at all, so when most of those bans expire is not a matter of public record.':
    '中國象棋協會分三批處罰了49人：2024年9月兩人，2025年1月四十一人，2026年4月六人。其中終身禁賽8人、限期禁賽37人、通報批評4人。45項禁賽中有19項同時撤銷技術等級稱號，並非全部。只有2026年4月通報裡的三項限期禁賽公布了起止日期，均自2024年7月24日起算；1月的通報完全沒有公布日期，因此其中多數禁賽何時期滿並無公開記錄。',
  'The association published almost every name. Where a player also appears on the champion lists, his national title years are in the last column.':
    '協會公布了幾乎每一個名字。若該棋手同時出現在冠軍名單上，其全國冠軍年份列在最後一欄。',
  Player: '棋手',
  Penalty: '處罰',
  'National title': '全國冠軍',
  'The 47 the association named. The other two were withheld because they were under 18 when the conduct occurred. Revocation of the technical grade title accompanies 19 of the 45 bans, not all of them.':
    '協會具名公布的47人。另外兩人因涉案時未滿18周歲而未公布姓名。45項禁賽中有19項同時撤銷技術等級稱號，並非全部。',
  'Hao Jichao, whose recordings started the case, is in the four-year-three-month tier, and was never criminally charged: the sporting penalty is the only one he carries. Xu Chongfeng’s two-year ban ran out on 23 July 2026, and the shorter bans from the January batch will have ended before it.':
    '錄音出自郝继超之手，他被禁賽四年三個月，且從未被刑事追訴，所受的只有體育處罰。徐崇峰的兩年禁賽已於2026年7月23日期滿，而1月那批中更短的禁賽應當更早結束。',
  'Separately, the Shangcheng District People’s Court in Hangzhou convicted six grandmasters on 24 September 2025 of offering and accepting bribes as non-state functionaries, under Articles 163 and 164 of the criminal law. The Chinese press calls it the sport’s first criminal corruption case.':
    '另一條線上，杭州市上城區人民法院於2025年9月24日以對非國家工作人員行賄罪、非國家工作人員受賄罪判決六名特級大師有罪，依據刑法第163條與第164條。中文媒體稱之為中國象棋反腐第一案。',
  Convicted: '被判刑者',
  Sentence: '刑期',
  'Reported from the 24 September 2025 verdict. No judgment text was released: these figures trace to the prosecution’s case, and only Hong Zhi’s was separately reported as a court outcome. Fines were imposed on Wang Tianyi and Zhao Xinxin; no amounts have ever been published.':
    '據2025年9月24日宣判的報道整理。判決書未公開：這些數字源自檢方的指控，其中只有洪智一項另有作為法院結果的報道。王天一與赵鑫鑫另被併處罰金，金額從未公布。',
  'The strongest player in the world was buying': '最強的棋手是買家',
  'Wang Tianyi was China’s top-rated player from 2014 to 2023, known simply as 象棋第一人, the number one. The prosecution charged 22 separate acts of giving bribes totalling ¥942,000, against 2 acts of taking them totalling ¥116,000. Nineteen of the 22 payments ran through Wang Yuefei.':
    '王天一在2014到2023年間等級分居全國第一，被稱為象棋第一人。檢方指控他行賄22筆、合計94.2萬元，受賄2筆、合計11.6萬元。22筆中有19筆經由王跃飞。',
  'Eight yuan paid for every one received. He was not a weak player selling games he would have lost: he was the best player in the world, buying them. He pleaded guilty, was banned for life a year before the verdict, and apologised publicly in October 2025.':
    '每收一元，付出八元。他不是賣掉本就要輸的棋的弱手，而是最強的棋手在買棋。他當庭認罪認罰，在宣判前一年已被終身禁賽，並於2025年10月公開致歉。',
  'Hong Zhi was the only one of the six who contested the charge. His appeal was rejected on 10 February 2026, and because he was taken into custody on sentencing day, roughly a year after Wang Tianyi, he will be released considerably later despite the shorter term.':
    '六人中只有洪智不認罪。他的上訴於2026年2月10日被駁回；由於他在宣判當日才被收押，比王天一晚約一年，儘管刑期較短，出獄時間反而晚得多。',
  'The cheating nobody charged': '無人指控的作弊',
  'Engine cheating runs through every account of this affair and appears in no ruling. It is the substance of the recordings, of Liu Dahua’s accusation, and of the press investigations, while the findings cite only bribery and the buying and selling of games. Nothing published resolves it either way.':
    '軟件作弊貫穿這起事件的每一種敘述，卻不見於任何處罰。它是錄音的內容，是柳大华舉報的內容，也是媒體調查的內容；而官方認定只提行賄受賄與買棋賣棋。已公開的材料無法證實，也無法證偽。',
  'What exists is testimony. Liu Dahua says that at a league match in Ordos in October 2018 he was standing beside Hao Jichao’s game against a teammate of his own when he twice heard a voice call a move, 卒5平4, pawn five to the fourth file, and that Hao then played it. He suspected smartwatches as the capture device, and says that at an earlier fixture where watches were collected before play, Hao lost two games. This is his account, and no finding confirms any of it.':
    '現有的只是證言。柳大华說，2018年10月鄂爾多斯的一場聯賽中，他站在郝继超對陣自己隊友的棋邊，兩次聽到有人報出卒5平4，隨後郝继超便走了這步棋。他懷疑智能手錶被用作採集工具，並說在更早一場賽前收走手錶的比賽中，郝继超輸了兩盤。這是他本人的說法，沒有任何認定加以證實。',
  'Xu Yinchuan, who won six national titles and three world titles and is named in none of the three notices, is quoted as saying 有了软件以后，就感觉自己的棋跟软件比就根本没法下, that once the software existed his own play felt unplayable measured against it. He is describing what engines did to a professional’s confidence in preparation rather than accusing anyone, which is worth keeping distinct.':
    '六獲全國冠軍、三奪世界冠軍的许银川，未出現在三份通報中的任何一份裡。據引述，他說有了軟件以後，就感覺自己的棋跟軟件比就根本沒法下。他講的是引擎對一名職業棋手備戰時信心的衝擊，而不是在指控誰，這兩件事應當分開。',
  'Tao Hanming, the 1994 champion, spoke out against software cheating in January 2016 and retracted the next day, saying he had spoken out of turn after drinking. A friend later told Jiemian the drink was cover for pressure. Which version to believe is the kind of thing a disciplinary finding settles, and none did.':
    '1994年的冠軍陶汉明在2016年1月公開抨擊軟件作弊，次日又收回，稱自己酒後失言。後來一位友人對界面新聞表示，酒是壓力之下的託詞。該信哪一種說法，本該由紀律認定來解決，而始終沒有。',
  'No result has been struck from the record': '沒有一項成績被從記錄中抹去',
  'No ruling says which individual games were bought. What was revoked is the personal technical grade, the 特级大师 or 大师 rank, which is a title conferred on a player rather than a tournament result. No championship or team title appears to have been annulled, and the champion lists on this site are unchanged. Ratings are a special case: none were struck, but the whole rating system was abolished on 30 January 2026 and replaced.':
    '沒有任何處罰指明具體哪一盤棋被買。被撤銷的是個人的技術等級稱號，即特級大師或大師，那是授予棋手個人的頭銜，而非賽事成績。看不到任何冠軍或團體名次被取消，本站的冠軍名單也未作改動。等級分是個特例：並無個別分數被抹去，但整套等級分制度已於2026年1月30日廢止並被取代。',
  'So the names stay on those pages with the finding beside them. Dropping them would assert something the rulings do not: that the games themselves were not real.':
    '因此這些名字仍留在那些頁面上，旁邊附著相應的認定。刪掉他們，等於斷言處罰並未認定的事：那些對局本身是假的。',
  'Where the sport is now': '這項運動如今的處境',
  'The league came back. The 2025 national men’s league ran its preliminary from 30 July 2025 and opened the main stage in Harbin on 3 August, with revised eligibility rules and a reformed format: 25 teams, ten advancing to a double round-robin, four boards played in two waves of two, and a blitz tiebreak deciding drawn matches. Whether the format was designed against collusion is not stated anywhere official, but a match that cannot end level is harder to arrange.':
    '聯賽回來了。2025年全國象棋男子甲級聯賽自2025年7月30日起進行預賽，8月3日在哈爾濱開始正賽，參賽資格經過修訂，賽制也作了改革：25支隊伍，十支晉級雙循環，四台棋分兩輪各兩台進行，平局由超快棋決勝。這一賽制是否為防串通而設，官方並無說明；但一場不可能打平的比賽，確實更難安排。',
  'Thirty-seven of the bans expire. Eight do not. The 2025 national championship was won by Wang Yubo 王禹博, the first title since Xu Yinchuan’s in 2009 that comes with no asterisk on it, and the 2025 world title left China for the first time.':
    '三十七項禁賽有期滿之日，八項沒有。2025年全國個人賽冠軍是王禹博，這是自2009年许银川之後第一個無需加註的冠軍；同年的世界冠軍也首次離開中國。',
  'Every national champion since 1956': '1956年以來的每一位全國冠軍',
  'Every world champion since 1990': '1990年以來的每一位世界冠軍',
  'All of it is Chinese-language reporting, listed so a reader who reads Chinese can check it rather than take our word for it.':
    '全部取自中文報道，在此列出，以便讀得懂中文的讀者自行核對，而不必只聽我們的說法。',
  Source: '來源',
  'What it carries': '所載內容',
  'Several claims here rest on thinner ground than the rest, and the text says so where they appear: five of the six sentences trace to the prosecution rather than a released judgment, all of Liu Dahua’s testimony and the Xu Yinchuan quotation are single-sourced accounts, the route the recordings took to the internet is one outlet’s investigation, the officials’ departures are not officially tied to this case, and the absence of any annulled result is inferred from silence rather than stated in a ruling.':
    '本頁有幾處依據較薄，正文中已在相應位置註明：六項刑期中有五項源自檢方而非已公開的判決書；柳大华的全部證言與许银川那句引述均為單一來源；錄音流入網絡的經過出自一家媒體的調查；官員去職並未被官方與本案相聯繫；而沒有成績被取消這一點，是從無人提及推出的，並非哪份處罰寫明。',
  // -- Titled players (recruitment page) --
  // MACHINE-DRAFTED 2026-08-27, NOT NATIVE-REVIEWED. See the Simplified block.
  // Taiwan lexical forks applied, not a glyph conversion: 影片庫 not 视频库,
  // 直播主 not 主播, 連結 not 链接, 聯絡 not 联系.
  'Bring your title to Mistboard': '把你的頭銜帶到 Mistboard',
  'For titled xiangqi and chess players': '致象棋與國際象棋的頭銜棋手',
  'Verified titled players get a gold badge beside their name, a coaching page students can find, and a front page that will carry their work. Verification takes about two minutes.':
    '通過認證的頭銜棋手，名字旁會顯示金色徽章，可以開設讓學員找得到的教練主頁，作品也有機會登上首頁。認證大約只需兩分鐘。',
  'Verified titled players get a gold badge beside their name, a coaching page students can find, and a front page that will carry their work. Verification takes about two minutes: start at [mistboard.com/verify-title](/verify-title).':
    '通過認證的頭銜棋手，名字旁會顯示金色徽章，可以開設讓學員找得到的教練主頁，作品也有機會登上首頁。認證大約只需兩分鐘：請前往 [mistboard.com/verify-title](/verify-title)。',
  'Mistboard accepts WXF and CXA titles (XGM, XIM, XNM, XWGM, XWIM) and FIDE titles (GM, IM, FM, CM, WGM, WIM, WFM, WCM). Link your federation profile, give your real name, note the results behind the claim, and an admin reviews it personally.':
    'Mistboard 接受世界象棋聯合會（WXF）與中國象棋協會（CXA）的頭銜（XGM、XIM、XNM、XWGM、XWIM），以及國際棋聯（FIDE）的頭銜（GM、IM、FM、CM、WGM、WIM、WFM、WCM）。請附上你的協會個人頁面連結、寫明真實姓名，並說明支持該頭銜的成績，每份申請都由管理員親自審核。',
  'What you get': '你能獲得什麼',
  '**The badge.** Gold, beside your name, everywhere you appear: games, profile, ladders, forum, studies. Every player who sees you play sees the title first.':
    '**頭銜徽章。** 金色，就在你的名字旁邊，出現在你所到之處：對局、資料頁、排行榜、論壇、研習。每一個看你下棋的人，都會先看到你的頭銜。',
  '**Your own coaching page.** Publish at [/coach](/coach) with your headline, languages, rate, and contact details. Students reach you directly and pay you directly. Mistboard takes nothing: no commission, no processing fees, no cut of your lesson.':
    '**屬於你的教練主頁。** 在 [/coach](/coach) 發布你的簡介、授課語言、收費與聯絡方式。學員直接聯絡你，也直接付款給你。Mistboard 分文不取：沒有佣金，沒有手續費，不從你的課時費裡抽走一分錢。',
  '**The front page.** Write an annotated study and it can lead the homepage under your name. Your analysis is what players come here to read, and there is no queue in front of you.':
    '**首頁版位。** 寫一份講解研習，它就有機會以你的名義登上首頁。棋手來這裡就是為了讀你的分析，而且你前面沒有人排隊。',
  '**The video library.** If you make xiangqi videos, [/videos](/videos) will carry them and send viewers your way.':
    '**影片庫。** 如果你製作象棋影片，[/videos](/videos) 會收錄它們，並把觀眾帶向你。',
  '**A place in the streamer directory.** Stream here and get listed.':
    '**直播主目錄中的一席。** 在這裡直播，就會被收錄。',
  '**Your own byline.** Send something longer and it gets edited and published under your name, with your title beside it.':
    '**署名文章。** 寫一篇長一點的稿子寄來，我們會編輯後以你的名義發表，並在名字旁標上你的頭銜。',
  'Why Mistboard': '為什麼選擇 Mistboard',
  'Mistboard is where xiangqi is played in English. Free, open source, no ads, no paywall, no premium tier. Every board, every puzzle, every lesson is open to everyone who shows up.':
    'Mistboard 是用英語下象棋的地方。免費、開源，沒有廣告，沒有付費牆，也沒有會員等級。每一副棋盤、每一道題目、每一節課，對每一個來到這裡的人都開放。',
  'That audience has never had a serious English-language home, and it has never had titled players to learn from. You would be among the first, on a site built to put your name in front of them rather than bury it.':
    '這批棋迷從來沒有一個像樣的英語大本營，也從來沒有頭銜棋手可以請教。你會是最早的一批，而這個網站從一開始就是為了把你的名字擺到他們面前，而不是埋起來。',
  'Verify your title': '認證你的頭銜',
  'Ask me something first': '有問題先問我',
  // -- Fortress Xiangqi --
  'Fortress Xiangqi Rules': '堡壘象棋規則',
  'Shigenobu Kusumoto, working in Osaka, invented [Mini Xiangqi](/rules/mini-xiangqi) in 1973. A Japanese designer took a Chinese game and built it a smaller board, the same move he made for his own country’s game with minishogi. Fortress Xiangqi runs that trade in the other direction. Shogi has had drops for centuries and xiangqi never has, so this is what xiangqi looks like when it borrows them.':
    '楠本茂信在大阪發明了[小象棋](/rules/mini-xiangqi)，時間是 1973 年。一位日本設計者拿起一款中國棋，為它造了一張更小的棋盤，正如他為本國的將棋做過五五將棋。堡壘象棋把這趟交流反向跑了一遍。將棋有打入已有數百年，象棋從來沒有，這就是象棋借來打入之後的樣子。',
  'A compact Xiangqi variant with captured pieces in reserve, piece drops, and one new piece: the Treasure.':
    '一種緊湊的象棋變體，帶有持子、打入，以及一個新棋子「寶」。',
  'Fortress Xiangqi is a compact [Xiangqi](/rules/xiangqi) variant designed by Brian H. Liou in 2026 as a Mistboard original. It keeps the familiar pieces, adds one new piece called the Treasure, and gives each player an open reserve. Capture an enemy piece and you can later drop it back as your own.':
    '堡壘象棋是 Brian H. Liou 於 2026 年為 Mistboard 原創設計的緊湊型[象棋](/rules/xiangqi)變體。它保留熟悉的棋子，加入一個名為「寶」的新棋子，並讓雙方擁有公開持子。吃掉敵子後，可以在之後將它作為己方棋子打回棋盤。',
  'Captured material stays in the game, so every exchange changes both the board and the reserves. A defensive trade now may supply the attacker you need later.':
    '被吃的子仍留在對局中，因此每次兌子都會同時改變盤面和持子。現在用於防守的兌子，之後可能提供進攻所需的棋子。',
  'The board is 7 files (a to g) by 8 ranks, with a river between ranks 4 and 5. Each side has a 3 by 3 palace, but the two palaces sit in opposite corners: Red holds the bottom left (a1 to c3) and Black holds the top right (e6 to g8). The whole setup has 180 degree rotational symmetry.':
    '棋盤為 7 路（a 至 g）、8 橫線，河界位於第 4 與第 5 橫線之間。雙方各有一個 3×3 九宮，但兩個九宮分處對角：紅方占左下角（a1 至 c3），黑方占右上角（e6 至 g8）。整個布局具有 180 度旋轉對稱性。',
  'The starting position. Red holds the bottom-left palace, Black the top-right, and the Treasure starts on each palace corner.':
    '初始局面。紅方占左下九宮，黑方占右上九宮，雙方的「寶」都從各自九宮的角上出發。',
  'Red moves first. This is open information: both players see the whole board and both reserves.':
    '紅方先行。這是完全資訊遊戲：雙方都能看到整個棋盤和雙方的持子。',
  'The Chariot, Cannon, Horse, Elephant, Advisor, and General move as they do in [xiangqi](/rules/xiangqi). The Soldier is the one standard piece with a changed move, and the Treasure is new. In the diagrams below, a green dot marks a quiet destination, a green ring marks a capture, and a red cross marks a point the piece cannot reach.':
    '車、砲、馬、象、士和將帥都按[象棋](/rules/xiangqi)規則移動。兵是唯一走法有變化的標準棋子，寶則是新棋子。在下圖中，綠點表示不吃子的落點，綠圈表示吃子，紅叉表示該棋子無法到達的點。',
  '**Chariot:** slides any distance orthogonally, the strongest piece on the board. Here it can take the soldier on d7.':
    '**車：**沿橫線或直線移動任意距離，是棋盤上最強的棋子。此處它可以吃掉 d7 的兵。',
  '**Cannon:** moves like the Chariot on open lines, but captures only by jumping exactly one screen piece, friend or enemy. On the right, the cannon on d2 takes the chariot on d7 over its own soldier screen.':
    '**炮：**在空線上走法與車相同，但吃子時必須恰好跳過一個炮架，不論敵我。右圖中，d2 的炮隔著己方兵作炮架，吃掉 d7 的車。',
  '**Horse:** steps one point orthogonally, then one point diagonally outward. If the orthogonal step is occupied, that whole direction is blocked. On the right, the soldier on d5 takes away both forward destinations.':
    '**馬：**先沿橫向或縱向走一步，再向外斜走一步。如果第一步的位置被占據，該方向就會蹩馬腿。右圖中，d5 的兵封住了馬向前的兩個落點。',
  '**Elephant:** moves exactly two points diagonally, is blocked by an occupied midpoint (the elephant eye), and can never cross the river.':
    '**象：**沿對角線恰好走兩點，中點（象眼）有子時會被塞象眼，而且永遠不能過河。',
  '**Advisor:** moves one point diagonally and stays inside the palace.':
    '**士：**沿對角線走一點，並且始終留在九宮內。',
  '**General:** moves one point orthogonally and stays inside the palace. One xiangqi rule retires itself here: because the palaces sit in opposite corners, the two generals never share a file, so the facing-generals rule never comes into play.':
    '**將帥：**沿橫向或縱向走一點，並且始終留在九宮內。有一條象棋規則在這裡自然失效：兩個九宮位於對角，兩位將帥永遠不會處於同一路，因此不會出現將帥照面的情況。',
  '**Soldier:** moves one point forward, never backward. Once it crosses the river it may also step one point sideways, exactly as in xiangqi. The Treasure is the other piece the river holds back: it never crosses at all.':
    '**兵：**每次向前走一點，不能後退。過河之後還可以橫走一點，與象棋完全相同。寶是另一個被河界擋住的棋子：它永遠不能過河。',
  '**Treasure:** the one new piece. It steps one point in any of the eight directions and never promotes. It roams its own half freely, but it never crosses the river, moving or dropping. It is the piece you are storming for, and it stays in the fortress.':
    '**寶：**唯一的新棋子。它向八個方向各走一點，不會升變。它可以在己方半場自由活動，但無論是走子還是打入，都永遠不能過河。它就是被圍攻的目標，始終留在城中。',
  'Left, the Treasure has all eight steps, including the capture on e4. Right, standing on the last rank of its own half, the three squares across the river are closed to it.':
    '左圖，寶有全部八種走法，包括吃 e4 的一步。右圖，它站在己方半場最後一線，河對岸的三個點對它是封閉的。',
  'There are no promotions. The river matters three ways: the Soldier gains its sideways step by crossing it, and neither the Elephant nor the Treasure may cross it at all.':
    '沒有升變。河界有三重意義：兵過河後獲得橫走，而象和寶都完全不能過河。',
  'Capture, hold, drop': '吃子、持子、打入',
  'When you capture any piece other than the General, it changes to your color and enters your reserve. Both reserves are open information, have no size limit, and keep pieces for as long as needed. On your turn, either move a piece on the board or drop one piece from your reserve onto an empty point. Generals are never captured or held in reserve.':
    '吃掉將帥以外的任何敵子後，它會變成你的顏色並進入持子。雙方持子都是公開資訊，沒有數量上限，也可保留任意久。輪到你時，可以移動盤面棋子，也可以把一枚持子打入空點。將帥不會被吃，也不會進入持子。',
  'Chariots, Horses, Cannons, and Soldiers may drop on any empty point. Advisors, Elephants, and Treasures keep their normal territory restrictions.':
    '車、馬、炮和兵可以打入任何空點。士、象和寶仍須遵守各自通常的區域限制。',
  'Where a captured piece may land. The Chariot, Horse, Cannon and Soldier drop on any empty point; the Elephant and the Treasure are held to your own half, and the Advisor to your own palace.':
    '被吃的棋子可以落在哪裡。車、馬、炮和兵可以打入任何空點；象和寶只能留在己方半場，士只能留在己方九宮。',
  'A dropped piece is live immediately. A drop may give check or deliver checkmate, and a Soldier dropped past the river arrives with its sideways step already earned. The one limit is the usual one: no move, drop included, may leave your own general in check.':
    '打入的棋子立即生效。打入可以將軍或將死，打入到河對岸的兵一落子就已經具備橫走。唯一限制與平常相同：任何著法，包括打入，都不能讓己方將帥處於被將軍狀態。',
  'How games end': '對局如何結束',
  'Checkmate wins. A player with no legal move also loses, even when not in check. There is no fifty-move or no-progress draw.':
    '將死獲勝。即使沒有被將軍，一方若無合法著法也判負。這裡沒有五十回合規則或無進展和棋。',
  'On the third occurrence of the same position, a player who gave check on every one of their moves in the repeating cycle loses. If neither player was the sole perpetual checker, the repetition is drawn.':
    '同一局面第三次出現時，若一方在重複循環中的每一步都將軍，該方判負。若雙方都不是唯一的長將方，則重複局面判和。',
  'Games can also end by timeout, resignation, or abandonment.':
    '對局也可能因超時、認輸或棄局而結束。',
  'This engine game shows both new rules at work. Three soldiers cross the river and gain their sideways step, and on move 23 Red drops its captured Treasure on d1, back inside its own half, because that is the only half it may enter.':
    '這盤引擎對局同時展示了兩條新規則。三個兵過河並獲得橫走，第 23 回合紅方把吃到的寶打回 d1，落在己方半場，因為那是它唯一能進入的一半。',
  'This game was chosen from twenty engine games played the same way. All twenty are in the [companion study](/study/NUVBVjFf), one chapter each, with a note on where the engine’s evaluation says the game turned.':
    '這盤棋選自二十盤以同樣方式生成的引擎對局。二十盤全部收錄在[配套研究](/study/NUVBVjFf)裡，每盤一章，並註明引擎評估認為局勢發生轉折的時刻。',

  // -- How Misty Plays --
  'Misty is the bot you play on Mistboard in Fog of War chess. It is not allowed to peek. The server sends it the same kind of limited view a human player gets, then Misty has to choose a move from that uncertainty.':
    'Misty 是你在 Mistboard 迷霧國際象棋中對弈的機器人。它不允許偷看。伺服器只會向它傳送與人類玩家同類的受限視野，然後 Misty 必須在這種不確定性中選擇著法。',
  'It plays under the same fog you do': '它和你在同一片迷霧下對弈',
  'Misty never sees the canonical board. Each move, it gets only what the side to move can legally observe under Fog of War: its own pieces, the squares they see, and the captures in view. Everything else is hidden. It plays under the same rules you do, and you can verify that: Mistboard is open source, so anyone can audit the server code that enforces the fog before the engine sees a position.':
    'Misty 永遠看不到規範真實棋盤。每一步，它只會得到輪到走棋的一方在迷霧國際象棋規則下可以合法觀察的內容：自己的棋子、這些棋子能看見的格子，以及視野內發生的吃子。其餘一切都被隱藏。它與你遵守相同規則，而且這一點可以驗證：Mistboard 是開源的，任何人都能稽核在引擎看到局面之前執行迷霧規則的伺服器程式碼。',
  'A classical chess engine like Stockfish has one advantage: it can see the whole board. It picks its move by searching the game tree, looking ahead through the lines both sides could play and backing up the best line (minimax). The search assumes a single true position and a single true continuation.':
    'Stockfish 這樣的經典國際象棋引擎有一個優勢：它能看到整個棋盤。它透過搜尋博弈樹來選擇著法，向前推演雙方可能走出的變化，再回傳最佳變化的價值（極小化極大演算法）。這種搜尋假設只有一個真實局面和一條真實的延續。',
  "Under fog there is no single position to search. Misty can't see the opponent's pieces, so the board it has to reason about is a belief set: many legal boards consistent with what it has observed. A move that wins on one board can hang the king on another. Misty samples from that set, searches those worlds, and looks for a move that holds up across them.":
    '迷霧下不存在一個可供搜尋的單一局面。Misty 看不到對手的棋子，因此它必須推理的是一個信念集合：許多與已觀察資訊一致的合法棋盤。同一步棋可能在一個棋盤上獲勝，卻在另一個棋盤上白送國王。Misty 從集合中取樣，搜尋這些可能世界，並尋找在它們之中都站得住腳的著法。',
  'Sampling boards and searching them is the straightforward part. Combining the answers is where fog chess stops behaving like chess, and Misty borrows its method from poker: it minimizes regret across the sampled worlds, converging toward a strategy an opponent cannot exploit, instead of taking the move with the best average score. Obscuro, the strongest published Fog of War chess engine, works the same way. The hard part is keeping that model faithful to what has actually been observed while the clock is running.':
    '取樣棋盤並搜尋它們是相對直接的部分。真正讓迷霧國際象棋不再像國際象棋的，是如何彙總這些答案；Misty 的方法借自撲克：它在取樣出的各個可能世界上最小化遺憾值，逐步收斂到一個對手無法利用的策略，而不是選擇平均分最高的著法。公開發表的最強迷霧國際象棋引擎 Obscuro 採用同樣的思路。難點在於，在時鐘不停走動時，讓這個模型始終忠於已經觀察到的資訊。',
  "What's hard": '難點在哪裡',
  'Two things. The first is the possible-board set itself. A few plies into a foggy middlegame, "every consistent board" blows up fast. Misty has to keep that uncertainty under control inside a live-game time budget.':
    '有兩個難點。第一個就是可能棋盤的集合本身。迷霧中局只走幾個回合步後，「所有一致的棋盤」數量就會迅速爆炸。Misty 必須在即時對局的時間預算內控制這種不確定性。',
  'The second is picking a move over that set. Scoring one move means weighing it across thousands of possible boards at once, and the obvious way to do that, averaging the outcomes, quietly buries disasters. A move that loses the king on a small slice of boards may barely move the average, but it still loses those games outright. Reasoning well over a distribution of boards, rather than a single board, is most of what the engine does.':
    '第二個難點是在這個集合上選擇著法。為一步棋評分，意味著同時衡量它在數千個可能棋盤上的表現；最直觀的辦法是取結果平均值，卻會悄悄掩埋災難。如果一步棋只在少部分棋盤上丟王，平均分可能幾乎不變，但那些對局仍會直接輸掉。引擎的大部分工作，就是針對棋盤分布而非單一棋盤進行可靠推理。',
  'What changed in the current release': '目前版本有哪些變化',
  'The current production engine is Misty 1.6. Most of the work since the first public release has been hardening, not a new personality: avoid rare king walks into hidden captures, avoid major-piece hangs in fog, stop stale search memory from leaking into a new live position, see fog-castles during search, and steer away from unstable early lines with a small opening book. Version 1.6 closes one specific queen hang. The safety check that vetoes catastrophic captures was subtracting the value of the piece being taken, so giving up a queen for a defended rook scored as a small loss rather than a disaster, and Misty walked into it in two real games before the floor that catches it shipped.':
    '目前正式環境的引擎是 Misty 1.6。首次公開發布後的大部分工作都在加固，而不是塑造新個性：避免國王偶爾走進隱藏吃子範圍，避免大子在迷霧中白送，阻止過期的搜尋記憶洩漏到新的即時局面，在搜尋中看見迷霧下的王車易位，並用小型開局庫避開不穩定的早期變化。1.6 版修正了一處特定的白送皇后問題：否決災難性吃子的安全檢查會先減去被吃棋子的價值，於是用皇后換一個有保護的車只被算作小虧而不是災難；在這道下限修好之前，Misty 在兩盤真實對局中都走進了這個陷阱。',
  'The engine is open source': '引擎已開源',
  "Misty's source is on GitHub under the GPL, and it installs from PyPI as misty-chess. What ships is the fog chess engine itself: the belief enumerator, the search, the guards that veto a catastrophic move at commit time, and the test suite that holds the Rust and Python implementations to byte-for-byte agreement at every ply. The variant siblings and the research lab stay private.":
    'Misty 的原始碼以 GPL 授權發布在 GitHub 上，也可以從 PyPI 安裝，套件名稱是 misty-chess。公開的部分就是迷霧國際象棋引擎本身：信念列舉器、搜尋、在提交著法時否決災難性選擇的守衛，以及要求 Rust 與 Python 兩套實作在每一步都逐位元組一致的測試套件。變體同系引擎與研究實驗程式碼仍然是私有的。',
  'Obscuro is not public. So as far as I can find, Misty is the only Fog of War chess engine built on that architecture that anyone else can run, read, or take apart, and that is most of the reason to publish it.':
    'Obscuro 並未公開。因此據我所知，Misty 是唯一一個基於該架構、並且其他人可以執行、閱讀和拆解的迷霧國際象棋引擎，這也是把它開源的主要理由。',
  'Misty on GitHub': 'GitHub 上的 Misty',
  'That does not make Misty solved or perfectly safe. It means the cheap fog-specific failures that made earlier versions look silly are much rarer, so games against it test your understanding instead of your patience.':
    '這並不意味著 Misty 已被徹底解決或絕對安全。它意味著那些讓早期版本顯得可笑的低級迷霧特有錯誤已經少見得多，因此與它對弈考驗的是你的理解，而不是耐心。',
  'Where it stands': '它目前處於什麼水準',
  "Misty is the strongest Fog of War chess engine I've seen available to play, but version numbers are not ratings. The yardstick that matters is human play, and I won't put a number on it until a serious human match earns one.":
    'Misty 是我見過可以直接對弈的最強迷霧國際象棋引擎，但版本號不是等級分。真正有意義的標尺是人類實戰；在一場嚴肅的人機比賽給出依據之前，我不會為它標上數字。',
  "What's next": '下一步是什麼',
  'Misty itself stays focused on Fog of War chess. The same redacted engine protocol now supports variant-specific siblings, including Misty DMX for Dark Mini Xiangqi and MistyBanqi for Banqi, but those are separate engines with their own rules and evaluation problems.':
    'Misty 本身會繼續專注於迷霧國際象棋。同一套去識別化引擎協定現在也支援針對特定變體的同系引擎，包括迷霧迷你象棋的 Misty DMX 和暗棋的 MistyBanqi，但它們是獨立引擎，各有自己的規則與評估問題。',
  "Misty is live on Mistboard, and every serious game against it sharpens the estimate of where it stands. Play one, and you're part of the benchmark.":
    'Misty 已在 Mistboard 上線，每一盤嚴肅的人機對局都會讓我們更準確地估計它的水準。來下一盤，你也會成為這項基準的一部分。',
  'All articles': '全部文章',
  'For engine builders': '致引擎開發者',
  "If you build Fog of War engines, I'd like to play yours against Misty. There's almost no public head-to-head data between engines for this variant, and engine-vs-engine games are the cleanest way to see where any of them stand. Get in touch and we'll set up a match.":
    '如果你在開發迷霧國際象棋引擎，我希望讓它與 Misty 對弈。這個變體幾乎沒有公開的引擎正面對戰資料，而引擎之間的比賽是判斷各自水準最清楚的方式。聯絡我們，我們可以安排一場比賽。',
  'Get in touch': '聯絡我們',
  References: '參考資料',
  '[Obscuro (Zhang & Sandholm, ICLR 2026)](https://arxiv.org/abs/2506.01242). The academic neighbor is Reconnaissance Blind Chess, whose engine lineage runs StrangeFish (CMU, 2018), ReBeL (FAIR, 2020), Penumbra (Georgia Tech), and Obscuro (CMU, 2026).':
    '[Obscuro（Zhang 與 Sandholm，ICLR 2026）](https://arxiv.org/abs/2506.01242)。與之相鄰的學術領域是偵察盲棋，其引擎譜系包括 StrangeFish（CMU，2018）、ReBeL（FAIR，2020）、Penumbra（Georgia Tech）和 Obscuro（CMU，2026）。',

  // -- Programming Fog Chess with Server-Side Truth --
  'Truth stays server-side': '真實局面留在伺服器端',
  'The triptych is the architecture in miniature. The center board exists only on the server. White and Black each receive a different projection, and neither projection contains the full truth with a visual layer hiding it.':
    '這組三聯棋盤就是整個架構的縮影。中央棋盤只存在於伺服器上。白方與黑方各自收到不同的投影檢視，任何一份投影都不是用視覺圖層遮住完整真實局面。',
  'The rule is simple: compute truth once, project the allowed view per seat, and keep the full event log private until the game is over.':
    '規則很簡單：只計算一次真實狀態，再為每個席位投影其獲准看到的檢視，並在對局結束前將完整事件紀錄保持私密。',
  'That single boundary supports live PvP, engine games, calibration, tournaments, and review. This article stays focused on the player-facing live room: what each browser receives, who can receive it, and when the record becomes public.':
    '這一條邊界同時支援即時玩家對戰、引擎對局、校準、賽事和複盤。本文聚焦面向玩家的即時房間：每個瀏覽器會收到什麼、誰可以接收，以及對局紀錄何時公開。',
  'How views are computed': '檢視如何計算',
  'For a player, the boundary is `PlayerView`: visible squares, visible pieces, legal moves, status, and clock for that seat. Opponent pieces outside the visibility set are not hidden fields. They are absent.':
    '對玩家而言，這條邊界就是 `PlayerView`：該席位可見的格子、可見棋子、合法著法、狀態和時鐘。可見範圍之外的對方棋子不是被藏在欄位裡，而是根本不存在於資料中。',
  'The important part is the direction of dependency. The client can render fog because it receives a visibility mask, but it cannot remove fog to recover pieces it was never sent.':
    '關鍵在於相依方向。用戶端因為收到可見性遮罩而能夠渲染迷霧，卻無法透過移除迷霧來恢復從未傳送給它的棋子。',
  'Sample data payload': '範例資料負載',
  'The live move stream uses `event-appended`, a per-move frame. This is the white payload from the position above, shortened to the fields that matter:':
    '即時走子串流使用 `event-appended`，每步傳送一個訊框。下面是上方局面中傳給白方的負載，已縮減為關鍵欄位：',
  '**Core fields:** `seat` identifies the recipient, `seq` orders the stream, `state.board` is the redacted board, `state.visibleSquares` is the clear-vs-fog mask, and `state.status` carries the canonical turn/result state.':
    '**核心欄位：**`seat` 標識接收者，`seq` 為資料流排序，`state.board` 是去識別化後的棋盤，`state.visibleSquares` 是清晰區域與迷霧區域的遮罩，`state.status` 攜帶規範的輪次與結果狀態。',
  'If the appended event is visible to this seat, the frame includes one filtered `event`. If the move is hidden, `event` is omitted and the projected `state` still advances. The player knows a turn happened, not what happened in the fog.':
    '如果新增事件對該席位可見，這個訊框會包含一個經過過濾的 `event`。如果走子被隱藏，`event` 會被省略，但投影後的 `state` 仍會推進。玩家知道一回合已經發生，卻不知道迷霧中發生了什麼。',
  'Snapshots still exist for first connect, explicit recovery, and final resync. They carry the filtered event history needed to hydrate the client, so they are larger than per-move frames.':
    '首次連線、明確復原和最終重新同步仍會使用快照。快照攜帶用戶端初始化所需的過濾事件歷程，因此比逐步訊框更大。',
  'Player move': '玩家走子',
  'A move request is just coordinates:': '走子請求只有座標：',
  'The server validates the request against canonical state, applies the move, appends an event, and projects the next view. The client never decides whether hidden information exists, whether an invisible move happened, or whether the game is over.':
    '伺服器根據規範狀態驗證請求，執行走子，附加事件，再投影下一份檢視。用戶端永遠不負責判斷是否存在隱藏資訊、是否發生了不可見走子，或對局是否結束。',
  'Seat-gated live rooms': '按席位控制的即時房間',
  'During a live game, the server sends game data only to the two seats. After each move, it projects one view for White and one view for Black, then sends each view only to a socket that has proven it controls that seat.':
    '即時對局期間，伺服器只向兩個對局席位傳送遊戲資料。每步之後，它分別為白方和黑方投影一份檢視，再將每份檢視只傳送給已經證明自己控制該席位的通訊端。',
  'Seat proof': '席位證明',
  'A socket gets live room data only after it proves control of the white or black seat. Anonymous seats use random bearer tokens; the server stores a SHA-256 token hash and compares the presented token in constant time.':
    '通訊端只有在證明自己控制白方或黑方席位後，才能取得即時房間資料。匿名席位使用隨機持有人權杖；伺服器保存 SHA-256 權杖雜湊，並以固定時間比較提交的權杖。',
  'Account seats': '帳號席位',
  'Signed-in seats add the account session check on top of the seat claim. The token proves this browser can reclaim the seat; the session proves the account still matches the seat assignment.':
    '已登入席位會在席位聲明之上增加帳號工作階段檢查。權杖證明該瀏覽器可以取回席位；工作階段則證明帳號仍與席位分配相符。',
  'No live spectator view': '沒有即時觀戰檢視',
  'Non-players do not get a live spectator projection. A socket without a valid seat is rejected before room data is sent, and the live replay endpoint returns 403 until the game reaches a terminal state.':
    '非對局玩家不會取得即時觀戰投影。沒有有效席位的通訊端會在房間資料傳送前被拒絕，而即時回放端點會一直回傳 403，直到對局進入終局狀態。',
  'Postgame review': '賽後複盤',
  'When the game becomes terminal, the privacy rule changes. The room no longer rejects non-players after the result, and the game page becomes the durable public review surface.':
    '對局進入終局狀態後，隱私規則隨之改變。結果產生後，房間不再拒絕非對局玩家，遊戲頁面則成為持久的公開複盤介面。',
  'A spectator who opens the room during play gets no board. The same person can open the finished game page after the result and inspect the event log. That is the product rule: private while decisions are live, reviewable once the record is settled.':
    '觀眾在對局進行時打開房間，看不到棋盤。結果產生後，同一個人可以打開已結束的遊戲頁面並檢查事件紀錄。這就是產品規則：決策仍在進行時保持私密，紀錄確定後可以複盤。',
  'That split is important for rated play. A rated result can point at a public completed game without giving non-players access to live hidden information.':
    '這種區分對計分對局很重要。計分結果可以指向一盤公開的已完成對局，同時不讓非對局玩家接觸即時隱藏資訊。',
  'It also keeps reconnect and review on the same foundation. Live reconnect rebuilds a filtered player view from the event log. Postgame review uses the same log after the hidden-information constraint has expired.':
    '它也讓重新連線與複盤建立在同一基礎上。即時重新連線從事件紀錄重建過濾後的玩家檢視；隱藏資訊限制失效後，賽後複盤使用同一份紀錄。',
  'Scope and verification': '範圍與驗證',
  'This is not a full anti-cheat claim. It is the narrower integrity claim this architecture can prove: during live play, hidden truth is not sent to unauthorized browser paths; after the game ends, the record is reviewable.':
    '這並不是一項完整的反作弊聲明，而是該架構能夠證明的、更具體的完整性保證：即時對局期間，隱藏真實狀態不會傳送到未經授權的瀏覽器路徑；對局結束後，紀錄可供複盤。',
  'Anonymous casual seats are bearer-token seats, not account-grade identity, and there is no live spectator mode for hidden-information games.':
    '匿名休閒席位依靠持有人權杖，並不具備帳號級身分保證；隱藏資訊遊戲也沒有即時觀戰模式。',
  'Mistboard covers this boundary with WebSocket and payload regression tests that drive real moves and assert on the bytes each seat receives.':
    'Mistboard 用 WebSocket 與負載迴歸測試覆蓋這條邊界：測試會執行真實走子，並斷言每個席位實際收到的位元組。',
  'That is the line Mistboard defends: during play, there is no browser-side truth to unmask. After play, there is a public record to inspect.':
    '這就是 Mistboard 守住的界線：對局期間，瀏覽器端沒有可以揭開的真實局面；對局結束後，則有公開紀錄可供檢查。',

  // -- How MistyBanqi Plays (engine article) --
  'How MistyBanqi Plays': 'MistyBanqi 是怎麼下棋的',
  'MistyBanqi is the engine you play in Banqi on Mistboard: a classical search engine with a hand-written evaluation. How it thinks, and the blind spot worth knowing: it can draw a game it has already won.':
    'MistyBanqi 是你在 Mistboard 上對弈暗棋時面對的引擎：一個採用手寫評估的經典搜尋引擎。它如何思考，以及一個值得知道的盲點：它會把已經贏定的棋下成和棋。',
  'How it thinks': '它如何思考',
  "Banqi hides information in its own way: every tile starts face-down, and flipping one reveals a random piece from the bag of what's left. So unlike chess, the engine's search tree mixes ordinary moves with chance events. MistyBanqi treats a flip as a chance node, averaging over the pieces the tile might turn out to be, and otherwise searches like a classical chess engine: it looks ahead through the lines both sides could play and backs up the value of the best one.":
    '暗棋以自己獨特的方式隱藏資訊：每枚棋子起初都背面朝下，翻開一枚，就會從剩下的棋子裡隨機翻出一枚。因此和西洋棋不同，引擎的搜尋樹裡既有普通著法，也有隨機事件。MistyBanqi 把翻子當作一個機率節點，對這枚棋子可能翻出的各種身分取加權平均；其餘部分則像經典西洋棋引擎那樣搜尋：向前推演雙方可能走的著法，再把最佳一路的價值回傳上來。',
  "What it can't do is judge a position by feel. Every leaf of that search gets scored by a hand-written evaluation: material on a corrected value table (the cannon, which captures by jumping a screen, is the most dangerous piece on the board), how many squares each piece controls, how exposed the general is, and a handful of other terms. The engine is only as good as those terms, which is where the weakness below comes from.":
    '它做不到的是憑感覺判斷盤面。這棵搜尋樹的每個葉子節點，都由一套手寫的評估來打分：基於一張修正過的子力價值表的子力（炮靠隔子吃，是盤面上最危險的棋子）、每枚棋子控制多少格、將帥有多暴露，以及另外一些項。引擎的水準完全取決於這些項的好壞——下面要講的弱點正源於此。',
  'Most of the time, it wins': '大多數時候，它會贏',
  "MistyBanqi will beat most people, and it does it the way a classical engine does: by calculating captures several moves deep. Step through a game where it clears the board. Banqi swings with the flips, so it even fell behind on material early here, then worked its way back until the opponent had no piece left to move. Tiles flip to their dealt piece the first time they're turned over.":
    'MistyBanqi 能贏過大多數人，而它取勝的方式正是經典引擎的方式：往前算上好幾步的吃子。逐步回放下面這盤它把對手清光的棋。暗棋的局勢隨翻子起伏，這盤裡它開局甚至一度子力落後，隨後一步步扳了回來，直到對手沒有棋子可走。每枚棋子第一次被翻開時，會翻出它所發到的身分。',
  'That kind of capture-by-capture calculation is the strong half of its game. The blind spot is the other half: what happens when the win needs no more captures, just patience.':
    '這種一子一子算下去的計算，是它棋力強的那一半。盲點是另一半：當勝利不再需要吃子、只需要耐心時，會發生什麼。',
  'It can draw a game it has won': '它會把贏定的棋下成和棋',
  'Here is the same engine in a position it has completely won. It is up ten pieces to two, with nothing left to capture, and the only task is to walk the win home. It draws instead.':
    '同樣這個引擎，下面處在一個它已經完全贏定的局面。它以十子對兩子領先，已經沒有子可吃，唯一要做的就是把勝勢走到底。結果它卻下成了和棋。',
  "Nothing in the evaluation rewards converting a won position over just holding material, so a position it's winning by a mile and a position it has actually won score about the same. With no term pushing it to make progress, it shuffles, and Banqi's threefold-repetition rule ends the game a draw.":
    '評估裡沒有任何一項會因為「把優勢轉化為勝利」而比「單純守住子力」給更高的分，於是一個遙遙領先的局面和一個真正已經贏下的局面，得分幾乎一樣。既然沒有哪一項促使它取得進展，它就只是來回挪子，而暗棋的三次重複局面規則便把這盤判成和棋。',
  "There's an upshot for you here. If you're losing on material, you're not necessarily lost: herd one of its strong pieces into a perpetual chase, and MistyBanqi may walk into the draw it can't see it should decline.":
    '這對你有個實用的啟示。如果你子力落後，並不一定就輸了：用長捉纏住它的一枚大子，MistyBanqi 可能就一頭走進那個它看不出自己本該拒絕的和棋。',
  'It can also lose its own general': '它也可能丟掉自己的將帥',
  'A related blind spot involves the general. A soldier is the only piece that can capture it, and the engine is slow to make room for a general boxed into a corner. It will sometimes march a piece off to the far side of the board while a lone enemy soldier walks up and traps it. Same gap as the draw above: the evaluation has no real sense of a slow, quiet threat building several moves away.':
    '另一個相關的盲點和將帥有關。只有兵（卒）能吃將帥，而當將帥被逼到角落時，引擎遲遲不為它騰出退路。有時它會把一枚棋子調到棋盤另一頭，任由一枚孤零零的敵方兵走上來把將帥困死。這和上面的和棋是同一類毛病：評估對一個緩慢、安靜、還要好幾步才成形的威脅，沒有真正的感覺。',
  'How each of these was found, reproduced, and measured is written up in detail in the engineering post linked below.':
    '這些問題各自是如何被發現、重現並量化的，下面連結的工程部落格文章裡有詳細記錄。',
  'Why these exist, and what’s next': '為什麼會有這些問題，以及下一步',
  "These are the limits of a hand-written evaluation: it can only value what someone thought to encode, and conversion and slow king-hunts are exactly the long-horizon calls that are hard to write down. The fix the strongest Dark Chess programs use is a learned evaluation, trained from game outcomes, which lets the engine judge these on its own. That's the eventual next step for MistyBanqi. Until a learned version clears the current engine's bar in testing, the hand-written one is what you play: strong, and honest about where it cracks.":
    '這些是手寫評估的侷限：它只能給有人想到要編碼進去的東西打分，而「把勝勢轉化為勝利」和「緩慢圍獵將帥」恰恰是那種很難寫成規則的長程判斷。最強的暗棋程式採用的解法，是一套從對局勝負中學習得到的評估，讓引擎能自己判斷這些。這也是 MistyBanqi 終將邁出的下一步。在學習版於測試中越過現有引擎這道門檻之前，你面對的仍是手寫版：強，且對自己會在哪裡出問題保持坦誠。',
  'Play it': '來下一盤',
  'MistyBanqi is live on Mistboard. Take it on at the strength you pick, or read the full writeup of how it was built and measured.':
    'MistyBanqi 已在 Mistboard 上線。來按你選擇的強度挑戰它，或閱讀它如何被打造與衡量的完整記錄。',
  'The engineering story': '工程幕後故事',
  Human: '人類',
  'Human vs engine · mistboard.com': '人類對引擎 · mistboard.com',
  'Human vs engine': '人類對引擎',
  'Draw by repetition · MistyBanqi up 10 pieces to 2': '重複局面和棋 · MistyBanqi 十子對兩子領先',
  'MistyBanqi wins · the opponent is left with no piece to move':
    'MistyBanqi 獲勝 · 對手已無子可走',
  "MistyBanqi (Red) is up ten pieces to two, a trivially won position, but its evaluation gives no reward for converting a win over holding material, so it shuffles instead of pressing and the game is drawn by threefold repetition. If you're losing on material against it, this is the escape: herd a strong piece into a perpetual chase and it may let the draw happen.":
    'MistyBanqi（紅方）以十子對兩子領先，是一個輕鬆贏定的局面，但它的評估並不會因為「把優勢轉化為勝利」而比「守住子力」給更高的分，於是它只來回挪子、不去逼搶，最終因三次重複局面被判和棋。如果你對它子力落後，這就是脫身之道：用長捉纏住一枚大子，它也許就放任和棋發生。',
  'MistyBanqi (the first player) won this one outright, leaving the opponent with nothing to move. Banqi swings hard with the flips: it fell behind on material early here, then calculated its way back and cleared the board. Grinding down a position like this, capture by capture, is the strong half of its game.':
    'MistyBanqi（先手）乾淨俐落地贏下了這盤，讓對手無子可走。暗棋的局勢隨翻子劇烈起伏：這盤裡它開局子力落後，隨後憑計算一步步扳回，把對手清光。像這樣一子一子地輾下去，是它棋力強的那一半。',

  // -- Article index cards --
  'How Misty Plays': 'Misty 是怎麼下棋的',
  "Misty is Mistboard's Fog of War chess engine: how it sees, searches possible boards, avoids hidden catastrophes, and where the current version stands.":
    'Misty 是 Mistboard 的迷霧國際象棋引擎：它如何觀察、搜尋可能盤面、避開隱藏災難，以及目前版本處在什麼水平。',
  'How Mistboard keeps hidden information on the server: canonical state, seat-scoped views, private live rooms, and public postgame review.':
    'Mistboard 如何把隱藏資訊留在伺服器端：標準真實局面、按座位投影視野、私密即時房間，以及公開的賽後複盤。',

  // -- Drop Mini Xiangqi (rules) --
  'Drop Mini Xiangqi Rules': '投放迷你象棋規則',
  'Mini Xiangqi with reserves: captured pieces enter your hand, then drop back outside the enemy palace.':
    '帶持子的迷你象棋：被吃的棋子進入你的手牌，之後可以打回棋盤，但不能打入對方九宮。',
  'Drop Mini Xiangqi is [Mini Xiangqi](/rules/mini-xiangqi) with a reserve. The board is still 7 by 7, Red still moves first, and the general is protected by check and checkmate. The new rule is simple: captured pieces become yours, wait in your hand, and can return to the board as drops.':
    '投放迷你象棋是在[迷你象棋](/rules/mini-xiangqi)裡加入持子。棋盤仍是 7×7，紅方仍先走，將帥仍受將軍與將死規則保護。新規則很簡單：你吃掉的棋子會變成你的棋子，進入手牌，並可以透過打入回到棋盤。',
  'That reserve turns captures into future initiative. A quiet exchange can become a cannon drop, a soldier screen, or a new chariot lane several moves later.':
    '持子會把吃子變成之後的主動權。一次安靜的交換，幾步之後可能變成一次炮的打入、一個兵的炮架，或一條新的車路。',
  'Board and pieces': '棋盤與棋子',
  'The starting position, board, and movement are Mini Xiangqi. There are no advisors or elephants, no river, and each general remains inside its 3 by 3 palace.':
    '初始局面、棋盤與走法都沿用迷你象棋。沒有士象、沒有河界，每一方的將帥仍留在自己的 3×3 九宮內。',
  'This is open information. Both players see the whole board and both reserves. Unlike Dark Mini Xiangqi, there is no fog and no hidden move record.':
    '這是資訊公開的遊戲。雙方都能看到整個棋盤和雙方持子。不同於迷霧迷你象棋，這裡沒有迷霧，也沒有隱藏的走子紀錄。',
  'Captures and reserves': '吃子與持子',
  'When you capture a non-general piece, it leaves the board, changes to your color, and enters your reserve. Generals are never captured and never enter a reserve: attacks on the general are checks, and a player in check must answer the threat.':
    '當你吃掉一枚非將帥棋子時，它離開棋盤，改為你的顏色，並進入你的持子。將帥永遠不會被吃進持子：攻擊將帥是將軍，被將軍的一方必須應對威脅。',
  'Instead of moving a board piece, you may drop one piece from your reserve onto an empty point outside the enemy palace. A dropped piece is live immediately: it can give check on the drop turn and moves normally on later turns.':
    '你可以不移動棋盤上的棋子，而是從持子中選一枚，打入到對方九宮以外的空交叉點。打入的棋子立即生效：它可以在打入當手將軍，之後也按正常走法移動。',
  'Drop restrictions': '打入限制',
  "Drops must land on empty points, and they cannot land inside the opponent's 3 by 3 palace. The current Mistboard rules allow chariots, horses, cannons, and soldiers in reserve. Generals never enter reserve.":
    '打入必須落在空交叉點，且不能落入對方的 3×3 九宮。目前 Mistboard 規則允許車、馬、炮、兵進入持子。將帥永不進入持子。',
  'A dropped soldier follows Mini Xiangqi soldier movement after it lands: one point forward or sideways, never backward. Drops may give check immediately, and a drop is illegal if it leaves your own general in check.':
    '打入的兵落子後按迷你象棋的兵法移動：向前或橫向走一個交叉點，永不後退。打入可以立即將軍；如果一次打入會讓自己的將帥仍處於被將軍狀態，則該打入不合法。',
  'Check and endings': '將軍與終局',
  'Win by checkmate. As in Mini Xiangqi, a player with no legal move loses rather than drawing by stalemate. Games can also end by repetition, the no-capture rule, timeout, resignation, or abandonment.':
    '以將死獲勝。與迷你象棋一樣，沒有合法著法的一方判負，而不是因困斃作和。對局也可能因重複局面、無吃子規則、超時、認輸或棄局而結束。',
  'Step through this longer engine-lab game. It uses the current no-enemy-palace drop rule, shows both sides using reserves to defend and counterattack, and ends only after Black converts a late chariot attack.':
    '逐步重演這盤較長的引擎實驗對局。它採用目前不得打入對方九宮的規則，展示雙方如何用持子防守和反擊，最終由黑方在後期車攻中轉化勝勢。',
  'FSF Red': 'FSF 紅方',
  'FSF Black': 'FSF 黑方',
  'Fairy-Stockfish lab, no-enemy-palace drops': 'Fairy-Stockfish 實驗局，不得打入對方九宮',
  "Black checkmates with 57...g1-f1. The final chariot capture beats Red's last defensive drop on f1.":
    '黑方以 57...g1-f1 將死。最後的車吃子擊破了紅方在 f1 的最後一次防守打入。',
  'Drop Mini Xiangqi is open for alpha play on Mistboard. You can play the Fairy Stockfish bot, create an invite for a friend, or find an open game from the homepage play panel by choosing Drop Mini Xiangqi in the Variant row.':
    '投放迷你象棋已在 Mistboard 開放 Alpha 對弈。你可以在首頁對弈面板的「Variant」一行選擇投放迷你象棋，對戰 Fairy Stockfish 機器人、建立好友邀請，或尋找一局公開對局。',
  'Play the bot': '對戰機器人',
  'Find opponent': '尋找對手',
  // -- Mini Xiangqi (rules) --
  'Mini Xiangqi rules, the 7×7 primer behind Dark Mini Xiangqi: no advisors or elephants, no river, sideways soldiers, and checkmate to win.':
    '迷你象棋規則，迷霧迷你象棋的 7×7 入門基礎：沒有士象、沒有河界、兵可橫走，以將死取勝。',
  'Mini Xiangqi was invented in 1973 by Shigenobu Kusumoto of Osaka, Japan. Xiangqi itself is many centuries older: see [Xiangqi rules](/rules/xiangqi). Mini Xiangqi is a simplified, reduced version of it, with a smaller board, fewer pieces, and no river.':
    '迷你象棋由日本大阪的楠本茂信於 1973 年發明。象棋本身要早上許多個世紀，見[象棋規則](/rules/xiangqi)。迷你象棋是它的簡化精簡版本：棋盤更小、棋子更少，且沒有河界。',
  'This page describes the open-information base game. Mini Xiangqi is not playable on Mistboard; this is reference only.':
    '本頁介紹的是資訊公開的底層遊戲。迷你象棋不能在 Mistboard 上對弈，本頁僅作參考。',
  'Board and setup': '棋盤與佈局',
  'Mini Xiangqi is xiangqi compressed onto a 7 by 7 board with a smaller army. The advisors and elephants are dropped and there is no river, but each general still keeps a 3 by 3 palace.':
    '迷你象棋是把象棋壓縮到 7×7 棋盤、並削減子力的版本。去掉了士和象，也沒有河界，但每一方的將帥仍保有一個 3×3 的九宮。',
  'Piece movement': '棋子走法',
  'Every piece except the soldier moves exactly as it does in [xiangqi](/rules/xiangqi).':
    '除兵（卒）以外，每種棋子的走法都與[象棋](/rules/xiangqi)完全相同。',
  '**Soldier:** a soldier moves and captures one point forward or sideways, never backward. With no river to cross, it has that sideways freedom from its very first move, unlike a soldier on the full xiangqi board.':
    '**兵（卒）：**兵向前或橫向走一個交叉點並以此吃子，永不後退。由於沒有河界可過，牠從第一步起就擁有橫走的自由，這與完整象棋棋盤上的兵不同。',
  'Facing generals are illegal here too. The two generals may never sit on the same open file with nothing between them, so a move that would expose that line is not allowed.':
    '將帥對臉在這裡同樣不合法。雙方的將帥不能處在中間無子的同一條縱線上，因此任何會暴露這條直線的走法都不被允許。',
  'Winning and draws': '勝負與和棋',
  'Checkmate wins. As in xiangqi, a player who has no legal move loses rather than drawing by stalemate, and perpetual check or perpetual chase is not a free draw: a player who repeats an endless attack loses instead.':
    '將死即獲勝。與象棋一樣，沒有合法走法的一方判負，而非因困斃而和棋；長將或長捉也不能用來免費求和：不斷重複同樣進攻的一方反而判負。',
  'A game is drawn when neither side has enough material to checkmate, when a long run of moves passes with no capture (xiangqi caps this much like chess’s fifty-move rule), or by a repetition that breaks none of the perpetual rules. These outcomes follow from the position, not from one player choosing to stop.':
    '當任何一方都沒有足夠的子力將死對方、長時間無吃子（象棋對此設有上限，類似國際象棋的五十回合規則），或出現不違反上述長打規則的重複局面時，對局判和。這些結果都由局面決定，而非某一方主動選擇停手。',
  'A complete game': '一盤完整對局',
  'Mini Xiangqi has no canon of famous human games, so to watch the full army work together, step through a game in which Fairy-Stockfish, a strong open-source engine, plays both sides with full information. Notice how fast the chariots and cannons open lines: on a tight 7 by 7 board with no river, the generals come under fire far sooner than in full xiangqi.':
    '迷你象棋沒有著名的人類對局傳統，因此若想看全部子力協同作戰，可以逐步重演一盤由強大的開源引擎 Fairy-Stockfish 在完全資訊下執雙方對弈的棋局。注意車和炮開線有多快：在緊湊、無河界的 7×7 棋盤上，將帥遭受火力的時間遠比完整象棋來得早。',
  'Mini Xiangqi is not one of the games you can play here. Xiangqi is: the full 9 by 10 game this one reduces, against an engine or a friend.':
    '迷你象棋不在本站可下的棋類之列，象棋則可以：那是被它精簡的完整 9×10 棋局，可以對戰引擎或好友。',
  'Play xiangqi': '下象棋',

  // -- Dark Mini Xiangqi (rules) --
  'Mini Xiangqi under Fog of War: each side sees only the points its pieces reach on the 7×7 board, and the general falls by capture.':
    '戰爭迷霧下的迷你象棋：在 7×7 棋盤上，每一方只能看到己方棋子可及的交叉點，將帥由被吃而落敗。',
  'Fog Xiangqi readers who want the smaller experimental ruleset Mistboard is testing first.':
    '想了解 Mistboard 正在先行測試的小型實驗規則的迷霧象棋讀者。',
  '[Mini Xiangqi](/rules/mini-xiangqi) played with Fog of War: each player sees only their own pieces and the enemy pieces their army can reach. The board is 7 by 7, and the game ends by capturing the opposing general. If you know Mini Xiangqi, the sections below explain only what fog changes.':
    '在戰爭迷霧下進行的[迷你象棋](/rules/mini-xiangqi)：每位玩家只能看到己方棋子，以及己方子力可及的敵方棋子。棋盤為 7×7，以吃掉對方將帥結束對局。如果你已經會下迷你象棋，下面各節只講解迷霧改變了什麼。',
  'Board and fog': '棋盤與迷霧',
  'The board and army are the same as Mini Xiangqi. Fog of War then hides the board: you see your own pieces and every point they can reach, and everything else is fog.':
    '棋盤和子力與迷你象棋相同。戰爭迷霧隨後遮住棋盤：你能看到己方棋子以及牠們可及的每個交叉點，其餘一切都是迷霧。',
  'The opening position from three angles. Red and Black each see only their own side clearly, while the server holds the true board in the middle. Vision is recomputed after every move, so opening a line or losing a piece immediately changes what each player knows.':
    '從三個視角看開局局面。紅方與黑方各自只能清楚看到自己的一側，而中間由伺服器掌握真實棋盤。每走一步後視野都會重新計算，因此打開一條線路或失去一枚棋子都會立刻改變各方所掌握的資訊。',
  'You never see enemy pieces outside your vision, whether a fogged point is empty, or the identity of a shrouded blocker.':
    '你永遠看不到視野之外的敵方棋子，也看不到被迷霧遮住的交叉點是否為空，更看不到被遮蔽的阻擋子是什麼。',
  'Capture the general to win. There is no checkmate and no check warning, so you can move into danger, leave your general exposed, or let the generals face each other across an open file.':
    '吃掉將帥即獲勝。沒有將死，也沒有將軍提示，因此你可以走入危險、讓自己的將帥暴露，甚至讓雙方將帥在一條無遮擋的縱線上對臉。',
  "There is no stalemate draw: if the side to move has no legal move, it loses. With no check to freeze you, this almost never happens. Draws are judged from the true position, not either player's view: the game draws on threefold repetition, and also after 60 plies (30 moves by each side) without a capture.":
    '這裡沒有困斃判和：若輪到走子的一方沒有合法著法，則判負。由於沒有將軍來限制你，這種情況幾乎不會發生。和棋依據真實局面判斷，而非任何一方各自的視野：對局會在三次重複局面時判和，也會在連續 60 個半回合（雙方各 30 回合）無吃子時判和。',
  'Two pieces interact with fog in ways worth seeing up close.':
    '有兩種棋子與迷霧的互動值得近距離一看。',
  'A cannon captures by jumping exactly one screen and landing on the first enemy piece beyond it. Under fog the rule is **screen shrouded, target revealed**: the screen shows as occupied but unidentified, the empty gap behind it stays fogged, and the capturable target is revealed as the enemy piece.':
    '炮吃子時正好越過一個炮架，落在其後的第一枚敵方棋子上。在迷霧下，規則是**炮架被遮、目標可見**：炮架顯示為被佔據但身份不明，其後的空隙仍處於迷霧中，而可吃的目標會直接顯示為敵方棋子。',
  Horses: '馬',
  'A horse moves one point orthogonally and then one diagonally outward, and cannot move if the leg point in between is occupied. If a hidden piece blocks the leg, the leg point shows as occupied but unidentified, and the destinations behind it drop out of your view.':
    '馬先沿橫豎方向走一個交叉點，再斜向外走一個交叉點；如果中間的馬腿位置被佔據，牠就不能走。如果有一枚隱藏的棋子蹩住馬腿，馬腿位置會顯示為被佔據但身份不明，其後的落點則從你的視野中消失。',
  'A complete game under fog': '一盤迷霧下的完整對局',
  'To see the whole army work under Fog of War, step through a game where Mistboard’s engine, Misty DMX, plays both sides. Each ply is shown three ways: what Red can see, the server’s true board, and what Black can see.':
    '想看全部子力在戰爭迷霧下協同作戰，可以逐步重演一盤由 Mistboard 引擎 Misty DMX 執雙方對弈的棋局。每一手都以三種方式呈現：紅方所見、伺服器上的真實棋盤，以及黑方所見。',
  'Dark Mini Xiangqi is open for alpha play. You can play Misty DMX, create an invite, or find an opponent from the homepage play panel by choosing Dark Mini Xiangqi in the Variant row.':
    '迷霧迷你象棋現已開放 Alpha 對弈。你可以在首頁對弈面板的「Variant」一行選擇迷霧迷你象棋，然後對戰 Misty DMX、建立邀請，或尋找對手。',
  'Play Misty': '對戰 Misty',
  'Play Misty DMX': '對戰 Misty DMX',
  'Create invite': '建立邀請',

  // -- Shogi4 (4x4 Shogi) --
  'Shogi4 (4×4 Shogi) Rules': 'Shogi4（4×4 將棋）規則',
  "The complete rules of Shogi4 (4x4 Shogi), Oca Studios' public-domain animal drop-shogi on a 4×4 board: how the Carp, Tapir, Raccoon-dog, Fox, and royal move, plus the friendly-jump, evolution, drops, and king-capture wins.":
    'Shogi4（4×4 將棋）的完整規則，由 Oca Studios 發布並進入公有領域的 4×4 棋盤動物打入將棋：鯉魚、貘、狸、狐與王的走法，以及跳越友子、進化、打入與吃王取勝。',
  "Shogi4, also called 4x4 Shogi, is a drop-shogi played with animal tiles on a 4×4 board. It plays much like ordinary shogi shrunk to sixteen squares: pieces step in marked directions, captured pieces switch sides and drop back into play, and you win by taking the king. The one rule shogi players won't recognize is that a piece may hop over a friendly piece, added so your own pieces don't jam each other on a board this small.":
    'Shogi4（又稱 4×4 將棋）是一種在 4×4 棋盤上用動物棋子進行的打入將棋。它玩起來很像縮小到十六格的普通將棋：棋子按棋面標示的方向走動，被吃的棋子改換陣營並可重新打入棋盤，吃掉王即獲勝。唯一一條將棋玩家會感到陌生的規則是：棋子可以跳越一枚己方棋子，這是為了避免在這麼小的棋盤上自己的棋子互相堵塞而加入的。',
  'Oca Studios released Shogi4 into the public domain in its "Four" series, free as a print-and-play set and as an app. Each player has five pieces: a Carp, a Tapir, a Raccoon-dog, a Fox, and a royal (a Crane for the first player, a Pheasant for the second).':
    'Oca Studios 在其「Four」系列中將 Shogi4 發布到公有領域，作為可列印自玩的套裝和應用免費提供。每位玩家有五枚棋子：鯉魚、貘、狸、狐，以及一枚王（先手為鶴，後手為雉）。',
  'The board and setup': '棋盤與擺子',
  "The board is 4×4, with a farm to either side that holds captured pieces. A tile's owner is shown by its facing: the first player's tiles point up the board, the second player's point down.":
    '棋盤為 4×4，兩側各有一個農場用來存放被吃的棋子。棋子的歸屬由朝向表示：先手的棋子朝向棋盤上方，後手的朝向下方。',
  'Every piece moves one square per turn, in the directions printed on its tile. On reaching the far row, each non-royal piece evolves, flipping to its evolved side. The pairs below show the base piece, then its evolved form, with a dot on every square each can reach (forward is up).':
    '每枚棋子每回合走一格，方向按棋面所印。到達最遠一行時，每枚非王棋子都會進化，翻到其進化面。下面每一對依次展示基礎棋子及其進化形態，並在各自能到達的每個格子上標一個點（上方為前進方向）。',
  '**Carp → Koi.** The Carp steps one square straight forward, a pawn. It evolves into a Koi, which moves as a silver from shogi.':
    '**鯉魚 → Koi。**鯉魚向正前方走一格，相當於將棋中的步兵。它進化為 Koi，走法與將棋中的銀將相同。',
  '**Tapir → Baku.** The Tapir steps forward or to a forward diagonal. It evolves into a Baku, a silver.':
    '**貘 → Baku。**貘向前方或前斜方走一格。它進化為 Baku，走法同銀將。',
  '**Raccoon-dog → Tanuki.** The Raccoon-dog steps one diagonal. It evolves into a Tanuki, a silver.':
    '**狸 → Tanuki。**狸向斜方走一格。它進化為 Tanuki，走法同銀將。',
  '**Fox → Kitsune.** The Fox steps one orthogonal. It evolves into a Kitsune, which moves as a gold from shogi.':
    '**狐 → Kitsune。**狐向橫豎方向走一格。它進化為 Kitsune，走法與將棋中的金將相同。',
  '**Crane / Pheasant.** The royal steps one square in any of the eight directions, a king. The two royals differ only in theme. It never evolves, and capturing it ends the game.':
    '**鶴 / 雉。**王可向八個方向中的任意一個走一格，相當於國際象棋的王。兩種王僅在主題上不同。它永不進化，被吃掉即終局。',
  'Jumping over a friendly piece': '跳越友方棋子',
  'A piece can leap over a friendly piece. If an ally sits on the next square in a direction the piece moves, the piece jumps it and lands on the square just beyond, empty or capturing an enemy there. It works in any direction the piece itself moves: straight for a Carp, on the diagonal for a Raccoon-dog, any of the eight for the royal.':
    '棋子可以跳越一枚己方棋子。如果在該棋子可走的某個方向上、緊鄰的格子裡有一枚友方棋子，它便可越過這枚棋子，落到再往前的那一格上：該格可以為空，也可以吃掉那裡的敵方棋子。這適用於棋子本身能走的任意方向：鯉魚沿直線，狸沿斜線，王則可沿八個方向中的任意一個。',
  'Capturing, farms, and drops': '吃子、農場與打入',
  'Move onto an enemy to capture it; it switches sides into your farm, reverting to its base form if it was evolved.':
    '走到敵方棋子所在的格子即可吃掉它；它會改換陣營進入你的農場，若此前已進化，則恢復為基礎形態。',
  "Instead of moving, drop a piece from your farm onto any empty square, except those on the far row (the opponent's back rank).":
    '你也可以不走子，而是從農場中取出一枚棋子打入任意空格，但最遠一行（對方底線）除外。',
  Winning: '取勝',
  'Capturing the royal is the only way to win. No check, no checkmate: the game ends the moment a royal is taken.':
    '吃掉王是唯一的取勝方式。沒有將軍，也沒有將死：王一旦被吃，對局立即結束。',
  'There is no stalemate. Because moving the king into capture range is legal, a lack of safe moves never ends the game: you simply make the unsafe move and play on until a king is taken. A side with no legal move at all, boxed in with nothing to drop, loses rather than draws.':
    '不存在逼和。由於把王走入可被吃的範圍是合法的，缺少安全著法絕不會結束對局：你只管走那步不安全的棋，繼續對弈，直到有一方的王被吃。若一方完全沒有合法著法（被困住且無子可打入），則判負，而非和棋。',
  'Repetition and draws': '重複與和棋',
  "The original rules address neither repetition nor a move-count limit. Our convention fills the gap: a position reached three times is an automatic draw. That rule is ours, not Oca's, and changes none of the rules above.":
    '原始規則既未規定重複局面，也未規定步數上限。我們的約定補上了這一空缺：同一局面出現三次即自動判和。這條規則是我們定的，並非 Oca 的，且不改變上述任何規則。',
  "Fairy-Stockfish self-play on the friendly-jump engine (this site's patched build). White wins in 73 plies; the mating move is itself a friendly jump.":
    'Fairy-Stockfish 在支援越友規則的引擎（本站修補版）上進行的自我對弈。白方在 73 個半回合內取勝；制勝的那一步本身就是一次跳越友子。',
  'Starting position': '初始局面',
  'Source and license': '來源與授權',
  'Shogi4 and its tile art are by Oca Studios, which released its whole "Four" series into the public domain. The [BoardGameGeek entry](https://boardgamegeek.com/boardgame/146291/shogi4) is a catalog reference.':
    'Shogi4 及其棋子美術由 Oca Studios 創作，該工作室已將其整個「Four」系列發布到公有領域。[BoardGameGeek 條目](https://boardgamegeek.com/boardgame/146291/shogi4)可作為目錄參考。',
  "We recovered the exact rules from Oca's official Shogi4 app, decompiling it to read the move logic directly: the friendly-jump geometry, the single drop ban, and king-capture as the sole win all come from there. Oca's public rules page and starting-position graphic (now reachable only through the [Internet Archive](https://web.archive.org/web/20240926113424/https://www.ocastudios.com/four/shogi/), since the live site is down) corroborate the board and the basic moves.":
    '我們透過反編譯 Oca 官方的 Shogi4 應用、直接讀取其走子邏輯，還原出了確切的規則：跳越友子的幾何規則、唯一的打入禁區，以及以吃王作為唯一取勝方式，都來自於此。Oca 的公開規則頁面和初始局面圖（由於其網站已關閉，現在只能透過 [Internet Archive](https://web.archive.org/web/20240926113424/https://www.ocastudios.com/four/shogi/) 存取）也印證了棋盤和基本走法。',
  'Playing Shogi4': '開始遊玩 Shogi4',
  "Shogi4 isn't playable on the site yet; for now this page is the rules reference. Browse the rest of the rules, or compare it with the chess and xiangqi primers.":
    'Shogi4 目前還不能在本站對弈；現階段本頁作為規則參考。你可以瀏覽其餘規則，或將它與國際象棋和象棋入門相互對照。',

  // -- Dark Draft960 --
  'Dark Draft960': '迷霧選陣960',
  'The draft': '選陣',
  "The server deals each player three random Chess960 back ranks. You pick one. Your opponent independently picks one of theirs. The drafts are sealed. Neither side sees the other's offers or choice.":
    '伺服器為每位玩家發出三種隨機的國際象棋960 底線陣型。你從中選一種，對手也各自從自己的三種中選一種。雙方的選陣都是密封的：任何一方都看不到對方的候選陣型或最終選擇。',
  "Say both players picked offer A. Each side sees only its own back rank; the opponent's stays in fog. Only the server holds both.":
    '假設雙方都選了候選 A。每一方只能看到自己的底線陣型，對方的則隱藏在迷霧中。只有伺服器同時掌握雙方的陣型。',
  '960 × 960 = **921,600** possible starts. Standard chess is one of them.':
    '960 × 960 = **921,600** 種可能的開局。標準國際象棋只是其中之一。',
  'Dark Draft960 is a future variant, not playable yet. There is no set release date.':
    '迷霧選陣960 是一個未來的變體，目前尚不可對弈，也沒有確定的發布日期。',

  // -- Xiangqi primer (rules) --
  'Xiangqi Rules': '象棋規則',
  'Xiangqi Rules: How to Play Chinese Chess': '象棋規則：中國象棋怎麼下',
  'Red and Black alternate moves, with Red first. Each side begins with 16 pieces: one general, two advisors, two elephants, two horses, two chariots, two cannons, and five soldiers. The goal is to checkmate the opposing general.':
    '紅黑雙方輪流走子，紅方先行。每一方開局有 16 枚棋子：一個將（帥）、兩個士（仕）、兩個象（相）、兩個馬、兩個車、兩個炮（砲）和五個兵（卒）。目標是將死對方的將帥。',
  'The board has 9 files and 10 ranks. In the traditional presentation, pieces sit on the intersections of the lines rather than inside squares.':
    '棋盤有 9 條縱線和 10 條橫線。在傳統的呈現方式中，棋子落在線的交叉點上，而不是格子內。',
  "The **palace** is the 3 by 3 box on each player's back side. Generals and advisors must stay inside their own palace. The **river** divides the board in half. Elephants cannot cross it, and soldiers gain sideways movement after crossing it.":
    '**九宮**是每一方底線一側的 3×3 區域。將帥與士仕必須留在己方九宮之內。**楚河漢界**將棋盤分為兩半。象（相）不能過河，而兵（卒）過河之後可以橫向走子。',
  "A piece captures by landing on an enemy-occupied point, and no piece may move through an occupied point. The cannon's capturing jump is the only exception. The pieces are listed below in the traditional order.":
    '棋子透過落在敵方佔據的交叉點上來吃子，而任何棋子都不能穿過被佔據的交叉點。炮的吃子跳躍是唯一的例外。下面按傳統順序列出各棋子。',
  '**General:** moves one point horizontally or vertically and can never leave its own palace. The two generals may never face each other along an open file with nothing between them: a move that would expose that line is illegal. In effect, a general guards the file in front of it like a chariot.':
    '**將（帥）：**橫向或縱向走一個交叉點，永遠不能離開己方九宮。雙方的將帥不能在中間無子的同一條縱線上對臉：任何讓這條直線暴露出來的走法都是不合法的。實際上，將帥就像一隻車那樣守住它正前方的縱線。',
  '**Advisor:** moves one point diagonally and, like the general, stays inside the palace. Both advisors share just five possible points. Their main job is to protect the general, but they can also become a liability by blocking its escape or serving as a cannon screen.':
    '**士（仕）：**斜向走一個交叉點，與將帥一樣必須留在九宮內。兩枚士共同只能到達五個點。它們的主要職責是保護將帥，但也可能堵住將帥的逃路，或成為對方炮的炮架。',
  "**Elephant:** moves exactly two points diagonally and cannot cross the river, so the two elephants share only seven possible points on their own half. It does not jump: a piece on the midpoint of the diagonal, the elephant's eye, blocks the move.":
    '**象（相）：**沿斜線正好走兩個交叉點，且不能過河，因此兩枚象在己方半邊共同只能到達七個點。牠不能跳越：如果斜線中點（象眼）上有棋子，這步走法就被擋住。',
  "**Horse:** moves one point orthogonally and then one point diagonally outward, like a chess knight, but it does not jump. If the orthogonal point it steps through, the horse's leg, is occupied, the horse cannot move in that direction.":
    '**馬：**先沿橫豎方向走一個交叉點，再斜向外走一個交叉點，走「日」字，類似西洋棋的騎士，但牠不能跳越。如果牠經過的那個橫豎交叉點（馬腿）被佔據（蹩馬腿），馬便不能朝那個方向走。',
  '**Chariot:** moves any distance horizontally or vertically and cannot jump, exactly like a rook. It is the strongest piece on the board.':
    '**車：**橫向或縱向走任意距離，不能越子，與西洋棋的城堡完全相同。牠是棋盤上最強的棋子。',
  '**Cannon:** moves like a chariot when it is not capturing. To capture, it jumps over exactly one piece, friend or foe, called the screen, and lands on an enemy piece beyond it.':
    '**炮（砲）：**不吃子時走法與車相同。吃子時，牠正好越過一枚棋子（不分敵我），這枚棋子稱為炮架，並落在其後的一枚敵方棋子上。',
  '**Soldier:** moves one point straight forward and never backward. After crossing the river it may also move one point sideways. It never promotes.':
    '**兵（卒）：**向正前方走一個交叉點，永不後退。過河之後，牠還可以橫向走一個交叉點。牠不會升變。',
  'Check, checkmate, and endings': '將軍、將死與終局',
  'A general is in **check** when an enemy piece attacks it. Every move must leave your own general safe, so a player in check must move the general, capture the attacker, or block the attack. If no legal answer exists, it is checkmate and the checked player loses.':
    '當敵方棋子攻擊將帥時，即為**將軍**。每一步都必須保證己方將帥安全，因此被將軍的一方必須移動將帥、吃掉進攻棋子或擋住攻擊。若沒有合法應法，便是將死，被將軍的一方告負。',
  'A player with no legal move also loses, even when the general is not in check. In Western chess that position is a stalemate draw; in xiangqi it is a win for the player who made the last move.':
    '即使將帥沒有被將軍，完全沒有合法走法的一方也會告負。在西洋棋中這是逼和；在象棋中則由走出上一著的一方獲勝。',
  'Tournament rules use detailed procedures for perpetual check, perpetual chase, and other repeated attacks. Mistboard uses two automatic draw rules: the same position three times, or 60 consecutive plies without a capture.':
    '正式比賽規則對長將、長捉和其他重複進攻有詳細判定程序。Mistboard 採用兩條自動和棋規則：同一局面出現三次，或連續 60 個半回合沒有吃子。',
  "To see the pieces work together, step through a famous trap from a manual printed in 1632. Red gives up a horse; when Black grabs it, Red's chariots and cannons pour through the gap and checkmate on the thirteenth move.":
    '想看棋子如何協同作戰，可以逐步重演一則出自 1632 年棋譜的著名陷阱。紅方故意送出一匹馬，黑方一旦貪吃，紅方的車炮便乘虛而入，在第十三著將死對手。',
  'Mini Xiangqi': '迷你象棋',
  'Dark Mini Xiangqi': '迷霧迷你象棋',

  // -- Chess primer --
  'Chess Rules': '國際象棋規則',
  'Chess is a two-player strategy game played for centuries. It descends from the Indian game chaturanga of around the 6th century and reached Europe through Persia and the Islamic world; its modern form, with the long-range queen and bishop, took shape in Europe in the late 1400s.':
    '國際象棋是一種已有數百年歷史的雙人策略遊戲。它源自約公元 6 世紀的印度遊戲恰圖蘭加，經由波斯和伊斯蘭世界傳入歐洲；其現代形式（擁有遠程的后和象）於 15 世紀末在歐洲成形。',
  'Board setup': '棋盤佈置',
  'Chess is played on an 8 by 8 board of alternating light and dark squares.':
    '國際象棋在 8×8 的棋盤上進行，棋盤由深淺相間的方格組成。',
  'White moves first, then players alternate. Each side fills the two rows nearest it, with the queen starting on her own color. On your turn, move one piece to a legal square: you cannot land on your own piece, and landing on an enemy piece captures it, removing it from the board.':
    '白方先走，之後雙方輪流走子。每一方在最靠近自己的兩排擺滿棋子，后擺在與自身同色的格子上。輪到你時，將一枚棋子走到一個合法的格子：你不能落在自己的棋子上，而落在敵方棋子上即可將其吃掉，並把它從棋盤上移走。',
  'Each piece moves in its own way. In every diagram below, the highlighted squares are the legal moves and captures for the marked white piece.':
    '每種棋子都有各自的走法。在下面每一幅圖中，高亮的格子表示被標記的白方棋子的合法走法與吃子。',
  '**King:** moves one square in any direction. In regular chess, a king may not move onto a square attacked by the opponent.':
    '**王：**可向任意方向走一格。在普通國際象棋中，王不能走到被對方攻擊的格子上。',
  '**Queen:** moves any number of squares horizontally, vertically, or diagonally. Other pieces block her path.':
    '**后：**可沿橫線、豎線或斜線走任意格數。其他棋子會擋住它的去路。',
  '**Rook:** moves any number of squares horizontally or vertically. It cannot jump, so the first occupied square in a line stops it.':
    '**車：**可沿橫線或豎線走任意格數。它不能跳子，因此一條線上第一個被佔據的格子就會擋住它。',
  '**Bishop:** moves any number of squares diagonally. Because diagonals stay on one color, each bishop stays on light squares or dark squares for the whole game.':
    '**象：**可沿斜線走任意格數。由於斜線始終保持同一種顏色，每個象在整盤棋中都只走淺色格或只走深色格。',
  '**Knight:** moves in an L shape: two squares one way and one square sideways. The knight is the only piece that jumps over other pieces.':
    '**馬：**走「L」形：朝一個方向走兩格，再橫向走一格。馬是唯一能跳過其他棋子的棋子。',
  '**Pawn:** the pawn moves and captures differently from every other piece. It moves straight forward into an empty square, one square at a time, or two squares from its starting position. It can never move backward or sideways, and a piece directly in front of it blocks it completely. It captures only diagonally forward, one square (the green rings below), never straight ahead. Two further pawn rules, promotion and en passant, appear under Special moves below.':
    '**兵：**兵的走法和吃法與其他所有棋子都不同。它向正前方走入一個空格，每次一格，或在起始位置時一次走兩格。它永遠不能後退或橫走，正前方若緊挨著一枚棋子便會被完全擋住。它只能向斜前方吃子，一格（見下圖的綠色圓環），絕不向正前方吃子。另有兩條與兵有關的規則：升變與吃過路兵，見下文的「特殊走法」。',
  'Check and checkmate': '將軍與將死',
  'In regular chess, the king is protected by check and checkmate. A king is **in check** when an enemy piece attacks it. The checked player must make a legal move that leaves the king safe.':
    '在普通國際象棋中，王受到將軍與將死規則的保護。當敵方棋子攻擊王時，王即處於**被將軍**的狀態。被將軍的一方必須走一步合法著法，使王重新安全。',
  'Most checks are answered in one of three ways: move the king, block the line of attack, or capture the attacking piece. If none of those legal answers works, the game ends by **checkmate**.':
    '應對將軍通常有三種方法：移動王、擋住攻擊線路，或吃掉發動攻擊的棋子。如果這些合法應法都行不通，對局便以**將死**告終。',
  'In regular chess the king is never actually captured: the game ends at checkmate, with the king still on the board.':
    '在普通國際象棋中，王從不會真的被吃掉：對局在將死時結束，此時王仍留在棋盤上。',
  'Special moves': '特殊走法',
  'Castling is a one-move king-and-rook move. The king moves two squares toward a rook, and that rook moves to the square the king crossed. In regular chess, the pieces must be unmoved, the path must be empty, and the king cannot castle out of, through, or into check.':
    '王車易位是一步同時移動王和車的走法。王朝著一隻車的方向走兩格，那隻車則移動到王越過的格子上。在普通國際象棋中，參與易位的王與車此前都不能動過，中間的格子必須為空，且王不能在被將軍時易位、不能穿過被攻擊的格子易位，也不能易位到被攻擊的格子上。',
  'Queenside castling works the same way on the other side: the king moves two squares toward the rook, and the rook lands next to it.':
    '后翼易位在另一側以同樣方式進行：王朝著車走兩格，車則落到王的旁邊。',
  Promotion: '升變',
  'When a pawn reaches the farthest rank, it promotes into a queen, rook, bishop, or knight.':
    '當兵到達最遠的一條橫線時，它會升變為后、車、象或馬。',
  'En passant is the unusual pawn capture. If an enemy pawn moves two squares from its starting rank and lands beside your pawn, your pawn may capture it diagonally as if it had moved only one square. This chance exists only on the very next move.':
    '吃過路兵是一種特殊的兵吃子。如果敵方的兵從起始橫線一次走兩格，並停在你的兵旁邊，你的兵可以斜向吃掉它，就好像它只走了一格一樣。這個機會只在緊接著的下一步存在。',
  'Not every game is won. Some end in a draw, where neither side wins.':
    '並非每盤棋都分出勝負。有些以和棋告終，即雙方都不獲勝。',
  Stalemate: '逼和',
  'Stalemate is when the player to move has no legal move but their king is not in check. It is a draw, not a win, even if one side is far ahead. Below it is Black to move: the king on a8 is not in check, yet every square it could step to is covered by the white queen, and Black has nothing else to move. The game is drawn.':
    '逼和是指輪到走子的一方沒有任何合法著法，但其王並未被將軍。它判作和棋，而非取勝，即使一方大佔優勢也是如此。下圖輪到黑方走子：a8 的王沒有被將軍，但它能走到的每一個格子都被白后控制，而黑方又無其他棋子可走。對局判和。',
  'Other draws': '其他和棋',
  '**Threefold repetition:** the same position, with the same player to move, occurs three times. Either player can then claim a draw.':
    '**三次重複局面：**同一局面在同一方走子的情況下出現三次。此時任一方都可以提出和棋。',
  '**Fifty-move rule:** fifty moves by each side pass with no capture and no pawn move. The clock resets whenever a pawn moves or a piece is taken.':
    '**五十回合規則：**雙方各走五十回合而無任何吃子、也無任何兵的走動。每當有兵走動或有棋子被吃，計數便重新歸零。',
  '**Insufficient material:** neither side has enough force to deliver checkmate, such as king versus king, or king and a lone bishop or knight against a bare king.':
    '**子力不足：**任何一方都沒有足夠的子力完成將死，例如單王對單王，或一王加單象或單馬對單王。',
  '**Agreement:** both players simply agree to a draw.': '**協議和棋：**雙方直接同意作和。',
  'A famous game': '一盤名局',
  'To see the pieces work together in a real game, step through Game 11 of the 2014 World Championship in Sochi. Playing White, Magnus Carlsen grinds down Viswanathan Anand in a Berlin endgame to clinch the title; Anand resigns on move 45.':
    '想看棋子在實戰中如何協同，可以逐步重演 2014 年索契世界冠軍賽的第 11 局。執白的馬格努斯·卡爾森在柏林防禦殘局中逐步磨垮維斯瓦納坦·阿南德，鎖定冠軍；阿南德在第 45 回合認輸。',
  'Where to next': '接下來去哪',
  'All rules': '全部規則',
  'Fog Chess Concepts': '迷霧國際象棋概念',
  'The starting position': '開局局面',
  'What you see': '你能看到什麼',
  'Win condition: king capture': '勝負條件：吃王',
  Draws: '和棋',
  'Edge cases': '特殊情形',
  'Reading the fog': '讀懂迷霧',
  'A sample game': '一盤示例對局',
  Castling: '王車易位',
  'Pawn vision': '兵的視野',
  'En passant': '吃過路兵',
  'Pawn moves': '兵的走動',
  Captures: '吃子',
  'Each side sees the squares its own pieces could legally move to (under [regular chess rules](https://en.wikipedia.org/wiki/Rules_of_chess)), plus the squares they stand on. Everything else is fog.':
    '每一方能看到己方棋子（按[普通國際象棋規則](https://zh.wikipedia.org/zh-hant/国际象棋规则)）可以合法走到的格子，以及棋子當前所在的格子。其餘一切都籠罩在迷霧之中。',
  "Here's the same rule, piece by piece.": '同一條規則，逐子來看。',
  'Vision moves with pieces. When a piece moves, the squares it used to cover go dark (unless another piece still sees them), and the squares it now reaches light up.':
    '視野隨棋子移動。當一個棋子走動時，它原先覆蓋的格子會重新陷入黑暗（除非另有棋子仍能看到它們），而它新觸及的格子則會亮起。',
  "Notice the rook on d7 sees the queen on b7 and the king on h7, but not a7. A piece's vision ends where its movement ends.":
    '注意 d7 的車能看到 b7 的后和 h7 的王，卻看不到 a7。棋子的視野止於它走法的盡頭。',
  'The game ends when a king is captured. No check, no checkmate, no warning.':
    '當一方的王被吃掉時，對局即告結束。沒有將軍，沒有將死，也沒有任何預警。',
  "Mistboard auto-draws games on threefold repetition (same true position three times, same side to move, same castling and en-passant rights) and the 50-move rule (fifty full moves with no pawn move or capture). Both apply to the true position, not either player's view. There is no stalemate draw and no insufficient-material draw.":
    'Mistboard 會在三次重複局面（同一真實局面出現三次，且輪到走子的一方相同、王車易位權與吃過路兵權也相同）或五十回合規則（連續五十個回合無兵的走動、也無吃子）時自動判和。兩條規則都針對真實局面，而非任何一方各自的視野。這裡沒有逼和，也沒有子力不足判和。',
  'A king may castle out of, through, or into check.':
    '王可以在被將軍時易位，可以穿過被攻擊的格子易位，也可以易位到被攻擊的格子上。',
  'Pawns see forward push squares when those squares are empty. They see diagonal squares only when an enemy piece is actually there to capture.':
    '兵在前方格為空時能看到可推進的格子。只有當斜前方真的有敵方棋子可吃時，兵才會看到那個斜線格。',
  'White does not see a4 or b4: black pawns block those pushes, so they are not legal moves. Some rulesets reveal blocked pawn squares; Mistboard does not.':
    '白方看不到 a4 或 b4：黑兵擋住了這些推進，所以它們不是合法走法。有些規則會顯示被阻擋的兵推進格；Mistboard 不會。',
  "En passant is chess's strangest move, so our vision rule bends for it: the capturing pawn sees the captured pawn on its adjacent square. The window is one move only. Pass on the capture and the chance is gone.":
    '吃過路兵是國際象棋中最奇特的一步，因此我們的視野規則為它破了個例：執行吃子的兵能看到相鄰格子上那個將被吃掉的對方兵。這個窗口只持續一步。若放棄這次吃子，機會便不復存在。',
  'The goal is not perfect certainty. A good fog chess player learns which hidden worlds are dangerous enough to respect, then chooses moves that survive those worlds.':
    '目標不是獲得完美確定性。優秀的迷霧棋手會判斷哪些隱藏局面危險到必須尊重，然後選擇在那些局面中也能成立的走法。',
  'A pawn sees where it can push. Fog on a push square means an opponent piece or pawn is blocking it.':
    '兵能看到它可以推進到的格子。若推進格被迷霧遮住，就說明那裡有對方的棋子或兵擋著。',
  "Same signal in opening play. After 1.d4 e6 2.Nf3 Bb4, b4 leaves White's view: the b2-pawn no longer pushes there. A Black piece just landed on b4. Pawn, knight, or bishop, and White can't tell which. But c3 and d2 are visible empty, so a bishop would capture the king next move. White has to defend on that assumption.":
    '開局中也有同樣的信號。在 1.d4 e6 2.Nf3 Bb4 之後，b4 離開了白方的視野：b2 的兵不再能推進到那裡。說明剛有一枚黑方棋子落在了 b4。可能是兵、馬或象，白方無從判斷是哪一個。但 c3 與 d2 都清晰可見且為空，因此一枚象下一步就能吃掉白王。白方只能按這個最壞的假設來防守。',
  "When the opponent takes one of your pieces, the capture square falls to fog. You can't see what took. Here: White pawn on d5, with four Black attackers around it (c6 pawn, e6 pawn, c7 knight, d7 rook). After 1...exd5, the d5 pawn vanishes. Which Black piece took it?":
    '當對方吃掉你的一枚棋子時，被吃的那個格子會隨即陷入迷霧。你看不到是誰吃的。例如：白方有一個兵在 d5，周圍有四個黑方攻擊者（c6 兵、e6 兵、c7 馬、d7 車）。在 1...exd5 之後，d5 的兵消失了。是哪一枚黑子吃掉了它？',
  'Add a White bishop on h3. Its diagonal keeps e6 in view. After the same 1...exd5, White loses d5 and the bishop sees e6 fall empty. So the e-pawn took.':
    '現在在 h3 添一枚白象。它的斜線讓 e6 始終處在視野內。同樣走 1...exd5 之後，白方失去 d5，而那枚象看到 e6 變空了。於是可知：是 e 路的兵吃的。',
  "Here is a complete game between Mistboard's engine and a human, shown from both player views and the server's full position.":
    '下面是一盤 Mistboard 引擎對陣真人的完整對局，同時展示雙方視野和伺服器上的完整局面。',
  'Read the rules': '閱讀規則',
  "WHITE'S VIEW": '白方視野',
  'SERVER TRUTH': '伺服器真相',
  "BLACK'S VIEW": '黑方視野',
  PAWN: '兵',
  KNIGHT: '馬',
  BISHOP: '象',
  ROOK: '車',
  QUEEN: '后',
  KING: '王',
  BEFORE: '之前',
  AFTER: '之後',
  'EMPTY AHEAD': '前方空曠',
  'BLOCKED AHEAD': '前方受阻',
  'The board': '棋盤',
  'The pieces': '棋子',
  'Back to all rules': '返回全部規則',
  // section headings
  'Win condition: general capture': '勝負條件：擒獲將帥',
  'Play status': '對弈狀態',
  // sub-headings
  Cannons: '炮（砲）',
  'Facing generals': '將帥對臉',
  'Horse legs': '蹩馬腿',
  'Elephant eyes': '塞象眼',
  // paragraphs
  'At the start, you see your own pieces and every legal destination they control. Everything else is fog. Your opponent sees a different board from the same true position.':
    '開局時，你能看到己方棋子以及它們所控制的每一個合法落點。其餘一切都是迷霧。你的對手會從同一個真實局面看到一張不同的棋盤。',
  'Vision is recomputed from the true position after every move, so hidden blockers, cannon screens, horse legs, elephant eyes, and newly opened lines immediately change what you know.':
    '每走一步之後，視野都會根據真實局面重新計算，因此隱藏的阻擋子、炮架、馬腿、象眼，以及新打開的線路都會立刻改變你所掌握的資訊。',
  'Capture the general to win. Checks and checkmates are not announced, and the server does not warn a player who has moved into danger.':
    '擒獲將帥即獲勝。將軍與將死都不會被告知，並且當一方走入危險時，伺服器也不會發出警告。',
  "Games auto-draw on threefold repetition and after 60 plies with no capture. Both are judged from the true position, not either player's view. There is no stalemate draw: if the side to move has no legal move, it loses, and with no check to freeze you, this almost never happens.":
    '對局會在三次重複局面，以及連續 60 個半回合無吃子時自動判和。兩者都依據真實局面判斷，而非任何一方各自的視野。這裡沒有困斃判和：若輪到走子的一方沒有合法著法，則判負；而由於沒有將軍來限制你，這種情況幾乎不會發生。',
  'A cannon moves like a chariot when it is not capturing. To capture, it jumps exactly one screen and lands on the first enemy piece beyond it. Under fog, the screen appears as unknown occupancy and the target is visible as the enemy piece.':
    '炮（砲）不吃子時走法與車相同。吃子時，牠正好越過一個炮架，落在其後的第一枚敵方棋子上。在迷霧下，炮架顯示為未知的佔據狀態，目標則作為敵方棋子可見。',
  'A horse can move only when the adjacent leg square is clear. If a hidden piece blocks that leg, the destination disappears from your visible set and the leg square appears as a ? marker.':
    '只有當相鄰的馬腿位置空著時，馬才能走動。如果有一枚隱藏的棋子蹩住了那條馬腿，落點就會從你的可見集合中消失，而馬腿位置則顯示為一個「?」標記。',
  'An elephant moves two points diagonally and cannot cross the river. If a hidden piece sits on the midpoint eye, the diagonal destination disappears and the eye square appears as a ? marker.':
    '象（相）沿斜線走兩個交叉點，且不能過河。如果有一枚隱藏的棋子塞在中點的象眼上，斜線落點就會消失，而象眼位置則顯示為一個「?」標記。',
  'This public production game ends with the rule that most clearly separates Fog Xiangqi from ordinary xiangqi. Red sends a chariot to d10, Black’s general captures it, and the open file lets Red’s general fly from d1 to d10 for the win.':
    '這盤公開的正式環境對局，以一條最能區分迷霧象棋與普通象棋的規則收尾。紅方把車殺到 d10，黑將吃掉它，隨後開放的縱線讓紅帥從 d1 飛到 d10 取勝。',
  'Red has the lower army. Step through Red’s view, the server truth, and Black’s view.':
    '紅方棋子位於下方。逐步查看紅方視野、伺服器真相和黑方視野。',
  'Black’s cannon jumps a screen and captures the horse on b1.': '黑砲越過砲架，吃掉 b1 的紅馬。',
  'Red’s chariot immediately captures that cannon.': '紅車立即吃掉這門黑砲。',
  'Red’s roaming cannon captures Black’s horse on g8.': '紅方游走的砲吃掉 g8 的黑馬。',
  'Black’s remaining horse catches the cannon on c9.': '黑方剩下的馬在 c9 吃掉紅砲。',
  'Red’s chariot crashes into d10 and captures an advisor beside the general.':
    '紅車殺入 d10，吃掉黑將身旁的士。',
  'Black’s general captures the chariot on d10. The entire d-file between the two generals is now open.':
    '黑將在 d10 吃掉紅車。此時兩位將帥之間的整條 d 線完全暢通。',
  'Red’s general flies from d1 to d10 and captures Black’s general. Fog Xiangqi ends immediately.':
    '紅帥從 d1 飛到 d10，擒獲黑將。迷霧象棋對局立即結束。',
  '[Open the original game](/dark-xiangqi/game/dxq_ef889df8-a1eb-4d0a-bd0a-ffd7e8bc30f4).':
    '[開啟原始對局](/dark-xiangqi/game/dxq_ef889df8-a1eb-4d0a-bd0a-ffd7e8bc30f4)。',
  // -- Jieqi (rules) --
  Setup: '佈局',
  "Set each general face-up on its normal palace point. Shuffle each side's other fifteen pieces and deal them face-down onto the remaining starting points. Neither player knows any hidden identities, including their own.":
    '將雙方的將帥各自正面朝上擺在九宮內通常的位置。把每一方其餘十五枚棋子洗混，背面朝下地發到剩餘的起始位置上。任何一方都不知道任何暗子的身份，包括自己的暗子。',
  'First moves use starting points': '首步按起始位置行棋',
  'Before reveal, a dark piece uses the role of the starting point it occupies, not its hidden identity. A dark piece on a corner point plays like a chariot; dark pieces on horse, advisor, elephant, cannon, and soldier points use those matching moves.':
    '翻明之前，暗子按其所在起始位置對應的兵種行棋，而不是按牠隱藏的真實身份。位於角點的暗子像車一樣走；位於馬、士、象、炮、兵起始位置上的暗子，則分別按這些兵種的走法行棋。',
  'The normal restrictions still apply to that first move: horse legs, elephant eyes, cannon screens, palace limits for advisor points, and the river limit for elephant points. Once the move resolves, the piece flips face-up for both players.':
    '通常的限制對這首步同樣適用：蹩馬腿、塞象眼、炮架，士位受九宮限制，象位受河界限制。這步走完後，該棋子即對雙方翻為正面朝上。',
  'Revealed pieces use identity': '翻明後的棋子按真實身份行棋',
  "After reveal, use the piece's identity from its current point. Advisors may leave the palace, and elephants may cross the river. Their movement shapes do not change: advisors step one point diagonally; elephants move two points diagonally and are still eye-blocked.":
    '翻明之後，棋子從牠當前所在的位置按其真實身份行棋。士可以離開九宮，象可以過河。牠們的走子形狀不變：士斜走一個交叉點；象斜走兩個交叉點，並且仍會被塞象眼。',
  'Horses, chariots, and cannons move normally. Soldiers use the normal river rule from wherever they reveal: forward only before crossing, forward or sideways after crossing, never backward.':
    '馬、車、炮按常規走法行棋。兵（卒）則從牠翻明的位置起套用通常的過河規則：過河前只能向前，過河後可向前或橫走，永不後退。',
  'Captured dark pieces': '被吃掉的暗子',
  'If a dark piece is captured before revealing, only the capturer learns what it was. The owner sees one dark piece leave the board, but not its identity. Later, the capturer can rule out that hidden identity elsewhere.':
    '如果一枚暗子在翻明之前被吃掉，只有吃子的一方知道牠是什麼。棋子的主人只看到一枚暗子離開棋盤，卻看不到牠的身份。此後，吃子的一方便可以排除其他位置上存在這個隱藏身份的可能。',
  'Mistboard uses capturer-only reveal: the player who takes a dark piece learns its identity, while the former owner does not.':
    'Mistboard 採用僅向吃子方揭示的規則：吃掉暗子的一方會得知其身份，而原持有者不會得知。',
  'Checks, wins, and draws': '將軍、勝負與和棋',
  "Every occupied point is visible, so players can see when a general is attacked. An unmoved dark piece attacks using its starting point's role. Once it moves, it reveals immediately, and any attack from the destination uses its revealed identity.":
    '每個被佔據的交叉點都是可見的，因此雙方都能看出將帥何時受到攻擊。尚未走動的暗子按其起始位置對應的兵種發動攻擊。一旦走動，牠立即翻明；任何來自落點的攻擊都按翻明後的真實身份計算。',
  'Normal check rules apply: a move may not leave your own general attacked, and a player in check must answer the threat. You win by checkmate or by leaving the opponent with no legal move. The facing-generals rule still applies, and dark pieces block the file like any other piece.':
    '通常的將軍規則依然適用：走子後不能讓己方將帥受到攻擊，被將軍時必須應對。將死對方，或讓對方無合法走法，即可獲勝。將帥對臉規則仍然有效，暗子也和其他棋子一樣會擋住縱線。',
  'Mistboard automatically draws after 120 plies, or 60 moves by each player, without a capture. Repeated positions do not trigger a separate automatic draw.':
    '連續 120 個半回合，也就是雙方各走 60 步而沒有吃子時，Mistboard 自動判和。重複局面不會另外觸發自動和棋。',
  'Step through a self-play game. Dark pieces appear as colored backs and reveal their identity the first time they move. Red wins by checkmate.':
    '逐步查看一盤自我對弈。暗子以彩色背面顯示，第一次走動時翻明身份。紅方以將死獲勝。',
  'The board is half a xiangqi board: thirty-two squares in a 4x8 grid, shown here with the long side horizontal. Unlike xiangqi, pieces sit inside the squares rather than on intersections, and the thirty-two shuffled pieces exactly fill the board, every one face-down.':
    '棋盤是半張象棋棋盤：4×8 共三十二個方格，此處以長邊橫置顯示。與象棋不同，棋子放在方格之內，而不是交叉點上；洗勻後的三十二枚棋子恰好填滿棋盤，每一枚都背面朝下。',
  'Colors are not assigned in advance. The first player opens the game by flipping any piece: whatever color comes up is theirs, and the opponent plays the other.':
    '顏色不會事先分配。先行的一方翻開任意一枚棋子來開局：翻出什麼顏色，那一方就執該色，對手執另一色。',
  Turns: '回合',
  'On your turn, do exactly one of two things: **flip** any face-down tile, or **move** one of your revealed pieces one square up, down, left, or right. A move may land on an empty square or capture an enemy when the rank rules allow it. A flip reveals the piece to both players, even if it belongs to your opponent. There is no passing.':
    '輪到你時，只能做兩件事之一：**翻開**任意一枚背面朝下的棋子，或把一枚己方已翻開的棋子向上、下、左、右移動一格。移動可落到空格，也可在等級規則允許時吃掉敵子。翻子會向雙方亮出該棋子，即使它屬於對手。不能跳過回合。',
  'Capture by rank': '按等級吃子',
  'Face-down tiles cannot be captured. The cannon uses a different attack, so it sits outside the ladder when capturing. The dashed slot shows only how other pieces treat a cannon as a target: it ranks between the horse and soldier.':
    '背面朝下的棋子不能被吃。砲使用不同的攻擊方式，因此進攻時不屬於等級序列。虛線位置只表示其他棋子把砲當作目標時如何計算：砲排在馬與卒之間。',
  'The cannon': '砲',
  'The cannon ignores rank when it captures. Instead of taking an adjacent piece, it travels along a row or column, jumps exactly one intervening piece called the screen, and captures the first piece beyond it if that piece is a revealed enemy. The screen may be friendly, enemy, or face-down. Without a capture, the cannon moves one square like every other piece. Because it needs a screen, it cannot capture an adjacent piece.':
    '砲吃子時不論等級。它不吃相鄰棋子，而是沿一行或一列越過恰好一枚作為砲架的棋子，並在砲架另一側第一枚棋子是已翻開的敵子時將其吃掉。砲架可以是己方、敵方或背面朝下的棋子。不吃子時，砲與其他棋子一樣只走一格。由於吃子需要砲架，它不能吃相鄰棋子。',
  'You win when your opponent has no legal move, usually because every enemy piece is captured, sometimes because they are boxed in. The general is not royal: capturing it is progress, not the win, and play continues until one side is wiped out or stuck.':
    '當對手輪到自己卻無棋可走時，你獲勝——通常是因為敵方棋子被全部吃光，有時則是被困死、無路可走。這裡的將不是王棋：吃掉它只是進展，而非勝利，棋局會一直進行到一方被吃光或被困死為止。',
  'Mistboard draws a game two ways: 40 plies (single moves) with no flip or capture, or threefold repetition, the same position three times. A flip or capture resets both counters because it changes the position irreversibly.':
    'Mistboard 有兩種自動和棋：連續 40 個半回合沒有翻子或吃子，或同一局面出現三次。翻子或吃子會不可逆地改變局面，因此會重置兩個計數。',
  'Play MistyBanqi': '對戰 MistyBanqi',
  'Challenge a friend': '挑戰好友',
  'MistyBanqi · Strongest': 'MistyBanqi · 最強',
  'MistyBanqi (Red) wins by resignation · 49 moves': 'MistyBanqi（紅方）因對手認輸獲勝 · 49 回合',
  'Three rules give the game its character: the rat captures the elephant, only the rat can swim, and the lion and tiger leap the rivers.':
    '三條規則賦予了這盤棋的特色：老鼠能吃大象，只有老鼠能下水，獅和虎能跳過河。',
  'Strongest at the left, weakest at the right.': '最強在左，最弱在右。',
  Traps: '陷阱',
  'Step a piece onto one of your opponent’s three trap squares and it loses all rank while it stands there, so any defending piece can take it, down to a rat capturing a trapped elephant. Only an enemy’s traps do this: a piece can sit on one of its own traps and keeps its full rank.':
    '把一枚棋子走進對方三個陷阱格之一，它在停留期間會喪失全部等級，因此任何防守方棋子都能吃掉它，哪怕是老鼠吃掉落入陷阱的大象。只有敵方的陷阱才有此效果：棋子可以停在自己的陷阱上，並保持全部等級。',
  'You win immediately by moving any piece into the enemy den, capturing every enemy piece, or leaving your opponent with no legal move. You cannot move into your own den.':
    '任何一枚棋子走進敵方獸穴、吃光敵方所有棋子，或讓對手無合法著法，你都立即獲勝。棋子不能走進己方獸穴。',
  'Games draw on threefold repetition, or when 100 half-moves (50 by each player) pass with no capture.':
    '若同一局面出現三次，或連續 100 個半回合（每方 50 步）無吃子，則判和。',
  'This engine game shows a lion leap, a rat swim and capture an elephant, and the final entry into Blue’s den.':
    '這盤引擎對局展示獅子跳河、老鼠游水並吃掉大象，以及最後進入藍方獸穴。',
  'One of each animal in two colors is shuffled and placed face-down on the sixteen squares. Nobody knows what is under a tile until it is flipped. The first tile the first player flips sets that player’s color; the other player takes the other color.':
    '兩種顏色各一套八種動物，洗勻後背面朝上放在十六個格子裡。在翻開之前，誰也不知道棋子下面是什麼。先行者翻開的第一枚棋子決定其顏色，另一位玩家執另一色。',
  'On your turn, do one thing: flip one face-down tile, or move one of your revealed animals one square up, down, left, or right. Face-down tiles block movement and cannot be captured. You cannot pass.':
    '輪到你時只能做一件事：翻開一枚背面朝上的棋子，或把己方一枚已翻開的動物上下左右走一格。暗子會阻擋移動，也不能被吃。不能跳過回合。',
  'A flip reveals both the animal and its color to both players.':
    '翻開後，雙方都能看到該動物及其顏色。',
  'Captures and trades': '吃子與兌子',
  'Both colors use the same ladder. Strongest to weakest: elephant, lion, tiger, leopard, wolf, dog, cat, rat. A higher-ranked animal captures a lower-ranked enemy by moving onto its square. A weaker animal cannot capture a stronger one.':
    '兩種顏色使用同一等級順序。從強到弱是：象、獅、虎、豹、狼、狗、貓、鼠。高等級動物可以走到相鄰低等級敵子所在格將其吃掉，低等級動物不能吃高等級動物。',
  'The rat and elephant reverse the usual order: a rat can capture an elephant, while an elephant cannot capture a rat.':
    '鼠和象顛倒通常的等級關係：鼠可以吃象，象不能吃鼠。',
  'You win when your opponent has no animals left, or starts a turn with no legal flip or move. If the last animal of each color is removed in an equal-rank trade, the game is drawn.':
    '當對手沒有動物剩下，或回合開始時既不能翻棋也不能走棋，你獲勝。若雙方最後一隻動物在同級兌子中一同離場，則判和。',
  'Games draw on threefold repetition, or when 40 half-moves (20 by each player) pass with no flip, capture, or trade.':
    '若同一局面出現三次，或連續 40 個半回合（每方 20 步）沒有翻棋、吃子或同歸於盡，則判和。',
  'Mistboard also ends a fully revealed, one-animal-each position when neither side can force a win. Equal ranks are always dead because any meeting removes both; some unequal-rank chases are also unwinnable. These positions are drawn immediately.':
    '當棋子全部翻開、雙方各剩一隻動物且誰也無法強制獲勝時，Mistboard 也會結束對局。同級棋子必為死局，因為相遇會雙雙離場；某些不同等級的追逐也無法取勝。這些局面立即判和。',
  'This engine game shows two equal-rank trades: first the Lions, then the Elephants. Blue wins after Red’s last animal leaves the board.':
    '這盤引擎對局展示兩次同級兌子：先是雙方的獅子，再是雙方的大象。紅方最後一隻動物離場後，藍方獲勝。',
  'Engine vs engine': '引擎對引擎',
  'Red wins by reaching the den · 69 plies': '紅方進入獸穴獲勝 · 69 個半回合',
  'Red’s rat has already taken Blue’s elephant in the open, and with the strongest piece off the board Red walks a piece straight into Blue’s undefended den. Reaching the enemy den ends the game at once, no matter what material is left.':
    '紅方的老鼠已經在空地上吃掉了藍方的大象，最強的棋子離場後，紅方逕直把一枚棋子走進藍方無人防守的獸穴。進入對方獸穴會立刻結束對局，無論場上還剩多少子力。',
  'Engine self-play': '引擎自我對弈',
  'Blue wins by elimination · 36 plies': '藍方吃光對手獲勝 · 36 個半回合',
  'Both lions and both elephants have already traded off the board, and the pieces that survived all belong to Blue. Red has nothing left that can move, so the game ends: with no piece to move and no tile to flip, Red loses.':
    '兩隻獅子和兩頭大象都已同歸於盡離場，存活下來的棋子全部屬於藍方。紅方再無可走之子，於是對局結束：既沒有棋子可走，也沒有棋子可翻，紅方告負。',

  // -- Branded rules names --
  'Fog Chess Rules': '迷霧國際象棋規則',
  // The seoTitle: English carries two names for this game and Chinese carries
  // one, so both English keys land on the same Chinese title. That is the
  // point of seoTitle -- 'fog of war chess' is what players type.
  'Fog of War Chess Rules': '迷霧國際象棋規則',
  'Fog Chess rules: chess under Fog of War, where each side sees only the squares its pieces reach, there are no check warnings, and the king falls by capture.':
    '迷霧國際象棋規則：戰爭迷霧下的國際象棋。每一方只能看到己方棋子可及的格子，沒有將軍提示，王被吃掉即負。',
  "[Fog Chess](https://en.wikipedia.org/wiki/Dark_chess) is Mistboard's public name for dark chess, also called Fog of War chess. Jens Bæk Nielsen and Torben Osted invented it in 1989. It is the implicit-fog version of the idea: no umpire, no scan action. Each side's visibility is derived from where its pieces can legally move.":
    '[迷霧國際象棋](https://en.wikipedia.org/wiki/Dark_chess)是 Mistboard 對 dark chess / Fog of War chess 的公開名稱。Jens Bæk Nielsen 與 Torben Osted 於 1989 年發明了它。它屬於隱式迷霧：沒有裁判，也沒有偵察動作。每一方的視野完全由己方棋子的合法走法範圍推導而來。',
  'The rules of xiangqi: palaces, the river, cannon screens, facing generals, and a famous game to play through. Now playable on Mistboard against the Pikafish engine or a friend.':
    '象棋規則：九宮、楚河漢界、砲架、將帥照面，以及一盤可逐步回放的名局。現在可在 Mistboard 上與 Pikafish 引擎或好友對弈。',
  'Xiangqi, also known as Chinese chess, took its modern form in China during the Song dynasty (960 to 1279), when the cannon joined the board. Its ancestors run back several centuries earlier, and it shares a common root with chess, shogi, and janggi in the older Indian game chaturanga. It is now among the most widely played board games in the world.':
    '象棋的現代形態在宋代（960 至 1279 年）的中國成型，砲也在這一時期加入棋盤。它的前身可以追溯到更早幾個世紀，並與國際象棋、將棋、朝鮮象棋同源於更古老的印度遊戲恰圖蘭卡。今天它是世界上參與人數最多的棋類遊戲之一。',
  'Fog Xiangqi Rules': '迷霧象棋規則',
  'Fog of War Xiangqi Rules': '迷霧象棋規則',
  'Brian H. Liou designed Fog Xiangqi in 2026 as a Mistboard original. Fog of War has been played on the chess board since Jens Bæk Nielsen and Torben Osted invented dark chess in 1989, and chess.com runs it as a standard variant today. Nobody had carried it across to xiangqi. The cannon is the piece that makes it strange. It captures only by jumping over another piece, so under fog you are firing at something you cannot see, across a screen you are not certain is still there.':
    '迷霧象棋由 Brian H. Liou 於 2026 年設計，是 Mistboard 的原創變體。戰爭迷霧早在 1989 年就由 Jens Bæk Nielsen 和 Torben Osted 發明的「黑棋」引入西洋棋，如今也是 chess.com 的常規變體，卻從未有人把它移植到象棋上。真正讓它變得奇特的是砲。砲只能隔子吃子，所以在迷霧中，你既看不見目標，也無法確定砲架是否還在。',
  'Fog Xiangqi rules: xiangqi under Fog of War, where each side sees only the points its pieces reach, hidden blockers matter, and the general falls by capture.':
    '戰爭迷霧下的象棋：每一方只能看到己方棋子可及的點位，隱藏阻擋會影響視野，擒獲將帥即獲勝。',
  'Fog Xiangqi is xiangqi under Fog of War. Pieces keep their normal movement, but unseen enemy pieces stay hidden and danger is not announced. Capture the general to win.':
    '迷霧象棋是在戰爭迷霧下對弈的象棋。棋子保留正常走法，但看不見的敵方棋子會被隱藏，危險不會被提示。擒獲將帥即獲勝。',
  'If Xiangqi is new to you, start with [Xiangqi Rules](/rules/xiangqi). If you already play xiangqi, the sections below explain only what fog changes.':
    '如果你還不熟悉象棋，請先閱讀[象棋規則](/rules/xiangqi)。如果你已經會下象棋，下面只解釋迷霧改變了什麼。',
  'Orthodox xiangqi forbids facing generals. Fog Xiangqi allows the position; if one general sees the other on a clear file, it can capture across that file.':
    '正統象棋禁止將帥照面。迷霧象棋允許這個局面；如果一方將帥在無阻擋的直線上看見對方，就可以沿這條線直接擒獲。',
  'Banqi Rules': '暗棋規則',
  'Banqi Rules (Chinese Dark Chess)': '暗棋規則：玩法詳解與免費線上對弈',
  'Use [Xiangqi Rules](/rules/xiangqi) for the base game. This page covers what changes.':
    '基礎規則請參考[象棋規則](/rules/xiangqi)。本頁只說明變化之處。',
  Jieqi: '揭棋',
  'Fog Chess': '迷霧國際象棋',
  'Standard chess rules, the primer behind Fog Chess: castling, promotion, en passant, the draw rules, and a famous game to play through.':
    '普通國際象棋規則，也就是迷霧國際象棋背後的基礎：王車易位、升變、吃過路兵、和棋規則，以及一盤可逐步回放的名局。',
  'Chess is the open-information base game. Add Fog of War for Fog Chess, where enemy pieces outside your vision disappear and the king falls by capture.':
    '國際象棋是資訊公開的底層遊戲。為它加上戰爭迷霧，便得到迷霧國際象棋：你視野之外的敵方棋子會消失，而王由被吃而落敗。',
  'Read Fog Chess': '閱讀迷霧國際象棋',
  "Fog Chess with a sealed opening draft: each player picks one of three Chess960 back ranks and never sees the other's.":
    '帶密封開局選擇的迷霧國際象棋：每位玩家從三個 Chess960 底線陣型中選擇一個，且永遠看不到對手選擇了哪個。',
  'Programming Fog Chess with Server-Side Truth': '用伺服器端真實局面實現迷霧國際象棋',
  'Fog Chess adds one hidden-information rule to chess: each side sees only the squares its own pieces reach. The implementation question is where that rule runs. On Mistboard, it runs on the server, so the browser receives a `PlayerView`, not a full board with fog painted over it.':
    '迷霧國際象棋給國際象棋增加了一條隱藏資訊規則：每一方只能看到己方棋子可及的格子。實作問題在於這條規則在哪裡執行。在 Mistboard 上，它執行在伺服器端，所以瀏覽器收到的是一個 `PlayerView`，而不是蓋著迷霧圖層的完整棋盤。',
  'Play Misty in Fog Chess, or read the rules article for the player-facing version of the same visibility model.':
    '來玩 Misty 的迷霧國際象棋，或閱讀面向玩家的規則文章，了解同一套視野模型。',
  'Read Fog Chess Rules': '閱讀迷霧國際象棋規則',
  'Jungle Chess Rules (Dou Shou Qi, Animal Chess)': '鬥獸棋規則：玩法詳解與免費線上對弈',
  "Jungle Chess, also called Dou Shou Qi or Animal Chess: eight ranked animals on a 7 by 9 board, rivers only the rat can cross, and a race to the opponent's den. Play rated games and analyse them free in your browser.":
    '鬥獸棋（又稱動物棋）規則詳解：棋盤 7×9，八種按等級排列的動物，只有老鼠能過的河，以及衝入對方獸穴的競賽。免費線上對弈，支援等級分與覆盤分析。',
  'Jungle has been played online for years, mostly in apps and on Chinese game portals. Rated games, a post-game review, and an engine that tells you where it went wrong have not come with it. The serious Jungle engine work sits in academic papers and endgame tablebases, nowhere you can actually play. Mistboard puts all three in one place.':
    '鬥獸棋在網上已經玩了很多年，大多在手機應用和中文遊戲平台上。但等級分對局、賽後覆盤，以及一台能告訴你哪一步走錯的引擎，一直沒有跟上。真正認真的鬥獸棋引擎研究留在學術論文和殘局庫裡，沒有落在任何能實際對弈的地方。Mistboard 把這三件事放在了一起。',
  'Jungle Chess is a two-player strategy game about rank and terrain. Each side commands eight animals and tries to reach the enemy den or eliminate the enemy army.':
    '鬥獸棋是一種圍繞等級與地形展開的雙人策略遊戲。雙方各指揮八種動物，目標是進入敵方獸穴或消滅敵方全部棋子。',
  'Flip Jungle Rules (Flip Dou Shou Qi)': '翻翻棋規則：玩法詳解與免費線上對弈',
  'The 4×4 flip version of Jungle Chess, also called flip Dou Shou Qi or flip animal chess. Every animal starts face-down, you flip to reveal, and equal ranks trade off the board. Play it free in your browser.':
    '鬥獸棋的 4×4 翻面版本，又稱翻翻棋。所有動物開局均背面朝上，翻開即亮明身分，等級相同的雙方同歸於盡、一起離場。免費線上對弈，無需註冊。',
  'Jieqi Rules (Reveal Xiangqi)': '揭棋規則：玩法詳解與免費線上對弈',
  'Ranks and captures': '等級與吃子',
  'Each side has the same eight animals. Strongest to weakest: elephant, lion, tiger, leopard, wolf, dog, cat, rat. A piece captures an adjacent enemy of equal or lower rank.':
    '雙方各有相同的八種動物。從強到弱是：象、獅、虎、豹、狼、狗、貓、鼠。棋子可吃相鄰的同級或低級敵子。',
  'The rank exception connects the ends of the ladder: a rat on land can capture an elephant, while an elephant cannot capture a rat.':
    '等級例外連接序列兩端：陸地上的鼠可以吃象，象不能吃鼠。',
  'On land, the lowest-ranked rat can capture the highest-ranked elephant.':
    '在陸地上，等級最低的鼠可以吃等級最高的象。',
  'One square, four directions.': '一格，四個方向。',
  'The river is not a move for a land animal.': '對陸地動物來說，河格不是可走的一步。',
  'The rat can step off the bank into the river.': '鼠可以從岸上走進河裡。',
  'In the water it is safe: the wolf is not a target, and it cannot reach the rat either.':
    '在水中它很安全：狼不是它可吃的目標，狼也吃不到它。',
  'The lion clears either river sideways.': '獅可以橫向跳過任意一條河。',
  'The same jump lengthwise, landing on the wolf and taking it.':
    '同樣的跳躍沿河的長邊進行，落在狼所在格並把它吃掉。',
  'The tiger clears the river the long way.': '虎沿河的長邊跳過整條河。',
  'The tiger on the lion’s square: no sideways jump.': '同一格換成虎：沒有橫向跳躍。',
  'The elephant cannot take the rat back.': '象無法反過來吃掉鼠。',
  'A revealed animal steps one square.': '已翻開的動物走一格。',
  'On red’s trap the lion is rank 0, so a cat takes it.':
    '站在紅方陷阱上的獅等級歸零，因此連貓也能吃掉它。',
  'Red’s own trap costs red nothing: the cat still cannot touch the elephant.':
    '紅方停在自己的陷阱上毫無損失：貓依然吃不到象。',
  'One step into the den ends the game. Rank does not matter, and neither does the trap square.':
    '走進獸穴一步即可結束對局。等級無關緊要，腳下是不是陷阱格也無關緊要。',
  'How the animals move': '動物如何移動',
  Rat: '鼠',
  'The rat is the only animal that can enter water. A rat in a river can move and capture another rat there, but no piece can capture across the shoreline: a land rat cannot capture into water, and a water rat cannot capture onto land.':
    '鼠是唯一能進入水中的動物。河中的鼠可以移動，也可吃掉另一隻河中的鼠，但任何棋子都不能隔著水岸吃子：陸地上的鼠不能吃進水中，水中的鼠也不能吃上陸地。',
  Lion: '獅',
  Tiger: '虎',
  'The tiger can move one land square normally or leap vertically across a river. Unlike the lion, it cannot leap horizontally. A rat of either color on any water square in the path blocks either animal’s jump.':
    '虎可以在陸地上正常移動一格，也可縱向跳過河流。與獅不同，它不能橫向跳河。路徑上任何水格裡只要有一隻任意顏色的鼠，就會阻止兩種動物跳躍。',
  'Flip Jungle is a compact hidden-piece relative of [Jungle Chess](/rules/jungle). All sixteen animals begin face-down on a 4×4 board. There are no rivers, dens, or traps: reveal tiles, move your animals, and eliminate the other color.':
    '翻翻棋是[鬥獸棋](/rules/jungle)的緊湊型隱藏棋子變體。十六枚動物棋子全部背面朝上放在 4×4 棋盤上。這裡沒有河流、獸穴或陷阱：翻開棋子、移動動物，並消滅另一種顏色。',
  'FIRST FLIP ASSIGNS COLOR': '首次翻子決定顏色',
  'CANNON SCREEN CAPTURE': '砲隔子吃',
  'CAPTURED PIECE KNOWLEDGE': '被吃暗子資訊',
  HIGH: '高',
  LOW: '低',
  General: '將',
  Advisor: '士',
  Elephant: '象',
  Chariot: '車',
  Horse: '馬',
  Cannon: '砲',
  Soldier: '卒',
  'RED KNOWS': '紅方知道',
  'BLACK KNOWS': '黑方知道',
  'the captured piece was a horse': '被吃的是馬',
  'one dark piece disappeared': '一枚暗子消失了',
  'Attacking, the cannon jumps a screen and ignores rank.': '砲進攻時隔一子跳吃，不看等級。',
  'As a target it ranks here: taken by horse and up, never by a soldier.':
    '作為目標時，砲排在這裡：馬以上可吃，卒不可吃。',
  'CAPTURE RANK LADDER': '吃子等級序列',
  // skill-vs-luck (drafted; native validation pending before the slug joins TRANSLATED_ARTICLE_SLUGS)
  '/article-thumbs/skill-vs-luck-summary.png': '/article-thumbs/skill-vs-luck-summary.zh-hant.png',
  'for each tile the square could be:\n    put that tile under the square\n    play the flip\n    evaluate the position\naverage the results, weighted by count':
    '對這個格子可能是的每一枚棋：\n    把那枚棋放到格子下\n    走這步翻子\n    評估局面\n按數量加權，取平均',
  'decision loss = best - played      (skill, always >= 0)\nluck          = realized - played  (the dice, signed)':
    '決策損失 decision loss = best - played      （實力，恆 >= 0）\n運氣　　 luck          = realized - played  （骰子，帶符號）',
  'BEFORE: THE G3 TILE, FACE DOWN': '翻子前：g3 背面朝下',
  'AFTER: MY OWN SOLDIER': '翻子後：我自己的卒',
  'as played': '實際對局',
  'if every flip ran average': '每次翻子按平均',
  'accumulated luck': '累積運氣',
  'the +37 flip': '+37 的那次翻子',
  'Red better': '紅優',
  'Black better': '黑優',
  played: 'played（所走）',
  best: 'best（最佳）',
  realized: 'realized（實際）',
  'the average value of the flip you chose': '你所選翻子的平均價值',
  'the same average for the best move available': '當前最佳著法的同一種平均',
  'what your actual tile produced': '實際翻出的棋子帶來的結果',
  'black soldier': '黑卒',
  'red soldier': '紅卒',
  'red chariot': '紅車',
  'red elephant': '紅象',
  'red advisor': '紅士',
  'red cannon': '紅炮',
  'black horse': '黑馬',
  'black chariot': '黑車',
  'black elephant': '黑象',
  'black advisor': '黑士',
  'black cannon': '黑炮',
  'black general': '黑將',
  'human record': '人類戰績',
  '14 wins, 33 losses, 5 draws': '14 勝 33 負 5 和',
  'net luck toward the human, in the wins': '勝局中偏向人類的淨運氣',
  '+28 points on average': '平均 +28 個百分點',
  'net luck toward the human, in the losses': '負局中偏向人類的淨運氣',
  '−9 points on average': '平均 −9 個百分點',
  'The game from the intro, live on Mistboard': '開頭那盤棋，在 Mistboard 上公開',
  'Black wins · 156 plies · net luck +88 to Black': '黑勝 · 156 個半回合 · 淨運氣 +88 偏向黑方',
  'Black wins when Red runs out of moves. The decision numbers say Red earned the better game; the tiles said otherwise, starting with the flip at ply 6.':
    '紅方無棋可走，黑方獲勝。決策數字說紅方下出的棋更好；棋子們說了反話，從第 6 個半回合的那次翻子開始。',
  'Separating Skill from Luck in Flip Games': '把翻子棋的實力和運氣分開',
  // The seoTitle, which names the three variants where the on-page title does not.
  'Game Review for Banqi, Jieqi and Flip Jungle: Skill vs Luck':
    '暗棋、揭棋和翻翻棋的對局複盤：實力與運氣',
  'Half the moves in banqi, jieqi, and flip jungle are dice rolls, so a chess-style review blames you for variance. Mistboard’s game review splits every flip into the decision and the tile: luck-stripped accuracy, a luck line on the advantage graph, and what 52 human-versus-engine games say about who really earned their wins.':
    '暗棋、揭棋和翻翻棋裡，一半的著法其實是擲骰子，照搬國際象棋的覆盤就會把運氣算到你頭上。Mistboard 的對局覆盤把每次翻子拆成決策和翻出的棋子兩部分：去除運氣的準確率、優勢圖上的運氣曲線，以及 52 盤人機對局告訴我們誰的勝利才是真本事。',
  'Mistboard’s game review now splits every flip into the decision you made and the tile you got. The first thing I did was run it over my own old games. It found a banqi win of mine against our own bot, from two months back, and handed the credit to the tiles.':
    'Mistboard 的對局覆盤現在會把每次翻子拆成兩部分：你做的決策，和你翻出的棋子。我做的第一件事，就是拿它跑了一遍自己的舊棋。它翻出了我兩個月前贏自家引擎的一盤暗棋，然後把功勞記在了翻出的棋子上。',
  'The review scores everything in win chance, its 0-to-100 estimate of your odds of winning the game. My flips came out **76 points better than average**. The bot’s came out 12 points worse. I made the worse decisions, by a wide margin. I won anyway.':
    '覆盤用勝率來計分：它對你贏下這盤棋的把握給出 0 到 100 的估計。我的翻子總共比平均**好出 76 個百分點**。引擎的差了 12 個百分點。論決策我下得明顯更差。可我還是贏了。',
  'The flip that decided it, from the real game. One face-down tile on g3, twelve possible pieces. This article is about pricing that moment honestly.':
    '決定勝負的那次翻子，來自真實對局。g3 上一枚背面朝下的棋子，可能是十二種身份中的任何一種。這篇文章要做的，就是誠實地給這一刻定價。',
  'Most game review tools cannot say any of that.': '大多數覆盤工具一句都說不出來。',
  'A flip is a decision plus a dice roll': '翻子是一次決策加一次擲骰',
  'Half the moves in a banqi game turn over a face-down tile. One move, two parts: choosing which tile to turn, and finding out what it is. Jieqi’s reveals and flip jungle’s flips are the same problem wearing different pieces; banqi is the worked example throughout because its bag is the purest.':
    '暗棋裡一半的著法是翻開一枚背面朝下的棋子。一步棋，兩件事：選哪枚翻，以及翻出來是什麼。揭棋的揭子和翻翻棋的翻子是同一個問題換了棋子；全文用暗棋做例子，因為它的隨機性最純粹。',
  'A chess-style review grades the swing of the whole move. Flip the corner tile, find the enemy general, and the review calls it a blunder. It was a bad tile, not a bad decision.':
    '照搬國際象棋的覆盤會給整步棋的勝率波動打分。翻開角落那枚棋，翻出對方的將，覆盤就記你一個漏著。可那是一枚壞棋子，不是一個壞決策。',
  'This is why banqi reviews on Mistboard show no centipawn loss: it cannot be separated from the tiles, so next to numbers that can be, it reads as noise.':
    '這就是 Mistboard 的暗棋覆盤不顯示釐兵損失的原因：它沒法和翻出的棋子分開，放在那些可以分開的數字旁邊，就只是噪音。',
  'Backgammon solved this decades ago': '西洋雙陸棋幾十年前就解決了這件事',
  'Backgammon software prices every roll against the average roll and reports a luck-adjusted result, so a match report can tell you that you played better and lost. GnuBG and eXtreme Gammon both do it. Poker has the same idea in all-in EV.':
    '西洋雙陸棋的軟體會把每次擲骰和平均擲骰作比較，報告一個剔除運氣後的結果，所以一份戰報可以告訴你：你下得更好，但你輸了。GnuBG 和 eXtreme Gammon 都這麼做。撲克裡的 all-in EV 是同一個思路。',
  'Chess never built any of this because chess has no dice. Banqi is a chess-family game with dice in it, and it inherited chess’s tools, which have no luck column.':
    '國際象棋從沒造過這些東西，因為它沒有骰子。暗棋是象棋家族裡帶骰子的一員，卻繼承了國際象棋的工具，而那些工具裡沒有運氣這一欄。',
  'The average tile in the bag': '剩下棋子裡的平均一枚',
  'Banqi’s chance is countable. Both players can see which tiles are still face down, and the full set of pieces is known, so at any flip you can list every tile that square could be. That makes the honest baseline computable:':
    '暗棋的隨機性是數得清的。雙方都看得到哪些棋子還背面朝下，整副棋的構成也是公開的，所以任何一次翻子，你都能列出那個格子上可能翻出的每一枚棋。這讓誠實的基準變得可以計算：',
  'That average is what your decision was worth **before the dice**. Three numbers per flip:':
    '這個平均值，就是你的決策在**擲骰之前**的價值。每次翻子三個數字：',
  'per flip': '每次翻子',
  meaning: '含義',
  'Zero luck is exactly the average tile in the bag, by construction, not by an engine’s opinion.':
    '運氣為零，恰好就是翻出剩下棋子裡的平均一枚。這是由構造保證的事實，不是引擎的看法。',
  'The flip from the intro, enumerated': '開頭那次翻子，逐一列舉',
  'Ply 6 of the game this article opens with: I turn the tile on g3. Twenty-seven tiles are still face down, twelve kinds, and each one leads to a different game.':
    '本文開頭那盤棋的第 6 個半回合：我翻開 g3 上的棋子。此時還有二十七枚背面朝下，共十二種身份，每一種都通向一盤不同的棋。',
  'what the g3 tile could be': 'g3 這枚棋可能是什麼',
  count: '數量',
  'win% for Black': '黑方勝率',
  'The same flip is worth anywhere from 13% (my own general, deep in contested ground) to 82% (my own soldier, safe and useful there). The weighted average is 45%. **That number is the decision**, and it is what accuracy grades.':
    '同一次翻子的價值從 13%（翻出我自己的將，深陷爭奪之地）到 82%（我自己的卒，在那裡既安全又有用）不等。加權平均是 45%。**這個數字才是決策本身**，準確率打分打的就是它。',
  'The highlighted row is what the bag actually handed me. Realized 82, played 45, luck plus 37, and none of it to my credit.':
    '高亮的那一行就是實際翻出的結果。實際 82，決策 45，運氣 +37，而這份運氣沒有一點是我掙來的。',
  'Engines are biased about their own dice': '引擎對自己的骰子有偏心',
  'The obvious shortcut is to ask the engine what a flip move is worth and call the difference luck. Our jieqi engine showed why not: it over-values its reveals and plays greedy, gambling lines. Averaging fixed positions, each with the tile already decided, keeps the chance node out of the search entirely, so the bias has nowhere to live.':
    '最省事的捷徑，是直接問引擎一步翻子值多少，再把差值叫作運氣。我們的揭棋引擎演示了為什麼不行：它高估自己的揭子，下出貪婪、賭博式的著法。而對一組身份已經確定的固定局面取平均，讓機率節點完全不進搜尋，偏心就無處安身。',
  'The flip that deals you your color': '決定你執哪色的那次翻子',
  'The first flip of the game decides which color you play: whatever ink comes up, that side is yours. The counterfactuals for that flip vary your own army, so the decomposition prices "which side did I get" as luck. That sounds wrong for about ten seconds, and then it sounds exactly right.':
    '開局第一次翻子決定你執哪種顏色：翻出什麼色，你就執什麼色。這次翻子的反事實會改變你自己的整支軍隊，所以這套拆分把"我分到哪一邊"也計成運氣。乍聽之下不太對勁，想上十來秒就完全對了。',
  'What the review draws': '覆盤畫出什麼',
  'The game from the intro. Solid: the game as played, from Red’s side. Dashed: the same game with every flip at its average. The gap is the luck.':
    '開頭那盤棋。實線：實際進行的對局，從紅方視角。虛線：同一盤棋，每次翻子都按平均值計。兩線之間的差距就是運氣。',
  'The advantage graph gets a second line. Solid is the game as it happened. Dashed is the same game with every flip scored at its average tile. Between flips the two lines move together, because ordinary moves affect both versions equally. At each flip the gap changes by exactly that flip’s luck, so by the end the gap is the whole game’s luck added up.':
    '優勢圖多了一條線。實線是實際發生的對局。虛線是同一盤棋，每次翻子都按平均的那一枚計分。兩次翻子之間，兩條線同步移動，因為普通著法對兩個版本的影響完全一樣。每到一次翻子，差距就恰好按那次翻子的運氣變化，所以到終局時，兩線的差距就是整盤棋的運氣總和。',
  'That is why the dashed line here runs one way while the solid line swings. My luck kept landing in the same direction, flip after flip, so the gap only grew. Scored on decisions alone the bot was winning nearly throughout, and once the dashed line says the game should be completely won it pins at the top.':
    '這也是為什麼圖裡的虛線一路朝一個方向走，而實線上下翻騰。我的運氣一次又一次落在同一側，差距只增不減。只看決策的話，引擎幾乎全程佔優；一旦虛線認定這盤棋照理已經完勝，它就頂在最上沿不動了。',
  'The move list carries the split per move. Every flip gets a dice badge with its luck, next to the eval, and decisions are graded separately: move 3 below is the +37% flip, marked dubious as a choice even though it won me the game.':
    '著法列表把這份拆分標到每一步上。每次翻子都帶一個骰子標記，寫著它的運氣，就在評估值旁邊；決策則單獨打分：下圖第 3 步就是那次 +37% 的翻子，雖然它幫我贏了棋，作為選擇卻被標為可疑。',
  'The exhibit game’s move list. Move 3 is the +37% flip, dubious as a decision.':
    '示例對局的著法列表。第 3 步是那次 +37% 的翻子，作為決策被標為可疑。',
  'The review move list: each flip carries a dice badge with its luck percentage beside the eval, and move 3, the +37% flip, is graded ?! as a decision.':
    '覆盤著法列表：每次翻子的評估值旁都有骰子標記標出運氣百分比；第 3 步即 +37% 的那次翻子，作為決策被標為 ?!。',
  'And accuracy is graded on the decision numbers only, so a lucky flip does not improve it and an unlucky one does not hurt it. The summary for this game reads exactly the way the story went: the bot played clean, I did not, and the result said otherwise.':
    '而準確率只按決策數字打分，翻得走運不會加分，翻得倒黴也不會扣分。這盤棋的總結和故事本身完全一致：引擎下得乾淨，我則不然，而結果卻說了反話。',
  'The same game’s luck-stripped summary. dev-testing is me, on my test account.':
    '同一盤棋去除運氣後的總結。dev-testing 是我，用的是我的測試賬號。',
  'The luck-stripped accuracy summary for the exhibit game: MistyBanqi 95% accuracy with no mistakes, dev-testing 89% with nine inaccuracies, two mistakes, and two blunders.':
    '示例對局去除運氣後的準確率總結：MistyBanqi 準確率 95%，零失誤；dev-testing 89%，九次失準、兩次錯著、兩次漏著。',
  'The receipts': '證據',
  'The win I opened with: 156 plies against the bot, and the graph tells on me. At ply 6 the 45% flip came up worth 82%. No decision in the game moved the needle that far.':
    '開頭那場勝利：對引擎的 156 個半回合，圖把我供了出來。第 6 個半回合，那次值 45% 的翻子翻出了 82%。整盤棋裡沒有任何一個決策能把指標撥得這麼遠。',
  'In total: my flips **plus 76**, the bot’s minus 12, and my flip decisions gave away 74 points against the bot’s zero. The dashed line has me losing most of the game. The solid line has me winning. The bag overruled the play. The whole game is [open on Mistboard](/banqi/game/bq_7e8ce2e7-8e64-4453-b9fd-9dcc4bd52fa9), replay below.':
    '總賬：我的翻子**+76**，引擎的 −12；翻子決策上我送掉 74 個百分點，引擎送掉 0。虛線裡我大半盤都在輸。實線裡我贏了。棋子推翻了棋藝。整盤棋[在 Mistboard 上公開](/banqi/game/bq_7e8ce2e7-8e64-4453-b9fd-9dcc4bd52fa9)，下方可以回放。',
  'Step to ply 6: the flip worth 45% on average that came up worth 82%.':
    '走到第 6 個半回合：平均價值 45% 的那次翻子，翻出了 82%。',
  'It cuts the other way too. In [another game](/banqi/game/bq_123a6232-6f9f-4677-90ae-a75d5700a446) I lost, one flip at ply 19 cost 34 points of win chance on its own. My decisions that game were ordinary. The old review would have marked that flip as the losing blunder. The new one marks it as the moment the game was decided by something that was not a choice.':
    '反過來也一樣。在我輸掉的[另一盤棋](/banqi/game/bq_123a6232-6f9f-4677-90ae-a75d5700a446)裡，光是第 19 個半回合的一次翻子，就燒掉了 34 個百分點的勝率。那盤棋我的決策平平。舊式覆盤會把那次翻子記為致敗漏著。新的覆盤把它記為：勝負在此刻被一件不由你選擇的事定了下來。',
  'Fifty-two games of evidence': '五十二盤棋的證據',
  'We ran the decomposition over 52 recent human-versus-Misty banqi games from the site.':
    '我們把這套拆分跑遍了站上最近 52 盤人類對 Misty 的暗棋。',
  'across 52 human vs Misty games': '52 盤人類對 Misty 的對局',
  value: '數值',
  'The bot is stronger, and beating it has usually taken help from the bag. If you have beaten it, the review will now tell you how much help you got.':
    '引擎更強，贏它通常都借了棋子的力。如果你贏過它，現在覆盤會告訴你借了多少。',
  'Jieqi rolls different dice': '揭棋擲的是另一種骰子',
  'Jieqi gets the same treatment with a different pool. A jieqi reveal draws from your own remaining dark pieces, so you know the color and not the piece. A banqi tile is dark to both players, color included. Different bags, same arithmetic, and jungle’s flip variant makes a third. Every one of them gets the dashed line.':
    '揭棋用同一套辦法，只是抽取的範圍不同。揭棋的揭子從你自己剩餘的暗子裡抽，所以你知道顏色，不知道身份。暗棋的棋子對雙方都是暗的，連顏色也是。範圍不同，演算法相同，鬥獸棋的翻棋版本（翻翻棋）是第三家。它們每一個都有那條虛線。',
  'For the builders': '寫給實現者',
  'Three choices keep the numbers honest. First, **a counterfactual must not change what is in the bag**. Relabel the flipped square from a soldier to a cannon and you have quietly added a cannon to the game and removed a soldier, which rebalances the position by two pieces and inflates the average. So the implementation swaps: the counterfactual tile trades places with a face-down square that really holds one, and the hidden set stays exactly the game’s.':
    '三個選擇讓這些數字保持誠實。第一，**反事實不能改變剩下棋子的構成**。把翻開的格子從卒改標成炮，你就悄悄往棋局裡加了一枚炮、拿走了一枚卒，局面因此偏移兩枚棋子的分量，平均值也被抬高。所以實現裡用的是交換：讓反事實身份和一個確實藏著這枚棋的背面格子對調，隱藏棋子的集合始終恰好等於這盤棋的集合。',
  'Second, **one bounded scale**. Everything is win chance from the flipping player’s side: it adds up across a game, a flip that ends the game scores exactly 100, 50, or 0, and a flip that walks into mate has no centipawn value anyway. Search budgets are node counts rather than time, so the same game grades identically on any machine.':
    '第二，**一把有界的尺子**。一切都用翻子一方視角的勝率來計：它可以在整盤棋上累加；直接終局的翻子恰好計 100、50 或 0；而一步翻進殺局的棋本來就沒有釐兵值可言。搜尋預算按節點數而非時間計，同一盤棋在任何機器上打出的分都一樣。',
  'Third, **under-count on purpose**. The decision ceiling considers only the engine’s top move, so a better move the engine ranked second is missed and decision loss is only ever understated. The review can fail to flag a mistake. It cannot invent one.':
    '第三，**故意往少裡算**。決策上限只考慮引擎的第一選擇，被引擎排在第二的更好著法會被漏掉，所以決策損失只會被低估。覆盤可能漏報一個失誤，但絕不會憑空捏造一個。',
  'Where the numbers stop': '數字到哪裡為止',
  'The win percentages come from our banqi engine at a fixed search budget, and that engine is also the opponent in these games, so its own flips grade as near-perfect partly because it agrees with itself. Read "the bot lost zero points" with that in mind. The human numbers have no such problem.':
    '這些勝率出自我們的暗棋引擎在固定搜尋預算下的評估，而這個引擎同時也是這些對局裡的對手，所以它自己的翻子被打成近乎完美，部分原因不過是它在認同自己的選擇。看到"引擎零損失"時，請記住這一點。人類一側的數字沒有這個問題。',
  'One more honest limit: subtracting luck point-by-point treats win chance as linear, which it is not. The directions are trustworthy. The second decimal is not.':
    '還有一條誠實的邊界：逐點扣除運氣，等於把勝率當成線性的，而它並不是線性的。方向可信。小數點後第二位不可信。',
  'Try it on your own games': '拿你自己的棋試試',
  'Open any finished banqi, jieqi, or jungle flip game on Mistboard, yours or anyone’s from the [watch page](/watch), and request computer analysis. The luck numbers appear per flip in the move list, and the dashed line shows the game the bag would have given you.':
    '在 Mistboard 開啟任何一盤下完的暗棋、揭棋或翻翻棋，你自己的，或[觀戰頁](/watch)上任何人的，然後請求電腦分析。運氣數字會逐翻子出現在著法列表裡，虛線則畫出棋子們本該給你的那盤棋。',
  'Sometimes it agrees you were robbed. Sometimes it takes your win away. It did both to me in a single pass over my old games.':
    '有時它承認你是被搶了。有時它把你的勝利收走。在對我舊棋的一輪掃描裡，這兩件事它都做了。',
  'Play Banqi': '下暗棋',
  'Play Jieqi': '下揭棋',
  'Play Jungle Flip': '下翻翻棋',
  // riverbank-cannon (drafted 2026-08-23; machine battery applied, native read pending)
  'The Riverbank Cannon Problem': '巡河炮問題',
  'Fog Xiangqi Opening Theory: The Riverbank Cannon': '迷霧象棋開局理論：巡河炮',
  'Red’s opening cannon reaches the riverbank first, one move from firing down any of five files, and in fog you never see it coming. Whether that breaks the game came down to one elephant move, one poisoned defense, and a coin flip we priced with the engine.':
    '紅方的起手炮搶先趕到河沿，只差一步就能沿五條縱線中的任何一條開火，而在迷霧裡你根本看不見它的到來。這會不會毀掉整個棋種，最終落在一步飛象、一個有毒的防守，以及一次我們用引擎算清了價碼的硬幣對賭上。',
  'Fog xiangqi is xiangqi with two changes: you only see the points your own pieces could move to, and there is no check. Capture the general and the game ends.':
    '迷霧象棋就是改了兩條規則的象棋：你只能看見自己棋子能走到的交叉點，而且沒有將軍。擒獲將帥，對局即告結束。',
  'That makes Red’s first move alarming. Slide the opening cannon to the riverbank and it is one move from firing down any of five files: two chariots, two elephants, and behind the center soldier, the general. One capture ends the game. I built this variant, and I wondered if it was dead on arrival.':
    '這讓紅方的第一步變得令人不安。起手把炮拉上河沿，它就只差一步便能沿五條縱線中的任何一條開火：兩個車、兩個象，還有中卒身後的將。吃一子就能終結對局。這個變體是我做的，我一度懷疑它是不是一落地就死了。',
  'The dots are the five firing points. From each one the cannon shoots the piece behind the soldier screen: chariot, elephant, general, elephant, chariot.':
    '圓點是五個開火點。從每個點上，炮都隔著一枚卒作炮架，打中它身後的那枚棋子：車、象、將、象、車。',
  'So I checked, against the real rules kernel and our fog engine. Short version: the threat is worse than it looks, the natural defense is a trap, and the game survives.':
    '於是我去驗證了，用的是真實的規則核心和我們的迷霧引擎。簡短版結論：威脅比看上去更兇，最自然的防守是個陷阱，而這個棋種活了下來。',
  'The rush is invisible': '速攻是隱形的',
  'The b-file route announces itself: Black’s cannon watches that file and sees something land on the riverbank. Red does not have to go that way. Up the empty d-file, nothing Black owns sees a single point: d3, d5, e5, mate on move 4. The only warning is that a red piece left home, which describes every game ever played.':
    '走 b 路會自報行蹤：黑方的炮盯著這條縱線，能看見有東西落到河沿上。但紅方不必走那條路。沿著空空的 d 路上去，黑方沒有任何棋子能看見其中任何一個點：d3、d5、e5，第 4 回合擒將。唯一的警報只是「有一枚紅子離開了原位」，而這句話描述的是古往今來的每一盤棋。',
  'One move before mate. Left: the truth. Right: everything Black can see. The cannon never enters the picture.':
    '擒將前一步。左：真實局面。右：黑方能看見的一切。炮自始至終沒有進入畫面。',
  'So the defense cannot wait for a warning; it has to be played every game. The rest of the article draws the visible route so the diagrams read easily. The threats are the same either way.':
    '所以防守不能等警報響了再做，它必須每盤都走。本文其餘部分為了圖示清晰，一律畫可見的那條路線。兩條路線的威脅完全相同。',
  'The natural defense is a landmine': '最自然的防守是顆地雷',
  'There is exactly one screen between cannon and general: Black’s own center soldier. A cannon needs exactly one, so any second body on the center file kills the mate. The natural pick is advisor up. It seals the center and nothing else, and it plants a mine: Red slides to an elephant wing and takes.':
    '炮與將之間恰好隔著一個炮架：黑方自己的中卒。炮吃子恰好需要一個炮架，所以在中路上再墊進任何一枚棋子，擒將就不成立了。最順手的選擇是補士。它封住中路，除此之外什麼也不做，還埋下一顆地雷：紅炮平到一側象所在的縱線，隔著卒把象吃掉。',
  'Red guessed the wing whose advisor stayed home. The cannon fires along the back rank through it, the marked flight point loses to the same shot, and the sealing advisor blocks the only parry. All 41 legal replies lose, engine-checked. The other wing costs only an elephant.':
    '紅方猜中了士還留在原位的那一翼。炮沿底線隔著這枚士開火，標記的出逃點同樣挨這記炮，而支上去的那枚士又恰好堵住了唯一的解法。經引擎窮舉，41 種合法應著全部敗北。紅方猜向另一翼時，黑方只損失一個象。',
  'There is a save: play the poisoned wing’s elephant to the middle immediately, and both grabs die. But that is the move you should have opened with. The advisor spends a whole move doing a fraction of the elephant’s job, and while you fix it, Red takes a rim chariot for free.':
    '有一手解救：立刻把有毒一翼的象飛上中路，兩個吃象點就同時失效。但這本該是你開局的第一步。補士花掉整整一步，卻只做了飛象工作的一小部分，而在你補救的同時，紅方白吃一個邊線的車。',
  'One elephant move holds everything': '一步飛象守住一切',
  'The move that works is the standard developing move of xiangqi: elephant to the middle.':
    '真正管用的，是象棋裡最標準的出子著法：飛中象。',
  'Second screen on the center file, so the snipe is marked dead; both elephant home points covered by the recapture.':
    '中路多了第二個炮架，狙擊宣告失效（圖中打叉處）；兩個象位原點都有回吃保護。',
  'Snipe dead, both elephant wings covered, one move. Xiangqi theory reached this square centuries before the fog did. A cannon to the same point works too.':
    '狙擊廢了，兩翼的象都有保護，只用一步。象棋理論比迷霧早幾百年就走到了這個點上。把炮走到同一個點同樣管用。',
  'The chariot gamble': '賭車',
  'That leaves the edges: from the riverbank corner the cannon shoots the chariot through the edge soldier, and the elephant does nothing about it.':
    '剩下的是兩條邊線：炮從河沿的邊角隔著邊卒打車，而中象對此無能為力。',
  'Move order decides this. The mate cannot arrive before Red’s third move, so the elephant is still in time on Black’s second. The edges cannot wait: Red picks his corner on his second move, and a soldier pushed after that is too late. So soldier first, elephant second. The pushed soldier watches the one point the cannon must fire from, and eats it on arrival.':
    '這件事由行棋次序決定。擒將最早也要等到紅方第三步，所以黑方第二步飛象還來得及。邊線卻等不起：紅方第二步就要選定邊角，之後再推的卒已經遲了。所以先挺卒，再飛象。推上去的卒正好盯住炮必須開火的那個點，炮一落地就被吃掉。',
  'The same push, one move apart. Played first, the soldier watches the arrival point and the cannon dies on landing. Played second, the cannon shoots the chariot straight over it: a pushed soldier still counts as one screen.':
    '同一步挺卒，只差一個回合。先走，卒盯住落點，炮一落地就死。後走，炮直接隔著它把車打掉：推過的卒照樣只算一個炮架。',
  'That leaves one honest gamble. Red commits blind to a corner on move two: half the time it is the watched one and he trades his cannon for a soldier, half the time he wins a chariot. Played out by the engine, the branches roughly cancel. One fair coin flip per game, and only if Red commits immediately: given a third move, Black closes both edges.':
    '於是只剩一場堂堂正正的賭局。紅方第二步盲選一個邊角：一半機率選中被盯住的那邊，用炮換一個卒；另一半機率贏下一個車。交給引擎跑完後續，兩條分支大致相抵。每盤只有一次公平的擲硬幣，而且紅方必須立刻下注：只要多給黑方一步，兩條邊線就都關上了。',
  'When the cannon dies': '炮死之後',
  'Half the flips, Red loses the cannon to the soldier. He recaptures the soldier (the engine did, in every playout), and the recapture is a gift: it is now the screen, and Black’s cannon shoots the corner chariot straight through it. The engine scores this -0.55 for Red: attack over, a cannon down, nothing to show.':
    '擲硬幣的一半結果裡，紅炮死在卒的手上。紅方回吃這個卒（引擎在每一盤推演裡都這麼走了），而這步回吃是份大禮：它自己成了炮架，黑炮隔著它一炮打穿角上的車。引擎給紅方打出 -0.55：攻勢結束，淨虧一炮，一無所獲。',
  'After the recapture on a5, Black’s cannon steps to the edge and fires through Red’s own soldier. Misty found this follow-up in every playout.':
    '紅方在 a5 回吃之後，黑炮平到邊線，隔著紅方自己的兵開火。Misty 在每一盤推演裡都找到了這個後續。',
  'Can Red defend the shot? Two ways, neither happy. Declining the recapture keeps two screens on the file, but the crossed soldier just keeps eating and the shot reopens a move later, one soldier cheaper. Recapturing and then blocking with the horse holds the chariot. In six engine playouts from the fired tripwire, the whole sequence played itself out, capture, recapture, counter-shot and all, and Black converted five (the Tripwire games in the companion study). The block:':
    '紅方擋得住這一炮嗎？有兩條路，都不痛快。不回吃可以在這條線上留住兩個炮架，可過河的黑卒會繼續一路吃過去，一步之後炮線重新開啟，紅方還多丟一個兵。回吃之後再跳馬墊線，車是保住了。在從絆索觸發開始的六盤引擎推演裡，整套流程自動上演，吃、回吃、反擊炮一樣不缺，黑方拿下了其中五盤（配套研究裡的 Tripwire 系列對局）。墊擋是這樣的：',
  'When the chariot falls': '車丟之後',
  'The other half, Black is a chariot down. The engine scores positions from -1, lost, to +1, won; it calls this one -0.75, which is roughly one win in eight. Close to lost, not over. And the landed cannon looks scarier than it is: every capture it has loses on the spot to a recapture. Its real power is the freeze: the horse and the elephant beside it are holding the back rank shut, and if either ever moves, the next shot is the general.':
    '另一半結果裡，黑方淨虧一個車。引擎給局面打分從 -1（必敗）到 +1（必勝）；它給這個局面打 -0.75，大約是八盤贏一盤。接近輸定，但還沒完。而且落在角上的炮看著比實際嚇人：它能吃的每一子，吃完都會立刻被回吃。它真正的威力是凍結：旁邊的馬和象正把底線關得死死的，兩者只要有一個動了，下一炮打的就是將。',
  'The cannon’s bites (arrows left) are answered: the central elephant retakes on one point, the general on the other. But the horse and elephant are the back rank’s screens now. Move either and the cannon mates. Leave them home.':
    '炮能吃的兩個點（左側箭頭）都有回應：一個點由中象回吃，另一個點由將親自回吃。但馬和象現在就是底線的炮架。動其中任何一個，炮就擒將。讓它們待在家裡。',
  'So how does Black fight? The engine showed three ideas. First, patience: touch nothing on the back rank. Second, an immediate simplification: in our first playouts its opening move from here, every game, was to snipe Red’s home horse with its own cannon, over Red’s home cannon as the screen, trading cannon for horse to blunt the attack. Third, counterattack on the other wing, where your own cannons still have a game; the next section shows the sharpest version. And it escapes: of the ten forced-grab games, Black won two outright (Rim gambit games 2 and 8 in the companion study, in 84 and 56 plies) and held three more to the ply cap. One win in eight is the eval; in the decided games, the practice was one in four.':
    '那黑方怎麼打？引擎給出了三條思路。第一，耐心：底線上什麼都不碰。第二，立刻簡化：在我們最初的推演裡，它從這個局面走的第一步，每一盤都是用自己的炮隔著紅方還在原位的炮，把紅方原位的馬狙掉，以炮換馬，鈍化攻勢。第三，在另一翼反擊，你自己的炮在那邊還有戲；下一節會展示最鋒利的版本。而且這局面逃得出去：十盤強制抓車的對局裡，黑方直接贏下兩盤（配套研究裡的 Rim gambit 第 2、第 8 局，分別用了 84 著和 56 著），另有三盤撐到了著數上限。八分之一的勝率是評估值；在分出勝負的對局裡，實戰是四分之一。',
  'Whoever moves the wall first dies': '誰先挪牆誰先死',
  'One pattern decided games in every branch, and it travels to any fog game with long-range pieces: a cannon on its firing point is also the block against the enemy cannon opposite. Whoever steps away first, the other fires through the hole. And the fog baits you to step away: from the wall, an enemy soldier looks free. Take it and you are mated on the reply.':
    '有一個模式在每條分支裡都決定過勝負，而且它適用於任何帶遠端棋子的迷霧棋：站在開火點上的炮，同時也是擋住對面敵炮的牆。誰先離開，對方就從缺口裡開火。而迷霧偏偏會引誘你離開：站在牆上望過去，敵方的卒像是白送的。吃了它，下一著你就被擒將。',
  'Which answers a fair question: why not go to the riverbank yourself as Black? You can, and it punishes any Red who grabs. Red has exactly one sound reply: seal his own center before touching anything. Then the battery never fires.':
    '這也回答了一個合理的問題：黑方為什麼不自己也去河沿？可以去，而且它能懲罰任何伸手抓子的紅方。紅方只有一條穩妥的應法：先封住自己的中路，再碰任何東西。這樣一來，這門反架炮永遠開不了火。',
  'The line: cannon to the riverbank, Black answers with his own battery, Red seals with the elephant before grabbing. The battery is now two screens from the general (the cross) and frozen where it stands; move it and Red’s cannon fires. The engine puts Red a quarter point up here (+0.25, against 0.00 in the soldier line) and sends its cannon to the edges (the arrow). A weapon for greedy opponents, not a default.':
    '變化如下：紅炮上河沿，黑方用自己的反架炮回應，紅方在抓子之前先飛相封中。這門反架炮與紅帥之間現在隔著兩個炮架（打叉處），被凍結在原地；它一動，紅炮就開火。引擎認為紅方在此領先四分之一個點（+0.25，對比挺卒主線的 0.00），並把炮轉向兩條邊線（箭頭處）。這是對付貪心對手的武器，不是預設選擇。',
  'What the engine says': '引擎怎麼說',
  'I forced the rush onto the board and let Misty play both sides, thirty games: twenty through the snipe attempt, ten through the chariot grab. The snipe never fired once; Black sealed within three moves in eighteen of twenty. The rush games went Black 9, Red 4, seven ply-cap draws; the forced grabs went Red 5, Black 2, three caps. Then I made Black answer the same forced rush with this article’s exact line, eight more games: Black won six, no draws. The line does not just suit humans; it outscored the engine’s own defensive choices. Here is one of those games in full:':
    '我把速攻強制擺上棋盤，讓 Misty 執雙方下了三十盤：二十盤走狙擊嘗試，十盤走抓車。狙擊一次也沒有打響；二十盤裡有十八盤，黑方三步之內就完成了封堵。速攻組的戰績是黑方 9 勝、紅方 4 勝、7 盤達到著數上限；強制抓車組是紅方 5 勝、黑方 2 勝、3 盤到上限。然後我讓黑方用本文教的這條線應對同樣的強制速攻，又下了八盤：黑方贏了六盤，沒有和棋。這條線不只是適合人類；它拿下的分數比引擎自己選的防守還多。下面是其中一盤的完整棋譜：',
  'All the games behind this article are in the [companion study](/study/3LGIVr59): the theory lines, twenty forced-rush games and ten forced rim-gambit games with the engine on both sides, and sixteen free self-play games. Flip the study board to Black’s fogged view and step through what he actually saw.':
    '本文背後的所有對局都收錄在[配套研究](/study/3LGIVr59)裡：理論變化、二十盤強制速攻與十盤強制邊線抓車的引擎對局，以及十六盤自由自對弈。把研究棋盤切到黑方的迷霧視角，一步步看他當時究竟看見了什麼。',
  'Left to choose freely, sixteen more games, Red won eleven of the twelve decisive and never once played the rush. Lean samples, so treat the counts as direction. The position evaluations are firmer ground: they hold still under a sixteen-fold compute increase.':
    '完全放開讓它自由選擇，再下十六盤，十二盤分出勝負的對局裡紅方贏了十一盤，而且一次也沒有走過速攻。樣本不大，這些計數只當方向看。局面評估值則站得更穩：算力加到十六倍，數值紋絲不動。',
  position: '局面',
  'engine verdict': '引擎判定',
  'game start, Red to move': '開局局面，紅方走子',
  '+0.06 Red: a real but small first-move edge': '+0.06 紅優：真實但很小的先手優勢',
  'theory settled: seal up, rush cannon on e5': '理論定型：封堵完成，速攻炮停在 e5',
  '0.00: dead even, the rush fully answered': '0.00：完全均勢，速攻被徹底化解',
  'Red won the chariot flip': '紅方賭贏了車',
  '-0.75 for Black: close to lost, still fighting': '黑方 -0.75：接近輸定，仍有抵抗',
  'Red lost the cannon flip': '紅方賭輸了炮',
  '-0.55 for Red: clearly losing': '紅方 -0.55：明顯敗勢',
  'counter-battery vs a Red who seals first': '反架炮對先封中的紅方',
  '+0.25 Red: the battery concedes more than the soldier line':
    '+0.25 紅優：反架炮比挺卒主線讓出更多',
  'One last check: I forced Black through the line this article teaches against a free Red, eight games. Black won five of the seven decisive, against one of twelve when choosing freely. The three insurance moves cost nothing.':
    '最後一項檢驗：我強制黑方按本文教的線走，對手是自由行棋的紅方，共八盤。七盤分出勝負的對局黑方贏了五盤，而自由選擇時是十二盤裡贏一盤。這三步保險著法毫無代價。',
  'Average the flip branches and the committed rush is worth about +0.10 to Red, the same ballpark as the +0.06 he starts with: the whole first-move advantage, spent in one gamble. Initiative in fog is real, probably bigger than in chess, because defense is paid blind. The rush is the loudest way to spend it, and the loudest way is answerable.':
    '把賭局的兩條分支取平均，孤注一擲的速攻對紅方約值 +0.10，和開局自帶的 +0.06 屬於同一量級：整份先手優勢，在一場賭局裡一次花光。迷霧中的主動權是真實的，多半比國際象棋裡還大，因為防守是閉著眼睛付賬的。速攻是花掉主動權最響亮的方式，而最響亮的方式是有解的。',
  'The line to learn': '該學的那條線',
  'Black’s three moves: edge soldier, central elephant, far-side horse. The dot is the watched firing point, the cross is the dead snipe, the arrows are the elephant’s cover.':
    '黑方的三步：挺邊卒、飛中象、跳遠端馬。圓點是被盯住的開火點，叉是已失效的狙擊，箭頭是中象的保護範圍。',
  'As Black: edge soldier, elephant to the middle, horse to the other edge. After three moves the only target left is the chariot on the edge you did not push, and only if Red committed on move two. Never seal with the advisor. And before you move any piece near a landed cannon, count screens: most losses we found came from moving a piece that was quietly holding a firing line shut.':
    '執黑：挺邊卒，飛中象，馬跳向另一側邊線。三步之後，剩下的唯一目標就是你沒推卒那一側的車，而且只有紅方第二步就下注時才吃得到。永遠不要用士封中。在挪動落地炮附近的任何棋子之前，先數炮架：我們找到的大多數敗局，都來自挪動了一枚正默默封著某條火線的棋子。',
  'As Red: the rush beats anyone who has not read this far, and it is even money against anyone who has. If you play it, commit to an edge on move two or not at all, and seal your own center before cashing any grab: every scripted Red that grabbed first got mated.':
    '執紅：速攻能贏下所有沒讀到這裡的人，對讀過的人則是對半開的賭注。如果你要走它，第二步就選定邊線，否則乾脆別選，並且在兌現任何抓取之前先封住自己的中路：指令碼里每一個先抓子的紅方都被擒了將。',
  'Step through it yourself': '親手走一遍',
  'Every line and every game in this article is in the companion study, on a board you can flip to either side’s fogged view. When you are ready, Misty will punish you while you learn the line. No account required.':
    '本文的每條變化、每盤對局都在配套研究裡，棋盤可以切換到任何一方的迷霧視角。準備好之後，Misty 會在你練這條線的時候好好教訓你。無需帳號。',
  'Open the companion study': '開啟配套研究',
  'THE TRUTH': '真實局面',
  'WHAT BLACK SEES': '黑方所見',
  'THE POISONED ADVISOR': '有毒的補士',
  'ONE MOVE, THREE FILES': '一步守三線',
  'SOLDIER FIRST': '先挺卒',
  'SOLDIER TOO LATE': '挺卒已遲',
  'ONE SLIDE FROM EVERYTHING': '一步之遙',
  'THE THREE-MOVE ANSWER': '三步答案',
  'THE BATTERY, FROZEN': '凍結的反架炮',
  'THE RECAPTURE IS A GIFT': '回吃是份大禮',
  'THE FREEZE': '凍結',
  'The stealth rush': '隱形速攻',
  'Kernel-verified line': '經規則核心驗證的變化',
  'Red captures the general on move 4. Black developed normally and saw nothing.':
    '紅方在第 4 回合擒獲黑將。黑方正常出子，全程什麼都沒看見。',
  'Red saves the chariot': '紅方保車',
  'The horse steps to the edge as a second screen and the shot is dead. Red is still a cannon for a soldier down with nothing to attack. The engine scores the branch -0.55 either way and calls the recapture the least bad move on the board: the block saves a piece, not the game.':
    '馬跳到邊線充當第二個炮架，這一炮就打不響了。紅方仍然是用一炮換了一卒，且無攻可組。引擎給這條分支的評分橫豎都是 -0.55，並認為回吃是全盤最不壞的一步：墊擋救的是一枚子，不是這盤棋。',
  'The counter-battery': '反架炮',
  'Black skipped the elephant and parked a cannon on the center file. Red cannot see it, grabs the chariot, and is mated on the reply.':
    '黑方跳過飛象，把一門炮架在了中路。紅方看不見它，伸手抓了車，下一著帥就被擒。',
  'Rush vs the recommended line, game 7 of 8': '速攻對推薦線，八盤中的第七盤',
  'Engine-vs-engine playout, full record': '引擎對引擎推演，完整棋譜',
  'Both sides forced through their first three moves, then free. Black follows the line this article teaches; the snipe never comes, heavy trades follow, and Black finishes with a deflection: chariot takes the advisor beside the general, the general recaptures, and the second chariot takes the general.':
    '雙方前三步按指令碼強制，之後自由行棋。黑方走的正是本文教的線；狙擊始終沒有到來，隨後是大量兌子，最後黑方用一記引離收尾：車吃掉帥旁邊的仕，帥回吃，另一個車擒帥。',
  'Misty (rush forced)': 'Misty（強制速攻）',
  'Misty (this article’s line)': 'Misty（本文推薦線）',
  Red: '紅方',
  Black: '黑方',

  // -- Every Xiangqi Champion (xiangqi-champions) --
  // Derived from the Simplified block by OpenCC s2tw (NOT s2twp: phrase
  // conversion renders 体育项目 as 體育專案, the software sense of "project").
  // Champion names were masked through the conversion, so 杨官璘 stays 杨官璘.
  // Only values that actually fork appear here; the rest inherit via the spread.
  'Every Xiangqi Champion: Chinese Chess Title Holders and Their Games':
    '歷屆全國象棋冠軍：中國象棋冠軍名錄與對局講解',
  'Every Xiangqi Champion': '歷屆全國象棋冠軍',
  'Every winner of the Chinese national xiangqi championship since 1956, and an annotated game for thirteen of them. Plus the nine hundred years before the title existed, and the decade that has been struck from the record.':
    '1956年以來中國象棋全國個人賽的每一位冠軍，其中十三位各配一局講解棋譜。另有這個頭銜出現之前的九百年，以及被從紀錄裡抹去的十年。',
  'Ask who the greatest chess player was and you get an argument with a shape to it: Fischer or Kasparov or Carlsen, measured against a title that has passed hand to hand since 1886. Ask the same about xiangqi and most English answers stop at the question.':
    '問國際象棋史上誰最強，你會得到一場有章法的爭論：菲舍爾、卡斯帕羅夫還是卡爾森，衡量的標尺是一個自1886年起代代相傳的頭銜。同樣的問題放到象棋上，多數英文的回答止步於提問本身。',
  'There is an answer, and almost nobody disputes it. Hu Ronghua won fourteen national championships, took the first at fifteen and the last at fifty-five, and won or shared every one of the ten championships held between 1960 and 1979. What is harder to explain is why the title he dominated is only sixty-nine years old, in a game that was already being played in its modern form when the Song dynasty fell. What follows is every winner, and a game for thirteen of them in the order they first took the title. Our own engine annotates the boards; the analysis is Pikafish at a million nodes a position.':
    '答案是有的，而且幾乎無人異議。胡荣华拿過十四次全國冠軍，十五歲奪得第一次，五十五歲奪得最後一次，1960年到1979年間舉辦的十屆全國賽，冠軍全部由他獨得或並列分享。更難解釋的是，他統治的這個頭銜為什麼只有六十九年曆史，而這門棋在南宋滅亡之時就已經是今天的模樣。下面列出每一位冠軍，並按他們首次奪冠的先後，為其中十三位各選一局棋。棋譜講解由我們自己的引擎完成，分析用的是 Pikafish，每個局面一百萬個節點。',
  'Before there was a title': '頭銜出現之前',
  'Xiangqi reached its modern form at the end of the Northern Song: sixteen pieces a side, nine files by ten ranks, the river, the palace, the general and advisors confined to it. By the Southern Song it was played widely enough that Wen Tianxiang, the statesman the Mongols executed in 1283, grew up in a family of players and left a book of forty endgame problems. Nine hundred years of the game, and composed positions like his are nearly all that survives: not one record of a game anyone actually played.':
    '象棋在北宋末年定型為今天的樣子：每方十六子，縱九橫十，有河界，有九宮，將帥與士不出九宮。到南宋時它已流傳甚廣，被蒙古人於1283年處死的文天祥就出身棋弈之家，留下過一部四十局的殘局譜。九百年的棋史，存下來的幾乎只有這類擬局：沒有一份真人對局的記錄。',
  'What survives from the Ming onward is manuals: 橘中秘 of 1632, the most reprinted xiangqi text of the Ming and Qing, and 百局象棋谱 of 1801 with its hundred and seven positions named after proverbs. You can name the authors. You cannot say who was strongest, because nobody was keeping score. The first era with contested titles ran through the 1920s and 1930s and had no federation: newspapers organised the matches, and the winners were given names rather than trophies. Zhou Deyu finished three points clear when East China played North China in February 1931 and was crowned 七省棋王, Chess King of Seven Provinces, the seven being how many provinces the four players came from. Huang Songxuan then played him twenty games, finished one ahead, and Guangdong crowned him 九省棋王, Chess King of Nine Provinces. A title race settled by nickname inflation is not a system, but it was the closest the game had.':
    '明代以後留下來的是棋譜：1632年的《橘中秘》，明清兩代翻刻最多的象棋著作；1801年的《百局象棋譜》，收有一百零七局以成語命名的排局。作者的名字你說得出來。誰最強你說不出來，因為沒有人在記分。第一個爭奪頭銜的時代橫跨二十世紀二三十年代，卻沒有任何協會：比賽由報紙組織，贏家得到的是名號而不是獎盃。1931年2月華東對華北，周德裕淨勝三分，被加冕為七省棋王，這七省指的是四名參賽者來自幾個省。隨後黃松軒與他對弈二十局，多勝一局，廣東便封他為九省棋王。靠名號加碼決出的頭銜算不上一套制度，但那已是當時最接近制度的東西。',
  'Xie Xiaxun organised those matches and is the figure worth knowing. He played Western chess well enough to win a five-nation tournament at Shamian in 1936 with eighteen wins, one loss and one draw. In October 1937 he went to Southeast Asia as a national envoy and spent two years playing for the war: simultaneous displays, blindfold games, boards laid out with people as the pieces. He raised more than fifty million in banknotes and silver, and sent three thousand young overseas Chinese home to fight. In 1939 he played Zhou Enlai in Chongqing, and the drawn game they published in the Ta Kung Pao was titled 共抒国难, relieving the national crisis together. He died in 1987, aged ninety-nine.':
    '這些比賽的組織者是謝俠遜，他是那個時代最值得認識的人物。他的國際象棋也下得好，1936年在沙面舉行的五國賽上以十八勝一負一和奪冠。1937年10月他以國家使節的身份前往東南亞，用兩年時間為抗戰下棋：車輪戰、盲棋、以人作棋子擺開的棋局。他募得五千餘萬的鈔票與銀兩，並送三千名華僑青年回國參戰。1939年他在重慶與周恩來對弈，兩人的和局發表於《大公報》，題為共抒國難。1987年他去世，享年九十九歲。',
  "Then, in August 1956, the State Sports Commission made xiangqi an official sport and published the first competition rules. That December, in Beijing, the first national championship was played. Xiangqi was the only competitive event; go and Western chess were demonstrations. It has been played fifty-seven times since, missing 1961 and 1963 to the famine, 1967-1973 to the Cultural Revolution, 1976 to Mao's death, 2021-2022 to the pandemic, and 2024 to want of a sponsor.":
    '1956年8月，國家體委將象棋列為正式體育項目，並頒佈了第一部比賽規則。當年12月，第一屆全國象棋錦標賽在北京舉行。象棋是唯一的競賽項目，圍棋和國際象棋只作表演。此後共舉辦五十七屆，其間1961和1963年因饑荒停辦，1967至1973年因文革停辦，1976年因毛澤東逝世停辦，2021和2022年因疫情停辦，2024年因無人贊助停辦。',
  'Every national champion, 1956 to 2025': '歷屆全國冠軍，1956至2025',
  'Fifty-seven editions, twenty-two winners. One row per player, in the order they first took the title, with a bar over the years they held it.':
    '五十七屆，二十二位冠軍。每位棋手一行，按首次奪冠的先後排列，橫條覆蓋他保有頭銜的年份。',
  'Hatched columns are years with no championship. The number after each name is that player’s title count.':
    '斜線填充的列是沒有舉辦全國賽的年份。每個名字後面的數字是該棋手的奪冠次數。',
  'Three things fall out of the shape. Hu Ronghua holds the middle of the chart for forty years, in two long runs either side of a gap that history took rather than a rival, then four scattered singles that land after the men who replaced him had themselves come and gone. The 1980s and 1990s are the only stretch where four or five names trade the title year to year. And from 2005 the bars turn red: thirteen men have won it since, and ten of them have a ruling against them.':
    '從圖形裡能看出三件事。胡荣华佔據圖表中段長達四十年，分成兩段長跑，中間的空檔是歷史造成的而不是對手造成的，此後又是四次零散奪冠，落在取代他的那批人自己也來了又走之後。八十年代和九十年代是唯一一段四五個名字逐年輪流拿冠軍的時期。而從2005年起橫條轉紅：此後共有十三人奪冠，其中十人身上有處罰決定。',
  'Thirteen of these men have an annotated game further down the page, one each, in the same order. The nine without one are here because a list of champions that leaves people out is not a list of champions.':
    '這十三人在本頁下方各有一局講解棋譜，順序相同。另外九人沒有棋譜，之所以列出，是因為漏掉人的冠軍名單算不上冠軍名單。',
  Champion: '冠軍',
  Titles: '奪冠次數',
  'Association ruling': '協會處罰',
  'The same record as the figure, with the years written out. An asterisk marks the one shared title, in 1962. Every entry in the last column is a published ruling of the Chinese Xiangqi Association, not an allegation; the section below explains them.':
    '與上圖相同的紀錄，年份寫全。星號標出唯一一次並列冠軍，在1962年。最後一列裡的每一條都是中國象棋協會已公佈的處罰決定，不是指控；下文一節會加以說明。',
  "Four national titles: 1956, 1957, 1959, and a fourth in 1962 shared with the boy who had just taken the game off him. He came out of Guangdong, played for money in Hong Kong between 1949 and 1951, and by the time the sport was organised he was good enough that it called him 第一国手, the nation's foremost player. Other players called him 魔叔, Magic Uncle. His reputation rested on endgames, which is a polite way of saying he beat people in positions everyone had agreed were drawn.":
    '四次全國冠軍：1956、1957、1959，第四次在1962年，與剛剛把冠軍從他手裡拿走的那個少年並列。他出自廣東，1949到1951年間在香港以棋為生，等到這項運動被正式組織起來時，他已經強到被稱作第一國手。棋界叫他魔叔。他的名聲建立在殘局上，說得客氣些是這樣，說白了就是他能在所有人都認定是和棋的局面裡贏下對手。',
  'He was the answer for most of a decade, and for longer than the record suggests. Five years after Hu Ronghua took the title off him, Yang was still beating him.':
    '在近十年的時間裡他就是那個答案，而且比紀錄顯示的還要久。胡荣华從他手裡拿走冠軍五年之後，杨官璘還在贏他。',
  'Yang Guanlin vs Hu Ronghua, 12 November 1965. Ninety moves of endgame, and move 41 is the cannon swing that finally breaks it.':
    '杨官璘對胡荣华，1965年11月12日。九十個回合的殘局較量，第41回合的平炮終於撕開了局面。',
  'They called him 小神童, the little prodigy, and he had earned it by sixteen: a four-game match against Yang Guanlin in 1954 that finished two apiece. He beat Yang again at the first national championship, in the tournament Yang went on to win, and took the title himself in 1958 at twenty.':
    '人稱小神童，他十六歲就當得起這個名號：1954年與杨官璘四局對抗，二比二打平。在首屆全國賽上他又贏了杨官璘一局，而那屆冠軍最終歸杨官璘；1958年他二十歲，自己拿下了冠軍。',
  'Then he stopped. Poor health and the politics of the late 1960s ended his competitive career in 1966, at twenty-eight, which is the whole reason a player this good has one championship. He coached afterwards, and the player he pushed forward was Liu Dahua, two sections down.':
    '然後他就停了。健康不佳加上六十年代後期的政治，讓他的競技生涯在1966年結束，那年他二十八歲，這就是一位這麼強的棋手只有一次冠軍的全部原因。此後他做教練，他推上來的棋手是柳大华，在下面第二節。',
  'Li Yiting vs Yang Guanlin, 27 December 1956. Li was eighteen, and our engine grades him 99.0, the highest of any player here.':
    '李义庭對杨官璘，1956年12月27日。李义庭當時十八歲，我們的引擎給他打出99.0分，是本頁所有棋手中最高的。',
  'Fourteen national titles, the first at fifteen and the last at fifty-five, and every one of the ten championships held between 1960 and 1979, one of them shared. They called him 胡司令, Commander Hu. He played out of Shanghai, on his own, against the strongest player every other province could field, and he did it by rebuilding the openings underneath the game: the flying elephant, the anti-palace horse and the same-direction cannon are all mainstream today because Hu kept winning with them.':
    '十四次全國冠軍，第一次十五歲，最後一次五十五歲，1960到1979年間舉辦的十屆冠軍全部有他，其中一屆並列。棋界叫他胡司令。他代表上海出戰，孤身一人對抗其他各省能派出的最強棋手，而他做到這一點的辦法，是把棋的開局體系整個重建了一遍：飛相局、反宮馬、順炮，今天都是主流，因為胡荣华一直用它們贏棋。',
  'This is the game he arrived with. Round three of his first national tournament, Black against the reigning champion.':
    '這是他登場的那一局。首次參加全國賽的第三輪，執黑對陣衛冕冠軍。',
  'Yang Guanlin vs Hu Ronghua, 28 October 1960. Move 24 is the one to watch: a cannon Yang cannot take, marked brilliant.':
    '杨官璘對胡荣华，1960年10月28日。第24回合值得一看：一步杨官璘吃不得的炮，被標為妙手。',
  'And this is thirty-four years later, in a tournament he did not win, against a man who had taken two national titles of his own in between.':
    '這是三十四年之後，在一場他沒有奪冠的比賽裡，對手是這期間自己拿過兩次全國冠軍的人。',
  'Hu Ronghua vs Liu Dahua, 15 October 1994. Hu at forty-eight, six years before his fourteenth title.':
    '胡荣华對柳大华，1994年10月15日。胡荣华時年四十八，距離他第十四次奪冠還有六年。',
  'Two titles, 1980 and 1981, and the man who ended the longest run in the game: Hu had won every championship held for twenty years when Liu took the 1980 tournament off him. He is from Huangpi, in Hubei, and the sport knows him as 东方电脑, the Eastern Computer, for a memory that let him play nineteen simultaneous games blindfold in 1995. That was a world record until one of the champions further down this page broke it with twenty.':
    '兩次冠軍，1980和1981年，他也是終結了這項運動中最長連霸的人：柳大华拿下1980年那屆時，此前二十年舉辦的全國賽冠軍全是胡荣华的。他是湖北黃陂人，棋界稱他東方電腦，因為他的記憶力讓他在1995年下出十九盤同時進行的盲棋。那是當時的世界紀錄，直到本頁下面的一位冠軍以二十盤打破它。',
  'He beat Li Laiqun in the 1980 tournament, then Yang Guanlin five days later.':
    '他在1980年那屆比賽中贏了李来群，五天後又贏了杨官璘。',
  'Li Laiqun vs Liu Dahua, 29 August 1980. Li would take four titles of his own starting two years later.':
    '李来群對柳大华，1980年8月29日。兩年後李来群將開始自己的四次奪冠。',
  'Yang Guanlin vs Liu Dahua, 3 September 1980. The outgoing era losing to the incoming one in under thirty-five moves.':
    '杨官璘對柳大华，1980年9月3日。將去的時代在三十五個回合之內輸給了將來的時代。',
  "Four titles between 1982 and 1991, and the first of them mattered past his own career. Li is from Handan in Hebei, and 1982 was the first time the men's championship crossed the Yellow River: until then it had belonged to the south, to Guangdong and Shanghai and Hubei. He went through that tournament unbeaten, and through Hu Ronghua directly rather than around him.":
    '1982到1991年間四次奪冠，其中第一次的意義超出了他個人的生涯。李来群是河北邯鄲人，1982年是男子全國冠軍第一次跨過黃河：在此之前它一直屬於南方，屬於廣東、上海和湖北。那屆比賽他全程不敗，而且是正面贏過胡荣华，不是繞開他。',
  "Chinese writers reach for two images for his game: a needle wrapped in cotton, and a python's coils. Both mean the same thing, which is that the position has already closed before you notice it closing.":
    '中文的棋評用兩個比喻形容他的棋：綿裡藏針，以及蟒蛇纏身。兩者說的是同一件事，就是等你察覺局面在收緊時，它已經收緊完了。',
  'Li Laiqun vs Hu Ronghua, 7 December 1982, from the championship Li won. Move 23 is the cannon push, and Hu has nothing after it.':
    '李来群對胡荣华，1982年12月7日，出自李来群奪冠的那屆比賽。第23回合是那步進炮，此後胡荣华無棋可下。',
  'Five national titles and five world titles, more of the latter than anyone before or since. Guangdong called him 羊城少帅, the Young Marshal of Guangzhou, and paired him with Xu Yinchuan as 岭南双雄, the twin heroes of Lingnan. In almost any other era that record is the headline of the sport. Here it reads as a long second place behind Hu Ronghua.':
    '五次全國冠軍，五次世界冠軍，後者的數量前無古人後無來者。廣東叫他羊城少帥，又把他與许银川並稱嶺南雙雄。放在幾乎任何別的年代，這份紀錄都是這項運動的頭條。在這裡，它讀起來是長期屈居胡荣华之後的第二名。',
  "Lü Qin vs Yu Youhua, 23 November 1986. The only game where both players are marked brilliant: Lü Qin's cannon on 21, Yu Youhua's horse on 32.":
    '吕钦對于幼华，1986年11月23日。本頁唯一一局雙方都被標出妙手的棋：吕钦第21回合的炮，于幼华第32回合的馬。',
  'National champion in 1989, world champion in 1993 with six wins, three draws and no losses. He is from Taizhou in Jiangsu, and the sport calls him 笑面佛, the Smiling Buddha, because he smiles right through a game. What is behind the smile is the opposite of friendly: tight openings, very few holes, and a habit of grinding advantages too small to see into wins.':
    '1989年全國冠軍，1993年世界冠軍，六勝三和不敗。他是江蘇泰州人，棋界叫他笑面佛，因為他整局棋都在笑。笑容背後的東西一點也不友善：開局嚴密，幾乎沒有破綻，習慣把小到看不見的優勢磨成勝勢。',
  'The year after his national title he met a fifteen-year-old from Guangdong, at the same age and on the same stage where Hu Ronghua had beaten Yang Guanlin thirty years earlier. This time the champion won.':
    '拿到全國冠軍的第二年，他遇上一位十五歲的廣東少年，年齡相同，舞臺也相同，三十年前胡荣华就是在這裡贏了杨官璘。這一次贏的是冠軍。',
  'Xu Tianhong vs Xu Yinchuan, 19 October 1990. No blunder from either side, which is the game Xu Tianhong wanted.':
    '徐天红對许银川，1990年10月19日。雙方都沒有漏著，這正是徐天红要的那種棋。',
  'Four national titles spread across eighteen years, 1990 to 2008, plus the 1991 world championship. He learned in Harbin under Wang Jialiang, who was known as the Northeast Tiger, so the sport made Zhao the New Northeast Tiger. What people mean by it is that he plays bigger against stronger opponents, and that he fused the careful northern game with the sharper southern one.':
    '四次全國冠軍分佈在十八年裡，從1990到2008年，另加1991年的世界冠軍。他在哈爾濱師從王嘉良，王嘉良人稱東北虎，於是棋界把赵国荣叫作新東北虎。這個說法的意思是他越遇強手下得越大，也是說他把穩健的北派與鋒利的南派融到了一起。',
  'Zhao Guorong vs Hu Ronghua, 22 October 1989, the year before his first title. Move 30 is the chariot swing, and Hu does not recover.':
    '赵国荣對胡荣华，1989年10月22日，奪得首個冠軍的前一年。第30回合是那步平車，此後胡荣华沒能挽回。',
  "Six national titles and three world titles. He won the first at eighteen, second only to Hu's fifteen, and spent the 1990s and 2000s as the best player in the country not named Hu Ronghua. Like Yang Guanlin before him he built it on endgames, and like Yang he came out of Guangdong. He is one of the three men to have won a national title since 2005 with no ruling against him.":
    '六次全國冠軍，三次世界冠軍。他十八歲拿下第一次，僅次於胡荣华的十五歲，整個九十年代和本世紀頭十年，他都是國內除胡荣华之外最強的棋手。和他之前的杨官璘一樣，他把棋建立在殘局上；也和杨官璘一樣，他出自廣東。2005年以後奪得全國冠軍而身上沒有處罰決定的，只有三人，他是其中之一。',
  "Here he is against the man who ended Hu's run.": '下面是他對陣終結了胡荣华連霸的那個人。',
  'Xu Yinchuan vs Liu Dahua, 11 October 1995. The only game here in which our engine finds neither a blunder nor a mistake from either player.':
    '许银川對柳大华，1995年10月11日。這是本頁唯一一局，我們的引擎在雙方身上都沒有找到漏著或失著。',
  'The only champion here who came up outside the system. Tao grew up on the street chess stalls of Haicheng in Liaoning, turned professional late, and in 1994 became the first amateur-trained player to win the national title, playing for Jilin and taking it from Lü Qin on tiebreak in the final round. The sport named him 绿林棋王, chess king of the greenwood, which is the Chinese phrase for outlaws in the forest, and it is a verdict on his game rather than his upbringing: unorthodox, and ferocious in the middlegame.':
    '本頁唯一一位從體制外走上來的冠軍。陶汉明在遼寧海城的街頭棋攤上長大，很晚才轉為職業，1994年成為第一個以業餘出身奪得全國冠軍的棋手，他代表吉林出戰，在最後一輪憑小分從吕钦手裡拿走了冠軍。棋界給他的名號是綠林棋王，這是評他的棋而不是評他的出身：不循常規，中局兇悍。',
  'His game is wild by the standards of every other champion in this sequence, built on prepared surprises rather than accumulation. Here he is two years after the title, against a two-time champion.':
    '以本篇其他任何一位冠軍的標準衡量，他的棋都算野，靠的是準備好的意外而不是積累。下面是他奪冠兩年之後，對陣一位兩屆冠軍。',
  'Tao Hanming vs Liu Dahua, 21 October 1996. More chances for both players than a positional grind offers, and Tao was better at taking them.':
    '陶汉明對柳大华，1996年10月21日。雙方的機會都比一盤陣地磨局多，而陶汉明更善於抓住它們。',
  'One title, in 2002, at forty-one, taken in the middle of the years that belonged to Hu Ronghua, Lü Qin and Xu Yinchuan. A Guangzhou newspaper writer had named him 拼命三郎 two decades earlier, roughly the desperado, after the 1981 championship: he finished sixth and did not draw a single one of his thirteen games. He plays for complications and accepts what comes with them.':
    '一次冠軍，在2002年，時年四十一歲，奪自屬於胡荣华、吕钦和许银川的那些年份中間。二十年前，一位廣州的報紙作者在1981年全國賽之後給他起了拼命三郎這個名號：那屆他名列第六，十三局棋一盤和棋也沒有下過。他為複雜局面而戰，並接受隨之而來的一切。',
  'Xu Tianhong vs Yu Youhua, 3 November 2002, from the championship Yu finally won. The Smiling Buddha against the desperado.':
    '徐天红對于幼华，2002年11月3日，出自于幼华終於奪冠的那屆比賽。笑面佛對拼命三郎。',
  'One title, in 2011, won without losing a game: five wins and six draws. He is where the list stops being straightforward. On 12 January 2025 the Chinese Xiangqi Association banned him for four years and three months and revoked his grandmaster title, in the same announcement that sanctioned forty-one people.':
    '一次冠軍，在2011年，全程不敗：五勝六和。到他這裡，這份名單不再是直截了當的了。2025年1月12日，中國象棋協會禁賽他四年三個月，並撤銷其特級大師稱號，同一份公告處罰了四十一人。',
  'Every man who won the national championship from 2010 to 2023 now has a ruling against him. What that means for the list is at the foot of the page.':
    '2010年到2023年間奪得全國冠軍的每一個人，如今身上都有處罰決定。這對這份名單意味著什麼，寫在本頁末尾。',
  'Xu Tianhong vs Sun Yongzheng, 18 October 2010, the year before his title. Sixty plies, the shortest game here.':
    '徐天红對孙勇征，2010年10月18日，奪冠的前一年。六十著，是本頁最短的一局。',
  'The twenty-second man to win it, in Jinan in December 2025, a first title for a Beijing player coached by the grandmaster Zhang Qiang. His is the only game below in which the opponent appears nowhere else, and that is a consequence of the section above rather than an editorial choice.':
    '第二十二位奪冠者，2025年12月在濟南奪冠，是北京棋手第一次拿到這個頭銜，他的教練是特級大師张强。下面這局是唯一一局對手在別處再未出現的棋，這是上一節所述情況的後果，不是編排上的選擇。',
  'Wang Yubo vs Su Yilin, 6 December 2025, the opening round of the championship he won. Move 32 is the horse advance the engine marks.':
    '王禹博對苏奕霖，2025年12月6日，他奪冠那屆的首輪。第32回合是引擎標出的那步躍馬。',
  'The red bars in the chart are the reason this list needs a footnote. Between 2024 and 2026 the Chinese Xiangqi Association worked through a match-fixing case the Chinese press calls 录音门, the recording gate, and it has [a page of its own](/blog/xiangqi-match-fixing): the investigation, everyone sanctioned, the reasoning, and the sources.':
    '圖表裡的紅條就是這份名單需要加註的原因。2024到2026年間，中國象棋協會處理了一起中文媒體稱為錄音門的假棋案，它另有[專頁](/blog/xiangqi-match-fixing)：調查經過、全部受罰者、來龍去脈與資料來源。',
  'Set that against the table above and the damage is easier to see than to state. Thirteen men have won the national championship since 2005 and ten of them have a ruling against them, including every single winner from 2010 to 2023. Xu Yinchuan, Zhao Guorong and Wang Yubo are the three who do not.':
    '把這些對照上面的表格，損害看得見，反而說不清楚。2005年以來共有十三人奪得全國冠軍，其中十人身上有處罰決定，包括2010到2023年間的每一位冠軍。沒有處罰的三人是许银川、赵国荣和王禹博。',
  'The names stay in the table. A list that quietly dropped them would be a worse record of what happened, and these are published findings from the sport’s own governing body rather than allegations. What the rulings do not tell you is which games were fixed, or how a player at that level is supposed to be caught, and that is a longer story than a list of champions can hold.':
    '這些名字留在表格裡。悄悄刪掉他們，只會讓這份紀錄更差，何況這些是這項運動自身管理機構公佈的認定結論，不是指控。處罰決定沒有告訴你的是，哪些棋是假的，以及到了那個水平的棋手究竟應該怎樣才能被查出來，那是一份冠軍名單裝不下的更長的故事。',
  'The world title, and the same names': '世界冠軍，還是這些名字',
  'Where that leaves the list': '這份名單如今的樣子',
  'Sixty-nine years, fifty-seven championships, twenty-two winners. For the first fifty of those years the question had a clear answer and it was usually Hu Ronghua. For the fifteen after that it has an answer the sport has since taken back. Wang Yubo’s title in December 2025 is the first since Xu Yinchuan in 2009 that nobody has had to qualify.':
    '六十九年，五十七屆，二十二位冠軍。頭五十年裡這個問題有明確的答案，而且答案通常是胡荣华。之後的十五年，答案存在，但這項運動後來自己收了回去。王禹博2025年12月的冠軍，是2009年许银川之後第一個不需要任何人加以說明的冠軍。',
  'Every game on this page is a chapter in a study you can work through properly: the full move tree, the engine’s lines as branches you can walk, one chapter per champion in the same order, and the 2025 world final at the end.':
    '本頁的每一局棋都是一份研究裡的一章，你可以在那裡從頭到尾走一遍：完整的著法樹、引擎的變化作為可以走進去的分支、每位冠軍一章且順序相同，末尾還有2025年的世界賽決賽。',
  'Learn how the pieces move': '學習各子的走法',
  title: '冠軍',
  'shared title': '並列冠軍',
  'title, champion later banned': '冠軍，其後被禁賽',
  'no championship held': '未舉辦',
  'banned for life, 2026': '終身禁賽，2026',
  'banned for life, 2025': '終身禁賽，2025',
  'five-year ban, 2026': '禁賽五年，2026',
  'banned four years three months, 2025': '禁賽四年三個月，2025',
  'convicted, banned': '判罪並禁賽',
  'banned seven years six months, 2025': '禁賽七年六個月，2025',

  // -- Champions embeds: only the values that actually fork. --
  '1956 National Individual Championship': '1956年全國象棋個人錦標賽',
  '1960 National Individual Championship': '1960年全國象棋個人錦標賽',
  '1965 National Individual Championship': '1965年全國象棋個人錦標賽',
  '1980 National Individual Championship': '1980年全國象棋個人錦標賽',
  '1982 National Individual Championship': '1982年全國象棋個人錦標賽',
  '1986 National Individual Championship': '1986年全國象棋個人錦標賽',
  '1989 National Individual Championship': '1989年全國象棋個人錦標賽',
  '1990 National Individual Championship': '1990年全國象棋個人錦標賽',
  '1994 National Individual Championship': '1994年全國象棋個人錦標賽',
  '1995 National Individual Championship': '1995年全國象棋個人錦標賽',
  '1996 National Individual Championship': '1996年全國象棋個人錦標賽',
  '2002 National Individual Championship': '2002年全國象棋個人錦標賽',
  '2010 National Individual Championship': '2010年全國象棋個人錦標賽',
  '2025 National Individual Championship': '2025年全國象棋個人錦標賽',

  // -- World championship (xiangqi-world-championship) --
  // Traditional is s2tw over the Simplified above (character conversion, NOT
  // s2twp: phrase conversion corrupts terms), plus the Taiwan lexical forks
  // 資料庫 and 高水準, plus one rewrite where 默認 does not carry "assume" in
  // Taiwan usage.
  //
  // Mainland players' names are held out of the conversion: a person's name is
  // written in the script that person uses. The champions page could apply that
  // rule to every name at once because all twenty-two of its champions are
  // mainland. This page's are not, so the split is real here: 吳貴臨 of Chinese
  // Taipei, 李錦歡 of Macau, 黃學謙 and 馮家俊 of Hong Kong, and 賴理兄 of
  // Vietnam DO convert, because traditional characters are how those names are
  // written. world-champion-name-script.test.ts enforces both halves.

  'The Xiangqi World Championship': '世界象棋錦標賽',
  'Xiangqi World Championship: Every Winner, and Why It Is Not the Senior Title':
    '世界象棋錦標賽：歷屆冠軍，以及它為何不是最高頭銜',
  'Every winner of the Xiangqi World Championship since 1990, why the Chinese national title is the harder one, and how a Vietnamese player took it out of China for the first time in 2025.':
    '1990年以來世界象棋錦標賽的每一位冠軍，為什麼中國全國個人賽才是更難拿的頭銜，以及2025年一位越南棋手如何第一次把它帶出中國。',
  'Readers who have met the national champions and want to know what the international title is worth.':
    '已經認識全國冠軍、想知道這個國際頭銜分量如何的讀者。',
  'The World Xiangqi Championship has been held roughly every two years since 1990, organised by the World Xiangqi Federation. English readers tend to assume it is the senior title, the way the world chess championship is. It is not, and the reason is worth understanding before the list makes sense.':
    '世界象棋錦標賽由世界象棋聯合會主辦，1990年以來大致每兩年舉辦一屆。英文讀者往往想當然地認為它是象棋界的最高頭銜，就像國際象棋世界冠軍賽那樣。事實並非如此，而弄清楚原因，下面這份名單才讀得懂。',
  'The Chinese national championship is the harder one to win. Almost everyone capable of winning either is Chinese, and only a handful of them qualify for the world event. For its first thirty-five years the world title was, in practice, a smaller Chinese championship with guests, and then in 2025 it left China for the first time.':
    '更難拿的是中國全國個人賽。有能力拿下這兩個頭銜中任何一個的棋手幾乎都是中國人，而其中只有少數幾位能獲得世錦賽的參賽資格。在最初的三十五年裡，世界冠軍實際上是一場規模更小、外加幾位客人的中國錦標賽，直到2025年，它第一次離開了中國。',
  'Every world champion, 1990 to 2025': '歷屆世界冠軍，1990至2025',
  'Nineteen editions, eleven winners. One row per player, in the order they first took the title, with a bar over the years they held it.':
    '十九屆，十一位冠軍。每位棋手一行，按首次奪冠的先後排列，橫條覆蓋他持有頭銜的年份。',
  'Two things fall out of the shape. The left half belongs to three men, and the right half turns red at 2009 and stays red until the last row.':
    '從這個形狀裡能看出兩件事。左半邊屬於三個人；右半邊從2009年起變紅，一直紅到最後一行。',
  'The same record as the figure, with the years written out. Every entry in the last column is a published ruling of the Chinese Xiangqi Association, not an allegation; the section below explains them.':
    '與上圖相同的紀錄，把年份逐一寫出。最後一列的每一條都是中國象棋協會已公佈的處罰決定，不是指控；下面有一節專門說明。',
  'The national title, and every champion since 1956': '全國冠軍，以及1956年以來的每一位',
  'Five world titles across fifteen years and five Chinese national titles, 1986 to 2004. Guangdong called him 羊城少帅, the Young Marshal of Guangzhou, and later paired him with Xu Yinchuan as 岭南双雄, the twin heroes of Lingnan. He is the most decorated player on this page and was never, in any single year, the best player in China.':
    '十五年間五奪世界冠軍，另有五個全國個人賽冠軍，從1986年到2004年。廣東稱他為羊城少帥，後來又把他與许银川並稱嶺南雙雄。他是本頁榮譽最多的棋手，卻從來沒有在任何一個年份裡成為中國最強的棋手。',
  'That sentence is the article in miniature. Hu Ronghua was ahead of him at home for most of his career and never entered this event; Lü Qin won it five times. Wu Guilin of Chinese Taipei was the strongest player outside the mainland for two decades and the recurring answer to who could actually beat these men, and Lü Qin beat him in 1990, 1995 and 1997.':
    '這句話就是整篇文章的縮影。胡荣华在國內大部分時間都壓著他，卻從未參加過這項賽事；吕钦卻拿了五次。中華臺北的吳貴臨二十年間是大陸之外最強的棋手，也是"究竟誰能贏這些人"這個問題反覆出現的答案，而吕钦在1990、1995和1997年都贏了他。',
  'Lü Qin vs Wu Guilin, 1997, from the fifth championship and the third of his five titles.':
    '吕钦對吳貴臨，1997年，第五屆世錦賽，也是他五個冠軍中的第三個。',
  'World champion in 1991 and four times Chinese national champion, spread across eighteen years from 1990 to 2008, which is a longer span at the top than anyone here except Hu Ronghua managed. He learned in Harbin under Wang Jialiang, known as the Northeast Tiger, and the sport made him the New Northeast Tiger in turn.':
    '1991年的世界冠軍，四次全國個人賽冠軍，跨越1990年到2008年共十八年，這個在頂端停留的跨度，除胡荣华外本頁無人能及。他在哈爾濱師從王嘉良，人稱東北虎，棋壇後來又把他叫作新東北虎。',
  'He is one of three men on this list with no ruling against him.':
    '他是這份名單上三位沒有受到任何處罰的棋手之一。',
  'Zhao Guorong vs Wu Guilin, 1991, from the championship he won.':
    '赵国荣對吳貴臨，1991年，出自他奪冠的那屆比賽。',
  'World champion in 1993 in Beijing with seven and a half points from nine, the year after taking the Chinese national title. He is from Taizhou in Jiangsu, and the sport calls him 笑面佛, the Smiling Buddha, because he smiles right through a game. What is behind the smile is tight openings and a habit of grinding advantages too small to see into wins.':
    '1993年在北京奪得世界冠軍，九輪拿下七點五分，這是他獲得全國個人賽冠軍的第二年。他是江蘇泰州人，棋壇稱他笑面佛，因為他從頭到尾都在笑。笑容背後是滴水不漏的佈局，以及把小到看不見的優勢一點點磨成勝勢的功夫。',
  'He is the one champion here without a game, and that is a fact about the archives rather than about him. Four games survive from the 1993 edition in the databases this article draws on, and none of them are his. Showing a game from another event would be a different claim than the one this page makes.':
    '他是本頁唯一沒有配棋譜的冠軍，這說的是棋譜庫的問題，不是他的問題。本文所用的資料庫裡，1993年那屆只留下四局棋，沒有一局是他的。拿另一項賽事的棋來充數，說的就不是這一頁要說的事了。',
  'Three world titles, 1999, 2003 and 2007, alongside six Chinese national championships. He won his first national title at eighteen, second only to Hu Ronghua’s fifteen, and spent two decades as the best player in the country not named Hu Ronghua.':
    '三個世界冠軍，1999、2003和2007年，另有六個全國個人賽冠軍。他十八歲首奪全國冠軍，僅次於胡荣华的十五歲，並且有二十年時間是這個國家裡除胡荣华之外最強的棋手。',
  'Like Lü Qin he came out of Guangdong, like Lü Qin he built his game on endgames, and like Lü Qin he is one of the three men here with a clean record.':
    '他和吕钦一樣出自廣東，一樣把棋建立在殘局功夫上，也一樣是本頁三位紀錄清白的棋手之一。',
  'Xu Yinchuan vs Nguyễn Vũ Quân, 2007, from the last of his three titles. Our engine grades him 98.5, the cleanest game on this page.':
    '许银川對阮武君，2007年，出自他三個冠軍中的最後一個。我們的引擎給他打出98.5分，是本頁最乾淨的一局。',
  'From Taizhou in Zhejiang, national champion at nineteen in 2007, and world champion at twenty-one in 2009 with fifteen points from nine games. He is still the youngest man to have won this title, and taking it completed the set of national, Asian and world championships that Chinese xiangqi calls a grand slam.':
    '浙江台州人，2007年十九歲奪得全國冠軍，2009年二十一歲奪得世界冠軍，九局拿下十五分。他至今仍是拿下這個頭銜最年輕的棋手，而這一冠也讓他集齊全國、亞洲與世界三項冠軍，中國象棋界稱之為大滿貫。',
  'He was banned for life on 12 January 2025, in the ruling that sanctioned forty-one people at once.':
    '2025年1月12日，他在一次處罰四十一人的決定中被終身禁賽。',
  'Zhao Xinxin vs Nguyễn Thành Bảo, 2009, from the championship he won.':
    '赵鑫鑫對阮成保，2009年，出自他奪冠的那屆比賽。',
  'Born in Yongjia, Zhejiang, in 1984. He took the Chinese national title in 2010 and the world title in Jakarta the year after, and he was the first player to pass 2700 on the rating list.':
    '1984年生於浙江永嘉。2010年奪得全國個人賽冠軍，次年在雅加達奪得世界冠軍，他也是等級分榜上第一個突破2700分的棋手。',
  'He is better known outside the tournament hall for blindfold play. On 3 January 2011 he took nineteen boards at once against Liu Dahua’s record and beat it with twenty, ending a mark that had stood since February 1995; he went to twenty-two in 2013 and to twenty-six after that, which is where the Guinness entry sits. He drew a five-year ban in April 2026.':
    '在賽場之外，他更為人知的是盲棋。2011年1月3日，他為衝擊柳大華的紀錄一次盲戰十九臺，最終以二十臺破紀錄，終結了自1995年2月起保持的那個數字；2013年他打到二十二臺，此後又打到二十六臺，吉尼斯紀錄就停在這裡。2026年4月，他被處以五年禁賽。',
  'Jiang Chuan vs Lei Kam Fun, 2011, from the championship he won.':
    '蒋川對李錦歡，2011年，出自他奪冠的那屆比賽。',
  'Three world titles and four Chinese national ones, and ten consecutive years at the top of the world rating list. In May 2023 he became the first player to hold a live rating above 2800. Beijing called him 外星人, the alien, for arriving from outside the provincial team system and beating everyone anyway.':
    '三個世界冠軍，四個全國個人賽冠軍，連續十年位居世界等級分榜首。2023年5月，他成為第一個實時等級分突破2800的棋手。北京稱他外星人，因為他不是從省隊體系裡出來的，卻照樣把所有人都贏了。',
  'The Chinese Xiangqi Association banned him for life in September 2024 and revoked his grandmaster title. A court in Hangzhou convicted him a year later.':
    '2024年9月，中國象棋協會對他終身禁賽並撤銷其特級大師稱號。一年後，杭州一家法院對他作出有罪判決。',
  'The opponent below is the reason to show this particular game: Wang Kuo is himself a Chinese national champion, and the strongest man Wang Tianyi faced across his three world finals.':
    '選這一局的理由在於對手：王廓本人也是全國個人賽冠軍，是王天一三次世錦賽決賽中遇到過的最強對手。',
  'Wang Tianyi vs Wang Kuo, 2022, from the third of his three titles.':
    '王天一對王廓，2022年，出自他三個冠軍中的第三個。',
  'Born in Chengdu in 1994. He took the Chinese national title in 2014 and again in 2015, then the world title in the same year, which is the harder order to do it in. He went to Tsinghua by recommendation in 2020 and won the individual gold at the 2023 Asian Games, China’s two hundredth medal of those Games.':
    '1994年生於成都。2014年和2015年連奪全國個人賽冠軍，同年再奪世界冠軍，這個先後順序是更難的那一種。2020年他被保送清華大學，並在2023年亞運會上奪得個人金牌，那是中國隊在那屆亞運會上的第兩百枚獎牌。',
  'He was banned for life on 12 January 2025. His title year also produced the longest game in either of these articles, and the opponent is the reason to show it.':
    '2025年1月12日，他被終身禁賽。他奪冠的那一年也留下了這兩篇文章裡最長的一局棋，而選它的理由在於對手。',
  'Lại Lý Huynh vs Zheng Weitong, 2015. Two hundred and seventy-four plies, and the man who loses it here takes the world title himself ten years later.':
    '賴理兄對郑惟桐，2015年。兩百七十四個回合，而在這裡落敗的人，十年後自己拿下了世界冠軍。',
  'From Wujiang in Suzhou, born 1981, playing from the age of seven and national youth champion at sixteen. He waited a long time for the senior title and took it in 2017 by beating the defending champion Wang Tianyi, becoming the nineteenth man to win the Chinese championship. The world title followed in Vancouver in 2019.':
    '蘇州吳江人，1981年生，七歲學棋，十六歲獲得全國少年冠軍。成年組的頭銜他等了很久，2017年他戰勝衛冕冠軍王天一奪得全國個人賽冠軍，成為第十九位全國冠軍。世界冠軍隨之而來，2019年在溫哥華。',
  'He was banned for life in April 2026.': '2026年4月，他被終身禁賽。',
  'Xu Chao vs Huang Xueqian, 2019, the final round. This is the game that won it: nine judged moves between them, and six of those are blunders.':
    '徐超對黃學謙，2019年，最後一輪。這就是奪冠的那一局：兩人合計有九步棋被引擎判定為失誤，其中六步是漏著。',
  'Born in Anshan, Liaoning, in 1988, and one of only two men on this list who never won the Chinese national championship. He took the 2023 world title in Houston by beating Lại Lý Huynh in a tiebreak, which is the second time on this page that the future champion loses to a champion before becoming one.':
    '1988年生於遼寧鞍山，是這份名單上僅有的兩位從未奪得全國個人賽冠軍的棋手之一。2023年他在休斯敦的加賽中戰勝賴理兄，奪得世界冠軍，這也是本頁第二次出現未來的冠軍先輸給一位冠軍、然後自己成為冠軍。',
  'He drew a six-month ban in January 2025, the lightest ruling here.':
    '2025年1月，他被處以六個月禁賽，是本頁最輕的一項處罰。',
  'Meng Chen vs Lại Lý Huynh, 2023. The second time the future champion loses to a champion before becoming one.':
    '孟辰對賴理兄，2023年。未來的冠軍先輸給一位冠軍、然後自己成為冠軍，這是第二次。',
  'Why the national title is the harder one': '為什麼全國冠軍更難拿',
  'Lü Qin has five of the nineteen titles, Xu Yinchuan three and Wang Tianyi three, so eleven of the nineteen editions belong to three men. Nine of the eleven world champions also won the Chinese national championship. The two who did not are Meng Chen, who took the 2023 world title, and Lại Lý Huynh, who is Vietnamese and could never have entered the Chinese event.':
    '十九個冠軍裡，吕钦佔五個，许银川三個，王天一三個，也就是說十九屆中有十一屆屬於三個人。十一位世界冠軍中有九位同時也拿過全國個人賽冠軍。沒拿過的兩位，一位是2023年奪冠的孟辰，另一位是賴理兄，他是越南人，本來就不可能參加中國的比賽。',
  'That is the whole argument in one line. The world field is drawn from the same pool as the national field, minus most of it. China sends a small delegation, the rest of the entry is the strongest players from everywhere else, and for thirty-five years everywhere else was not close. A player who can win in Beijing can usually win in Singapore or Vancouver; the reverse has almost never been true.':
    '一句話就能說完整個論證。世錦賽的參賽者與全國賽出自同一個池子，只是被砍掉了絕大部分。中國只派出一支小型代表隊，其餘名額來自世界其他地方最強的棋手，而三十五年來，世界其他地方差得很遠。能在北京奪冠的棋手，通常也能在新加坡或溫哥華奪冠；反過來則幾乎從未發生。',
  'The comparison English readers reach for is the wrong way round. The world title here is closer to a strong invitational than to a world championship, and the national championship is the thing with the deep field, the long history and the names everyone knows. Lü Qin has five world titles and never finished a year as the best player in China; Hu Ronghua, who was that player for two decades, never won this event at all.':
    '英文讀者習慣拿來類比的那組關係，方向正好反了。這裡的世界冠軍更接近一項高水準邀請賽，而不是世界錦標賽；全國個人賽才是那個參賽面深、歷史長、名字人人都認得的比賽。吕钦有五個世界冠軍，卻從未在哪一年成為中國最強的棋手；而二十年裡一直是那個人的胡荣华，根本沒有拿過這項賽事的冠軍。',
  'The decade with a ruling on it': '被處罰覆蓋的那十年',
  'Every edition from 2009 to 2023 was won by a man who now has a published ruling against him. That is eight championships and six men: three banned for life, one convicted in court, one given five years, and one given six months.':
    '從2009年到2023年，每一屆的冠軍如今都揹著一份已公佈的處罰決定。這是八屆比賽、六個人：三人終身禁賽，一人被法院判罪，一人五年禁賽，一人六個月禁賽。',
  'The rulings came out of the match-fixing case the Chinese press calls 录音门, the recording gate, which the Chinese Xiangqi Association worked through between 2024 and 2026. It has [a page of its own](/blog/xiangqi-match-fixing): the investigation, everyone sanctioned, the reasoning, and the sources. The findings are by the sport’s own governing body rather than allegations, and they are about those players’ careers rather than about specific world championship games.':
    '這些處罰出自中國媒體稱為錄音門的假棋案，中國象棋協會在2024年到2026年間陸續處理完畢。它另有[專頁](/blog/xiangqi-match-fixing)：調查經過、全部受罰者、來龍去脈與資料來源。這些認定是這項運動自己的管理機構作出的，不是指控；針對的是這些棋手的職業生涯，而不是某一局具體的世錦賽對局。',
  'The names stay in the table and the sections stay on the page. A list that quietly dropped them would be a worse record of what happened, and what the rulings do not tell you is which games were fixed. The [national championship list](/blog/xiangqi-champions) tells the same decade from the other side, where ten of the thirteen men who have won since 2005 carry a ruling.':
    '名字留在表裡，章節留在頁面上。悄悄把他們刪掉的名單，是一份更差的歷史記錄；而這些處罰並沒有告訴你哪些棋是假的。[全國冠軍名單](/blog/xiangqi-champions)從另一側講述同樣的十年，那裡2005年以來奪冠的十三人中有十人揹著處罰。',
  'The 2025 championship was played in Shanghai in September, and won by Lại Lý Huynh of Vietnam, who beat Yin Sheng of China in the final on the twenty-seventh. He is the first man from outside China to take the standard title in the thirty-five years the event has existed.':
    '2025年的世錦賽9月在上海舉行，越南的賴理兄奪冠，他在27日的決賽中戰勝了中國的殷升。在這項賽事存在的三十五年裡，他是第一個把慢棋冠軍拿走的非中國棋手。',
  'Lại Lý Huynh vs Fung Ka-chun, 23 September 2025, four days before the final. Two hundred and seventeen plies, and the engine has him level as late as move ninety.':
    '賴理兄對馮家俊，2025年9月23日，決賽前四天。兩百一十七個回合，引擎認為直到第九十回合雙方仍然均勢。',
  'It is tempting to read the two facts together, as though the bans opened a door. That reading is too neat. He was born in Vĩnh Long in 1990, won the world rapid title in 2022, and reached this final in 2023 before losing it to Meng Chen in a tiebreak. He appears twice more on this page, losing to Zheng Weitong in 2015 and to Meng Chen in 2023, which is a decade of arriving before he won anything. Vietnam has been the second strongest xiangqi nation for a generation without much English notice.':
    '把這兩件事連起來讀很有誘惑力，好像是禁賽替他打開了門。這個讀法太齊整了。他1990年生於永隆，2022年拿下世界快棋冠軍，2023年就打進過這項決賽，在加賽中輸給孟辰。他在本頁還出現過兩次，2015年輸給郑惟桐，2023年輸給孟辰，也就是說他在拿到任何東西之前已經來了十年。越南做了一代人的世界第二象棋強國，英文世界卻幾乎沒有注意到。',
  'Where that leaves the title': '這個頭銜的分量',
  'Nineteen editions, eleven winners, and a question that had the same answer for thirty-five years. The world title had never left China. Now it has, in the same decade the sport spent voiding its own results, and those two things are worth keeping separate.':
    '十九屆，十一位冠軍，還有一個三十五年來答案不變的問題。世界冠軍從未離開過中國。現在它離開了，而這十年正是這項運動忙著推翻自己成績的十年，這兩件事值得分開來看。',
  'What the title is worth is a separate question again, and the honest answer is that it has always been worth less than the championship held in Beijing. That is not a slight on the men who won it. It is what happens when one country is this far ahead of the rest, and it is the thing 2025 has started to change.':
    '這個頭銜究竟值多少，又是另一個問題，老實的回答是：它一直不如在北京舉行的那個比賽。這不是貶低奪得它的棋手。當一個國家領先其他國家這麼多時，事情本來就會是這樣，而2025年開始改變的正是這一點。',
  'Nine of the ten games on this page are chapters in a study you can work through properly: the full move tree, the engine’s lines as branches you can walk, one chapter per champion in the order they appear here.':
    '本頁十局棋中有九局收進了一份可以逐步研讀的研習：完整的著法樹，引擎給出的變化作為可以走進去的分支，每位冠軍一章，順序與本頁相同。',
  'six-month ban, 2025': '禁賽六個月，2025',
  'Lại Lý Huynh 赖理兄': '賴理兄',
  'Lại Lý Huynh': '賴理兄',
  'Wu Guilin': '吳貴臨',
  'Lei Kam Fun': '李錦歡',
  'Huang Xueqian': '黃學謙',
  'Fung Ka-chun': '馮家俊',
  '1991 2nd World Xiangqi Championship': '1991年第二屆世界象棋錦標賽',
  '1997 5th World Xiangqi Championship': '1997年第五屆世界象棋錦標賽',
  '2007 10th World Xiangqi Championship': '2007年第十屆世界象棋錦標賽',
  '2009 11th World Xiangqi Championship': '2009年第十一屆世界象棋錦標賽',
  '2011 12th World Xiangqi Championship': '2011年第十二屆世界象棋錦標賽',
  '2015 14th World Xiangqi Championship': '2015年第十四屆世界象棋錦標賽',
  '2019 16th World Xiangqi Championship': '2019年第十六屆世界象棋錦標賽',
  '2022 17th World Xiangqi Championship': '2022年第十七屆世界象棋錦標賽',
  '2023 18th World Xiangqi Championship': '2023年第十八屆世界象棋錦標賽',
  '2025 19th World Xiangqi Championship': '2025年第十九屆世界象棋錦標賽',
  // ---- jieqi-openings (machine-drafted 2026-08-30, not native-reviewed) ----
  'Jieqi on Mistboard': 'Mistboard 上的揭棋',
  'Jieqi and xiangqi players who want to know what the first move is worth, and English speakers who have never seen this material because it has only ever existed in Chinese.':
    '想知道第一步值多少的揭棋和象棋棋手，以及從未接觸過這些內容的英文讀者：這些材料此前只存在於中文之中。',
  'What Strong Jieqi Players Believe About the Opening': '高手眼中的揭棋開局',
  'Jieqi Opening Theory: The First Move, Ranked': '揭棋開局：第一步怎麼走，附排序',
  'Jieqi has no opening book. It has an argument about the first move, running on Chinese forums among players with thousands of games, never written down in English. Why a face-down piece is a one-shot option you can waste, five openings ranked, and the pawn push weighed against the crossed cannon on all six reveals.':
    '揭棋沒有開局譜。它有的是一場關於第一步的爭論，在中文論壇上持續多年，參與者都是對局上千盤的棋手，卻從未有人用英文寫下來。為什麼一枚暗子是隻能用一次的權利、五種開局的排序，以及仙人指路與過河炮在六種翻出結果下的逐一比較。',
  'Jieqi has no opening book. No catalog of variations, no agreed piece-value table, nothing to memorize. One of the strongest players who writes about the game, a level-two Chinese xiangqi player claiming 90% over three thousand games, started the missing book and got one chapter in.':
    '揭棋沒有開局譜。沒有變例目錄，沒有公認的子力價值表，沒有需要背的東西。寫這個遊戲寫得最好的棋手之一，一位自稱三千盤勝率九成的中國象棋二級棋士，動手寫了那本缺失的書，寫完第一章就停了。',
  'What exists is an argument about the first move, running on Chinese forums for years, never written down in English. Here it is, with the sources at the bottom. Treat it as what strong players believe: none of it has been measured.':
    '真正存在的是一場關於第一步的爭論，在中文論壇上持續多年，從未有人用英文寫下來。以下就是這場爭論，出處列在文末。請把它當作高手們的看法：其中沒有一條經過實測。',
  'Every piece but the two generals starts face-down and shuffled. Neither player knows their own.':
    '除雙方將帥外，所有棋子開局時都是打亂後反扣的。雙方都不知道自己的棋子是什麼。',
  'A dark piece moves as the point it stands on': '暗子按它所在的位置行棋',
  'A face-down piece moves, attacks, and captures as the piece belonging to the point it sits on, not as whatever it turns out to be. A dark piece on a cannon point moves like a cannon and captures like a cannon. Then it flips and plays as itself. The [rules page](/rules/jieqi) has the rest.':
    '暗子的走法、攻擊和吃子，都按它所在起始位置那枚棋子來算，而不是按它翻開後的真實身份。炮位上的暗子走起來像炮，吃子也像炮。走完這一步它就翻開，之後按真實身份行棋。其餘規則見[規則頁](/rules/jieqi)。',
  'So a face-down piece holds one use of its square’s power. A dark piece on a chariot point is a chariot for exactly one move, and then it is whatever it actually is, which might be a pawn. That single move is the most valuable thing about it, and you get to spend it once.':
    '所以一枚暗子握著它所在位置那種棋力的一次使用權。車位上的暗子就是一步之內的車，走完之後它是什麼就是什麼，也許只是一個兵。那一步是它身上最值錢的東西，而你只能花掉一次。',
  'Flipping costs two things. The square’s power goes, and so does the concealment: your opponent does not know what the piece is either, so while it stays down it threatens as its point in their reading of the position too. What you buy is that the piece plays as itself from then on, which is often a downgrade. The common mistake is spending an expensive option on a cheap job, and it costs nothing you can see on the board.':
    '翻子要付兩樣代價。位置帶來的棋力沒了，隱蔽也沒了：對手同樣不知道這枚子是什麼，所以只要它還扣著，在對手眼裡它就按所在位置構成威脅。你換來的是這枚子此後按真實身份行棋，而這往往是降級。最常見的錯誤，是把一份昂貴的權利花在一件廉價的差事上，而且棋盤上看不出你虧了什麼。',
  'The same move, before and after. Face-down on a cannon point it slides the file and takes the horse behind the screen. Play that capture and you have spent a cannon’s only shot to win a horse, and what stands on the point is a soldier. Strong players call that trade a loss.':
    '同一步棋的前後。扣著的時候，炮位上的暗子能沿直線滑動，隔著炮架吃掉那隻馬。真走了這一吃，你就用掉了炮僅有的一發，換來一隻馬，而落點上站著的是一個兵。高手把這筆交易算作虧。',
  'The first move is therefore two decisions. You choose which option to spend, and you take a lottery ticket on what stands up.':
    '所以第一步是兩個決定。你選擇花掉哪一份權利，同時抽一張關於翻出什麼的彩票。',
  'Five first moves, ranked': '五種第一步的排序',
  'From the largest jieqi thread on Zhihu, ranked by a player with more than four hundred games.':
    '出自知乎上最大的揭棋討論，排序者有四百多盤對局。',
  'Where they are, from Red’s side. Left board, left to right: the edge pawn, the 3- or 7-file pawn push, the central pawn, and the cannon point crossing the river. Right board: both cannons firing over the black cannons to take both horses.':
    '它們在棋盤上的位置，以紅方視角。左圖從左到右：邊兵、三路或七路的仙人指路、中兵，以及過河的炮位。右圖：雙炮隔著黑方的炮打掉雙馬。',
  'Option cost explains both ends of that list. The pawn push is first because a pawn point’s one move is the cheapest thing in the game to spend. Taking two horses with two cannons is last because it spends the two most expensive options on the board for two horses.':
    '權利的成本解釋了這份名單的兩頭。仙人指路排第一，因為兵位的那一步是全盤最便宜的花費。雙炮打雙馬排最後，因為它用掉了盤上最貴的兩份權利，只換來兩隻馬。',
  'The middle two rank on position. The central pawn is the sensitive one: turn over a chariot there and a revealed cannon can kill it, but turn over a cannon and you can probe the centre and both edges for chariots, and those follow-ups are settled enough that players call them 定式, set patterns. The edge pawn is just as cheap and buys much less. It opens a path for the edge horse and announces that it is doing so, and a horse turned over on the edge is stuck where it stands.':
    '中間兩種靠局面排序。中兵是敏感的一手：這裡翻出車，對方翻出的炮就能打死它；翻出炮，你卻可以試探中路和兩翼找車，而這些後續走法成熟到棋手稱之為定式。邊兵一樣便宜，買到的卻少得多。它給邊馬讓出一條路，同時把這個意圖明說出來，而邊上翻出的馬會卡死在原地。',
  'Our own games disagree with the list. Across fifty jieqi games here that ran past ten moves, humans playing Red opened with the central pawn in fourteen of twenty-five, and with the recommended pawn push in three. Whatever the forums say, players open in the middle.':
    '我們自己的對局和這份名單並不一致。在 Mistboard 上五十盤走過十回合的揭棋裡，執紅的人類棋手二十五盤中有十四盤走中兵，走推薦的仙人指路只有三盤。不管論壇怎麼說，棋手們從中路開局。',
  'PikaJieQi, our build of Pikafish’s jieqi branch, declines the list altogether. In twenty of its twenty-five games as Red it opened from a back-rank horse point, h1 to g3 or b1 to c3, a development move none of the five covers. Read that carefully before treating it as a verdict. It is one engine at two settings repeating itself, not twenty independent opinions. The humans lost almost every game, so nothing here settles which opening is better. And PikaJieQi runs a hand-written evaluation with no neural network, so its opening preference reflects the heuristics someone wrote into it rather than anything it learned. What it does suggest is that the list answers a narrower question than it appears to.':
    'PikaJieQi 是我們基於 Pikafish 揭棋分支的構建，它乾脆不用這份名單。它執紅的二十五盤裡有二十盤從底線馬位起手，h1 到 g3 或 b1 到 c3，這是五種開局都沒有涵蓋的一種出子走法。把它當成結論之前請讀仔細。那是同一個引擎在兩檔強度下重複自己，不是二十個獨立意見。人類幾乎盤盤皆輸，所以這些資料判定不了哪種開局更好。而且 PikaJieQi 用的是手寫評估函式，沒有神經網路，所以它的開局偏好反映的是有人寫進去的啟發式規則，而不是它自己學到的東西。它提示的是，這份名單回答的問題比看上去要窄。',
  'The pawn push beats the crossed cannon on 13 of 15': '十五種翻出裡，仙人指路有十三種勝過過河炮',
  'A player rated 揭7 on two accounts weighed the top two against each other: the pawn push against the cannon point crossing the river. Whichever you pick, the piece you move is your own and you do not know what it is until it lands. Fifteen sit face-down on your side, five pawns and two each of chariot, horse, cannon, advisor and elephant, so the odds on what stands up are countable.':
    '一位在兩個賬號上都打到揭7的棋手，把排在前面的兩種開局逐一比較：仙人指路對過河的炮位。無論選哪一種，你動的都是自己的暗子，落子之前你不知道它是什麼。你這邊有十五枚暗子：五個兵，車馬炮士象各兩枚，所以翻出什麼的機率是可以算的。',
  'On a pawn, the crossed cannon eats once and gives up two or three reveals in exchange. On a chariot, holding a dark cannon in reserve beats holding a dark pawn. The rest it simply plays less efficiently, and the advisor is the one case it wins, slightly.':
    '翻出兵時，過河炮吃到一子，卻讓對方翻出兩三枚作為代價。翻出車時，手裡留一枚暗炮勝過留一枚暗兵。其餘幾種它只是走得效率更低，而士是它唯一略佔上風的一種。',
  'Thirteen of the fifteen favour the pawn push, about 87%, and the count understates it: the crossed cannon’s one win is slight while several of the pawn push’s are decisive. The verdicts are theirs, the weights are mine from the piece counts, and nobody has run that comparison past an engine.':
    '十五枚裡有十三枚站在仙人指路一邊，約百分之八十七，而這個數字還說低了：過河炮唯一的那次勝出只是略勝，仙人指路的幾次卻是決定性的。判斷出自那位棋手，權重是我按棋子數算的，而這場比較從來沒有引擎跑過。',
  'Those odds hold on move one. The deck does not refill, so every reveal narrows what is left, and a player counting what has already turned over is working from better numbers later in the game.':
    '這些機率只在第一步成立。這副牌不會補充，所以每翻開一枚，剩下的範圍就窄一分，而記住已經翻出過什麼的棋手，到後面用的是比這張表更準的數字。',
  'A chariot is worth about two cannons': '一車約值兩炮',
  'In xiangqi a chariot trades roughly for a horse and a cannon. In jieqi the same players put it higher, closer to two cannons, and arguably above a horse, cannon and advisor together. The general has no fixed guard here: any piece can be anything, so the wall in front of a jieqi general is whatever happened to land there, and a chariot walks through it.':
    '在象棋裡，一車大致換一馬一炮。在揭棋裡，同樣這批棋手把它抬得更高，接近兩炮，甚至高於馬炮士三子之和。這裡的將帥沒有固定的護衛：任何一枚子都可能是任何東西，所以揭棋裡將帥面前的那道牆，只是碰巧落在那裡的棋子，而車會直接穿過去。',
  'Protect yours. Holding one chariot against two, refuse the trade, even with both of theirs still face-down. This is also why the two dark pieces on the back chariot points usually stay down: they defend, and they are the most expensive unspent options either player holds.':
    '護住自己的車。手裡一車對人家兩車時，不要兌，哪怕對方兩車都還扣著。這也是為什麼底線兩個車位上的暗子通常一直不翻：它們既是防守，也是雙方手裡最貴的、尚未動用的權利。',
  'With a chariot: the river bank, then the file': '有車之後：先控河沿，再佔肋道',
  'One sequence in jieqi behaves like a line. With a chariot out, take the opponent’s river bank, occupy a file, and prepare the attack that comes with exposing your own general. Experienced opponents know the answer: fly an elephant and jump a horse quickly, so the back chariot point covers the approach.':
    '揭棋裡只有一條路數像定式。車出來之後，控制對方的河沿，佔住一路，再準備那種亮帥助攻的進攻。有經驗的對手知道怎麼應：趕緊飛象跳馬，讓底線的車位守住通路。',
  'A chariot-led file attack against a fast elephant-and-horse screen is as close as this opening gets to established theory.':
    '車領銜的肋道進攻，對上快速成型的象馬屏障，這是揭棋開局最接近成型理論的東西。',
  'Black races for a chariot of their own': '黑方要搶自己的車',
  'Everything above is Red’s choice. Red’s edge is larger here than in xiangqi, because chariots can sit face-down and arrive in the middlegame.':
    '上面說的都是紅方的選擇。紅方的先手優勢在揭棋裡比象棋更大，因為車可以一直扣著，留到中局才出現。',
  'When Red’s pawn push turns over a chariot, develop a horse and race for a chariot of your own. There is no better answer, and strong players do not pretend there is one.':
    '紅方仙人指路翻出車時，跳正馬，去搶自己的車。沒有更好的應法，高手也不假裝有。',
  'When your chariots arrive late anyway, drop the development order. Pawn, then horse, then advisor is a peacetime plan. Get both horses out instead, so your pieces defend each other.':
    '如果你的車終究來得晚，就別守出子次序了。先兵後馬再上士是太平時候的計劃。把雙馬都跳出來，讓各子互相生根。',
  'Stop flipping once three major pieces are out': '三個大子出來之後就別再翻了',
  'Once three major pieces are revealed and active, attack with them. Flipping past that point hands the initiative to whoever is already developed, because a flip is a move that threatens nothing while your opponent uses theirs. On Tiantian Xiangqi the rated jieqi clock is tighter than the xiangqi one and carries no per-move increment, so the player still turning pieces over in a sharp position tends to lose on time as well.':
    '三個大子翻開並投入戰鬥之後，就用它們進攻。過了這個點還在翻子，等於把主動權交給已經出好子的一方，因為翻一步什麼也威脅不到，而對手那一步是有用的。天天象棋的揭棋定級賽用時比象棋更緊，而且沒有每步加秒，所以在尖銳局面裡還在翻子的一方，往往還會超時告負。',
  Sources: '出處',
  'Three Chinese-language posts. Titles are given in English, with the original after, so you can search for them.':
    '三篇中文帖子。下面同時給出英文譯名和原標題，方便檢索。',
  '[Notes on Jieqi, Part 1](https://zhuanlan.zhihu.com/p/347466882) (揭棋心得 Part.1). The closest thing to a jieqi book that exists, and it is one chapter. Source for the piece values, the chariot, and what spending an option costs.':
    '[揭棋心得 Part.1](https://zhuanlan.zhihu.com/p/347466882)。目前最接近一本揭棋書的東西，只有一章。子力價值、車的分量，以及花掉一份權利的代價都出自這裡。',
  '[What do you make of Tiantian Xiangqi’s jieqi mode?](https://www.zhihu.com/question/53501615) (如何看待天天象棋推出的“揭棋”玩法？). The largest jieqi discussion anywhere. Source for the ranking, the reveal-by-reveal case, and the chariot plan.':
    '[如何看待天天象棋推出的“揭棋”玩法？](https://www.zhihu.com/question/53501615)。目前最大的揭棋討論。排序、逐一翻出的比較，以及有車之後的路數都出自這裡。',
  '[A notation for jieqi and banqi](https://zhuanlan.zhihu.com/p/638758588) (《天天象棋》揭棋和翻翻棋的记谱法). Proposes a way to record these games, which does not otherwise exist. Background only.':
    '[《天天象棋》揭棋和翻翻棋的記譜法](https://zhuanlan.zhihu.com/p/638758588)。提出了一套記譜方式，此前並不存在。僅作背景參考。',
  'There is no jieqi opening database and no published statistics. The fifty games cited above are our own, they are mostly humans losing to Pikafish, and they are nowhere near enough to settle whether the pawn push really outperforms the crossed cannon. They are enough to say what people here actually play.':
    '揭棋沒有開局資料庫，也沒有公開的統計。上面引用的五十盤是我們自己的對局，大多是人類輸給 Pikafish，遠不足以判定仙人指路是否真的勝過過河炮。它們只夠說明這裡的人實際在下什麼。',
  Opening: '開局',
  Verdict: '評價',
  'Pawn push (仙人指路)': '仙人指路',
  'Crossed cannon (炮二进四)': '過河炮（炮二進四）',
  'Central pawn (冲中兵)': '衝中兵',
  'Edge pawn (九尾龟)': '邊兵（九尾龜）',
  'Both cannons take horses': '雙炮打雙馬',
  'Standard. No bad reveal.': '標準著法。翻出什麼都不算壞。',
  'Good on a pawn, bad on a horse.': '翻出兵好，翻出馬差。',
  'Risky. Exposed in the middle.': '有風險，中路容易受攻。',
  'Poor. An edge horse is stuck.': '差。邊上翻出的馬會卡死。',
  'Losing. A weak player’s gamble against a strong one.': '虧。是弱手對強手的賭博。',
  'What flips up': '翻出什麼',
  Odds: '機率',
  'Better opening': '更優的開局',
  Pawn: '兵',
  'Pawn push': '仙人指路',
  'Crossed cannon': '過河炮',
  // The three tables, Traditional forks only. Player names and the all-digit
  // cells inherit from the Simplified spread above.
  '~2012 onward': '2012年前後起',
  'Liu Dahua privately alleges engine cheating': '柳大华私下指認軟件作弊',
  'The Hao Jichao and Wang Yuefei recordings appear online': '郝继超與王跃飞的通話錄音在網上流出',
  'The association opens a formal investigation and forms a task force':
    '中國象棋協會立案調查並成立專案組',
  'Wang Tianyi withdraws from the Hangzhou Asian Games, citing health':
    '王天一以身體原因退出杭州亞運會',
  'Liu Dahua makes a real-name accusation against a sport-administration official':
    '柳大华實名舉報體育總局一名官員',
  'The date the April 2026 bans run from; the January notice publishes none':
    '2026年4月處罰的起算日；1月的通報未公布日期',
  'First sanctions: Wang Tianyi and Wang Yuefei, life': '首批處罰：王天一、王跃飞終身禁賽',
  'Six grandmasters convicted in Hangzhou': '六名特級大師在杭州被判有罪',
  Life: '終身禁賽',
  '7 years 6 months': '7年6個月',
  '4 years 6 months': '4年6個月',
  '4 years 3 months': '4年3個月',
  '6 months': '6個月',
  Reprimand: '通報批評',
  '4 years 9 months': '4年9個月',
  '2 years 9 months': '2年9個月',
  '2 years 7 months': '2年7個月',
  '2 years 6 months': '2年6個月',
  '[Xinhua](https://www.news.cn/sports/20260413/5a609df239414cb1b7118b2aa88518d0/c.html), [Caixin](https://china.caixin.com/2026-04-13/102433594.html)':
    '[新華社](https://www.news.cn/sports/20260413/5a609df239414cb1b7118b2aa88518d0/c.html)、[財新](https://china.caixin.com/2026-04-13/102433594.html)',
  'The April 2026 rulings': '2026年4月的處罰',
  '[China News Service](https://www.chinanews.com.cn/ty/2025/01-13/10352255.shtml), [China Daily](https://cn.chinadaily.com.cn/a/202501/12/WS6783355ea310b59111dad5af.html)':
    '[中新網](https://www.chinanews.com.cn/ty/2025/01-13/10352255.shtml)、[中國日報](https://cn.chinadaily.com.cn/a/202501/12/WS6783355ea310b59111dad5af.html)',
  'The 41-person batch, January 2025': '2025年1月的41人處罰',
  '[National Business Daily](https://www.nbd.com.cn/articles/2024-09-19/3562788.html)':
    '[每日經濟新聞](https://www.nbd.com.cn/articles/2024-09-19/3562788.html)',
  'Wang Tianyi’s life ban, September 2024': '2024年9月王天一被終身禁賽',
  '[Yangtse Evening Post](https://www.yzwb.net/news/ty/202509/t20250924_268789.html), [Sina Sports](https://sports.sina.cn/others/qipai/2025-09-25/detail-infrsnht5787840.d.html)':
    '[揚子晚報](https://www.yzwb.net/news/ty/202509/t20250924_268789.html)、[新浪體育](https://sports.sina.cn/others/qipai/2025-09-25/detail-infrsnht5787840.d.html)',
  'The verdict and the six sentences': '宣判與六人刑期',
  '[Tencent News](https://news.qq.com/rain/a/20250924A04LFX00)':
    '[騰訊新聞](https://news.qq.com/rain/a/20250924A04LFX00)',
  'Hong Zhi’s refusal to plead guilty, via his counsel': '洪智不認罪，經其辯護人確認',
  '[CCTV](https://news.cctv.cn/2025/01/13/ARTIeFfY6eKYaRLubq3G5ZQp250113.shtml)':
    '[央視新聞](https://news.cctv.cn/2025/01/13/ARTIeFfY6eKYaRLubq3G5ZQp250113.shtml)',
  'The appearance-fee figures and the four motives': '出場費數字與各項動機',
  '[Jiemian](https://m.jiemian.com/article/12366112.html)':
    '[界面新聞](https://m.jiemian.com/article/12366112.html)',
  'Liu Dahua’s account, and how the recordings spread': '柳大华的說法，以及錄音如何流傳',
  '[Guancha](https://www.guancha.cn/sports/2025_01_12_761863.shtml)':
    '[觀察者網](https://www.guancha.cn/sports/2025_01_12_761863.shtml)',
  'The fullest timeline of the affair': '事件最完整的時間線',
  // Jieqi platform page. Machine-drafted 2026-09-03 and not native-reviewed,
  // shipped on the standard set on 2026-08-29: a translation does not wait for a
  // read that is not coming. Locked the same day its English copy published, so
  // any later English edit orphans a key here and fails the coverage test.
  'Play jieqi against the engine or a friend, free and without an account, then review the game with analysis that separates your choices from your luck.':
    '免費和引擎或朋友下揭棋，不用註冊，下完還能複盤，分析會把你的選擇和你的運氣分開算。',
  'Jieqi is [xiangqi](/rules/xiangqi) with every piece face-down. A piece moves as whatever normally starts on its square, then flips and keeps that identity for the rest of the game. You begin without knowing what anything is, including your own pieces. The [rules page](/rules/jieqi) has the details.':
    '揭棋就是把每個子都翻扣過去的[象棋](/rules/xiangqi)。暗子按它所在那個點原本擺的子走，走完就翻開，之後一直是翻出來的那個子。開局時你不知道任何一個子是什麼，連自己的也不知道。[規則頁](/rules/jieqi)有詳細說明。',
  'It is a young game, out of Hong Kong and Guangdong, and it has spread over the last couple of decades mostly among Chinese and Vietnamese players. For what to actually open with, see [what strong players believe about the opening](/blog/jieqi-openings).':
    '這是一門年輕的棋，出自香港和廣東，最近二三十年主要在華人和越南棋手之間傳開。至於開局到底該走什麼，見[強手眼中的揭棋開局](/blog/jieqi-openings)。',
  'Play the engine': '和引擎下',
  'Play a friend': '和朋友下',
  'Plain discs are still face-down. Each one turns over the first time it moves and is stuck with whatever it turns out to be.':
    '素面的圓子仍然是暗子。每個子第一次走動時翻開，翻出什麼就是什麼，再也換不掉。',
  'Mistboard · 5+5 casual': 'Mistboard · 5+5 非計分',
  'Black delivers checkmate on move 73.': '黑方在第 73 回合將死。',
  'That is [a real game on this site](/jieqi/game/jq_96f40ebb-1347-4c31-babe-d777c4a88ddf), not a demo, and every screenshot below comes from it.':
    '那是[本站的一盤真實對局](/jieqi/game/jq_96f40ebb-1347-4c31-babe-d777c4a88ddf)，不是演示，下面每一張截圖都來自這盤棋。',
  'Play the engine at 1+1, 3+2 or 5+5, or send a friend a link. Free, no sign-up, nothing to install.':
    '用 1+1、3+2 或 5+5 和引擎下，或者把連結發給朋友。免費，不用註冊，什麼都不用裝。',
  'Review your games': '複盤你的對局',
  'Ask for analysis on a finished game and the review separates what you chose from what you drew, which is the part a chess site has no reason to do. You also get the usual: a graph of the whole game, an accuracy score for each player, and every inaccuracy, mistake and blunder marked with the move that was better. It runs on our servers and takes a few minutes.':
    '對下完的棋點一次分析，複盤會把你選的和你揭到的分開來講，這一塊是西洋棋網站沒有理由去做的。常規的東西也都有：整盤棋的優勢曲線、雙方各自的準確率，以及每一個不準確、失誤和嚴重失誤，都標出更好的著法。分析在我們的伺服器上跑，要幾分鐘。',
  'The game above, graded.': '還是上面那盤棋，評過分了。',
  'A game summary: the advantage graph swinging back and forth across the game, beside accuracy cards reading Pikafish 86 percent with thirteen inaccuracies, two mistakes and one blunder, and Guest 91 percent with six inaccuracies, two mistakes and one blunder.':
    '一份對局總結：優勢曲線在整盤棋裡來回擺動，旁邊是準確率卡片，Pikafish 86%，十三個不準確、兩個失誤、一個嚴重失誤；Guest 91%，六個不準確、兩個失誤、一個嚴重失誤。',
  'It tells you how lucky each flip was': '它會告訴你每次揭子運氣有多好',
  'Half your moves turn a piece over, and you never know what you are turning over. So the engine works out what each piece that tile could have been would have been worth, and compares it to what you actually got. The gap is your luck on that flip.':
    '你有一半的著法是在翻子，而翻之前你並不知道翻的是什麼。所以引擎會算出那個點上每一種可能的子分別值多少，再和你實際翻到的比一比。差出來的那一塊，就是你這一揭的運氣。',
  'Move 19 played the 39% move when 52% was there, so it is marked. Move 21 played the best one and still got a +43% gift from the flip.':
    '第 19 回合走了 39% 的著法，而當時有 52% 的可走，所以被標了出來。第 21 回合走的是最佳著法，同時還從揭子裡白拿了 +43%。',
  'A jieqi review move list. Move 19 is a flip carrying a dice badge reading minus 21 percent, above four ranked candidate moves at 52, 39, 34 and 29 percent with the played move marked second. Move 21 carries plus 43 percent, move 21 for black plus 6 percent, and move 22 minus 10 percent.':
    '一份揭棋複盤的著法列表。第 19 回合是一次揭子，帶著一個寫著 -21% 的骰子標記，下面是四個排好序的候選著法，分別為 52%、39%、34% 和 29%，實戰著法排在第二。第 21 回合是 +43%，黑方第 21 回合是 +6%，第 22 回合是 -10%。',
  'The percentage on each move is what it was worth before you flipped, averaged over every piece that tile could have been. The dice is what the flip actually gave you on top of that. So a move can be the best choice available and still come with a large plus or minus beside it: the first number is your decision, the second is the draw.':
    '每個著法旁邊的百分數，是你揭開之前它值多少，按那個點上每一種可能的子取平均。骰子則是這一揭在此之外實際給了你多少。所以一個著法可以既是當時最好的選擇，旁邊又掛著一個很大的正數或負數：第一個數是你的決定，第二個數是你抽到的籤。',
  'When your move is the top one, you chose well. Moves are only marked as mistakes when a better one was on the list.':
    '只要你走的是排第一的那個，你就選對了。只有當列表裡存在更好的著法時，一個著法才會被標成失誤。',
  'Your accuracy is then built from the choices alone, so a lucky flip cannot flatter it and an unlucky one cannot spoil it.':
    '準確率只由這些選擇算出來，所以揭得好不會把它抬高，揭得差也不會把它拉低。',
  'And it runs in your browser': '而且它就在你的瀏覽器裡跑',
  'The analysis board runs the same engine on your own machine, drawing its best moves on the board as you try a line. Nothing is queued, nothing is sent anywhere, and it needs no account. [The engine is open source](https://github.com/brianhliou/pikafish-jieqi-wasm), so if a number here looks wrong you can go and read the code that produced it.':
    '分析棋盤把同一個引擎放在你自己的機器上跑，你擺一條變化，它就把最佳著法畫在棋盤上。不用排隊，什麼都不會傳出去，也不需要帳號。[引擎是開放原始碼的](https://github.com/brianhliou/pikafish-jieqi-wasm)，所以這裡的某個數字如果看著不對，你可以直接去讀算出它的那段程式碼。',
  'Running in a browser tab.': '就在一個瀏覽器分頁裡跑。',
  'The analysis board with the local engine switched on: PikaJieQi at depth 18 and 335,000 nodes per second, three candidate lines each with an evaluation, and arrows for each drawn on the jieqi board.':
    '打開本機引擎後的分析棋盤：PikaJieQi 深度 18，每秒 335,000 個節點，三條候選變化各帶一個評分，並在揭棋棋盤上分別畫出箭頭。',
  'Open the analysis board': '打開分析棋盤',
  'The engine': '關於引擎',
  'PikaJieQi is a fork of [Pikafish](https://github.com/official-pikafish/Pikafish), the open-source xiangqi engine, on its jieqi branch. Classical alpha-beta search with a hand-written evaluation and no neural network. What makes it a jieqi engine rather than a xiangqi one is that it treats every face-down piece as a chance node, scoring a move as the average over each piece that tile could still be. It only ever sees the face-down board, and a test fails the build if a hidden identity ever leaks into what it is sent.':
    'PikaJieQi 是開放原始碼象棋引擎 [Pikafish](https://github.com/official-pikafish/Pikafish) 揭棋分支的一個分支版本。經典的 alpha-beta 搜尋，配一套手寫評估函式，沒有類神經網路。讓它成為揭棋引擎而不是象棋引擎的地方在於：它把每一個暗子當作一個機率節點，一個著法的分數，是那個點上所有仍然可能的子分別算分之後的平均。它自始至終只看得到那張暗著的棋盤，只要有任何一個隱藏身分漏進發給它的資料裡，就會有一個測試讓建置失敗。',
  "It is beatable, and the game at the top of this page is one it lost. You can watch it play itself in [these engine games](/study/wd6c7qvG). Almost all of modern Pikafish's strength lives in its neural network and jieqi has no good one: we trained a net and it never came out stronger than the hand-written evaluation, so this is an open problem rather than a chore nobody got round to. If you train nets, or know jieqi well enough to say where its judgement goes wrong, that is the help we would most like.":
    '它是能被打敗的，本頁最上面那盤棋就是它輸的。你可以在[這些引擎對局](/study/wd6c7qvG)裡看它自己和自己下。現代 Pikafish 的力量幾乎全在它的類神經網路裡，而揭棋沒有一張好網路：我們訓練過一張，始終沒有強過手寫的評估函式，所以這是一個還沒解決的問題，不是沒人願意幹的雜活。如果你會訓練網路，或者對揭棋熟到能指出它判斷錯在哪裡，那是我們最想要的幫助。',
  'On Mistboard': '在 Mistboard 上',
  'Play the engine or a friend': '和引擎或朋友對弈',
  'Free, no account': '免費，不用帳號',
  'Full-game analysis': '整盤分析',
  'Every finished game': '每一盤下完的棋',
  'Luck measured separately': '運氣單獨算',
  'Every flip priced': '每一次揭子都定價',
  'Engine in your browser': '引擎在你的瀏覽器裡',
  'No queue, no account': '不排隊，不用帳號',
  'Studies with your own deals': '用自己的暗子佈局做研習',
  Yes: '有',
  'Open-source engine': '開放原始碼引擎',
  'Rated ladder': '等級分天梯',
  'Open, signed in': '開放，需登入',
  'Common questions': '常見問題',
  'What is jieqi?': '揭棋是什麼？',
  'Xiangqi with every piece except the general face-down. A piece moves as whatever normally starts on its square, then turns over and keeps that identity. It is called cờ úp in Vietnamese and 揭棋 in Chinese.':
    '就是除了將帥之外每個子都翻扣過去的象棋。暗子按它所在那個點原本擺的子走，走完翻開，之後一直是那個子。越南語叫 cờ úp，中文叫揭棋。',
  'How is jieqi different from xiangqi?': '揭棋和象棋差在哪裡？',
  'Same board, same pieces, same moves, same goal. You just do not know which piece is which, so about half your moves flip one over and find out.':
    '同一張棋盤、同樣的子、同樣的走法、同樣的目標。只是你不知道哪個子是哪個，所以大約一半的著法是翻開一個子看看。',
  'Is jieqi just luck?': '揭棋是不是全靠運氣？',
  'The flips are random; what you do with them is not. Your accuracy score is built only from your choices, so a good draw cannot flatter it and a bad one cannot spoil it.':
    '揭子是隨機的，你拿它做什麼不是。你的準確率只由你的選擇算出來，所以揭得好不會把它抬高，揭得差也不會把它拉低。',
  'Can a computer play jieqi well?': '電腦下揭棋下得好嗎？',
  'Reasonably, not brilliantly. Ours is beatable by a strong human, mainly because no neural network has been trained for jieqi.':
    '還行，但談不上出色。我們這個會被強棋手打敗，主要是因為還沒有為揭棋訓練出類神經網路。',
  'Can the engine see my hidden pieces?': '引擎看得到我的暗子嗎？',
  'No. It gets the same face-down board you do and is never told the deal. A test fails the build if an identity ever leaks into what it is sent.':
    '看不到。它拿到的是和你一樣的暗著的棋盤，從來不會被告知這一局是怎麼擺的。只要有一個身分漏進發給它的資料裡，就會有一個測試讓建置失敗。',
  'Is the shuffle fair?': '洗子公平嗎？',
  'The deal is random, made on the server, and told to nobody: not you, not your opponent, not the engine.':
    '這一局怎麼擺是隨機的，在伺服器上定，並且不告訴任何人：不告訴你，不告訴你的對手，也不告訴引擎。',
  'Where can I play jieqi online for free?': '哪裡可以免費線上下揭棋？',
  'Here, against the engine or a friend. No account, nothing to install, and you can review the game with engine analysis afterwards.':
    '就在這裡，和引擎或者朋友下。不用帳號，什麼都不用裝，下完還能用引擎分析複盤。',
  'Start playing': '開始下棋',
  'Play Jieqi Online, with Engine Analysis': '線上下揭棋，附引擎分析',
  // Replay outcome lines. These sit directly under the replay header and were
  // invisible to the coverage gate until 2026-09-03, because article-prose.ts
  // read a spec's title, event and resultText but not its outcome. The jieqi
  // rules page has been serving this line in English on both zh pages since it
  // was locked.
  'Black wins by checkmate · 73 moves': '黑方將死獲勝 · 73 回合',
  'Red wins by checkmate · 36 moves': '紅方將死獲勝 · 36 回合',
};

const ARTICLE_DICTS: Record<ArticleLang, Record<string, string>> = {
  'zh-Hans': ZH_HANS,
  'zh-Hant': ZH_HANT,
};

function deepTranslate<T>(value: T, dict: Record<string, string>): T {
  if (typeof value === 'string') return (dict[value] ?? value) as T;
  if (Array.isArray(value)) return value.map((v) => deepTranslate(v, dict)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = deepTranslate(v, dict);
    return out as T;
  }
  return value;
}

// Returns a deep copy of the article with content strings swapped to `lang`.
// Strings absent from the dictionary fall through as English (graceful partial
// translation). Does not mutate the source article.
export function translateArticle(article: Article, lang: ArticleLang): Article {
  return deepTranslate(article, ARTICLE_DICTS[lang]);
}

export function translateArticleText(lang: ArticleLang | undefined, text: string): string {
  return lang ? (ARTICLE_DICTS[lang][text] ?? text) : text;
}

// True when `text` has an authored translation for `lang`. The translation
// coverage test uses this to assert that every prose string in a locked
// article resolves in both zh scripts, so an English edit that orphans a
// dictionary key fails the build instead of silently rendering English.
export function hasTranslation(lang: ArticleLang, text: string): boolean {
  return hasOwnKey(ARTICLE_DICTS[lang], text);
}

// Every authored dictionary key for `lang`. The coverage reporter uses this to
// flag orphaned keys: entries that no longer match any current article string
// (the residue of an English edit that left a stale translation behind).
export function translationKeys(lang: ArticleLang): string[] {
  return Object.keys(ARTICLE_DICTS[lang]);
}
