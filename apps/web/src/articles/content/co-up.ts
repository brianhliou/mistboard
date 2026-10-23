// Vietnamese translation of the jieqi platform page, at its own slug.
//
// NOT a second article. jieqi-platform is the single structural source; this file
// is only the dictionary that turns its strings Vietnamese. Add a section to the
// English page and it appears here automatically, in English, until a line is
// added below. Written as a hand-authored copy first, which drifted from the
// English within hours; see derived-translation.ts for why that model was dropped.
//
// The URL keeps a Vietnamese slug rather than a /vi/ prefix. The prefix belongs to
// interface locales (one `Locale` list drives both the URL and the nav), and the
// language policy closes that set at en/zh-Hans/zh-Hant. 'co-up' is also the term
// people actually search, which an English slug under a prefix would bury.
//
// Includes one non-prose entry: the rules CTA points at the Vietnamese rules page,
// because sending a Vietnamese reader to English rules is the leak this exists to
// close.
//
// This copy has NOT had a native read. It ships anyway, on the standard set on
// 2026-08-29: a translation does not wait for a read that is not coming. The page
// now inherits its status from jieqi-platform, so the pair publishes together.

import { deriveTranslation } from '../derived-translation.js';
import { jieqiPlatformArticle } from './jieqi-platform.js';

