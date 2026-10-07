// Localized text for the basic-endgame study.
//
// The seeder builds every chapter name and root comment out of four corpus
// fields (attacker, defender, note, engineDispute) and a fixed template. So the
// translation surface is that vocabulary plus the template, NOT 32 hand-written
// chapters: translating the parts keeps the zh chapters generated the same way
// the English ones are, and stops the two from drifting when the corpus changes.
//
// Dictionaries are keyed by the English source string, exactly like
// article-i18n.ts and announcement-i18n.ts. A missing key falls back to English
// for that one string, which is the same degrade-one-string-at-a-time contract
// study-i18n.ts states for the overlay itself.
//
// Note that study-i18n.ts warns "base is not a synonym for English" — the
// curated classical studies are authored Chinese-first. This study is the other
// case: it is authored in English (the whole point is that these verdicts are
// hard to find in English), so here base IS English and zh is the translation.
//
// Terminology follows standard xiangqi endgame usage rather than literal
// translation: 例胜 / 例和 for the book verdicts, 高兵 for an unadvanced soldier,
// 士象全 for the full four-piece defence, 炮架 for a cannon's platform, 欠行 for
// zugzwang. Piece names follow each script's convention (车/車, 炮/砲, 马/馬).
import type { EndgameEntry } from '@mistboard/game';

export const ENDGAME_STUDY_LANGS = ['zh-Hans', 'zh-Hant'] as const;
export type EndgameStudyLang = (typeof ENDGAME_STUDY_LANGS)[number];

