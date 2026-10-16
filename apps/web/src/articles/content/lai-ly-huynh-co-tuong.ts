// Vietnamese translation of the lai-ly-huynh player page, at its own slug.
//
// NOT a second article. lai-ly-huynh is the single structural source; this file
// is only the dictionary that turns its strings Vietnamese. Regenerate the English
// page and any new string appears here in English until a line is added below.
// See derived-translation.ts for the mechanism.
//
// The slug is the phrase Vietnamese players search, `lại lý huynh cờ tướng`,
// rather than a /vi/ prefix: the prefix belongs to interface locales and the
// language policy closes that set at en/zh-Hans/zh-Hant.
//
// Machine-drafted 2026-10-01, not native-reviewed. Machine translation is the
// shipping standard (set 2026-08-29), so there is no status override and no
// hold for a native read: the page inherits lai-ly-huynh's status and dates.
//
// The first Vietnamese player page, planted as one seed while the study-sitemap
// experiment runs. Not the start of a batch of vi player pages.
//
// Beyond the strings articleStrings collects, the dictionary also covers the
// image alts, the word cells of both tables and the Chinese players' names on
// the replay boards, because deriveTranslation substitutes every string it
// meets and a Vietnamese reader should see Doãn Thăng on the board as well as
// in the prose. The engine notes on the boards stay English, as on the zh pages.

import { deriveTranslation } from '../derived-translation.js';
import { laiLyHuynhArticle } from './lai-ly-huynh.js';

