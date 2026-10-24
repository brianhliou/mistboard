// zh-Hans and zh-Hant for the six posts moved from brianhliou.com on
// 2026-10-15/16: en-passant-under-fog, most-played-move,
// chess960-starting-positions, lichess-analysis-accuracy, dou-shou-qi-engine
// and jungle-den-term. article-i18n.ts spreads these into its dictionaries
// at the place the first three posts' carry-over blocks used to sit; they
// live here because that file had reached Biome's 2 MiB cap (files.maxSize),
// past which Biome skips a file without failing.
//
// MOVED_POSTS_ZH_HANT holds Traditional overrides only: article-i18n.ts
// spreads it after ...ZH_HANS, so a key it lacks falls back to Simplified
// (strings that are all ASCII, such as move lists).
export const MOVED_POSTS_ZH_HANS: Readonly<Record<string, string>> = {
  // en-passant-under-fog: carried over from the brianhliou.com zh-hans and zh-hant posts (2026-10-15), word for word; links repointed like the English. Strings whose two zh versions were translated separately (ASCII differs) are left out, so the parity check below holds.
  "My fog of war chess engine recorded the en passant square under standard chess legality, in a variant with no such rule. En passant availability decides what a pawn can see, so the true board fell out of the engine's belief and it finished the game against 41 worlds that did not exist.":
    '我的战争迷雾国际象棋引擎按标准象棋的合法性规则记录吃过路兵格，而这个变体根本没有这条规则。吃过路兵的可用性决定了兵能看见什么，于是真实棋盘从引擎的信念集合中掉了出去，它对着41个并不存在的世界下完了整局。',
  'Misty tracks every board consistent with what it has seen, stored as FEN strings. In one game it finished against 41 boards, none of them the real one.':
    'Misty 会跟踪所有与它所观察到的信息相符的棋盘，以 FEN 字符串存储。在一局棋中，它是对着41个棋盘下完的，而其中没有一个是真实棋盘。',
  'python-chess writes the en passant square only when the capture is legal in standard chess. Under fog the capture is legal even in check, and a pawn that can take en passant sees that square, so the true position stopped matching what Misty had seen.':
    'python-chess 只在这步吃子在标准象棋中合法时才写出吃过路兵格。在迷雾规则下，即使被将军这步吃子也合法，而能吃过路兵的兵看得见那个格子，于是真实局面不再与 Misty 观察到的信息相符。',
  'The fix records the square whenever a pawn can take. Replaying all 271 games, lost-truth cases outside the sampled games went from four to none.':
    '修正后，只要有兵能吃就记录该格。重放全部271局，抽样局面之外丢失真相的情形由四例降为零。',
  'Nothing caught it: the Rust port copied python-chess byte for byte, so the test comparing the two passed, and a belief that loses the truth gets more confident, not less.':
    '没有任何机制发现它：Rust 移植版逐字节照搬 python-chess，所以对比两者的测试通过了；而一个丢失真相的信念只会变得更自信，不会变得更不确定。',
  "Game `e751c6c4`, Misty as Black, move 29. White pushes the g-pawn two squares, beside Black's pawn on f4. White's queen on d6 attacks the black king.":
    '对局 `e751c6c4`，Misty 执黑，第29回合。白方把 g 兵推进两格，落在黑方 f4 兵的旁边。白方位于 d6 的后正攻击着黑王。',
  'Record the square when a pawn can take, regardless of whether taking is wise. That is `EnPassantMode.XFEN`, and it is the fog rule. It still omits the square when no enemy pawn is adjacent, so the belief does not split over a square nobody can use.':
    '只要有兵能吃就记录该格，不管吃下去是否明智。这就是 `EnPassantMode.XFEN`，也正是迷雾规则。当旁边没有敌方兵时它仍然会省略该格，这样信念就不会因为一个谁都用不上的格子而分裂。',
  'At the failing ply `P` now goes 625 to 617, truth kept. Replaying all 271 games reports no lost-truth decisions outside the sampled games, against four before.':
    '在出错的那一着，`P` 现在是从625变到617，真相得以保留。重放全部271局，抽样局面之外不再报告任何丢失真相的决策，此前是四例。',
  'Why nothing caught it': '为什么没有任何机制发现它',
  "Fixed in the engine on 2026-09-10 and released in [Misty 0.1.3](https://github.com/brianhliou/misty/releases/tag/v0.1.3). Every board above is drawn by the engine's own visibility code from that position; the script that draws them refuses to run if the two views stop differing by exactly g3 and g4.":
    '已于2026-09-10在引擎中修正，并随 [Misty 0.1.3](https://github.com/brianhliou/misty/releases/tag/v0.1.3) 发布。上面每一张棋盘都是引擎自己的可见性代码从该局面绘制的；绘图脚本一旦发现两个视图的差异不再恰好是 g3 和 g4，就会拒绝运行。',
  // most-played-move: carried over from the brianhliou.com zh-hans and zh-hant posts (2026-10-15), word for word; links repointed like the English. Strings whose two zh versions were translated separately (ASCII differs) are left out, so the parity check below holds.
  'When the Most Played Move Is an Inaccuracy': '当最常走的一手其实是不精确',
  "Half are gambits and sidelines the masters never play. Where masters reach the position, most already play the engine's move; only four share the club's mistake.":
    '其中一半是大师从不下的弃兵和冷门变例。在大师确实到达过的局面里，多数人早已走引擎的那一手；只有四个局面里大师和俱乐部棋手犯了同样的错。',
  'The biggest by games: after 1.e4 e5 2.f4 d6, 85% of club players play 3.Nf3, and 3.d3 is nearly a pawn better.':
    '按对局数算最大的一个：1.e4 e5 2.f4 d6之后，85%的俱乐部棋手走3.Nf3，而3.d3几乎要好上一个兵。',
  "The fix is in the explorer's settings: the masters database, 2018 onward. All 144 are in a study.":
    '解决办法就在局面浏览器的设置里：大师数据库，2018年起。全部144个局面都在一份研究里。',
  'The opening explorer on Lichess shows you, for any position, what people played next and how it went. It can show you three databases (every rated game on Lichess, the masters, or one player), filtered by rating band, speed and year, and the masters filtered by era is the best free opening book there is. But the table a club player sees by default is the Lichess database at their own rating, and its top row is the most played move at their level. That row is the move most of us play, because everyone else did. I asked how often it is an inaccuracy.':
    'Lichess的开局局面浏览器会告诉你，在任意局面下人们接着走了什么、结果如何。它能显示三个数据库（Lichess上所有等级分对局、大师对局，或某一位棋手），可按分段、棋速和年份筛选，而按年代筛选的大师库是现有最好的免费开局库。但俱乐部棋手默认看到的那张表，是自己分段下的Lichess数据库，首行就是这个水平上最常走的一手。那一行是我们大多数人会走的一手，只因为别人都这么走。我想知道，它有多常是一步不精确。',
  'Where "most played" comes from': '「最常走」从何而来',
  "Then every position went through Stockfish 18 at 20,000,000 nodes with three lines. The most played move is judged against the best move from the same search, by lila's own winning-chance formula, the one that decides what gets a `?!` on a Lichess report. A gap of 0.1 or more is an inaccuracy, 0.2 a mistake, 0.3 a blunder. Every flagged position then got a second 20M search with a different thread count, and 24 of 168 did not survive it; 144 did. That is the same noise floor the [last post](/blog/lichess-analysis-accuracy) found, and it is why one search is never the verdict here.":
    '随后每个局面都用Stockfish 18在20,000,000节点下跑了三条变例。最常走的一手，是按同一次搜索给出的最佳着法来评判的，采用lila自己的获胜机会公式，也就是决定Lichess报告里哪一手会被标上`?!`的那个公式。差距达到0.1及以上算不精确，0.2算错着，0.3算漏着。每个被标记的局面又用不同线程数做了第二次20M搜索，168个里有24个没能通过；144个通过了。这和[上一篇](/blog/lichess-analysis-accuracy)发现的噪声底线一致，也正因如此，这里单次搜索从来不是定论。',
  'For each of the 144 I also pulled the masters database by era (before 2010, 2010 to 2017, since 2018), which is where the shapes come from.':
    '对这144个局面，我还按年代（2010年前、2010到2017年、2018年起）调取了大师数据库，下面的几种形态就是由此得来的。',
  'Four shapes': '四种形态',
  shape: '形态',
  positions: '局面数',
  'what it means': '含义',
  'club only': '只有俱乐部棋手',
  "masters have no games there, or fewer than twenty; the line is the club's alone":
    '大师在此没有对局，或不足二十局；这条变例只属于俱乐部棋手',
  'masters always knew': '大师一直就知道',
  "the masters' top move is the engine's move in every era": '每个年代大师的首选都是引擎那一手',
  'masters play a third move': '大师走第三种着法',
  "the masters avoid both the club move and the engine's first choice":
    '大师既避开俱乐部的那一手，也避开引擎的首选',
  'masters switched': '大师改弦更张',
  "the masters' top move became the engine's move in a later era":
    '大师的首选在后来的年代变成了引擎那一手',
  'everyone plays it': '所有人都这么走',
  "the masters' top move is the club move too": '大师的首选也是俱乐部棋手的那一手',
  "The club's book is mostly a book the masters never opened: 69 positions are gambits and sidelines with no masters games worth counting. Where the masters do play the position, they already agree with the engine in 51 cases, and moved toward it in 8 more. In only four of 144 do masters and club share the mistake. Theory is not lagging the engine much; the club is lagging theory.":
    '俱乐部棋手的开局库，大体上是一本大师从未翻开的书：69个局面是弃兵和冷门变例，大师对局数少到不值一提。在大师确实下过的局面里，有51例他们本就与引擎一致，另有8例后来转向了引擎的着法。144个局面中，只有四个是大师和俱乐部棋手同犯一错。理论并没有落后引擎多少；落后理论的是俱乐部棋手。',
  'Ten positions': '十个局面',
  "Each has a board below. The most played move is on the mainline with its mark; the engine's line is the sideline with the numbers; the comment holds the club share and the masters' history. The strips first: how often the club move and the engine move are played, by 1600 to 2200 players and by masters in each era.":
    '每个局面下方都有一张棋盘。最常走的一手在主线上并带标记；引擎的变例是带评估值的副线；注释里写着俱乐部占比和大师的历史选择。先看条形图：俱乐部的那一手和引擎的那一手，分别被1600到2200分棋手以及各年代大师走了多大比例。',
  "Rust is the club's favourite, blue the engine's move. Masters cells with fewer than twenty games are left blank.":
    '铁锈色是俱乐部棋手的最爱，蓝色是引擎的着法。大师栏对局数不足二十的留空。',
  'For ten opening positions, bars showing how often the club move and the engine move are played by 1600 to 2200 players on Lichess, and by masters before 2010, in 2010 to 2017, and since 2018.':
    '十个开局局面中，俱乐部的一手和引擎的一手分别被Lichess上1600到2200分棋手，以及2010年前、2010到2017年、2018年起的大师走出的频率条形图。',
  "**King's Gambit, 2...d6.** After 1.e4 e5 2.f4 d6, 85% of club players play 3.Nf3, and so did half the masters who reached it. At 20M it is −0.67; 3.d3 is +0.25, because after 3.Nf3 exf4 Black takes the pawn and keeps it (the next position in the tree agrees: 44% then play 3...Nc6?! instead of taking). Everyone plays it, and it is the biggest miss on the list by games.":
    '**王翼弃兵，2...d6。**1.e4 e5 2.f4 d6之后，85%的俱乐部棋手走3.Nf3，到过这个局面的大师也有一半这么走。在20M下它是−0.67；3.d3是+0.25，因为3.Nf3 exf4之后黑方吃兵并守住（树里的下一个局面也印证了这点：44%的人接着走3...Nc6?!而不是吃兵）。所有人都这么走，而且按对局数算，这是名单上最大的一次失误。',
  "King's Gambit 2...d6: 3.Nf3 is the club move, 3.d3 the engine's":
    '王翼弃兵2...d6：3.Nf3是俱乐部的一手，3.d3是引擎的一手',
  '**Petrov, 3.Bc4.** 1.e4 e5 2.Nf3 Nf6 3.Bc4 reaches ten million club games, and a third of Black players answer 3...Nc6, turning it into a Two Knights. 3...Nxe4 takes the pawn: −0.54 against +0.15. The masters have taken it in every era, seven times in ten.':
    '**彼得罗夫防御，3.Bc4。**1.e4 e5 2.Nf3 Nf6 3.Bc4的俱乐部对局数达到一千万，三分之一的黑方棋手应以3...Nc6，把它变成两马防御。3...Nxe4吃兵：−0.54对+0.15。大师在每个年代都吃了这个兵，十局里有七局。',
  'Petrov 3.Bc4: the club plays Nc6, the engine takes on e4':
    '彼得罗夫防御3.Bc4：俱乐部棋手走Nc6，引擎吃e4',
  "Four Knights Spanish 4.Nc3: the club plays d6, the engine plays Rubinstein's Nd4":
    '四马西班牙4.Nc3：俱乐部棋手走d6，引擎走Rubinstein的Nd4',
  '**Vienna Gambit, 3...exf4.** 1.e4 e5 2.Nc3 Nf6 3.f4, and 30% take the pawn. It is +0.63 for White; 3...d5, the move 97% of masters have played in every era, is −0.31. Taking is the natural move and the losing one, which is what the gambit is for.':
    '**维也纳弃兵，3...exf4。**1.e4 e5 2.Nc3 Nf6 3.f4，30%的人吃兵。这对白方是+0.63；而3...d5，各个年代97%的大师都走的一手，是−0.31。吃兵是自然的一手，也是输棋的一手，弃兵的用意正在于此。',
  "Vienna Gambit: exf4 is the club move, d5 the engine's and the masters'":
    '维也纳弃兵：exf4是俱乐部的一手，d5是引擎和大师的一手',
  "**London, 2...g6 3.Nc3.** 1.d4 Nf6 2.Bf4 g6 3.Nc3 and 73% of the club plays 3...Bg7, the move you play in every other London. Here it is +0.62 and 3...d5 is 0.00, because 3.Nc3 is there to play 4.e4, and the bishop move lets it happen while 3...d5 stops it. The masters' share of 3...d5 went 48%, 66%, 77% by era.":
    '**伦敦体系，2...g6 3.Nc3。**1.d4 Nf6 2.Bf4 g6 3.Nc3，73%的俱乐部棋手走3...Bg7，也就是在其他所有伦敦体系里都会走的那一手。这里它是+0.62，而3...d5是0.00，因为3.Nc3就是为了走4.e4，象走一步反倒放行，3...d5才拦得住。大师走3...d5的占比按年代依次为48%、66%、77%。',
  "London 2...g6 3.Nc3: Bg7 is the club move, d5 the engine's":
    '伦敦体系2...g6 3.Nc3：Bg7是俱乐部的一手，d5是引擎的一手',
  '**Scandinavian, 3.Ng5 line.** 1.e4 d5 2.Nf3 dxe4 3.Ng5 Nf6 4.d3 exd3 5.Bxd3, a million club games, and 31% of Black players play 5...h6 to ask the knight. The answer is 6.Nxf7 Kxf7 7.Bg6+ and the queen on d8 goes: +2.70 for White against −1.12 for 5...Nc6. No master has ever been in this position.':
    '**中心弃兵防御，3.Ng5变例。**1.e4 d5 2.Nf3 dxe4 3.Ng5 Nf6 4.d3 exd3 5.Bxd3，俱乐部对局一百万局，31%的黑方棋手走5...h6去赶马。回答是6.Nxf7 Kxf7 7.Bg6+，d8的后就没了：白方+2.70，而5...Nc6是−1.12。从没有大师到过这个局面。',
  'Scandinavian 3.Ng5 line: 5...h6 is the club move and loses the queen':
    '中心弃兵防御3.Ng5变例：5...h6是俱乐部的一手，会丢后',
  "QGA 3.e4 e5: 4.d5 is the club move, 4.Nf3 the engine's and the masters'":
    '后翼弃兵接受3.e4 e5：4.d5是俱乐部的一手，4.Nf3是引擎和大师的一手',
  'All 144 are in [the study](/study/ibFQtGAL), these ten first, the rest ranked by how many games they touch times how much the move gives up.':
    '全部144个局面都在[这份研究](/study/ibFQtGAL)里，这十个排在最前，其余按涉及对局数乘以该着法损失的幅度排序。',
  'Reading the explorer': '怎么读局面浏览器',
  "The most played move in your rating band is the move most people at your rating play, which is not a recommendation, and the explorer never said it was. The filters that fix most of this list are already in the gear menu. Switch to the masters database and set the years to 2018 on, not the all-time table: the masters' book moves, and the all-time table is an average of eras. And when the most played move takes a pawn or declines one, check the engine before trusting the crowd; four of the ten above are a capture or a declined capture.":
    '你所在分段最常走的一手，是和你同分段的多数人会走的一手，这并不是推荐，局面浏览器也从没说过它是。能解决这份名单上大部分问题的筛选项，就在齿轮菜单里。切换到大师数据库，把年份设为2018年起，别用全时段的表：大师的开局库是会变的，而全时段表是各年代的平均。还有，当最常走的一手是吃兵或拒收弃兵时，先问问引擎，别轻信大众；上面十个局面里有四个涉及吃子或拒收吃子。',
  'How this was measured': '测量方法',
  'Open the 144 positions':
    '<a class="cta cta-primary" href="{{ site.embed_origin }}/study/{{ page.study }}">打开这144个局面</a>',
  'The deep puzzles':
    '<a class="cta cta-secondary" href="{{ site.embed_origin }}/study/fhC7BCG7">深度谜题</a>',
  'Xiangqi for chess players':
    '<a class="cta cta-secondary" href="{{ site.embed_origin }}/rules/xiangqi">写给国际象棋棋手的中国象棋入门</a>',
  // chess960-starting-positions: carried over from the brianhliou.com zh-hans and zh-hant posts (2026-10-15), word for word; links repointed like the English. Strings whose two zh versions were translated separately (ASCII differs) are left out, so the parity check below holds.
  'Chess960 Starting Positions Ranked By Stockfish': 'Stockfish 对国际象棋960全部开局局面的排名',
  'Stockfish 18 rankings for all 960 Chess960/Fischer Random starting positions. Most balanced: SP-418 and SP-563; standard chess is near median.':
    'Stockfish 18 对全部960个国际象棋960（菲舍尔任意制）开局局面的排名。最均衡的是 SP-418 与 SP-563；标准国际象棋接近中位数。',
  'I evaluated all 960 Chess960 starting positions with Stockfish 18 at depth 36. Every one favors White.':
    '我用 Stockfish 18 在搜索深度 36 下评估了全部 960 个国际象棋960开局局面。每一个都对白方有利。',
  'The most balanced are SP-418 and SP-563, at +0.07. The most lopsided is SP-783 (QRKNRNBB) at +1.08, the only one over a pawn.':
    '最均衡的是 SP-418 与 SP-563，评估值 +0.07。最失衡的是 SP-783（QRKNRNBB），评估值 +1.08，是唯一超过一个兵的局面。',
  'Standard chess, SP-518, is +0.31 and ranks 463 of 960: almost exactly the median.':
    '标准国际象棋即 SP-518，评估值 +0.31，在 960 个局面中排第 463 位：几乎正好是中位数。',
  'None of the 105 starts used in recent elite Freestyle events came from the ten most White-favored. All 960 are in a CSV.':
    '近期顶级 Freestyle 赛事所用的 105 个开局局面，没有一个来自最偏向白方的前十。全部 960 个都在一个 CSV 文件里。',
  'I evaluated all 960 **Chess960 starting positions** with Stockfish 18 at uniform depth 36. Chess960 is also called **Fischer Random chess**; each legal back rank is usually identified by a **Scharnagl ID** from 0 to 959.':
    '我用 Stockfish 18 在统一搜索深度 36 下评估了全部 960 个**国际象棋960开局局面**。国际象棋960也叫**菲舍尔任意制国际象棋**；每一种合法的底排通常用 0 到 959 的 **Scharnagl ID** 来标识。',
  'Chess960 is the modern tournament name for Fischer Random chess, the variant Bobby Fischer proposed in 1996 to reduce opening memorization and force players back into over-the-board problem solving. The pieces are randomized across 960 legal back-rank layouts while preserving bishops on opposite colors and keeping the king between the rooks so castling still works.':
    '国际象棋960是菲舍尔任意制国际象棋在现代比赛中的名称，这一变体由鲍比·菲舍尔于 1996 年提出，目的是减少开局背谱，迫使棋手回到棋盘前真正解决问题。棋子在 960 种合法底排布局中随机排列，同时保持双象异色、王位于两车之间，使王车易位依然可行。',
  'Evaluations are white-POV: positive favors White, and **+1.00 is roughly one pawn**.':
    '评估值均以白方视角给出：正值对白方有利，**+1.00 大致相当于一个兵**。',
  Finding: '结论',
  'Evaluation range': '评估值区间',
  '+0.07 to +1.08': '+0.07 至 +1.08',
  'Black-favored starts': '偏向黑方的开局局面',
  'Standard chess, SP-518': '标准国际象棋，SP-518',
  'Standard chess rank by balance': '标准国际象棋按均衡度的排名',
  'Starts more balanced than standard chess': '比标准国际象棋更均衡的开局局面',
  'Move-1 castling best moves': '第 1 着即王车易位为最佳着法的局面',
  'Recent elite corpus overlap with highlighted starts': '近期顶级赛事棋局与重点开局局面的重合',
  'SP-482, once': 'SP-482，一次',
  "If you want the **most balanced Chess960 starting positions**, the clean candidates are **SP-418, SP-563, SP-269, SP-444, and SP-786**. All evaluate at +0.10 or below, far under standard chess's +0.31.":
    '如果你想要**最均衡的国际象棋960开局局面**，明确的候选是 **SP-418、SP-563、SP-269、SP-444 和 SP-786**。它们的评估值都在 +0.10 及以下，远低于标准国际象棋的 +0.31。',
  'Full dataset: [chess960_starting_position_evals.csv](/article-data/chess960-starting-position-evals.csv) (960 rows).':
    '完整数据集：[chess960_starting_position_evals.csv](/article-data/chess960-starting-position-evals.csv)（960 行）。',
  'How I Evaluated The Chess960 Positions': '我是如何评估这些国际象棋960局面的',
  'The evaluation contract is deliberately narrow:': '评估条件刻意设得很窄：',
  Parameter: '参数',
  Value: '取值',
  Engine: '引擎',
  'Stockfish 18': 'Stockfish 18',
  Depth: '搜索深度',
  MultiPV: 'MultiPV',
  'Chess960 mode': '国际象棋960模式',
  '`UCI_Chess960=true`': '`UCI_Chess960=true`',
  Compute: '算力',
  'Modal, 96 batches × 10 positions': 'Modal，96 批 × 10 个局面',
  Runtime: '运行时间',
  '33 minutes wall, under $3': '实际耗时 33 分钟，不到 3 美元',
  'Every starting position used the same depth target, so the rankings do not mix shallow and deep engine outputs. The pipeline is the same cloud Stockfish setup described in the [previous post on scaling Stockfish compute](https://brianhliou.com/posts/scaling-stockfish-compute-workloads/).':
    '每个开局局面都用同一个深度目标，因此排名不会把浅层和深层的引擎输出混在一起。这套流水线与[上一篇关于扩展 Stockfish 算力的文章](https://brianhliou.com/posts/scaling-stockfish-compute-workloads/)中描述的云端 Stockfish 配置相同。',
  'Quality checks:': '质量检查：',
  '959/960 reached depth 36; 1 position fell back to depth 35 at the time cap.':
    '959/960 达到搜索深度 36；有 1 个局面在时间上限处回落到深度 35。',
  'Median principal-variation length: 36 plies.': '主变着法长度中位数：36 着。',
  'Check against Lichess cache': '与 Lichess 缓存的比对',
  'Best-move agreement': '最佳着法一致率',
  'Evaluation correlation': '评估值相关性',
  'Absolute Δcp <= 0.20': 'Δcp 绝对值 <= 0.20',
  'Mean Δcp': 'Δcp 平均值',
  'The top-10 order moves around between datasets, but the headline does not: standard chess sits near the median, every start favors White at depth 36, and 9 starts have castling as the best first move.':
    '前十名的顺序在两份数据之间会有变动，但主要结论不变：标准国际象棋接近中位数，在深度 36 下每个开局局面都偏向白方，并且有 9 个局面以王车易位为最佳首着。',
  'Chess960 Evaluation Distribution': '国际象棋960评估值分布',
  'Most starts land in a narrow white-edge band. The right tail is short: only one start crosses +1.00.':
    '大多数开局局面落在一条狭窄的白方优势带里。右尾很短：只有一个局面越过 +1.00。',
  evaluation: '评估值',
  '< 0.00 (black-favored)': '< 0.00（偏向黑方）',
  '0.00 to 0.09': '0.00 至 0.09',
  '0.10 to 0.24': '0.10 至 0.24',
  '0.25 to 0.49': '0.25 至 0.49',
  '0.50 to 0.99': '0.50 至 0.99',
  'Evaluation distribution histogram': '评估值分布直方图',
  'At shallower public-cache depth, SP-663 can appear slightly black-favored (-0.10 in the Lichess cache). At depth 36 it evaluates at +0.14. The "black-favored start" result disappears under the uniform deeper search.':
    '在公共缓存较浅的深度下，SP-663 会显得略偏黑方（Lichess 缓存中为 -0.10）。在深度 36 下它的评估值是 +0.14。在统一的更深搜索下，「偏向黑方的开局局面」这一结果就消失了。',
  'Where Standard Chess Ranks': '标准国际象棋排在哪里',
  'The default start, **SP-518 (RNBQKBNR)**, evaluates to **+0.31**. It ranks 463/960 by ascending imbalance: almost exactly the median. 462 Chess960 starts are more balanced; 497 are more imbalanced.':
    '默认的开局局面 **SP-518（RNBQKBNR）**评估值为 **+0.31**。按失衡程度升序排列，它排第 463/960：几乎正好是中位数。462 个国际象棋960开局局面更均衡；497 个更失衡。',
  'SP-518: standard chess. +0.31 at depth 36, best move d4.':
    '<figcaption style="font-size: 0.88rem; line-height: 1.35; margin-top: 0.45rem; text-align: center;"><strong>SP-518：标准国际象棋。</strong> 深度 36 下 +0.31，最佳着法 d4。</figcaption>',
  'SP-518, the standard chess starting position': 'SP-518，标准国际象棋的开局局面',
  'This is a structural result, not a claim about which starting position is better to play. Standard chess is near the middle of the Chess960 balance distribution.':
    '这是一个结构性结果，并不是在说哪个开局局面下起来更好。标准国际象棋处在国际象棋960均衡度分布的中间附近。',
  'Most Imbalanced Chess960 Start: SP-783': '最失衡的国际象棋960开局局面：SP-783',
  'One position crosses +1.00: **SP-783 (QRKNRNBB)**, at **+1.08** with best move `b4`. It is the largest opening edge in the full 960-position set.':
    '有一个局面越过了 +1.00：**SP-783（QRKNRNBB）**，评估值 **+1.08**，最佳着法 `b4`。这是全部 960 个局面中最大的开局优势。',
  'SP-783: QRKNRNBB. The most white-favored start at +1.08, best move b4.':
    '<figcaption style="font-size: 0.88rem; line-height: 1.35; margin-top: 0.45rem; text-align: center;"><strong>SP-783：QRKNRNBB。</strong> 最偏向白方的开局局面，+1.08，最佳着法 b4。</figcaption>',
  'SP-783, the most imbalanced Chess960 starting position': 'SP-783，最失衡的国际象棋960开局局面',
  'Every other starting position lands between +0.07 and +0.92.':
    '其余所有开局局面都落在 +0.07 到 +0.92 之间。',
  'Most White-Favored Chess960 Starting Positions': '最偏向白方的国际象棋960开局局面',
  'Only one position crosses +1.00. The rest of the top 10 sit between +0.68 and +0.92.':
    '只有一个局面越过 +1.00。前十名中的其余局面落在 +0.68 到 +0.92 之间。',
  SP: 'SP',
  'back-rank': '底排',
  depth: '深度',
  QRKNRNBB: 'QRKNRNBB',
  b4: 'b4',
  QRKRNNBB: 'QRKRNNBB',
  RBQNKRBN: 'RBQNKRBN',
  f4: 'f4',
  QNRKBBRN: 'QNRKBBRN',
  c4: 'c4',
  BBNNRKRQ: 'BBNNRKRQ',
  g3: 'g3',
  QBBRKRNN: 'QBBRKRNN',
  Ng3: 'Ng3',
  QRNNKRBB: 'QRNNKRBB',
  RQKNBBRN: 'RQKNBBRN',
  RNKBNQBR: 'RNKBNQBR',
  e4: 'e4',
  BBNRNKRQ: 'BBNRNKRQ',
  g4: 'g4',
  "Board previews are clickable. The green arrow marks the engine's best first move. Full principal variations are in the CSV.":
    '棋盘预览可点击。绿色箭头标出引擎的最佳首着。完整主变着法见 CSV。',
  '**SP-783** `QRKNRNBB` · +1.08 · best b4 · 29 plies':
    '**SP-783** `QRKNRNBB` · +1.08 · 最佳 b4 · 29 着',
  'SP-783 starting position; SP-783 final position after principal variation':
    'SP-783 开局局面；SP-783 主变着法走完后的局面',
  'Principal variation: `1. b4 b5 2. a4 a5 3. axb5 axb4 4. Qxa8 Rxa8 5. Rxb4 g5 6. g4 Ra1+ 7. Rb1 Rxb1+ 8. Kxb1 Nb7 9. d3 h5 10. gxh5 Ne6 11. Ng3 Nd6 12. c4 Bh7 13. Ne3 Nd4 14. Kc1 f5 15. Kd2`':
    '主变着法：`1. b4 b5 2. a4 a5 3. axb5 axb4 4. Qxa8 Rxa8 5. Rxb4 g5 6. g4 Ra1+ 7. Rb1 Rxb1+ 8. Kxb1 Nb7 9. d3 h5 10. gxh5 Ne6 11. Ng3 Nd6 12. c4 Bh7 13. Ne3 Nd4 14. Kc1 f5 15. Kd2`',
  '**SP-879** `QRKRNNBB` · +0.92 · best b4 · 41 plies':
    '**SP-879** `QRKRNNBB` · +0.92 · 最佳 b4 · 41 着',
  'SP-879 starting position; SP-879 final position after principal variation':
    'SP-879 开局局面；SP-879 主变着法走完后的局面',
  'Principal variation: `1. b4 a5 2. a4 f5 3. Nd3 axb4 4. Ne3 d6 5. f4 c5 6. Nxf5 Be6 7. Nxe7+ Kd7 8. Nxc5+ Kxe7 9. Nxe6 Nxe6 10. Bb6 Rdc8 11. Rxb4 Qa6 12. f5 g6 13. Qa2 gxf5 14. g4 f4 15. a5 Nf6 16. Bf3 Bg7 17. c3 Ng5 18. Re1 Nd7 19. h4 Bxc3 20. dxc3 Rxc3+ 21. Kb1`':
    '主变着法：`1. b4 a5 2. a4 f5 3. Nd3 axb4 4. Ne3 d6 5. f4 c5 6. Nxf5 Be6 7. Nxe7+ Kd7 8. Nxc5+ Kxe7 9. Nxe6 Nxe6 10. Bb6 Rdc8 11. Rxb4 Qa6 12. f5 g6 13. Qa2 gxf5 14. g4 f4 15. a5 Nf6 16. Bf3 Bg7 17. c3 Ng5 18. Re1 Nd7 19. h4 Bxc3 20. dxc3 Rxc3+ 21. Kb1`',
  '**SP-604** `RBQNKRBN` · +0.81 · best f4 · 39 plies':
    '**SP-604** `RBQNKRBN` · +0.81 · 最佳 f4 · 39 着',
  'SP-604 starting position; SP-604 final position after principal variation':
    'SP-604 开局局面；SP-604 主变着法走完后的局面',
  'Principal variation: `1. f4 c5 2. Ng3 Ne6 3. e3 f6 4. c4 g5 5. Ne2 gxf4 6. exf4 Nd4 7. Nxd4 cxd4 8. Bxd4 Qxc4 9. Qxc4 Bxc4 10. Rf2 Ng6 11. g3 Bb5 12. Ne3 Bc6 13. Bc3 e5 14. fxe5 fxe5 15. Rxf8+ Nxf8 16. Bf5 Bc7 17. O-O-O O-O-O 18. Rf1 Re8 19. Bc2 Ne6 20. Rf7`':
    '主变着法：`1. f4 c5 2. Ng3 Ne6 3. e3 f6 4. c4 g5 5. Ne2 gxf4 6. exf4 Nd4 7. Nxd4 cxd4 8. Bxd4 Qxc4 9. Qxc4 Bxc4 10. Rf2 Ng6 11. g3 Bb5 12. Ne3 Bc6 13. Bc3 e5 14. fxe5 fxe5 15. Rxf8+ Nxf8 16. Bf5 Bc7 17. O-O-O O-O-O 18. Rf1 Re8 19. Bc2 Ne6 20. Rf7`',
  '**SP-298** `QNRKBBRN` · +0.73 · best c4 · 28 plies':
    '**SP-298** `QNRKBBRN` · +0.73 · 最佳 c4 · 28 着',
  'SP-298 starting position; SP-298 final position after principal variation':
    'SP-298 开局局面；SP-298 主变着法走完后的局面',
  'Principal variation: `1. c4 f5 2. d4 e6 3. e3 Bh5+ 4. f3 Bf7 5. b3 Be7 6. Bc3 Ng6 7. Nd2 a5 8. f4 O-O 9. Bd3 Ba3 10. Bb2 Bxb2 11. Qxb2 d6 12. g4 Rce8 13. O-O-O a4 14. d5 fxg4`':
    '主变着法：`1. c4 f5 2. d4 e6 3. e3 Bh5+ 4. f3 Bf7 5. b3 Be7 6. Bc3 Ng6 7. Nd2 a5 8. f4 O-O 9. Bd3 Ba3 10. Bb2 Bxb2 11. Qxb2 d6 12. g4 Rce8 13. O-O-O a4 14. d5 fxg4`',
  '**SP-80** `BBNNRKRQ` · +0.73 · best g3 · 39 plies':
    '**SP-80** `BBNNRKRQ` · +0.73 · 最佳 g3 · 39 着',
  'SP-80 starting position; SP-80 final position after principal variation':
    'SP-80 开局局面；SP-80 主变着法走完后的局面',
  'Principal variation: `1. g3 c5 2. Nd3 c4 3. Nc5 Nb6 4. b3 d6 5. Ne4 Nc6 6. h4 e6 7. h5 h6 8. Qh4 d5 9. Nec3 a6 10. e4 d4 11. Ne2 g5 12. hxg6 fxg6 13. Bb2 Bd6 14. e5 Bxe5 15. c3 d3 16. Nd4 Qf6 17. Nxc6 bxc6 18. Ba3+ Kf7 19. Nb2 c5 20. Qxf6+`':
    '主变着法：`1. g3 c5 2. Nd3 c4 3. Nc5 Nb6 4. b3 d6 5. Ne4 Nc6 6. h4 e6 7. h5 h6 8. Qh4 d5 9. Nec3 a6 10. e4 d4 11. Ne2 g5 12. hxg6 fxg6 13. Bb2 Bd6 14. e5 Bxe5 15. c3 d3 16. Nd4 Qf6 17. Nxc6 bxc6 18. Ba3+ Kf7 19. Nb2 c5 20. Qxf6+`',
  '**SP-868** `QBBRKRNN` · +0.70 · best Ng3 · 39 plies':
    '**SP-868** `QBBRKRNN` · +0.70 · 最佳 Ng3 · 39 着',
  'SP-868 starting position; SP-868 final position after principal variation':
    'SP-868 开局局面；SP-868 主变着法走完后的局面',
  'Principal variation: `1. Ng3 d5 2. Nh5 f6 3. Nxg7+ Kf7 4. Nh5 Ng6 5. d4 Nh4 6. f3 Nxg2+ 7. Kf2 Nh4 8. c4 dxc4 9. b3 c5 10. Bxh7 cxd4 11. Qb1 d3 12. bxc4 Bd6 13. exd3 Bf5 14. Bxf5 Nxf5 15. Ng3 Nd4 16. N1e2 Bc5 17. Be3 Qc8 18. Bxd4 Bxd4+ 19. Kg2 Nh6 20. Rh1`':
    '主变着法：`1. Ng3 d5 2. Nh5 f6 3. Nxg7+ Kf7 4. Nh5 Ng6 5. d4 Nh4 6. f3 Nxg2+ 7. Kf2 Nh4 8. c4 dxc4 9. b3 c5 10. Bxh7 cxd4 11. Qb1 d3 12. bxc4 Bd6 13. exd3 Bf5 14. Bxf5 Nxf5 15. Ng3 Nd4 16. N1e2 Bc5 17. Be3 Qc8 18. Bxd4 Bxd4+ 19. Kg2 Nh6 20. Rh1`',
  '**SP-399** `QRNNKRBB` · +0.70 · best b4 · 34 plies':
    '**SP-399** `QRNNKRBB` · +0.70 · 最佳 b4 · 34 着',
  'SP-399 starting position; SP-399 final position after principal variation':
    'SP-399 开局局面；SP-399 主变着法走完后的局面',
  'Principal variation: `1. b4 h6 2. f4 Bh7 3. Nc3 g5 4. f5 b6 5. Nb3 Nd6 6. Bd4 Bxd4 7. Nxd4 f6 8. d3 c6 9. a4 Qb7 10. Kd2 O-O 11. g4 Kg7 12. h4 Qc7 13. hxg5 hxg5 14. b5 Bg8 15. bxc6 dxc6 16. Ne4 Nxe4+ 17. Bxe4 Qd6`':
    '主变着法：`1. b4 h6 2. f4 Bh7 3. Nc3 g5 4. f5 b6 5. Nb3 Nd6 6. Bd4 Bxd4 7. Nxd4 f6 8. d3 c6 9. a4 Qb7 10. Kd2 O-O 11. g4 Kg7 12. h4 Qc7 13. hxg5 hxg5 14. b5 Bg8 15. bxc6 dxc6 16. Ne4 Nxe4+ 17. Bxe4 Qd6`',
  '**SP-794** `RQKNBBRN` · +0.68 · best f4 · 35 plies':
    '**SP-794** `RQKNBBRN` · +0.68 · 最佳 f4 · 35 着',
  'SP-794 starting position; SP-794 final position after principal variation':
    'SP-794 开局局面；SP-794 主变着法走完后的局面',
  'Principal variation: `1. f4 c6 2. e3 f5 3. c4 g5 4. Qxf5 gxf4 5. Qxf4 Qxf4 6. exf4 Ne6 7. f5 Nd4 8. Ng3 Nf7 9. Bf2 Bg7 10. Nc3 Nh6 11. Bd3 Rf8 12. O-O Ndxf5 13. Nxf5 Nxf5 14. Rae1 Bg6 15. Bxf5 Rxf5 16. Rxe7 Bxc3 17. dxc3 b6 18. Ree1`':
    '主变着法：`1. f4 c6 2. e3 f5 3. c4 g5 4. Qxf5 gxf4 5. Qxf4 Qxf4 6. exf4 Ne6 7. f5 Nd4 8. Ng3 Nf7 9. Bf2 Bg7 10. Nc3 Nh6 11. Bd3 Rf8 12. O-O Ndxf5 13. Nxf5 Nxf5 14. Rae1 Bg6 15. Bxf5 Rxf5 16. Rxe7 Bxc3 17. dxc3 b6 18. Ree1`',
  '**SP-557** `RNKBNQBR` · +0.68 · best e4 · 32 plies':
    '**SP-557** `RNKBNQBR` · +0.68 · 最佳 e4 · 32 着',
  'SP-557 starting position; SP-557 final position after principal variation':
    'SP-557 开局局面；SP-557 主变着法走完后的局面',
  'Principal variation: `1. e4 e5 2. f4 exf4 3. Nc3 f5 4. Qxf4 Be6 5. e5 g5 6. Qe3 Nc6 7. d4 d5 8. h4 h6 9. Qf3 gxh4 10. Nd3 Ng7 11. Nf4 Bg5 12. Ne2 O-O-O 13. Kb1 Bf7 14. Bf2 Ne6 15. Nxe6 Bxe6 16. Nf4 Bf7`':
    '主变着法：`1. e4 e5 2. f4 exf4 3. Nc3 f5 4. Qxf4 Be6 5. e5 g5 6. Qe3 Nc6 7. d4 d5 8. h4 h6 9. Qf3 gxh4 10. Nd3 Ng7 11. Nf4 Bg5 12. Ne2 O-O-O 13. Kb1 Bf7 14. Bf2 Ne6 15. Nxe6 Bxe6 16. Nf4 Bf7`',
  '**SP-176** `BBNRNKRQ` · +0.68 · best g4 · 36 plies':
    '**SP-176** `BBNRNKRQ` · +0.68 · 最佳 g4 · 36 着',
  'SP-176 starting position; SP-176 final position after principal variation':
    'SP-176 开局局面；SP-176 主变着法走完后的局面',
  'Principal variation: `1. g4 c5 2. b3 Nc7 3. c4 b6 4. Be4 Bxe4 5. Qxe4 Nd6 6. Qf3 h6 7. e3 Qh7 8. Ne2 Ne6 9. Be5 O-O 10. Bxd6 Bxd6 11. h4 f5 12. g5 hxg5 13. hxg5 f4 14. e4 Qg6 15. d3 Bb8 16. d4 cxd4 17. Nxd4 Nxd4 18. Rxd4 Be5`':
    '主变着法：`1. g4 c5 2. b3 Nc7 3. c4 b6 4. Be4 Bxe4 5. Qxe4 Nd6 6. Qf3 h6 7. e3 Qh7 8. Ne2 Ne6 9. Be5 O-O 10. Bxd6 Bxd6 11. h4 f5 12. g5 hxg5 13. hxg5 f4 14. e4 Qg6 15. d3 Bb8 16. d4 cxd4 17. Nxd4 Nxd4 18. Rxd4 Be5`',
  'Most Balanced Chess960 Starting Positions': '最均衡的国际象棋960开局局面',
  "These are the starts where the position itself contributes the least white edge. All are +0.12 or below, far under standard chess's +0.31.":
    '这些是局面本身给白方带来优势最小的开局。全部在 +0.12 及以下，远低于标准国际象棋的 +0.31。',
  BRNQNBKR: 'BRNQNBKR',
  BRNKNRQB: 'BRNKNRQB',
  NRKBNQBR: 'NRKBNQBR',
  Nb3: 'Nb3',
  RBNNQKBR: 'RBNNQKBR',
  d4: 'd4',
  BRQKNBRN: 'BRQKNBRN',
  NQNBRKBR: 'NQNBRKBR',
  BQRNKBNR: 'BQRNKBNR',
  e3: 'e3',
  RKQNNRBB: 'RKQNNRBB',
  NNBBRKRQ: 'NNBBRKRQ',
  d3: 'd3',
  NQBRNKRB: 'NQBRNKRB',
  '**SP-418** `BRNQNBKR` · +0.07 · best b4 · 32 plies':
    '**SP-418** `BRNQNBKR` · +0.07 · 最佳 b4 · 32 着',
  'SP-418 starting position; SP-418 final position after principal variation':
    'SP-418 开局局面；SP-418 主变着法走完后的局面',
  'Principal variation: `1. b4 b5 2. e3 e6 3. Be2 Be7 4. O-O O-O 5. d3 a6 6. Qd2 d6 7. Nb3 c5 8. bxc5 dxc5 9. Nf3 Nb6 10. c4 Nd7 11. Ne5 Nef6 12. Qa5 Bd6 13. Qxd8 Rfxd8 14. Nxd7 Nxd7 15. cxb5 axb5 16. Rfc1 Rdc8`':
    '主变着法：`1. b4 b5 2. e3 e6 3. Be2 Be7 4. O-O O-O 5. d3 a6 6. Qd2 d6 7. Nb3 c5 8. bxc5 dxc5 9. Nf3 Nb6 10. c4 Nd7 11. Ne5 Nef6 12. Qa5 Bd6 13. Qxd8 Rfxd8 14. Nxd7 Nxd7 15. cxb5 axb5 16. Rfc1 Rdc8`',
  '**SP-563** `BRNKNRQB` · +0.07 · best g4 · 40 plies':
    '**SP-563** `BRNKNRQB` · +0.07 · 最佳 g4 · 40 着',
  'SP-563 starting position; SP-563 final position after principal variation':
    'SP-563 开局局面；SP-563 主变着法走完后的局面',
  'Principal variation: `1. g4 g5 2. Ncd3 a5 3. b3 Bxa1 4. Rxa1 b6 5. h4 h6 6. Bxa8 Rxa8 7. a4 f6 8. f4 gxf4 9. Nxf4 e5 10. Nh5 Ne7 11. Qg2 c6 12. Nd3 Qe6 13. Kc1 Kc7 14. e4 Rg8 15. Nf2 d5 16. Kb2 Nd6 17. Qf3 Raf8 18. d3 d4 19. Ng3 b5 20. Nf5 bxa4`':
    '主变着法：`1. g4 g5 2. Ncd3 a5 3. b3 Bxa1 4. Rxa1 b6 5. h4 h6 6. Bxa8 Rxa8 7. a4 f6 8. f4 gxf4 9. Nxf4 e5 10. Nh5 Ne7 11. Qg2 c6 12. Nd3 Qe6 13. Kc1 Kc7 14. e4 Rg8 15. Nf2 d5 16. Kb2 Nd6 17. Qf3 Raf8 18. d3 d4 19. Ng3 b5 20. Nf5 bxa4`',
  '**SP-269** `NRKBNQBR` · +0.09 · best Nb3 · 38 plies':
    '**SP-269** `NRKBNQBR` · +0.09 · 最佳 Nb3 · 38 着',
  'SP-269 starting position; SP-269 final position after principal variation':
    'SP-269 开局局面；SP-269 主变着法走完后的局面',
  'Principal variation: `1. Nb3 f5 2. f4 Nb6 3. d3 c6 4. c3 d6 5. Nd2 Bc7 6. Nef3 Nf6 7. e4 fxe4 8. dxe4 e5 9. fxe5 dxe5 10. b4 Nbd7 11. Bb3 Bb6 12. Qd1 Bxg1 13. Qxg1 a5 14. Bxg8 Qxg8 15. Qa7 Qxa2 16. O-O O-O 17. bxa5 Ra8 18. Qxb7 Qxa5 19. Qb3+ Kh8`':
    '主变着法：`1. Nb3 f5 2. f4 Nb6 3. d3 c6 4. c3 d6 5. Nd2 Bc7 6. Nef3 Nf6 7. e4 fxe4 8. dxe4 e5 9. fxe5 dxe5 10. b4 Nbd7 11. Bb3 Bb6 12. Qd1 Bxg1 13. Qxg1 a5 14. Bxg8 Qxg8 15. Qa7 Qxa2 16. O-O O-O 17. bxa5 Ra8 18. Qxb7 Qxa5 19. Qb3+ Kh8`',
  '**SP-444** `RBNNQKBR` · +0.10 · best d4 · 33 plies':
    '**SP-444** `RBNNQKBR` · +0.10 · 最佳 d4 · 33 着',
  'SP-444 starting position; SP-444 final position after principal variation':
    'SP-444 开局局面；SP-444 主变着法走完后的局面',
  'Principal variation: `1. d4 f6 2. f3 Bf7 3. e4 c6 4. Bf2 O-O 5. a4 a5 6. O-O e5 7. dxe5 fxe5 8. Ne3 Ne7 9. Qd2 Ne6 10. Ne2 d6 11. Kh1 Nc5 12. Ng4 Ng6 13. Ng3 Bc7 14. Nf5 Rd8 15. Bxc5 dxc5 16. Qc3 c4 17. Ba2`':
    '主变着法：`1. d4 f6 2. f3 Bf7 3. e4 c6 4. Bf2 O-O 5. a4 a5 6. O-O e5 7. dxe5 fxe5 8. Ne3 Ne7 9. Qd2 Ne6 10. Ne2 d6 11. Kh1 Nc5 12. Ng4 Ng6 13. Ng3 Bc7 14. Nf5 Rd8 15. Bxc5 dxc5 16. Qc3 c4 17. Ba2`',
  '**SP-786** `BRQKNBRN` · +0.10 · best c4 · 31 plies':
    '**SP-786** `BRQKNBRN` · +0.10 · 最佳 c4 · 31 着',
  'SP-786 starting position; SP-786 final position after principal variation':
    'SP-786 开局局面；SP-786 主变着法走完后的局面',
  'Principal variation: `1. c4 e6 2. f4 b5 3. c5 a5 4. b3 d6 5. Nd3 Ng6 6. e3 Be7 7. Be2 Nf6 8. cxd6 cxd6 9. Qxc8+ Rxc8 10. g3 Nd5 11. Nhf2 Bf6 12. a3 O-O 13. Bxf6 Nxf6 14. Nb2 Bd5 15. Bxb5 Bxb3+ 16. Ke2`':
    '主变着法：`1. c4 e6 2. f4 b5 3. c5 a5 4. b3 d6 5. Nd3 Ng6 6. e3 Be7 7. Be2 Nf6 8. cxd6 cxd6 9. Qxc8+ Rxc8 10. g3 Nd5 11. Nhf2 Bf6 12. a3 O-O 13. Bxf6 Nxf6 14. Nb2 Bd5 15. Bxb5 Bxb3+ 16. Ke2`',
  '**SP-29** `NQNBRKBR` · +0.11 · best c4 · 31 plies':
    '**SP-29** `NQNBRKBR` · +0.11 · 最佳 c4 · 31 着',
  'SP-29 starting position; SP-29 final position after principal variation':
    'SP-29 开局局面；SP-29 主变着法走完后的局面',
  'Principal variation: `1. c4 e5 2. f3 c6 3. b4 f6 4. Bb3 Bf7 5. Bf2 O-O 6. O-O d5 7. cxd5 cxd5 8. a4 Bb6 9. e3 Ne7 10. Nc2 Kh8 11. Qa2 a5 12. d4 Bc7 13. dxe5 Bxe5 14. Kh1 Nb6 15. Ne2 Nc4 16. bxa5`':
    '主变着法：`1. c4 e5 2. f3 c6 3. b4 f6 4. Bb3 Bf7 5. Bf2 O-O 6. O-O d5 7. cxd5 cxd5 8. a4 Bb6 9. e3 Ne7 10. Nc2 Kh8 11. Qa2 a5 12. d4 Bc7 13. dxe5 Bxe5 14. Kh1 Nb6 15. Ne2 Nc4 16. bxa5`',
  '**SP-482** `BQRNKBNR` · +0.11 · best e3 · 32 plies · elite match':
    '**SP-482** `BQRNKBNR` · +0.11 · 最佳 e3 · 32 着 · 顶级对抗赛',
  'SP-482 starting position; SP-482 final position after principal variation':
    'SP-482 开局局面；SP-482 主变着法走完后的局面',
  'Principal variation: `1. e3 e6 2. b4 f5 3. f4 Nf6 4. Nf3 Be7 5. c4 b6 6. Be2 Nf7 7. Nf2 c5 8. bxc5 bxc5 9. Qc2 Rg8 10. h4 Bc6 11. Rb1 Qa8 12. Bc3 Nh5 13. d3 Ng3 14. Rh3 Nxe2 15. Kxe2 Rb8 16. Rxb8+ Qxb8`':
    '主变着法：`1. e3 e6 2. b4 f5 3. f4 Nf6 4. Nf3 Be7 5. c4 b6 6. Be2 Nf7 7. Nf2 c5 8. bxc5 bxc5 9. Qc2 Rg8 10. h4 Bc6 11. Rb1 Qa8 12. Bc3 Nh5 13. d3 Ng3 14. Rh3 Nxe2 15. Kxe2 Rb8 16. Rxb8+ Qxb8`',
  '**SP-719** `RKQNNRBB` · +0.11 · best f4 · 43 plies':
    '**SP-719** `RKQNNRBB` · +0.11 · 最佳 f4 · 43 着',
  'SP-719 starting position; SP-719 final position after principal variation':
    'SP-719 开局局面；SP-719 主变着法走完后的局面',
  'Principal variation: `1. f4 f5 2. g3 g6 3. d3 d6 4. c4 c5 5. Nc3 Nc6 6. Qd2 Qd7 7. Nc2 Nc7 8. b3 Bf7 9. O-O-O Ne6 10. e3 O-O 11. d4 Nb4 12. Nxb4 cxb4 13. Nd5 Nc7 14. Nxc7 Qxc7 15. Qxb4 Rfb8 16. Qc3 a5 17. a4 d5 18. Kd2 dxc4 19. bxc4 Qxc4 20. Qxc4 Bxc4 21. Rfe1 Ra7 22. Rb1`':
    '主变着法：`1. f4 f5 2. g3 g6 3. d3 d6 4. c4 c5 5. Nc3 Nc6 6. Qd2 Qd7 7. Nc2 Nc7 8. b3 Bf7 9. O-O-O Ne6 10. e3 O-O 11. d4 Nb4 12. Nxb4 cxb4 13. Nd5 Nc7 14. Nxc7 Qxc7 15. Qxb4 Rfb8 16. Qc3 a5 17. a4 d5 18. Kd2 dxc4 19. bxc4 Qxc4 20. Qxc4 Bxc4 21. Rfe1 Ra7 22. Rb1`',
  '**SP-85** `NNBBRKRQ` · +0.12 · best d3 · 25 plies':
    '**SP-85** `NNBBRKRQ` · +0.12 · 最佳 d3 · 25 着',
  'SP-85 starting position; SP-85 final position after principal variation':
    'SP-85 开局局面；SP-85 主变着法走完后的局面',
  'Principal variation: `1. d3 e5 2. h4 d6 3. Nb3 h5 4. g3 Nb6 5. e4 Nc6 6. Bd2 g6 7. Bf3 Bf6 8. Nc3 Bd7 9. Bg2 O-O-O 10. a4 Be6 11. Bh3 Nd7 12. Nd5 g5 13. Nxf6`':
    '主变着法：`1. d3 e5 2. h4 d6 3. Nb3 h5 4. g3 Nb6 5. e4 Nc6 6. Bd2 g6 7. Bf3 Bf6 8. Nc3 Bd7 9. Bg2 O-O-O 10. a4 Be6 11. Bh3 Nd7 12. Nd5 g5 13. Nxf6`',
  '**SP-119** `NQBRNKRB` · +0.12 · best c4 · 31 plies':
    '**SP-119** `NQBRNKRB` · +0.12 · 最佳 c4 · 31 着',
  'SP-119 starting position; SP-119 final position after principal variation':
    'SP-119 开局局面；SP-119 主变着法走完后的局面',
  'Principal variation: `1. c4 g6 2. d4 c6 3. O-O d5 4. cxd5 cxd5 5. Nac2 Bf5 6. g3 Nac7 7. Bg2 Bg7 8. a4 Nd6 9. Qa2 O-O 10. Ne3 Be6 11. b3 b5 12. Nd3 Ne4 13. Bb2 b4 14. Qa1 Bh6 15. f4 a5 16. Nc5`':
    '主变着法：`1. c4 g6 2. d4 c6 3. O-O d5 4. cxd5 cxd5 5. Nac2 Bf5 6. g3 Nac7 7. Bg2 Bg7 8. a4 Nd6 9. Qa2 O-O 10. Ne3 Be6 11. b3 b5 12. Nd3 Ne4 13. Bb2 b4 14. Qa1 Bh6 15. f4 a5 16. Nc5`',
  'Best First Moves In Chess960': '国际象棋960中的最佳首着',
  "Across all 960 starts, **94.9%** have a pawn move as Stockfish's best first move. `e4` and `d4` are still the most common, but they cover only 36% of the field. The Chess960-specific signal is flank activity: `f4`, `b4`, and `g4` combine for 27.3%.":
    '在全部 960 个开局局面中，**94.9%** 的 Stockfish 最佳首着是兵着。`e4` 和 `d4` 仍然最常见，但只覆盖 36% 的局面。国际象棋960特有的信号是翼侧活动：`f4`、`b4` 和 `g4` 合计占 27.3%。',
  '%': '%',
  a4: 'a4',
  'Piece-move and move-1 castling details': '<summary>子力着法与第 1 着王车易位的细节</summary>',
  'Piece moves account for 49 positions, or 5.1% of the field. Knights account for 40 of them. The other 9 are legal move-1 castles.':
    '子力着法占 49 个局面，即全部的 5.1%。其中 40 个是马着。另外 9 个是合法的第 1 着王车易位。',
  'Origin to dest': '起点到终点',
  '`Ng3`': 'Ng3',
  'h1 to g3': 'h1 到 g3',
  '`O-O`': '`O-O`',
  'f1 to g1': 'f1 到 g1',
  '`Nc3`': '`Nc3`',
  'b1 to c3': 'b1 到 c3',
  '`Nb3`': 'Nb3',
  'a1 to b3': 'a1 到 b3',
  '`Nf3`': '`Nf3`',
  'g1 to f3': 'g1 到 f3',
  '`Nh3`': '`Nh3`',
  'g1 to h3': 'g1 到 h3',
  '`Nde3`': '`Nde3`',
  'd1 to e3': 'd1 到 e3',
  '`Ncd3`': '`Ncd3`',
  'c1 to d3': 'c1 到 d3',
  'The 9 move-1 castling starts all place the king on `f1` and the kingside rook on `g1`: SP-296 (+0.20), SP-308 (+0.35), SP-312 (+0.37), SP-324 (+0.22), SP-407 (+0.16), SP-580 (+0.26), SP-585 (+0.26), SP-596 (+0.22), and SP-612 (+0.40).':
    '这 9 个第 1 着王车易位的开局局面都把王放在 `f1`、王翼车放在 `g1`：SP-296（+0.20）、SP-308（+0.35）、SP-312（+0.37）、SP-324（+0.22）、SP-407（+0.16）、SP-580（+0.26）、SP-585（+0.26）、SP-596（+0.22）和 SP-612（+0.40）。 </details>',
  'What Recent Elite Chess960 Actually Picked': '近期顶级国际象棋960实际选了什么',
  'I mapped recent elite Freestyle broadcast PGNs back to Scharnagl IDs using the starting FEN. This avoids relying on the PGN `Variant` tag: some 2025 Freestyle broadcasts are labeled `Variant "Standard"` even though the FEN is a Chess960 start.':
    '我用开局 FEN 把近期顶级 Freestyle 直播 PGN 映射回 Scharnagl ID。这样就不用依赖 PGN 的 `Variant` 标签：有些 2025 年的 Freestyle 直播标注为 `Variant "Standard"`，尽管 FEN 是一个国际象棋960开局局面。',
  'The modern elite corpus:': '现代顶级赛事棋局集：',
  Games: '局数',
  'unique SPs': '不重复 SP 数',
  '**Total**': '**总计**',
  'The most repeated starts are mostly tournament-format artifacts: paired games, rematches, and bracket mini-matches reuse the same position.':
    '出现次数最多的开局局面大多是赛制造成的：成对的棋局、复赛和淘汰赛小型对抗赛都会重复使用同一个局面。',
  eval: '评估值',
  'appeared in': '出现于',
  '`RBKNQRBN`': '`RBKNQRBN`',
  '`RNKNRQBB`': '`RNKNRQBB`',
  'Las Vegas': '拉斯维加斯站',
  '`QRKBNNBR`': '`QRKBNNBR`',
  '`BBQNRNKR`': '`BBQNRNKR`',
  '`NRKBQNBR`': '`NRKBQNBR`',
  '`RQBNKNRB`': '`RQBNKNRB`',
  '`RBNQKNBR`': '`RBNQKNBR`',
  '`RNBBKNQR`': '`RNBBKNQR`',
  'All selected Scharnagl IDs by event': '<summary>各赛事所选用的全部 Scharnagl ID</summary>',
  'SPs used': '<th>所用 SP</th>',
  'Overlap with the highlighted sets:': '与重点集合的重合情况：',
  'Highlight set': '重点集合',
  'Matches in the 426-game corpus': '在 426 局棋局集中的匹配数',
  'Top 10 most white-favored': '最偏向白方的前十',
  none: '无',
  'Top 10 most equal': '最均势的前十',
  'The only highlighted start that appeared was neutral, not extreme: **SP-482 (BQRNKBNR) evaluates at +0.11** and appeared once in Las Vegas.':
    '唯一出现过的重点开局局面是中性的，而非极端的：**SP-482（BQRNKBNR）评估值为 +0.11**，在拉斯维加斯站出现过一次。',
  Field: '字段',
  '`BQRNKBNR`': 'BQRNKBNR',
  game: '棋局',
  'Magnus Carlsen vs Levon Aronian': 'Magnus Carlsen 对 Levon Aronian',
  result: '结果',
  round: '轮次',
  broadcast: '直播',
  '[Las Vegas round-robin white tiebreak, game 1](https://lichess.org/broadcast/freestyle-chess-grand-slam-las-vegas--round-robin-white/tiebreak--game-1/nhVdjSZB)':
    '[拉斯维加斯循环赛白方加赛，第 1 局](https://lichess.org/broadcast/freestyle-chess-grand-slam-las-vegas--round-robin-white/tiebreak--game-1/nhVdjSZB)',
  'Critical position after 20...d5. White to move. Lichess marks 21.c5? as the mistake; 21.cxd5 was best. Green arrow: best capture. Gray arrow: game move.':
    '<figcaption><strong>20...d5 之后的关键局面。</strong> 轮到白方走。Lichess 标注 21.c5? 为失误；21.cxd5 才是最佳。绿色箭头：最佳吃子。灰色箭头：实战着法。</figcaption>',
  'Critical midgame position after 20...d5 in Magnus Carlsen vs Levon Aronian, SP-482':
    'Magnus Carlsen 对 Levon Aronian，SP-482，20...d5 之后的关键中局局面',
  'The game result is not meaningful by itself. The selection result is: among 105 unique modern elite starts, none came from the top-10 white-favored list.':
    '这盘棋的结果本身说明不了什么。有意义的是选择结果：在 105 个不重复的现代顶级开局局面中，没有一个来自最偏向白方的前十名单。',
  'Any start in the CSV opens on a Chess960 analysis board: [SP-418](https://lichess.org/analysis/chess960/brnqnbkr/pppppppp/8/8/8/8/PPPPPPPP/BRNQNBKR_w_KQkq_-_0_1) for one of the most balanced starts, [SP-783](https://lichess.org/analysis/chess960/qrknrnbb/pppppppp/8/8/8/8/PPPPPPPP/QRKNRNBB_w_KQkq_-_0_1) for the most white-favored.':
    'CSV 中的任一开局局面都能在国际象棋960分析棋盘上打开：[SP-418](https://lichess.org/analysis/chess960/brnqnbkr/pppppppp/8/8/8/8/PPPPPPPP/BRNQNBKR_w_KQkq_-_0_1) 是最均衡的开局局面之一，[SP-783](https://lichess.org/analysis/chess960/qrknrnbb/pppppppp/8/8/8/8/PPPPPPPP/QRKNRNBB_w_KQkq_-_0_1) 则最偏向白方。',
  Reproducibility: '可复现性',
  'Quick Answers': '快速问答',
  'What is the most balanced Chess960 starting position?':
    '**最均衡的国际象棋960开局局面是哪个？**',
  'SP-418 (BRNQNBKR) and SP-563 (BRNKNRQB) are the most balanced in this run. Both evaluate at +0.07 for White.':
    '在这次运行中，SP-418（BRNQNBKR）和 SP-563（BRNKNRQB）最均衡。两者对白方的评估值都是 +0.07。',
  'What is the most imbalanced Chess960 starting position?':
    '**最失衡的国际象棋960开局局面是哪个？**',
  'SP-783 (QRKNRNBB) is the most white-favored start at +1.08.':
    'SP-783（QRKNRNBB）最偏向白方，评估值 +1.08。',
  'Is standard chess balanced compared to Chess960?': '**与国际象棋960相比，标准国际象棋均衡吗？**',
  'Standard chess, SP-518 (RNBQKBNR), evaluates at +0.31 and ranks 463/960 by balance. It is almost exactly median.':
    '标准国际象棋 SP-518（RNBQKBNR）评估值为 +0.31，按均衡度排第 463/960，几乎正好是中位数。',
  'Are any Chess960 starts better for Black?': '**有对黑方更有利的国际象棋960开局局面吗？**',
  'Not at Stockfish 18 depth 36. All 960 starts evaluate as White-favored.':
    '在 Stockfish 18 深度 36 下没有。全部 960 个开局局面的评估值都偏向白方。',
  'Further Reading': '延伸阅读',
  "[Scaling Parallel Stockfish Analysis](https://brianhliou.com/posts/scaling-stockfish-compute-workloads/): methodology for running Stockfish at scale on cloud CPU workers, written for the case where the cache doesn't have the answer.":
    '[扩展并行 Stockfish 分析](https://brianhliou.com/posts/scaling-stockfish-compute-workloads/)：在云端 CPU 工作节点上大规模运行 Stockfish 的方法，面向缓存*没有*现成答案的情形。',
  '[Mistboard](/): free online Chinese chess in English, which also hosts open-source Fog of War chess. Its Chess960 pregame (Draft960) was retired in September 2026.':
    '[Mistboard](/)：英文界面的免费在线象棋网站，同时提供开源的迷雾国际象棋。其国际象棋960赛前选项（Draft960）已于 2026 年 9 月下线。',
  Dataset: '数据集',
  '[Download the full CSV](/article-data/chess960-starting-position-evals.csv) (960 rows). Columns: `scharnagl_id`, `back_rank`, `fen`, `position_key`, `cp`, `mate`, `best_move`, `pv`, `depth`, `nodes`, `source`, `fetched_at_iso`.':
    '[下载完整 CSV](/article-data/chess960-starting-position-evals.csv)（960 行）。列：`scharnagl_id`、`back_rank`、`fen`、`position_key`、`cp`、`mate`、`best_move`、`pv`、`depth`、`nodes`、`source`、`fetched_at_iso`。',
  // en-passant-under-fog: restored 2026-10-24, not native-reviewed; the rest of the 10-15 carry-over above: 6 strings reused from the brianhliou.com zh-hans and zh-hant posts (where their two versions differed in ASCII, harmonised to the current English), 15 machine-drafted for text the move changed or added.
  'An En Passant Bug Under Fog': '迷雾下的一个吃过路兵缺陷',
  'In [fog of war chess](/rules/fog-chess) you may leave your king attacked, so a pawn can take en passant in positions where standard chess forbids it. And since you see every square your pieces can move to, whether that capture exists changes what you see: a pawn that can take en passant sees the landing square and the pawn it would take.':
    '在[战争迷雾国际象棋](/rules/fog-chess)中，你可以让自己的王处于被攻击状态，所以在标准象棋禁止吃过路兵的局面里，兵也可以吃过路兵。而且你能看见自己棋子能走到的每一个格子，所以这步吃子是否存在会改变你看到的东西：能吃过路兵的兵看得见落点格，也看得见它将要吃掉的那个兵。',
  '[Misty](/blog/misty) plays fog of war chess by holding `P`, the set of every board consistent with what it has observed, stored as FEN strings. It wrote the en passant field of those strings by the standard chess rule, and in one game that dropped the real board out of `P`.':
    '[Misty](/blog/misty) 下战争迷雾国际象棋的方式是维护 `P`，即所有与它观察到的信息相符的棋盘集合，以 FEN 字符串存储。它按标准象棋的规则写出这些字符串中的吃过路兵字段，而在一局棋中，这让真实棋盘从 `P` 中掉了出去。',
  'Misty recorded the en passant square by standard chess rules':
    'Misty 按标准象棋规则记录吃过路兵格',
  "`python-chess` writes the en passant field with `EnPassantMode.LEGAL` by default: it records the square only when the capture is legal in standard chess, and that includes not leaving the capturing side's king in check. Misty's Rust hot path copied the same filter on purpose, so its strings would match python-chess byte for byte.":
    '`python-chess` 默认以 `EnPassantMode.LEGAL` 写出吃过路兵字段：只在这步吃子在标准象棋中合法时才记录该格，其中包括不让吃子一方的王处于被将军状态。Misty 的 Rust 热点路径有意照搬了同样的过滤条件，好让它的字符串与 python-chess 逐字节一致。',
  "So the square went missing in one kind of position: a pawn has just moved two squares to stand beside an enemy pawn, and taking it en passant would leave the capturer's king attacked, as it does when that king is already in check. With the square gone, the rebuilt position no longer sees the landing square or the pawn it could take, so the real board stops matching what Misty observed and drops out of `P`. The trigger came up 1 ply in 12,866, in 1 of 273 finished games.":
    '所以该格会在一种局面中丢失：一个兵刚走了两格，停在敌方兵的旁边，而吃过路兵会让吃子一方的王处于被攻击状态，比如那个王本来就正被将军时。该格一丢，重建出来的局面就看不见落点格，也看不见它可以吃的那个兵，于是真实棋盘不再与 Misty 观察到的信息相符，从 `P` 中掉了出去。这个触发条件在12,866着中出现1着，发生在273局已完成对局中的1局。',
  'One game lost the real board at move 29': '一局棋在第29回合丢失了真实棋盘',
  "After 29.g4, from Black's side. Tinted: White's pawn on g4, Black's pawn on f4, and the empty square g3 between them. The arrow is White's queen attacking the black king.":
    '29.g4 之后，从黑方视角。着色的是：白方 g4 兵、黑方 f4 兵，以及两者之间的空格 g3。箭头表示白方的后正攻击着黑王。',
  "After 29.g4, from Black's side": '29.g4 之后，从黑方视角',
  'Black is in check, so standard chess forbids f4xg3 en passant. Under fog it is an ordinary move, and it decides what Black sees.':
    '黑方正被将军，所以标准象棋禁止 f4xg3 吃过路兵。在迷雾规则下这是一步普通的着法，而且它决定了黑方能看见什么。',
  'With the en passant square. 14 squares. Black sees g3, and sees the pawn on g4.':
    '有吃过路兵格时。14个格子。黑方看得见 g3，也看得见 g4 上的兵。',
  "Black's view with the en passant square": '有吃过路兵格时黑方的视野',
  'Without it. 12 squares. g3 and g4 go dark. Same pieces, same board.':
    '没有该格时。12个格子。g3 和 g4 变暗。同样的棋子，同样的棋盘。',
  "Black's view without the en passant square": '没有吃过路兵格时黑方的视野',
  'Under the standard rule the square was dropped:': '按标准规则，该格被丢掉了：',
  'Misty built the position after 29.g4 without the square, counted 12 visible squares for Black, compared them with the 14 in the real observation, and threw out the true move. `P` fell from 625 boards to 41 in that ply, and the real board was not among the 41. Misty played its last four decisions of the game drawing search roots from those 41.':
    'Misty 在没有该格的情况下构建了 29.g4 之后的局面，数出黑方可见12个格子，与真实观察中的14个比较，于是排除了真实的着法。`P` 在那一着之内从625个棋盘降到41个，而真实棋盘不在这41个之中。Misty 这局最后四次决策的搜索根节点都是从这41个中抽取的。',
  'Move the black king one square over, where nothing attacks it, and change nothing else: the square is recorded as g3 and the real board stays in `P`.':
    '把黑王挪到旁边一格，那里没有任何棋子攻击它，其余一概不变：该格就会被记录为 g3，真实棋盘也会留在 `P` 中。',
  'The fix records the square whenever a pawn can take': '修正后，只要有兵能吃就记录该格',
  'The Rust path now checks only that an enemy pawn stands beside the pushed one. On the Python side every board written into `P` goes through one function, `belief_fen`, and the membership check takes a board and spells it the same way, since passing a raw `board.fen()` was how the mistake got in.':
    'Rust 路径现在只检查被推进的兵旁边是否站着敌方兵。在 Python 一侧，每个写入 `P` 的棋盘都经过同一个函数 `belief_fen`，而成员检查接收一个棋盘，并以同样的方式写出它，因为直接传入原始的 `board.fen()` 正是这个错误混进来的方式。',
  'The enumerator raises only when `P` goes empty, and losing the truth from a set of 41 is silent, as it has to be: in play the engine never knows the truth. The test comparing the Rust port with python-chess stayed green across 178,145 move applications, because both made the same mistake. Replay records whether the truth is in `P`, but that column was only read on games past the sampling cap, where losing the truth is expected.':
    '枚举器只在 `P` 变空时抛出异常，而从41个的集合里丢掉真相是无声的，而且必然如此：对局中引擎从不知道真相。比较 Rust 移植版与 python-chess 的测试在178,145次着法应用中一直是绿色的，因为两者犯了同一个错误。重放会记录真相是否在 `P` 中，但那一列只在超过抽样上限的对局上被读取过，而在那种情况下丢失真相是预期行为。',
  'Retold as a bug story, with the code path production actually ran corrected.':
    '改写为一个缺陷故事，并更正了生产环境实际运行的代码路径。',
  // most-played-move: restored 2026-10-24, not native-reviewed; the rest of the 10-15 carry-over above: 19 strings reused from the brianhliou.com zh-hans and zh-hant posts (where their two versions differed in ASCII, harmonised to the current English), 13 machine-drafted for text the move changed or added.
  'In 144 of 4,121 common opening positions, the move club players choose most often loses winning chances against the engine at twenty million nodes. Ten of them, with what the masters played in each era, and a study holding all 144.':
    '在4,121个常见开局局面中，有144个局面里俱乐部棋手最常选择的一手，在两千万节点的引擎面前会丢掉获胜机会。本文挑出十个，附上各个年代大师的下法，并把全部144个局面收进一份研究。',
  'In 144 of 4,121 common opening positions, the move 1600 to 2200 Lichess players choose most often loses winning chances against Stockfish at twenty million nodes. One in 29.':
    '在4,121个常见开局局面中，有144个局面里1600到2200分Lichess棋手最常选择的一手，在两千万节点的Stockfish面前会丢掉获胜机会。29个里有1个。',
  'Positions from the Lichess opening explorer at 1600 to 2200, blitz, rapid and classical: every position to 14 plies with at least 500,000 games.':
    '局面取自Lichess开局局面浏览器，1600到2200分，超快棋、快棋和慢棋：14着以内、对局数至少500,000局的每一个局面。',
  'Stockfish 18 at 20,000,000 nodes, MultiPV 3, one search per position.':
    'Stockfish 18，20,000,000节点，MultiPV 3，每个局面搜索一次。',
  "A miss is a gap of 0.1 or more in winning chances between the most played move and the engine's best, by lila's formula.":
    '最常走的一手与引擎最佳着法之间的获胜机会差距达到0.1及以上，即算一次失误，按lila的公式计算。',
  'Every flagged position searched again on a different machine under the same rule; 144 of 168 held.':
    '每个被标记的局面都在另一台机器上按相同规则再搜索一次；168个中有144个站得住。',
  "The answer, over 4,121 positions that 1600 to 2200 players reach 500,000 times or more: **144 of them, one in 29.** In those positions the most played move loses at least a tenth of a winning chance against the engine's move at twenty million nodes, and a second, independent search agrees. Some are gambit lines only the club plays. Some are main lines where the masters have played the engine's move for a century. Four are positions where the masters make the same mistake the club does.":
    '答案是，在1600到2200分棋手到达过500,000次以上的4,121个局面中：**有144个，29个里有1个。**在这些局面里，最常走的一手相对引擎在两千万节点下给出的着法，至少损失十分之一的获胜机会，并且第二次独立搜索也给出同样结论。有些是只有俱乐部棋手才下的弃兵变例。有些是大师一个世纪以来都走引擎那一手的主流变例。还有四个局面，大师犯的错和俱乐部棋手一模一样。',
  'The Lichess database is every rated game on the site, filtered by rating band and speed. I took blitz, rapid and classical between 1600 and 2200, walked the tree from the start position as far as it stays above 500,000 games (14 plies at most), and kept every position on the way: 4,121 of them. For each one the explorer gives the move table, so "most played" is a fact about that band, not about chess.':
    'Lichess数据库收录站上所有等级分对局，可按分段和棋速筛选。我取了1600到2200分的超快棋、快棋和慢棋，从起始局面沿着树往下走，只要对局数仍在500,000以上就继续（最多14着），并保留沿途每一个局面：共4,121个。每个局面局面浏览器都会给出着法表，所以「最常走」是关于那个分段的事实，而不是关于国际象棋的事实。',
  "**Four Knights, Spanish, 4...d6.** 1.e4 e5 2.Nf3 Nc6 3.Bb5 Nf6 4.Nc3, and 31% of the club plays 4...d6, +0.69. Rubinstein's 4...Nd4 is 0.00, and it is the one line on this list where you can watch theory move: the masters' top choice was 4...Bb4 before 2018 and is 4...Nd4 now (39% of 2,666 games). The club never played either.":
    '**四马西班牙，4...d6。**1.e4 e5 2.Nf3 Nc6 3.Bb5 Nf6 4.Nc3，31%的俱乐部棋手走4...d6，+0.69。Rubinstein的4...Nd4是0.00，而这是名单上唯一一条能看到理论变迁的变例：2018年前大师的首选是4...Bb4，如今是4...Nd4（2,666局中占39%）。俱乐部棋手两手都没走过。',
  "**Stafford Gambit, move 6.** 1.e4 e5 2.Nf3 Nf6 3.Nxe5 Nc6 4.Nxc6 dxc6 5.Nc3 Bc5, the internet's favourite trap, 1.2 million club games. A quarter of White players play 6.Bc4, which walks into 6...Ng4 and the whole point of the gambit: −0.79. 6.h3 first is +1.74, a full piece's worth of difference, and the largest gap among the ten. Masters have played this position three times.":
    '**Stafford弃兵，第6回合。**1.e4 e5 2.Nf3 Nf6 3.Nxe5 Nc6 4.Nxc6 dxc6 5.Nc3 Bc5，网上最受欢迎的陷阱，俱乐部对局120万局。四分之一的白方棋手走6.Bc4，正好撞上6...Ng4，落入这个弃兵的全部用意：−0.79。先走6.h3是+1.74，相差整整一个子，是这十个局面中差距最大的。大师只下过这个局面三次。',
  "Stafford Gambit: 6.Bc4 is the club move, 6.h3 the engine's":
    'Stafford弃兵：6.Bc4是俱乐部的一手，6.h3是引擎的一手',
  '**Busch-Gass, 2...Bc5.** 1.e4 e5 2.Nf3 Bc5 offers the e-pawn, and 48% of White players decline it with 3.Bc4. Just take it: 3.Nxe5 is +1.60 against +0.24, and after 3...d6 4.Nf3 the pawn stays. Seven million club games, five masters games in total.':
    '**Busch-Gass弃兵，2...Bc5。**1.e4 e5 2.Nf3 Bc5送上e兵，48%的白方棋手以3.Bc4拒收。直接吃就是了：3.Nxe5是+1.60，对+0.24，而且3...d6 4.Nf3之后这个兵还留得住。俱乐部对局七百万局，大师对局总共五局。',
  "Busch-Gass Gambit: 3.Bc4 is the club move, 3.Nxe5 the engine's":
    'Busch-Gass弃兵：3.Bc4是俱乐部的一手，3.Nxe5是引擎的一手',
  "**Falkbeer, 3.exd5.** 1.e4 e5 2.f4 d5 3.exd5, and 43% of the club plays the textbook 3...e4, the move the Falkbeer was named for. It is +0.52. 3...exf4 is −0.19, and the masters found that out in public: their share of 3...exf4 went from 36% before 2010 to 73% to 82%. The club's book is the old one.":
    '**Falkbeer反弃兵，3.exd5。**1.e4 e5 2.f4 d5 3.exd5，43%的俱乐部棋手走教科书式的3...e4，也就是Falkbeer得名的那一手。它是+0.52。3...exf4是−0.19，而大师是在公开场合摸清这一点的：3...exf4的占比从2010年前的36%升到73%，再到82%。俱乐部棋手用的还是那本旧书。',
  "Falkbeer: 3...e4 is the club move, 3...exf4 the engine's and now the masters'":
    'Falkbeer反弃兵：3...e4是俱乐部的一手，3...exf4是引擎的一手，如今也是大师的一手',
  "**Queen's Gambit Accepted, 3.e4 e5.** 1.d4 d5 2.c4 dxc4 3.e4 e5, and 63% of White players push 4.d5. It is −1.02; 4.Nf3 is +0.43, and the masters have played 4.Nf3 in 97 to 100% of their games in every era. The push looks like it wins space and hands Black the centre.":
    '**后翼弃兵接受，3.e4 e5。**1.d4 d5 2.c4 dxc4 3.e4 e5，63%的白方棋手挺4.d5。它是−1.02；4.Nf3是+0.43，而大师在每个年代都有97%到100%的对局走4.Nf3。这一挺看似夺取空间，实则把中心让给了黑方。',
  '**Positions**': '**局面**',
  'The [Lichess opening explorer](https://lichess.org/analysis#explorer), database "Lichess", ratings 1600, 1800, 2000 and 2200, blitz, rapid and classical':
    '[Lichess开局局面浏览器](https://lichess.org/analysis#explorer)，数据库选「Lichess」，分段1600、1800、2000和2200，超快棋、快棋和慢棋',
  '**Walk**': '**遍历**',
  'From the start position to 14 plies, keeping every position with at least 500,000 games; stopped at 4,000 expanded nodes, with 55 left in the queue':
    '从起始局面走到14着深度，保留每个至少有500,000局的局面；在展开4,000个节点时停止，队列中还剩55个',
  '**Engine**': '**引擎**',
  'Stockfish 18 at 20,000,000 nodes, MultiPV 3, one search per position, on Modal':
    'Stockfish 18，20,000,000节点，MultiPV 3，每个局面搜索一次，在Modal上运行',
  '**Judged against**': '**评判基准**',
  'The best move from that search. The most played move is scored by its own line when the search ranked it among the three, else by a 20M search of the position after it':
    '该次搜索给出的最佳着法。若搜索把最常走的一手排进前三，就按它自己的那条变例计分，否则对走完该着后的局面再做一次20M搜索',
  '**Miss**': '**失误**',
  "A gap of 0.1 or more by lila's winning-chance formula, `2 / (1 + e^(−0.00368·cp)) − 1`":
    '按lila的获胜机会公式，差距达到0.1及以上：`2 / (1 + e^(−0.00368·cp)) − 1`',
  '**Second search**': '**第二次搜索**',
  'Every flagged position again at 20M, MultiPV 3, on a different machine and thread count, same rule; 144 of 168 survive':
    '每个被标记的局面在另一台机器、另一线程数下再做一次20M MultiPV 3搜索，规则相同；168个中有144个通过',
  '**Masters eras**': '**大师年代**',
  'The masters database with `until=2009`, `since=2010&until=2017` and `since=2018`; a cell under twenty games counts as no data':
    '大师数据库分别用`until=2009`、`since=2010&until=2017`和`since=2018`；不足二十局的单元格视为无数据',
  'The harness is the one from [Lichess Analysis: What a Million Nodes a Move Buys](/blog/lichess-analysis-accuracy), the previous post, on how the labels are made.':
    '测试框架沿用上一篇文章[Lichess 分析：每着一百万节点换来了什么](/blog/lichess-analysis-accuracy)里的那一套，那篇讲的是这些标签是怎么来的。',
  'Corrected the number of positions where the club or engine move is a capture: four, not six.':
    '更正了俱乐部着法或引擎着法为吃子的局面数：是四个，不是六个。',
  // chess960-starting-positions: restored 2026-10-24, not native-reviewed; the rest of the 10-15 carry-over above: 12 strings reused from the brianhliou.com zh-hans and zh-hant posts (where their two versions differed in ASCII, harmonised to the current English), 5 machine-drafted for text the move changed or added.
  'All 960 starting positions searched by Stockfish 18 with `UCI_Chess960=true`, to the same target of depth 36.':
    '全部 960 个开局局面都由 Stockfish 18 以 `UCI_Chess960=true` 搜索，目标深度统一为 36。',
  '959 reached depth 36; one stopped at depth 35 at the time cap.':
    '959 个达到搜索深度 36；有一个在时间上限处停在深度 35。',
  'Compared with the Lichess cloud-eval cache, which had all 960 positions at depths 28 to 75.':
    '与 Lichess 云评估缓存对比，该缓存收录了全部 960 个局面，深度从 28 到 75。',
  'Every evaluation is in the [CSV](/article-data/chess960-starting-position-evals.csv).':
    '每一个评估值都在 [CSV](/article-data/chess960-starting-position-evals.csv) 里。',
  'Castling appears in 1,290 PV moves, all replayed legally under Chess960 rules.':
    '王车易位在主变着法中出现 1,290 次，全部按国际象棋960规则合法重演。',
  'I also probed the [Lichess cloud-eval API](https://lichess.org/api#tag/Analysis/operation/apiCloudEval) at `variant=chess960` for all 960 starts. Lichess had cache hits for all 960 positions, at depths 28 to 75, with median depth 33.':
    '我还对全部 960 个开局局面查询了 [Lichess 云评估 API](https://lichess.org/api#tag/Analysis/operation/apiCloudEval)，参数为 `variant=chess960`。Lichess 对全部 960 个局面都有缓存命中，深度从 28 到 75，中位深度 33。',
  '2026 FIDE Freestyle World Championship': '2026 年 FIDE Freestyle 世界锦标赛',
  '2025 Freestyle Grand Slam Weissenhaus': '2025 年 Freestyle 大满贯 Weissenhaus 站',
  '2025 Freestyle Grand Slam Paris': '2025 年 Freestyle 大满贯巴黎站',
  '2025 Freestyle Grand Slam Las Vegas': '2025 年 Freestyle 大满贯拉斯维加斯站',
  '2025 Freestyle Grand Slam Finals': '2025 年 Freestyle 大满贯总决赛',
  'Las Vegas, Paris, 2026 FIDE': '拉斯维加斯、巴黎、2026 年 FIDE',
  '2022 FIDE outlier from this post, SP-317': '本文中 2022 年 FIDE 的异常值，SP-317',
  'For comparison, the 2022 FIDE World Fischer Random Championship used 11 distinct starts across 60 games. They ranged from +0.19 to +0.54, with mean +0.32. It also avoided the extreme tail.':
    '作为对比，2022 年 FIDE 世界菲舍尔任意制锦标赛在 60 局棋中使用了 11 个不同的开局局面。它们的评估值从 +0.19 到 +0.54，平均 +0.32。它同样避开了极端尾部。',
  'The 960 evaluations were computed in one Modal run, on Chess960 plumbing built for it: `UCI_Chess960` engine mode, X-FEN castling round-trips, shredder-UCI castling in PV replay, and regression coverage for Chess960 correctness.':
    '这 960 个评估值是在一次 Modal 运行中算出的，底层是为此搭建的国际象棋960管线：`UCI_Chess960` 引擎模式、X-FEN 王车易位往返转换、主变重演中的 shredder-UCI 王车易位，以及国际象棋960正确性的回归测试覆盖。',
  "The successful production run took 33.1 minutes wall time: 96 ten-position batches, run in parallel under Modal's 100-container Starter cap. At Modal's base CPU/memory rates, that run lands under $3 of cloud spend.":
    '成功的正式运行实际耗时 33.1 分钟：96 个十局面批次，在 Modal 的 100 容器 Starter 上限下并行运行。按 Modal 的基础 CPU/内存费率，这次运行的云端花费不到 3 美元。',
  "Corrected two histogram counts, SP-663's depth-36 score and the run cost against the published CSV.":
    '对照已发布的 CSV，更正了两个直方图计数、SP-663 在深度 36 下的评估值，以及运行成本。',
  // lichess-analysis-accuracy: restored 2026-10-24, not native-reviewed; 50 strings reused from the brianhliou.com zh-hans and zh-hant posts where they still say what the moved English says, 15 machine-drafted for text the move changed or added.
  'Lichess Analysis: What a Million Nodes a Move Buys': 'Lichess 分析：每着一百万节点换来了什么',
  'Lichess analyses each move at a million nodes, about a second of one core. I re-ran 300 games at twenty times that to see what the budget trades away: the blunders hold, the inaccuracies move.':
    'Lichess 对每着分析一百万节点，大约是单核一秒。我把 300 局按二十倍的预算重跑了一遍，看看这个预算放弃了什么：严重失误站得住，不精确会变。',
  'Lichess analyses each position at a million nodes, about a second of one Stockfish core. I re-ran 300 random games at twenty times that budget and compared every label.':
    'Lichess 对每个局面分析一百万节点，大约是一个 Stockfish 核心一秒。我把 300 局随机对局按二十倍的预算重跑了一遍，并逐个比对了标记。',
  'The budget holds where it matters most: blunders keep their label 84% of the time, and the totals in the game summary barely move.':
    '在最要紧的地方，这个预算站得住：严重失误有 84% 保住了标记，对局总结里的总数几乎不动。',
  'One move in ten gets a different label, mostly inaccuracies: 57% hold, 28% are nothing at depth, 15% are worse. The changes concentrate between half a pawn and three pawns.':
    '十个着法里有一个标记会变，大多是不精确：57% 站得住，28% 在深搜下根本不算问题，15% 其实更糟。变化集中在半个兵到三个兵之间。',
  "Thirteen of the 300 games have a mistake with no mark. Thirty-two unmarked mistakes from titled players' games are a puzzle study.":
    '300 局中有十三局存在没被标出的失误。取自有头衔棋手对局的三十二个未被标出的失误，整理成了一套谜题研究。',
  'A random sample: every tenth analysed game in the August 2026 Lichess database with both players between 1600 and 2400, 300 games and 20,227 moves.':
    '随机样本：2026 年 8 月 Lichess 数据库中每第十局已分析、且双方等级分都在 1600 到 2400 之间的对局，共 300 局、20,227 个着法。',
  'Every position searched again by Stockfish 18 at 20,000,000 nodes on one thread, twenty times the budget Lichess uses.':
    '每个局面都由 Stockfish 18 在单线程、20,000,000 节点下重新搜索，是 Lichess 所用预算的二十倍。',
  "Both sets of evaluations labelled by lila's own formula, which reproduces Lichess's stored labels 99.08% of the time on 222,183 moves from titled players' games.":
    '两套评估都用 lila 自己的公式来标记；在有头衔棋手对局的 222,183 个着法上，这套公式能以 99.08% 的比例复现 Lichess 存储的标记。',
  'Moves with a forced mate at either end left out, because lila judges those by separate rules.':
    '两端任一存在强制将死的着法被排除，因为 lila 对它们用另外的规则判断。',
  'Lichess analyses each position in a requested game at **1,000,000 nodes**, about a second of one Stockfish core. The analysis runs on [fishnet](https://github.com/lichess-org/fishnet), CPUs that volunteers donate, so every extra node is donated time, and a longer wait for the person who pressed the button. A deeper search would be more accurate. The useful questions are how much more, and what it would cost.':
    'Lichess 对一局被请求分析的对局，每个局面分析 **1,000,000 节点**，大约是一个 Stockfish 核心一秒。分析跑在 [fishnet](https://github.com/lichess-org/fishnet) 上，用的是志愿者捐赠的 CPU，所以每多一个节点都是捐来的时间，也意味着按下按钮的人要多等一会儿。更深的搜索会更准确。有用的问题是准确多少，以及要付出什么代价。',
  'I re-analysed 300 rated games at twenty times the budget to put a size on it. The budget holds where it matters most. Blunders keep their label 84% of the time, and the totals in the game summary barely move. What changes is concentrated in one label, the inaccuracy, and in one range of positions, between half a pawn and three pawns.':
    '为了量出它的大小，我按二十倍的预算重新分析了 300 局等级分对局。在最要紧的地方，这个预算站得住。严重失误有 84% 保住了标记，对局总结里的总数几乎不动。变化集中在一个标记上，即不精确，也集中在一个局面区间里，即半个兵到三个兵之间。',
  'The budget and what it costs to raise': '预算，以及提高它的代价',
  "The budgets are in lila's source ([`Work.Origin`](https://github.com/lichess-org/lila/blob/master/modules/fishnet/src/main/Work.scala)): a million nodes for a requested analysis, five million for official broadcasts, 300,000 and 100,000 for the automatic passes. It is a deliberate scale, with the most compute where the most people are watching.":
    '预算写在 lila 的源代码里（[`Work.Origin`](https://github.com/lichess-org/lila/blob/master/modules/fishnet/src/main/Work.scala)）：请求分析为一百万节点，官方转播为五百万，自动分析为 300,000 和 100,000。这是有意设计的梯度，算力最多的地方，正是观看的人最多的地方。',
  'Search time grows with the node count. The average game in my sample had 67 positions to evaluate (20,227 moves over 300 games), and twenty times the nodes is twenty times the search on every one of them. For every game anyone asks about, the difference is a longer wait or twenty times the volunteers.':
    '搜索时间随节点数增长。我的样本中平均每局有 67 个局面要评估（20,227 个着法分布在 300 局中），二十倍的节点就是每个局面都要二十倍的搜索。对任何人请求分析的每一局来说，差别就是更久的等待，或者二十倍的志愿者。',
  'Each label compares two evaluations, the position before your move and the position after, converted to winning chances so that a half-pawn slip at 0.00 counts for more than one at +5. A drop of 0.1 in winning chances is an inaccuracy, 0.2 a mistake, 0.3 a blunder ([`Advice.scala`](https://github.com/lichess-org/lila/blob/master/modules/tree/src/main/Advice.scala)). So a label is as good as the search on both ends. If a million nodes do not find what a position holds, a move that gives it up loses nothing against the number.':
    '每个标记比较两个评估值，即你走子前的局面和走子后的局面，换算成胜率，这样在 0.00 处失掉半个兵就比在 +5 处更严重。胜率下降 0.1 为不精确，0.2 为失误，0.3 为严重失误（[`Advice.scala`](https://github.com/lichess-org/lila/blob/master/modules/tree/src/main/Advice.scala)）。所以标记的好坏取决于两端的搜索。如果一百万节点找不到一个局面里藏着的东西，那么放弃它的着法相对于这个数字就没有任何损失。',
  'One of my blitz games from September, evaluated at both budgets. The blue line is the Lichess graph and the dots are the moves it marked. The rings are three moves the deeper search calls mistakes, at 20, 24 and 26. Before 20.Qd1 the server had +1.2, and +0.9 after, too small a drop to mark; at 20M it is +2.0 and +0.7.':
    '我九月的一局快棋，用两种预算各评估一次。蓝线是 Lichess 的曲线，圆点是它标记的着法。圆圈是深搜判为失误的三个着法，分别在第 20、24 和 26 着。20.Qd1 之前服务器给出 +1.2，之后 +0.9，落差太小，不足以标记；在 20M 下则是 +2.0 和 +0.7。',
  'Two evaluation lines over 71 half-moves of one blitz game, Lichess at one million nodes and Stockfish at twenty million. They track each other for nineteen moves and split at move 20.':
    '一局快棋 71 个半着上的两条评估曲线，Lichess 为一百万节点，Stockfish 为两千万节点。两条线在前十九着彼此贴合，到第 20 着分开。',
  'My 20.Qd1 was that case: the better square was one file over, and the punishment starts three moves later than a one-second search looks.':
    '我的 20.Qd1 就是这种情况：更好的格子只差一路，而惩罚要在三着之后才开始，超出了一秒搜索的视野。',
  'What twenty times the budget changes': '二十倍预算改变了什么',
  'On 300 random rated games (1600 to 2400, from the August 2026 database), re-evaluated at 20,000,000 nodes with the same formula, and setting aside the 842 moves with a forced mate at either end, 19,385 moves compared:':
    '在 300 局随机等级分对局（1600 到 2400，取自 2026 年 8 月数据库）上，用同一套公式按 20,000,000 节点重新评估，并排除两端任一存在强制将死的 842 个着法，共比较了 19,385 个着法：',
  "**What holds.** Blunders keep their label 84% of the time. Labels change in both directions in nearly equal numbers (930 harsher, 885 kinder), so a game's totals barely move. At equality, and once the game is decided (six pawns or more), the two passes agree.":
    '**站得住的。** 严重失误有 84% 保住了标记。标记在两个方向上的变化数量相当（930 个变重，885 个变轻），所以一局棋的总数几乎不动。在均势时，以及胜负已定之后（六个兵或以上），两次分析是一致的。',
  '**What moves.** One move in ten gets a different label, mostly inaccuracies. Of 1,805 Lichess inaccuracies, 57% are still inaccuracies at 20M, 28% are nothing, and 15% are mistakes or blunders.':
    '**会变的。** 十个着法里有一个标记会变，大多是不精确。在 1,805 个 Lichess 判定的不精确中，57% 在 20M 下仍是不精确，28% 根本不算问题，15% 其实是失误或严重失误。',
  '**Where it moves.** Thirteen of the 300 games have a mistake with no mark, and 29 have a marked mistake or blunder that is nothing at depth. Most sit where the evaluation is between half a pawn and three pawns, where the two passes agree least (82–87% against 94% near equality).':
    '**在哪里变。** 300 局中有十三局存在没被标出的失误，29 局有被标为失误或严重失误、在深搜下却根本不算问题的着法。它们大多落在评估值介于半个兵到三个兵之间的地方，两次分析在这里最不一致（82–87%，而均势附近是 94%）。',
  "A cheaper 4M-node pass over nine titled players' recent games (804 in all: about a hundred each for seven, 61 for Gürel, 20 for Giri), on their own moves: a quarter of the mistakes Lichess pins on Magnus Carlsen are not mistakes at depth, and for everyone else it runs the other way, with one real mistake in five carrying a softer label than it deserves.":
    '用更省的 4M 节点分析九位有头衔棋手最近的对局（共 804 局：七位各约一百局，Gürel 61 局，Giri 20 局），只看他们自己的着法：Lichess 扣在 Magnus Carlsen 头上的失误中，有四分之一在深搜下并不是失误，而对其他人则相反，每五个真正的失误里就有一个被贴了比它应得的更轻的标记。',
  player: '棋手',
  'Lichess mistakes+blunders': 'Lichess 判的失误+严重失误',
  'under-labelled': '标记偏轻',
  'over-labelled': '标记偏重',
  'Magnus Carlsen': 'Magnus Carlsen',
  'Alireza Firouzja': 'Alireza Firouzja',
  'Eric Rosen': 'Eric Rosen',
  'Jerry (ChessNetwork)': 'Jerry (ChessNetwork)',
  'Oleksandr Bortnyk': 'Oleksandr Bortnyk',
  'Sergei Zhigalko': 'Sergei Zhigalko',
  'Dmitry Andreikin': 'Dmitry Andreikin',
  'Ediz Gürel': 'Ediz Gürel',
  'Anish Giri': 'Anish Giri',
  'Five positions where depth changes the verdict': '深搜改变判定的五个局面',
  'Each position is from one of those games. The player made the move shown, the analysis gave it no mark, and a 20-million-node search calls it a mistake or worse against a best move that is unique. The board opens on the position before the move, so you can look for the better move first; step forward and you get the game move with the mark it should have had, and the refutation is the sideline in the study, one click under each board.':
    '每个局面都出自上述对局。棋手走了图示的着法，分析没有给出任何标记，而两千万节点的搜索判定它是失误或更糟，相对的最佳着法是唯一的。棋盘从走子前的局面打开，你可以先自己找更好的着法；往前一步就会看到对局中的着法以及它本应得到的标记，反击手段则是研究里的变例，就在每个棋盘下方一点即可。',
  "**Zhigalko, Black to move.** White has just played Be5, hitting the queen on c7, and Black did the natural thing: 20...Qd7, out of the attack. The analysis had it −1.38 before and −1.30 after, nothing lost. But the queen did not need saving. 20...Rxd2! gives up the exchange, and after 21.Rxd2 the pawn move 21...c3! forks the queen on b2 and the rook on d2 at once. White gets the queen back (22.Bxc7 cxb2 23.Rxb2 Rxc7) and is left with a rook against Black's two bishops and knight: −3.2 at depth, against −1.3 for the retreat. The refutation starts with a move that loses material, which is why a one-second search never sees it.":
    '**Zhigalko，黑方走。** 白方刚走 Be5，攻击 c7 的后，黑方做了最自然的事：20...Qd7，把后撤出攻击。分析给出之前 −1.38、之后 −1.30，毫无损失。可是这个后并不需要救。20...Rxd2！弃车换马，21.Rxd2 之后兵走 21...c3！同时捉住 b2 的后和 d2 的车。白方把后吃回来（22.Bxc7 cxb2 23.Rxb2 Rxc7），最后是一车对黑方的双象加一马：深搜下 −3.2，而回撤只有 −1.3。反击手段以一个亏子的着法开头，这正是一秒搜索永远看不到它的原因。',
  'Zhigalko: 20...Qd7 got no mark at 1M; Rxd2 and c3 win':
    'Zhigalko：20...Qd7 在 1M 下没有标记；Rxd2 和 c3 取胜',
  '**Bortnyk, Black to move.** 20...b5 attacks the bishop on c4, and the analysis moved from −0.63 to −0.41. The bishop on f5 could simply have taken the knight: 20...Bxe4! 21.dxe4, and now the other knight lands on f4, with ...e5 to follow to push the bishop off d4. Black wins material inside five moves, −2.7 at depth; the second-best move, 20...Nf4 at once, is only −0.6.':
    '**Bortnyk，黑方走。** 20...b5 攻击 c4 的象，分析从 −0.63 变到 −0.41。f5 的象本可以直接吃马：20...Bxe4！21.dxe4，这时另一只马落到 f4，随后 ...e5 把象从 d4 赶走。黑方五着之内赢子，深搜 −2.7；次佳着法即立即 20...Nf4 只有 −0.6。',
  'Bortnyk: 20...b5 got no mark at 1M; Bxe4 wins material':
    'Bortnyk：20...b5 在 1M 下没有标记；Bxe4 赢子',
  "**Bortnyk, Black to move, a queen ending.** Queen and knight against queen and rook, and White's a-pawn is the only thing White has going. Black played 54...Qf6; the analysis said −1.58 to −1.03. At depth the position after Qf6 is a dead draw. 54...Qa7+! 55.Kg3 Qxa4 picks up that pawn with check, and the ending is −2.1 and winning.":
    '**Bortnyk，黑方走，后的残局。** 后加马对后加车，白方唯一的资本是 a 路兵。黑方走了 54...Qf6；分析说从 −1.58 到 −1.03。深搜下 Qf6 之后的局面是死和。54...Qa7+！55.Kg3 Qxa4 带将吃掉那个兵，残局是 −2.1，是胜势。',
  'Bortnyk: 54...Qf6 got no mark at 1M; Qa7+ and Qxa4 win a pawn':
    'Bortnyk：54...Qf6 在 1M 下没有标记；Qa7+ 和 Qxa4 赢兵',
  '**Carlsen, Black to move.** The white queen sits on g4 and the knight on e4. Carlsen played 15...Ne5, hitting the queen, and the analysis went from −0.94 to −0.43. The pawn move 15...f5! hits both: after 16.Qh3 fxe4 17.Bxe4 Black has won a knight for a pawn and stands −1.9, with the second-best move (15...g6) a pawn and a half behind. A shallow search reads ...f5 as loosening the king and the knight retreat as safe, and both readings are wrong.':
    '**Carlsen，黑方走。** 白后在 g4，马在 e4。Carlsen 走了 15...Ne5 攻击后，分析从 −0.94 变到 −0.43。兵走 15...f5！同时攻击两者：16.Qh3 fxe4 17.Bxe4 之后，黑方以一兵换得一马，评估 −1.9，而次佳着法（15...g6）落后一个半兵。浅层搜索把 ...f5 读成松动王翼、把马的回撤读成安全，两种读法都是错的。',
  'Carlsen: 15...Ne5 got no mark at 1M; f5 forks queen and knight':
    'Carlsen：15...Ne5 在 1M 下没有标记；f5 同捉后与马',
  "**Gürel, White to move.** A rook ending with a knight each; Black's knight on a3 is loose, and White's d-pawn is on d5. White played 31.Nd4, +1.42 to +1.06 by the analysis. 31.d6! is the move: the rook has to stop the pawn (31...Rxd6), and then 32.Nxa3 takes the knight for nothing. +3.9 at depth, against +0.9 after the game move.":
    '**Gürel，白方走。** 车的残局，各有一马；黑方 a3 的马无根，白方 d 路兵在 d5。白方走了 31.Nd4，分析从 +1.42 到 +1.06。31.d6！才是正着：车必须挡兵（31...Rxd6），然后 32.Nxa3 白吃一马。深搜 +3.9，而对局着法之后只有 +0.9。',
  'Gürel: 31.Nd4 got no mark at 1M; d6 deflects the rook and wins the knight':
    'Gürel：31.Nd4 在 1M 下没有标记；d6 引离车并赢马',
  "All 32 are in [the study](/study/fhC7BCG7), set as puzzles: the position first, the game move marked, the refutation as a sideline with the engine's numbers, and every later move of the game that the 20M search judges carries its own mark and the engine's line beside it. Forcing solutions come first, since a long tactic past the shallow horizon is something a person can find; the quiet ones are after.":
    '全部 32 个都在[这套研究](/study/fhC7BCG7)里，按谜题形式编排：先给局面，标出对局中的着法，反击手段作为变例并附上引擎的数值，此外对局后面每一个被 20M 搜索判定的着法都带有自己的标记，旁边是引擎的变例。逼着性的解法排在前面，因为超出浅层视野的长战术是人能找到的；平静的那些排在后面。',
  'Reading your own report': '读懂你自己的报告',
  '"Zero mistakes" means zero visible at a million nodes. The blunders are real, the inaccuracies are half real, and the moves that let an opponent back into a game you were winning by a pawn or two are the ones most likely to carry no mark. If a game matters, put your own engine on it and let it sit past depth 25 on the positions between +0.5 and +3.':
    '「零失误」意味着在一百万节点下看不到失误。严重失误是真的，不精确有一半是真的，而那些让对手重新回到你已多一两个兵的局面里的着法，恰恰最有可能不带任何标记。如果某局棋很重要，就用你自己的引擎去跑，让它在 +0.5 到 +3 之间的局面上搜过 25 层再停。',
  "The random sample is every tenth analysed game in the [August 2026 Lichess database](https://database.lichess.org/) with both players between 1600 and 2400: 300 games, 20,227 moves with server evaluations. Each position went through Stockfish 18, the major version fishnet runs, at 20,000,000 nodes on one thread, and lila's own formula (`Advice.scala`: winning-chance deltas of 0.1, 0.2, 0.3) produced a second set of labels. On 222,183 moves from titled players' games, where Lichess stores its labels, that formula reproduces them from Lichess's own evaluations 99.08% of the time, so both sides of the comparison use it. The 842 moves with a forced mate at either end are excluded; lila judges those by separate rules.":
    '随机样本取自[2026 年 8 月 Lichess 数据库](https://database.lichess.org/)中每第十局已分析、且双方等级分都在 1600 到 2400 之间的对局：共 300 局，20,227 个带服务器评估的着法。每个局面都经过 Stockfish 18（fishnet 所用的主版本）在单线程、20,000,000 节点下的分析，再用 lila 自己的公式（`Advice.scala`：胜率落差 0.1、0.2、0.3）生成第二套标记。在有头衔棋手对局中 Lichess 存有标记的 222,183 个着法上，这套公式用 Lichess 自己的评估能以 99.08% 的比例复现这些标记，所以比较的两边都用它。两端任一存在强制将死的 842 个着法被排除；lila 对它们用另外的规则判断。',
  'Lichess label': 'Lichess 标记',
  'none at 20M': '20M 下无标记',
  inaccuracy: '不精确',
  mistake: '失误',
  blunder: '严重失误',
  "The nine players' games are up to their most recent hundred analysed rated blitz and rapid games (61 for Gürel, 20 for Giri) from the public API (the active seven in 2026; Carlsen and Firouzja have no analysed Lichess games this year, so theirs run back to 2021 and 2023), at a cheaper 4,000,000-node pass. On the random sample, 4M finds a little over half of what 20M finds, so the player rates are floors. A puzzle survives when the move played loses at least 0.2 winning chances at 20M against a best move that beats the second line by 0.1 or more, with three lines searched, and then again when a second, independent 20M search of the position still calls the game move a mistake: 35 passed the first gate, 32 the second. That is the size of the noise in a 20M search, and it is why the deeper pass is treated as twenty times closer to the truth rather than as the truth.":
    '这九位棋手的对局，是公开 API 上他们最近至多一百局已分析的等级分快棋和中速棋（Gürel 为 61 局，Giri 为 20 局；其中七位在 2026 年仍活跃；Carlsen 和 Firouzja 今年没有已分析的 Lichess 对局，所以他们的分别回溯到 2021 年和 2023 年），用更省的 4,000,000 节点分析。在随机样本上，4M 能找到 20M 所找到的略多于一半，所以棋手的比率是下限。一个谜题要留下来，必须满足：所走着法在 20M 下相对最佳着法至少损失 0.2 胜率，且该最佳着法比第二变例好 0.1 以上，搜索三条变例；之后还要满足：对该局面进行第二次独立的 20M 搜索仍判对局着法为失误。第一道关通过 35 个，第二道通过 32 个。这就是 20M 搜索中噪声的量级，也是为什么把更深的分析当作比真相近二十倍、而不是当作真相本身。',
  'Is a million the right number?': '一百万是对的数字吗？',
  'This measures one point on the curve. Whether a million is the right budget depends on the points in between: how much agreement each doubling buys at 2M, 4M and 8M, and whether extra search spent only where labels are unstable, on the inaccuracies and the half-pawn-to-three-pawn band, would get most of the twenty-times result at a fraction of the cost. On these numbers, the current budget gets the label people act on, the blunder, right five times in six.':
    '这只测量了曲线上的一个点。一百万是不是合适的预算，取决于中间的那些点：在 2M、4M 和 8M 下，每翻一倍能换来多少一致性；以及如果只在标记不稳定的地方，也就是不精确和半个兵到三个兵的区间上追加搜索，能否以一小部分成本拿到二十倍预算的大部分效果。按这些数字，现行预算在人们据以行动的那个标记，即严重失误上，六次有五次是对的。',
  'Solve the 32 puzzles': '来解这 32 道谜题',
  'Try xiangqi puzzles': '试试象棋谜题',
  'Reframed around what a million nodes a move buys, with three overstated lines corrected.':
    '改为围绕每着一百万节点换来了什么来写，并修正了三处说过头的句子。',
  // dou-shou-qi-engine: restored 2026-10-24, not native-reviewed; 61 strings reused from the brianhliou.com zh-hans and zh-hant posts where they still say what the moved English says, 4 machine-drafted for text the move changed or added.
  'A Dou Shou Qi (Jungle Chess) Engine: Classical Search Beat the Learned Eval':
    '斗兽棋引擎：经典搜索胜过学习型评估',
  "Building an engine for Jungle, also called Animal Chess: alpha-beta search and a hand-written evaluation went 11-2 with 187 draws against the strongest open-source engine I could run. A learned evaluation and a tablebase didn't help.":
    '为斗兽棋（英文又叫 Jungle 或 Animal Chess）打造引擎：alpha-beta 搜索加手写评估，对阵我所能运行的最强开源引擎取得 11 胜 2 负 187 和。学习型评估和残局库都没有帮助。',
  'MistyJungle, a classical Rust engine for Dou Shou Qi (Jungle), scored W11-L2-D187 against the strongest open-source engine I could run, about +16 Elo.':
    'MistyJungle 是一款用 Rust 写的斗兽棋经典引擎，对阵我所能运行的最强开源引擎取得 W11-L2-D187，约合 +16 Elo。',
  'It matched exact four-piece tablebases on 779 of 800 positions with no win/draw/loss mistakes.':
    '在 800 个局面中有 779 个与精确四子残局库一致，且没有任何胜/和/负判断错误。',
  "The two upgrades I expected to help didn't: a learned eval never beat the hand eval, and a tablebase at the search leaf cost about 13 Elo.":
    '我原本看好的两项升级都没奏效：学习型评估始终没能胜过手工评估，而在搜索叶节点接入残局库反而损失约 13 Elo。',
  'Published endgame databases stop at four pieces, and the full game is likely to stay unsolved.':
    '已发表的残局数据库止步于四子，完整游戏很可能会一直得不到解决。',
  'I built MistyJungle, a classical Rust engine for Dou Shou Qi, the 7×9 board game usually called Jungle or Animal Chess. You can [play MistyJungle on Mistboard](/?play=computer&gameSpecId=jungle). It uses alpha-beta search, a handcrafted evaluation, repetition handling, and no neural network in the playing version.':
    '我做了 MistyJungle，一款用 Rust 写的斗兽棋经典引擎，棋盘 7×9，英文里通常叫 Jungle 或 Animal Chess。你可以[在 Mistboard 上与 MistyJungle 对弈](/?play=computer&gameSpecId=jungle)。它使用 alpha-beta 搜索、手工评估、重复局面处理，对弈版本中不含任何神经网络。',
  "Updated October 7: MistyJungle is no longer Mistboard's strongest jungle bot. In September [KataGo-AnimalChess](/blog/katago-jungle), a self-play net, beat it 82-0 with 118 draws over 200 games and took the top seat; MistyJungle is now the easier bot below it.":
    '10 月 7 日更新：MistyJungle 已不再是 Mistboard 上最强的斗兽棋电脑。9 月，自我对弈神经网络 [KataGo-AnimalChess](/blog/katago-jungle) 在 200 局中以 82-0 外加 118 局和棋击败了它，夺得最高席位；MistyJungle 现在是排在它下面、较容易对付的电脑。',
  'The result is narrow but real. Against the strongest open-source engine I could run, it scored W11-L2-D187 over 200 games, about +16 Elo in a drawish game, and its four-piece endgame play matched exact tablebases with no win/draw/loss mistakes. The two upgrades I expected to help, a learned eval and a tablebase at the search leaf, did not. Classical search did the work.':
    '结果幅度不大，但真实可靠。对阵我所能运行的最强开源引擎，200 局取得 W11-L2-D187，在这样一个和棋率很高的游戏里约合 +16 Elo；它的四子残局着法与精确残局库一致，没有任何胜/和/负判断错误。我原本看好的两项升级，学习型评估和搜索叶节点残局库，都没有奏效。真正起作用的是经典搜索。',
  'What I built': '我做了什么',
  'A standalone Rust engine with a small UCI-style protocol, usable from the command line or from Python via PyO3. Strength is a **node budget, not a clock**, so the same position returns the same move on any machine.':
    '一个独立的 Rust 引擎，带有一套精简的 UCI 风格协议，可以从命令行使用，也可以通过 PyO3 从 Python 调用。强度由**节点预算决定，而不是时钟**，所以同一个局面在任何机器上都会返回同样的着法。',
  'The stack is conventional: negamax alpha-beta with iterative deepening, a Zobrist transposition table, quiescence on captures and den-entries, and killer/history move ordering with PVS and late-move reductions, over a handcrafted evaluation that scores material, distance to the enemy den, traps, water, and mobility. That ordering-and-pruning polish was worth a measured +49 Elo at a fixed node budget.':
    '技术栈很常规：带迭代加深的 negamax alpha-beta、Zobrist 置换表、对吃子和进入兽穴着法的静态搜索，以及 killer/history 着法排序搭配 PVS 和后期着法削减，底层是一套手工评估，对子力、与敌方兽穴的距离、陷阱、水域和机动性进行打分。这些排序与剪枝的打磨在固定节点预算下实测值 +49 Elo。',
  'The eval has to be exact before a learned correction can add anything. Dou Shou Qi is material-heavy but full of sharp exceptions: a rat stops an elephant, a trapped piece loses its rank, one step into the den ends the game.':
    '在学习型修正能带来任何收益之前，评估本身必须准确。斗兽棋很看重子力，但充满尖锐的例外：鼠能克象，落入陷阱的棋子失去等级，一步踏进兽穴就结束对局。',
  Specs: '规格',
  "Each side has eight animals on a 7×9 board, and you win by stepping into the opponent's den or capturing every piece. The rules vary by region, so the exact set matters. I used the Mistboard rules as of June 2026, where wolf outranks dog (some sources swap them). One of those rules has since changed: the tiger jumped the river lengthwise only, a reading that comes from English Wikipedia, while the Chinese rule sets (Tencent's QQ Games, Leiden's page) give the tiger the same leap as the lion. Mistboard and MistyJungle 0.0.6 switched to the Chinese rule in September 2026; the games in this post were played under the old one.":
    '双方各有八只动物，棋盘 7×9，走进对方兽穴或吃光对方所有棋子即获胜。规则因地区而异，所以具体采用哪一套很重要。我使用的是 2026 年 6 月时的 Mistboard 规则，其中狼大于狗（有些资料把两者对调）。其中一条规则后来改了：老虎原本只能纵向跳河，这个读法来自英文维基百科，而中文规则（腾讯 QQ游戏、莱顿大学的页面）给老虎和狮子同样的跳跃能力。Mistboard 和 MistyJungle 0.0.6 于 2026 年 9 月改用中文规则；本文中的对局是在旧规则下进行的。',
  "Capture order, strongest to weakest. Each animal captures to the right. The rat also captures the elephant. A piece in the opponent's trap counts as rank zero.":
    '吃子等级，由强到弱。每种动物可以吃掉右边的动物。鼠还能吃象。位于对方陷阱中的棋子等级视为零。',
  'Beyond plain capture-by-rank, three rules give the game its tactics:':
    '除了单纯按等级吃子，还有三条规则塑造了这个游戏的战术：',
  '**Rat beats elephant, but only on land.** The weakest piece captures the strongest. Captures can’t cross the bank, though, so a rat that swims into the water is safe from everything except another rat.':
    '**鼠能吃象，但只限于陆地上。**最弱的棋子可以吃掉最强的棋子。不过吃子不能跨越岸边，所以游进水里的鼠除了另一只鼠之外谁都吃不到。',
  '**Lions and tigers jump the rivers.** Only the rat may enter the water. The big cats instead leap a whole river to the far bank, sideways or lengthwise, unless a rat sits in the water and blocks the jump.':
    '**狮和虎可以跳河。**只有鼠能进入水中。大猫则跃过整条河落到对岸，横向或纵向均可，除非水里有鼠挡住跳跃路线。',
  '**A trapped piece loses its rank.** The three squares around each den are traps. An enemy piece standing on one drops to rank zero, so anything, even a rat, can capture it.':
    '**落入陷阱的棋子失去等级。**每个兽穴周围的三格是陷阱。站在上面的敌方棋子等级降为零，任何棋子，哪怕是鼠，都能吃掉它。',
  'Full rules with a playable board: [Jungle Chess rules](/rules/jungle).':
    '完整规则和可对弈棋盘：[斗兽棋规则](/rules/jungle)。',
  'A small edge in a game where strong engines draw most of their games:':
    '在这样一个强引擎之间大多和棋的游戏里，这是一点小优势：',
  'Open-source benchmark, 200 games': '开源基准，200 局',
  'W11-L2-D187, about **+16 Elo**': 'W11-L2-D187，约 **+16 Elo**',
  'Search polish (ordering, PVS, LMR)': '搜索打磨（排序、PVS、LMR）',
  '**+49 Elo**, paired self-play, p = 0.008': '**+49 Elo**，配对自我对弈，p = 0.008',
  'Four-piece tablebase check': '四子残局库校验',
  '779/800 matched, **0 WDL contradictions**': '779/800 一致，**0 处胜/和/负矛盾**',
  'Five and six pieces': '五子和六子',
  '**>99%** vs an 8x deeper search (proxy, not proof)':
    '对阵深 8 倍的搜索 **>99%**（代理指标，非证明）',
  'Tablebase at the search leaf': '搜索叶节点残局库',
  'W37-L40-D3, about **-13 Elo**': 'W37-L40-D3，约 **-13 Elo**',
  'Residual neural eval': '残差神经评估',
  'best about **-70 Elo**': '最好约 **-70 Elo**',
  'The +49 was the hard one to measure. Two even Jungle engines draw too much for a win-rate gate, so I used paired, color-swapped self-play (every opening played both ways, new search against old) and a sign test on the decisive games.':
    '那个 +49 是最难测的。两个实力相当的斗兽棋引擎和棋太多，用胜率作为门槛不管用，所以我采用了配对、交换先后手的自我对弈（每个开局正反各下一遍，新搜索对旧搜索），并对分出胜负的对局做符号检验。',
  'Endgames and the state of the solve': '残局与求解现状',
  'Small endgames yield to retrograde analysis, and they make excellent judges. Van Rijn and Vis solved four pieces at Leiden in 2013 (under the Leiden convention, which swaps dog and wolf), and I can find nothing larger published since. My engine matched exact four-piece play on 779 of 800 positions with no WDL contradictions, and tracked an 8x deeper search above 99% at five and six pieces.':
    '小规模残局可以用逆向分析攻克，而且它们是极好的裁判。Van Rijn 和 Vis 于 2013 年在莱顿解决了四子残局（采用莱顿约定，狗和狼互换），此后我没有找到更大的已发表结果。我的引擎在 800 个局面中有 779 个与精确四子着法一致，没有胜/和/负矛盾，在五子和六子上与深 8 倍的搜索吻合度超过 99%。',
  'That four-piece database is still the frontier, and the wall past it is storage, not solving technique. The board is the problem: 63 squares against the 16 of [Flip Jungle](/blog/flip-jungle-skill-ceiling), so each added piece has some 60 empty squares to stand on instead of a dozen, and the level sizes grow about five times faster. Five Flip Jungle pieces fit in 2.8 GB on my laptop; five Dou Shou Qi pieces run to roughly 7 TB. Eight pieces and up, half the starting material, is out of reach as a database, and nobody has a forward proof of the full sixteen-piece game either. Dou Shou Qi is solved to four pieces and open above it, and likely to stay that way.':
    '四子数据库仍是当前的边界，越过它的那堵墙是存储，而不是求解技术。问题出在棋盘上：63 格，而[翻翻棋](/blog/flip-jungle-skill-ceiling)只有 16 格，所以每多一个棋子就有约 60 个空格可站，而不是十来个，各层的规模增长大约快五倍。翻翻棋的五子在我笔记本上只占 2.8 GB；斗兽棋的五子则要大约 7 TB。八子及以上，也就是初始子力的一半，作为数据库已经遥不可及，也没有人给出完整十六子游戏的前向证明。斗兽棋解到四子为止，再往上仍未解决，而且很可能会一直如此。',
  'Corrected 27 September 2026: an earlier version put the frontier at seven pieces. That figure came from a citation in a 2019 paper, which on inspection points to a Leiden thesis on Jungle Checkers, a different game.':
    '2026 年 9 月 27 日更正：本文早先的版本称边界为七子。这个数字来自一篇 2019 年论文中的引用，核查后发现它指向莱顿一篇关于 Jungle Checkers 的论文，那是另一种游戏。',
  "A tablebase loaded at the search leaf also added nothing to playing strength (about -13 Elo): search already finds the answer at the sizes that fit, and the sizes where it would help don't ship. One caveat from the Flip Jungle build, where the same experiment first read as null and later turned out to be hiding a bug: those tables stored win/draw/loss with no distance, and a WDL-only leaf lets the engine hold a won endgame forever without finishing it, since every winning move grades the same. Adding distance-to-mate to the tables fixed the finishing there. My Jungle leaf probe was WDL-only too, so some of that -13 may be the same effect rather than tablebases being useless at the leaf. Untested; the classical engine ships without the probe either way.":
    '在搜索叶节点加载残局库同样没有提升棋力（约 -13 Elo）：在能装得下的规模上搜索本来就能找到答案，而真正能帮上忙的规模又根本做不出来。有一点要提醒，来自翻翻棋那次构建：同样的实验一开始也读作零效果，后来发现是掩盖了一个 bug。那些表只存了胜/和/负而不带距离，只有胜/和/负的叶节点会让引擎把已经赢定的残局无限拖下去而不去终结，因为每一个获胜着法的分数都一样。给表加上将死距离之后，那边的收官问题就解决了。我在斗兽棋这边的叶节点探查也只有胜/和/负，所以这 -13 里有一部分可能是同样的效应，而不是说残局库在叶节点没用。这一点未经验证；无论如何，发布的经典引擎不带这个探查。',
  'Learned eval': '学习型评估',
  'This stalled on data, not architecture. A residual net (the handcrafted score plus a bounded correction) climbed from -470 to about -70 Elo as I fixed the labels, but never beat the hand eval. The labels were weakest exactly where the net needed help: draw-heavy self-play underrepresents material swings, exact tablebase labels only cover small endgames, and search-score labels mostly teach the net to imitate the search it already has.':
    '卡住的是数据，不是架构。一个残差网络（手工分数加上一个有界修正）随着我修正标签，从 -470 爬升到约 -70 Elo，但始终没能胜过手工评估。标签最薄弱的地方，恰恰是网络最需要帮助的地方：和棋居多的自我对弈里子力波动的样本太少，精确残局库标签只覆盖小规模残局，而搜索分数标签主要是教网络去模仿它本来就有的搜索。',
  AlphaZero: 'AlphaZero',
  'Still open work. I did not run a full Jungle AZ climb. The adjacent Banqi AZ de-risk failed its gate, but that is a different game and does not falsify AZ for Jungle, which is friendlier ground: deterministic and perfect-information, with no chance-node reveal. I parked it because the cheap rung was negative and the classical engine already beat the benchmark.':
    '仍是待做的工作。我没有完整跑过斗兽棋的 AZ 训练。相邻的暗棋 AZ 风险排查没有通过门槛，但那是另一个游戏，并不能否定 AZ 在斗兽棋上的可行性；斗兽棋的条件更友好：确定性、完全信息，没有随机节点翻开。我先搁置了，因为最便宜的那一档是负收益，而经典引擎已经打赢了基准。',
  'Example games': '对局示例',
  'The match was mostly draws, but the decisive games show the shape of the edge: den pressure first, material second. The boards open near the conversion, so step back for the opening; all six are in a [study on Mistboard](/study/xzzhAld5). They were played under the lengthwise-only tiger rule Mistboard used until September 2026.':
    '这场对抗赛大多是和棋，但分出胜负的几局显示出优势的形态：先是兽穴压力，其次才是子力。棋盘展示从转化点附近开始，想看开局可以往回翻；六局全部收录在 [Mistboard 上的一个研究](/study/xzzhAld5)里。它们是在 Mistboard 2026 年 9 月之前采用的老虎仅可纵向跳河规则下进行的。',
  'MistyJungle (black) builds a material lead and finishes with a lion in red’s den:':
    'MistyJungle（黑方）建立子力优势，最终以狮进入红方兽穴收官：',
  "MistyJungle (black) wins, a lion in red's den": 'MistyJungle（黑方）获胜，狮进入红方兽穴',
  'Another black win, a shorter squeeze where the last piece reaches d1 after exchanges around the trap:':
    '又一局黑方获胜，这次挤压更短，在陷阱周围的兑子之后，最后一枚棋子抵达 d1：',
  'MistyJungle (black) reaches the den after an 80-ply squeeze':
    'MistyJungle（黑方）经过 80 着的挤压抵达兽穴',
  'A red win that shows why you can’t just count material: MistyJungle loses material but wins the den race:':
    '一局红方获胜，说明为什么不能只数子力：MistyJungle 子力亏损，却赢下了冲兽穴竞速：',
  'MistyJungle (red) wins the den race down material':
    'MistyJungle（红方）在子力落后的情况下赢下冲兽穴竞速',
  'The longest saved win, red grinding through 283 plies before reaching the den:':
    '保存下来最长的一局胜利，红方磨了 283 着才抵达兽穴：',
  'MistyJungle (red) grinds out a 283-ply win': 'MistyJungle（红方）磨出一局 283 着的胜利',
  'The engine against itself at 8M nodes a move, about five seconds each: a long even fight where red nurses a one-piece edge for forty moves, then converts and walks a lion into black’s den:':
    '引擎每着 8M 节点的自我对弈，每着约五秒：一场势均力敌的长局，红方守着一子优势走了四十回合，随后完成转化，把狮送进黑方兽穴：',
  'MistyJungle against itself at 8M nodes: a one-piece edge converted':
    'MistyJungle 8M 节点自我对弈：一子优势转化成胜势',
  'More dramatic still, also a mirror game at 8M nodes: red lets black keep the elephant, lion, and tiger, falls sixteen points behind in material, and wins anyway by racing a rat into the den before that material can matter. The clearest statement of what the engine is actually optimizing:':
    '更富戏剧性的一局，同样是 8M 节点的自我对弈：红方任由黑方保住象、狮和虎，子力落后十六分，却靠一只鼠抢在子力发挥作用之前冲进兽穴取胜。这是对引擎真正在优化什么最清楚的说明：',
  "MistyJungle against itself at 8M nodes: down sixteen, red's rat reaches the den first":
    'MistyJungle 8M 节点自我对弈：落后十六分，红方的鼠先一步抵达兽穴',
  Conclusion: '结论',
  'MistyJungle is a classical search engine with a narrow, measured edge over the strongest open-source engine I could run. The work that moved strength was unglamorous: correct rules, fixed-budget measurement, color-swapped tests, search polish, and endgame validation. Tablebases judged well but did not help at the leaf, the first neural rung lost to the hand eval, and a real AlphaZero climb is still open work.':
    'MistyJungle 是一款经典搜索引擎，对我所能运行的最强开源引擎有一点实测出来的微弱优势。真正提升棋力的工作都不起眼：正确的规则、固定预算的测量、交换先后手的测试、搜索打磨，以及残局验证。残局库作为裁判很称职，但放在叶节点没有帮助；神经网络的第一档输给了手工评估；而真正跑一遍 AlphaZero 仍是待做的工作。',
  '[misty-jungle](https://github.com/brianhliou/misty-jungle) is the engine, in Rust. [Layheng-Hok/Jungle-Chess](https://github.com/Layheng-Hok/Jungle-Chess) is the open-source engine I used as the fixed benchmark. [Bagheera](https://liacs.leidenuniv.nl/~visjk/doushouqi/) is Leiden’s closed-source engine and the endgame tablebases I graded against. More in the engine series: [MistyBanqi](/blog/mistybanqi), the same measurement discipline on Chinese Dark Chess.':
    '[misty-jungle](https://github.com/brianhliou/misty-jungle) 是引擎本体，用 Rust 编写。[Layheng-Hok/Jungle-Chess](https://github.com/Layheng-Hok/Jungle-Chess) 是我用作固定基准的开源引擎。[Bagheera](https://liacs.leidenuniv.nl/~visjk/doushouqi/) 是莱顿的闭源引擎，也是我用来评分的残局库。引擎系列更多内容：[MistyBanqi](/blog/mistybanqi)，把同样的测量方法用在暗棋上。',
  'MistyJungle is on Mistboard as the easier of the two jungle bots. Take it on, or read its source.':
    'MistyJungle 在 Mistboard 上是两个斗兽棋电脑中较容易的那一个。来挑战它，或者读读它的源代码。',
  'Play MistyJungle': '挑战 MistyJungle',
  'misty-jungle on GitHub': 'GitHub 上的 misty-jungle',
  'Jungle Chess Rules': '斗兽棋规则',
  // jungle-den-term: restored 2026-10-24, not native-reviewed; 66 strings reused from the brianhliou.com zh-hans and zh-hant posts where they still say what the moved English says, 9 machine-drafted for text the move changed or added.
  'Teaching our Jungle Chess engine the den race bought nothing':
    '教斗兽棋引擎冲兽穴竞速，毫无收获',
  'Misty, our Jungle Chess engine, has no idea of a den race. Three ways to teach it one came back null or negative: races decide 4.7% of games at full strength, and a 12 times deeper search sees the loss a median of one ply sooner.':
    'Misty 是我们的斗兽棋引擎，它完全不懂冲兽穴竞速。三种教它的办法，结果都是无效或负收益：在全力对弈中，竞速只决定 4.7% 的对局，而搜索加深 12 倍，看到败势的时间中位数只提前一着。',
  'Misty, Mistboard’s Jungle Chess engine, has no idea of a den race, so we tried three ways to teach it one. All three came back null or negative.':
    'Misty 是 Mistboard 的斗兽棋引擎，它完全不懂冲兽穴竞速，于是我们试了三种办法教它。三种结果都是无效或负收益。',
  'Den races decide only 4.7% of games at full strength (a weak-search test said 22%), and searching 12 times deeper sees the loss a median of one ply sooner.':
    '在全力对弈强度下，冲兽穴竞速只决定 4.7% 的对局（弱搜索测试给出的是 22%），而搜索加深 12 倍，看到败势的时间中位数也只提前一着。',
  'A search extension near the dens looked like +45 Elo until we held the node budget fixed; then it was slightly negative. A dedicated den-race term was null.':
    '兽穴附近的搜索延伸看起来有 +45 Elo，直到我们把节点预算固定住；此时它略为负值。专门的冲兽穴竞速评估项结果为无效。',
  'Hold the budget fixed or you are measuring the budget. Two constants from the same games, a draw clock and draw contempt, doubled the share of decisive games instead.':
    '要把预算固定住，否则你测的只是预算。反倒是来自同一批对局的两个常数，和棋步数限制与和棋蔑视值，把分出胜负的对局比例翻了一倍。',
  'Base rate from 172 self-play games at the production budget of five million nodes a move.':
    '基础发生率来自 172 局自我对弈，采用生产环境的每着五百万节点预算。',
  'Headroom: in each of the 8 den races, the earliest ply at which five and sixty million nodes see the forced loss.':
    '上限空间：在 8 场冲兽穴竞速中的每一场，五百万节点与六千万节点分别最早在哪一着看出必败。',
  'The search extension tested as a harness policy that gives one side more nodes near an enemy den, 300 colour-swapped pairs per arm, with and without a fixed node budget.':
    '搜索延伸以测试框架策略的形式测试：棋子靠近对方兽穴时给该方更多节点，每组 300 对交换先后手的对局，分别在固定与不固定节点预算下进行。',
  'Misty, Mistboard’s Jungle Chess engine, has no concept of a den race. It scores a position by material plus a per-piece bonus for advancing toward the enemy den, and never asks whether the runner heading for *its* den arrives first. It finds out when the search reaches the den, about twelve plies out.':
    'Misty 是 Mistboard 的斗兽棋引擎，它没有冲兽穴竞速这个概念。它对局面的评估是子力加上每个棋子朝对方兽穴推进的奖励，从不去问那个奔向*自己*兽穴的对手棋子是否会先到。等搜索抵达兽穴时它才发现，那大约是十二着之后。',
  'That looked like a clear gap, filed as an issue after a game where the bot shuffled a rat back and forth while an enemy rat walked in. In August we spent a day trying to close it. Three routes, all null or negative. This is what the measurements said and what we would keep from them.':
    '这看上去是个明显的短板，在一局机器人把鼠来回挪动、任由对方鼠走进兽穴的对局之后，它被记成了一个 issue。8 月我们花了一天试着补上。三条路线，全是无效或负收益。以下是测量结果，以及我们会从中保留下来的东西。',
  'What the engine already does': '引擎本来会做的事',
  'Worth separating, because it framed everything after. The engine understands the win condition completely: reaching the den is scored as mate, ordered first among candidate moves, and searched in quiescence. What it lacks is foresight, not comprehension.':
    '这点值得单独说，因为它决定了后面的一切。引擎对胜利条件的理解是完整的：进入兽穴被算作将死，在候选着法里排在最前，并且在静态搜索中被搜索。它缺的是预见能力，不是理解力。',
  'It wins anyway, because Jungle is material-dominated and the evaluation reads material exactly. At the moment of den entry the median winner is 20 points ahead, about one cat. Only 4.7% of games are won by a side that was level or behind. How the engine is built, and how it measured against other engines, is in [A Dou Shou Qi engine](/blog/dou-shou-qi-engine).':
    '它照样能赢，因为斗兽棋由子力主导，而评估函数对子力的读取是精确的。在进入兽穴的那一刻，胜方的中位子力领先 20 分，大约一只猫。只有 4.7% 的对局是由持平或落后的一方赢下的。引擎是怎么搭建的，以及它与其他引擎对比的测量结果，见[斗兽棋引擎](/blog/dou-shou-qi-engine)一文。',
  'What it plays without the concept': '没有这个概念时它会怎么走',
  'Game 10 of the study turns on four moves, and it settles the question better than any table below.':
    '研究中的第 10 局取决于四着棋，它比下面任何表格都更好地解答了这个问题。',
  'Jungle’s middle is three ranks of water, and the d-file runs between the two lakes, one square wide. Under the rules Mistboard used when these games were played, tigers jumped water lengthwise only, never sideways, so a tiger standing in that corridor had almost nowhere to go. Since 21 September the tiger jumps sideways too, like the lion, following the Chinese rule sets; the corridor is no longer a trap for it, and the line below is a line from the old rule.':
    '斗兽棋的中路是三行水面，d 路夹在两条河之间，只有一格宽。在这些对局进行时 Mistboard 采用的规则下，虎只能纵向跳水，绝不能横向跳，所以站在那条通道里的虎几乎无处可去。自 9 月 21 日起，虎也像狮一样可以横向跳，遵循中国的规则体系；这条通道对它不再是陷阱，下面这条着法线是旧规则下的产物。',
  'Move 20, Blue to play. Red’s tiger has just taken a wolf on d6 and stands in the corridor, one square below Blue’s elephant, which outranks it.':
    '第 20 回合，蓝方行棋。红方的虎刚在 d6 吃掉一只狼，现在站在通道里，在蓝方象下方一格，而象的等级高于它。',
  'Game 10, move 20, Blue to play': '第 10 局，第 20 回合，蓝方行棋',
  'On move 20 Red’s tiger on d5 had two legal moves, forward or back, both still in the corridor. It went forward and took the wolf, which cost Blue 40 points and parked the tiger next to Blue’s elephant.':
    '第 20 回合时红方在 d5 的虎只有两个合法着法，向前或向后，都还在通道里。它选择向前吃掉了狼，这让蓝方损失 40 分，同时把虎停在了蓝方象的旁边。',
  'Blue’s elephant outranks a tiger, so this looks like a gift. Blue declined to take it at once, which is the move the issue asked us to explain. The engine’s reason is that the tiger could not escape: with the elephant on d7 the tiger’s only move was d5, and from d5 its only move was d4, walked down a one-lane corridor by a piece that beats it. Grabbing it costs a tempo to collect something already collected. Blue played a free improving move and took the tiger two moves later, on d5 instead of d6. Both lines reach identical material.':
    '蓝方的象等级高于虎，所以这看起来像是送礼。蓝方没有立刻吃，这正是那个 issue 要我们解释的一着。引擎的理由是那只虎逃不掉：象在 d7 时，虎唯一的着法是 d5，而从 d5 出发唯一的着法是 d4，被一个能吃掉它的棋子沿着单车道通道一路赶下去。去吃它等于花一个先手收取已经到手的东西。蓝方走了一着白得的改善着法，两回合之后在 d5 而不是 d6 吃掉了虎。两条线路达到的子力完全相同。',
  'The four moves that decided the game, by ply:': '决定这局胜负的四着，按着序编号：',
  'The tiger was bait. Not a sacrifice: it was nearly trapped anyway, and taking the wolf scored +10 against +6 for almost every alternative, a difference of four points rather than a plan. What it does on its way off the board is pull the one piece that outranks a lion down the d-file. At move 20 the lion jump scores **−195**, because c7 sits next to Blue’s elephant on d7. Two moves later the same jump wins, because the elephant left.':
    '那只虎是诱饵。不是弃子：它反正几乎已被困死，而吃掉狼得 +10，几乎所有其他选择都是 +6，差距是四分而非一个计划。它在离开棋盘的路上所做的，是把唯一等级高于狮的棋子拉下 d 路。第 20 回合时狮的跳跃评估值是 **−195**，因为 c7 紧邻 d7 上蓝方的象。两回合之后同样的跳跃就能取胜，因为象走开了。',
  'Blue ends the sequence 13 points ahead and loses.': '这段着法结束时蓝方领先 13 分，然后输掉了。',
  'Read the plan back and it sounds like the engine understood a den race. It did not. There is no den-race term anywhere in that evaluation, before or after this project. It searched five million nodes and the line came out. That is the whole result: the behaviour the issue wanted to install was already there, produced by depth rather than knowledge.':
    '把这个计划复述一遍，听起来像是引擎理解了冲兽穴竞速。它并没有。那份评估函数里从头到尾都没有冲兽穴竞速项，在这个项目之前和之后都没有。它搜索了五百万个节点，这条线路就出来了。这就是全部结果：那个 issue 想装进去的行为本来就在，是由深度而不是知识产生的。',
  'Base rate: 4.7% of games, measured at full strength':
    '基础发生率：4.7% 的对局，在全力对弈强度下测量',
  '172 self-play games at the production budget of five million nodes a move.':
    '172 局自我对弈，采用生产环境的每着五百万节点预算。',
  'Game ended by': '终局方式',
  'Den entry': '进入兽穴',
  'of which a genuine race': '其中真正的竞速',
  'A genuine race is a game won by a side that was level or behind ten plies before the end.':
    '真正的竞速，指胜方在终局前十着时持平或落后的对局。',
  'The same harness at 200k nodes reports 22% races. Weaker play inflates the number about fivefold. The cheap measurement was available, and it would have been wrong by 5× in the direction that justifies more work.':
    '同一套测试框架在 200k 节点下报出 22% 的竞速比例。棋力更弱会把这个数字大约放大五倍。便宜的测量方式是现成的，而它会朝着「值得多做工作」的方向错上 5 倍。',
  'Headroom: a 12× deeper search buys about one ply': '上限空间：搜索加深 12 倍只换来约一着',
  'For each of the 8 races we binary-searched the loser’s game for the earliest ply at which each budget recognises the forced loss, then took the gap.':
    '对 8 场竞速中的每一场，我们在败方的对局中二分查找每个预算最早能识别出必败的那一着，然后取差值。',
  'Seen sooner by 60M nodes': '60M 节点提前看出',
  Races: '竞速局数',
  '0 plies': '0 着',
  '2 plies': '2 着',
  '4 plies': '4 着',
  '60 million nodes a move against 5 million, over the 8 genuine races.':
    '每着六千万节点对五百万节点，共 8 场真正的竞速。',
  'Sixty million nodes against five million, and the deeper search sees the loss a median of one ply earlier: at most four, and no earlier at all in half the races. Before that horizon the two track closely, diverging only in the last ply or two.':
    '六千万节点对五百万节点，更深的搜索看到败势的时间中位数只提前一着：最多四着，而在一半的竞速里根本没有提前。在那个视野之前，两者走势非常接近，只在最后一两着才分开。',
  'This is the number that should have ended the project. If twelve times the search recovers about a ply, the information is not sitting there waiting for a cleverer evaluation to surface it.':
    '这个数字本该让项目就此终结。如果十二倍的搜索只挽回大约一着，那这个信息并不是摆在那里、等着一个更聪明的评估函数去发掘。',
  'Route A: a search extension, free and paid': '路线 A：搜索延伸，免费版与付费版',
  'Probed without building it. A harness policy grants one side a larger node budget whenever a piece is within R squares of an enemy den, which is a strict upper bound on any real extension.':
    '没有真的实现就先探了一下。测试框架里的一条策略规定：只要有棋子处在对方兽穴 R 格之内，就给该方更大的节点预算，这是任何真实延伸的严格上界。',
  'First finding, before any Elo: the trigger is not sparse.':
    '在算 Elo 之前的第一个发现：触发条件并不稀疏。',
  Radius: '半径',
  'Plies where it fires': '触发的着数占比',
  'Jungle’s board is small and dens sit on the back ranks. At R=4, the radius needed to see a race early, the extension is just “search twelve times more everywhere”, so the surgical framing was wrong from the start.':
    '斗兽棋棋盘很小，兽穴就在底线上。在 R=4，也就是及早看到竞速所需的半径下，这个延伸就等于「到处都多搜十二倍」，所以「精准手术」这种设想从一开始就是错的。',
  'At R=2, 300 colour-swapped pairs per arm:': '在 R=2，每组 300 对交换先后手的对局：',
  Arm: '实验组',
  'Nodes vs control': '相对对照组的节点数',
  '12× depth near dens, granted free': '兽穴附近 12 倍深度，免费给予',
  'Budget-neutral: 3.7M base, 10M near dens': '预算中性：基础 3.7M，兽穴附近 10M',
  'Budget-neutral: 1.1M base, 20M near dens': '预算中性：基础 1.1M，兽穴附近 20M',
  'Same idea, same code, opposite sign. The engine’s five million nodes are fixed by how long a player will wait, so a real extension cannot conjure depth: it takes it from the rest of the search. The free arm measured the extra compute, nothing about dens.':
    '同一个想法，同一份代码，符号相反。引擎那五百万节点是由玩家愿意等多久固定下来的，所以真实的延伸没法凭空造出深度：它只能从搜索的其他部分抢。免费那一组测的是额外算力，跟兽穴毫无关系。',
  'We ran the budget-neutral arm because +45 looked too good. Stopping there would have bought a week of work for a feature worth slightly less than zero.':
    '我们之所以跑了预算中性那一组，是因为 +45 看起来好得不真实。就此停手，就会为一个价值略低于零的功能花掉一周工作。',
  'Both arms cost an afternoon, because neither required touching the engine. The extension was a harness policy that varies the node budget on a board condition. For any proposal of the form “make it smarter about X”, granting it free perfect X first is the cheapest way to find out whether X matters at all.':
    '两组各只花了一个下午，因为都不需要动引擎。那个延伸只是测试框架里一条根据棋盘条件改变节点预算的策略。对于任何形式为「让它在 X 上更聪明」的提案，先免费给它完美的 X，是判断 X 到底重不重要的最便宜的办法。',
  'Route B: the term itself': '路线 B：评估项本身',
  'We built it anyway, because the extension failed for a reason that does not apply to an evaluation term. An extension costs nodes; a term costs almost nothing per leaf.':
    '我们还是把它做了出来，因为延伸失败的原因并不适用于一个评估项。延伸消耗节点；而评估项在每个叶子节点上几乎不花成本。',
  'Here is the evaluation as it stood. One loop over the board, and every piece contributes independently:':
    '这是当时的评估函数。在棋盘上做一次循环，每个棋子独立贡献：',
  'That advancement term is why the evaluation is blind to a race, and the reason is the symmetry. Our runner three squares from your den scores +39. Your runner three squares from ours scores −39. Both sides sprinting produces a number near zero, and the position reads quiet at exactly the moment it is most decided.':
    '那个推进项正是评估函数对竞速视而不见的原因，而根源是对称性。我们的奔跑者距你的兽穴三格得 +39。你的奔跑者距我们的兽穴三格得 −39。双方同时冲刺得到的数字接近零，于是恰恰在局势最已定的那一刻，局面读起来风平浪静。',
  'So the term cannot be another per-piece bonus. It has to be one verdict per side, computed once, comparing the two runners against each other:':
    '所以这个项不能再是一个逐子奖励。它必须是每方一个判定，只计算一次，把两个奔跑者互相比较：',
  'The defender is measured to the **trap ring**, not to the den. That is the right interception zone because a den’s three neighbours *are* its three traps, and a piece standing on a trap can be captured by any defender regardless of rank. An elephant walking into your den has to cross a square where your rat can take it.':
    '防守方是按到**陷阱环**的距离来度量的，而不是到兽穴。这才是正确的拦截区，因为兽穴的三个相邻格*就是*它的三个陷阱，而站在陷阱上的棋子不论等级都能被任何防守方吃掉。走进你兽穴的象必须穿过一个你的鼠能吃掉它的格子。',
  'It changes the chosen move in 17% of the positions it was designed for, and costs about 17% wall clock at equal nodes. Over 300 colour-swapped pairs per weight, before charging that cost:':
    '在它专门针对的那些局面里，它改变了 17% 的选着，并且在节点数相同时实际耗时增加约 17%。每个权重跑 300 对交换先后手的对局，在还没把这项成本算进去之前：',
  Weight: '权重',
  'Null, in the generous direction.': '无效，而且是在宽容的方向上。',
  'What we would keep': '我们会保留下来的东西',
  'Hold the budget constant, or you are measuring the budget. The free version of an experiment is the convenient one to build and it hands you a confident positive number. Whatever the change would have to take from, take it, and see whether the result survives.':
    '把预算固定住，否则你测的就是预算。实验的免费版本是建起来最方便的那个，而它会递给你一个自信的正数。不管这个改动本该从哪里挪用资源，就从那里挪，然后看结果还站不站得住。',
  'That trap caught us twice in one day. A contempt sweep the same afternoon showed decisive games rising from 32% to 50%, which is what higher contempt produces by construction, since both sides in a self-play sweep get the setting. Only the two values facing each other could say whether it cost anything. It did not, so that one shipped.':
    '这个陷阱在一天里坑了我们两次。同一个下午做的蔑视值扫描显示，分出胜负的对局从 32% 升到 50%，而这本来就是提高蔑视值必然产生的结果，因为自我对弈扫描中双方都用了同一个设置。只有让两个取值互相对抗，才能看出它是否付出了代价。它没有，所以那一项上线了。',
  'The evaluation gap was real and correctly diagnosed. It just had nothing behind it. Two constants found in the same games, a no-capture draw clock that was ending games early and a draw contempt near zero, took Jungle self-play from a quarter of games ending in a win to about half, and neither teaches the engine anything. The issue asked for understanding. Understanding was never the constraint.':
    '评估函数的这个短板是真实的，诊断也没错。只是它背后什么都没有。在同一批对局里找到的两个常数，一个是过早结束对局的无吃子和棋限制，一个是接近零的和棋蔑视值，把斗兽棋自我对弈从四分之一的对局分出胜负提升到了大约一半，而这两者都没教引擎任何东西。那个 issue 要求的是理解。理解从来就不是瓶颈。',
  'The games are public, and so is the position above. The analysis board runs the same engine, under today’s rule where the tiger can jump sideways out of the corridor, so if you think Blue should have taken the tiger you can make it play a line out.':
    '这些对局是公开的，上面那个局面也是。分析棋盘运行的是同一个引擎，采用的是如今虎可以横向跳出通道的规则，所以如果你觉得蓝方当时该吃掉那只虎，你可以让它把一条线路走完。',
  'Walk the 52 games': '浏览这 52 局',
  'Open the position': '打开该局面',
  'Back as its own page, with the deeper-search deficit median corrected to 1 ply and the race shares restated.':
    '恢复为独立页面，更深搜索提前看出败势的中位数更正为 1 着，竞速占比也重新表述。',
  'Dou Shou Qi Engine: Does a Den-Race Term Help?': '斗兽棋引擎：冲兽穴竞速评估项有用吗？',
  // Homepage card titles (cardTitle), machine-drafted 2026-10-24 from each post's zh title.
  'En Passant Under Fog': '迷雾下的吃过路兵',
  'The Most Played Move': '最常走的一手',
  'Chess960 Positions Ranked': '国际象棋960开局排名',
  'What a Million Nodes Buys': '一百万节点换来了什么',
  'A Dou Shou Qi Engine': '一个斗兽棋引擎',
  'Teaching Misty the den race': '教 Misty 冲兽穴竞速',
};