/** Attacking and defending material, as written in the corpus. */
const MATERIAL: Record<EndgameStudyLang, Record<string, string>> = {
  'zh-Hans': {
    // attackers
    'One soldier, across the river': '一个过河兵',
    'One soldier (with general and elephant)': '一个兵（另有帅和相）',
    'Five soldiers, all on the last rank': '五个兵，全在底线',
    'Two unadvanced soldiers': '双高兵',
    'Three unadvanced soldiers': '三高兵',
    'General and soldier': '帅和一个兵',
    'Two soldiers and an elephant': '双兵和一个相',
    'A bare horse': '单马',
    'A horse and one unadvanced soldier': '马和一个高兵',
    'Two horses': '双马',
    'A bare cannon': '单炮',
    'A cannon and one advisor': '炮和一个仕',
    'A cannon with all four defensive pieces': '炮仕相全',
    'Horse and cannon, both sides with four defensive pieces': '马炮，双方均士象全',
    'A bare chariot': '单车',
    'A chariot and cannon, no defensive pieces': '车炮，无仕相',
    'A chariot and cannon with all four defensive pieces': '车炮仕相全',
    'Two chariots': '双车',
    // defenders
    'Bare general': '光将',
    'One advisor': '单士',
    'Two advisors': '双士',
    'Two elephants': '双象',
    'One advisor and one elephant': '单士单象',
    'All four defensive pieces (士象全)': '士象全',
    'All four defensive pieces': '士象全',
    'A horse and two advisors': '马双士',
    'A cannon and two elephants': '炮双象',
    'Two soldiers': '双卒',
    'A bare advisor': '单士',
    'A bare elephant': '单象',
    'A bare elephant, caught on one flank': '单象，被逼在一侧',
    'Three defensive pieces': '士象不全（三子）',
    'A horse': '单马',
    'A cannon': '单炮',
    'A horse and two elephants, in the drawing fortress': '马双象，摆成例和阵形',
    'A horse and two elephants, one elephant misplaced': '马双象，其中一象位置有误',
    'A horse and cannon, no defensive pieces (單車難勝馬炮)': '马炮，无士象（单车难胜马炮）',
    'A bare chariot holding the middle file': '单车占住中路',
    // The counterexample pairs: same material as the entry they vary, one point
    // moved. The Chinese says which point, because that is the whole entry.
    'A horse and cannon, cannon one point off': '马炮，炮偏了一路',
    'A bare chariot one rank too high': '单车占中，但高了一路',
    'Three soldiers, pulled back one rank': '三个兵，各退一路',
    'A chariot with all four defensive pieces': '车士象全',
    'A chariot and all four defensive pieces': '车士象全',
    'Two horses and all four defensive pieces': '双马士象全',
    // the 象棋残局 page rows (2026-10)
    'One soldier on the last rank': '一个底兵',
    'One unadvanced soldier': '一个高兵',
    'A high and a low soldier': '高低兵',
    'Two cannons': '双炮',
    'Two cannons and an advisor': '双炮仕',
    'One advisor, the winning exception': '单士（巧胜局面）',
    'A cannon beside its general': '单炮，守在将旁',
    'One soldier across the river': '一个过河卒',
    'All four defensive pieces, both elephants on the edge': '士象全，双象在边',
    'A cannon and two advisors': '炮双士',
    'A cannon and two advisors, both advisors at home': '炮双士，双士都在底线',
    'A bare chariot, Red holding the middle file': '单车，红方车占中路',
  },
  'zh-Hant': {
    // attackers
    'One soldier, across the river': '一個過河兵',
    'One soldier (with general and elephant)': '一個兵（另有帥和相）',
    'Five soldiers, all on the last rank': '五個兵，全在底線',
    'Two unadvanced soldiers': '雙高兵',
    'Three unadvanced soldiers': '三高兵',
    'General and soldier': '帥和一個兵',
    'Two soldiers and an elephant': '雙兵和一個相',
    'A bare horse': '單馬',
    'A horse and one unadvanced soldier': '馬和一個高兵',
    'Two horses': '雙馬',
    'A bare cannon': '單砲',
    'A cannon and one advisor': '砲和一個仕',
    'A cannon with all four defensive pieces': '砲仕相全',
    'Horse and cannon, both sides with four defensive pieces': '馬砲，雙方均士象全',
    'A bare chariot': '單車',
    'A chariot and cannon, no defensive pieces': '車砲，無仕相',
    'A chariot and cannon with all four defensive pieces': '車砲仕相全',
    'Two chariots': '雙車',
    // defenders
    'Bare general': '光將',
    'One advisor': '單士',
    'Two advisors': '雙士',
    'Two elephants': '雙象',
    'One advisor and one elephant': '單士單象',
    'All four defensive pieces (士象全)': '士象全',
    'All four defensive pieces': '士象全',
    'A horse and two advisors': '馬雙士',
    'A cannon and two elephants': '砲雙象',
    'Two soldiers': '雙卒',
    'A bare advisor': '單士',
    'A bare elephant': '單象',
    'A bare elephant, caught on one flank': '單象，被逼在一側',
    'Three defensive pieces': '士象不全（三子）',
    'A horse': '單馬',
    'A cannon': '單砲',
    'A horse and two elephants, in the drawing fortress': '馬雙象，擺成例和陣形',
    'A horse and two elephants, one elephant misplaced': '馬雙象，其中一象位置有誤',
    'A horse and cannon, no defensive pieces (單車難勝馬炮)': '馬砲，無士象（單車難勝馬炮）',
    'A bare chariot holding the middle file': '單車佔住中路',
    'A horse and cannon, cannon one point off': '馬砲，砲偏了一路',
    'A bare chariot one rank too high': '單車佔中，但高了一路',
    'Three soldiers, pulled back one rank': '三個兵，各退一路',
    'A chariot with all four defensive pieces': '車士象全',
    'A chariot and all four defensive pieces': '車士象全',
    'Two horses and all four defensive pieces': '雙馬士象全',
    // the 象棋残局 page rows (2026-10)
    'One soldier on the last rank': '一個底兵',
    'One unadvanced soldier': '一個高兵',
    'A high and a low soldier': '高低兵',
    'Two cannons': '雙砲',
    'Two cannons and an advisor': '雙砲仕',
    'One advisor, the winning exception': '單士（巧勝局面）',
    'A cannon beside its general': '單砲，守在將旁',
    'One soldier across the river': '一個過河卒',
    'All four defensive pieces, both elephants on the edge': '士象全，雙象在邊',
    'A cannon and two advisors': '砲雙士',
    'A cannon and two advisors, both advisors at home': '砲雙士，雙士都在底線',
    'A bare chariot, Red holding the middle file': '單車，紅方車佔中路',
  },
};

