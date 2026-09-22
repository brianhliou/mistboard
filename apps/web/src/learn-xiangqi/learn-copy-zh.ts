// Xiangqi Learn — Chinese copy, both scripts.
//
// The course is the site's beginner path into xiangqi, and it was the last
// entirely English one: 221 strings, every one of them already keyed
// ('learn.xiangqi.*') and none of them translated. Nothing had to be refactored
// to fix that, which is why it is two tables rather than a migration -- the
// English lives in learn-copy.ts and the stage files, and `learnCopy` consults
// these first.
//
// Terminology follows what a Chinese-speaking player already calls these things,
// not a translation of the English: 炮架 for the cannon's screen, 马腿 for the
// horse's leg, 象眼 for the elephant's eye, 九宫 for the palace, 困毙 for the
// stalemate that loses. The named mates in the last stage are Chinese to begin
// with, so there the ENGLISH is the gloss and the Chinese simply drops it.
//
// Simplified and Traditional are written out separately rather than converted:
// the piece names themselves differ (车/車, 炮/砲, 马/馬), and a converter run
// over prose is the failure this repo has already had once.
//
// House style, inherited from the English: no em dashes.

export const LEARN_XIANGQI_ZH_HANS: Record<string, string> = {
  // Chrome
  'learn.xiangqi.title': '学下象棋',
  'learn.xiangqi.byPlaying': '边玩边学！',
  'learn.xiangqi.progress': '进度',
  'learn.xiangqi.resetProgress': '重置我的进度',
  'learn.xiangqi.resetConfirm': '你将失去全部进度。确定要重置吗？',
  'learn.xiangqi.menu': '目录',
  'learn.xiangqi.backToMenu': '返回目录',
  'learn.xiangqi.play': '开始',
  'learn.xiangqi.retry': '重试',
  'learn.xiangqi.next': '下一关',
  'learn.xiangqi.nextStage': '下一阶段：',
  'learn.xiangqi.levelFailed': '本关失败',
  'learn.xiangqi.stage': '阶段',
  'learn.xiangqi.stageComplete': '已完成',
  'learn.xiangqi.yourScore': '你的得分：',
  'learn.xiangqi.letsGo': '开始吧！',
  'learn.xiangqi.whatNext': '接下来学什么？',
  'learn.xiangqi.whatNextCopy': '恭喜，你已经会下象棋了！想再进一步，变得更强吗？',

  // Categories
  'learn.xiangqi.categ.pieces': '象棋棋子',
  'learn.xiangqi.categ.fundamentals': '基本功',
  'learn.xiangqi.categ.intermediate': '进阶',
  'learn.xiangqi.categ.advanced': '高级',

  // Congrats pool
  'learn.xiangqi.congrats.1': '不错！',
  'learn.xiangqi.congrats.2': '漂亮！',
  'learn.xiangqi.congrats.3': '干得好！',
  'learn.xiangqi.congrats.4': '完美！',
  'learn.xiangqi.congrats.5': '精彩！',
  'learn.xiangqi.congrats.6': '就是这样！',
  'learn.xiangqi.congrats.7': '好，好，好！',
  'learn.xiangqi.congrats.8': '你很有天分！',

  'learn.xiangqi.next.register': '注册',
  'learn.xiangqi.next.registerSub': '排位对局、题目等级分和个人主页',
  'learn.xiangqi.next.puzzles': '题目',
  'learn.xiangqi.next.puzzlesSub': '磨练你的战术',
  'learn.xiangqi.next.playPeople': '与人对弈',
  'learn.xiangqi.next.playPeopleSub': '来自世界各地的对手',
  'learn.xiangqi.next.playMachine': '与机器对弈',
  'learn.xiangqi.next.playMachineSub': '一级一级挑战机器人',
  'learn.xiangqi.next.videos': '视频',
  'learn.xiangqi.next.videosSub': '观看象棋教学视频',
  'learn.xiangqi.next.watch': '观战',
  'learn.xiangqi.next.watchSub': '追看顶级赛事对局',

  // Shared goals
  'learn.xiangqi.goal.grabAllTheStars': '把所有星星都吃掉！',

  // 1. The chariot
  'learn.xiangqi.chariot.title': '车',
  'learn.xiangqi.chariot.subtitle': '直线行走',
  'learn.xiangqi.chariot.intro': '车是盘上最强的子。它沿着横线或竖线走任意远。点击或拖动来走子。',
  'learn.xiangqi.chariot.complete': '恭喜！你会用车了。多数棋局是靠车赢下来的，所以要及早出车。',
  'learn.xiangqi.chariot.goal.1': '点一下车，把星星吃掉！',
  'learn.xiangqi.chariot.goal.2': '两颗星，两步棋。有一颗已经在你的线上，先吃那一颗！',
  'learn.xiangqi.chariot.goal.3': '自己的兵挡住了路，而车不能跳过去。绕一条路出来！',
  'learn.xiangqi.chariot.goal.4':
    '被自己的子围住了！只有一个出口通向星星。选对它，然后一路扫过去。',
  'learn.xiangqi.chariot.goal.5': '五颗星，五步棋。别只盯着最近的那一颗：先看清整盘，再顺着线走！',

  // 2. The cannon
  'learn.xiangqi.cannon.title': '炮',
  'learn.xiangqi.cannon.subtitle': '隔着炮架吃子',
  'learn.xiangqi.cannon.intro':
    '炮走起来和车一样，但吃子的方式不同：它必须隔着正好一个子跳过去，这个子叫炮架。任何子都可以当炮架，你的或对方的都行。',
  'learn.xiangqi.cannon.complete':
    '很好！炮是象棋里最刁钻的子。记住：吃子要有炮架，走子则不能有。最有名的几种杀法都少不了炮：马后炮和重炮就在「基本杀法」里等着你。',
  'learn.xiangqi.cannon.goal.1': '炮走起来和车一样。把星星吃掉！',
  'learn.xiangqi.cannon.goal.2': '两颗星，两步棋。走子不需要跳。',
  'learn.xiangqi.cannon.goal.3': '要吃子，炮得隔着一个炮架跳过去。借你的兵当炮架，吃掉黑卒！',
  'learn.xiangqi.cannon.goal.4': '没有炮架就吃不了子。先到兵的后面排好，再吃黑卒。',
  'learn.xiangqi.cannon.goal.5': '对方的子也是好炮架。隔着它们，把后面的子吃掉！',
  'learn.xiangqi.cannon.goal.6': '黑车停在你的马后面了。轰掉它！',
  'learn.xiangqi.cannon.goal.7': '四次吃子，一趟走完。每一次吃子都要有自己的炮架。',

  // 3. The horse
  'learn.xiangqi.horse.title': '马',
  'learn.xiangqi.horse.subtitle': '先直一步，再斜一步',
  'learn.xiangqi.horse.intro':
    '马先沿直线走一格，再斜着往外走一格。它不能跳过棋子：第一格上有子就走不了，那一格叫马腿。',
  'learn.xiangqi.horse.complete':
    '骑得好！记住马腿：空旷处的马很强，被蹩了腿的马寸步难行。要盯着马腿，你的和对方的都要看。最好的几个马位甚至有几百年的老名字：卧槽马和钓鱼马都在「基本杀法」里等你。',
  'learn.xiangqi.horse.goal.1': '直一步，斜一步。把星星吃掉！',
  'learn.xiangqi.horse.goal.2': '四颗星，四次跳。每一次拐的方向都不一样。',
  'learn.xiangqi.horse.goal.3': '把星星全部吃掉。马可以往八个方向跳。',
  'learn.xiangqi.horse.goal.4': '马腿上有子就跳不过去。兵蹩住了近路，绕开它走！',
  'learn.xiangqi.horse.goal.5': '前面两条马腿都被蹩住了。从侧面绕过去，顺着星星走。',
  'learn.xiangqi.horse.goal.6': '六颗星，六次跳。每次起跳前先看清马腿！',

  // 4. The elephant
  'learn.xiangqi.elephant.title': '象',
  'learn.xiangqi.elephant.subtitle': '走田字，不过河',
  'learn.xiangqi.elephant.intro':
    '象斜着走两格，正好是一个田字。田字中心那一格叫象眼，被占住就走不了。象永远不能过河：它守着自己这半边。',
  'learn.xiangqi.elephant.complete':
    '很好！象一辈子只走得到自己这边的七个点。它是防守子：留在家里护着将帅。',
  'learn.xiangqi.elephant.goal.1': '斜走两格，一步到位。把星星吃掉！',
  'learn.xiangqi.elephant.goal.2': '一个点一个点地跳过去，把两颗星都吃掉。',
  'learn.xiangqi.elephant.goal.3': '中间那一格有子，象眼被塞住了。绕个路走！',
  'learn.xiangqi.elephant.goal.4': '象永远不能过河。这些河边的点就是它的最前线：它是守家的子。',
  'learn.xiangqi.elephant.goal.5': '把整张网走一遍！象一共只站得到七个点。',

  // 5. The advisor
  'learn.xiangqi.advisor.title': '士',
  'learn.xiangqi.advisor.subtitle': '不出九宫',
  'learn.xiangqi.advisor.intro':
    '士是将帅的贴身护卫。它每次斜走一格，而且从不离开九宫：整盘只有五个点能放得下它。',
  'learn.xiangqi.advisor.complete':
    '很好！士的一生都在九宫里。把它留在家里：它的全部职责就是护着将帅。',
  'learn.xiangqi.advisor.goal.1': '斜走一格。把星星吃掉！',
  'learn.xiangqi.advisor.goal.2': '士走的每一条路都要经过九宫的中心点。穿过去，把两颗星都吃掉。',
  'learn.xiangqi.advisor.goal.3': '把九宫的四个角都走一遍。每次都要从中心过！',
  'learn.xiangqi.advisor.goal.4': '两个士一起用！单靠远的那个士要走六步，两个配合五步就够了。',

  // 6. The general
  'learn.xiangqi.general.title': '将帅',
  'learn.xiangqi.general.subtitle': '把他稳稳留在九宫里',
  'learn.xiangqi.general.intro':
    '将帅是象棋里最要紧的子。他每次走一格，上下左右都行，但永远不能离开九宫：那九个点就是他的全部天地。',
  'learn.xiangqi.general.complete':
    '你会走将帅了。记住：整盘棋就是围着这一个子打的。丢了他，就什么都没了。',
  'learn.xiangqi.general.goal.1': '将帅每次走一格：上、下、左、右。跟着箭头走！',
  'learn.xiangqi.general.goal.2':
    '看到九宫里画的那条斜线了吗？那不是给他走的。将帅从不走斜线。走直路！',
  'learn.xiangqi.general.goal.3':
    '走得慢就得先想好。近处的星星里有一颗是陷阱：第一步走错，后面就不够步数了。想清楚再迈步！',
  'learn.xiangqi.general.goal.4':
    '沿着九宫的边走一圈，一个角一个角地过，一步都不能浪费。他该把自己的家记得烂熟。',

  // 7. The soldier
  'learn.xiangqi.soldier.title': '兵卒',
  'learn.xiangqi.soldier.subtitle': '只能向前，过河后可以横走',
  'learn.xiangqi.soldier.intro':
    '兵每次向前走一格，永远不能后退。过了河，它就多一项本事：可以横着走一格。',
  'learn.xiangqi.soldier.complete':
    '恭喜！兵从不后退，过了河还会变强。几个兵一起往前压，是可以赢下棋局的：两个兵逼到九宫门口，有个专门的名字，叫二鬼拍门。',
  'learn.xiangqi.soldier.goal.1': '兵每次向前走一格。走到星星那里去！',
  'learn.xiangqi.soldier.goal.2': '没有回头路！过河之前，兵不能后退也不能横走。向前，走！',
  'learn.xiangqi.soldier.goal.3': '过河！到了对岸，你的兵还可以横着走。把星星吃掉！',
  'learn.xiangqi.soldier.goal.4': '先横一步再往前顶。先吃近的那颗星！',
  'learn.xiangqi.soldier.goal.5':
    '想好顺序！你可以在同一条横线上来回走，但永远回不到下面那一行。先把自己这一行清干净。',
  'learn.xiangqi.soldier.goal.6': '每颗星都只有一个兵够得着。派对人去！',
  'learn.xiangqi.soldier.goal.7': '兵单个很弱，合在一起就强。三个都要用上！',
  // 8. Capturing
  'learn.xiangqi.capture.title': '吃子',
  'learn.xiangqi.capture.subtitle': '把对方的子吃掉',
  'learn.xiangqi.capture.intro':
    '要吃子，就把自己的子走到对方子所在的点上。把黑方的子全部吃光，但也要当心：你的子同样会被吃。',
  'learn.xiangqi.capture.complete': '很好！吃子换来子力，子力赢下棋局。选一个能保住自己子的顺序。',
  'learn.xiangqi.capture.goal.one': '用你的车吃掉黑卒！',
  'learn.xiangqi.capture.goal.order': '把黑方两个子都吃掉，自己一个都不能丢！吃子的顺序很要紧。',
  'learn.xiangqi.capture.goal.screens': '用炮把两个象都吃掉。每一次吃子都要有自己的炮架。',
  'learn.xiangqi.capture.goal.legs': '用马把三个子都吃掉。你的兵蹩住了一条马腿：绕开它跳。',
  'learn.xiangqi.capture.goal.capstone': '全部吃光，一个不丢！先解决威胁最大的那个子。',

  // 9. Protection
  'learn.xiangqi.protection.title': '保护',
  'learn.xiangqi.protection.subtitle': '别让自己的子白丢',
  'learn.xiangqi.protection.intro':
    '被攻击的子还没有丢。你可以把它走开，可以给它加保护让对方吃了要还子，也可以直接把攻击拆掉。',
  'learn.xiangqi.protection.complete':
    '很好！保住的子，以后就是你进攻的本钱。特别要留意炮：它能隔着半个盘打过来，但没有炮架就打不了。',
  'learn.xiangqi.protection.goal.escape': '你的子被攻击了！把它走到安全的地方。',
  'learn.xiangqi.protection.goal.defend': '给受攻击的兵加保护。对方吃了，你就能吃回来！',
  'learn.xiangqi.protection.goal.removeScreen': '炮离不开炮架。把炮架走开，这个攻击就没有了！',
  'learn.xiangqi.protection.goal.noUndefended': '你有一个子没人保护。找出来，救回它！',

  // 10. Combat
  'learn.xiangqi.combat.title': '实战',
  'learn.xiangqi.combat.subtitle': '既要会吃，也要会守',
  'learn.xiangqi.combat.intro':
    '真刀真枪的一仗。把学过的都用上：黑方的子全部吃掉，自己的子一个也不能没人保护。',
  'learn.xiangqi.combat.complete':
    '赢了！你会进攻，会防守，也懂得挑对出手的顺序。接下来：对准对方的将。',
  'learn.xiangqi.combat.goal.main': '把黑方的子全部吃掉。自己的一个都不许丢！',
  'learn.xiangqi.combat.goal.order': '有一个黑子正在威胁你。先处理这个攻击者，再收拾残局。',
  'learn.xiangqi.combat.goal.screens': '把盘面清空。炮吃子要炮架，车不用。',
  'learn.xiangqi.combat.goal.values': '大子分高：车 90，炮 45，马 40。安全地把它们全部拿下。',
  'learn.xiangqi.combat.goal.final': '最后一仗。黑子清光，自己的人马一个不少。',

  // 11. Check in one
  'learn.xiangqi.check1.title': '一步将军',
  'learn.xiangqi.check1.subtitle': '安全地攻击对方的将',
  'learn.xiangqi.check1.intro':
    '赢棋要靠困住对方的将。攻击它叫将军：对方必须马上应对。但草率的将军会反过来害自己：如果将军的子白白被吃，你送掉的是一个子，而不是一步将军。找出那步既将军又不丢子的棋！',
  'learn.xiangqi.check1.complete':
    '很好！任何子都能将军，但只有安全的将军才算数：走之前先问一句，对方接下来能吃到什么。下一步：轮到你的将被将军时该怎么办。',
  'learn.xiangqi.check1.goal.chariot':
    '车有两步棋能将军，但对方的马正盯着其中一步。找出安全的那一步！',
  'learn.xiangqi.check1.goal.cannon':
    '你的炮隔着两个不同的炮架都能将军。对方的车守着其中一个落点。想清楚再选！',
  'learn.xiangqi.check1.goal.horse':
    '马跳到哪一边都能将军。对方的车正对着其中一个点。挑安全的那一跳！',
  'learn.xiangqi.check1.goal.soldier':
    '两个兵都能将军，而且都要贴到将的旁边。没人保护的那个会被他吃掉。推有车保护的那个兵！',
  'learn.xiangqi.check1.goal.discovered':
    '把马跳开，你的炮就是一步闪将。可对方的马正等着吃你的炮！有一步跳法能挡住它的路。找出来！',
  'learn.xiangqi.check1.goal.onlyOne': '这里只有一步棋能将军。把它找出来！',
  'learn.xiangqi.check1.goal.capstone':
    '一场真正的仗。你的兵正被攻击，有四步棋能将军，其中三步都要亏子。找出那步扭转局面的将军！',

  // 12. Out of check
  'learn.xiangqi.outOfCheck.title': '应将',
  'learn.xiangqi.outOfCheck.subtitle': '解掉将军，还不能亏子',
  'learn.xiangqi.outOfCheck.intro':
    '将军！你的将被攻击了，必须马上应。可以走开，可以吃掉攻击的子，也可以挡住这条线。但草率的解法会反过来害自己：挡错了子，对方顺手就吃掉。找出那步不用付代价的应法。',
  'learn.xiangqi.outOfCheck.complete':
    '恭喜！走、吃、挡，你的将总有办法。只是选之前要先算算代价。碰上炮将军，就在炮架上做文章：多垫一个炮架就能让它哑火，但送上去的炮架也可能白丢一个子。',
  'learn.xiangqi.outOfCheck.goal.escape': '将军！车在攻击你的将。往九宫里安全的那一点闪开。',
  'learn.xiangqi.outOfCheck.goal.fleeTrap':
    '将军！你的马能跳过去挡，但不管挡在哪一格，车都白吃。还是把将走到安全的地方。',
  'learn.xiangqi.outOfCheck.goal.block':
    '这次将走不掉了。有三个子能挡，但只有一个挡子有保护。你的炮在后面撑着它！',
  'learn.xiangqi.outOfCheck.goal.capture':
    '对方的车叫得凶，其实孤零零一个。挡过去只是白送一个子。把将军的车吃掉！',
  'learn.xiangqi.outOfCheck.goal.screen':
    '炮要打，正好需要一个炮架。在这条线上再放一个子，它就跳不过来了！但对方的马盯着其中两格。只有一个炮架是白给的。',
  'learn.xiangqi.outOfCheck.goal.best':
    '一场真正的混战。车吃车看着顺理成章，可对方的马守着它。挡也全都是送子。有时候将得自己救自己：找出那步不起眼的棋！',

  // 13. Mate in one
  'learn.xiangqi.mate1.title': '一步杀',
  'learn.xiangqi.mate1.subtitle': '赢下这盘棋',
  'learn.xiangqi.mate1.intro':
    '赢棋靠将死：攻击对方的将，让它怎么应都活不了。这里的每个局面都藏着一步棋，一步就能结束战斗。找出来！',
  'learn.xiangqi.mate1.complete':
    '很好！几种经典的杀型你都见过了：将被逼到角上、重炮、闷宫、挂角马，还有白脸将。每一种都有流传几百年的中文名字。在「基本杀法」阶段，你会连名带形再见到它们。',
  'learn.xiangqi.mate1.goal.chariot': '黑将躲在角里，自己的炮反倒堵死了退路。用车一步杀！',
  'learn.xiangqi.mate1.goal.doubleCannon': '两炮一线：前炮就是后炮的炮架。摆好这个重炮杀！',
  'learn.xiangqi.mate1.goal.smother': '黑方的两个士把自己的将困死了。炮沿底线打过去，就是闷宫！',
  'learn.xiangqi.mate1.goal.horse':
    '马跳到九宫的角上，这就是挂角马。逃跑的那一格，你的兵已经看住了。',
  'learn.xiangqi.mate1.goal.soldier': '小兵进了九宫最要命。往前拱一小步就是杀！',
  'learn.xiangqi.mate1.goal.flying':
    '两将不能在同一条直线上照面。你的将盯着中路，黑将就不敢走过去。从侧面将军：白脸将！',
  'learn.xiangqi.mate1.goal.capstone':
    '一场真正的仗。好几步棋都能将军，但只有一步是杀。把它找出来！',

  // 14. Board setup
  'learn.xiangqi.setup.title': '摆棋',
  'learn.xiangqi.setup.subtitle': '开局时的阵形',
  'learn.xiangqi.setup.intro':
    '每一盘象棋都从同一个阵形开始。把每个子走回自己的原位，绕开已经站好的同伴，把这条阵线记熟。',
  'learn.xiangqi.setup.complete':
    '恭喜！你记住开局阵形了：车镇两角，炮在马前两步，将稳稳坐在九宫中央。',
  'learn.xiangqi.setup.goal.chariot': '车镇角。它的家在左下角，但马堵住了底线。另找一条路进去。',
  'learn.xiangqi.setup.goal.cannon':
    '炮就位在马前面两步的位置，也就是二路和八路。你的两个炮停在象位上，马又挡住了直路。把炮抬起来绕过去。',
  'learn.xiangqi.setup.goal.elephant':
    '象守在三路和七路，走田字。两个象都想先去同一个点。选错了，一个象就会把另一个困住。',
  'learn.xiangqi.setup.goal.palace':
    '将坐在中路底线，两个士在他肩膀两侧。九宫很挤：得有人先让一让，最后一个士才回得了家。',
  'learn.xiangqi.setup.goal.formation':
    '还有三个子在外面：一车、一炮、一象。让它们穿过自家阵线回家，把阵形补齐！',

  // 15. The flying general
  'learn.xiangqi.flyingGeneral.title': '白脸将',
  'learn.xiangqi.flyingGeneral.subtitle': '两将不能照面',
  'learn.xiangqi.flyingGeneral.intro':
    '两个将永远不能在同一条没有阻挡的直线上照面。你的将沿着自己那一路发出一道看不见的威胁：对方的将绝不能踏进去。高手会把这条规则当成一个额外的攻击子来用。',
  'learn.xiangqi.flyingGeneral.complete':
    '很好！你的将不只是一个要保护的子：在一条通路上，它打起来像一个隐形的车。棋手给这件武器起了名字：白脸将，也叫对面笑。每一盘残局都要留意它。',
  'learn.xiangqi.flyingGeneral.goal.rule':
    '两将不能在同一条通路上照面，所以黑将不敢走到你的将那一路上。在旁边一路将军，就是一步杀！',
  'learn.xiangqi.flyingGeneral.goal.open':
    '你的车是自己将那一路上最后一个子。走开它去将军，这一路就通了：逃跑的格子没有了。一步杀！',
  'learn.xiangqi.flyingGeneral.goal.support':
    '把车落到紧挨着黑将的地方。他吃不了：一吃两将就照面了。一步杀！',
  'learn.xiangqi.flyingGeneral.goal.capstone':
    '把两件武器合起来用：炮隔着炮架将军，你的将封住那条通路。一步杀！',

  // 16. Stalemate wins
  'learn.xiangqi.stalemate.title': '困毙取胜',
  'learn.xiangqi.stalemate.subtitle': '在象棋里，无棋可走就算输',
  'learn.xiangqi.stalemate.intro':
    '下国际象棋的朋友要改一改这个习惯：在国际象棋里，一方无子可动是逼和，算和棋。在象棋里，这一方是输，而且不需要被将军！这种赢法叫困毙。把每一格都封死，但不要将军。',
  'learn.xiangqi.stalemate.complete':
    '你掌握困毙了！在象棋里，只要能让对方一步都走不了，就不必非要将死。记住那步不将军的闲着：封住最后一格，棋就赢了。',
  'learn.xiangqi.stalemate.goal.seal': '黑方只剩一个将。别将军，把他最后几格路封掉，他就输了！',
  'learn.xiangqi.stalemate.goal.everyPiece':
    '象已经动不了了：两只象眼都被塞住。再把将也冻住。黑方每一个子都不能有棋可走！',
  'learn.xiangqi.stalemate.goal.wall': '砌起兵墙。把将周围每一格都盖住，但绝不能盖到将本身！',
  'learn.xiangqi.stalemate.goal.net': '你的车守住了这一路。再把马调过来，黑方就无处可去了！',
  'learn.xiangqi.stalemate.goal.quiet':
    '将军只会把他赶到安全的地方。找出那步闲着，让黑方一点余地都没有！',

  // 17. Piece value
  'learn.xiangqi.value.title': '子力价值',
  'learn.xiangqi.value.subtitle': '知道自己的子值多少',
  'learn.xiangqi.value.intro':
    '棋子不是一样重的。车值 90 分，炮 45，马 40，象和士各 20，兵 10。没错，一个车抵得上两个炮！有得选的时候，吃分最高的那个。还有一点：吃子得能全身而退才算数。吃了一个有保护的子，你要照价赔回去。',
  'learn.xiangqi.value.complete':
    '很好！这把尺子你记住了：车 90，炮 45，马 40，象和士 20，兵 10。你也记住了那行小字：只有白吃到手，这个分才算你的。要往上换，不要往下换，更不要把子送回去。',
  'learn.xiangqi.value.goal.chariotOverSoldier':
    '你的车可以吃兵（10），也可以吃车（90）。那个兵是诱饵：有马盯着那一格。吃车！',
  'learn.xiangqi.value.goal.cannonOverHorse':
    '差得不多：炮（45）比马（40）稍微值钱一点。而且那个马还有保镖。吃炮！',
  'learn.xiangqi.value.goal.chariotOverCannon':
    '你有两个子能吃。马能赢一个炮（45），但有子等着还击。你的炮能白赢一个车（90）。吃车！',
  'learn.xiangqi.value.goal.flashyTrap':
    '那一大跳看着诱人，可那个兵只值 10 分，而且他的车正看着。不起眼的那步能白赢一个马（40）。拿安全的那份！',
  'learn.xiangqi.value.goal.capstone':
    '四个子能吃，只有一个答案。车（90）有保护，马（40）也有。挑你能白吃到的、分最高的那个！',

  // 18. Check in two
  'learn.xiangqi.check2.title': '两步将军',
  'learn.xiangqi.check2.subtitle': '用两步棋叫将',
  'learn.xiangqi.check2.intro':
    '有些将军需要先做准备。找出那个两步的计划，把对方的将叫住！对方的子不会动。',
  'learn.xiangqi.check2.complete':
    '很好！车、炮、马，哪怕一个小兵，每一个攻击子都能提前一步做好将军的准备。能想到两步之后，才是进攻的开始。',
  'learn.xiangqi.check2.goal.1': '这里车走一步是将不了军的。先占住那条通路，再拐上底线！',
  'learn.xiangqi.check2.goal.2': '你的兵已经是现成的炮架了。把炮调到它后面，瞄准！',
  'learn.xiangqi.check2.goal.3': '两跳就能把马送到九宫旁的卧槽点将军。进去的路上留意马腿！',
  'learn.xiangqi.check2.goal.4': '你自己的将正好站在要用的那一路上。先把他挪开，再把车横过去！',
  'learn.xiangqi.check2.goal.5': '把兵拱到九宫门口，再横一步。和将面对面！',
  'learn.xiangqi.check2.goal.6':
    '只有一个方案能两步将军。那个士挡住了车的所有路子，可对炮来说，它是个完美的炮架。找出这条路！',

  // 19. Mate patterns
  'learn.xiangqi.matePatterns.title': '基本杀法',
  'learn.xiangqi.matePatterns.subtitle': '九种经典杀型',
  'learn.xiangqi.matePatterns.intro':
    '每一次成功的进攻，最后都会落进一个熟悉的形状。这里是九种基本杀法，棋手们连名字一起记，四百多年来一直印在棋谱里操练。每一种都走一遍，把这幅画记住。',
  'learn.xiangqi.matePatterns.complete':
    '很好！九种经典杀法你都叫得出名字了，这些形状棋手们已经研究了几百年。高手能提前好几步看出它们。进攻的时候，就朝着你已经认识的那幅画去下。',
  'learn.xiangqi.matePatterns.goal.1':
    '双车错：先用一个车将军，把将逼下来，再用另一个车在下一条线上将死。',
  'learn.xiangqi.matePatterns.goal.2':
    '马后炮：马看住角上的点，同时又当炮架。先跳进去，再把炮摆到它后面。',
  'learn.xiangqi.matePatterns.goal.3':
    '卧槽马：马从九宫旁边那个点将军，同时看住退路。跳进去，再用车收网。',
  'learn.xiangqi.matePatterns.goal.4':
    '重炮：两个炮叠在中路将军。前炮是炮架，后炮开火，两个一起把这一路彻底封死。将往旁边逃，你的兵就敲上门了。',
  'learn.xiangqi.matePatterns.goal.5':
    '铁门栓：中路的炮把守子钉死，它们既动不了也挡不住。把车拍到底线上。',
  'learn.xiangqi.matePatterns.goal.6':
    '小刀剜心：用兵吃掉中间那个士。另一个士只能把这把刀吞下去，然后你的车再剜一次心。',
  'learn.xiangqi.matePatterns.goal.7':
    '钓鱼马：马在自己的位置上钩住逃跑的那一格，像渔夫牵着钓线。先下钩，再用车出手。',
  'learn.xiangqi.matePatterns.goal.8':
    '二鬼拍门：两个兵单独逼到九宫门口。将连吃都吃不了：你的将正沿着后面那条通路瞪着他。',
  'learn.xiangqi.matePatterns.goal.9':
    '大胆穿心：把车送到中间那个士上，九宫就塌了。另一个士被牵制着，报不了仇。',

  // 20. Perpetual check and chasing
  'learn.xiangqi.perpetual.title': '长将与长捉',
  'learn.xiangqi.perpetual.subtitle': '一直重复就要判负',
  'learn.xiangqi.perpetual.intro':
    '在国际象棋里，一直将军是和棋。象棋不认这一套。反复走同样的将军，或者没完没了地捉同一个子，都是不允许的：进攻的一方必须变着，否则判负。看着黑方来试，你稳住就行。',
  'learn.xiangqi.perpetual.complete':
    '这一条要记牢：在象棋里，长将和长捉都判进攻方负。有人一直将你，稳住别慌。规则站在你这边。',
  'learn.xiangqi.perpetual.goal.1':
    '黑方将军，你闪开。黑方再将，你再退回来。沉住气，跟着绿箭头走：在象棋里，一直重复同样的将军是不允许的。黑方要么变着，要么判负。',
  'learn.xiangqi.perpetual.goal.2':
    '炮也能这样纠缠，借你自己的子当炮架来将你。在两个点之间来回走，让黑方重复那两步将军。结论一样：黑方不打破这个循环就要输。',
  'learn.xiangqi.perpetual.goal.3':
    '这回黑方改捉你那个没保护的马。在两个点之间跳，让车跟着追。一直捉子和一直将军一样是禁止的：捉的一方不停手就算输。',
  'learn.xiangqi.perpetual.goal.4':
    '收获的时候到了。你的车早就想吃那个马，只是一直被将军缠住。黑方不能永远重复，所以他必须收手。躲两次，然后把马吃掉！',
};