export const MOVED_POSTS_ZH_HANT: Readonly<Record<string, string>> = {
  // en-passant-under-fog: carried over from the brianhliou.com zh-hans and zh-hant posts (2026-10-15), word for word; links repointed like the English. Strings whose two zh versions were translated separately (ASCII differs) are left out, so the parity check below holds.
  "My fog of war chess engine recorded the en passant square under standard chess legality, in a variant with no such rule. En passant availability decides what a pawn can see, so the true board fell out of the engine's belief and it finished the game against 41 worlds that did not exist.":
    '我的迷霧戰爭西洋棋引擎依標準西洋棋的合法性記錄吃過路兵的目標格，可是這個變體根本沒有這條規則。能否吃過路兵決定了兵能看見什麼，於是真實棋盤從引擎的信念中掉了出去，它在最後對著 41 個不存在的世界下完了那盤棋。',
  'Misty tracks every board consistent with what it has seen, stored as FEN strings. In one game it finished against 41 boards, none of them the real one.':
    'Misty 追蹤所有與它所見一致的棋盤，以 FEN 字串儲存。有一盤棋它最後是對著 41 個棋盤下完的，其中沒有一個是真的。',
  'python-chess writes the en passant square only when the capture is legal in standard chess. Under fog the capture is legal even in check, and a pawn that can take en passant sees that square, so the true position stopped matching what Misty had seen.':
    'python-chess 只在該吃子於標準西洋棋中合法時才寫出吃過路兵的目標格。在迷霧規則下，即使被將軍，這個吃子也是合法的，而能吃過路兵的兵看得見那個格子，於是真實局面不再與 Misty 所見相符。',
  'The fix records the square whenever a pawn can take. Replaying all 271 games, lost-truth cases outside the sampled games went from four to none.':
    '修正方式是只要有兵能吃就記下該格。重播全部 271 盤棋後，抽樣棋局以外的真值遺失案例由四例降為零。',
  'Nothing caught it: the Rust port copied python-chess byte for byte, so the test comparing the two passed, and a belief that loses the truth gets more confident, not less.':
    '沒有任何機制抓到它：Rust 移植版逐位元組複製了 python-chess 的行為，所以比對兩者的測試通過了；而一個遺失真值的信念只會變得更有把握，不會更不確定。',
  "Game `e751c6c4`, Misty as Black, move 29. White pushes the g-pawn two squares, beside Black's pawn on f4. White's queen on d6 attacks the black king.":
    '棋局 `e751c6c4`，Misty 執黑，第 29 著。白方將 g 兵推進兩格，落在黑方 f4 兵的旁邊。白方在 d6 的后攻擊黑王。',
  'Record the square when a pawn can take, regardless of whether taking is wise. That is `EnPassantMode.XFEN`, and it is the fog rule. It still omits the square when no enemy pawn is adjacent, so the belief does not split over a square nobody can use.':
    '只要有兵能吃，就記下那個格子，不管吃下去是否明智。這就是 `EnPassantMode.XFEN`，也是迷霧規則。當旁邊沒有敵方兵時它仍會省略該格，所以信念不會因為一個沒人能用的格子而分裂。',
  'At the failing ply `P` now goes 625 to 617, truth kept. Replaying all 271 games reports no lost-truth decisions outside the sampled games, against four before.':
    '在出錯的那一著，`P` 現在是由 625 變為 617，真值保留。重播全部 271 盤棋後，抽樣棋局以外沒有任何真值遺失的決策，先前則有四例。',
  'Why nothing caught it': '為什麼沒有任何機制抓到它',
  "Fixed in the engine on 2026-09-10 and released in [Misty 0.1.3](https://github.com/brianhliou/misty/releases/tag/v0.1.3). Every board above is drawn by the engine's own visibility code from that position; the script that draws them refuses to run if the two views stop differing by exactly g3 and g4.":
    '已於 2026-09-10 在引擎中修正，並隨 [Misty 0.1.3](https://github.com/brianhliou/misty/releases/tag/v0.1.3) 發佈。上方每一張棋盤都是由引擎自己的可見性程式碼從該局面繪製的；繪圖的腳本若發現兩個視野的差異不再剛好是 g3 與 g4，就會拒絕執行。',
  // most-played-move: carried over from the brianhliou.com zh-hans and zh-hant posts (2026-10-15), word for word; links repointed like the English. Strings whose two zh versions were translated separately (ASCII differs) are left out, so the parity check below holds.
  'When the Most Played Move Is an Inaccuracy': '當最多人下的著法其實是不精確',
  "Half are gambits and sidelines the masters never play. Where masters reach the position, most already play the engine's move; only four share the club's mistake.":
    '其中半數是大師從不採用的棄兵與冷門變例。在大師確實下到的局面裡，多數大師早已走引擎的著法；只有四個局面與俱樂部棋手犯同樣的錯。',
  'The biggest by games: after 1.e4 e5 2.f4 d6, 85% of club players play 3.Nf3, and 3.d3 is nearly a pawn better.':
    '以對局數計最大的一例：1.e4 e5 2.f4 d6 之後，85% 的俱樂部棋手走 3.Nf3，而 3.d3 幾乎好上一個兵。',
  "The fix is in the explorer's settings: the masters database, 2018 onward. All 144 are in a study.":
    '解法就在局面瀏覽器的設定裡：大師資料庫，2018 年起。全部 144 個都收在一份研究中。',
  'The opening explorer on Lichess shows you, for any position, what people played next and how it went. It can show you three databases (every rated game on Lichess, the masters, or one player), filtered by rating band, speed and year, and the masters filtered by era is the best free opening book there is. But the table a club player sees by default is the Lichess database at their own rating, and its top row is the most played move at their level. That row is the move most of us play, because everyone else did. I asked how often it is an inaccuracy.':
    'Lichess 的開局瀏覽器會告訴你，在任一局面下大家接著走了什麼、結果如何。它可以顯示三種資料庫（Lichess 上所有計分對局、大師對局，或某位棋手的對局），並可按分數段、棋速與年份篩選，而按年代篩選的大師資料庫是現有最好的免費開局書。但俱樂部棋手預設看到的表格，是自己分數段的 Lichess 資料庫，最上面一列就是該水準最多人下的著法。那一列是我們大多數人會走的著法，因為別人都這樣走。我想知道：它有多常是一個不精確？',
  'Where "most played" comes from': '「最多人下」是怎麼來的',
  "Then every position went through Stockfish 18 at 20,000,000 nodes with three lines. The most played move is judged against the best move from the same search, by lila's own winning-chance formula, the one that decides what gets a `?!` on a Lichess report. A gap of 0.1 or more is an inaccuracy, 0.2 a mistake, 0.3 a blunder. Every flagged position then got a second 20M search with a different thread count, and 24 of 168 did not survive it; 144 did. That is the same noise floor the [last post](/blog/lichess-analysis-accuracy) found, and it is why one search is never the verdict here.":
    '接著每個局面都用 Stockfish 18 以 20,000,000 節點、三條變例跑過。最多人下的著法，是以同一次搜尋得出的最佳著法為基準來評判，採用 lila 自己的取勝機會公式，也就是決定 Lichess 分析報告上何時標 `?!` 的那個公式。差距 0.1 以上算不精確，0.2 算錯著，0.3 算嚴重錯著。每個被標記的局面再以不同執行緒數做第二次 20M 搜尋，168 個中有 24 個沒能通過；144 個通過了。這正是[上一篇文章](/blog/lichess-analysis-accuracy)發現的同一個雜訊底線，也是為什麼本文從不以單次搜尋作為定論。',
  'For each of the 144 I also pulled the masters database by era (before 2010, 2010 to 2017, since 2018), which is where the shapes come from.':
    '這 144 個局面我也按年代（2010 年之前、2010 到 2017、2018 年起）取了大師資料庫的資料，下面的分類就是從這裡來的。',
  'Four shapes': '四種型態',
  shape: '型態',
  positions: '局面數',
  'what it means': '含意',
  'club only': '只有俱樂部棋手',
  "masters have no games there, or fewer than twenty; the line is the club's alone":
    '大師在此沒有對局，或少於二十局；這條變例是俱樂部棋手獨有的',
  'masters always knew': '大師一直都知道',
  "the masters' top move is the engine's move in every era":
    '大師的首選著法在每個年代都是引擎的著法',
  'masters play a third move': '大師走第三種著法',
  "the masters avoid both the club move and the engine's first choice":
    '大師既不走俱樂部的著法，也不走引擎的首選',
  'masters switched': '大師改弦易轍',
  "the masters' top move became the engine's move in a later era":
    '大師的首選著法在較晚的年代變成了引擎的著法',
  'everyone plays it': '大家都這樣走',
  "the masters' top move is the club move too": '大師的首選著法也是俱樂部的著法',
  "The club's book is mostly a book the masters never opened: 69 positions are gambits and sidelines with no masters games worth counting. Where the masters do play the position, they already agree with the engine in 51 cases, and moved toward it in 8 more. In only four of 144 do masters and club share the mistake. Theory is not lagging the engine much; the club is lagging theory.":
    '俱樂部棋手的開局書，大多是大師從未翻開的一本：69 個局面是棄兵與冷門變例，沒有值得計入的大師對局。在大師確實會下的局面中，有 51 個他們已經和引擎一致，另有 8 個逐漸朝引擎的著法移動。144 個中只有四個是大師與俱樂部棋手共犯同一個錯。理論並沒有落後引擎太多；是俱樂部棋手落後理論。',
  'Ten positions': '十個局面',
  "Each has a board below. The most played move is on the mainline with its mark; the engine's line is the sideline with the numbers; the comment holds the club share and the masters' history. The strips first: how often the club move and the engine move are played, by 1600 to 2200 players and by masters in each era.":
    '每一個下面都有一個棋盤。最多人下的著法在主變例上，並附標記；引擎的變例是帶數字的副變例；註解裡有俱樂部棋手的比例以及大師的歷史選擇。先看長條圖：俱樂部著法與引擎著法分別被 1600 到 2200 分棋手、以及各年代大師走出的頻率。',
  "Rust is the club's favourite, blue the engine's move. Masters cells with fewer than twenty games are left blank.":
    '鏽紅色是俱樂部棋手的最愛，藍色是引擎的著法。大師欄位不足二十局者留空。',
  'For ten opening positions, bars showing how often the club move and the engine move are played by 1600 to 2200 players on Lichess, and by masters before 2010, in 2010 to 2017, and since 2018.':
    '十個開局局面的長條圖，顯示俱樂部著法與引擎著法分別被 Lichess 上 1600 到 2200 分棋手，以及 2010 年之前、2010 到 2017、2018 年起的大師走出的頻率。',
  "**King's Gambit, 2...d6.** After 1.e4 e5 2.f4 d6, 85% of club players play 3.Nf3, and so did half the masters who reached it. At 20M it is −0.67; 3.d3 is +0.25, because after 3.Nf3 exf4 Black takes the pawn and keeps it (the next position in the tree agrees: 44% then play 3...Nc6?! instead of taking). Everyone plays it, and it is the biggest miss on the list by games.":
    '**王翼棄兵，2...d6。**1.e4 e5 2.f4 d6 之後，85% 的俱樂部棋手走 3.Nf3，下到此局面的大師也有半數如此。在 20M 下它是 −0.67；3.d3 是 +0.25，因為 3.Nf3 exf4 之後黑方吃下這個兵並守住它（局面樹的下一個局面也印證了這點：接著有 44% 走 3...Nc6?! 而不吃兵）。大家都這樣走，而以對局數計，這是本清單上最大的一次失誤。',
  "King's Gambit 2...d6: 3.Nf3 is the club move, 3.d3 the engine's":
    '王翼棄兵 2...d6：3.Nf3 是俱樂部的著法，3.d3 是引擎的著法',
  '**Petrov, 3.Bc4.** 1.e4 e5 2.Nf3 Nf6 3.Bc4 reaches ten million club games, and a third of Black players answer 3...Nc6, turning it into a Two Knights. 3...Nxe4 takes the pawn: −0.54 against +0.15. The masters have taken it in every era, seven times in ten.':
    '**彼得羅夫防禦，3.Bc4。**1.e4 e5 2.Nf3 Nf6 3.Bc4 累積了一千萬局俱樂部對局，三分之一的黑方回以 3...Nc6，把它變成兩馬防禦。3...Nxe4 可以吃兵：−0.54 對 +0.15。大師在每個年代都吃了這個兵，十次有七次。',
  'Petrov 3.Bc4: the club plays Nc6, the engine takes on e4':
    '彼得羅夫防禦 3.Bc4：俱樂部棋手走 Nc6，引擎在 e4 吃兵',
  "Four Knights Spanish 4.Nc3: the club plays d6, the engine plays Rubinstein's Nd4":
    '四馬防禦西班牙式 4.Nc3：俱樂部棋手走 d6，引擎走 Rubinstein 的 Nd4',
  '**Vienna Gambit, 3...exf4.** 1.e4 e5 2.Nc3 Nf6 3.f4, and 30% take the pawn. It is +0.63 for White; 3...d5, the move 97% of masters have played in every era, is −0.31. Taking is the natural move and the losing one, which is what the gambit is for.':
    '**維也納棄兵，3...exf4。**1.e4 e5 2.Nc3 Nf6 3.f4，30% 的人吃兵。這是白方 +0.63；而 3...d5，也就是各年代 97% 大師都走的著法，是 −0.31。吃兵是最自然的一著，也是輸掉的一著，而這正是棄兵的用意。',
  "Vienna Gambit: exf4 is the club move, d5 the engine's and the masters'":
    '維也納棄兵：exf4 是俱樂部的著法，d5 是引擎也是大師的著法',
  "**London, 2...g6 3.Nc3.** 1.d4 Nf6 2.Bf4 g6 3.Nc3 and 73% of the club plays 3...Bg7, the move you play in every other London. Here it is +0.62 and 3...d5 is 0.00, because 3.Nc3 is there to play 4.e4, and the bishop move lets it happen while 3...d5 stops it. The masters' share of 3...d5 went 48%, 66%, 77% by era.":
    '**倫敦系統，2...g6 3.Nc3。**1.d4 Nf6 2.Bf4 g6 3.Nc3，73% 的俱樂部棋手走 3...Bg7，那是在其他倫敦系統裡都會走的一著。但在這裡它是 +0.62，而 3...d5 是 0.00，因為 3.Nc3 的用意就是要走 4.e4，象的那一著讓它得以實現，而 3...d5 則阻止了它。大師走 3...d5 的比例按年代依序是 48%、66%、77%。',
  "London 2...g6 3.Nc3: Bg7 is the club move, d5 the engine's":
    '倫敦系統 2...g6 3.Nc3：Bg7 是俱樂部的著法，d5 是引擎的著法',
  '**Scandinavian, 3.Ng5 line.** 1.e4 d5 2.Nf3 dxe4 3.Ng5 Nf6 4.d3 exd3 5.Bxd3, a million club games, and 31% of Black players play 5...h6 to ask the knight. The answer is 6.Nxf7 Kxf7 7.Bg6+ and the queen on d8 goes: +2.70 for White against −1.12 for 5...Nc6. No master has ever been in this position.':
    '**中心兵防禦，3.Ng5 變例。**1.e4 d5 2.Nf3 dxe4 3.Ng5 Nf6 4.d3 exd3 5.Bxd3，一百萬局俱樂部對局，31% 的黑方走 5...h6 來趕馬。回應是 6.Nxf7 Kxf7 7.Bg6+，d8 上的后就沒了：白方 +2.70，對比 5...Nc6 的 −1.12。從來沒有大師身處這個局面。',
  'Scandinavian 3.Ng5 line: 5...h6 is the club move and loses the queen':
    '中心兵防禦 3.Ng5 變例：5...h6 是俱樂部的著法，會丟后',
  "QGA 3.e4 e5: 4.d5 is the club move, 4.Nf3 the engine's and the masters'":
    '接受后翼棄兵 3.e4 e5：4.d5 是俱樂部的著法，4.Nf3 是引擎也是大師的著法',
  'All 144 are in [the study](/study/ibFQtGAL), these ten first, the rest ranked by how many games they touch times how much the move gives up.':
    '全部 144 個都收在[這份研究](/study/ibFQtGAL)裡，這十個排在最前面，其餘按「涉及對局數乘以該著法所損失的幅度」排序。',
  'Reading the explorer': '如何閱讀局面瀏覽器',
  "The most played move in your rating band is the move most people at your rating play, which is not a recommendation, and the explorer never said it was. The filters that fix most of this list are already in the gear menu. Switch to the masters database and set the years to 2018 on, not the all-time table: the masters' book moves, and the all-time table is an average of eras. And when the most played move takes a pawn or declines one, check the engine before trusting the crowd; four of the ten above are a capture or a declined capture.":
    '你所在分數段中最多人下的著法，就是與你同分的人多數會走的著法，這並不是推薦，局面瀏覽器也從未說它是推薦。能修正這份清單上大部分問題的篩選條件，已經在齒輪選單裡了。切換到大師資料庫，並把年份設為 2018 年起，不要用全時期的表格：大師的開局書會移動，而全時期的表格是各年代的平均。此外，當最多人下的著法是吃兵或拒吃時，先查引擎，別輕信群眾；上面十個局面裡有四個是吃子或拒吃。',
  'How this was measured': '測量方式',
  'Open the 144 positions':
    '<a class="cta cta-primary" href="{{ site.embed_origin }}/study/{{ page.study }}">打開這 144 個局面</a>',
  'The deep puzzles':
    '<a class="cta cta-secondary" href="{{ site.embed_origin }}/study/fhC7BCG7">深層排局</a>',
  'Xiangqi for chess players':
    '<a class="cta cta-secondary" href="{{ site.embed_origin }}/rules/xiangqi">給西洋棋棋手的象棋入門</a>',
  // chess960-starting-positions: carried over from the brianhliou.com zh-hans and zh-hant posts (2026-10-15), word for word; links repointed like the English. Strings whose two zh versions were translated separately (ASCII differs) are left out, so the parity check below holds.
  'Chess960 Starting Positions Ranked By Stockfish': 'Stockfish 評出的西洋棋960開局局面排名',
  'Stockfish 18 rankings for all 960 Chess960/Fischer Random starting positions. Most balanced: SP-418 and SP-563; standard chess is near median.':
    'Stockfish 18 對全部 960 個西洋棋960（費舍爾任意制）開局局面的排名。最均衡的是 SP-418 與 SP-563；標準西洋棋接近中位數。',
  'I evaluated all 960 Chess960 starting positions with Stockfish 18 at depth 36. Every one favors White.':
    '我用 Stockfish 18 以深度 36 評估了全部 960 個西洋棋960開局局面。每一個都對白方有利。',
  'The most balanced are SP-418 and SP-563, at +0.07. The most lopsided is SP-783 (QRKNRNBB) at +1.08, the only one over a pawn.':
    '最均衡的是 SP-418 與 SP-563，皆為 +0.07。最失衡的是 SP-783（QRKNRNBB），達 +1.08，是唯一超過一個兵的局面。',
  'Standard chess, SP-518, is +0.31 and ranks 463 of 960: almost exactly the median.':
    '標準西洋棋（SP-518）為 +0.31，在 960 個中排名第 463：幾乎正好是中位數。',
  'None of the 105 starts used in recent elite Freestyle events came from the ten most White-favored. All 960 are in a CSV.':
    '近期頂級 Freestyle 賽事使用的 105 個開局中，沒有一個出自最有利於白方的前十名。全部 960 個都收錄在一份 CSV 中。',
  'I evaluated all 960 **Chess960 starting positions** with Stockfish 18 at uniform depth 36. Chess960 is also called **Fischer Random chess**; each legal back rank is usually identified by a **Scharnagl ID** from 0 to 959.':
    '我用 Stockfish 18 以統一深度 36 評估了全部 960 個**西洋棋960開局局面**。西洋棋960也稱為**費舍爾任意制西洋棋**；每一個合法底線排列通常以 0 到 959 的 **Scharnagl ID** 標示。',
  'Chess960 is the modern tournament name for Fischer Random chess, the variant Bobby Fischer proposed in 1996 to reduce opening memorization and force players back into over-the-board problem solving. The pieces are randomized across 960 legal back-rank layouts while preserving bishops on opposite colors and keeping the king between the rooks so castling still works.':
    '西洋棋960是費舍爾任意制西洋棋在現代賽事中的名稱，這個變體由鮑比·菲舍爾於 1996 年提出，目的是減少開局記憶、迫使棋手回到棋盤前實際解決問題。棋子在 960 種合法底線排列中隨機分佈，同時保持兩個主教位於不同顏色格，並讓王位於兩個城堡之間，使王車易位仍然可行。',
  'Evaluations are white-POV: positive favors White, and **+1.00 is roughly one pawn**.':
    '評估值以白方視角表示：正值對白方有利，而**+1.00 大致相當於一個兵**。',
  Finding: '發現',
  'Evaluation range': '評估值範圍',
  '+0.07 to +1.08': '+0.07 到 +1.08',
  'Black-favored starts': '對黑方有利的開局',
  'Standard chess, SP-518': '標準西洋棋，SP-518',
  'Standard chess rank by balance': '標準西洋棋依均衡度的排名',
  'Starts more balanced than standard chess': '比標準西洋棋更均衡的開局',
  'Move-1 castling best moves': '第 1 著即為王車易位的最佳著法',
  'Recent elite corpus overlap with highlighted starts': '近期頂級賽事棋譜與重點開局的重疊',
  'SP-482, once': 'SP-482，一次',
  "If you want the **most balanced Chess960 starting positions**, the clean candidates are **SP-418, SP-563, SP-269, SP-444, and SP-786**. All evaluate at +0.10 or below, far under standard chess's +0.31.":
    '如果你想找**最均衡的西洋棋960開局局面**，明確的候選是 **SP-418、SP-563、SP-269、SP-444 與 SP-786**。它們的評估值都在 +0.10 以下，遠低於標準西洋棋的 +0.31。',
  'Full dataset: [chess960_starting_position_evals.csv](/article-data/chess960-starting-position-evals.csv) (960 rows).':
    '完整資料集：[chess960_starting_position_evals.csv](/article-data/chess960-starting-position-evals.csv)（960 列）。',
  'How I Evaluated The Chess960 Positions': '我如何評估這些西洋棋960局面',
  'The evaluation contract is deliberately narrow:': '評估條件刻意設得很窄：',
  Parameter: '參數',
  Value: '值',
  Engine: '引擎',
  'Stockfish 18': 'Stockfish 18',
  Depth: '深度',
  MultiPV: 'MultiPV',
  'Chess960 mode': '西洋棋960模式',
  '`UCI_Chess960=true`': '`UCI_Chess960=true`',
  Compute: '運算',
  'Modal, 96 batches × 10 positions': 'Modal，96 批 × 10 個局面',
  Runtime: '執行時間',
  '33 minutes wall, under $3': '實際耗時 33 分鐘，不到 3 美元',
  'Every starting position used the same depth target, so the rankings do not mix shallow and deep engine outputs. The pipeline is the same cloud Stockfish setup described in the [previous post on scaling Stockfish compute](https://brianhliou.com/posts/scaling-stockfish-compute-workloads/).':
    '每個開局局面都用相同的深度目標，因此排名不會混雜淺層與深層的引擎輸出。這套流程與[先前談擴展 Stockfish 運算的文章](https://brianhliou.com/posts/scaling-stockfish-compute-workloads/)中所述的雲端 Stockfish 設定相同。',
  'Quality checks:': '品質檢查：',
  '959/960 reached depth 36; 1 position fell back to depth 35 at the time cap.':
    '959/960 達到深度 36；有 1 個局面在時間上限時退回深度 35。',
  'Median principal-variation length: 36 plies.': '主變著法長度中位數：36 著。',
  'Check against Lichess cache': '與 Lichess 快取的核對',
  'Best-move agreement': '最佳著法一致度',
  'Evaluation correlation': '評估值相關性',
  'Absolute Δcp <= 0.20': '絕對 Δcp <= 0.20',
  'Mean Δcp': '平均 Δcp',
  'The top-10 order moves around between datasets, but the headline does not: standard chess sits near the median, every start favors White at depth 36, and 9 starts have castling as the best first move.':
    '前十名的順序在兩份資料集之間會有變動，但主要結論不變：標準西洋棋位於中位數附近，在深度 36 下每個開局都對白方有利，而有 9 個開局的最佳第一著是王車易位。',
  'Chess960 Evaluation Distribution': '西洋棋960評估值分佈',
  'Most starts land in a narrow white-edge band. The right tail is short: only one start crosses +1.00.':
    '多數開局落在白方小優勢的窄帶內。右尾很短：只有一個開局超過 +1.00。',
  evaluation: '評估值',
  '< 0.00 (black-favored)': '< 0.00（對黑方有利）',
  '0.00 to 0.09': '0.00 到 0.09',
  '0.10 to 0.24': '0.10 到 0.24',
  '0.25 to 0.49': '0.25 到 0.49',
  '0.50 to 0.99': '0.50 到 0.99',
  'Evaluation distribution histogram': '評估值分佈直方圖',
  'At shallower public-cache depth, SP-663 can appear slightly black-favored (-0.10 in the Lichess cache). At depth 36 it evaluates at +0.14. The "black-favored start" result disappears under the uniform deeper search.':
    '在較淺的公開快取深度下，SP-663 可能看起來略微對黑方有利（Lichess 快取中為 -0.10）。在深度 36 時它的評估值是 +0.14。在統一的較深搜尋下，「對黑方有利的開局」這個結果就消失了。',
  'Where Standard Chess Ranks': '標準西洋棋排在哪裡',
  'The default start, **SP-518 (RNBQKBNR)**, evaluates to **+0.31**. It ranks 463/960 by ascending imbalance: almost exactly the median. 462 Chess960 starts are more balanced; 497 are more imbalanced.':
    '預設開局 **SP-518（RNBQKBNR）**的評估值是 **+0.31**。依失衡程度遞增排序，它排在 463/960：幾乎正好是中位數。有 462 個西洋棋960開局更均衡；497 個更失衡。',
  'SP-518: standard chess. +0.31 at depth 36, best move d4.':
    '<figcaption style="font-size: 0.88rem; line-height: 1.35; margin-top: 0.45rem; text-align: center;"><strong>SP-518：標準西洋棋。</strong> 深度 36 時為 +0.31，最佳著法 d4。</figcaption>',
  'SP-518, the standard chess starting position': 'SP-518，標準西洋棋的開局局面',
  'This is a structural result, not a claim about which starting position is better to play. Standard chess is near the middle of the Chess960 balance distribution.':
    '這是一個結構性的結果，並非主張哪個開局局面比較適合下。標準西洋棋位於西洋棋960均衡度分佈的中間附近。',
  'Most Imbalanced Chess960 Start: SP-783': '最失衡的西洋棋960開局：SP-783',
  'One position crosses +1.00: **SP-783 (QRKNRNBB)**, at **+1.08** with best move `b4`. It is the largest opening edge in the full 960-position set.':
    '有一個局面超過 +1.00：**SP-783（QRKNRNBB）**，評估值 **+1.08**，最佳著法為 `b4`。它是全部 960 個局面中開局優勢最大的一個。',
  'SP-783: QRKNRNBB. The most white-favored start at +1.08, best move b4.':
    '<figcaption style="font-size: 0.88rem; line-height: 1.35; margin-top: 0.45rem; text-align: center;"><strong>SP-783：QRKNRNBB。</strong> 最有利於白方的開局，+1.08，最佳著法 b4。</figcaption>',
  'SP-783, the most imbalanced Chess960 starting position': 'SP-783，最失衡的西洋棋960開局局面',
  'Every other starting position lands between +0.07 and +0.92.':
    '其餘所有開局局面都落在 +0.07 到 +0.92 之間。',
  'Most White-Favored Chess960 Starting Positions': '最有利於白方的西洋棋960開局局面',
  'Only one position crosses +1.00. The rest of the top 10 sit between +0.68 and +0.92.':
    '只有一個局面超過 +1.00。前十名中的其餘局面落在 +0.68 到 +0.92 之間。',
  SP: 'SP',
  'back-rank': '底線排列',
  depth: '深度',
  QRKNRNBB: 'QRKNRNBB',
  b4: 'b4',
  QRKRNNBB: 'QRKRNNBB',
  RBQNKRBN: 'RBQNKRBN',
  f4: 'f4',
  QNRKBBRN: 'QNRKBBRN',
  c4: 'c4',
  BBNNRKRQ: 'BBNNRKRQ',
  g3: 'g3',
  QBBRKRNN: 'QBBRKRNN',
  Ng3: 'Ng3',
  QRNNKRBB: 'QRNNKRBB',
  RQKNBBRN: 'RQKNBBRN',
  RNKBNQBR: 'RNKBNQBR',
  e4: 'e4',
  BBNRNKRQ: 'BBNRNKRQ',
  g4: 'g4',
  "Board previews are clickable. The green arrow marks the engine's best first move. Full principal variations are in the CSV.":
    '棋盤預覽可以點擊。綠色箭頭標示引擎的最佳第一著。完整主變著法收錄在 CSV 中。',
  '**SP-783** `QRKNRNBB` · +1.08 · best b4 · 29 plies':
    '**SP-783** `QRKNRNBB` · +1.08 · 最佳著法 b4 · 29 著',
  'SP-783 starting position; SP-783 final position after principal variation':
    'SP-783 的開局局面；SP-783 走完主變著法後的最終局面',
  'Principal variation: `1. b4 b5 2. a4 a5 3. axb5 axb4 4. Qxa8 Rxa8 5. Rxb4 g5 6. g4 Ra1+ 7. Rb1 Rxb1+ 8. Kxb1 Nb7 9. d3 h5 10. gxh5 Ne6 11. Ng3 Nd6 12. c4 Bh7 13. Ne3 Nd4 14. Kc1 f5 15. Kd2`':
    '主變著法：`1. b4 b5 2. a4 a5 3. axb5 axb4 4. Qxa8 Rxa8 5. Rxb4 g5 6. g4 Ra1+ 7. Rb1 Rxb1+ 8. Kxb1 Nb7 9. d3 h5 10. gxh5 Ne6 11. Ng3 Nd6 12. c4 Bh7 13. Ne3 Nd4 14. Kc1 f5 15. Kd2`',
  '**SP-879** `QRKRNNBB` · +0.92 · best b4 · 41 plies':
    '**SP-879** `QRKRNNBB` · +0.92 · 最佳著法 b4 · 41 著',
  'SP-879 starting position; SP-879 final position after principal variation':
    'SP-879 的開局局面；SP-879 走完主變著法後的最終局面',
  'Principal variation: `1. b4 a5 2. a4 f5 3. Nd3 axb4 4. Ne3 d6 5. f4 c5 6. Nxf5 Be6 7. Nxe7+ Kd7 8. Nxc5+ Kxe7 9. Nxe6 Nxe6 10. Bb6 Rdc8 11. Rxb4 Qa6 12. f5 g6 13. Qa2 gxf5 14. g4 f4 15. a5 Nf6 16. Bf3 Bg7 17. c3 Ng5 18. Re1 Nd7 19. h4 Bxc3 20. dxc3 Rxc3+ 21. Kb1`':
    '主變著法：`1. b4 a5 2. a4 f5 3. Nd3 axb4 4. Ne3 d6 5. f4 c5 6. Nxf5 Be6 7. Nxe7+ Kd7 8. Nxc5+ Kxe7 9. Nxe6 Nxe6 10. Bb6 Rdc8 11. Rxb4 Qa6 12. f5 g6 13. Qa2 gxf5 14. g4 f4 15. a5 Nf6 16. Bf3 Bg7 17. c3 Ng5 18. Re1 Nd7 19. h4 Bxc3 20. dxc3 Rxc3+ 21. Kb1`',
  '**SP-604** `RBQNKRBN` · +0.81 · best f4 · 39 plies':
    '**SP-604** `RBQNKRBN` · +0.81 · 最佳著法 f4 · 39 著',
  'SP-604 starting position; SP-604 final position after principal variation':
    'SP-604 的開局局面；SP-604 走完主變著法後的最終局面',
  'Principal variation: `1. f4 c5 2. Ng3 Ne6 3. e3 f6 4. c4 g5 5. Ne2 gxf4 6. exf4 Nd4 7. Nxd4 cxd4 8. Bxd4 Qxc4 9. Qxc4 Bxc4 10. Rf2 Ng6 11. g3 Bb5 12. Ne3 Bc6 13. Bc3 e5 14. fxe5 fxe5 15. Rxf8+ Nxf8 16. Bf5 Bc7 17. O-O-O O-O-O 18. Rf1 Re8 19. Bc2 Ne6 20. Rf7`':
    '主變著法：`1. f4 c5 2. Ng3 Ne6 3. e3 f6 4. c4 g5 5. Ne2 gxf4 6. exf4 Nd4 7. Nxd4 cxd4 8. Bxd4 Qxc4 9. Qxc4 Bxc4 10. Rf2 Ng6 11. g3 Bb5 12. Ne3 Bc6 13. Bc3 e5 14. fxe5 fxe5 15. Rxf8+ Nxf8 16. Bf5 Bc7 17. O-O-O O-O-O 18. Rf1 Re8 19. Bc2 Ne6 20. Rf7`',
  '**SP-298** `QNRKBBRN` · +0.73 · best c4 · 28 plies':
    '**SP-298** `QNRKBBRN` · +0.73 · 最佳著法 c4 · 28 著',
  'SP-298 starting position; SP-298 final position after principal variation':
    'SP-298 的開局局面；SP-298 走完主變著法後的最終局面',
  'Principal variation: `1. c4 f5 2. d4 e6 3. e3 Bh5+ 4. f3 Bf7 5. b3 Be7 6. Bc3 Ng6 7. Nd2 a5 8. f4 O-O 9. Bd3 Ba3 10. Bb2 Bxb2 11. Qxb2 d6 12. g4 Rce8 13. O-O-O a4 14. d5 fxg4`':
    '主變著法：`1. c4 f5 2. d4 e6 3. e3 Bh5+ 4. f3 Bf7 5. b3 Be7 6. Bc3 Ng6 7. Nd2 a5 8. f4 O-O 9. Bd3 Ba3 10. Bb2 Bxb2 11. Qxb2 d6 12. g4 Rce8 13. O-O-O a4 14. d5 fxg4`',
  '**SP-80** `BBNNRKRQ` · +0.73 · best g3 · 39 plies':
    '**SP-80** `BBNNRKRQ` · +0.73 · 最佳著法 g3 · 39 著',
  'SP-80 starting position; SP-80 final position after principal variation':
    'SP-80 的開局局面；SP-80 走完主變著法後的最終局面',
  'Principal variation: `1. g3 c5 2. Nd3 c4 3. Nc5 Nb6 4. b3 d6 5. Ne4 Nc6 6. h4 e6 7. h5 h6 8. Qh4 d5 9. Nec3 a6 10. e4 d4 11. Ne2 g5 12. hxg6 fxg6 13. Bb2 Bd6 14. e5 Bxe5 15. c3 d3 16. Nd4 Qf6 17. Nxc6 bxc6 18. Ba3+ Kf7 19. Nb2 c5 20. Qxf6+`':
    '主變著法：`1. g3 c5 2. Nd3 c4 3. Nc5 Nb6 4. b3 d6 5. Ne4 Nc6 6. h4 e6 7. h5 h6 8. Qh4 d5 9. Nec3 a6 10. e4 d4 11. Ne2 g5 12. hxg6 fxg6 13. Bb2 Bd6 14. e5 Bxe5 15. c3 d3 16. Nd4 Qf6 17. Nxc6 bxc6 18. Ba3+ Kf7 19. Nb2 c5 20. Qxf6+`',
  '**SP-868** `QBBRKRNN` · +0.70 · best Ng3 · 39 plies':
    '**SP-868** `QBBRKRNN` · +0.70 · 最佳著法 Ng3 · 39 著',
  'SP-868 starting position; SP-868 final position after principal variation':
    'SP-868 的開局局面；SP-868 走完主變著法後的最終局面',
  'Principal variation: `1. Ng3 d5 2. Nh5 f6 3. Nxg7+ Kf7 4. Nh5 Ng6 5. d4 Nh4 6. f3 Nxg2+ 7. Kf2 Nh4 8. c4 dxc4 9. b3 c5 10. Bxh7 cxd4 11. Qb1 d3 12. bxc4 Bd6 13. exd3 Bf5 14. Bxf5 Nxf5 15. Ng3 Nd4 16. N1e2 Bc5 17. Be3 Qc8 18. Bxd4 Bxd4+ 19. Kg2 Nh6 20. Rh1`':
    '主變著法：`1. Ng3 d5 2. Nh5 f6 3. Nxg7+ Kf7 4. Nh5 Ng6 5. d4 Nh4 6. f3 Nxg2+ 7. Kf2 Nh4 8. c4 dxc4 9. b3 c5 10. Bxh7 cxd4 11. Qb1 d3 12. bxc4 Bd6 13. exd3 Bf5 14. Bxf5 Nxf5 15. Ng3 Nd4 16. N1e2 Bc5 17. Be3 Qc8 18. Bxd4 Bxd4+ 19. Kg2 Nh6 20. Rh1`',
  '**SP-399** `QRNNKRBB` · +0.70 · best b4 · 34 plies':
    '**SP-399** `QRNNKRBB` · +0.70 · 最佳著法 b4 · 34 著',
  'SP-399 starting position; SP-399 final position after principal variation':
    'SP-399 的開局局面；SP-399 走完主變著法後的最終局面',
  'Principal variation: `1. b4 h6 2. f4 Bh7 3. Nc3 g5 4. f5 b6 5. Nb3 Nd6 6. Bd4 Bxd4 7. Nxd4 f6 8. d3 c6 9. a4 Qb7 10. Kd2 O-O 11. g4 Kg7 12. h4 Qc7 13. hxg5 hxg5 14. b5 Bg8 15. bxc6 dxc6 16. Ne4 Nxe4+ 17. Bxe4 Qd6`':
    '主變著法：`1. b4 h6 2. f4 Bh7 3. Nc3 g5 4. f5 b6 5. Nb3 Nd6 6. Bd4 Bxd4 7. Nxd4 f6 8. d3 c6 9. a4 Qb7 10. Kd2 O-O 11. g4 Kg7 12. h4 Qc7 13. hxg5 hxg5 14. b5 Bg8 15. bxc6 dxc6 16. Ne4 Nxe4+ 17. Bxe4 Qd6`',
  '**SP-794** `RQKNBBRN` · +0.68 · best f4 · 35 plies':
    '**SP-794** `RQKNBBRN` · +0.68 · 最佳著法 f4 · 35 著',
  'SP-794 starting position; SP-794 final position after principal variation':
    'SP-794 的開局局面；SP-794 走完主變著法後的最終局面',
  'Principal variation: `1. f4 c6 2. e3 f5 3. c4 g5 4. Qxf5 gxf4 5. Qxf4 Qxf4 6. exf4 Ne6 7. f5 Nd4 8. Ng3 Nf7 9. Bf2 Bg7 10. Nc3 Nh6 11. Bd3 Rf8 12. O-O Ndxf5 13. Nxf5 Nxf5 14. Rae1 Bg6 15. Bxf5 Rxf5 16. Rxe7 Bxc3 17. dxc3 b6 18. Ree1`':
    '主變著法：`1. f4 c6 2. e3 f5 3. c4 g5 4. Qxf5 gxf4 5. Qxf4 Qxf4 6. exf4 Ne6 7. f5 Nd4 8. Ng3 Nf7 9. Bf2 Bg7 10. Nc3 Nh6 11. Bd3 Rf8 12. O-O Ndxf5 13. Nxf5 Nxf5 14. Rae1 Bg6 15. Bxf5 Rxf5 16. Rxe7 Bxc3 17. dxc3 b6 18. Ree1`',
  '**SP-557** `RNKBNQBR` · +0.68 · best e4 · 32 plies':
    '**SP-557** `RNKBNQBR` · +0.68 · 最佳著法 e4 · 32 著',
  'SP-557 starting position; SP-557 final position after principal variation':
    'SP-557 的開局局面；SP-557 走完主變著法後的最終局面',
  'Principal variation: `1. e4 e5 2. f4 exf4 3. Nc3 f5 4. Qxf4 Be6 5. e5 g5 6. Qe3 Nc6 7. d4 d5 8. h4 h6 9. Qf3 gxh4 10. Nd3 Ng7 11. Nf4 Bg5 12. Ne2 O-O-O 13. Kb1 Bf7 14. Bf2 Ne6 15. Nxe6 Bxe6 16. Nf4 Bf7`':
    '主變著法：`1. e4 e5 2. f4 exf4 3. Nc3 f5 4. Qxf4 Be6 5. e5 g5 6. Qe3 Nc6 7. d4 d5 8. h4 h6 9. Qf3 gxh4 10. Nd3 Ng7 11. Nf4 Bg5 12. Ne2 O-O-O 13. Kb1 Bf7 14. Bf2 Ne6 15. Nxe6 Bxe6 16. Nf4 Bf7`',
  '**SP-176** `BBNRNKRQ` · +0.68 · best g4 · 36 plies':
    '**SP-176** `BBNRNKRQ` · +0.68 · 最佳著法 g4 · 36 著',
  'SP-176 starting position; SP-176 final position after principal variation':
    'SP-176 的開局局面；SP-176 走完主變著法後的最終局面',
  'Principal variation: `1. g4 c5 2. b3 Nc7 3. c4 b6 4. Be4 Bxe4 5. Qxe4 Nd6 6. Qf3 h6 7. e3 Qh7 8. Ne2 Ne6 9. Be5 O-O 10. Bxd6 Bxd6 11. h4 f5 12. g5 hxg5 13. hxg5 f4 14. e4 Qg6 15. d3 Bb8 16. d4 cxd4 17. Nxd4 Nxd4 18. Rxd4 Be5`':
    '主變著法：`1. g4 c5 2. b3 Nc7 3. c4 b6 4. Be4 Bxe4 5. Qxe4 Nd6 6. Qf3 h6 7. e3 Qh7 8. Ne2 Ne6 9. Be5 O-O 10. Bxd6 Bxd6 11. h4 f5 12. g5 hxg5 13. hxg5 f4 14. e4 Qg6 15. d3 Bb8 16. d4 cxd4 17. Nxd4 Nxd4 18. Rxd4 Be5`',
  'Most Balanced Chess960 Starting Positions': '最均衡的西洋棋960開局局面',
  "These are the starts where the position itself contributes the least white edge. All are +0.12 or below, far under standard chess's +0.31.":
    '這些是局面本身給白方的優勢最小的開局。全部都在 +0.12 以下，遠低於標準西洋棋的 +0.31。',
  BRNQNBKR: 'BRNQNBKR',
  BRNKNRQB: 'BRNKNRQB',
  NRKBNQBR: 'NRKBNQBR',
  Nb3: 'Nb3',
  RBNNQKBR: 'RBNNQKBR',
  d4: 'd4',
  BRQKNBRN: 'BRQKNBRN',
  NQNBRKBR: 'NQNBRKBR',
  BQRNKBNR: 'BQRNKBNR',
  e3: 'e3',
  RKQNNRBB: 'RKQNNRBB',
  NNBBRKRQ: 'NNBBRKRQ',
  d3: 'd3',
  NQBRNKRB: 'NQBRNKRB',
  '**SP-418** `BRNQNBKR` · +0.07 · best b4 · 32 plies':
    '**SP-418** `BRNQNBKR` · +0.07 · 最佳著法 b4 · 32 著',
  'SP-418 starting position; SP-418 final position after principal variation':
    'SP-418 的開局局面；SP-418 走完主變著法後的最終局面',
  'Principal variation: `1. b4 b5 2. e3 e6 3. Be2 Be7 4. O-O O-O 5. d3 a6 6. Qd2 d6 7. Nb3 c5 8. bxc5 dxc5 9. Nf3 Nb6 10. c4 Nd7 11. Ne5 Nef6 12. Qa5 Bd6 13. Qxd8 Rfxd8 14. Nxd7 Nxd7 15. cxb5 axb5 16. Rfc1 Rdc8`':
    '主變著法：`1. b4 b5 2. e3 e6 3. Be2 Be7 4. O-O O-O 5. d3 a6 6. Qd2 d6 7. Nb3 c5 8. bxc5 dxc5 9. Nf3 Nb6 10. c4 Nd7 11. Ne5 Nef6 12. Qa5 Bd6 13. Qxd8 Rfxd8 14. Nxd7 Nxd7 15. cxb5 axb5 16. Rfc1 Rdc8`',
  '**SP-563** `BRNKNRQB` · +0.07 · best g4 · 40 plies':
    '**SP-563** `BRNKNRQB` · +0.07 · 最佳著法 g4 · 40 著',
  'SP-563 starting position; SP-563 final position after principal variation':
    'SP-563 的開局局面；SP-563 走完主變著法後的最終局面',
  'Principal variation: `1. g4 g5 2. Ncd3 a5 3. b3 Bxa1 4. Rxa1 b6 5. h4 h6 6. Bxa8 Rxa8 7. a4 f6 8. f4 gxf4 9. Nxf4 e5 10. Nh5 Ne7 11. Qg2 c6 12. Nd3 Qe6 13. Kc1 Kc7 14. e4 Rg8 15. Nf2 d5 16. Kb2 Nd6 17. Qf3 Raf8 18. d3 d4 19. Ng3 b5 20. Nf5 bxa4`':
    '主變著法：`1. g4 g5 2. Ncd3 a5 3. b3 Bxa1 4. Rxa1 b6 5. h4 h6 6. Bxa8 Rxa8 7. a4 f6 8. f4 gxf4 9. Nxf4 e5 10. Nh5 Ne7 11. Qg2 c6 12. Nd3 Qe6 13. Kc1 Kc7 14. e4 Rg8 15. Nf2 d5 16. Kb2 Nd6 17. Qf3 Raf8 18. d3 d4 19. Ng3 b5 20. Nf5 bxa4`',
  '**SP-269** `NRKBNQBR` · +0.09 · best Nb3 · 38 plies':
    '**SP-269** `NRKBNQBR` · +0.09 · 最佳著法 Nb3 · 38 著',
  'SP-269 starting position; SP-269 final position after principal variation':
    'SP-269 的開局局面；SP-269 走完主變著法後的最終局面',
  'Principal variation: `1. Nb3 f5 2. f4 Nb6 3. d3 c6 4. c3 d6 5. Nd2 Bc7 6. Nef3 Nf6 7. e4 fxe4 8. dxe4 e5 9. fxe5 dxe5 10. b4 Nbd7 11. Bb3 Bb6 12. Qd1 Bxg1 13. Qxg1 a5 14. Bxg8 Qxg8 15. Qa7 Qxa2 16. O-O O-O 17. bxa5 Ra8 18. Qxb7 Qxa5 19. Qb3+ Kh8`':
    '主變著法：`1. Nb3 f5 2. f4 Nb6 3. d3 c6 4. c3 d6 5. Nd2 Bc7 6. Nef3 Nf6 7. e4 fxe4 8. dxe4 e5 9. fxe5 dxe5 10. b4 Nbd7 11. Bb3 Bb6 12. Qd1 Bxg1 13. Qxg1 a5 14. Bxg8 Qxg8 15. Qa7 Qxa2 16. O-O O-O 17. bxa5 Ra8 18. Qxb7 Qxa5 19. Qb3+ Kh8`',
  '**SP-444** `RBNNQKBR` · +0.10 · best d4 · 33 plies':
    '**SP-444** `RBNNQKBR` · +0.10 · 最佳著法 d4 · 33 著',
  'SP-444 starting position; SP-444 final position after principal variation':
    'SP-444 的開局局面；SP-444 走完主變著法後的最終局面',
  'Principal variation: `1. d4 f6 2. f3 Bf7 3. e4 c6 4. Bf2 O-O 5. a4 a5 6. O-O e5 7. dxe5 fxe5 8. Ne3 Ne7 9. Qd2 Ne6 10. Ne2 d6 11. Kh1 Nc5 12. Ng4 Ng6 13. Ng3 Bc7 14. Nf5 Rd8 15. Bxc5 dxc5 16. Qc3 c4 17. Ba2`':
    '主變著法：`1. d4 f6 2. f3 Bf7 3. e4 c6 4. Bf2 O-O 5. a4 a5 6. O-O e5 7. dxe5 fxe5 8. Ne3 Ne7 9. Qd2 Ne6 10. Ne2 d6 11. Kh1 Nc5 12. Ng4 Ng6 13. Ng3 Bc7 14. Nf5 Rd8 15. Bxc5 dxc5 16. Qc3 c4 17. Ba2`',
  '**SP-786** `BRQKNBRN` · +0.10 · best c4 · 31 plies':
    '**SP-786** `BRQKNBRN` · +0.10 · 最佳著法 c4 · 31 著',
  'SP-786 starting position; SP-786 final position after principal variation':
    'SP-786 的開局局面；SP-786 走完主變著法後的最終局面',
  'Principal variation: `1. c4 e6 2. f4 b5 3. c5 a5 4. b3 d6 5. Nd3 Ng6 6. e3 Be7 7. Be2 Nf6 8. cxd6 cxd6 9. Qxc8+ Rxc8 10. g3 Nd5 11. Nhf2 Bf6 12. a3 O-O 13. Bxf6 Nxf6 14. Nb2 Bd5 15. Bxb5 Bxb3+ 16. Ke2`':
    '主變著法：`1. c4 e6 2. f4 b5 3. c5 a5 4. b3 d6 5. Nd3 Ng6 6. e3 Be7 7. Be2 Nf6 8. cxd6 cxd6 9. Qxc8+ Rxc8 10. g3 Nd5 11. Nhf2 Bf6 12. a3 O-O 13. Bxf6 Nxf6 14. Nb2 Bd5 15. Bxb5 Bxb3+ 16. Ke2`',
  '**SP-29** `NQNBRKBR` · +0.11 · best c4 · 31 plies':
    '**SP-29** `NQNBRKBR` · +0.11 · 最佳著法 c4 · 31 著',
  'SP-29 starting position; SP-29 final position after principal variation':
    'SP-29 的開局局面；SP-29 走完主變著法後的最終局面',
  'Principal variation: `1. c4 e5 2. f3 c6 3. b4 f6 4. Bb3 Bf7 5. Bf2 O-O 6. O-O d5 7. cxd5 cxd5 8. a4 Bb6 9. e3 Ne7 10. Nc2 Kh8 11. Qa2 a5 12. d4 Bc7 13. dxe5 Bxe5 14. Kh1 Nb6 15. Ne2 Nc4 16. bxa5`':
    '主變著法：`1. c4 e5 2. f3 c6 3. b4 f6 4. Bb3 Bf7 5. Bf2 O-O 6. O-O d5 7. cxd5 cxd5 8. a4 Bb6 9. e3 Ne7 10. Nc2 Kh8 11. Qa2 a5 12. d4 Bc7 13. dxe5 Bxe5 14. Kh1 Nb6 15. Ne2 Nc4 16. bxa5`',
  '**SP-482** `BQRNKBNR` · +0.11 · best e3 · 32 plies · elite match':
    '**SP-482** `BQRNKBNR` · +0.11 · 最佳著法 e3 · 32 著 · 頂級對局',
  'SP-482 starting position; SP-482 final position after principal variation':
    'SP-482 的開局局面；SP-482 走完主變著法後的最終局面',
  'Principal variation: `1. e3 e6 2. b4 f5 3. f4 Nf6 4. Nf3 Be7 5. c4 b6 6. Be2 Nf7 7. Nf2 c5 8. bxc5 bxc5 9. Qc2 Rg8 10. h4 Bc6 11. Rb1 Qa8 12. Bc3 Nh5 13. d3 Ng3 14. Rh3 Nxe2 15. Kxe2 Rb8 16. Rxb8+ Qxb8`':
    '主變著法：`1. e3 e6 2. b4 f5 3. f4 Nf6 4. Nf3 Be7 5. c4 b6 6. Be2 Nf7 7. Nf2 c5 8. bxc5 bxc5 9. Qc2 Rg8 10. h4 Bc6 11. Rb1 Qa8 12. Bc3 Nh5 13. d3 Ng3 14. Rh3 Nxe2 15. Kxe2 Rb8 16. Rxb8+ Qxb8`',
  '**SP-719** `RKQNNRBB` · +0.11 · best f4 · 43 plies':
    '**SP-719** `RKQNNRBB` · +0.11 · 最佳著法 f4 · 43 著',
  'SP-719 starting position; SP-719 final position after principal variation':
    'SP-719 的開局局面；SP-719 走完主變著法後的最終局面',
  'Principal variation: `1. f4 f5 2. g3 g6 3. d3 d6 4. c4 c5 5. Nc3 Nc6 6. Qd2 Qd7 7. Nc2 Nc7 8. b3 Bf7 9. O-O-O Ne6 10. e3 O-O 11. d4 Nb4 12. Nxb4 cxb4 13. Nd5 Nc7 14. Nxc7 Qxc7 15. Qxb4 Rfb8 16. Qc3 a5 17. a4 d5 18. Kd2 dxc4 19. bxc4 Qxc4 20. Qxc4 Bxc4 21. Rfe1 Ra7 22. Rb1`':
    '主變著法：`1. f4 f5 2. g3 g6 3. d3 d6 4. c4 c5 5. Nc3 Nc6 6. Qd2 Qd7 7. Nc2 Nc7 8. b3 Bf7 9. O-O-O Ne6 10. e3 O-O 11. d4 Nb4 12. Nxb4 cxb4 13. Nd5 Nc7 14. Nxc7 Qxc7 15. Qxb4 Rfb8 16. Qc3 a5 17. a4 d5 18. Kd2 dxc4 19. bxc4 Qxc4 20. Qxc4 Bxc4 21. Rfe1 Ra7 22. Rb1`',
  '**SP-85** `NNBBRKRQ` · +0.12 · best d3 · 25 plies':
    '**SP-85** `NNBBRKRQ` · +0.12 · 最佳著法 d3 · 25 著',
  'SP-85 starting position; SP-85 final position after principal variation':
    'SP-85 的開局局面；SP-85 走完主變著法後的最終局面',
  'Principal variation: `1. d3 e5 2. h4 d6 3. Nb3 h5 4. g3 Nb6 5. e4 Nc6 6. Bd2 g6 7. Bf3 Bf6 8. Nc3 Bd7 9. Bg2 O-O-O 10. a4 Be6 11. Bh3 Nd7 12. Nd5 g5 13. Nxf6`':
    '主變著法：`1. d3 e5 2. h4 d6 3. Nb3 h5 4. g3 Nb6 5. e4 Nc6 6. Bd2 g6 7. Bf3 Bf6 8. Nc3 Bd7 9. Bg2 O-O-O 10. a4 Be6 11. Bh3 Nd7 12. Nd5 g5 13. Nxf6`',
  '**SP-119** `NQBRNKRB` · +0.12 · best c4 · 31 plies':
    '**SP-119** `NQBRNKRB` · +0.12 · 最佳著法 c4 · 31 著',
  'SP-119 starting position; SP-119 final position after principal variation':
    'SP-119 的開局局面；SP-119 走完主變著法後的最終局面',
  'Principal variation: `1. c4 g6 2. d4 c6 3. O-O d5 4. cxd5 cxd5 5. Nac2 Bf5 6. g3 Nac7 7. Bg2 Bg7 8. a4 Nd6 9. Qa2 O-O 10. Ne3 Be6 11. b3 b5 12. Nd3 Ne4 13. Bb2 b4 14. Qa1 Bh6 15. f4 a5 16. Nc5`':
    '主變著法：`1. c4 g6 2. d4 c6 3. O-O d5 4. cxd5 cxd5 5. Nac2 Bf5 6. g3 Nac7 7. Bg2 Bg7 8. a4 Nd6 9. Qa2 O-O 10. Ne3 Be6 11. b3 b5 12. Nd3 Ne4 13. Bb2 b4 14. Qa1 Bh6 15. f4 a5 16. Nc5`',
  'Best First Moves In Chess960': '西洋棋960中的最佳第一著',
  "Across all 960 starts, **94.9%** have a pawn move as Stockfish's best first move. `e4` and `d4` are still the most common, but they cover only 36% of the field. The Chess960-specific signal is flank activity: `f4`, `b4`, and `g4` combine for 27.3%.":
    '在全部 960 個開局中，有 **94.9%** 的 Stockfish 最佳第一著是兵的走法。`e4` 與 `d4` 依然最常見，但只佔全體的 36%。西洋棋960特有的訊號是側翼活動：`f4`、`b4` 與 `g4` 合計佔 27.3%。',
  '%': '%',
  a4: 'a4',
  'Piece-move and move-1 castling details': '<summary>棋子走法與第 1 著王車易位的細節</summary>',
  'Piece moves account for 49 positions, or 5.1% of the field. Knights account for 40 of them. The other 9 are legal move-1 castles.':
    '棋子走法佔 49 個局面，即全體的 5.1%。其中 40 個是騎士。其餘 9 個是合法的第 1 著王車易位。',
  'Origin to dest': '起點到終點',
  '`Ng3`': 'Ng3',
  'h1 to g3': 'h1 到 g3',
  '`O-O`': '`O-O`',
  'f1 to g1': 'f1 到 g1',
  '`Nc3`': '`Nc3`',
  'b1 to c3': 'b1 到 c3',
  '`Nb3`': 'Nb3',
  'a1 to b3': 'a1 到 b3',
  '`Nf3`': '`Nf3`',
  'g1 to f3': 'g1 到 f3',
  '`Nh3`': '`Nh3`',
  'g1 to h3': 'g1 到 h3',
  '`Nde3`': '`Nde3`',
  'd1 to e3': 'd1 到 e3',
  '`Ncd3`': '`Ncd3`',
  'c1 to d3': 'c1 到 d3',
  'The 9 move-1 castling starts all place the king on `f1` and the kingside rook on `g1`: SP-296 (+0.20), SP-308 (+0.35), SP-312 (+0.37), SP-324 (+0.22), SP-407 (+0.16), SP-580 (+0.26), SP-585 (+0.26), SP-596 (+0.22), and SP-612 (+0.40).':
    '這 9 個第 1 著即王車易位的開局，都把王放在 `f1`、王翼城堡放在 `g1`：SP-296（+0.20）、SP-308（+0.35）、SP-312（+0.37）、SP-324（+0.22）、SP-407（+0.16）、SP-580（+0.26）、SP-585（+0.26）、SP-596（+0.22）與 SP-612（+0.40）。 </details>',
  'What Recent Elite Chess960 Actually Picked': '近期頂級西洋棋960實際選了哪些開局',
  'I mapped recent elite Freestyle broadcast PGNs back to Scharnagl IDs using the starting FEN. This avoids relying on the PGN `Variant` tag: some 2025 Freestyle broadcasts are labeled `Variant "Standard"` even though the FEN is a Chess960 start.':
    '我利用起始 FEN，把近期頂級 Freestyle 賽事轉播的 PGN 對應回 Scharnagl ID。這樣就不必依賴 PGN 的 `Variant` 標籤：有些 2025 年的 Freestyle 轉播標成 `Variant "Standard"`，即使其 FEN 其實是西洋棋960的開局。',
  'The modern elite corpus:': '現代頂級賽事棋譜集：',
  Games: '對局數',
  'unique SPs': '不同的 SP 數',
  '**Total**': '**總計**',
  'The most repeated starts are mostly tournament-format artifacts: paired games, rematches, and bracket mini-matches reuse the same position.':
    '重複次數最多的開局，多半是賽制造成的現象：成對對局、重賽以及淘汰賽的小型對抗賽都會重複使用同一個局面。',
  eval: '評估值',
  'appeared in': '出現於',
  '`RBKNQRBN`': '`RBKNQRBN`',
  '`RNKNRQBB`': '`RNKNRQBB`',
  'Las Vegas': '拉斯維加斯',
  '`QRKBNNBR`': '`QRKBNNBR`',
  '`BBQNRNKR`': '`BBQNRNKR`',
  '`NRKBQNBR`': '`NRKBQNBR`',
  '`RQBNKNRB`': '`RQBNKNRB`',
  '`RBNQKNBR`': '`RBNQKNBR`',
  '`RNBBKNQR`': '`RNBBKNQR`',
  'All selected Scharnagl IDs by event': '<summary>各賽事所選用的全部 Scharnagl ID</summary>',
  'SPs used': '<th>使用的 SP</th>',
  'Overlap with the highlighted sets:': '與重點開局集合的重疊：',
  'Highlight set': '重點集合',
  'Matches in the 426-game corpus': '在 426 局棋譜集中的符合數',
  'Top 10 most white-favored': '最有利於白方的前十名',
  none: '無',
  'Top 10 most equal': '最均衡的前十名',
  'The only highlighted start that appeared was neutral, not extreme: **SP-482 (BQRNKBNR) evaluates at +0.11** and appeared once in Las Vegas.':
    '唯一出現過的重點開局是中性的，而非極端的：**SP-482（BQRNKBNR）的評估值為 +0.11**，在拉斯維加斯出現過一次。',
  Field: '欄位',
  '`BQRNKBNR`': 'BQRNKBNR',
  game: '對局',
  'Magnus Carlsen vs Levon Aronian': 'Magnus Carlsen 對 Levon Aronian',
  result: '結果',
  round: '輪次',
  broadcast: '轉播',
  '[Las Vegas round-robin white tiebreak, game 1](https://lichess.org/broadcast/freestyle-chess-grand-slam-las-vegas--round-robin-white/tiebreak--game-1/nhVdjSZB)':
    '[拉斯維加斯循環賽白組加賽，第 1 局](https://lichess.org/broadcast/freestyle-chess-grand-slam-las-vegas--round-robin-white/tiebreak--game-1/nhVdjSZB)',
  'Critical position after 20...d5. White to move. Lichess marks 21.c5? as the mistake; 21.cxd5 was best. Green arrow: best capture. Gray arrow: game move.':
    '<figcaption><strong>20...d5 之後的關鍵局面。</strong> 白方走。Lichess 標記 21.c5? 為失誤；21.cxd5 才是最佳著法。綠色箭頭：最佳吃子。灰色箭頭：實戰著法。</figcaption>',
  'Critical midgame position after 20...d5 in Magnus Carlsen vs Levon Aronian, SP-482':
    'Magnus Carlsen 對 Levon Aronian（SP-482）在 20...d5 之後的關鍵中局局面',
  'The game result is not meaningful by itself. The selection result is: among 105 unique modern elite starts, none came from the top-10 white-favored list.':
    '對局結果本身沒有什麼意義。有意義的是選擇結果：在 105 個不同的現代頂級開局中，沒有一個出自最有利於白方的前十名。',
  'Any start in the CSV opens on a Chess960 analysis board: [SP-418](https://lichess.org/analysis/chess960/brnqnbkr/pppppppp/8/8/8/8/PPPPPPPP/BRNQNBKR_w_KQkq_-_0_1) for one of the most balanced starts, [SP-783](https://lichess.org/analysis/chess960/qrknrnbb/pppppppp/8/8/8/8/PPPPPPPP/QRKNRNBB_w_KQkq_-_0_1) for the most white-favored.':
    'CSV 中的任何開局都能在西洋棋960分析棋盤上開啟：[SP-418](https://lichess.org/analysis/chess960/brnqnbkr/pppppppp/8/8/8/8/PPPPPPPP/BRNQNBKR_w_KQkq_-_0_1) 是最均衡的開局之一，[SP-783](https://lichess.org/analysis/chess960/qrknrnbb/pppppppp/8/8/8/8/PPPPPPPP/QRKNRNBB_w_KQkq_-_0_1) 則是最有利於白方的開局。',
  Reproducibility: '可重現性',
  'Quick Answers': '快速問答',
  'What is the most balanced Chess960 starting position?':
    '**最均衡的西洋棋960開局局面是哪一個？**',
  'SP-418 (BRNQNBKR) and SP-563 (BRNKNRQB) are the most balanced in this run. Both evaluate at +0.07 for White.':
    '在這次執行中，SP-418（BRNQNBKR）與 SP-563（BRNKNRQB）最均衡。兩者的白方評估值皆為 +0.07。',
  'What is the most imbalanced Chess960 starting position?':
    '**最失衡的西洋棋960開局局面是哪一個？**',
  'SP-783 (QRKNRNBB) is the most white-favored start at +1.08.':
    'SP-783（QRKNRNBB）是最有利於白方的開局，評估值 +1.08。',
  'Is standard chess balanced compared to Chess960?': '**和西洋棋960相比，標準西洋棋算均衡嗎？**',
  'Standard chess, SP-518 (RNBQKBNR), evaluates at +0.31 and ranks 463/960 by balance. It is almost exactly median.':
    '標準西洋棋 SP-518（RNBQKBNR）的評估值是 +0.31，依均衡度排名 463/960。幾乎正好是中位數。',
  'Are any Chess960 starts better for Black?': '**有任何西洋棋960開局對黑方更有利嗎？**',
  'Not at Stockfish 18 depth 36. All 960 starts evaluate as White-favored.':
    '在 Stockfish 18 深度 36 下沒有。全部 960 個開局的評估值都對白方有利。',
  'Further Reading': '延伸閱讀',
  "[Scaling Parallel Stockfish Analysis](https://brianhliou.com/posts/scaling-stockfish-compute-workloads/): methodology for running Stockfish at scale on cloud CPU workers, written for the case where the cache doesn't have the answer.":
    '[擴展平行 Stockfish 分析](https://brianhliou.com/posts/scaling-stockfish-compute-workloads/)：在雲端 CPU 工作節點上大規模執行 Stockfish 的方法論，針對快取*沒有*答案的情況而寫。',
  '[Mistboard](/): free online Chinese chess in English, which also hosts open-source Fog of War chess. Its Chess960 pregame (Draft960) was retired in September 2026.':
    '[Mistboard](/)：免費的英文介面線上象棋，同時也提供開源的迷霧西洋棋。其西洋棋960賽前選項（Draft960）已於 2026 年 9 月下線。',
  Dataset: '資料集',
  '[Download the full CSV](/article-data/chess960-starting-position-evals.csv) (960 rows). Columns: `scharnagl_id`, `back_rank`, `fen`, `position_key`, `cp`, `mate`, `best_move`, `pv`, `depth`, `nodes`, `source`, `fetched_at_iso`.':
    '[下載完整 CSV](/article-data/chess960-starting-position-evals.csv)（960 列）。欄位：`scharnagl_id`、`back_rank`、`fen`、`position_key`、`cp`、`mate`、`best_move`、`pv`、`depth`、`nodes`、`source`、`fetched_at_iso`。',
  // en-passant-under-fog: restored 2026-10-24, not native-reviewed; the rest of the 10-15 carry-over above: 6 strings reused from the brianhliou.com zh-hans and zh-hant posts (where their two versions differed in ASCII, harmonised to the current English), 15 machine-drafted for text the move changed or added.
  'An En Passant Bug Under Fog': '迷霧下的一個吃過路兵錯誤',
  'In [fog of war chess](/rules/fog-chess) you may leave your king attacked, so a pawn can take en passant in positions where standard chess forbids it. And since you see every square your pieces can move to, whether that capture exists changes what you see: a pawn that can take en passant sees the landing square and the pawn it would take.':
    '在[迷霧戰爭西洋棋](/rules/fog-chess)中，你可以讓自己的王留在被攻擊的狀態，所以在標準西洋棋禁止吃過路兵的局面裡，兵也能吃過路兵。而且你看得見自己棋子能走到的每一個格子，所以這個吃子是否存在，會改變你看到的東西：能吃過路兵的兵看得見落子的格子，也看得見它將要吃掉的那個兵。',
  '[Misty](/blog/misty) plays fog of war chess by holding `P`, the set of every board consistent with what it has observed, stored as FEN strings. It wrote the en passant field of those strings by the standard chess rule, and in one game that dropped the real board out of `P`.':
    '[Misty](/blog/misty) 下迷霧戰爭西洋棋的方式是持有 `P`，也就是所有與它已觀察到的資訊一致的棋盤集合，以 FEN 字串儲存。它依標準西洋棋的規則寫出這些字串中的吃過路兵欄位，而在一盤棋中，這讓真實棋盤從 `P` 中掉了出去。',
  'Misty recorded the en passant square by standard chess rules':
    'Misty 依標準西洋棋規則記錄吃過路兵的目標格',
  "`python-chess` writes the en passant field with `EnPassantMode.LEGAL` by default: it records the square only when the capture is legal in standard chess, and that includes not leaving the capturing side's king in check. Misty's Rust hot path copied the same filter on purpose, so its strings would match python-chess byte for byte.":
    '`python-chess` 預設以 `EnPassantMode.LEGAL` 寫出吃過路兵欄位：只有在該吃子於標準西洋棋中合法時才記下那個格子，其中包括不讓吃子一方的王處於被將軍的狀態。Misty 的 Rust 熱路徑刻意複製了同樣的過濾條件，好讓它的字串與 python-chess 逐位元組一致。',
  "So the square went missing in one kind of position: a pawn has just moved two squares to stand beside an enemy pawn, and taking it en passant would leave the capturer's king attacked, as it does when that king is already in check. With the square gone, the rebuilt position no longer sees the landing square or the pawn it could take, so the real board stops matching what Misty observed and drops out of `P`. The trigger came up 1 ply in 12,866, in 1 of 273 finished games.":
    '所以那個格子會在一種局面中遺失：一個兵剛走了兩格，停在敵方兵的旁邊，而吃過路兵會讓吃子一方的王處於被攻擊的狀態，例如那個王本來就正被將軍時。格子一遺失，重建出來的局面就看不見落子的格子，也看不見它可以吃的那個兵，於是真實棋盤不再與 Misty 所見相符，從 `P` 中掉了出去。這個觸發條件在 12,866 著中出現 1 著，發生在 273 盤已完成棋局中的 1 盤。',
  'One game lost the real board at move 29': '一盤棋在第 29 著遺失了真實棋盤',
  "After 29.g4, from Black's side. Tinted: White's pawn on g4, Black's pawn on f4, and the empty square g3 between them. The arrow is White's queen attacking the black king.":
    '29.g4 之後，從黑方視角。上色的是：白方 g4 兵、黑方 f4 兵，以及兩者之間的空格 g3。箭頭表示白方的后正在攻擊黑王。',
  "After 29.g4, from Black's side": '29.g4 之後，從黑方視角',
  'Black is in check, so standard chess forbids f4xg3 en passant. Under fog it is an ordinary move, and it decides what Black sees.':
    '黑方正被將軍，所以標準西洋棋禁止 f4xg3 吃過路兵。在迷霧規則下這是一個普通的著法，而且它決定了黑方看得見什麼。',
  'With the en passant square. 14 squares. Black sees g3, and sees the pawn on g4.':
    '有吃過路兵的目標格時。14 個格子。黑方看得見 g3，也看得見 g4 上的兵。',
  "Black's view with the en passant square": '有吃過路兵目標格時黑方的視野',
  'Without it. 12 squares. g3 and g4 go dark. Same pieces, same board.':
    '沒有該格時。12 個格子。g3 與 g4 變暗。同樣的棋子，同樣的棋盤。',
  "Black's view without the en passant square": '沒有吃過路兵目標格時黑方的視野',
  'Under the standard rule the square was dropped:': '依標準規則，那個格子被丟掉了：',
  'Misty built the position after 29.g4 without the square, counted 12 visible squares for Black, compared them with the 14 in the real observation, and threw out the true move. `P` fell from 625 boards to 41 in that ply, and the real board was not among the 41. Misty played its last four decisions of the game drawing search roots from those 41.':
    'Misty 在沒有那個格子的情況下建出 29.g4 之後的局面，數出黑方可見 12 個格子，與真實觀察中的 14 個比較，於是排除了真實的著法。`P` 在那一著之內由 625 個棋盤掉到 41 個，而真實棋盤不在這 41 個之中。Misty 這盤棋最後四次決策的搜尋根節點，都是從這 41 個中抽取的。',
  'Move the black king one square over, where nothing attacks it, and change nothing else: the square is recorded as g3 and the real board stays in `P`.':
    '把黑王移到旁邊一格，那裡沒有任何棋子攻擊它，其餘一概不變：那個格子就會被記為 g3，真實棋盤也會留在 `P` 中。',
  'The fix records the square whenever a pawn can take': '修正方式是只要有兵能吃就記下該格',
  'The Rust path now checks only that an enemy pawn stands beside the pushed one. On the Python side every board written into `P` goes through one function, `belief_fen`, and the membership check takes a board and spells it the same way, since passing a raw `board.fen()` was how the mistake got in.':
    'Rust 路徑現在只檢查被推進的兵旁邊是否有敵方兵。在 Python 這一側，每個寫入 `P` 的棋盤都走同一個函式 `belief_fen`，而成員檢查接受一個棋盤，並以同樣的方式寫出它，因為直接傳入原始的 `board.fen()` 正是這個錯誤混進來的方式。',
  'The enumerator raises only when `P` goes empty, and losing the truth from a set of 41 is silent, as it has to be: in play the engine never knows the truth. The test comparing the Rust port with python-chess stayed green across 178,145 move applications, because both made the same mistake. Replay records whether the truth is in `P`, but that column was only read on games past the sampling cap, where losing the truth is expected.':
    '列舉器只在 `P` 變成空集合時拋出錯誤，而從 41 個的集合中遺失真值是無聲的，也必然如此：實戰中引擎從來不知道真值。比對 Rust 移植版與 python-chess 的測試在 178,145 次著法套用中一直是綠的，因為兩者犯了同樣的錯誤。重播會記錄真值是否在 `P` 中，但那一欄只在超過抽樣上限的棋局上被讀過，在那些棋局中遺失真值是預期的。',
  'Retold as a bug story, with the code path production actually ran corrected.':
    '改寫為一個錯誤的故事，並更正了正式環境實際執行的程式碼路徑。',
  // most-played-move: restored 2026-10-24, not native-reviewed; the rest of the 10-15 carry-over above: 19 strings reused from the brianhliou.com zh-hans and zh-hant posts (where their two versions differed in ASCII, harmonised to the current English), 13 machine-drafted for text the move changed or added.
  'In 144 of 4,121 common opening positions, the move club players choose most often loses winning chances against the engine at twenty million nodes. Ten of them, with what the masters played in each era, and a study holding all 144.':
    '在 4,121 個常見開局局面中，有 144 個局面裡俱樂部棋手最常選的著法，在兩千萬節點的引擎面前會失去取勝機會。本文挑出十個，附上各年代大師的選擇，並以一份研究收錄全部 144 個。',
  'In 144 of 4,121 common opening positions, the move 1600 to 2200 Lichess players choose most often loses winning chances against Stockfish at twenty million nodes. One in 29.':
    '在 4,121 個常見開局局面中，有 144 個局面裡 1600 到 2200 分的 Lichess 棋手最常選的著法，在兩千萬節點的 Stockfish 面前會失去取勝機會。比例是 29 個裡有 1 個。',
  'Positions from the Lichess opening explorer at 1600 to 2200, blitz, rapid and classical: every position to 14 plies with at least 500,000 games.':
    '局面取自 Lichess 開局瀏覽器，1600 到 2200 分，快棋、拉普與慢棋：14 著以內、對局數至少 500,000 局的每一個局面。',
  'Stockfish 18 at 20,000,000 nodes, MultiPV 3, one search per position.':
    'Stockfish 18，20,000,000 節點，MultiPV 3，每個局面一次搜尋。',
  "A miss is a gap of 0.1 or more in winning chances between the most played move and the engine's best, by lila's formula.":
    '最多人下的著法與引擎最佳著法之間的取勝機會差距達 0.1 以上，即算一次失誤，依 lila 的公式計算。',
  'Every flagged position searched again on a different machine under the same rule; 144 of 168 held.':
    '每個被標記的局面都在另一台機器上依相同規則再搜尋一次；168 個中有 144 個站得住。',
  "The answer, over 4,121 positions that 1600 to 2200 players reach 500,000 times or more: **144 of them, one in 29.** In those positions the most played move loses at least a tenth of a winning chance against the engine's move at twenty million nodes, and a second, independent search agrees. Some are gambit lines only the club plays. Some are main lines where the masters have played the engine's move for a century. Four are positions where the masters make the same mistake the club does.":
    '答案是，在 1600 到 2200 分棋手下到 500,000 次以上的 4,121 個局面裡，**有 144 個，29 個裡有 1 個。**在這些局面中，最多人下的著法相對於引擎在兩千萬節點下的著法，至少損失十分之一的取勝機會，而第二次獨立搜尋也同意這個判斷。其中有些是只有俱樂部棋手才下的棄兵變例。有些是大師一個世紀以來都走引擎著法的主流變例。有四個局面是大師與俱樂部棋手犯了同樣的錯。',
  'The Lichess database is every rated game on the site, filtered by rating band and speed. I took blitz, rapid and classical between 1600 and 2200, walked the tree from the start position as far as it stays above 500,000 games (14 plies at most), and kept every position on the way: 4,121 of them. For each one the explorer gives the move table, so "most played" is a fact about that band, not about chess.':
    'Lichess 資料庫收錄站上所有計分對局，可按分數段與棋速篩選。我取 1600 到 2200 分之間的快棋、拉普與慢棋，從起始局面沿著局面樹往下走，只要對局數維持在 500,000 以上就繼續（最多 14 著），並保留路上的每一個局面：共 4,121 個。每一個局面局面瀏覽器都會給出著法表，所以「最多人下」是關於那個分數段的事實，不是關於西洋棋本身的事實。',
  "**Four Knights, Spanish, 4...d6.** 1.e4 e5 2.Nf3 Nc6 3.Bb5 Nf6 4.Nc3, and 31% of the club plays 4...d6, +0.69. Rubinstein's 4...Nd4 is 0.00, and it is the one line on this list where you can watch theory move: the masters' top choice was 4...Bb4 before 2018 and is 4...Nd4 now (39% of 2,666 games). The club never played either.":
    '**四馬防禦，西班牙式，4...d6。**1.e4 e5 2.Nf3 Nc6 3.Bb5 Nf6 4.Nc3，31% 的俱樂部棋手走 4...d6，+0.69。Rubinstein 的 4...Nd4 是 0.00，而這是本清單上唯一能親眼看到理論移動的一條變例：大師在 2018 年前的首選是 4...Bb4，如今是 4...Nd4（2,666 局中佔 39%）。俱樂部棋手兩者都沒走過。',
  "**Stafford Gambit, move 6.** 1.e4 e5 2.Nf3 Nf6 3.Nxe5 Nc6 4.Nxc6 dxc6 5.Nc3 Bc5, the internet's favourite trap, 1.2 million club games. A quarter of White players play 6.Bc4, which walks into 6...Ng4 and the whole point of the gambit: −0.79. 6.h3 first is +1.74, a full piece's worth of difference, and the largest gap among the ten. Masters have played this position three times.":
    '**Stafford 棄兵，第 6 著。**1.e4 e5 2.Nf3 Nf6 3.Nxe5 Nc6 4.Nxc6 dxc6 5.Nc3 Bc5，網路上最受歡迎的陷阱，有 120 萬局俱樂部對局。四分之一的白方走 6.Bc4，正好踩進 6...Ng4 與這個棄兵的全部用意：−0.79。先走 6.h3 是 +1.74，整整一個子的差距，也是這十個局面中最大的落差。大師下到這個局面只有三次。',
  "Stafford Gambit: 6.Bc4 is the club move, 6.h3 the engine's":
    'Stafford 棄兵：6.Bc4 是俱樂部的著法，6.h3 是引擎的著法',
  '**Busch-Gass, 2...Bc5.** 1.e4 e5 2.Nf3 Bc5 offers the e-pawn, and 48% of White players decline it with 3.Bc4. Just take it: 3.Nxe5 is +1.60 against +0.24, and after 3...d6 4.Nf3 the pawn stays. Seven million club games, five masters games in total.':
    '**Busch-Gass 棄兵，2...Bc5。**1.e4 e5 2.Nf3 Bc5 獻出 e 兵，48% 的白方以 3.Bc4 拒吃。就吃下去吧：3.Nxe5 是 +1.60，對比 +0.24，而且 3...d6 4.Nf3 之後這個兵守得住。七百萬局俱樂部對局，大師對局總共只有五局。',
  "Busch-Gass Gambit: 3.Bc4 is the club move, 3.Nxe5 the engine's":
    'Busch-Gass 棄兵：3.Bc4 是俱樂部的著法，3.Nxe5 是引擎的著法',
  "**Falkbeer, 3.exd5.** 1.e4 e5 2.f4 d5 3.exd5, and 43% of the club plays the textbook 3...e4, the move the Falkbeer was named for. It is +0.52. 3...exf4 is −0.19, and the masters found that out in public: their share of 3...exf4 went from 36% before 2010 to 73% to 82%. The club's book is the old one.":
    '**Falkbeer 反棄兵，3.exd5。**1.e4 e5 2.f4 d5 3.exd5，43% 的俱樂部棋手走教科書上的 3...e4，也就是 Falkbeer 得名的那一著。它是 +0.52。3...exf4 是 −0.19，而大師是公開地發現這件事的：他們走 3...exf4 的比例從 2010 年前的 36% 升到 73%，再到 82%。俱樂部棋手用的是舊版的開局書。',
  "Falkbeer: 3...e4 is the club move, 3...exf4 the engine's and now the masters'":
    'Falkbeer 反棄兵：3...e4 是俱樂部的著法，3...exf4 是引擎的著法，如今也是大師的著法',
  "**Queen's Gambit Accepted, 3.e4 e5.** 1.d4 d5 2.c4 dxc4 3.e4 e5, and 63% of White players push 4.d5. It is −1.02; 4.Nf3 is +0.43, and the masters have played 4.Nf3 in 97 to 100% of their games in every era. The push looks like it wins space and hands Black the centre.":
    '**接受后翼棄兵，3.e4 e5。**1.d4 d5 2.c4 dxc4 3.e4 e5，63% 的白方推 4.d5。它是 −1.02；4.Nf3 是 +0.43，而大師在每個年代都有 97% 到 100% 的對局走 4.Nf3。那一推看起來搶到了空間，實際上把中心交給了黑方。',
  '**Positions**': '**局面**',
  'The [Lichess opening explorer](https://lichess.org/analysis#explorer), database "Lichess", ratings 1600, 1800, 2000 and 2200, blitz, rapid and classical':
    '[Lichess 開局瀏覽器](https://lichess.org/analysis#explorer)，資料庫選「Lichess」，分數 1600、1800、2000 與 2200，快棋、拉普與慢棋',
  '**Walk**': '**走訪**',
  'From the start position to 14 plies, keeping every position with at least 500,000 games; stopped at 4,000 expanded nodes, with 55 left in the queue':
    '自起始局面往下走到 14 著深度，保留所有至少 500,000 局的局面；在展開 4,000 個節點時停止，佇列中還剩 55 個',
  '**Engine**': '**引擎**',
  'Stockfish 18 at 20,000,000 nodes, MultiPV 3, one search per position, on Modal':
    'Stockfish 18，20,000,000 節點，MultiPV 3，每個局面一次搜尋，在 Modal 上執行',
  '**Judged against**': '**評判基準**',
  'The best move from that search. The most played move is scored by its own line when the search ranked it among the three, else by a 20M search of the position after it':
    '該次搜尋得出的最佳著法。若搜尋把最多人下的著法排進前三名，就以它自己的變例計分，否則對其後的局面另做一次 20M 搜尋',
  '**Miss**': '**失誤**',
  "A gap of 0.1 or more by lila's winning-chance formula, `2 / (1 + e^(−0.00368·cp)) − 1`":
    '依 lila 的取勝機會公式，差距達 0.1 以上：`2 / (1 + e^(−0.00368·cp)) − 1`',
  '**Second search**': '**第二次搜尋**',
  'Every flagged position again at 20M, MultiPV 3, on a different machine and thread count, same rule; 144 of 168 survive':
    '每個被標記的局面在不同機器與不同執行緒數上再做一次 20M MultiPV 3 搜尋，規則相同；168 個中有 144 個通過',
  '**Masters eras**': '**大師年代**',
  'The masters database with `until=2009`, `since=2010&until=2017` and `since=2018`; a cell under twenty games counts as no data':
    '大師資料庫，分別使用 `until=2009`、`since=2010&until=2017` 與 `since=2018`；不足二十局的欄位視為無資料',
  'The harness is the one from [Lichess Analysis: What a Million Nodes a Move Buys](/blog/lichess-analysis-accuracy), the previous post, on how the labels are made.':
    '測試框架沿用上一篇文章[Lichess 分析：每著一百萬節點換來了什麼](/blog/lichess-analysis-accuracy)所用的那一套，那篇談的是這些標籤是怎麼產生的。',
  'Corrected the number of positions where the club or engine move is a capture: four, not six.':
    '更正了俱樂部著法或引擎著法為吃子的局面數：是四個，不是六個。',
  // chess960-starting-positions: restored 2026-10-24, not native-reviewed; the rest of the 10-15 carry-over above: 12 strings reused from the brianhliou.com zh-hans and zh-hant posts (where their two versions differed in ASCII, harmonised to the current English), 5 machine-drafted for text the move changed or added.
  'All 960 starting positions searched by Stockfish 18 with `UCI_Chess960=true`, to the same target of depth 36.':
    '全部 960 個開局局面都由 Stockfish 18 以 `UCI_Chess960=true` 搜尋，目標深度統一為 36。',
  '959 reached depth 36; one stopped at depth 35 at the time cap.':
    '959 個達到深度 36；有一個在時間上限時停在深度 35。',
  'Compared with the Lichess cloud-eval cache, which had all 960 positions at depths 28 to 75.':
    '與 Lichess 雲端評估快取對照，該快取收錄了全部 960 個局面，深度從 28 到 75。',
  'Every evaluation is in the [CSV](/article-data/chess960-starting-position-evals.csv).':
    '每一個評估值都收錄在 [CSV](/article-data/chess960-starting-position-evals.csv) 中。',
  'Castling appears in 1,290 PV moves, all replayed legally under Chess960 rules.':
    '王車易位在主變著法中出現 1,290 次，全部依西洋棋960規則合法重播。',
  'I also probed the [Lichess cloud-eval API](https://lichess.org/api#tag/Analysis/operation/apiCloudEval) at `variant=chess960` for all 960 starts. Lichess had cache hits for all 960 positions, at depths 28 to 75, with median depth 33.':
    '我也針對全部 960 個開局查詢了 [Lichess 雲端評估 API](https://lichess.org/api#tag/Analysis/operation/apiCloudEval)，參數為 `variant=chess960`。Lichess 對全部 960 個局面都有快取命中，深度從 28 到 75，中位深度 33。',
  '2026 FIDE Freestyle World Championship': '2026 年 FIDE Freestyle 世界錦標賽',
  '2025 Freestyle Grand Slam Weissenhaus': '2025 年 Freestyle 大滿貫 Weissenhaus 站',
  '2025 Freestyle Grand Slam Paris': '2025 年 Freestyle 大滿貫巴黎站',
  '2025 Freestyle Grand Slam Las Vegas': '2025 年 Freestyle 大滿貫拉斯維加斯站',
  '2025 Freestyle Grand Slam Finals': '2025 年 Freestyle 大滿貫總決賽',
  'Las Vegas, Paris, 2026 FIDE': '拉斯維加斯、巴黎、2026 年 FIDE',
  '2022 FIDE outlier from this post, SP-317': '本文提到的 2022 年 FIDE 異例，SP-317',
  'For comparison, the 2022 FIDE World Fischer Random Championship used 11 distinct starts across 60 games. They ranged from +0.19 to +0.54, with mean +0.32. It also avoided the extreme tail.':
    '作為對照，2022 年 FIDE 世界費舍爾任意制錦標賽在 60 局中使用了 11 個不同的開局。它們的評估值從 +0.19 到 +0.54，平均 +0.32。它同樣避開了極端尾端。',
  'The 960 evaluations were computed in one Modal run, on Chess960 plumbing built for it: `UCI_Chess960` engine mode, X-FEN castling round-trips, shredder-UCI castling in PV replay, and regression coverage for Chess960 correctness.':
    '這 960 個評估值是在一次 Modal 執行中算出的，建立在為此打造的西洋棋960底層之上：`UCI_Chess960` 引擎模式、X-FEN 王車易位的往返轉換、主變重播中的 shredder-UCI 王車易位，以及針對西洋棋960正確性的回歸測試覆蓋。',
  "The successful production run took 33.1 minutes wall time: 96 ten-position batches, run in parallel under Modal's 100-container Starter cap. At Modal's base CPU/memory rates, that run lands under $3 of cloud spend.":
    '成功的正式執行實際耗時 33.1 分鐘：96 個十局面批次，在 Modal 的 100 容器 Starter 方案上限下並行執行。以 Modal 的基本 CPU／記憶體費率計算，這次執行的雲端花費在 3 美元以下。',
  "Corrected two histogram counts, SP-663's depth-36 score and the run cost against the published CSV.":
    '對照已發佈的 CSV，更正了兩個直方圖計數、SP-663 在深度 36 下的評估值，以及執行成本。',
  // lichess-analysis-accuracy: restored 2026-10-24, not native-reviewed; 50 strings reused from the brianhliou.com zh-hans and zh-hant posts where they still say what the moved English says, 15 machine-drafted for text the move changed or added.
  'Lichess Analysis: What a Million Nodes a Move Buys': 'Lichess 分析：每著一百萬節點換來了什麼',
  'Lichess analyses each move at a million nodes, about a second of one core. I re-ran 300 games at twenty times that to see what the budget trades away: the blunders hold, the inaccuracies move.':
    'Lichess 對每著分析一百萬節點，大約是單核一秒。我把 300 局以二十倍的預算重跑了一遍，看看這個預算放棄了什麼：嚴重失誤站得住，不精確會變。',
  'Lichess analyses each position at a million nodes, about a second of one Stockfish core. I re-ran 300 random games at twenty times that budget and compared every label.':
    'Lichess 對每個局面分析一百萬節點，大約是一個 Stockfish 核心一秒。我以二十倍的預算重新分析了 300 局隨機對局，並比對每一個標記。',
  'The budget holds where it matters most: blunders keep their label 84% of the time, and the totals in the game summary barely move.':
    '在最要緊的地方，這個預算站得住：嚴重失誤有 84% 保住了標記，對局摘要裡的總數幾乎不動。',
  'One move in ten gets a different label, mostly inaccuracies: 57% hold, 28% are nothing at depth, 15% are worse. The changes concentrate between half a pawn and three pawns.':
    '每十著就有一著的標記改變，多半是不精確：57% 成立，28% 在深搜下其實毫無問題，15% 其實更糟。改變集中在半個兵到三個兵之間。',
  "Thirteen of the 300 games have a mistake with no mark. Thirty-two unmarked mistakes from titled players' games are a puzzle study.":
    '300 局中有十三局存在沒被標出的失誤。取自有頭銜棋手對局的三十二個未被標出的失誤，做成了一份謎題研究。',
  'A random sample: every tenth analysed game in the August 2026 Lichess database with both players between 1600 and 2400, 300 games and 20,227 moves.':
    '隨機樣本：2026 年 8 月 Lichess 資料庫中每第十局已分析、且雙方積分都在 1600 到 2400 之間的對局，共 300 局、20,227 著。',
  'Every position searched again by Stockfish 18 at 20,000,000 nodes on one thread, twenty times the budget Lichess uses.':
    '每個局面都由 Stockfish 18 以單執行緒、20,000,000 節點重新搜尋，是 Lichess 所用預算的二十倍。',
  "Both sets of evaluations labelled by lila's own formula, which reproduces Lichess's stored labels 99.08% of the time on 222,183 moves from titled players' games.":
    '兩套評估值都用 lila 自己的公式標記；在有頭銜棋手對局的 222,183 著上，這個公式能以 99.08% 的比例重現 Lichess 儲存的標記。',
  'Moves with a forced mate at either end left out, because lila judges those by separate rules.':
    '兩端任一有強制將死的著法被排除，因為 lila 對那些採用另一套規則判定。',
  'Lichess analyses each position in a requested game at **1,000,000 nodes**, about a second of one Stockfish core. The analysis runs on [fishnet](https://github.com/lichess-org/fishnet), CPUs that volunteers donate, so every extra node is donated time, and a longer wait for the person who pressed the button. A deeper search would be more accurate. The useful questions are how much more, and what it would cost.':
    'Lichess 對一局被請求分析的對局，每個局面分析 **1,000,000 節點**，大約是一個 Stockfish 核心一秒。分析跑在 [fishnet](https://github.com/lichess-org/fishnet) 上，用的是志願者捐贈的 CPU，所以每多一個節點都是捐來的時間，也意味著按下按鈕的人要多等一會兒。更深的搜尋會更準確。有用的問題是準確多少，以及要付出什麼代價。',
  'I re-analysed 300 rated games at twenty times the budget to put a size on it. The budget holds where it matters most. Blunders keep their label 84% of the time, and the totals in the game summary barely move. What changes is concentrated in one label, the inaccuracy, and in one range of positions, between half a pawn and three pawns.':
    '為了量出它的大小，我以二十倍的預算重新分析了 300 局積分對局。在最要緊的地方，這個預算站得住。嚴重失誤有 84% 保住了標記，對局摘要裡的總數幾乎不動。改變集中在一個標記上，也就是不精確，也集中在一個局面區間裡，也就是半個兵到三個兵之間。',
  'The budget and what it costs to raise': '預算，以及提高它的代價',
  "The budgets are in lila's source ([`Work.Origin`](https://github.com/lichess-org/lila/blob/master/modules/fishnet/src/main/Work.scala)): a million nodes for a requested analysis, five million for official broadcasts, 300,000 and 100,000 for the automatic passes. It is a deliberate scale, with the most compute where the most people are watching.":
    '預算寫在 lila 的原始碼裡（[`Work.Origin`](https://github.com/lichess-org/lila/blob/master/modules/fishnet/src/main/Work.scala)）：使用者請求的分析為一百萬節點，官方轉播為五百萬，自動分析則為 300,000 與 100,000。這是刻意設計的級距，算力最多的地方，正是觀看的人最多的地方。',
  'Search time grows with the node count. The average game in my sample had 67 positions to evaluate (20,227 moves over 300 games), and twenty times the nodes is twenty times the search on every one of them. For every game anyone asks about, the difference is a longer wait or twenty times the volunteers.':
    '搜尋時間隨節點數增長。我的樣本中平均每局有 67 個局面要評估（20,227 著分布在 300 局中），二十倍的節點就是每個局面都要二十倍的搜尋。對任何人請求分析的每一局來說，差別就是更久的等待，或是二十倍的志願者。',
  'Each label compares two evaluations, the position before your move and the position after, converted to winning chances so that a half-pawn slip at 0.00 counts for more than one at +5. A drop of 0.1 in winning chances is an inaccuracy, 0.2 a mistake, 0.3 a blunder ([`Advice.scala`](https://github.com/lichess-org/lila/blob/master/modules/tree/src/main/Advice.scala)). So a label is as good as the search on both ends. If a million nodes do not find what a position holds, a move that gives it up loses nothing against the number.':
    '每個標記比較兩個評估值：你走著法之前的局面與之後的局面，換算成勝率，所以在 0.00 處失手半個兵，比在 +5 處更嚴重。勝率下降 0.1 為不精確，0.2 為失誤，0.3 為嚴重失誤（[`Advice.scala`](https://github.com/lichess-org/lila/blob/master/modules/tree/src/main/Advice.scala)）。所以標記的好壞取決於兩端的搜尋。如果一百萬節點找不到一個局面裡藏著的東西，那麼放棄它的著法相對於這個數字就沒有任何損失。',
  'One of my blitz games from September, evaluated at both budgets. The blue line is the Lichess graph and the dots are the moves it marked. The rings are three moves the deeper search calls mistakes, at 20, 24 and 26. Before 20.Qd1 the server had +1.2, and +0.9 after, too small a drop to mark; at 20M it is +2.0 and +0.7.':
    '我九月的一局快棋，以兩種預算各評估一次。藍線是 Lichess 的曲線，圓點是它標出的著法。圓圈是較深搜尋判為失誤的三著，分別在第 20、24 與 26 著。20.Qd1 之前伺服器給出 +1.2，之後 +0.9，跌幅太小不足以標記；在 20M 下則是 +2.0 與 +0.7。',
  'Two evaluation lines over 71 half-moves of one blitz game, Lichess at one million nodes and Stockfish at twenty million. They track each other for nineteen moves and split at move 20.':
    '一局快棋 71 個半著上的兩條評估值曲線，Lichess 為一百萬節點，Stockfish 為兩千萬節點。前十九著兩條線互相貼合，在第 20 著分岔。',
  'My 20.Qd1 was that case: the better square was one file over, and the punishment starts three moves later than a one-second search looks.':
    '我的 20.Qd1 正是這種情形：更好的格子只差一路，而懲罰要比一秒搜尋所能看到的再晚三著才開始。',
  'What twenty times the budget changes': '二十倍預算改變了什麼',
  'On 300 random rated games (1600 to 2400, from the August 2026 database), re-evaluated at 20,000,000 nodes with the same formula, and setting aside the 842 moves with a forced mate at either end, 19,385 moves compared:':
    '以 300 局隨機的積分對局（1600 至 2400，取自 2026 年 8 月資料庫），用同樣的公式在 20,000,000 節點下重新評估，並排除兩端任一有強制將死的 842 著，共比對了 19,385 著：',
  "**What holds.** Blunders keep their label 84% of the time. Labels change in both directions in nearly equal numbers (930 harsher, 885 kinder), so a game's totals barely move. At equality, and once the game is decided (six pawns or more), the two passes agree.":
    '**站得住的。** 嚴重失誤有 84% 保住了標記。標記往兩個方向改變的數量相當（930 個變重，885 個變輕），所以一局棋的總數幾乎不動。在均勢時，以及勝負已定之後（六個兵或以上），兩次分析是一致的。',
  '**What moves.** One move in ten gets a different label, mostly inaccuracies. Of 1,805 Lichess inaccuracies, 57% are still inaccuracies at 20M, 28% are nothing, and 15% are mistakes or blunders.':
    '**會變的。** 每十著就有一著的標記改變，多半是不精確。1,805 個 Lichess 判定的不精確中，57% 在 20M 下仍是不精確，28% 其實毫無問題，15% 其實是失誤或嚴重失誤。',
  '**Where it moves.** Thirteen of the 300 games have a mistake with no mark, and 29 have a marked mistake or blunder that is nothing at depth. Most sit where the evaluation is between half a pawn and three pawns, where the two passes agree least (82–87% against 94% near equality).':
    '**在哪裡變。** 300 局中有十三局存在沒被標出的失誤，29 局有被標成失誤或嚴重失誤、深搜下卻毫無問題的著法。它們多半落在評估值介於半個兵到三個兵之間的地方，兩次分析在這裡最不一致（82–87%，而均勢附近是 94%）。',
  "A cheaper 4M-node pass over nine titled players' recent games (804 in all: about a hundred each for seven, 61 for Gürel, 20 for Giri), on their own moves: a quarter of the mistakes Lichess pins on Magnus Carlsen are not mistakes at depth, and for everyone else it runs the other way, with one real mistake in five carrying a softer label than it deserves.":
    '以較省的 4M 節點分析九位有頭銜棋手最近的對局（共 804 局：七位各約一百局，Gürel 61 局，Giri 20 局），只看他們自己的著法：Lichess 掛在 Magnus Carlsen 身上的失誤有四分之一在深搜下並非失誤，而其他人則是相反方向，每五個真正的失誤就有一個被貼上比實際更輕的標記。',
  player: '棋手',
  'Lichess mistakes+blunders': 'Lichess 判失誤+嚴重失誤',
  'under-labelled': '標記過輕',
  'over-labelled': '標記過重',
  'Magnus Carlsen': 'Magnus Carlsen',
  'Alireza Firouzja': 'Alireza Firouzja',
  'Eric Rosen': 'Eric Rosen',
  'Jerry (ChessNetwork)': 'Jerry (ChessNetwork)',
  'Oleksandr Bortnyk': 'Oleksandr Bortnyk',
  'Sergei Zhigalko': 'Sergei Zhigalko',
  'Dmitry Andreikin': 'Dmitry Andreikin',
  'Ediz Gürel': 'Ediz Gürel',
  'Anish Giri': 'Anish Giri',
  'Five positions where depth changes the verdict': '深搜改變判定的五個局面',
  'Each position is from one of those games. The player made the move shown, the analysis gave it no mark, and a 20-million-node search calls it a mistake or worse against a best move that is unique. The board opens on the position before the move, so you can look for the better move first; step forward and you get the game move with the mark it should have had, and the refutation is the sideline in the study, one click under each board.':
    '以下每個局面都出自那些對局。棋手走了圖上那一著，分析沒給任何標記，而兩千萬節點的搜尋判定它是失誤或更糟，且最佳著法是唯一的。棋盤一開始停在該著之前的局面，所以你可以先自己找更好的著法；往前走一步就會看到對局實走的著法連同它本該有的標記，而反駁手段是研究裡的變例，就在每個棋盤下方點一下即可。',
  "**Zhigalko, Black to move.** White has just played Be5, hitting the queen on c7, and Black did the natural thing: 20...Qd7, out of the attack. The analysis had it −1.38 before and −1.30 after, nothing lost. But the queen did not need saving. 20...Rxd2! gives up the exchange, and after 21.Rxd2 the pawn move 21...c3! forks the queen on b2 and the rook on d2 at once. White gets the queen back (22.Bxc7 cxb2 23.Rxb2 Rxc7) and is left with a rook against Black's two bishops and knight: −3.2 at depth, against −1.3 for the retreat. The refutation starts with a move that loses material, which is why a one-second search never sees it.":
    '**Zhigalko，黑方走。** 白方剛走 Be5，攻擊 c7 的后，黑方做了最自然的事：20...Qd7，讓后脫離攻擊。分析給出之前 −1.38、之後 −1.30，沒有損失。但那個后根本不需要救。20...Rxd2！棄車換馬，21.Rxd2 後，兵著 21...c3！同時捉住 b2 的后與 d2 的車。白方把后拿回來（22.Bxc7 cxb2 23.Rxb2 Rxc7），最後剩下一個車對黑方的雙象加一馬：深搜下 −3.2，而退后只有 −1.3。反駁手段的第一著是丟失子力的一著，這正是一秒搜尋永遠看不到它的原因。',
  'Zhigalko: 20...Qd7 got no mark at 1M; Rxd2 and c3 win':
    'Zhigalko：20...Qd7 在 1M 下沒有標記；Rxd2 與 c3 獲勝',
  '**Bortnyk, Black to move.** 20...b5 attacks the bishop on c4, and the analysis moved from −0.63 to −0.41. The bishop on f5 could simply have taken the knight: 20...Bxe4! 21.dxe4, and now the other knight lands on f4, with ...e5 to follow to push the bishop off d4. Black wins material inside five moves, −2.7 at depth; the second-best move, 20...Nf4 at once, is only −0.6.':
    '**Bortnyk，黑方走。** 20...b5 攻擊 c4 的象，分析從 −0.63 變成 −0.41。f5 的象本來可以直接吃馬：20...Bxe4！21.dxe4，接著另一隻馬落到 f4，再跟上 ...e5 把象從 d4 趕走。黑方五著之內贏得子力，深搜下 −2.7；次佳著法 20...Nf4 立刻走，只有 −0.6。',
  'Bortnyk: 20...b5 got no mark at 1M; Bxe4 wins material':
    'Bortnyk：20...b5 在 1M 下沒有標記；Bxe4 贏子',
  "**Bortnyk, Black to move, a queen ending.** Queen and knight against queen and rook, and White's a-pawn is the only thing White has going. Black played 54...Qf6; the analysis said −1.58 to −1.03. At depth the position after Qf6 is a dead draw. 54...Qa7+! 55.Kg3 Qxa4 picks up that pawn with check, and the ending is −2.1 and winning.":
    '**Bortnyk，黑方走，后類殘局。** 后加馬對后加車，白方的 a 兵是白方唯一的本錢。黑方走了 54...Qf6；分析說是 −1.58 到 −1.03。深搜下 Qf6 之後的局面是徹底的和棋。54...Qa7+！55.Kg3 Qxa4 帶將吃掉那個兵，殘局是 −2.1，勝勢。',
  'Bortnyk: 54...Qf6 got no mark at 1M; Qa7+ and Qxa4 win a pawn':
    'Bortnyk：54...Qf6 在 1M 下沒有標記；Qa7+ 與 Qxa4 贏兵',
  '**Carlsen, Black to move.** The white queen sits on g4 and the knight on e4. Carlsen played 15...Ne5, hitting the queen, and the analysis went from −0.94 to −0.43. The pawn move 15...f5! hits both: after 16.Qh3 fxe4 17.Bxe4 Black has won a knight for a pawn and stands −1.9, with the second-best move (15...g6) a pawn and a half behind. A shallow search reads ...f5 as loosening the king and the knight retreat as safe, and both readings are wrong.':
    '**Carlsen，黑方走。** 白后在 g4，馬在 e4。Carlsen 走了 15...Ne5 攻擊后，分析從 −0.94 變成 −0.43。兵著 15...f5！同時攻擊兩者：16.Qh3 fxe4 17.Bxe4 之後，黑方用一兵換到一馬，局面 −1.9，而次佳著法（15...g6）落後一個半兵。淺層搜尋把 ...f5 讀成鬆動王翼，把退馬讀成安全，兩種判讀都錯。',
  'Carlsen: 15...Ne5 got no mark at 1M; f5 forks queen and knight':
    'Carlsen：15...Ne5 在 1M 下沒有標記；f5 同時捉后與馬',
  "**Gürel, White to move.** A rook ending with a knight each; Black's knight on a3 is loose, and White's d-pawn is on d5. White played 31.Nd4, +1.42 to +1.06 by the analysis. 31.d6! is the move: the rook has to stop the pawn (31...Rxd6), and then 32.Nxa3 takes the knight for nothing. +3.9 at depth, against +0.9 after the game move.":
    '**Gürel，白方走。** 車類殘局，各有一馬；黑方 a3 的馬懸空，白方的 d 兵在 d5。白方走了 31.Nd4，分析給出 +1.42 到 +1.06。31.d6！才是正著：車必須擋住這個兵（31...Rxd6），接著 32.Nxa3 白吃一馬。深搜下 +3.9，而實走著法之後是 +0.9。',
  'Gürel: 31.Nd4 got no mark at 1M; d6 deflects the rook and wins the knight':
    'Gürel：31.Nd4 在 1M 下沒有標記；d6 引離車並贏馬',
  "All 32 are in [the study](/study/fhC7BCG7), set as puzzles: the position first, the game move marked, the refutation as a sideline with the engine's numbers, and every later move of the game that the 20M search judges carries its own mark and the engine's line beside it. Forcing solutions come first, since a long tactic past the shallow horizon is something a person can find; the quiet ones are after.":
    '全部 32 個都收在[這份研究](/study/fhC7BCG7)裡，做成謎題：先是局面，接著標出實走著法，反駁手段作為變例並附上引擎數字，此外對局後續每一著只要 20M 搜尋判定有問題，都各自帶著標記與引擎變例。強制性解法排在前面，因為超出淺層視界的長戰術是人找得到的；平穩的那些排在後面。',
  'Reading your own report': '讀懂你自己的報告',
  '"Zero mistakes" means zero visible at a million nodes. The blunders are real, the inaccuracies are half real, and the moves that let an opponent back into a game you were winning by a pawn or two are the ones most likely to carry no mark. If a game matters, put your own engine on it and let it sit past depth 25 on the positions between +0.5 and +3.':
    '「零失誤」的意思是在一百萬節點下看不到失誤。嚴重失誤是真的，不精確只有一半是真的，而那些讓對手重新回到你原本領先一兩個兵的棋局裡的著法，最可能完全沒有標記。如果一局棋很重要，就用你自己的引擎跑它，讓它在 +0.5 到 +3 之間的局面上跑過搜尋深度 25。',
  "The random sample is every tenth analysed game in the [August 2026 Lichess database](https://database.lichess.org/) with both players between 1600 and 2400: 300 games, 20,227 moves with server evaluations. Each position went through Stockfish 18, the major version fishnet runs, at 20,000,000 nodes on one thread, and lila's own formula (`Advice.scala`: winning-chance deltas of 0.1, 0.2, 0.3) produced a second set of labels. On 222,183 moves from titled players' games, where Lichess stores its labels, that formula reproduces them from Lichess's own evaluations 99.08% of the time, so both sides of the comparison use it. The 842 moves with a forced mate at either end are excluded; lila judges those by separate rules.":
    '隨機樣本取自[2026 年 8 月 Lichess 資料庫](https://database.lichess.org/)中每第十局已分析、且雙方積分都在 1600 到 2400 之間的對局：300 局，20,227 著帶有伺服器評估值。每個局面都經過 Stockfish 18（fishnet 所執行的主要版本），單執行緒 20,000,000 節點，再用 lila 自己的公式（`Advice.scala`：勝率差 0.1、0.2、0.3）產生第二套標記。在有頭銜棋手對局中 Lichess 存有標記的 222,183 著上，那個公式用 Lichess 自己的評估值能以 99.08% 的比例重現這些標記，所以比較的兩邊都使用它。兩端任一有強制將死的 842 著被排除；lila 對那些採用另一套規則判定。',
  'Lichess label': 'Lichess 標記',
  'none at 20M': '20M 下無標記',
  inaccuracy: '不精確',
  mistake: '失誤',
  blunder: '嚴重失誤',
  "The nine players' games are up to their most recent hundred analysed rated blitz and rapid games (61 for Gürel, 20 for Giri) from the public API (the active seven in 2026; Carlsen and Firouzja have no analysed Lichess games this year, so theirs run back to 2021 and 2023), at a cheaper 4,000,000-node pass. On the random sample, 4M finds a little over half of what 20M finds, so the player rates are floors. A puzzle survives when the move played loses at least 0.2 winning chances at 20M against a best move that beats the second line by 0.1 or more, with three lines searched, and then again when a second, independent 20M search of the position still calls the game move a mistake: 35 passed the first gate, 32 the second. That is the size of the noise in a 20M search, and it is why the deeper pass is treated as twenty times closer to the truth rather than as the truth.":
    '九位棋手的對局取自公開 API 中他們最近至多一百局已分析的積分快棋與中速棋（Gürel 為 61 局，Giri 為 20 局；七位在 2026 年仍活躍；Carlsen 與 Firouzja 今年沒有已分析的 Lichess 對局，所以他們的往回追到 2021 與 2023 年），採用較省的 4,000,000 節點分析。在隨機樣本上，4M 找出的略多於 20M 所找出的一半，所以棋手的比率是下限。一個謎題要能成立，必須是實走著法在 20M 下損失至少 0.2 勝率，而最佳著法比第二變例好 0.1 以上，搜尋三條變例；然後還要在對該局面的第二次獨立 20M 搜尋中，依然把實走著法判為失誤：35 個通過第一關，32 個通過第二關。這就是 20M 搜尋中雜訊的量級，也是為什麼較深的那次分析被視為離真相近二十倍，而不是視為真相本身。',
  'Is a million the right number?': '一百萬是對的數字嗎？',
  'This measures one point on the curve. Whether a million is the right budget depends on the points in between: how much agreement each doubling buys at 2M, 4M and 8M, and whether extra search spent only where labels are unstable, on the inaccuracies and the half-pawn-to-three-pawn band, would get most of the twenty-times result at a fraction of the cost. On these numbers, the current budget gets the label people act on, the blunder, right five times in six.':
    '這只測量了曲線上的一個點。一百萬是不是合適的預算，取決於中間的那些點：在 2M、4M 與 8M 下，每加倍一次能換來多少一致性；以及如果只在標記不穩定的地方，也就是不精確與半個兵到三個兵的區間上追加搜尋，能否以一小部分成本拿到二十倍預算的大部分效果。按這些數字，現行預算在人們據以行動的那個標記，也就是嚴重失誤上，六次有五次是對的。',
  'Solve the 32 puzzles': '來解這 32 道謎題',
  'Try xiangqi puzzles': '試試象棋謎題',
  'Reframed around what a million nodes a move buys, with three overstated lines corrected.':
    '改為圍繞每著一百萬節點換來了什麼來寫，並修正了三處說過頭的句子。',
  // dou-shou-qi-engine: restored 2026-10-24, not native-reviewed; 61 strings reused from the brianhliou.com zh-hans and zh-hant posts where they still say what the moved English says, 4 machine-drafted for text the move changed or added.
  'A Dou Shou Qi (Jungle Chess) Engine: Classical Search Beat the Learned Eval':
    '鬥獸棋引擎：經典搜尋勝過學習式評估',
  "Building an engine for Jungle, also called Animal Chess: alpha-beta search and a hand-written evaluation went 11-2 with 187 draws against the strongest open-source engine I could run. A learned evaluation and a tablebase didn't help.":
    '為鬥獸棋（英文又稱 Jungle 或 Animal Chess）打造引擎：alpha-beta 搜尋加上手寫評估，對上我能執行的最強開源引擎拿下 11 勝 2 負 187 和。學習式評估與殘局庫都沒幫上忙。',
  'MistyJungle, a classical Rust engine for Dou Shou Qi (Jungle), scored W11-L2-D187 against the strongest open-source engine I could run, about +16 Elo.':
    'MistyJungle 是一個以 Rust 寫成的經典鬥獸棋引擎，對上我能執行的最強開源引擎拿下 W11-L2-D187，約 +16 Elo。',
  'It matched exact four-piece tablebases on 779 of 800 positions with no win/draw/loss mistakes.':
    '在 800 個局面中有 779 個與精確的四子殘局庫相符，且沒有任何勝/和/負判斷錯誤。',
  "The two upgrades I expected to help didn't: a learned eval never beat the hand eval, and a tablebase at the search leaf cost about 13 Elo.":
    '我原本預期有幫助的兩項升級都沒用：學習式評估從未勝過手寫評估，而在搜尋葉節點使用殘局庫則損失約 13 Elo。',
  'Published endgame databases stop at four pieces, and the full game is likely to stay unsolved.':
    '已發表的殘局資料庫止步於四子，完整遊戲很可能仍是未解之局。',
  'I built MistyJungle, a classical Rust engine for Dou Shou Qi, the 7×9 board game usually called Jungle or Animal Chess. You can [play MistyJungle on Mistboard](/?play=computer&gameSpecId=jungle). It uses alpha-beta search, a handcrafted evaluation, repetition handling, and no neural network in the playing version.':
    '我做了 MistyJungle，一個以 Rust 寫成的經典鬥獸棋引擎，棋盤為 7×9，英文通常稱為 Jungle 或 Animal Chess。你可以[在 Mistboard 上與 MistyJungle 對弈](/?play=computer&gameSpecId=jungle)。它使用 alpha-beta 搜尋、手工打造的評估、重複局面處理，對弈版本中沒有任何神經網路。',
  "Updated October 7: MistyJungle is no longer Mistboard's strongest jungle bot. In September [KataGo-AnimalChess](/blog/katago-jungle), a self-play net, beat it 82-0 with 118 draws over 200 games and took the top seat; MistyJungle is now the easier bot below it.":
    '10 月 7 日更新：MistyJungle 已不再是 Mistboard 上最強的鬥獸棋電腦。9 月，自我對弈神經網路 [KataGo-AnimalChess](/blog/katago-jungle) 在 200 局中以 82-0 外加 118 局和棋擊敗了它，奪下最高席位；MistyJungle 現在是排在它下面、較容易對付的電腦。',
  'The result is narrow but real. Against the strongest open-source engine I could run, it scored W11-L2-D187 over 200 games, about +16 Elo in a drawish game, and its four-piece endgame play matched exact tablebases with no win/draw/loss mistakes. The two upgrades I expected to help, a learned eval and a tablebase at the search leaf, did not. Classical search did the work.':
    '成果不大，但真實。對上我能執行的最強開源引擎，200 局拿下 W11-L2-D187，在一個偏和棋的遊戲裡約為 +16 Elo，而它的四子殘局著法與精確殘局庫相符，沒有任何勝/和/負判斷錯誤。我原本預期有幫助的兩項升級，學習式評估與搜尋葉節點的殘局庫，都沒有奏效。真正發揮作用的是經典搜尋。',
  'What I built': '我做了什麼',
  'A standalone Rust engine with a small UCI-style protocol, usable from the command line or from Python via PyO3. Strength is a **node budget, not a clock**, so the same position returns the same move on any machine.':
    '一個獨立的 Rust 引擎，附帶小型的 UCI 風格協定，可從命令列使用，也可透過 PyO3 從 Python 使用。棋力取決於**節點預算，而不是時鐘**，因此同一個局面在任何機器上都會回傳同一著。',
  'The stack is conventional: negamax alpha-beta with iterative deepening, a Zobrist transposition table, quiescence on captures and den-entries, and killer/history move ordering with PVS and late-move reductions, over a handcrafted evaluation that scores material, distance to the enemy den, traps, water, and mobility. That ordering-and-pruning polish was worth a measured +49 Elo at a fixed node budget.':
    '技術堆疊很常規：帶迭代加深的 negamax alpha-beta、Zobrist 置換表、對吃子與進入獸穴著法的靜態搜尋、killer/history 著法排序搭配 PVS 與後期著法削減，底下是一套手工打造的評估，計算子力、與敵方獸穴的距離、陷阱、水域與機動性。這些排序與剪枝的打磨，在固定節點預算下實測值得 +49 Elo。',
  'The eval has to be exact before a learned correction can add anything. Dou Shou Qi is material-heavy but full of sharp exceptions: a rat stops an elephant, a trapped piece loses its rank, one step into the den ends the game.':
    '評估必須先做到精確，學習式修正才可能帶來任何增益。鬥獸棋很看重子力，卻充滿尖銳的例外：鼠能克象，落入陷阱的棋子失去等級，一步踏進獸穴就結束對局。',
  Specs: '規格',
  "Each side has eight animals on a 7×9 board, and you win by stepping into the opponent's den or capturing every piece. The rules vary by region, so the exact set matters. I used the Mistboard rules as of June 2026, where wolf outranks dog (some sources swap them). One of those rules has since changed: the tiger jumped the river lengthwise only, a reading that comes from English Wikipedia, while the Chinese rule sets (Tencent's QQ Games, Leiden's page) give the tiger the same leap as the lion. Mistboard and MistyJungle 0.0.6 switched to the Chinese rule in September 2026; the games in this post were played under the old one.":
    '雙方各有八隻動物在 7×9 的棋盤上，踏進對方獸穴或吃掉對方所有棋子即勝。規則因地區而異，所以採用哪一套很重要。我用的是 2026 年 6 月時的 Mistboard 規則，其中狼大於狗（有些資料把兩者互換）。其中一條規則後來改了：當時虎只能縱向跳河，這個讀法來自英文維基百科，而中文規則（騰訊 QQ遊戲、萊頓大學的頁面）給虎與獅相同的跳躍能力。Mistboard 與 MistyJungle 0.0.6 在 2026 年 9 月改用中文規則；本文中的棋局是在舊規則下進行的。',
  "Capture order, strongest to weakest. Each animal captures to the right. The rat also captures the elephant. A piece in the opponent's trap counts as rank zero.":
    '吃子等級，由強到弱。每隻動物可以吃掉右邊的動物。鼠還能吃象。位於對方陷阱中的棋子等級視為零。',
  'Beyond plain capture-by-rank, three rules give the game its tactics:':
    '除了單純按等級吃子之外，還有三條規則造就了這個遊戲的戰術：',
  '**Rat beats elephant, but only on land.** The weakest piece captures the strongest. Captures can’t cross the bank, though, so a rat that swims into the water is safe from everything except another rat.':
    '**鼠可吃象，但只限陸上。**最弱的棋子能吃掉最強的棋子。不過吃子不能跨越岸邊，因此游入水中的鼠除了另一隻鼠之外不受任何威脅。',
  '**Lions and tigers jump the rivers.** Only the rat may enter the water. The big cats instead leap a whole river to the far bank, sideways or lengthwise, unless a rat sits in the water and blocks the jump.':
    '**獅與虎可跳河。**只有鼠能進入水中。大貓則躍過整條河落到對岸，橫向或縱向均可，除非有鼠停在水中阻擋跳躍。',
  '**A trapped piece loses its rank.** The three squares around each den are traps. An enemy piece standing on one drops to rank zero, so anything, even a rat, can capture it.':
    '**落入陷阱的棋子失去等級。**每個獸穴周圍的三格為陷阱。站在其上的敵方棋子等級降為零，因此任何棋子，甚至是鼠，都能吃掉它。',
  'Full rules with a playable board: [Jungle Chess rules](/rules/jungle).':
    '完整規則與可對弈棋盤：[鬥獸棋規則](/rules/jungle)。',
  'A small edge in a game where strong engines draw most of their games:':
    '在一個強引擎多半下成和棋的遊戲中取得的小幅優勢：',
  'Open-source benchmark, 200 games': '開源基準，200 局',
  'W11-L2-D187, about **+16 Elo**': 'W11-L2-D187，約 **+16 Elo**',
  'Search polish (ordering, PVS, LMR)': '搜尋打磨（排序、PVS、LMR）',
  '**+49 Elo**, paired self-play, p = 0.008': '**+49 Elo**，配對自我對弈，p = 0.008',
  'Four-piece tablebase check': '四子殘局庫核對',
  '779/800 matched, **0 WDL contradictions**': '779/800 相符，**0 處勝/和/負矛盾**',
  'Five and six pieces': '五子與六子',
  '**>99%** vs an 8x deeper search (proxy, not proof)':
    '對上深度 8 倍的搜尋 **>99%**（代理指標，非證明）',
  'Tablebase at the search leaf': '搜尋葉節點的殘局庫',
  'W37-L40-D3, about **-13 Elo**': 'W37-L40-D3，約 **-13 Elo**',
  'Residual neural eval': '殘差式神經評估',
  'best about **-70 Elo**': '最佳約 **-70 Elo**',
  'The +49 was the hard one to measure. Two even Jungle engines draw too much for a win-rate gate, so I used paired, color-swapped self-play (every opening played both ways, new search against old) and a sign test on the decisive games.':
    '+49 是最難量測的一項。兩個實力相當的鬥獸棋引擎和棋太多，無法用勝率作為門檻，所以我採用配對、交換先後手的自我對弈（每個開局都下正反兩遍，新搜尋對舊搜尋），再對分出勝負的對局做符號檢定。',
  'Endgames and the state of the solve': '殘局與求解現況',
  'Small endgames yield to retrograde analysis, and they make excellent judges. Van Rijn and Vis solved four pieces at Leiden in 2013 (under the Leiden convention, which swaps dog and wolf), and I can find nothing larger published since. My engine matched exact four-piece play on 779 of 800 positions with no WDL contradictions, and tracked an 8x deeper search above 99% at five and six pieces.':
    '小型殘局可用逆向分析攻克，而且它們是極佳的裁判。Van Rijn 與 Vis 於 2013 年在萊頓解出四子殘局（依萊頓慣例，狗與狼互換），此後我找不到更大的已發表結果。我的引擎在 800 個局面中有 779 個與精確的四子著法相符，沒有勝/和/負矛盾，並在五子與六子上與深度 8 倍的搜尋吻合超過 99%。',
  'That four-piece database is still the frontier, and the wall past it is storage, not solving technique. The board is the problem: 63 squares against the 16 of [Flip Jungle](/blog/flip-jungle-skill-ceiling), so each added piece has some 60 empty squares to stand on instead of a dozen, and the level sizes grow about five times faster. Five Flip Jungle pieces fit in 2.8 GB on my laptop; five Dou Shou Qi pieces run to roughly 7 TB. Eight pieces and up, half the starting material, is out of reach as a database, and nobody has a forward proof of the full sixteen-piece game either. Dou Shou Qi is solved to four pieces and open above it, and likely to stay that way.':
    '四子資料庫仍是前沿，而擋在其後的牆是儲存空間，不是求解技術。問題出在棋盤：63 格對上[翻翻棋](/blog/flip-jungle-skill-ceiling)的 16 格，因此每多一子就有大約 60 個空格可站，而不是十來個，每一層的大小成長速度約快五倍。五子的翻翻棋在我的筆電上只要 2.8 GB；五子的鬥獸棋則約需 7 TB。八子以上，也就是初始子力的一半，以資料庫形式已不可及，也沒有人對完整十六子的遊戲做出正向證明。鬥獸棋已解到四子，之上仍未解，而且很可能維持這樣。',
  'Corrected 27 September 2026: an earlier version put the frontier at seven pieces. That figure came from a citation in a 2019 paper, which on inspection points to a Leiden thesis on Jungle Checkers, a different game.':
    '2026 年 9 月 27 日更正：本文先前的版本稱前沿為七子。這個數字來自一篇 2019 年論文中的引用，查證後發現它指向萊頓一篇關於 Jungle Checkers 的論文，那是另一種遊戲。',
  "A tablebase loaded at the search leaf also added nothing to playing strength (about -13 Elo): search already finds the answer at the sizes that fit, and the sizes where it would help don't ship. One caveat from the Flip Jungle build, where the same experiment first read as null and later turned out to be hiding a bug: those tables stored win/draw/loss with no distance, and a WDL-only leaf lets the engine hold a won endgame forever without finishing it, since every winning move grades the same. Adding distance-to-mate to the tables fixed the finishing there. My Jungle leaf probe was WDL-only too, so some of that -13 may be the same effect rather than tablebases being useless at the leaf. Untested; the classical engine ships without the probe either way.":
    '在搜尋葉節點載入殘局庫對棋力也毫無助益（約 -13 Elo）：在容得下的規模上搜尋本來就能找到答案，而真正需要幫助的規模則根本做不出來。有一點提醒來自翻翻棋那次構建：同一個實驗一開始也顯示為無效，後來才發現藏著一個 bug。那些表只儲存勝/和/負而沒有距離，而只有勝/和/負的葉節點會讓引擎在已勝的殘局裡無限拖延而不收官，因為每一著獲勝著法的分數都一樣。把將死距離加進表裡，就修好了那邊的收官問題。我的鬥獸棋葉節點探查同樣只有勝/和/負，所以那 -13 有一部分可能是同樣的效應，而不是殘局庫在葉節點真的沒用。未經測試；無論如何，出貨的經典引擎都不帶這個探查。',
  'Learned eval': '學習式評估',
  'This stalled on data, not architecture. A residual net (the handcrafted score plus a bounded correction) climbed from -470 to about -70 Elo as I fixed the labels, but never beat the hand eval. The labels were weakest exactly where the net needed help: draw-heavy self-play underrepresents material swings, exact tablebase labels only cover small endgames, and search-score labels mostly teach the net to imitate the search it already has.':
    '這部分卡在資料，而不是架構。一個殘差網路（手寫分數加上有界修正）隨著我修正標籤，從 -470 爬到約 -70 Elo，但始終沒能勝過手寫評估。標籤最弱的地方恰好正是網路最需要幫助的地方：和棋偏多的自我對弈對子力擺盪的呈現不足，精確的殘局庫標籤只涵蓋小型殘局，而搜尋分數的標籤大多只是教網路模仿它本來就有的搜尋。',
  AlphaZero: 'AlphaZero',
  'Still open work. I did not run a full Jungle AZ climb. The adjacent Banqi AZ de-risk failed its gate, but that is a different game and does not falsify AZ for Jungle, which is friendlier ground: deterministic and perfect-information, with no chance-node reveal. I parked it because the cheap rung was negative and the classical engine already beat the benchmark.':
    '仍是未完成的工作。我沒有跑完整的鬥獸棋 AZ 攀升。鄰近的暗棋 AZ 風險驗證沒過門檻，但那是不同的遊戲，並不能否定 AZ 在鬥獸棋上的可行性；鬥獸棋是更友善的場地：決定性、完全資訊，沒有機率節點的揭示。我把它擱置，是因為便宜的那一階是負面的，而經典引擎已經勝過基準了。',
  'Example games': '對局範例',
  'The match was mostly draws, but the decisive games show the shape of the edge: den pressure first, material second. The boards open near the conversion, so step back for the opening; all six are in a [study on Mistboard](/study/xzzhAld5). They were played under the lengthwise-only tiger rule Mistboard used until September 2026.':
    '這場對抗賽大多是和棋，但分出勝負的棋局顯示了優勢的形狀：先施加獸穴壓力，子力其次。棋盤是從接近轉化的位置開始呈現的，想看開局請往前回放；全部六局都收在 [Mistboard 上的一份研究](/study/xzzhAld5)裡。它們是在 Mistboard 到 2026 年 9 月前使用的「虎只能縱向跳河」規則下進行的。',
  'MistyJungle (black) builds a material lead and finishes with a lion in red’s den:':
    'MistyJungle（黑方）建立子力優勢，最後以獅進入紅方獸穴收官：',
  "MistyJungle (black) wins, a lion in red's den": 'MistyJungle（黑方）獲勝，獅進入紅方獸穴',
  'Another black win, a shorter squeeze where the last piece reaches d1 after exchanges around the trap:':
    '另一局黑方獲勝，是較短的擠壓，在陷阱周圍的兌子之後，最後一子抵達 d1：',
  'MistyJungle (black) reaches the den after an 80-ply squeeze':
    'MistyJungle（黑方）經過 80 著的擠壓後抵達獸穴',
  'A red win that shows why you can’t just count material: MistyJungle loses material but wins the den race:':
    '一局紅方獲勝，說明為什麼不能只算子力：MistyJungle 子力落後，卻贏下了衝獸穴競速：',
  'MistyJungle (red) wins the den race down material':
    'MistyJungle（紅方）在子力落後的情況下贏得衝獸穴競速',
  'The longest saved win, red grinding through 283 plies before reaching the den:':
    '保存下來最長的一場勝局，紅方磨了 283 著才抵達獸穴：',
  'MistyJungle (red) grinds out a 283-ply win': 'MistyJungle（紅方）磨出一場 283 著的勝利',
  'The engine against itself at 8M nodes a move, about five seconds each: a long even fight where red nurses a one-piece edge for forty moves, then converts and walks a lion into black’s den:':
    '引擎以每著 8M 節點自我對弈，每著約五秒：一場漫長的均勢對抗，紅方守著一子的優勢四十個回合，然後完成轉化，把獅走進黑方獸穴：',
  'MistyJungle against itself at 8M nodes: a one-piece edge converted':
    'MistyJungle 以 8M 節點自我對弈：一子優勢成功轉化',
  'More dramatic still, also a mirror game at 8M nodes: red lets black keep the elephant, lion, and tiger, falls sixteen points behind in material, and wins anyway by racing a rat into the den before that material can matter. The clearest statement of what the engine is actually optimizing:':
    '更戲劇性的一局，同樣是 8M 節點的自我對弈：紅方讓黑方保住象、獅、虎，子力落後十六分，卻仍靠著在子力發揮作用之前把鼠搶進獸穴而獲勝。這最清楚地說明了引擎實際在最佳化什麼：',
  "MistyJungle against itself at 8M nodes: down sixteen, red's rat reaches the den first":
    'MistyJungle 以 8M 節點自我對弈：落後十六分，紅方的鼠先抵達獸穴',
  Conclusion: '結論',
  'MistyJungle is a classical search engine with a narrow, measured edge over the strongest open-source engine I could run. The work that moved strength was unglamorous: correct rules, fixed-budget measurement, color-swapped tests, search polish, and endgame validation. Tablebases judged well but did not help at the leaf, the first neural rung lost to the hand eval, and a real AlphaZero climb is still open work.':
    'MistyJungle 是一個經典搜尋引擎，對我能執行的最強開源引擎握有幅度不大但可量測的優勢。真正推動棋力的工作都不華麗：正確的規則、固定預算的量測、交換先後手的測試、搜尋打磨，以及殘局驗證。殘局庫很擅長當裁判，但在葉節點沒有幫助；第一階的神經嘗試輸給手寫評估；而真正的 AlphaZero 攀升仍是未完成的工作。',
  '[misty-jungle](https://github.com/brianhliou/misty-jungle) is the engine, in Rust. [Layheng-Hok/Jungle-Chess](https://github.com/Layheng-Hok/Jungle-Chess) is the open-source engine I used as the fixed benchmark. [Bagheera](https://liacs.leidenuniv.nl/~visjk/doushouqi/) is Leiden’s closed-source engine and the endgame tablebases I graded against. More in the engine series: [MistyBanqi](/blog/mistybanqi), the same measurement discipline on Chinese Dark Chess.':
    '[misty-jungle](https://github.com/brianhliou/misty-jungle) 是引擎本體，以 Rust 撰寫。[Layheng-Hok/Jungle-Chess](https://github.com/Layheng-Hok/Jungle-Chess) 是我用作固定基準的開源引擎。[Bagheera](https://liacs.leidenuniv.nl/~visjk/doushouqi/) 是萊頓的閉源引擎，也是我用來評分的殘局庫。引擎系列更多內容：[MistyBanqi](/blog/mistybanqi)，在暗棋上運用同樣的量測紀律。',
  'MistyJungle is on Mistboard as the easier of the two jungle bots. Take it on, or read its source.':
    'MistyJungle 在 Mistboard 上是兩個鬥獸棋電腦中較容易的那一個。來挑戰它，或者讀讀它的原始碼。',
  'Play MistyJungle': '挑戰 MistyJungle',
  'misty-jungle on GitHub': 'GitHub 上的 misty-jungle',
  'Jungle Chess Rules': '鬥獸棋規則',
  // jungle-den-term: restored 2026-10-24, not native-reviewed; 66 strings reused from the brianhliou.com zh-hans and zh-hant posts where they still say what the moved English says, 9 machine-drafted for text the move changed or added.
  'Teaching our Jungle Chess engine the den race bought nothing':
    '教鬥獸棋引擎衝獸穴競速，毫無收穫',
  'Misty, our Jungle Chess engine, has no idea of a den race. Three ways to teach it one came back null or negative: races decide 4.7% of games at full strength, and a 12 times deeper search sees the loss a median of one ply sooner.':
    'Misty 是我們的鬥獸棋引擎，它完全沒有衝獸穴競速的概念。三種教它的方式，結果都是無效或負向：在全力對弈中，競速只決定 4.7% 的對局，而搜尋深度提高 12 倍，看出敗勢的時間中位數只提早一著。',
  'Misty, Mistboard’s Jungle Chess engine, has no idea of a den race, so we tried three ways to teach it one. All three came back null or negative.':
    'Misty 是 Mistboard 的鬥獸棋引擎，它完全沒有衝獸穴競速的概念，於是我們試了三種方式教它。三種結果都是無效或負向。',
  'Den races decide only 4.7% of games at full strength (a weak-search test said 22%), and searching 12 times deeper sees the loss a median of one ply sooner.':
    '在全力對弈強度下，衝獸穴競速只決定 4.7% 的對局（弱搜尋測試給出 22%），而搜尋深度提高 12 倍，看出敗勢的時間中位數也只提早一著。',
  'A search extension near the dens looked like +45 Elo until we held the node budget fixed; then it was slightly negative. A dedicated den-race term was null.':
    '獸穴附近的搜尋延伸看起來有 +45 Elo，直到我們把節點預算固定下來；此時它變成略為負向。專門的衝獸穴競速評估項則是無效。',
  'Hold the budget fixed or you are measuring the budget. Two constants from the same games, a draw clock and draw contempt, doubled the share of decisive games instead.':
    '要固定預算，否則你量到的只是預算本身。反倒是從同一批對局裡找出的兩個常數，和棋步數限制與和棋蔑視值，讓分出勝負的對局比例翻倍。',
  'Base rate from 172 self-play games at the production budget of five million nodes a move.':
    '基準比率來自 172 局自我對弈，採用每著五百萬節點的生產預算。',
  'Headroom: in each of the 8 den races, the earliest ply at which five and sixty million nodes see the forced loss.':
    '餘裕：在 8 場衝獸穴競速中的每一場，五百萬節點與六千萬節點分別最早在哪一著看出必敗。',
  'The search extension tested as a harness policy that gives one side more nodes near an enemy den, 300 colour-swapped pairs per arm, with and without a fixed node budget.':
    '搜尋延伸以測試框架策略的形式測試：棋子靠近敵方獸穴時給該方更多節點，每組 300 對換色對局，分別在固定與不固定節點預算下進行。',
  'Misty, Mistboard’s Jungle Chess engine, has no concept of a den race. It scores a position by material plus a per-piece bonus for advancing toward the enemy den, and never asks whether the runner heading for *its* den arrives first. It finds out when the search reaches the den, about twelve plies out.':
    'Misty 是 Mistboard 的鬥獸棋引擎，它沒有衝獸穴競速的概念。它以子力加上每個棋子朝敵方獸穴推進的獎勵來評估局面，從不去問那個衝向*自己*獸穴的跑者是不是先到。它要等搜尋抵達獸穴時才知道，大約在十二著之外。',
  'That looked like a clear gap, filed as an issue after a game where the bot shuffled a rat back and forth while an enemy rat walked in. In August we spent a day trying to close it. Three routes, all null or negative. This is what the measurements said and what we would keep from them.':
    '這看起來是個明顯的缺口，在一局機器人把鼠來回挪動、而敵方鼠走進獸穴的對局之後，它被記成了一個 issue。8 月我們花了一天試著補上它。三條路線，全部無效或負向。以下是量測結果，以及我們會從中留下什麼。',
  'What the engine already does': '引擎本來就會做的事',
  'Worth separating, because it framed everything after. The engine understands the win condition completely: reaching the den is scored as mate, ordered first among candidate moves, and searched in quiescence. What it lacks is foresight, not comprehension.':
    '值得分開來講，因為它決定了後面的一切。引擎對取勝條件的理解是完整的：抵達獸穴被評為將死，在候選著法中排在第一位，也會在靜態搜尋中被搜到。它缺的是預見，不是理解。',
  'It wins anyway, because Jungle is material-dominated and the evaluation reads material exactly. At the moment of den entry the median winner is 20 points ahead, about one cat. Only 4.7% of games are won by a side that was level or behind. How the engine is built, and how it measured against other engines, is in [A Dou Shou Qi engine](/blog/dou-shou-qi-engine).':
    '它反正還是會贏，因為鬥獸棋由子力主導，而評估值精確地讀出子力。在進入獸穴的那一刻，勝方的中位數領先 20 分，大約一隻貓。只有 4.7% 的對局是由持平或落後的一方取勝。引擎是怎麼打造的，以及它與其他引擎對比的量測結果，見[鬥獸棋引擎](/blog/dou-shou-qi-engine)一文。',
  'What it plays without the concept': '沒有這個概念時它會怎麼下',
  'Game 10 of the study turns on four moves, and it settles the question better than any table below.':
    '研究中的第 10 局取決於四著棋，卻比下面任何表格都更能說明問題。',
  'Jungle’s middle is three ranks of water, and the d-file runs between the two lakes, one square wide. Under the rules Mistboard used when these games were played, tigers jumped water lengthwise only, never sideways, so a tiger standing in that corridor had almost nowhere to go. Since 21 September the tiger jumps sideways too, like the lion, following the Chinese rule sets; the corridor is no longer a trap for it, and the line below is a line from the old rule.':
    '鬥獸棋的中路是三列水域，d 路夾在兩條河之間，只有一格寬。在這些對局進行時 Mistboard 採用的規則下，虎只能沿縱向跳水，不能橫向跳，因此站在那條走廊裡的虎幾乎無處可去。自 9 月 21 日起，虎也能像獅一樣橫向跳水，依循中國的規則版本；那條走廊對它已不再是陷阱，下面這條變化是舊規則下的變化。',
  'Move 20, Blue to play. Red’s tiger has just taken a wolf on d6 and stands in the corridor, one square below Blue’s elephant, which outranks it.':
    '第 20 回合，藍方行棋。紅方的虎剛在 d6 吃掉一隻狼，現在站在走廊裡，在藍方象下方一格，而象的等級高於它。',
  'Game 10, move 20, Blue to play': '第 10 局，第 20 回合，藍方行棋',
  'On move 20 Red’s tiger on d5 had two legal moves, forward or back, both still in the corridor. It went forward and took the wolf, which cost Blue 40 points and parked the tiger next to Blue’s elephant.':
    '在第 20 回合，紅方位於 d5 的虎只有兩個合法著法，向前或向後，都還在走廊裡。它往前吃掉了狼，讓藍方損失 40 分，並把虎停在藍方象的旁邊。',
  'Blue’s elephant outranks a tiger, so this looks like a gift. Blue declined to take it at once, which is the move the issue asked us to explain. The engine’s reason is that the tiger could not escape: with the elephant on d7 the tiger’s only move was d5, and from d5 its only move was d4, walked down a one-lane corridor by a piece that beats it. Grabbing it costs a tempo to collect something already collected. Blue played a free improving move and took the tiger two moves later, on d5 instead of d6. Both lines reach identical material.':
    '藍方的象等級高於虎，所以這看起來像是送禮。藍方沒有立刻吃掉它，而這正是那個 issue 要我們解釋的一著。引擎的理由是那隻虎逃不掉：象在 d7 時，虎唯一的著法是 d5，而從 d5 唯一的著法是 d4，被一個能吃掉它的棋子沿著單線走廊一路趕下去。馬上吃掉它，等於花一個先手去收一個已經收下的東西。藍方走了一步免費的改善著法，兩回合之後才吃掉虎，地點在 d5 而不是 d6。兩條變化到達的子力完全相同。',
  'The four moves that decided the game, by ply:': '決定這局勝負的四著，按著序編號：',
  'The tiger was bait. Not a sacrifice: it was nearly trapped anyway, and taking the wolf scored +10 against +6 for almost every alternative, a difference of four points rather than a plan. What it does on its way off the board is pull the one piece that outranks a lion down the d-file. At move 20 the lion jump scores **−195**, because c7 sits next to Blue’s elephant on d7. Two moves later the same jump wins, because the elephant left.':
    '那隻虎是誘餌。不是棄子：它反正幾乎已被困住，而吃狼得 +10 分，幾乎所有其他選擇都是 +6，差距只有四分，而不是一套計畫。它在離開棋盤的路上做到的，是把唯一等級高於獅的棋子拉到 d 路下方。在第 20 回合，獅的跳躍評估為 **−195**，因為 c7 緊鄰藍方在 d7 的象。兩回合之後，同樣的跳躍就取勝了，因為象走開了。',
  'Blue ends the sequence 13 points ahead and loses.': '藍方在這段變化結束時領先 13 分，然後輸了。',
  'Read the plan back and it sounds like the engine understood a den race. It did not. There is no den-race term anywhere in that evaluation, before or after this project. It searched five million nodes and the line came out. That is the whole result: the behaviour the issue wanted to install was already there, produced by depth rather than knowledge.':
    '把這套計畫回述一遍，聽起來像引擎理解了衝獸穴競速。它並沒有。在那套評估裡，這個專案前後都不存在任何衝獸穴競速評估項。它搜了五百萬個節點，這條變化就出來了。整個結果就是這樣：那個 issue 想裝進去的行為本來就在，是由深度而不是知識產生的。',
  'Base rate: 4.7% of games, measured at full strength':
    '基準比率：4.7% 的對局，在全力對弈強度下量測',
  '172 self-play games at the production budget of five million nodes a move.':
    '以每著五百萬節點的生產預算進行的 172 局自我對弈。',
  'Game ended by': '終局方式',
  'Den entry': '進入獸穴',
  'of which a genuine race': '其中真正的競速',
  'A genuine race is a game won by a side that was level or behind ten plies before the end.':
    '真正的競速，指勝方在終局前十著時仍持平或落後的對局。',
  'The same harness at 200k nodes reports 22% races. Weaker play inflates the number about fivefold. The cheap measurement was available, and it would have been wrong by 5× in the direction that justifies more work.':
    '同一套測試框架在 200k 節點下報告 22% 是競速。棋力較弱會把這個數字誇大約五倍。便宜的量測方法本來就有，而它會在「讓人覺得值得多做事」的方向上錯了 5 倍。',
  'Headroom: a 12× deeper search buys about one ply': '餘裕：搜尋深度提高 12 倍只換到約一著',
  'For each of the 8 races we binary-searched the loser’s game for the earliest ply at which each budget recognises the forced loss, then took the gap.':
    '對 8 場競速中的每一場，我們在敗方的對局裡用二分搜尋找出每個預算最早能辨認出必敗的那一著，再取兩者的差距。',
  'Seen sooner by 60M nodes': '60M 節點提早看出',
  Races: '競速局數',
  '0 plies': '0 著',
  '2 plies': '2 著',
  '4 plies': '4 著',
  '60 million nodes a move against 5 million, over the 8 genuine races.':
    '每著六千萬節點對上五百萬節點，共 8 場真正的競速。',
  'Sixty million nodes against five million, and the deeper search sees the loss a median of one ply earlier: at most four, and no earlier at all in half the races. Before that horizon the two track closely, diverging only in the last ply or two.':
    '六千萬節點對上五百萬節點，較深的搜尋看出敗勢的時間中位數只早了一著：最多四著，而在一半的競速裡完全沒有提早。在那個視界之前，兩者走勢相當接近，只在最後一兩著才分歧。',
  'This is the number that should have ended the project. If twelve times the search recovers about a ply, the information is not sitting there waiting for a cleverer evaluation to surface it.':
    '這就是應該讓這個專案終止的數字。如果十二倍的搜尋只換回大約一著，那些資訊就不是擺在那裡等著更聰明的評估去挖出來。',
  'Route A: a search extension, free and paid': '路線 A：搜尋延伸，免費版與付費版',
  'Probed without building it. A harness policy grants one side a larger node budget whenever a piece is within R squares of an enemy den, which is a strict upper bound on any real extension.':
    '不用實作就能先探測。測試框架的一項策略是：只要有棋子位於敵方獸穴 R 格之內，就給該方更大的節點預算，這是任何真實延伸的嚴格上界。',
  'First finding, before any Elo: the trigger is not sparse.':
    '在算任何 Elo 之前的第一個發現：觸發條件並不稀疏。',
  Radius: '半徑',
  'Plies where it fires': '觸發的著數比例',
  'Jungle’s board is small and dens sit on the back ranks. At R=4, the radius needed to see a race early, the extension is just “search twelve times more everywhere”, so the surgical framing was wrong from the start.':
    '鬥獸棋的棋盤很小，獸穴又在底線。在 R=4，也就是要及早看出競速所需的半徑下，這個延伸其實就是「到處都多搜十二倍」，所以「精準手術」這個框架從一開始就錯了。',
  'At R=2, 300 colour-swapped pairs per arm:': '在 R=2，每組 300 對換色對局：',
  Arm: '組別',
  'Nodes vs control': '節點數與對照組之比',
  '12× depth near dens, granted free': '獸穴附近 12 倍深度，免費給予',
  'Budget-neutral: 3.7M base, 10M near dens': '預算中性：基礎 3.7M，獸穴附近 10M',
  'Budget-neutral: 1.1M base, 20M near dens': '預算中性：基礎 1.1M，獸穴附近 20M',
  'Same idea, same code, opposite sign. The engine’s five million nodes are fixed by how long a player will wait, so a real extension cannot conjure depth: it takes it from the rest of the search. The free arm measured the extra compute, nothing about dens.':
    '同一個想法、同一份程式碼，符號相反。引擎的五百萬節點是由玩家願意等多久決定的，所以真實的延伸無法憑空變出深度：它只能從搜尋的其他部分拿。免費那組量到的是額外的運算量，跟獸穴毫無關係。',
  'We ran the budget-neutral arm because +45 looked too good. Stopping there would have bought a week of work for a feature worth slightly less than zero.':
    '我們跑了預算中性那組，是因為 +45 看起來好得不像真的。若停在那裡，就會為一個價值略低於零的功能買下一週的工作量。',
  'Both arms cost an afternoon, because neither required touching the engine. The extension was a harness policy that varies the node budget on a board condition. For any proposal of the form “make it smarter about X”, granting it free perfect X first is the cheapest way to find out whether X matters at all.':
    '兩組都只花了一個下午，因為兩者都不需要動引擎。那個延伸只是測試框架裡依棋盤條件調整節點預算的一項策略。對任何形如「讓它對 X 更聰明」的提案，先免費給它完美的 X，是判斷 X 到底有沒有關係最便宜的方法。',
  'Route B: the term itself': '路線 B：評估項本身',
  'We built it anyway, because the extension failed for a reason that does not apply to an evaluation term. An extension costs nodes; a term costs almost nothing per leaf.':
    '我們還是做了，因為延伸失敗的理由並不適用於評估項。延伸要花節點；評估項在每個葉節點幾乎不花成本。',
  'Here is the evaluation as it stood. One loop over the board, and every piece contributes independently:':
    '這是當時的評估函式。在棋盤上跑一圈，每個棋子各自獨立貢獻：',
  'That advancement term is why the evaluation is blind to a race, and the reason is the symmetry. Our runner three squares from your den scores +39. Your runner three squares from ours scores −39. Both sides sprinting produces a number near zero, and the position reads quiet at exactly the moment it is most decided.':
    '那個推進項就是評估對競速視而不見的原因，而原因在於對稱性。我們的跑者離你的獸穴三格是 +39。你的跑者離我們的獸穴三格是 −39。雙方都在衝刺時算出來接近零，於是局面在最已成定局的那一刻讀起來一片平靜。',
  'So the term cannot be another per-piece bonus. It has to be one verdict per side, computed once, comparing the two runners against each other:':
    '所以這個評估項不能是另一個逐棋子的獎勵。它必須是每方一個判定，只算一次，並把兩個跑者互相比較：',
  'The defender is measured to the **trap ring**, not to the den. That is the right interception zone because a den’s three neighbours *are* its three traps, and a piece standing on a trap can be captured by any defender regardless of rank. An elephant walking into your den has to cross a square where your rat can take it.':
    '防守方的距離是量到**陷阱環**，而不是量到獸穴。那才是正確的攔截區，因為獸穴的三個鄰格*就是*它的三個陷阱，而站在陷阱上的棋子可以被任何防守方吃掉，不論等級。走進你獸穴的象必須經過一格，讓你的鼠可以吃掉它。',
  'It changes the chosen move in 17% of the positions it was designed for, and costs about 17% wall clock at equal nodes. Over 300 colour-swapped pairs per weight, before charging that cost:':
    '在它原本針對的局面中，它改變了 17% 的選著，並在節點數相同時多花約 17% 的實際耗時。在每個權重 300 對換色對局、且尚未計入該成本的情況下：',
  Weight: '權重',
  'Null, in the generous direction.': '無效，而且是在對它有利的方向上。',
  'What we would keep': '我們會留下的東西',
  'Hold the budget constant, or you are measuring the budget. The free version of an experiment is the convenient one to build and it hands you a confident positive number. Whatever the change would have to take from, take it, and see whether the result survives.':
    '固定預算，否則你量到的只是預算。實驗的免費版本是最方便做的那個，而它會遞給你一個自信的正數。這個改動必須從哪裡挪資源，就從那裡挪，再看結果是否還撐得住。',
  'That trap caught us twice in one day. A contempt sweep the same afternoon showed decisive games rising from 32% to 50%, which is what higher contempt produces by construction, since both sides in a self-play sweep get the setting. Only the two values facing each other could say whether it cost anything. It did not, so that one shipped.':
    '這個陷阱一天之內抓到我們兩次。同一個下午的一次蔑視值掃描顯示分出勝負的對局從 32% 升到 50%，但這本來就是提高蔑視值在結構上必然產生的結果，因為自我對弈掃描中雙方都用了同樣的設定。只有讓兩個數值互相對抗，才能看出它有沒有代價。結果沒有，所以那一項上線了。',
  'The evaluation gap was real and correctly diagnosed. It just had nothing behind it. Two constants found in the same games, a no-capture draw clock that was ending games early and a draw contempt near zero, took Jungle self-play from a quarter of games ending in a win to about half, and neither teaches the engine anything. The issue asked for understanding. Understanding was never the constraint.':
    '評估上的缺口是真的，診斷也正確。只是它背後什麼都沒有。從同一批對局中找到的兩個常數，一個是讓對局過早結束的無吃子和棋限制，另一個是接近零的和棋蔑視值，把鬥獸棋自我對弈從四分之一的對局分出勝負提升到大約一半，而兩者都沒有教引擎任何東西。那個 issue 要的是理解。理解從來不是瓶頸。',
  'The games are public, and so is the position above. The analysis board runs the same engine, under today’s rule where the tiger can jump sideways out of the corridor, so if you think Blue should have taken the tiger you can make it play a line out.':
    '這些對局是公開的，上面那個局面也是。分析棋盤跑的是同一個引擎，採用的是如今虎可以橫向跳出走廊的規則，所以如果你認為藍方當時該吃掉那隻虎，你可以讓它把一條變化走完。',
  'Walk the 52 games': '瀏覽這 52 局',
  'Open the position': '開啟該局面',
  'Back as its own page, with the deeper-search deficit median corrected to 1 ply and the race shares restated.':
    '恢復為獨立頁面，較深搜尋提早看出敗勢的中位數更正為 1 著，競速比例也重新表述。',
  'Dou Shou Qi Engine: Does a Den-Race Term Help?': '鬥獸棋引擎：衝獸穴競速評估項有用嗎？',
  // Homepage card titles (cardTitle), machine-drafted 2026-10-24 from each post's zh title.
  'En Passant Under Fog': '迷霧下的吃過路兵',
  'The Most Played Move': '最多人下的著法',
  'Chess960 Positions Ranked': '西洋棋960開局排名',
  'What a Million Nodes Buys': '一百萬節點換來了什麼',
  'A Dou Shou Qi Engine': '一個鬥獸棋引擎',
  'Teaching Misty the den race': '教 Misty 衝獸穴競速',
};