/** Free prose: the `note` and `engineDispute` fields. */
const PROSE: Record<EndgameStudyLang, Record<string, string>> = {
  'zh-Hans': {
    'Wins as long as the soldier has not reached the last rank, where it can no longer advance.':
      '只要兵还没走到底线就能取胜，到了底线便无法再前进。',
    'Tempo decides it: Red to play wins, Black to play draws. The general rule is that any extra defensive piece draws, and this is the case that takes real technique.':
      '先手决定胜负：红先胜，黑先和。通例是防守方多一个士象即可求和，而这一型最考验实战功夫。',
    'Soldiers cannot move backward, so on the last rank five of them still cannot force mate or stalemate. Material is not the same thing as mating power.':
      '兵不能后退，所以五个兵全到底线仍然既不能将死也不能困毙对方。子力多寡不等于杀棋能力。',
    'A cannon with no platform to jump is close to useless on defence.':
      '没有炮架可借的炮，在防守中几乎起不到作用。',
    'The mixed pair defends where either pair alone does not: the advisor covers the palace, the elephant covers the approach.':
      '一士一象比双士或双象更好守：士守住九宫，象守住通路。',
    'The headline surprise of xiangqi endgames: three soldiers beat the full defence, while a chariot does not.':
      '象棋残局中最出人意料的一条：三高兵可胜士象全，而一个车反而不能。',
    'Red wins with either side to move. 1.Gd1 is a waiting move that puts Black in zugzwang; the win comes from the red general seizing the middle file, not from the soldier alone.':
      '无论谁先走红方都胜。1.帅四九是等着，令黑方欠行；取胜靠的是红帅占住中路，而不是单靠那个兵。',
    'Reciprocal zugzwang: whoever moves first loses. Set for Black to move, so the verdict is a Red win; flip the side to move and it is a Black win.':
      '双方欠行：谁先走谁负。此局面设为黑先，故结论是红胜；把先走方改为红方，则变成黑胜。',
    'The horse beats a lone advisor but not a lone elephant, which can shuttle between flanks faster than the horse can cut it off.':
      '马可胜单士，却不能胜单象：象在两翼往返的速度快过马的封锁。',
    'The same material as above, but tempo-dependent: Red to play wins with 1.Hd7, cutting the elephant off from the far flank. Black to play draws with 1...Ee8. This is why the class verdict is a draw and this position is not.':
      '子力与上一型相同，但取决于先手：红先走马四七，切断象通往远侧的退路即胜；黑先走象５进７则和。这正是该类残局的通例判和、而此一局面判胜的原因。',
    'The fourth defensive piece is the whole difference between this and the win above.':
      '与上一型的胜局相比，差别只在于防守方多了第四个士象。',
    'Two horses beat the full defence; a chariot, worth more than both, does not.':
      '双马可胜士象全；而子力价值高于双马的车却不能。',
    'A cannon needs a platform to capture, so with nothing to jump it cannot mate. Adding elephants does not help; it needs an advisor, which can screen on any of the three central files.':
      '炮吃子必须借炮架，无子可借便无法成杀。加象没有用，需要的是士，因为士能在中路三条线上任意一条充当炮架。',
    '1.Ge3 wins an advisor: 1...Gd9 runs into 2.Ae2#, and after 1...Ge10 2.Cxd8 the recapture is illegal because the advisor is pinned by the facing generals.':
      '1.帅五进二可得一士：1...将４进１则2.仕五进六杀；1...将５进１则2.炮打士，黑方无法吃回，因为该士被白脸将牵制。',
    'A cannon needs at least an extra soldier to break the full defence.':
      '炮要破士象全，至少还需要一个兵。',
    'Same attacking material, and the defending minor piece alone flips the result: a cannon holds where a horse does not.':
      '进攻子力相同，仅仅换掉防守方的那个小子，结果就翻转：炮守得住，马守不住。',
    'The strongest piece on the board cannot break the full defence, though three soldiers or two horses can. Piece values do not survive into the basic endgames.':
      '盘上最强的子破不了士象全，而三高兵或双马却可以。子力价值那一套到了基本残局就不成立了。',
    'This exact arrangement holds. Most other defensive placements of the same material lose, which is what makes it a fortress rather than a material verdict.':
      '只有摆成这一阵形才守得住。同样的子力换成其他大多数摆法都要输，所以这是一个阵形问题，而不是子力问题。',
    'The fortress above with the g6 elephant moved to g10 instead. Same material, same attacker, and now Red wins starting with 1.Rb7. The pair is the clearest demonstration in the corpus that material does not decide these endgames.':
      '把上一型阵形中位于３路的象改摆到底线。子力相同，进攻方也相同，红方却可以走车二进六取胜。这一对局面最能说明：这类残局不是由子力决定的。',
    'The whole draw is one geometric relation: the cannon sits directly behind its own general, where it covers the back rank and cannot be skewered against it. Move that cannon one point sideways and the tablebase turns the position into a Red mate. The horse only has to stay off squares a single chariot move attacks. This replaced a position of our own (Ke1 Ra5 kd10 ne8 ce9) that had the cannon beside the general instead of behind it, and loses: Pikafish mates it in 15 and the database in 13.':
      '守和全靠一个位置关系：炮摆在自己将的正后方，既守住底线，又不会被车串将吃掉。把这个炮平开一路，残局库就判红方胜。马只要避开红车一步能捉到的位置即可。此局面替换了我们原先自拟的摆法，那一摆法是把炮放在将的旁边而不是身后，Pikafish 十五回合成杀，残局库十三回合成杀。',
    'The defending chariot has to hold the middle file BELOW the attacking pieces, because the mate it is preventing (海底撈月) is executed at the bottom of that file. It also drives the red general off the middle file. Leave the chariot on the middle file but a rank too high and Red plants the cannon underneath it, defended by the chariot on the same rank, and wins: move the defender here from e5 to e6 and the database turns the draw into a Red win.':
      '防守方的车要占住中路，而且必须占在进攻子力的下方，因为它要防的杀法（海底捞月）是在中路底部完成的。车占中同时也把红帅逼离中路。若车虽在中路却高了一路，红方就能把炮送到它下面，由同一横线上的车保护，从而取胜：同一局面把黑车从中路第五线挪到第六线，残局库便由和转为红胜。',
    'Drawn with good defensive placement.': '防守位置得当即可求和。',
    'Two horses is the losing pair; other two-minor-piece combinations hold.':
      '双马这一组合守不住；其他两个小子的组合则可以守和。',
    'The drawn fortress one point away from itself. Slide the defending cannon off the file behind its own general and the draw is gone: the database gives Red a forced mate. The cannon was not doing a cannon\u2019s job in the draw, it was standing in the one square where the chariot could never skewer it against the general, and a single sideways step gives that square up.':
      '和棋阵形，只差一路。把防守方的炮从自己将的正后方平开，和棋就没有了：残局库判红方必胜。在和棋里，这个炮并不是在当炮用，它是站在唯一一个不会被车串将吃掉的位置上，平开一路，就把这个位置让了出去。',
    'The defending chariot holds the middle file one rank too high, and that is the whole difference: Red plants the cannon underneath it, defended by the chariot on the same rank, and the database gives Red a forced mate. The drawn version of this position is the entry above; the mate it prevents (\u6d77\u5e95\u635e\u6708) is executed at the BOTTOM of the middle file, which is why the defender has to stay below the attackers rather than merely on the file.':
      '防守方的车虽然占住了中路，却高了一路，差别全在这里：红方把炮送到它下面，由同一横线上的车保护，残局库判红方必胜。和棋的那一型就是上一条；它要防的杀法（海底捞月）是在中路的底部完成的，所以防守方必须待在进攻子力的下方，而不只是待在中路上。',
    'The headline result of this corpus, undone by one rank. Three UNADVANCED soldiers beat the full defence; the same three soldiers a rank further back draw. An unadvanced soldier here means one standing on the fourth rank of the enemy half, close enough that the defence cannot both hold the palace and meet them. Pull them back and the win is not merely harder, it is gone: the database says draw. This is the sharpest illustration in the set that these endgames are decided by where the pieces stand and not by what they are.':
      '本集里最出名的结论，退一路就不成立了。三个高兵能破士象全；同样这三个兵各退一路，就只能成和。这里说的高兵，是指已经推进到对方半场靠前的位置，近到防守方无法既守住九宫又兼顾它们。往回退一路，赢棋不是变难，而是没有了：残局库判和。在这一组局面里，这是最能说明问题的一例，说明这类残局由子力所在的位置决定，而不是由子力本身决定。',
  },
  'zh-Hant': {
    'Wins as long as the soldier has not reached the last rank, where it can no longer advance.':
      '只要兵還沒走到底線就能取勝，到了底線便無法再前進。',
    'Tempo decides it: Red to play wins, Black to play draws. The general rule is that any extra defensive piece draws, and this is the case that takes real technique.':
      '先手決定勝負：紅先勝，黑先和。通例是防守方多一個士象即可求和，而這一型最考驗實戰功夫。',
    'Soldiers cannot move backward, so on the last rank five of them still cannot force mate or stalemate. Material is not the same thing as mating power.':
      '兵不能後退，所以五個兵全到底線仍然既不能將死也不能困斃對方。子力多寡不等於殺棋能力。',
    'A cannon with no platform to jump is close to useless on defence.':
      '沒有砲架可借的砲，在防守中幾乎起不到作用。',
    'The mixed pair defends where either pair alone does not: the advisor covers the palace, the elephant covers the approach.':
      '一士一象比雙士或雙象更好守：士守住九宮，象守住通路。',
    'The headline surprise of xiangqi endgames: three soldiers beat the full defence, while a chariot does not.':
      '象棋殘局中最出人意料的一條：三高兵可勝士象全，而一個車反而不能。',
    'Red wins with either side to move. 1.Gd1 is a waiting move that puts Black in zugzwang; the win comes from the red general seizing the middle file, not from the soldier alone.':
      '無論誰先走紅方都勝。1.帥四九是等著，令黑方欠行；取勝靠的是紅帥佔住中路，而不是單靠那個兵。',
    'Reciprocal zugzwang: whoever moves first loses. Set for Black to move, so the verdict is a Red win; flip the side to move and it is a Black win.':
      '雙方欠行：誰先走誰負。此局面設為黑先，故結論是紅勝；把先走方改為紅方，則變成黑勝。',
    'The horse beats a lone advisor but not a lone elephant, which can shuttle between flanks faster than the horse can cut it off.':
      '馬可勝單士，卻不能勝單象：象在兩翼往返的速度快過馬的封鎖。',
    'The same material as above, but tempo-dependent: Red to play wins with 1.Hd7, cutting the elephant off from the far flank. Black to play draws with 1...Ee8. This is why the class verdict is a draw and this position is not.':
      '子力與上一型相同，但取決於先手：紅先走馬四七，切斷象通往遠側的退路即勝；黑先走象５進７則和。這正是該類殘局的通例判和、而此一局面判勝的原因。',
    'The fourth defensive piece is the whole difference between this and the win above.':
      '與上一型的勝局相比，差別只在於防守方多了第四個士象。',
    'Two horses beat the full defence; a chariot, worth more than both, does not.':
      '雙馬可勝士象全；而子力價值高於雙馬的車卻不能。',
    'A cannon needs a platform to capture, so with nothing to jump it cannot mate. Adding elephants does not help; it needs an advisor, which can screen on any of the three central files.':
      '砲吃子必須借砲架，無子可借便無法成殺。加象沒有用，需要的是士，因為士能在中路三條線上任意一條充當砲架。',
    '1.Ge3 wins an advisor: 1...Gd9 runs into 2.Ae2#, and after 1...Ge10 2.Cxd8 the recapture is illegal because the advisor is pinned by the facing generals.':
      '1.帥五進二可得一士：1...將４進１則2.仕五進六殺；1...將５進１則2.砲打士，黑方無法吃回，因為該士被白臉將牽制。',
    'A cannon needs at least an extra soldier to break the full defence.':
      '砲要破士象全，至少還需要一個兵。',
    'Same attacking material, and the defending minor piece alone flips the result: a cannon holds where a horse does not.':
      '進攻子力相同，僅僅換掉防守方的那個小子，結果就翻轉：砲守得住，馬守不住。',
    'The strongest piece on the board cannot break the full defence, though three soldiers or two horses can. Piece values do not survive into the basic endgames.':
      '盤上最強的子破不了士象全，而三高兵或雙馬卻可以。子力價值那一套到了基本殘局就不成立了。',
    'This exact arrangement holds. Most other defensive placements of the same material lose, which is what makes it a fortress rather than a material verdict.':
      '只有擺成這一陣形才守得住。同樣的子力換成其他大多數擺法都要輸，所以這是一個陣形問題，而不是子力問題。',
    'The fortress above with the g6 elephant moved to g10 instead. Same material, same attacker, and now Red wins starting with 1.Rb7. The pair is the clearest demonstration in the corpus that material does not decide these endgames.':
      '把上一型陣形中位於３路的象改擺到底線。子力相同，進攻方也相同，紅方卻可以走車二進六取勝。這一對局面最能說明：這類殘局不是由子力決定的。',
    'The whole draw is one geometric relation: the cannon sits directly behind its own general, where it covers the back rank and cannot be skewered against it. Move that cannon one point sideways and the tablebase turns the position into a Red mate. The horse only has to stay off squares a single chariot move attacks. This replaced a position of our own (Ke1 Ra5 kd10 ne8 ce9) that had the cannon beside the general instead of behind it, and loses: Pikafish mates it in 15 and the database in 13.':
      '守和全靠一個位置關係：砲擺在自己將的正後方，既守住底線，又不會被車串將吃掉。把這個砲平開一路，殘局庫就判紅方勝。馬只要避開紅車一步能捉到的位置即可。此局面替換了我們原先自擬的擺法，那一擺法是把砲放在將的旁邊而不是身後，Pikafish 十五回合成殺，殘局庫十三回合成殺。',
    'The defending chariot has to hold the middle file BELOW the attacking pieces, because the mate it is preventing (海底撈月) is executed at the bottom of that file. It also drives the red general off the middle file. Leave the chariot on the middle file but a rank too high and Red plants the cannon underneath it, defended by the chariot on the same rank, and wins: move the defender here from e5 to e6 and the database turns the draw into a Red win.':
      '防守方的車要佔住中路，而且必須佔在進攻子力的下方，因為它要防的殺法（海底撈月）是在中路底部完成的。車佔中同時也把紅帥逼離中路。若車雖在中路卻高了一路，紅方就能把砲送到它下面，由同一橫線上的車保護，從而取勝：同一局面把黑車從中路第五線挪到第六線，殘局庫便由和轉為紅勝。',
    'Drawn with good defensive placement.': '防守位置得當即可求和。',
    'Two horses is the losing pair; other two-minor-piece combinations hold.':
      '雙馬這一組合守不住；其他兩個小子的組合則可以守和。',
    'The drawn fortress one point away from itself. Slide the defending cannon off the file behind its own general and the draw is gone: the database gives Red a forced mate. The cannon was not doing a cannon\u2019s job in the draw, it was standing in the one square where the chariot could never skewer it against the general, and a single sideways step gives that square up.':
      '和棋陣形，只差一路。把防守方的砲從自己將的正後方平開，和棋就沒有了：殘局庫判紅方必勝。在和棋裡，這個砲並不是在當砲用，它是站在唯一一個不會被車串將吃掉的位置上，平開一路，就把這個位置讓了出去。',
    'The defending chariot holds the middle file one rank too high, and that is the whole difference: Red plants the cannon underneath it, defended by the chariot on the same rank, and the database gives Red a forced mate. The drawn version of this position is the entry above; the mate it prevents (\u6d77\u5e95\u635e\u6708) is executed at the BOTTOM of the middle file, which is why the defender has to stay below the attackers rather than merely on the file.':
      '防守方的車雖然佔住了中路，卻高了一路，差別全在這裡：紅方把砲送到它下面，由同一橫線上的車保護，殘局庫判紅方必勝。和棋的那一型就是上一條；它要防的殺法（海底撈月）是在中路的底部完成的，所以防守方必須待在進攻子力的下方，而不只是待在中路上。',
    'The headline result of this corpus, undone by one rank. Three UNADVANCED soldiers beat the full defence; the same three soldiers a rank further back draw. An unadvanced soldier here means one standing on the fourth rank of the enemy half, close enough that the defence cannot both hold the palace and meet them. Pull them back and the win is not merely harder, it is gone: the database says draw. This is the sharpest illustration in the set that these endgames are decided by where the pieces stand and not by what they are.':
      '本集裡最出名的結論，退一路就不成立了。三個高兵能破士象全；同樣這三個兵各退一路，就只能成和。這裡說的高兵，是指已經推進到對方半場靠前的位置，近到防守方無法既守住九宮又兼顧它們。往回退一路，贏棋不是變難，而是沒有了：殘局庫判和。在這一組局面裡，這是最能說明問題的一例，說明這類殘局由子力所在的位置決定，而不是由子力本身決定。',
  },
};