export const CO_UP_VI: Record<string, string> = {
  "Sign in to request full-game analysis, then try different moves from your own game.": "Đăng nhập để yêu cầu phân tích cả ván, rồi thử những nước khác từ chính ván của bạn.",
  "Open [the full review](/jieqi/game/jq_96f40ebb-1347-4c31-babe-d777c4a88ddf) to play through alternative moves. New to jieqi? Read the [rules](/rules/jieqi), or explore [how strong players approach the opening](/blog/jieqi-openings).": "Mở [trang xem lại đầy đủ](/jieqi/game/jq_96f40ebb-1347-4c31-babe-d777c4a88ddf) để thử các nước thay thế. Mới chơi cờ úp? Đọc [luật](/blog/luat-co-up), hoặc tìm hiểu [cách người chơi giỏi tiếp cận khai cuộc](/blog/khai-cuoc-co-up).",
  "This brings Lichess-style engine review to a game with hidden pieces and luck. We adapt [Lichess’s accuracy and move-grading methods](https://lichess.org/page/accuracy) to jieqi, measuring the quality of your decisions separately from what each reveal gave you.": "Đưa cách xem lại bằng engine kiểu Lichess vào một trò chơi có quân úp và may rủi. Chúng tôi điều chỉnh [phương pháp tính độ chính xác và chấm nước đi của Lichess](https://lichess.org/page/accuracy) cho cờ úp, tách chất lượng quyết định khỏi kết quả mỗi lần lật.",
  "Move-quality marks grade the choice, independently of the reveal.": "Ký hiệu chất lượng chấm lựa chọn, độc lập với kết quả lật quân.",
  "No warning": "Không cảnh báo",
  "Inaccuracy": "Thiếu chính xác",
  "Mistake": "Sai lầm",
  "Blunder": "Sai lầm nghiêm trọng",
  "Violet dice mean an unlucky reveal, grey means close to the expected outcome, and teal means lucky. More pips and a deeper colour mean a bigger swing.": "Xúc xắc tím chỉ lần lật không may, xám là gần kết quả kỳ vọng, xanh ngọc là may mắn. Nhiều chấm hơn và màu đậm hơn nghĩa là biến động lớn hơn.",
  "Illustrative examples. The same revealed piece can be lucky or unlucky depending on the position.": "Ví dụ minh họa. Cùng một quân lật ra có thể may hoặc rủi tùy theo thế cờ.",
  "Very unlucky": "Rất không may",
  "Unlucky": "Không may",
  "About average": "Gần trung bình",
  "Lucky": "May mắn",
  "Very lucky": "Rất may",
  "Try a different line from your game": "Thử một biến khác từ ván của bạn",
  "Return to a position in your review and play a different move on the board. Your variation appears alongside the original game. Switch on the browser engine to compare continuations from that position, with no server queue. You are exploring the game you just played, with its actual reveals.": "Trở lại một thế cờ trong phần xem lại và đi một nước khác trên bàn. Biến mới hiện bên cạnh ván gốc. Bật engine trong trình duyệt để so sánh cách đi tiếp từ thế đó, không phải chờ máy chủ. Bạn đang khám phá chính ván vừa chơi, với các quân đã thực sự được lật.",
  "Try an alternative from your own game and compare it with the original continuation.": "Thử một biến khác từ chính ván của bạn và so sánh với cách đi ban đầu.",
  "A variation from the finished Jieqi game, with the browser engine enabled in its review.": "Một biến từ ván cờ úp đã kết thúc, với engine trong trình duyệt được bật ngay trong phần xem lại.",
  "Pikafish has eight levels. The seven easier levels limit its search and let it choose weaker moves; Level 8 uses the full search budget. We measure the steps by playing the bots against one another and against a random-move baseline. [How we built the ladder](/blog/jieqi-bot-wins) explains the levels.": "Pikafish có tám cấp. Bảy cấp dễ hơn giới hạn tìm kiếm và cho phép chọn các nước yếu hơn; cấp 8 dùng toàn bộ ngân sách tìm kiếm. Chúng tôi đo các cấp bằng cách cho bot đấu với nhau và với một đối thủ đi ngẫu nhiên. [Cách xây dựng thang cấp](/blog/jieqi-bot-wins) giải thích từng cấp.",
  "[AB-JChess](/bot/ab-jchess) earned its place above Pikafish by winning their 400-game match, 248 to 136. [Read about that champion](/blog/ab-jchess), or see the [current bots and ratings](/bots) for the latest challengers. Every bot plays from the information its side is allowed to see; it is never given the hidden deal.": "[AB-JChess](/bot/ab-jchess) giành vị trí trên Pikafish khi thắng 248 so với 136 trong trận 400 ván. [Đọc về nhà vô địch đó](/blog/ab-jchess), hoặc xem [các bot và mức xếp hạng hiện tại](/bots) để biết những đối thủ mới. Mỗi bot chỉ nhận thông tin mà bên mình được phép biết, không bao giờ được biết toàn bộ cách chia quân úp.",
  "Explore your own games": "Khám phá ván của bạn",
  "Browser engine, no queue": "Engine trình duyệt, không chờ",
  "Play Level 1 or invite a friend, with no account needed for casual games.": "Bắt đầu ở cấp 1 hoặc mời bạn bè; chơi giao hữu không cần tài khoản.",
  "Full-game analysis grades your moves and measures reveal luck separately.": "Phân tích cả ván chấm điểm nước đi và đánh giá riêng phần may rủi khi lật quân.",
  "Play jieqi against a computer or a friend, then review the game to see where your decisions helped and where the flips went your way.": "Chơi cờ úp với máy hoặc bạn bè, rồi xem lại ván đấu để biết lựa chọn nào có ích và lần lật nào mang lại may mắn.",
  "Start with Level 1 and choose your pace in setup. To play a friend, create a room, click **Copy invite**, and send them the link. Casual games need no account.": "Bắt đầu ở cấp 1 và chọn thời gian trong phần thiết lập. Để chơi với bạn bè, tạo phòng, bấm **Copy invite**, rồi gửi đường dẫn cho họ. Chơi giao hữu không cần tài khoản.",
  "Step through a real game. Plain discs are still face-down; a piece reveals its identity the first time it moves.": "Xem từng nước của một ván thật. Những đĩa trơn là quân còn úp; quân cờ lộ thân phận ngay lần đầu di chuyển.",
  "Jieqi: a guest beats Pikafish in 73 moves": "Cờ úp: khách thắng Pikafish sau 73 nước",
  "1. Finish a game and open Review game": "1. Chơi xong một ván và mở Review game",
  "When a game ends, click **Review game** below the move list. You can step through the whole game, revisit a position, and try a different continuation.": "Khi ván đấu kết thúc, bấm **Review game** bên dưới biên bản. Bạn có thể xem lại từng nước, trở về một thế cờ và thử cách đi tiếp khác.",
  "The game above has ended. Review game opens its replay and analysis page.": "Ván ở trên đã kết thúc. Review game mở trang xem lại và phân tích.",
  "The finished Jieqi game with the Review game button below the result.": "Ván cờ úp đã kết thúc, với nút Review game bên dưới kết quả.",
  "2. Request computer analysis": "2. Yêu cầu phân tích bằng máy",
  "Open the **Computer analysis** tab, then click **Request computer analysis**. Sign in to request a new analysis; anyone can read one that is already available. It may take a few minutes to finish.": "Mở thẻ **Computer analysis**, rồi bấm **Request computer analysis**. Cần đăng nhập để yêu cầu phân tích mới; ai cũng có thể đọc bản phân tích đã có. Quá trình này có thể mất vài phút.",
  "Request analysis once to get a graph, accuracy scores, and move annotations.": "Yêu cầu phân tích một lần để có biểu đồ, độ chính xác và chú giải nước đi.",
  "The Jieqi review page with its Computer analysis tab and Request computer analysis button.": "Trang xem lại cờ úp với thẻ Computer analysis và nút Request computer analysis.",
  "3. Find the moves to learn from": "3. Tìm những nước đáng học",
  "The graph shows how the game changed. Each player gets an accuracy score, and inaccuracies, mistakes, and blunders are marked in the move list. Select a marked move to see the better move the engine recommends.": "Biểu đồ cho thấy thế trận thay đổi ra sao. Mỗi bên có một điểm chính xác; biên bản đánh dấu các nước thiếu chính xác, sai lầm và sai lầm nghiêm trọng. Chọn một nước được đánh dấu để xem nước tốt hơn mà engine đề xuất.",
  "One game, graded move by move. Click the graph or move list to revisit a turning point.": "Một ván đấu, chấm từng nước. Bấm biểu đồ hoặc biên bản để xem lại bước ngoặt.",
  "The analysed Jieqi game, showing the advantage graph, player accuracy, and marked moves.": "Ván cờ úp đã được phân tích, với biểu đồ lợi thế, độ chính xác và các nước được đánh dấu.",
  "Good decisions and lucky flips are different": "Lựa chọn tốt và lật may là hai việc khác nhau",
  "A move can be a good choice and still reveal an unlucky piece. The move-quality glyph grades your choice before the reveal. The die badge shows how much better or worse the revealed piece was than the pieces you could have drawn.": "Bạn có thể chọn đúng mà vẫn lật phải quân không may. Ký hiệu chất lượng chấm lựa chọn trước lúc lật; biểu tượng xúc xắc cho biết quân lật được tốt hơn hay kém hơn so với các quân có thể lật ra bao nhiêu.",
  "The glyph judges the decision; the die describes the reveal. Both appear by the piece and in the move list.": "Ký hiệu chấm quyết định; xúc xắc mô tả lần lật. Cả hai hiện cạnh quân cờ và trong biên bản.",
  "A Jieqi position with a move-quality glyph and a reveal-luck die badge beside the moved piece, plus advice for a better move.": "Thế cờ úp với ký hiệu chất lượng và xúc xắc may rủi cạnh quân vừa đi, cùng gợi ý nước tốt hơn.",
  "When a different move was significantly better, the review shows that best move as advice. You can turn on alternatives to explore more candidates. Your accuracy measures the choices alone, so a lucky flip cannot flatter it and an unlucky one cannot spoil it.": "Khi có một nước khác tốt hơn rõ rệt, phần xem lại đưa ra nước tốt nhất làm gợi ý. Bạn có thể bật các phương án để khám phá thêm. Độ chính xác chỉ đo lựa chọn, nên lật may không làm nó đẹp lên và lật rủi không làm nó xấu đi.",
  "The same decision and luck marks on a phone.": "Các ký hiệu quyết định và may rủi tương tự trên điện thoại.",
  "The same Jieqi review on a phone, with move-quality and reveal-luck annotations.": "Cùng ván cờ úp được xem lại trên điện thoại, có chú giải chất lượng nước đi và may rủi khi lật.",
  "Sign in to request; available to all to read": "Đăng nhập để yêu cầu; ai cũng có thể đọc",
  "Xiangqi with every piece except the general face-down. A piece moves as whatever normally starts on its square, then turns over and keeps that identity. It is also known as cờ úp in Vietnamese.": "Cờ tướng với mọi quân trừ tướng đều úp xuống. Quân úp đi theo vị trí xuất phát rồi lật lên và giữ thân phận đó. Tên tiếng Việt là cờ úp.",
  "Yes. Mistboard offers a range of bot strengths, from beginner levels to strong engines. Start with Level 1, then choose a harder opponent as you improve.": "Có. Mistboard cung cấp nhiều mức sức mạnh, từ cấp nhập môn đến engine mạnh. Bắt đầu ở cấp 1 rồi chọn đối thủ khó hơn khi tiến bộ.",
  "No. It receives only the information its side is allowed to see. It is never told the hidden deal.": "Không. Nó chỉ nhận thông tin mà bên mình được phép biết, không bao giờ được biết toàn bộ cách chia quân úp.",
  "Here, against the engine or a friend. Casual games need no account and nothing to install. You can replay finished games freely; sign in to request full-game engine analysis.": "Ngay tại đây, với máy hoặc bạn bè. Chơi giao hữu không cần tài khoản và không phải cài đặt. Bạn được xem lại các ván đã kết thúc; đăng nhập để yêu cầu phân tích cả ván bằng engine.",
  "HIDDEN PIECES, OPEN BOARD": "QUÂN ÚP, BÀN CỜ MỞ",
  "Jieqi on Mistboard": "Cờ úp trên Mistboard",
  "Play Jieqi Online, with Engine Analysis": "Chơi cờ úp online, có phân tích bằng engine",
  "Play jieqi against the engine or a friend, free and without an account, then review the game with analysis that separates your choices from your luck.": "Chơi cờ úp với máy hoặc với bạn bè, miễn phí và không cần tài khoản, rồi xem lại ván đấu với phân tích tách riêng phần bạn chọn khỏi phần bạn lật trúng.",
  "Jieqi players looking for somewhere to play and review their games.": "Người chơi cờ úp đang tìm chỗ để chơi và để xem lại ván đấu của mình.",
  "Play the engine": "Chơi với máy",
  "Play a friend": "Mời bạn bè",
  "Review your games": "Xem lại ván đấu",
  "The engine": "Về engine",
  "What you get": "Bạn nhận được gì",
  "Common questions": "Câu hỏi thường gặp",
  "What is jieqi?": "Cờ úp là gì?",
  "How is jieqi different from xiangqi?": "Cờ úp khác cờ tướng ở chỗ nào?",
  "Same board, same pieces, same moves, same goal. You just do not know which piece is which, so about half your moves flip one over and find out.": "Cùng bàn cờ, cùng quân cờ, cùng nước đi, cùng mục tiêu. Chỉ khác là bạn không biết quân nào là quân gì, nên khoảng một nửa số nước của bạn là lật một quân lên để biết.",
  "Is jieqi just luck?": "Cờ úp có phải chỉ ăn may không?",
  "The flips are random; what you do with them is not. Your accuracy score is built only from your choices, so a good draw cannot flatter it and a bad one cannot spoil it.": "Lật quân là may rủi, nhưng bạn làm gì với nó thì không. Chỉ số chính xác của bạn chỉ dựng từ các lựa chọn, nên lật trúng quân tốt không làm nó đẹp lên và lật phải quân xấu cũng không làm nó xấu đi.",
  "Can a computer play jieqi well?": "Máy chơi cờ úp có hay không?",
  "Can the engine see my hidden pieces?": "Engine có nhìn thấy quân úp của tôi không?",
  "Is the shuffle fair?": "Xáo quân có công bằng không?",
  "The deal is random, made on the server, and told to nobody: not you, not your opponent, not the engine.": "Lần xáo là ngẫu nhiên, thực hiện trên máy chủ, và không nói cho ai: không cho bạn, không cho đối thủ, không cho engine.",
  "Where can I play jieqi online for free?": "Chơi cờ úp online miễn phí ở đâu?",
  "Start playing": "Bắt đầu chơi",
  "Read the rules": "Xem luật cờ úp",
  "/rules/jieqi": "/blog/luat-co-up",
  "XIANGQI": "CỜ TƯỚNG",
  "JIEQI": "CỜ ÚP",
  "On Mistboard": "Trên Mistboard",
  "Play the engine or a friend": "Chơi với máy hoặc bạn bè",
  "Free, no account": "Miễn phí, không cần tài khoản",
  "Full-game analysis": "Phân tích cả ván",
  "Luck measured separately": "Đo may rủi riêng",
  "Every flip priced": "Đánh giá từng lần lật",
  "Studies with your own deals": "Nghiên cứu với cách chia quân của bạn",
  "Yes": "Có",
  "Open-source engine": "Engine mã nguồn mở",
  "Rated ladder": "Bảng xếp hạng tính điểm",
  "Open, signed in": "Đang mở, cần đăng nhập",
  "Engine in your browser": "Engine trong trình duyệt",
  "No queue, no account": "Không chờ, không cần tài khoản",
};

export const coUpArticle = deriveTranslation(jieqiPlatformArticle, {
  slug: 'co-up',
  sourceLang: 'vi',
  dict: CO_UP_VI,
});
