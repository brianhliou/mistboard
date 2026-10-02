// Vietnamese translation of the jieqi openings article, at its own slug.
//
// NOT a second article. jieqi-openings is the single structural source; this file
// is only the dictionary that turns its strings Vietnamese. Add a section to the
// English page and it appears here automatically, in English, until a line is
// added below. See derived-translation.ts for why the hand-authored model was
// dropped.
//
// The slug is the phrase a Vietnamese player searches, `khai cuoc co up`, rather
// than a /vi/ prefix: the prefix belongs to interface locales and the language
// policy closes that set at en/zh-Hans/zh-Hant.
//
// Two non-prose entries. The rules link points at the Vietnamese rules page, and
// the closing CTA points at co-up rather than the English platform page, because
// sending a Vietnamese reader to English is the leak this exists to close. Both
// targets have to be published before this page is, or the CTA lands on a 404.
//
// No status override, deliberately. co-up carries one because it was held for a
// native read; that hold was retired on 2026-08-29 when machine translation
// became the shipping standard. This page inherits jieqi-openings' status and
// date, so it publishes when the English page does, and articles-meta-sync
// fails the build until the server's unpublished set agrees.
//
// The diagram labels below are swapped inside the rendered SVG by
// deriveTranslation, since the renderer calls the thunk with no arguments and
// the label parameters those builders accept are unreachable from here.

import { deriveTranslation } from '../derived-translation.js';
import { jieqiOpeningsArticle } from './jieqi-openings.js';