/** The fixed frame the seeder wraps around the corpus fields.
 *
 *  `versus` carries its own surrounding spaces on purpose. Without them a
 *  material phrase ending in 相 fuses with the separator into 相對 ("relative
 *  to"), so "車砲，無仕相" 對 "單車…" read as one wrong word. Spaces break every
 *  such collision uniformly instead of special-casing the phrases that collide. */
type Template = {
  versus: string;
  win: string;
  draw: string;
  dispute: string;
  depth: (depth: number, score: string) => string;
  mainline: (plies: number) => string;
  diagram: string;
  constructed: string;
  mate: (moves: number) => string;
  mated: (moves: number) => string;
  noScore: string;
  notChecked: string;
};

const TEMPLATES: Record<EndgameStudyLang, Template> = {
  'zh-Hans': {
    versus: ' 对 ',
    win: '红胜（例胜）。',
    draw: '和棋（例和）。',
    dispute: '引擎不认同这一结论。',
    depth: (depth, score) => `Pikafish 搜索深度 ${depth}：${score}。`,
    mainline: (plies) => `下方主变即引擎给出的着法，共 ${plies} 着。`,
    diagram: '此局面依原书棋图摆出。',
    constructed: '此局面由我们摆出以代表该类残局，并非取自原书棋图。',
    mate: (moves) => `${moves} 步杀`,
    mated: (moves) => `被 ${moves} 步杀`,
    noScore: '无评分',
    notChecked: '未经引擎核对',
  },
  'zh-Hant': {
    versus: ' 對 ',
    win: '紅勝（例勝）。',
    draw: '和棋（例和）。',
    dispute: '引擎不認同這一結論。',
    depth: (depth, score) => `Pikafish 搜尋深度 ${depth}：${score}。`,
    mainline: (plies) => `下方主變即引擎給出的著法，共 ${plies} 著。`,
    diagram: '此局面依原書棋圖擺出。',
    constructed: '此局面由我們擺出以代表該類殘局，並非取自原書棋圖。',
    mate: (moves) => `${moves} 步殺`,
    mated: (moves) => `被 ${moves} 步殺`,
    noScore: '無評分',
    notChecked: '未經引擎核對',
  },
};

