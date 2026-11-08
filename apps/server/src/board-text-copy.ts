// Catalog strings mirrored for server bodies; board-text-body.test.ts pins every locale.
export const BOARD_COPY = {
  en: {
    'replay.red': 'Red',
    'replay.black': 'Black',
    'replay.moves': 'Moves',
    'analysis.fen': 'FEN',
    'study.gameEvent': 'Event',
    'study.gameDate': 'Date',
    'study.gameResult': 'Result',
    'study.gameSource': 'Source',
    'study.gameVs': 'vs',
    'puzzle.solution': 'Solution',
    'puzzle.themeField': 'Theme',
    'puzzle.toMove': '{color} to move',
    'bots.firstPartyBadge': 'First-party',
    'bots.communityBadge': 'Community',
    'bots.gamesHere': 'Games here',
    'bots.recordHere': 'Record here',
    'bots.variants': 'Variants',
    'bots.recentGames': 'Recent games',
    'bots.ratings': 'Ratings',
    'bots.noPublishedRating': 'No published rating yet',
    'profile.playerProfile': 'Player profile',
    'profile.ratings': 'Ratings',
    'profile.games': 'Games',
    'profile.noGamesYet': 'No games yet.',
    'profile.filterOpponent': 'Opponent',
    'puzzle.findBestMove': 'Find the best move.',
    'puzzle.label': 'Puzzle ',
    'puzzle.mateIn': 'Mate in {count}',
    'puzzle.winIn': 'Win in {count}',
    'puzzle.winning': 'Winning',
    'puzzle.fromGame': 'From game',
    'bots.recordTitle': 'Wins, losses, draws',
    'bots.fairyStockfishLevelBio':
      "Level {level} of Mistboard's eight-level ladder, backed by Fairy-Stockfish.",
    'bots.pikafishLevelBio':
      "Level {level} of Mistboard's jieqi ladder, backed by the Pikafish jieqi engine. Level 8 is Pikafish at full strength.",
    'bots.generalBlunderBio':
      'A strong engine trying its hardest to lose. It looks at every move and plays the one that is worst for itself, so most turns there is a checkmate or a free piece waiting for you. Find it. Runs on Fairy-Stockfish.',
    'bots.pikafishBio':
      'Open source, built from Stockfish, and searching three million positions a move. It plays jieqi too.',
    'bots.abJchessBio':
      "An open-source jieqi engine by Huorongrong and Laoxu (Kouza), with its own neural network. Its AB-JChess-20261031 release is built on jqe's code and took the top spot back from jqe, winning 306 games, losing 227 and drawing 67 in our 600-game match. It thinks 4 seconds a move. Played here with their permission.",
    'bots.jqeBio':
      "An open-source jieqi engine by Devin O'Keefe, with its own neural network trained on self-play. It held the top spot from October 21, 2026, after beating AB-JChess 0.2d 171 games to 114 with 15 draws, and now plays one level below AB-JChess-20261031, which is built on its code. It thinks 4 seconds a move. Played here with his permission.",
    'bots.katagoBio':
      "The strongest Jungle Chess engine we know of: hzyhhzy's KataGomo, built on lightvector's KataGo, with the neural network from Kouza's Dandelion 4. Played here with permission.",
    'bots.mistyBio':
      "Mistboard's own engine for Fog Chess, Fog Xiangqi, banqi, Jungle Chess and Flip Jungle.",
    'live.timeClassBullet': 'Bullet',
    'live.timeClassBlitz': 'Blitz',
    'live.timeClassRapid': 'Rapid',
    'live.timeClassClassical': 'Classical',
    'setup.correspondence': 'Correspondence',
    'bots.profileTitle': '{name} · Bot · Mistboard',
    'puzzle.tagName.matein1': 'Mate in 1',
    'puzzle.tagName.matein2': 'Mate in 2',
    'puzzle.tagName.matein3': 'Mate in 3',
    'puzzle.tagName.matein4': 'Mate in 4',
    'puzzle.tagName.opening': 'Opening',
    'puzzle.tagName.middlegame': 'Middlegame',
    'puzzle.tagName.endgame': 'Endgame',
    'puzzle.tagName.checkmate': 'Checkmate',
    'puzzle.tagName.winning': 'Winning advantage',
    'puzzle.tagName.one-move': 'One-move puzzle',
    'puzzle.tagName.short': 'Short puzzle',
    'puzzle.tagName.long': 'Long puzzle',
    'puzzle.tagName.very-long': 'Very long puzzle',
  },
  'zh-Hans': {
    'replay.red': '红方',
    'replay.black': '黑方',
    'replay.moves': '着法',
    'analysis.fen': 'FEN',
    'study.gameEvent': '赛事',
    'study.gameDate': '日期',
    'study.gameResult': '结果',
    'study.gameSource': '来源',
    'study.gameVs': '对',
    'puzzle.solution': '答案',
    'puzzle.themeField': '主题',
    'puzzle.toMove': '{color}走棋',
    'bots.firstPartyBadge': '官方',
    'bots.communityBadge': '社区',
    'bots.gamesHere': '本站对局',
    'bots.recordHere': '本站战绩',
    'bots.variants': '棋种',
    'bots.recentGames': '最近对局',
    'bots.ratings': '等级分',
    'bots.noPublishedRating': '尚无公开等级分',
    'profile.playerProfile': '玩家资料',
    'profile.ratings': '评分',
    'profile.games': '对局',
    'profile.noGamesYet': '还没有对局。',
    'profile.filterOpponent': '对手',
    'puzzle.findBestMove': '找出最佳着法。',
    'puzzle.label': '题目 ',
    'puzzle.mateIn': '{count}步杀',
    'puzzle.winIn': '{count}步获胜',
    'puzzle.winning': '优势',
    'puzzle.fromGame': '取自对局',
    'bots.recordTitle': '胜、负、和',
    'bots.fairyStockfishLevelBio': 'Mistboard 八级阶梯的第 {level} 级，使用 Fairy-Stockfish 引擎。',
    'bots.pikafishLevelBio':
      'Mistboard 揭棋阶梯的第 {level} 级，使用 Pikafish 揭棋引擎。第 8 级是全力运行的 Pikafish。',
    'bots.generalBlunderBio':
      '一个竭尽全力求败的强大引擎。它检查每个走法，选择对自己最不利的一步，因此大多数回合都有将杀或白吃棋子的机会等你发现。使用 Fairy-Stockfish 引擎。',
    'bots.pikafishBio': '开源，由 Stockfish 改造而来，每步搜索三百万个局面。也可以下揭棋。',
    'bots.abJchessBio':
      '开源揭棋引擎，作者 Huorongrong 和 Laoxu（Kouza），自带神经网络。其 AB-JChess-20261031 版本基于 jqe 的代码，在我们 600 局的对抗赛中以 306 胜 227 负 67 和战胜 jqe，重回本站榜首。每步思考 4 秒。经作者许可在本站使用。',
    'bots.jqeBio':
      "开源揭棋引擎，作者 Devin O'Keefe，自带神经网络，通过自我对弈训练。2026 年 10 月 21 日以 171 胜 114 负 15 和战胜 AB-JChess 0.2d 登上本站榜首，现位于基于其代码的 AB-JChess-20261031 之下一级。每步思考 4 秒。经作者许可在本站使用。",
    'bots.katagoBio':
      '我们所知最强的斗兽棋引擎：hzyhhzy 的 KataGomo，基于 lightvector 的 KataGo，神经网络来自 Kouza 的 Dandelion 4。经作者许可在本站使用。',
    'bots.mistyBio': 'Mistboard 自研引擎，下迷雾国际象棋、迷雾象棋、暗棋、斗兽棋和翻翻兽棋。',
    'live.timeClassBullet': '子弹',
    'live.timeClassBlitz': '闪电',
    'live.timeClassRapid': '快速',
    'live.timeClassClassical': '古典',
    'setup.correspondence': '通信对局',
    'bots.profileTitle': '{name} · 机器人 · Mistboard',
    'puzzle.tagName.matein1': '一步杀',
    'puzzle.tagName.matein2': '两步杀',
    'puzzle.tagName.matein3': '三步杀',
    'puzzle.tagName.matein4': '四步杀',
    'puzzle.tagName.opening': '开局',
    'puzzle.tagName.middlegame': '中局',
    'puzzle.tagName.endgame': '残局',
    'puzzle.tagName.checkmate': '杀棋',
    'puzzle.tagName.winning': '谋得胜势',
    'puzzle.tagName.one-move': '一步题',
    'puzzle.tagName.short': '短题',
    'puzzle.tagName.long': '长题',
    'puzzle.tagName.very-long': '超长题',
  },
  'zh-Hant': {
    'replay.red': '紅方',
    'replay.black': '黑方',
    'replay.moves': '著法',
    'analysis.fen': 'FEN',
    'study.gameEvent': '賽事',
    'study.gameDate': '日期',
    'study.gameResult': '結果',
    'study.gameSource': '來源',
    'study.gameVs': '對',
    'puzzle.solution': '答案',
    'puzzle.themeField': '主題',
    'puzzle.toMove': '{color}走棋',
    'bots.firstPartyBadge': '官方',
    'bots.communityBadge': '社群',
    'bots.gamesHere': '本站對局',
    'bots.recordHere': '本站戰績',
    'bots.variants': '棋種',
    'bots.recentGames': '最近對局',
    'bots.ratings': '等級分',
    'bots.noPublishedRating': '尚無公開等級分',
    'profile.playerProfile': '玩家個人資料',
    'profile.ratings': '評分',
    'profile.games': '對局',
    'profile.noGamesYet': '還沒有對局。',
    'profile.filterOpponent': '對手',
    'puzzle.findBestMove': '找出最佳著法。',
    'puzzle.label': '題目 ',
    'puzzle.mateIn': '{count}步殺',
    'puzzle.winIn': '{count}步獲勝',
    'puzzle.winning': '優勢',
    'puzzle.fromGame': '取自對局',
    'bots.recordTitle': '勝、負、和',
    'bots.fairyStockfishLevelBio': 'Mistboard 八級階梯的第 {level} 級，使用 Fairy-Stockfish 引擎。',
    'bots.pikafishLevelBio':
      'Mistboard 揭棋階梯的第 {level} 級，使用 Pikafish 揭棋引擎。第 8 級是全力運行的 Pikafish。',
    'bots.generalBlunderBio':
      '一個竭盡全力求敗的強大引擎。它檢查每個走法，選擇對自己最不利的一步，因此大多數回合都有將殺或白吃棋子的機會等你發現。使用 Fairy-Stockfish 引擎。',
    'bots.pikafishBio': '開源，由 Stockfish 改造而來，每步搜尋三百萬個局面。也可以下揭棋。',
    'bots.abJchessBio':
      '開源揭棋引擎，作者 Huorongrong 和 Laoxu（Kouza），自帶神經網路。其 AB-JChess-20261031 版本基於 jqe 的程式碼，在我們 600 局的對抗賽中以 306 勝 227 負 67 和戰勝 jqe，重回本站榜首。每步思考 4 秒。經作者許可在本站使用。',
    'bots.jqeBio':
      "開源揭棋引擎，作者 Devin O'Keefe，自帶神經網路，透過自我對弈訓練。2026 年 10 月 21 日以 171 勝 114 負 15 和戰勝 AB-JChess 0.2d 登上本站榜首，現位於基於其程式碼的 AB-JChess-20261031 之下一級。每步思考 4 秒。經作者許可在本站使用。",
    'bots.katagoBio':
      '我們所知最強的鬥獸棋引擎：hzyhhzy 的 KataGomo，基於 lightvector 的 KataGo，神經網路來自 Kouza 的 Dandelion 4。經作者許可在本站使用。',
    'bots.mistyBio': 'Mistboard 自研引擎，下迷霧西洋棋、迷霧象棋、暗棋、鬥獸棋和翻翻獸棋。',
    'live.timeClassBullet': '子彈',
    'live.timeClassBlitz': '閃電',
    'live.timeClassRapid': '快速',
    'live.timeClassClassical': '古典',
    'setup.correspondence': '通信對局',
    'bots.profileTitle': '{name} · 機器人 · Mistboard',
    'puzzle.tagName.matein1': '一步殺',
    'puzzle.tagName.matein2': '兩步殺',
    'puzzle.tagName.matein3': '三步殺',
    'puzzle.tagName.matein4': '四步殺',
    'puzzle.tagName.opening': '開局',
    'puzzle.tagName.middlegame': '中局',
    'puzzle.tagName.endgame': '殘局',
    'puzzle.tagName.checkmate': '殺棋',
    'puzzle.tagName.winning': '謀得勝勢',
    'puzzle.tagName.one-move': '一步題',
    'puzzle.tagName.short': '短題',
    'puzzle.tagName.long': '長題',
    'puzzle.tagName.very-long': '超長題',
  },
} as const;
export type BoardLocale = keyof typeof BOARD_COPY;
export function boardCopy(locale: BoardLocale, key: keyof typeof BOARD_COPY.en): string {
  return BOARD_COPY[locale][key];
}

export function boardTimeClass(value: string, locale: BoardLocale): string {
  if (locale === 'en') return value;
  switch (value) {
    case 'bullet':
      return boardCopy(locale, 'live.timeClassBullet');
    case 'blitz':
      return boardCopy(locale, 'live.timeClassBlitz');
    case 'rapid':
      return boardCopy(locale, 'live.timeClassRapid');
    case 'correspondence':
      return boardCopy(locale, 'setup.correspondence');
    default:
      return '';
  }
}