export const LEARN_XIANGQI_ZH_HANT: Record<string, string> = {
  // Chrome
  'learn.xiangqi.title': '學下象棋',
  'learn.xiangqi.byPlaying': '邊玩邊學！',
  'learn.xiangqi.progress': '進度',
  'learn.xiangqi.resetProgress': '重設我的進度',
  'learn.xiangqi.resetConfirm': '你將失去全部進度。確定要重設嗎？',
  'learn.xiangqi.menu': '目錄',
  'learn.xiangqi.backToMenu': '返回目錄',
  'learn.xiangqi.play': '開始',
  'learn.xiangqi.retry': '重試',
  'learn.xiangqi.next': '下一關',
  'learn.xiangqi.nextStage': '下一階段：',
  'learn.xiangqi.levelFailed': '本關失敗',
  'learn.xiangqi.stage': '階段',
  'learn.xiangqi.stageComplete': '已完成',
  'learn.xiangqi.yourScore': '你的得分：',
  'learn.xiangqi.letsGo': '開始吧！',
  'learn.xiangqi.whatNext': '接下來學什麼？',
  'learn.xiangqi.whatNextCopy': '恭喜，你已經會下象棋了！想再進一步，變得更強嗎？',

  // Categories
  'learn.xiangqi.categ.pieces': '象棋棋子',
  'learn.xiangqi.categ.fundamentals': '基本功',
  'learn.xiangqi.categ.intermediate': '進階',
  'learn.xiangqi.categ.advanced': '高級',

  // Congrats pool
  'learn.xiangqi.congrats.1': '不錯！',
  'learn.xiangqi.congrats.2': '漂亮！',
  'learn.xiangqi.congrats.3': '幹得好！',
  'learn.xiangqi.congrats.4': '完美！',
  'learn.xiangqi.congrats.5': '精彩！',
  'learn.xiangqi.congrats.6': '就是這樣！',
  'learn.xiangqi.congrats.7': '好，好，好！',
  'learn.xiangqi.congrats.8': '你很有天分！',

  'learn.xiangqi.next.register': '註冊',
  'learn.xiangqi.next.registerSub': '排位對局、題目等級分和個人主頁',
  'learn.xiangqi.next.puzzles': '題目',
  'learn.xiangqi.next.puzzlesSub': '磨練你的戰術',
  'learn.xiangqi.next.playPeople': '與人對弈',
  'learn.xiangqi.next.playPeopleSub': '來自世界各地的對手',
  'learn.xiangqi.next.playMachine': '與機器對弈',
  'learn.xiangqi.next.playMachineSub': '一級一級挑戰機器人',
  'learn.xiangqi.next.videos': '影片',
  'learn.xiangqi.next.videosSub': '觀看象棋教學影片',
  'learn.xiangqi.next.watch': '觀戰',
  'learn.xiangqi.next.watchSub': '追看頂級賽事對局',

  // Shared goals
  'learn.xiangqi.goal.grabAllTheStars': '把所有星星都吃掉！',

  // 1. The chariot
  'learn.xiangqi.chariot.title': '車',
  'learn.xiangqi.chariot.subtitle': '直線行走',
  'learn.xiangqi.chariot.intro': '車是盤上最強的子。它沿著橫線或豎線走任意遠。點擊或拖動來走子。',
  'learn.xiangqi.chariot.complete': '恭喜！你會用車了。多數棋局是靠車贏下來的，所以要及早出車。',
  'learn.xiangqi.chariot.goal.1': '點一下車，把星星吃掉！',
  'learn.xiangqi.chariot.goal.2': '兩顆星，兩步棋。有一顆已經在你的線上，先吃那一顆！',
  'learn.xiangqi.chariot.goal.3': '自己的兵擋住了路，而車不能跳過去。繞一條路出來！',
  'learn.xiangqi.chariot.goal.4':
    '被自己的子圍住了！只有一個出口通向星星。選對它，然後一路掃過去。',
  'learn.xiangqi.chariot.goal.5': '五顆星，五步棋。別只盯著最近的那一顆：先看清整盤，再順著線走！',

  // 2. The cannon
  'learn.xiangqi.cannon.title': '砲',
  'learn.xiangqi.cannon.subtitle': '隔著砲架吃子',
  'learn.xiangqi.cannon.intro':
    '砲走起來和車一樣，但吃子的方式不同：它必須隔著正好一個子跳過去，這個子叫砲架。任何子都可以當砲架，你的或對方的都行。',
  'learn.xiangqi.cannon.complete':
    '很好！砲是象棋裡最刁鑽的子。記住：吃子要有砲架，走子則不能有。最有名的幾種殺法都少不了砲：馬後砲和重砲就在「基本殺法」裡等著你。',
  'learn.xiangqi.cannon.goal.1': '砲走起來和車一樣。把星星吃掉！',
  'learn.xiangqi.cannon.goal.2': '兩顆星，兩步棋。走子不需要跳。',
  'learn.xiangqi.cannon.goal.3': '要吃子，砲得隔著一個砲架跳過去。借你的兵當砲架，吃掉黑卒！',
  'learn.xiangqi.cannon.goal.4': '沒有砲架就吃不了子。先到兵的後面排好，再吃黑卒。',
  'learn.xiangqi.cannon.goal.5': '對方的子也是好砲架。隔著它們，把後面的子吃掉！',
  'learn.xiangqi.cannon.goal.6': '黑車停在你的馬後面了。轟掉它！',
  'learn.xiangqi.cannon.goal.7': '四次吃子，一趟走完。每一次吃子都要有自己的砲架。',

  // 3. The horse
  'learn.xiangqi.horse.title': '馬',
  'learn.xiangqi.horse.subtitle': '先直一步，再斜一步',
  'learn.xiangqi.horse.intro':
    '馬先沿直線走一格，再斜著往外走一格。它不能跳過棋子：第一格上有子就走不了，那一格叫馬腿。',
  'learn.xiangqi.horse.complete':
    '騎得好！記住馬腿：空曠處的馬很強，被蹩了腿的馬寸步難行。要盯著馬腿，你的和對方的都要看。最好的幾個馬位甚至有幾百年的老名字：臥槽馬和釣魚馬都在「基本殺法」裡等你。',
  'learn.xiangqi.horse.goal.1': '直一步，斜一步。把星星吃掉！',
  'learn.xiangqi.horse.goal.2': '四顆星，四次跳。每一次拐的方向都不一樣。',
  'learn.xiangqi.horse.goal.3': '把星星全部吃掉。馬可以往八個方向跳。',
  'learn.xiangqi.horse.goal.4': '馬腿上有子就跳不過去。兵蹩住了近路，繞開它走！',
  'learn.xiangqi.horse.goal.5': '前面兩條馬腿都被蹩住了。從側面繞過去，順著星星走。',
  'learn.xiangqi.horse.goal.6': '六顆星，六次跳。每次起跳前先看清馬腿！',

  // 4. The elephant
  'learn.xiangqi.elephant.title': '象',
  'learn.xiangqi.elephant.subtitle': '走田字，不過河',
  'learn.xiangqi.elephant.intro':
    '象斜著走兩格，正好是一個田字。田字中心那一格叫象眼，被占住就走不了。象永遠不能過河：它守著自己這半邊。',
  'learn.xiangqi.elephant.complete':
    '很好！象一輩子只走得到自己這邊的七個點。它是防守子：留在家裡護著將帥。',
  'learn.xiangqi.elephant.goal.1': '斜走兩格，一步到位。把星星吃掉！',
  'learn.xiangqi.elephant.goal.2': '一個點一個點地跳過去，把兩顆星都吃掉。',
  'learn.xiangqi.elephant.goal.3': '中間那一格有子，象眼被塞住了。繞個路走！',
  'learn.xiangqi.elephant.goal.4': '象永遠不能過河。這些河邊的點就是它的最前線：它是守家的子。',
  'learn.xiangqi.elephant.goal.5': '把整張網走一遍！象一共只站得到七個點。',

  // 5. The advisor
  'learn.xiangqi.advisor.title': '士',
  'learn.xiangqi.advisor.subtitle': '不出九宮',
  'learn.xiangqi.advisor.intro':
    '士是將帥的貼身護衛。它每次斜走一格，而且從不離開九宮：整盤只有五個點能放得下它。',
  'learn.xiangqi.advisor.complete':
    '很好！士的一生都在九宮裡。把它留在家裡：它的全部職責就是護著將帥。',
  'learn.xiangqi.advisor.goal.1': '斜走一格。把星星吃掉！',
  'learn.xiangqi.advisor.goal.2': '士走的每一條路都要經過九宮的中心點。穿過去，把兩顆星都吃掉。',
  'learn.xiangqi.advisor.goal.3': '把九宮的四個角都走一遍。每次都要從中心過！',
  'learn.xiangqi.advisor.goal.4': '兩個士一起用！單靠遠的那個士要走六步，兩個配合五步就夠了。',

  // 6. The general
  'learn.xiangqi.general.title': '將帥',
  'learn.xiangqi.general.subtitle': '把他穩穩留在九宮裡',
  'learn.xiangqi.general.intro':
    '將帥是象棋裡最要緊的子。他每次走一格，上下左右都行，但永遠不能離開九宮：那九個點就是他的全部天地。',
  'learn.xiangqi.general.complete':
    '你會走將帥了。記住：整盤棋就是圍著這一個子打的。丟了他，就什麼都沒了。',
  'learn.xiangqi.general.goal.1': '將帥每次走一格：上、下、左、右。跟著箭頭走！',
  'learn.xiangqi.general.goal.2':
    '看到九宮裡畫的那條斜線了嗎？那不是給他走的。將帥從不走斜線。走直路！',
  'learn.xiangqi.general.goal.3':
    '走得慢就得先想好。近處的星星裡有一顆是陷阱：第一步走錯，後面就不夠步數了。想清楚再邁步！',
  'learn.xiangqi.general.goal.4':
    '沿著九宮的邊走一圈，一個角一個角地過，一步都不能浪費。他該把自己的家記得爛熟。',

  // 7. The soldier
  'learn.xiangqi.soldier.title': '兵卒',
  'learn.xiangqi.soldier.subtitle': '只能向前，過河後可以橫走',
  'learn.xiangqi.soldier.intro':
    '兵每次向前走一格，永遠不能後退。過了河，它就多一項本事：可以橫著走一格。',
  'learn.xiangqi.soldier.complete':
    '恭喜！兵從不後退，過了河還會變強。幾個兵一起往前壓，是可以贏下棋局的：兩個兵逼到九宮門口，有個專門的名字，叫二鬼拍門。',
  'learn.xiangqi.soldier.goal.1': '兵每次向前走一格。走到星星那裡去！',
  'learn.xiangqi.soldier.goal.2': '沒有回頭路！過河之前，兵不能後退也不能橫走。向前，走！',
  'learn.xiangqi.soldier.goal.3': '過河！到了對岸，你的兵還可以橫著走。把星星吃掉！',
  'learn.xiangqi.soldier.goal.4': '先橫一步再往前頂。先吃近的那顆星！',
  'learn.xiangqi.soldier.goal.5':
    '想好順序！你可以在同一條橫線上來回走，但永遠回不到下面那一行。先把自己這一行清乾淨。',
  'learn.xiangqi.soldier.goal.6': '每顆星都只有一個兵夠得著。派對人去！',
  'learn.xiangqi.soldier.goal.7': '兵單個很弱，合在一起就強。三個都要用上！',

  // 8. Capturing
  'learn.xiangqi.capture.title': '吃子',
  'learn.xiangqi.capture.subtitle': '把對方的子吃掉',
  'learn.xiangqi.capture.intro':
    '要吃子，就把自己的子走到對方子所在的點上。把黑方的子全部吃光，但也要當心：你的子同樣會被吃。',
  'learn.xiangqi.capture.complete': '很好！吃子換來子力，子力贏下棋局。選一個能保住自己子的順序。',
  'learn.xiangqi.capture.goal.one': '用你的車吃掉黑卒！',
  'learn.xiangqi.capture.goal.order': '把黑方兩個子都吃掉，自己一個都不能丟！吃子的順序很要緊。',
  'learn.xiangqi.capture.goal.screens': '用砲把兩個象都吃掉。每一次吃子都要有自己的砲架。',
  'learn.xiangqi.capture.goal.legs': '用馬把三個子都吃掉。你的兵蹩住了一條馬腿：繞開它跳。',
  'learn.xiangqi.capture.goal.capstone': '全部吃光，一個不丟！先解決威脅最大的那個子。',

  // 9. Protection
  'learn.xiangqi.protection.title': '保護',
  'learn.xiangqi.protection.subtitle': '別讓自己的子白丟',
  'learn.xiangqi.protection.intro':
    '被攻擊的子還沒有丟。你可以把它走開，可以給它加保護讓對方吃了要還子，也可以直接把攻擊拆掉。',
  'learn.xiangqi.protection.complete':
    '很好！保住的子，以後就是你進攻的本錢。特別要留意砲：它能隔著半個盤打過來，但沒有砲架就打不了。',
  'learn.xiangqi.protection.goal.escape': '你的子被攻擊了！把它走到安全的地方。',
  'learn.xiangqi.protection.goal.defend': '給受攻擊的兵加保護。對方吃了，你就能吃回來！',
  'learn.xiangqi.protection.goal.removeScreen': '砲離不開砲架。把砲架走開，這個攻擊就沒有了！',
  'learn.xiangqi.protection.goal.noUndefended': '你有一個子沒人保護。找出來，救回它！',

  // 10. Combat
  'learn.xiangqi.combat.title': '實戰',
  'learn.xiangqi.combat.subtitle': '既要會吃，也要會守',
  'learn.xiangqi.combat.intro':
    '真刀真槍的一仗。把學過的都用上：黑方的子全部吃掉，自己的子一個也不能沒人保護。',
  'learn.xiangqi.combat.complete':
    '贏了！你會進攻，會防守，也懂得挑對出手的順序。接下來：對準對方的將。',
  'learn.xiangqi.combat.goal.main': '把黑方的子全部吃掉。自己的一個都不許丟！',
  'learn.xiangqi.combat.goal.order': '有一個黑子正在威脅你。先處理這個攻擊者，再收拾殘局。',
  'learn.xiangqi.combat.goal.screens': '把盤面清空。砲吃子要砲架，車不用。',
  'learn.xiangqi.combat.goal.values': '大子分高：車 90，砲 45，馬 40。安全地把它們全部拿下。',
  'learn.xiangqi.combat.goal.final': '最後一仗。黑子清光，自己的人馬一個不少。',

  // 11. Check in one
  'learn.xiangqi.check1.title': '一步將軍',
  'learn.xiangqi.check1.subtitle': '安全地攻擊對方的將',
  'learn.xiangqi.check1.intro':
    '贏棋要靠困住對方的將。攻擊它叫將軍：對方必須馬上應對。但草率的將軍會反過來害自己：如果將軍的子白白被吃，你送掉的是一個子，而不是一步將軍。找出那步既將軍又不丟子的棋！',
  'learn.xiangqi.check1.complete':
    '很好！任何子都能將軍，但只有安全的將軍才算數：走之前先問一句，對方接下來能吃到什麼。下一步：輪到你的將被將軍時該怎麼辦。',
  'learn.xiangqi.check1.goal.chariot':
    '車有兩步棋能將軍，但對方的馬正盯著其中一步。找出安全的那一步！',
  'learn.xiangqi.check1.goal.cannon':
    '你的砲隔著兩個不同的砲架都能將軍。對方的車守著其中一個落點。想清楚再選！',
  'learn.xiangqi.check1.goal.horse':
    '馬跳到哪一邊都能將軍。對方的車正對著其中一個點。挑安全的那一跳！',
  'learn.xiangqi.check1.goal.soldier':
    '兩個兵都能將軍，而且都要貼到將的旁邊。沒人保護的那個會被他吃掉。推有車保護的那個兵！',
  'learn.xiangqi.check1.goal.discovered':
    '把馬跳開，你的砲就是一步閃將。可對方的馬正等著吃你的砲！有一步跳法能擋住它的路。找出來！',
  'learn.xiangqi.check1.goal.onlyOne': '這裡只有一步棋能將軍。把它找出來！',
  'learn.xiangqi.check1.goal.capstone':
    '一場真正的仗。你的兵正被攻擊，有四步棋能將軍，其中三步都要虧子。找出那步扭轉局面的將軍！',

  // 12. Out of check
  'learn.xiangqi.outOfCheck.title': '應將',
  'learn.xiangqi.outOfCheck.subtitle': '解掉將軍，還不能虧子',
  'learn.xiangqi.outOfCheck.intro':
    '將軍！你的將被攻擊了，必須馬上應。可以走開，可以吃掉攻擊的子，也可以擋住這條線。但草率的解法會反過來害自己：擋錯了子，對方順手就吃掉。找出那步不用付代價的應法。',
  'learn.xiangqi.outOfCheck.complete':
    '恭喜！走、吃、擋，你的將總有辦法。只是選之前要先算算代價。碰上砲將軍，就在砲架上做文章：多墊一個砲架就能讓它啞火，但送上去的砲架也可能白丟一個子。',
  'learn.xiangqi.outOfCheck.goal.escape': '將軍！車在攻擊你的將。往九宮裡安全的那一點閃開。',
  'learn.xiangqi.outOfCheck.goal.fleeTrap':
    '將軍！你的馬能跳過去擋，但不管擋在哪一格，車都白吃。還是把將走到安全的地方。',
  'learn.xiangqi.outOfCheck.goal.block':
    '這次將走不掉了。有三個子能擋，但只有一個擋子有保護。你的砲在後面撐著它！',
  'learn.xiangqi.outOfCheck.goal.capture':
    '對方的車叫得凶，其實孤零零一個。擋過去只是白送一個子。把將軍的車吃掉！',
  'learn.xiangqi.outOfCheck.goal.screen':
    '砲要打，正好需要一個砲架。在這條線上再放一個子，它就跳不過來了！但對方的馬盯著其中兩格。只有一個砲架是白給的。',
  'learn.xiangqi.outOfCheck.goal.best':
    '一場真正的混戰。車吃車看著順理成章，可對方的馬守著它。擋也全都是送子。有時候將得自己救自己：找出那步不起眼的棋！',

  // 13. Mate in one
  'learn.xiangqi.mate1.title': '一步殺',
  'learn.xiangqi.mate1.subtitle': '贏下這盤棋',
  'learn.xiangqi.mate1.intro':
    '贏棋靠將死：攻擊對方的將，讓它怎麼應都活不了。這裡的每個局面都藏著一步棋，一步就能結束戰鬥。找出來！',
  'learn.xiangqi.mate1.complete':
    '很好！幾種經典的殺型你都見過了：將被逼到角上、重砲、悶宮、掛角馬，還有白臉將。每一種都有流傳幾百年的中文名字。在「基本殺法」階段，你會連名帶形再見到它們。',
  'learn.xiangqi.mate1.goal.chariot': '黑將躲在角裡，自己的砲反倒堵死了退路。用車一步殺！',
  'learn.xiangqi.mate1.goal.doubleCannon': '兩砲一線：前砲就是後砲的砲架。擺好這個重砲殺！',
  'learn.xiangqi.mate1.goal.smother': '黑方的兩個士把自己的將困死了。砲沿底線打過去，就是悶宮！',
  'learn.xiangqi.mate1.goal.horse':
    '馬跳到九宮的角上，這就是掛角馬。逃跑的那一格，你的兵已經看住了。',
  'learn.xiangqi.mate1.goal.soldier': '小兵進了九宮最要命。往前拱一小步就是殺！',
  'learn.xiangqi.mate1.goal.flying':
    '兩將不能在同一條直線上照面。你的將盯著中路，黑將就不敢走過去。從側面將軍：白臉將！',
  'learn.xiangqi.mate1.goal.capstone':
    '一場真正的仗。好幾步棋都能將軍，但只有一步是殺。把它找出來！',

  // 14. Board setup
  'learn.xiangqi.setup.title': '擺棋',
  'learn.xiangqi.setup.subtitle': '開局時的陣形',
  'learn.xiangqi.setup.intro':
    '每一盤象棋都從同一個陣形開始。把每個子走回自己的原位，繞開已經站好的同伴，把這條陣線記熟。',
  'learn.xiangqi.setup.complete':
    '恭喜！你記住開局陣形了：車鎮兩角，砲在馬前兩步，將穩穩坐在九宮中央。',
  'learn.xiangqi.setup.goal.chariot': '車鎮角。它的家在左下角，但馬堵住了底線。另找一條路進去。',
  'learn.xiangqi.setup.goal.cannon':
    '砲就位在馬前面兩步的位置，也就是二路和八路。你的兩個砲停在象位上，馬又擋住了直路。把砲抬起來繞過去。',
  'learn.xiangqi.setup.goal.elephant':
    '象守在三路和七路，走田字。兩個象都想先去同一個點。選錯了，一個象就會把另一個困住。',
  'learn.xiangqi.setup.goal.palace':
    '將坐在中路底線，兩個士在他肩膀兩側。九宮很擠：得有人先讓一讓，最後一個士才回得了家。',
  'learn.xiangqi.setup.goal.formation':
    '還有三個子在外面：一車、一砲、一象。讓它們穿過自家陣線回家，把陣形補齊！',

  // 15. The flying general
  'learn.xiangqi.flyingGeneral.title': '白臉將',
  'learn.xiangqi.flyingGeneral.subtitle': '兩將不能照面',
  'learn.xiangqi.flyingGeneral.intro':
    '兩個將永遠不能在同一條沒有阻擋的直線上照面。你的將沿著自己那一路發出一道看不見的威脅：對方的將絕不能踏進去。高手會把這條規則當成一個額外的攻擊子來用。',
  'learn.xiangqi.flyingGeneral.complete':
    '很好！你的將不只是一個要保護的子：在一條通路上，它打起來像一個隱形的車。棋手給這件武器起了名字：白臉將，也叫對面笑。每一盤殘局都要留意它。',
  'learn.xiangqi.flyingGeneral.goal.rule':
    '兩將不能在同一條通路上照面，所以黑將不敢走到你的將那一路上。在旁邊一路將軍，就是一步殺！',
  'learn.xiangqi.flyingGeneral.goal.open':
    '你的車是自己將那一路上最後一個子。走開它去將軍，這一路就通了：逃跑的格子沒有了。一步殺！',
  'learn.xiangqi.flyingGeneral.goal.support':
    '把車落到緊挨著黑將的地方。他吃不了：一吃兩將就照面了。一步殺！',
  'learn.xiangqi.flyingGeneral.goal.capstone':
    '把兩件武器合起來用：砲隔著砲架將軍，你的將封住那條通路。一步殺！',

  // 16. Stalemate wins
  'learn.xiangqi.stalemate.title': '困斃取勝',
  'learn.xiangqi.stalemate.subtitle': '在象棋裡，無棋可走就算輸',
  'learn.xiangqi.stalemate.intro':
    '下國際象棋的朋友要改一改這個習慣：在國際象棋裡，一方無子可動是逼和，算和棋。在象棋裡，這一方是輸，而且不需要被將軍！這種贏法叫困斃。把每一格都封死，但不要將軍。',
  'learn.xiangqi.stalemate.complete':
    '你掌握困斃了！在象棋裡，只要能讓對方一步都走不了，就不必非要將死。記住那步不將軍的閒著：封住最後一格，棋就贏了。',
  'learn.xiangqi.stalemate.goal.seal': '黑方只剩一個將。別將軍，把他最後幾格路封掉，他就輸了！',
  'learn.xiangqi.stalemate.goal.everyPiece':
    '象已經動不了了：兩隻象眼都被塞住。再把將也凍住。黑方每一個子都不能有棋可走！',
  'learn.xiangqi.stalemate.goal.wall': '砌起兵牆。把將周圍每一格都蓋住，但絕不能蓋到將本身！',
  'learn.xiangqi.stalemate.goal.net': '你的車守住了這一路。再把馬調過來，黑方就無處可去了！',
  'learn.xiangqi.stalemate.goal.quiet':
    '將軍只會把他趕到安全的地方。找出那步閒著，讓黑方一點餘地都沒有！',

  // 17. Piece value
  'learn.xiangqi.value.title': '子力價值',
  'learn.xiangqi.value.subtitle': '知道自己的子值多少',
  'learn.xiangqi.value.intro':
    '棋子不是一樣重的。車值 90 分，砲 45，馬 40，象和士各 20，兵 10。沒錯，一個車抵得上兩個砲！有得選的時候，吃分最高的那個。還有一點：吃子得能全身而退才算數。吃了一個有保護的子，你要照價賠回去。',
  'learn.xiangqi.value.complete':
    '很好！這把尺子你記住了：車 90，砲 45，馬 40，象和士 20，兵 10。你也記住了那行小字：只有白吃到手，這個分才算你的。要往上換，不要往下換，更不要把子送回去。',
  'learn.xiangqi.value.goal.chariotOverSoldier':
    '你的車可以吃兵（10），也可以吃車（90）。那個兵是誘餌：有馬盯著那一格。吃車！',
  'learn.xiangqi.value.goal.cannonOverHorse':
    '差得不多：砲（45）比馬（40）稍微值錢一點。而且那個馬還有保鏢。吃砲！',
  'learn.xiangqi.value.goal.chariotOverCannon':
    '你有兩個子能吃。馬能贏一個砲（45），但有子等著還擊。你的砲能白贏一個車（90）。吃車！',
  'learn.xiangqi.value.goal.flashyTrap':
    '那一大跳看著誘人，可那個兵只值 10 分，而且他的車正看著。不起眼的那步能白贏一個馬（40）。拿安全的那份！',
  'learn.xiangqi.value.goal.capstone':
    '四個子能吃，只有一個答案。車（90）有保護，馬（40）也有。挑你能白吃到的、分最高的那個！',

  // 18. Check in two
  'learn.xiangqi.check2.title': '兩步將軍',
  'learn.xiangqi.check2.subtitle': '用兩步棋叫將',
  'learn.xiangqi.check2.intro':
    '有些將軍需要先做準備。找出那個兩步的計劃，把對方的將叫住！對方的子不會動。',
  'learn.xiangqi.check2.complete':
    '很好！車、砲、馬，哪怕一個小兵，每一個攻擊子都能提前一步做好將軍的準備。能想到兩步之後，才是進攻的開始。',
  'learn.xiangqi.check2.goal.1': '這裡車走一步是將不了軍的。先占住那條通路，再拐上底線！',
  'learn.xiangqi.check2.goal.2': '你的兵已經是現成的砲架了。把砲調到它後面，瞄準！',
  'learn.xiangqi.check2.goal.3': '兩跳就能把馬送到九宮旁的臥槽點將軍。進去的路上留意馬腿！',
  'learn.xiangqi.check2.goal.4': '你自己的將正好站在要用的那一路上。先把他挪開，再把車橫過去！',
  'learn.xiangqi.check2.goal.5': '把兵拱到九宮門口，再橫一步。和將面對面！',
  'learn.xiangqi.check2.goal.6':
    '只有一個方案能兩步將軍。那個士擋住了車的所有路子，可對砲來說，它是個完美的砲架。找出這條路！',

  // 19. Mate patterns
  'learn.xiangqi.matePatterns.title': '基本殺法',
  'learn.xiangqi.matePatterns.subtitle': '九種經典殺型',
  'learn.xiangqi.matePatterns.intro':
    '每一次成功的進攻，最後都會落進一個熟悉的形狀。這裡是九種基本殺法，棋手們連名字一起記，四百多年來一直印在棋譜裡操練。每一種都走一遍，把這幅畫記住。',
  'learn.xiangqi.matePatterns.complete':
    '很好！九種經典殺法你都叫得出名字了，這些形狀棋手們已經研究了幾百年。高手能提前好幾步看出它們。進攻的時候，就朝著你已經認識的那幅畫去下。',
  'learn.xiangqi.matePatterns.goal.1':
    '雙車錯：先用一個車將軍，把將逼下來，再用另一個車在下一條線上將死。',
  'learn.xiangqi.matePatterns.goal.2':
    '馬後砲：馬看住角上的點，同時又當砲架。先跳進去，再把砲擺到它後面。',
  'learn.xiangqi.matePatterns.goal.3':
    '臥槽馬：馬從九宮旁邊那個點將軍，同時看住退路。跳進去，再用車收網。',
  'learn.xiangqi.matePatterns.goal.4':
    '重砲：兩個砲疊在中路將軍。前砲是砲架，後砲開火，兩個一起把這一路徹底封死。將往旁邊逃，你的兵就敲上門了。',
  'learn.xiangqi.matePatterns.goal.5':
    '鐵門栓：中路的砲把守子釘死，它們既動不了也擋不住。把車拍到底線上。',
  'learn.xiangqi.matePatterns.goal.6':
    '小刀剜心：用兵吃掉中間那個士。另一個士只能把這把刀吞下去，然後你的車再剜一次心。',
  'learn.xiangqi.matePatterns.goal.7':
    '釣魚馬：馬在自己的位置上鉤住逃跑的那一格，像漁夫牽著釣線。先下鉤，再用車出手。',
  'learn.xiangqi.matePatterns.goal.8':
    '二鬼拍門：兩個兵單獨逼到九宮門口。將連吃都吃不了：你的將正沿著後面那條通路瞪著他。',
  'learn.xiangqi.matePatterns.goal.9':
    '大膽穿心：把車送到中間那個士上，九宮就塌了。另一個士被牽制著，報不了仇。',

  // 20. Perpetual check and chasing
  'learn.xiangqi.perpetual.title': '長將與長捉',
  'learn.xiangqi.perpetual.subtitle': '一直重複就要判負',
  'learn.xiangqi.perpetual.intro':
    '在國際象棋裡，一直將軍是和棋。象棋不認這一套。反覆走同樣的將軍，或者沒完沒了地捉同一個子，都是不允許的：進攻的一方必須變著，否則判負。看著黑方來試，你穩住就行。',
  'learn.xiangqi.perpetual.complete':
    '這一條要記牢：在象棋裡，長將和長捉都判進攻方負。有人一直將你，穩住別慌。規則站在你這邊。',
  'learn.xiangqi.perpetual.goal.1':
    '黑方將軍，你閃開。黑方再將，你再退回來。沉住氣，跟著綠箭頭走：在象棋裡，一直重複同樣的將軍是不允許的。黑方要麼變著，要麼判負。',
  'learn.xiangqi.perpetual.goal.2':
    '砲也能這樣糾纏，借你自己的子當砲架來將你。在兩個點之間來回走，讓黑方重複那兩步將軍。結論一樣：黑方不打破這個循環就要輸。',
  'learn.xiangqi.perpetual.goal.3':
    '這回黑方改捉你那個沒保護的馬。在兩個點之間跳，讓車跟著追。一直捉子和一直將軍一樣是禁止的：捉的一方不停手就算輸。',
  'learn.xiangqi.perpetual.goal.4':
    '收穫的時候到了。你的車早就想吃那個馬，只是一直被將軍纏住。黑方不能永遠重複，所以他必須收手。躲兩次，然後把馬吃掉！',
};