/** Study-level name and description. */
export const ENDGAME_STUDY_I18N: Record<EndgameStudyLang, { name: string; description: string }> = {
  'zh-Hans': {
    name: '象棋基本残局：什么例胜，什么例和',
    description:
      '基本残局的通例结论，每一则都配一个有代表性的局面，主变是 Pikafish 给出的着法。请自己摆棋验证，不要只凭结论。这些结论的出处、核对过程，以及残局库给出的确切答案，见 https://brianhliou.com/posts/xiangqi-basic-endgames/',
  },
  'zh-Hant': {
    name: '象棋基本殘局：什麼例勝，什麼例和',
    description:
      '基本殘局的通例結論，每一則都配一個有代表性的局面，主變是 Pikafish 給出的著法。請自己擺棋驗證，不要只憑結論。這些結論的出處、核對過程，以及殘局庫給出的確切答案，見 https://brianhliou.com/posts/xiangqi-basic-endgames/',
  },
};

function material(text: string, lang: EndgameStudyLang): string | null {
  return MATERIAL[lang][text] ?? null;
}

function prose(text: string, lang: EndgameStudyLang): string | null {
  return PROSE[lang][text] ?? null;
}

/**
 * Localized chapter name, or null when either half of the material is
 * untranslated. Null rather than a half-translated name: "三高兵 vs All four
 * defensive pieces" is worse for a reader than the English original.
 */