export const LAI_LY_HUYNH_CO_TUONG_VI: Record<string, string> = {
  // Front matter
  'Lại Lý Huynh 赖理兄': 'Lại Lý Huynh',
  'Lại Lý Huynh 赖理兄, the world xiangqi champion: games and analysis':
    'Lại Lý Huynh, nhà vô địch cờ tướng thế giới: các ván đấu và phân tích',
  'The first world champion from outside China, unbeaten in Shanghai and winner of the final with black. His title run and the year since, five wins on the board, 38 games analysed.':
    'Nhà vô địch cờ tướng thế giới đầu tiên không đến từ Trung Quốc, bất bại ở Thượng Hải và thắng trận chung kết khi cầm quân Đen. Hành trình lên ngôi và một năm sau đó, năm ván thắng trên bàn cờ, 38 ván được phân tích.',
  'English-speaking xiangqi players, and Vietnamese fans who want his games in one place with analysis.':
    'Người hâm mộ cờ tướng Việt Nam muốn xem các ván đấu của anh ở cùng một nơi, kèm phân tích.',
  'Lại Lý Huynh at the board.': 'Lại Lý Huynh bên bàn cờ.',

  // Intro
  'Lại Lý Huynh in a white team shirt, arms folded, looking down at the board during a game.':
    'Lại Lý Huynh mặc áo đội tuyển màu trắng, khoanh tay, nhìn xuống bàn cờ trong một ván đấu.',
  'Lại Lý Huynh at the Five Rams Cup, Guangzhou, February 2026. Photo: Vietnam Xiangqi Federation, via Thanh Niên.':
    'Lại Lý Huynh tại Ngũ Dương Bôi, Quảng Châu, tháng 2 năm 2026. Ảnh: Liên đoàn Cờ tướng Việt Nam, qua báo Thanh Niên.',
  "Lại Lý Huynh 赖理兄 is the world champion. In Shanghai last September he went through the World Xiangqi Championship without losing a game and won the final against China's Yin Sheng with the black pieces, the first player from outside China to take the title. The Chinese press calls him Vietnam's king of xiangqi, 越南棋王. At home his fans call him Nam Phương công tử, the young master from the South.":
    'Lại Lý Huynh (赖理兄) là nhà vô địch cờ tướng thế giới. Tháng 9 năm ngoái tại Thượng Hải, anh đi trọn Giải vô địch cờ tướng thế giới mà không thua ván nào và thắng trận chung kết trước Doãn Thăng của Trung Quốc khi cầm quân Đen, trở thành kỳ thủ đầu tiên ngoài Trung Quốc giành danh hiệu này. Báo chí Trung Quốc gọi anh là “Việt Nam kỳ vương” (越南棋王). Ở quê nhà, người hâm mộ gọi anh là Nam Phương công tử.',
  "He was born in 1990 in Vĩnh Long, in the Mekong Delta, and learned the game watching his father play. He has won Vietnam's national championship six times and holds the WXF's International Grandmaster title. In 2016 he became the first foreign player in China's top league, for Hangzhou, and in 2023 he won the league with them. In February he was the first wildcard ever to reach the final of the Five Rams Cup, China's invitation event for its national champions.":
    'Anh sinh năm 1990 tại Vĩnh Long, miền Tây Nam Bộ, và học cờ từ những lần xem cha chơi. Anh sáu lần vô địch quốc gia và mang danh hiệu Đại kiện tướng quốc tế của Liên đoàn Cờ tướng thế giới (WXF). Năm 2016, anh trở thành kỳ thủ nước ngoài đầu tiên thi đấu ở giải Giáp A cờ tướng Trung Quốc, trong màu áo Hàng Châu, và năm 2023 anh cùng Hàng Châu vô địch giải. Tháng 2 vừa qua, anh là kỳ thủ nhận suất đặc cách đầu tiên từng vào tới chung kết Ngũ Dương Bôi, giải mời dành cho các nhà vô địch quốc gia của Trung Quốc.',
  'This page is his year as champion: the title run, the year since, and five of his wins on the board. I ran the 38 individual games we hold through the same engine analysis Mistboard gives your own games.':
    'Trang này kể về năm đầu tiên anh khoác áo nhà vô địch: hành trình lên ngôi, một năm sau đó, và năm ván thắng của anh trên bàn cờ. Tôi đã cho 38 ván đấu cá nhân mà chúng tôi có chạy qua cùng hệ thống phân tích bằng engine mà Mistboard dùng cho chính các ván cờ của bạn.',

  // How he plays
  'How he plays': 'Lối chơi của anh',
  '**He wins with black.** Five of his six wins in Shanghai came with the black pieces, the side that moves second, the final among them. Across the 38 individual games we hold he won eight with black and three with red. With red he mostly draws, thirteen of his eighteen red games.':
    '**Anh thắng bằng quân Đen.** Năm trong sáu trận thắng của anh ở Thượng Hải đến khi cầm quân Đen, bên đi sau, trong đó có trận chung kết. Trong 38 ván đấu cá nhân mà chúng tôi có, anh thắng tám ván khi cầm quân Đen và ba ván khi cầm quân Đỏ. Cầm quân Đỏ, anh chủ yếu hòa: mười ba trong mười tám ván.',
  '**He opens with the Cross-Palace Cannon.** In eleven of his eighteen red games his first move slid a cannon across to the far side of his own palace. It is a quieter start than the central cannon, and it leaves the game to be won later.':
    '**Anh khai cuộc bằng Quá cung pháo.** Trong mười một trên mười tám ván cầm quân Đỏ, nước đầu tiên của anh là bình một con pháo sang phía bên kia cung tướng của mình. Đây là cách mở màn êm hơn pháo đầu, và nó để dành chuyện phân thắng bại cho về sau.',
  '**He was precise when it counted.** His median accuracy across the nine games in Shanghai was 98. The engine confirms three sacrifices in his year, a piece offered and never won back, and one of them came in the world final.':
    '**Anh chính xác khi cần nhất.** Độ chính xác trung vị của anh qua chín ván ở Thượng Hải là 98. Engine xác nhận ba lần thí quân của anh trong năm, tức là một quân bỏ ra và không bao giờ lấy lại, và một trong số đó diễn ra ở trận chung kết thế giới.',
  '**He learned from China\'s best.** "The league gave me a very valuable chance to learn," he told 羊城晚报 in February. "I could play and at the same time study how China\'s top players play." He has trained with engines since 2005.':
    '**Anh học từ những kỳ thủ giỏi nhất Trung Quốc.** “Giải Giáp A cho tôi một cơ hội học hỏi rất quý giá,” anh nói với Dương Thành Vãn Báo (羊城晚报) hồi tháng 2. “Tôi vừa được thi đấu, vừa được học cách các kỳ thủ hàng đầu Trung Quốc chơi cờ.” Anh tập luyện với engine từ năm 2005.',

  // The world title
  'The world title': 'Ngôi vô địch thế giới',
  "He had been one game from the title before. In Houston in 2023 he reached the final against Meng Chen, drew the slow game and lost the rapid tiebreak. Two years later the championship ran in Shanghai from 22 to 27 September, eight rounds and then a final between the top two. He won five and drew three, against Yin Sheng on the first day, Meng Fanrui and Malaysia's Li Dezhi, and finished level with Yin Sheng on 13 points.":
    'Anh từng chỉ cách ngôi vô địch một ván. Tại Houston năm 2023, anh vào chung kết gặp Mạnh Thần, hòa ván cờ chậm rồi thua ở loạt cờ nhanh phân định. Hai năm sau, giải vô địch diễn ra ở Thượng Hải từ ngày 22 đến 27 tháng 9, gồm tám vòng đấu rồi một trận chung kết giữa hai người dẫn đầu. Anh thắng năm, hòa ba, các ván hòa là trước Doãn Thăng ngay ngày đầu tiên, Mạnh Phồn Duệ và Li Dezhi của Malaysia, và kết thúc với 13 điểm, bằng Doãn Thăng.',
  'His world championship, round by round.': 'Hành trình vô địch thế giới của anh, qua từng vòng.',
  Round: 'Vòng',
  Opponent: 'Đối thủ',
  Colour: 'Cầm quân',
  Result: 'Kết quả',
  'Ryan Emmanuel Haris (East Malaysia)': 'Ryan Emmanuel Haris (Đông Malaysia)',
  'Yin Sheng (China)': 'Doãn Thăng (Trung Quốc)',
  'Mingjian Li (USA)': 'Mingjian Li (Mỹ)',
  'Tony Fung Ga Zen (Hong Kong)': 'Tony Fung Ga Zen (Hồng Kông)',
  'Calvin Tay Yelin (East Malaysia)': 'Calvin Tay Yelin (Đông Malaysia)',
  'Meng Fanrui (China)': 'Mạnh Phồn Duệ (Trung Quốc)',
  'Chong Heung Ming (Philippines)': 'Chong Heung Ming (Philippines)',
  'Li Dezhi (Malaysia)': 'Li Dezhi (Malaysia)',
  Black: 'Đen',
  Red: 'Đỏ',
  Win: 'Thắng',
  Draw: 'Hòa',
  Final: 'Chung kết',
  "In round three he met the United States' Mingjian Li, who held him level for nineteen moves. Li's chariot push on move 20 let it go. Lại finished at 98 percent accuracy and needed another 47 moves to bring it home.":
    'Ở vòng ba, anh gặp Mingjian Li của Mỹ, người giữ thế cân bằng với anh suốt mười chín nước. Nước tiến xe của Li ở nước 20 đánh mất thế cân bằng đó. Lại Lý Huynh kết thúc ván với độ chính xác 98% và cần thêm 47 nước nữa để khép lại ván cờ.',
  '2025 World Xiangqi Championship, round 3': 'Giải vô địch cờ tướng thế giới 2025, vòng 3',
  '0-1': '0-1',
  "Mingjian Li vs Lại Lý Huynh, 23 September 2025, round 3. The board opens after red's 20th move, with Lại to play as black.":
    'Mingjian Li gặp Lại Lý Huynh, 23 tháng 9 năm 2025, vòng 3. Bàn cờ mở ra sau nước thứ 20 của Đỏ, đến lượt Lại Lý Huynh cầm quân Đen.',
  "In round seven Chong Heung Ming of the Philippines slid his cannon across on move 17. Lại's horse jumped into the centre the same move, the engine's own first choice, and his cannon followed it in. Chong resigned after move 32.":
    'Ở vòng bảy, Chong Heung Ming của Philippines bình pháo ở nước 17. Ngay nước đó, mã của Lại Lý Huynh nhảy vào trung lộ, đúng lựa chọn số một của engine, và pháo của anh theo vào sau. Chong xin thua sau nước 32.',
  '2025 World Xiangqi Championship, round 7': 'Giải vô địch cờ tướng thế giới 2025, vòng 7',
  "Chong Heung Ming vs Lại Lý Huynh, 25 September 2025, round 7. The board opens after red's 17th move, with Lại to play as black.":
    'Chong Heung Ming gặp Lại Lý Huynh, 25 tháng 9 năm 2025, vòng 7. Bàn cờ mở ra sau nước thứ 17 của Đỏ, đến lượt Lại Lý Huynh cầm quân Đen.',
  "The final was one game, Yin Sheng with red. Yin Sheng pressed early, and by move 27 it was level again. Lại pushed his central cannon into Yin Sheng's camp, a piece offer the engine rates as the best move on the board. Yin Sheng took it, and the engine still called the game level. On move 38 his advisor stepped back. From there Lại's soldier on the third file walked down the board, and Yin Sheng resigned after move 52.":
    'Trận chung kết chỉ có một ván, Doãn Thăng cầm quân Đỏ. Doãn Thăng ép từ sớm, và đến nước 27 thế cờ đã trở lại cân bằng. Lại Lý Huynh đẩy pháo đầu vào trận địa của Doãn Thăng, một nước thí quân mà engine đánh giá là nước hay nhất trên bàn cờ. Doãn Thăng ăn quân, và engine vẫn coi ván cờ là cân bằng. Ở nước 38, sĩ của Doãn Thăng lùi về. Từ đó, con tốt 3 của Lại Lý Huynh tiến dần xuống bàn cờ, và Doãn Thăng xin thua sau nước 52.',
  '2025 World Xiangqi Championship, final': 'Giải vô địch cờ tướng thế giới 2025, chung kết',
  "Yin Sheng vs Lại Lý Huynh, 27 September 2025, the final. The board opens after red's 27th move, with Lại to play as black.":
    'Doãn Thăng gặp Lại Lý Huynh, 27 tháng 9 năm 2025, trận chung kết. Bàn cờ mở ra sau nước thứ 27 của Đỏ, đến lượt Lại Lý Huynh cầm quân Đen.',
  "Yin Sheng was born in 2005. A year later he went 31 games without a loss and has [his own page](/blog/yin-sheng). The championship's history, and Lại's earlier games in it, are on the [world championship page](/blog/xiangqi-world-championship).":
    'Doãn Thăng sinh năm 2005. Một năm sau trận chung kết, anh có chuỗi 31 ván bất bại và có [trang riêng](/blog/yin-sheng). Lịch sử của giải, cùng những ván đấu trước đây của Lại Lý Huynh tại giải, có trên [trang giải vô địch thế giới](/blog/xiangqi-world-championship).',

  // The year since
  'The year since': 'Một năm sau đó',
  "At home the title made him a national figure. In June the state awarded him the First-Class Labour Order, and in April he won the rapid title at the national championship. Most of his games this year, though, were against China's best on their ground, and those are in the table below.":
    'Ở quê nhà, ngôi vô địch biến anh thành gương mặt của cả nước. Tháng 6, Nhà nước trao tặng anh Huân chương Lao động hạng Nhất, và tháng 4 anh giành chức vô địch cờ nhanh tại giải vô địch quốc gia. Tuy vậy, phần lớn các ván đấu của anh năm nay là trước những kỳ thủ giỏi nhất Trung Quốc ngay trên sân nhà của họ, và chúng nằm trong bảng dưới đây.',
  Event: 'Giải đấu',
  Dates: 'Thời gian',
  W: 'T',
  D: 'H',
  L: 'B',
  'World Rapid Open, Shanghai': 'Giải cờ nhanh mở rộng thế giới, Thượng Hải',
  'Sep 26, 2025': '26/9/2025',
  'Match vs Cao Yanlei, Zhengzhou': 'Đấu với Tào Nham Lỗi, Trịnh Châu',
  'Jan 3–5': '3–5/1',
  'Dukang arena final, Zhengzhou': 'Chung kết lôi đài Tửu Tổ Đỗ Khang, Trịnh Châu',
  'Jan 9–10': '9–10/1',
  'Five Rams Cup, Guangzhou': 'Ngũ Dương Bôi, Quảng Châu',
  'Feb 25–Mar 1': '25/2–1/3',
  'Chunqiu Daye arena': 'Lôi đài Xuân Khâu Đại Diệp',
  May: 'Tháng 5',
  'Vietnam vs Guangdong, Đà Nẵng': 'Việt Nam gặp Quảng Đông, Đà Nẵng',
  Jul: 'Tháng 7',
  'The year since the title, events with a complete record.':
    'Một năm sau ngôi vô địch, các giải đấu có kết quả đầy đủ.',
  "In January a tea company booked him and Cao Yanlei into a room in Zhengzhou for [ten rapid games](/broadcast/xiangqi/2026-chunqiu-dayie-ten-game-match) over three evenings, a rematch of their 2016 Han Xin Cup final in Sydney. Cao won the match 12 to 8, and [his page](/blog/cao-yanlei) tells it from his side. Lại's win was game eight, with black, in 18 moves. Cao's horse stepped back on move 15; Lại's chariot went straight up the file in reply, his horse followed, and Cao resigned three moves later.":
    'Tháng 1, một công ty trà mời anh và Tào Nham Lỗi vào một căn phòng ở Trịnh Châu đấu [mười ván cờ nhanh](/broadcast/xiangqi/2026-chunqiu-dayie-ten-game-match) trong ba buổi tối, tái đấu trận chung kết Hàn Tín Bôi năm 2016 của hai người tại Sydney. Tào Nham Lỗi thắng chung cuộc 12-8, và [trang của Tào Nham Lỗi](/blog/cao-yanlei) kể lại trận đấu từ phía anh ấy. Ván thắng của Lại Lý Huynh là ván thứ tám, cầm quân Đen, chỉ sau 18 nước. Mã của Tào Nham Lỗi lùi ở nước 15; xe của Lại Lý Huynh lập tức tiến thẳng lên theo cột để đáp trả, mã theo sau, và Tào Nham Lỗi xin thua ba nước sau đó.',
  '2026 ten-game match, game 8': 'Trận đấu mười ván 2026, ván 8',
  "Cao Yanlei vs Lại Lý Huynh, 5 January 2026, game 8 of the match. The board opens after red's 15th move, with Lại to play as black.":
    'Tào Nham Lỗi gặp Lại Lý Huynh, 5 tháng 1 năm 2026, ván 8 của trận đấu. Bàn cờ mở ra sau nước thứ 15 của Đỏ, đến lượt Lại Lý Huynh cầm quân Đen.',
  "The Five Rams Cup in Guangzhou (五羊杯) invites China's national champions. In February it gave its first wildcard to Lại, and he reached the final. In the semi-final he beat Zhao Panwei, the opponent Cao Yanlei found hardest all year, winning the first game with red and drawing the second. Zhao's horse jumped forward on move 17; Lại's horses came forward and Zhao resigned after move 40. Cheng Yudong beat him in the final, a draw and then a loss. The [whole event](/broadcast/xiangqi/2026-wuyang-cup) is in the broadcast archive.":
    'Ngũ Dương Bôi ở Quảng Châu (五羊杯) là giải mời các nhà vô địch quốc gia của Trung Quốc. Tháng 2 năm nay, giải lần đầu trao suất đặc cách, cho Lại Lý Huynh, và anh vào tới chung kết. Ở bán kết, anh hạ Triệu Phàn Vỹ, đối thủ mà Tào Nham Lỗi thấy khó chơi nhất cả năm, thắng ván đầu khi cầm quân Đỏ và hòa ván thứ hai. Mã của Triệu Phàn Vỹ nhảy lên ở nước 17; hai con mã của Lại Lý Huynh tiến lên và Triệu Phàn Vỹ xin thua sau nước 40. Ở chung kết, anh thua Trình Vũ Đông sau một ván hòa và một ván thua. [Toàn bộ giải đấu](/broadcast/xiangqi/2026-wuyang-cup) có trong kho lưu trữ giải đấu.',
  '2026 Five Rams Cup, semi-final': 'Ngũ Dương Bôi 2026, bán kết',
  '1-0': '1-0',
  "Lại Lý Huynh vs Zhao Panwei, 28 February 2026, Five Rams Cup semi-final, game 1. The board opens after black's 17th move, with Lại to move.":
    'Lại Lý Huynh gặp Triệu Phàn Vỹ, 28 tháng 2 năm 2026, bán kết Ngũ Dương Bôi, ván 1. Bàn cờ mở ra sau nước thứ 17 của Đen, đến lượt Lại Lý Huynh đi.',
  '"Since I won the world championship, more people in Vietnam follow xiangqi," he said in Guangzhou, "and more of them have started playing."':
    '“Từ khi tôi vô địch thế giới, ở Việt Nam có nhiều người theo dõi cờ tướng hơn,” anh nói ở Quảng Châu, “và cũng nhiều người bắt đầu chơi cờ hơn.”',

  // All 38 games
  'All 38 games': 'Toàn bộ 38 ván',
  "Every game on this page is in a Mistboard study with the engine's judgments and lines, and 15 of them are in the broadcast archive with the site's analysis. Sources: game records from dpxq.com, which may not hold every game of an event; the round table from the WXF results book; the Five Rams Cup and arena records from VnExpress, and the Vietnam vs Guangdong record from VnExpress and 象棋热情; analysis by Pikafish through Mistboard's review pipeline, October 2026.":
    'Mọi ván đấu trên trang này đều có trong một bài nghiên cứu trên Mistboard, kèm đánh giá và các biến của engine, và 15 ván trong số đó có trong kho lưu trữ giải đấu với phần phân tích của trang. Nguồn: biên bản ván đấu từ dpxq.com, nơi có thể không lưu đủ mọi ván của một giải; bảng kết quả từng vòng từ sổ kết quả của WXF; kết quả Ngũ Dương Bôi và các trận lôi đài từ VnExpress, kết quả trận Việt Nam gặp Quảng Đông từ VnExpress và 象棋热情; phân tích bằng Pikafish qua hệ thống phân tích ván đấu của Mistboard, tháng 10 năm 2026.',
  'Open the study': 'Mở bài nghiên cứu',
  'His games in the archive': 'Các ván của anh trong kho lưu trữ',

  // Player names on the replay boards (spec red/black)
  'Yin Sheng': 'Doãn Thăng',
  'Cao Yanlei': 'Tào Nham Lỗi',
  'Zhao Panwei': 'Triệu Phàn Vỹ',
};

export const laiLyHuynhCoTuongArticle = deriveTranslation(laiLyHuynhArticle, {
  slug: 'lai-ly-huynh-co-tuong',
  sourceLang: 'vi',
  dict: LAI_LY_HUYNH_CO_TUONG_VI,
});