export const KHAI_CUOC_CO_UP_VI: Record<string, string> = {
  // Front matter
  'What Strong Jieqi Players Believe About the Opening':
    'Người chơi cờ úp giỏi tin gì về khai cuộc',
  'Jieqi Opening Theory: The First Move, Ranked':
    'Lý thuyết khai cuộc cờ úp: xếp hạng nước đi đầu tiên',
  'Jieqi has no opening book. It has an argument about the first move, running on Chinese forums among players with thousands of games, never written down in English. Why a face-down piece is a one-shot option you can waste, five openings ranked, and the pawn push weighed against the crossed cannon on all six reveals.':
    'Cờ úp không có sách khai cuộc. Nó chỉ có một cuộc tranh luận về nước đi đầu tiên, chạy nhiều năm trên các diễn đàn Trung Quốc giữa những người chơi hàng nghìn ván, chưa từng được viết ra bằng tiếng Anh hay tiếng Việt. Vì sao một quân úp là quyền chọn dùng đúng một lần mà bạn có thể phí đi, năm khai cuộc được xếp hạng, và thế tiến tốt đặt lên bàn cân với pháo qua sông trên cả sáu khả năng lật.',
  'Jieqi and xiangqi players who want to know what the first move is worth, and English speakers who have never seen this material because it has only ever existed in Chinese.':
    'Người chơi cờ úp và cờ tướng muốn biết nước đi đầu tiên đáng giá bao nhiêu, và những người đọc tiếng Việt chưa từng thấy tài liệu này vì nó chỉ từng tồn tại bằng tiếng Trung.',

  // Intro
  'Jieqi has no opening book. No catalog of variations, no agreed piece-value table, nothing to memorize. One of the strongest players who writes about the game, a level-two Chinese xiangqi player claiming 90% over three thousand games, started the missing book and got one chapter in.':
    'Cờ úp không có sách khai cuộc. Không danh mục biến, không bảng giá trị quân được thống nhất, không có gì để học thuộc. Một trong những người chơi mạnh nhất từng viết về môn này, một kỳ thủ cờ tướng cấp hai người Trung Quốc tự nhận thắng 90% qua hơn ba nghìn ván, đã bắt tay viết cuốn sách còn thiếu đó và dừng lại sau đúng một chương.',
  'What exists is an argument about the first move, running on Chinese forums for years, never written down in English. Here it is, with the sources at the bottom. Treat it as what strong players believe: none of it has been measured.':
    'Cái đang tồn tại là một cuộc tranh luận về nước đi đầu tiên, kéo dài nhiều năm trên các diễn đàn Trung Quốc, chưa từng được viết ra bằng tiếng Anh hay tiếng Việt. Bài này là cuộc tranh luận đó, nguồn để ở cuối trang. Hãy đọc nó như điều những người chơi mạnh tin là đúng: chưa phần nào được đo đạc.',
  'Every piece but the two generals starts face-down and shuffled. Neither player knows their own.':
    'Mọi quân trừ hai tướng đều bắt đầu úp và đã xáo. Không bên nào biết quân của chính mình.',

  // A dark piece moves as the point it stands on
  'A dark piece moves as the point it stands on': 'Quân úp đi theo vị trí nó đang đứng',
  'A face-down piece moves, attacks, and captures as the piece belonging to the point it sits on, not as whatever it turns out to be. A dark piece on a cannon point moves like a cannon and captures like a cannon. Then it flips and plays as itself. The [rules page](/rules/jieqi) has the rest.':
    'Một quân úp đi, tấn công và ăn quân theo đúng quân thuộc về vị trí nó đang đứng, không theo cái nó hóa ra là. Quân úp đứng ở vị trí pháo thì đi như pháo và ăn như pháo. Rồi nó lật lên và chơi bằng chính thân phận của mình. [Trang luật](/blog/luat-co-up) nói phần còn lại.',
  'So a face-down piece holds one use of its square’s power. A dark piece on a chariot point is a chariot for exactly one move, and then it is whatever it actually is, which might be a pawn. That single move is the most valuable thing about it, and you get to spend it once.':
    'Vậy nên một quân úp nắm trong tay đúng một lần dùng sức mạnh của ô nó đứng. Quân úp ở vị trí xe là một con xe trong đúng một nước, sau đó nó là cái nó vốn là, có thể chỉ là một con tốt. Đúng nước đi đó là thứ giá trị nhất ở nó, và bạn chỉ được tiêu một lần.',
  'Flipping costs two things. The square’s power goes, and so does the concealment: your opponent does not know what the piece is either, so while it stays down it threatens as its point in their reading of the position too. What you buy is that the piece plays as itself from then on, which is often a downgrade. The common mistake is spending an expensive option on a cheap job, and it costs nothing you can see on the board.':
    'Lật quân mất hai thứ. Mất sức mạnh của ô, và mất luôn sự che giấu: đối thủ cũng không biết quân đó là gì, nên khi còn úp nó vẫn đe dọa như vị trí của nó trong cách đọc thế cờ của họ. Cái bạn mua được là từ đó quân cờ chơi bằng chính nó, mà thường là một bước lùi. Sai lầm phổ biến là tiêu một quyền chọn đắt tiền cho một việc rẻ tiền, và cái giá đó không hiện ra ở đâu trên bàn cờ.',
  'The same move, before and after. Face-down on a cannon point it slides the file and takes the horse behind the screen. Play that capture and you have spent a cannon’s only shot to win a horse, and what stands on the point is a soldier. Strong players call that trade a loss.':
    'Cùng một nước, trước và sau. Còn úp ở vị trí pháo, nó chạy dọc cột và ăn con mã sau ngòi. Đi nước ăn đó là bạn đã tiêu phát bắn duy nhất của một con pháo để đổi lấy một con mã, và thứ đứng lại trên ô đó là một con tốt. Người chơi mạnh gọi vụ đổi ấy là lỗ.',
  'The first move is therefore two decisions. You choose which option to spend, and you take a lottery ticket on what stands up.':
    'Vì vậy nước đi đầu tiên là hai quyết định. Bạn chọn tiêu quyền chọn nào, và bạn cầm một tấm vé số về cái sẽ lật lên.',

  // Five first moves, ranked
  'Five first moves, ranked': 'Năm nước đi đầu tiên, xếp hạng',
  'From the largest jieqi thread on Zhihu, ranked by a player with more than four hundred games.':
    'Lấy từ chủ đề cờ úp lớn nhất trên Zhihu, do một người chơi hơn bốn trăm ván xếp hạng.',
  'Where they are, from Red’s side. Left board, left to right: the edge pawn, the 3- or 7-file pawn push, the central pawn, and the cannon point crossing the river. Right board: both cannons firing over the black cannons to take both horses.':
    'Vị trí của chúng, nhìn từ phía Đỏ. Bàn trái, từ trái sang phải: tốt biên, thế tiến tốt cột 3 hoặc cột 7, tốt giữa, và pháo qua sông. Bàn phải: hai pháo bắn qua pháo Đen để ăn cả hai mã.',
  Opening: 'Khai cuộc',
  Verdict: 'Đánh giá',
  'Pawn push (仙人指路)': 'Tiến tốt, tiên nhân chỉ lộ (仙人指路)',
  'Standard. No bad reveal.': 'Chuẩn mực. Không có kết quả lật nào xấu.',
  'Crossed cannon (炮二进四)': 'Pháo qua sông (炮二进四)',
  'Good on a pawn, bad on a horse.': 'Hay khi lật ra tốt, dở khi lật ra mã.',
  'Central pawn (冲中兵)': 'Tốt giữa (冲中兵)',
  'Risky. Exposed in the middle.': 'Mạo hiểm. Hở ở giữa bàn.',
  'Edge pawn (九尾龟)': 'Tốt biên (九尾龟)',
  'Poor. An edge horse is stuck.': 'Kém. Mã ở biên bị kẹt.',
  'Both cannons take horses': 'Hai pháo ăn hai mã',
  'Losing. A weak player’s gamble against a strong one.':
    'Thua. Canh bạc của người yếu khi gặp người mạnh.',
  'Option cost explains both ends of that list. The pawn push is first because a pawn point’s one move is the cheapest thing in the game to spend. Taking two horses with two cannons is last because it spends the two most expensive options on the board for two horses.':
    'Giá của quyền chọn giải thích cả hai đầu danh sách. Tiến tốt đứng đầu vì một nước của vị trí tốt là thứ rẻ nhất trong ván cờ để đem tiêu. Dùng hai pháo ăn hai mã đứng cuối vì nó tiêu hai quyền chọn đắt nhất trên bàn để đổi lấy hai con mã.',
  'The middle two rank on position. The central pawn is the sensitive one: turn over a chariot there and a revealed cannon can kill it, but turn over a cannon and you can probe the centre and both edges for chariots, and those follow-ups are settled enough that players call them 定式, set patterns. The edge pawn is just as cheap and buys much less. It opens a path for the edge horse and announces that it is doing so, and a horse turned over on the edge is stuck where it stands.':
    'Hai thế ở giữa xếp hạng theo vị trí. Tốt giữa là thế nhạy cảm: lật ra xe ở đó thì một con pháo đã lộ có thể giết nó, nhưng lật ra pháo thì bạn thăm dò được cả trung lộ lẫn hai biên để tìm xe, và những nước tiếp theo đó ổn định đến mức người chơi gọi là 定式, tức định thức. Tốt biên rẻ ngang vậy mà mua được ít hơn nhiều. Nó mở đường cho mã biên và đồng thời báo cho đối thủ biết mình đang làm thế, còn con mã lật lên ở biên thì kẹt luôn tại chỗ.',
  'Our own games disagree with the list. Across fifty jieqi games here that ran past ten moves, humans playing Red opened with the central pawn in fourteen of twenty-five, and with the recommended pawn push in three. Whatever the forums say, players open in the middle.':
    'Các ván trên trang này lại không đồng ý với danh sách. Trong năm mươi ván cờ úp ở đây kéo dài quá mười nước, người chơi cầm Đỏ mở bằng tốt giữa ở mười bốn trong hai mươi lăm ván, và mở bằng thế tiến tốt được khuyên dùng ở ba ván. Diễn đàn nói gì thì nói, người chơi vẫn mở ở giữa.',
  'PikaJieQi, our build of Pikafish’s jieqi branch, declines the list altogether. In twenty of its twenty-five games as Red it opened from a back-rank horse point, h1 to g3 or b1 to c3, a development move none of the five covers. Read that carefully before treating it as a verdict. It is one engine at two settings repeating itself, not twenty independent opinions. The humans lost almost every game, so nothing here settles which opening is better. And PikaJieQi runs a hand-written evaluation with no neural network, so its opening preference reflects the heuristics someone wrote into it rather than anything it learned. What it does suggest is that the list answers a narrower question than it appears to.':
    'PikaJieQi, bản dựng của chúng tôi từ nhánh cờ úp của Pikafish, thì bỏ qua cả danh sách. Ở hai mươi trong hai mươi lăm ván cầm Đỏ, nó mở từ vị trí mã hàng cuối, h1 sang g3 hoặc b1 sang c3, một nước phát triển mà cả năm thế trên đều không nhắc tới. Hãy đọc kỹ chỗ này trước khi coi đó là một kết luận. Đây là một engine chạy ở hai thiết lập rồi lặp lại chính nó, không phải hai mươi ý kiến độc lập. Người chơi thua gần hết các ván đó, nên không có gì ở đây phân định được khai cuộc nào hay hơn. Và PikaJieQi chạy hàm đánh giá viết tay, không có mạng nơ-ron, nên thiên hướng khai cuộc của nó phản ánh các quy tắc do con người viết vào chứ không phải thứ nó tự học được. Điều nó gợi ra là danh sách kia trả lời một câu hỏi hẹp hơn vẻ ngoài của nó.',

  // The pawn push beats the crossed cannon on 13 of 15
  'The pawn push beats the crossed cannon on 13 of 15':
    'Tiến tốt hơn pháo qua sông ở 13 trên 15 khả năng',
  'A player rated 揭7 on two accounts weighed the top two against each other: the pawn push against the cannon point crossing the river. Whichever you pick, the piece you move is your own and you do not know what it is until it lands. Fifteen sit face-down on your side, five pawns and two each of chariot, horse, cannon, advisor and elephant, so the odds on what stands up are countable.':
    'Một người chơi đạt 揭7 trên hai tài khoản đã đặt hai thế đứng đầu lên bàn cân: tiến tốt so với pháo qua sông. Chọn thế nào thì quân bạn đẩy đi cũng là quân của chính bạn, và bạn không biết nó là gì cho tới khi nó dừng lại. Bên bạn có mười lăm quân úp, năm tốt cùng hai xe, hai mã, hai pháo, hai sĩ và hai tượng, nên xác suất về cái sẽ lật lên là đếm được.',
  'What flips up': 'Lật ra quân gì',
  Odds: 'Xác suất',
  'Better opening': 'Khai cuộc tốt hơn',
  Pawn: 'Tốt',
  Chariot: 'Xe',
  Cannon: 'Pháo',
  Horse: 'Mã',
  Elephant: 'Tượng',
  Advisor: 'Sĩ',
  'Pawn push': 'Tiến tốt',
  'Crossed cannon': 'Pháo qua sông',
  'On a pawn, the crossed cannon eats once and gives up two or three reveals in exchange. On a chariot, holding a dark cannon in reserve beats holding a dark pawn. The rest it simply plays less efficiently, and the advisor is the one case it wins, slightly.':
    'Nếu lật ra tốt, pháo qua sông ăn được một lần rồi đổi lại mất hai ba lượt lật. Nếu lật ra xe, giữ một con pháo còn úp trong tay hơn hẳn giữ một con tốt còn úp. Các trường hợp còn lại nó chỉ đơn giản là chơi kém hiệu quả hơn, và sĩ là trường hợp duy nhất nó thắng, mà thắng ít.',
  'Thirteen of the fifteen favour the pawn push, about 87%, and the count understates it: the crossed cannon’s one win is slight while several of the pawn push’s are decisive. The verdicts are theirs, the weights are mine from the piece counts, and nobody has run that comparison past an engine.':
    'Mười ba trong mười lăm quân nghiêng về tiến tốt, khoảng 87%, và con số này còn nói giảm: lần thắng duy nhất của pháo qua sông là thắng sít sao, trong khi vài lần thắng của tiến tốt là thắng dứt khoát. Các đánh giá là của họ, phần trọng số là của tôi tính từ số lượng quân, và chưa ai đem so sánh đó qua một engine.',
  'Those odds hold on move one. The deck does not refill, so every reveal narrows what is left, and a player counting what has already turned over is working from better numbers later in the game.':
    'Những xác suất đó chỉ đúng ở nước đầu tiên. Bộ quân không được bù lại, nên mỗi lần lật đều thu hẹp phần còn lại, và người biết đếm những quân đã lộ sẽ có những con số tốt hơn khi ván cờ đi xa.',

  // A chariot is worth about two cannons
  'A chariot is worth about two cannons': 'Một con xe đáng giá khoảng hai con pháo',
  'In xiangqi a chariot trades roughly for a horse and a cannon. In jieqi the same players put it higher, closer to two cannons, and arguably above a horse, cannon and advisor together. The general has no fixed guard here: any piece can be anything, so the wall in front of a jieqi general is whatever happened to land there, and a chariot walks through it.':
    'Trong cờ tướng, một con xe đổi ngang khoảng một mã cộng một pháo. Trong cờ úp, chính những người chơi ấy định giá nó cao hơn, gần bằng hai pháo, và có thể còn hơn cả mã, pháo và sĩ cộng lại. Ở đây tướng không có hàng phòng ngự cố định: quân nào cũng có thể là bất cứ thứ gì, nên bức tường trước mặt tướng trong cờ úp là những gì tình cờ rơi vào đó, và một con xe đi xuyên qua nó.',
  'Protect yours. Holding one chariot against two, refuse the trade, even with both of theirs still face-down. This is also why the two dark pieces on the back chariot points usually stay down: they defend, and they are the most expensive unspent options either player holds.':
    'Hãy giữ xe của bạn. Khi bạn có một xe đấu với hai xe, đừng đổi, kể cả khi cả hai xe của họ vẫn còn úp. Đây cũng là lý do hai quân úp ở hai vị trí xe hàng cuối thường được để nguyên: chúng phòng thủ, và chúng là những quyền chọn đắt giá nhất mà mỗi bên còn chưa tiêu.',

  // With a chariot: the river bank, then the file
  'With a chariot: the river bank, then the file': 'Khi đã có xe: chiếm bờ sông, rồi chiếm cột',
  'One sequence in jieqi behaves like a line. With a chariot out, take the opponent’s river bank, occupy a file, and prepare the attack that comes with exposing your own general. Experienced opponents know the answer: fly an elephant and jump a horse quickly, so the back chariot point covers the approach.':
    'Có đúng một chuỗi nước trong cờ úp hành xử như một biến thật sự. Khi đã có xe ra, hãy chiếm bờ sông bên đối phương, chiếm lấy một cột dọc, và chuẩn bị đòn tấn công đi kèm với việc hở tướng nhà. Đối thủ có kinh nghiệm biết cách đáp: lên tượng và nhảy mã thật nhanh, để vị trí xe hàng cuối che được đường vào.',
  'A chariot-led file attack against a fast elephant-and-horse screen is as close as this opening gets to established theory.':
    'Đòn tấn công dọc cột do xe dẫn đầu, đấu với màn chắn tượng và mã dựng nhanh, là thứ gần với lý thuyết đã định hình nhất mà khai cuộc cờ úp có được.',

  // Black races for a chariot of their own
  'Black races for a chariot of their own': 'Đen chạy đua để có xe của mình',
  'Everything above is Red’s choice. Red’s edge is larger here than in xiangqi, because chariots can sit face-down and arrive in the middlegame.':
    'Mọi thứ ở trên đều là lựa chọn của Đỏ. Lợi thế đi trước của Đỏ ở đây lớn hơn trong cờ tướng, vì xe có thể nằm úp và mãi tới trung cuộc mới xuất hiện.',
  'When Red’s pawn push turns over a chariot, develop a horse and race for a chariot of your own. There is no better answer, and strong players do not pretend there is one.':
    'Khi nước tiến tốt của Đỏ lật lên một con xe, hãy phát triển mã và chạy đua để có xe của mình. Không có cách đáp nào hay hơn, và người chơi mạnh cũng không giả vờ là có.',
  'When your chariots arrive late anyway, drop the development order. Pawn, then horse, then advisor is a peacetime plan. Get both horses out instead, so your pieces defend each other.':
    'Khi xe của bạn dù sao cũng ra muộn, hãy bỏ thứ tự phát triển quen thuộc. Tốt, rồi mã, rồi sĩ là kế hoạch thời bình. Thay vào đó hãy đưa cả hai mã ra, để các quân bảo vệ lẫn nhau.',

  // Stop flipping once three major pieces are out
  'Stop flipping once three major pieces are out': 'Ngừng lật khi đã có ba quân lớn ra trận',
  'Once three major pieces are revealed and active, attack with them. Flipping past that point hands the initiative to whoever is already developed, because a flip is a move that threatens nothing while your opponent uses theirs. On Tiantian Xiangqi the rated jieqi clock is tighter than the xiangqi one and carries no per-move increment, so the player still turning pieces over in a sharp position tends to lose on time as well.':
    'Khi đã có ba quân lớn lộ mặt và hoạt động, hãy tấn công bằng chúng. Lật thêm sau thời điểm đó là trao quyền chủ động cho bên đã phát triển xong, vì một nước lật là một nước không đe dọa gì trong khi đối thủ dùng nước của họ để làm việc khác. Trên Tiantian Xiangqi, đồng hồ cờ úp có tính điểm chặt hơn cờ tướng và không cộng giây mỗi nước, nên người còn mải lật quân trong một thế cờ căng thường thua luôn cả về thời gian.',
  'Play Jieqi': 'Chơi cờ úp',
  'Jieqi on Mistboard': 'Cờ úp trên Mistboard',
  '/blog/jieqi-platform': '/blog/co-up',

  // Sources
  Sources: 'Nguồn',
  'Three Chinese-language posts. Titles are given in English, with the original after, so you can search for them.':
    'Ba bài viết tiếng Trung. Tiêu đề được dịch sang tiếng Việt, kèm nguyên văn phía sau để bạn tự tìm.',
  '[Notes on Jieqi, Part 1](https://zhuanlan.zhihu.com/p/347466882) (揭棋心得 Part.1). The closest thing to a jieqi book that exists, and it is one chapter. Source for the piece values, the chariot, and what spending an option costs.':
    '[Ghi chép về cờ úp, phần 1](https://zhuanlan.zhihu.com/p/347466882) (揭棋心得 Part.1). Thứ gần với một cuốn sách cờ úp nhất hiện có, và nó chỉ dài một chương. Nguồn cho phần giá trị quân, phần con xe, và phần cái giá của việc tiêu một quyền chọn.',
  '[What do you make of Tiantian Xiangqi’s jieqi mode?](https://www.zhihu.com/question/53501615) (如何看待天天象棋推出的“揭棋”玩法？). The largest jieqi discussion anywhere. Source for the ranking, the reveal-by-reveal case, and the chariot plan.':
    '[Bạn nghĩ sao về chế độ cờ úp của Tiantian Xiangqi?](https://www.zhihu.com/question/53501615) (如何看待天天象棋推出的“揭棋”玩法？). Cuộc thảo luận về cờ úp lớn nhất từng có. Nguồn cho phần xếp hạng, phần phân tích từng khả năng lật, và phần kế hoạch với con xe.',
  '[A notation for jieqi and banqi](https://zhuanlan.zhihu.com/p/638758588) (《天天象棋》揭棋和翻翻棋的记谱法). Proposes a way to record these games, which does not otherwise exist. Background only.':
    '[Một cách ghi biên bản cho cờ úp và cờ lật](https://zhuanlan.zhihu.com/p/638758588) (《天天象棋》揭棋和翻翻棋的记谱法). Đề xuất một cách ghi lại các ván cờ này, thứ vốn chưa tồn tại. Chỉ mang tính tham khảo.',
  'There is no jieqi opening database and no published statistics. The fifty games cited above are our own, they are mostly humans losing to Pikafish, and they are nowhere near enough to settle whether the pawn push really outperforms the crossed cannon. They are enough to say what people here actually play.':
    'Không có cơ sở dữ liệu khai cuộc cờ úp và không có thống kê nào được công bố. Năm mươi ván dẫn ở trên là của chính chúng tôi, phần lớn là người chơi thua Pikafish, và chúng còn xa mới đủ để kết luận tiến tốt có thực sự hơn pháo qua sông hay không. Chúng chỉ đủ để nói người chơi ở đây thật sự đi những nước gì.',

  // Diagram labels (inside the SVG; the rules page luat-co-up uses the same terms)
  'SHUFFLED START': 'THẾ BAN ĐẦU ĐÃ XÁO',
  'FACE-DOWN ON A CANNON POINT': 'QUÂN ÚP Ở VỊ TRÍ PHÁO',
  'SPENT: A SOLDIER TOOK THE HORSE': 'ĐÃ TIÊU: MỘT CON TỐT ĂN MÃ',
  'FOUR OPENINGS, ONE MOVE EACH': 'BỐN KHAI CUỘC, MỖI CÁI MỘT NƯỚC',
  'BOTH CANNONS TAKE BOTH HORSES': 'HAI PHÁO ĂN HAI MÃ',
};

export const khaiCuocCoUpArticle = deriveTranslation(jieqiOpeningsArticle, {
  slug: 'khai-cuoc-co-up',
  sourceLang: 'vi',
  dict: KHAI_CUOC_CO_UP_VI,
});