export function localizedChapterName(entry: EndgameEntry, lang: EndgameStudyLang): string | null {
  const attacker = material(entry.attacker, lang);
  const defender = material(entry.defender, lang);
  if (!attacker || !defender) return null;
  return `${attacker}${TEMPLATES[lang].versus}${defender}`;
}

function scoreText(
  row: { mate: number | null; cp: number | null } | undefined,
  lang: EndgameStudyLang,
): string {
  const t = TEMPLATES[lang];
  if (!row) return t.notChecked;
  if (row.mate != null && row.mate !== 0) {
    return row.mate > 0 ? t.mate(row.mate) : t.mated(-row.mate);
  }
  if (row.cp == null) return t.noScore;
  return `${row.cp > 0 ? '+' : ''}${(row.cp / 100).toFixed(1)}`;
}

/**
 * Localized root comment, or null when any prose the entry actually uses is
 * untranslated. Same reasoning as the chapter name: a comment that switches
 * language halfway is worse than one that stays in English.
 */
export function localizedRootComment(
  entry: EndgameEntry,
  row: { depth: number; mate: number | null; cp: number | null } | undefined,
  plies: number,
  lang: EndgameStudyLang,
): string | null {
  const t = TEMPLATES[lang];
  const attacker = material(entry.attacker, lang);
  const defender = material(entry.defender, lang);
  if (!attacker || !defender) return null;

  const parts = [`${attacker}${t.versus}${defender}。${entry.verdict === 'win' ? t.win : t.draw}`];
  if (entry.note) {
    const note = prose(entry.note, lang);
    if (!note) return null;
    parts.push(note);
  }
  if (entry.engineDispute) {
    const dispute = prose(entry.engineDispute, lang);
    if (!dispute) return null;
    parts.push(`${t.dispute}${dispute}`);
  }
  if (row) {
    parts.push(t.depth(row.depth, scoreText(row, lang)) + (plies > 0 ? t.mainline(plies) : ''));
  }
  parts.push(entry.provenance === 'diagram' ? t.diagram : t.constructed);
  return parts.join('\n\n');
}

/** Every English string the dictionaries currently key, for the coverage test. */
export function endgameStudyTranslationKeys(lang: EndgameStudyLang): string[] {
  return [...Object.keys(MATERIAL[lang]), ...Object.keys(PROSE[lang])];
}

export function hasEndgameStudyTranslation(lang: EndgameStudyLang, text: string): boolean {
  return Object.hasOwn(MATERIAL[lang], text) || Object.hasOwn(PROSE[lang], text);
}

/**
 * The five PRACTICE studies built from this same corpus (one per piece family,
 * seeded by seed-xiangqi-practice-study.ts for the /practice shelf).
 *
 * They live here rather than beside `SETS` in the seeder because everything
 * above already translates the corpus these studies are cut from: the chapter
 * names and root comments come out of the same dictionaries, and splitting the
 * study-level text into a second file is how the two would drift. Keyed by the
 * curated slug, which is the one handle on these studies that never changes.
 *
 * Only the study's own name and description are here. Chapter text is generated,
 * exactly as it is for the reading study.
 */
export const PRACTICE_SET_I18N: Record<
  string,
  Record<EndgameStudyLang, { name: string; description: string }>
> = {
  'endgames-soldier': {
    'zh-Hans': {
      name: '兵类残局',
      description: '单兵能取胜的局面，和不能取胜的局面。兵不能后退，所以其中有些例胜，有些例和。',
    },
    'zh-Hant': {
      name: '兵類殘局',
      description: '單兵能取勝的局面，和不能取勝的局面。兵不能後退，所以其中有些例勝，有些例和。',
    },
  },
  'endgames-chariot': {
    'zh-Hans': {
      name: '车类残局',
      description: '车是唯一能单独取胜的子力。这些局面里，胜负仍然要靠技术来定。',
    },
    'zh-Hant': {
      name: '車類殘局',
      description: '車是唯一能單獨取勝的子力。這些局面裡，勝負仍然要靠技術來定。',
    },
  },
  'endgames-horse': {
    'zh-Hans': {
      name: '马类残局',
      description: '马走得慢，还会被蹩腿。用马取胜，考的是时机。',
    },
    'zh-Hant': {
      name: '馬類殘局',
      description: '馬走得慢，還會被蹩腿。用馬取勝，考的是時機。',
    },
  },
  'endgames-cannon': {
    'zh-Hans': {
      name: '炮类残局',
      description: '炮要有炮架才打得出去，所以盘上子力越少越对防守方有利。也包括马炮的组合。',
    },
    'zh-Hant': {
      name: '砲類殘局',
      description: '砲要有砲架才打得出去，所以盤上子力越少越對防守方有利。也包括馬砲的組合。',
    },
  },
  'endgames-insufficient': {
    'zh-Hans': {
      name: '不足以取胜',
      description: '无论怎么摆，这些子力都无法成杀。守住和棋；要点是知道它们本来就是例和。',
    },
    'zh-Hant': {
      name: '不足以取勝',
      description: '無論怎麼擺，這些子力都無法成殺。守住和棋；要點是知道它們本來就是例和。',
    },
  },
};

/**
 * Localized root comment for a PRACTICE chapter, or null when the entry's prose
 * is untranslated.
 *
 * Shorter than `localizedRootComment` on purpose, and it must stay that way: a
 * practice chapter's comment is the only text the learner sees before they have
 * solved it, so the reading study's verdict line ("红胜（例胜）") would hand them
 * the answer to the exercise. The seeder's English side makes the same choice by
 * using `entry.note` alone, and falling back to the matchup when there is none.
 */
export function localizedPracticeComment(
  entry: EndgameEntry,
  lang: EndgameStudyLang,
): string | null {
  return entry.note ? prose(entry.note, lang) : localizedChapterName(entry, lang);
}
