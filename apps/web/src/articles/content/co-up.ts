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
  "Jieqi on Mistboard": "Cờ úp trên Mistboard",
  "Play Jieqi Online, with Engine Analysis": "Chơi cờ úp online, có phân tích bằng engine",
  "Play jieqi against the engine or a friend, free and without an account, then review the game with analysis that separates your choices from your luck.": "Chơi cờ úp với máy hoặc với bạn bè, miễn phí và không cần tài khoản, rồi xem lại ván đấu với phân tích tách riêng phần bạn chọn khỏi phần bạn lật trúng.",
  "Jieqi players looking for somewhere to play and review their games.": "Người chơi cờ úp đang tìm chỗ để chơi và để xem lại ván đấu của mình.",
  "Jieqi is [xiangqi](/rules/xiangqi) with every piece face-down. A piece moves as whatever normally starts on its square, then flips and keeps that identity for the rest of the game. You begin without knowing what anything is, including your own pieces. The [rules page](/rules/jieqi) has the details.": "Cờ úp là [cờ tướng](/rules/xiangqi) với mọi quân đều úp xuống. Một quân đi theo vị trí xuất phát nó đang đứng, rồi lật lên và giữ đúng thân phận đó đến hết ván. Bạn vào ván mà không biết quân nào là quân gì, kể cả quân của mình. [Trang luật](/blog/luat-co-up) nói chi tiết.",
  "It is a young game, out of Hong Kong and Guangdong, and it has spread over the last couple of decades mostly among Chinese and Vietnamese players. For what to actually open with, see [what strong players believe about the opening](/blog/jieqi-openings).": "Đây là môn cờ còn trẻ, khởi đi từ Hồng Kông và Quảng Đông, lan rộng trong vài chục năm gần đây chủ yếu trong cộng đồng người Hoa và người Việt. Tiếng Trung gọi là 揭棋. Còn nên khai cuộc thế nào, xem [người chơi giỏi tin gì về khai cuộc](/blog/khai-cuoc-co-up).",
  "Play the engine": "Chơi với máy",
  "Play a friend": "Mời bạn bè",
  "Mistboard · 5+5 casual": "Mistboard · 5+5 casual",
  "Black wins by checkmate · 73 moves": "Đen thắng bằng chiếu bí · 73 nước",
  "Black delivers checkmate on move 73.": "Đen chiếu bí ở nước 73.",
  "Plain discs are still face-down. Each one turns over the first time it moves and is stuck with whatever it turns out to be.": "Những đĩa trơn là quân còn úp. Mỗi quân lật lên ngay lần đầu nó di chuyển, và từ đó mang đúng thân phận vừa lộ.",
  "That is [a real game on this site](/jieqi/game/jq_96f40ebb-1347-4c31-babe-d777c4a88ddf), not a demo, and every screenshot below comes from it.": "Đó là [một ván thật trên trang này](/jieqi/game/jq_96f40ebb-1347-4c31-babe-d777c4a88ddf), không phải ván dựng, và mọi ảnh bên dưới đều lấy từ ván đó.",
  "Play the engine at 1+1, 3+2 or 5+5, or send a friend a link. Free, no sign-up, nothing to install.": "Chơi với máy ở 1+1, 3+2 hoặc 5+5, hoặc gửi bạn bè một đường dẫn. Miễn phí, không cần đăng ký, không phải cài gì.",
  "Review your games": "Xem lại ván đấu",
  "Ask for analysis on a finished game and the review separates what you chose from what you drew, which is the part a chess site has no reason to do. You also get the usual: a graph of the whole game, an accuracy score for each player, and every inaccuracy, mistake and blunder marked with the move that was better. It runs on our servers and takes a few minutes.": "Bấm phân tích một ván đã kết thúc, phần xem lại sẽ tách riêng cái bạn chọn với cái bạn lật trúng, đây là phần mà một trang cờ vua không có lý do gì phải làm. Bạn cũng nhận được những thứ quen thuộc: biểu đồ cả ván, chỉ số chính xác của từng bên, và mỗi nước thiếu chính xác, sai lầm hay sai lầm nghiêm trọng đều kèm nước đi tốt hơn. Phân tích chạy trên máy chủ của chúng tôi và mất vài phút.",
  "The game above, graded.": "Vẫn ván ở trên, đã chấm điểm.",
  "It tells you how lucky each flip was": "Nó cho bạn biết mỗi lần lật may tới đâu",
  "Half your moves turn a piece over, and you never know what you are turning over. So the engine works out what each piece that tile could have been would have been worth, and compares it to what you actually got. The gap is your luck on that flip.": "Một nửa số nước của bạn là lật quân, mà lật thì bạn không biết mình đang lật ra cái gì. Nên engine tính xem từng quân mà ô đó có thể là sẽ đáng giá bao nhiêu, rồi so với cái bạn thật sự lật được. Khoảng cách đó chính là phần may rủi của nước lật ấy.",
  "Move 19 played the 39% move when 52% was there, so it is marked. Move 21 played the best one and still got a +43% gift from the flip.": "Nước 19 đi nước 39% trong khi có nước 52%, nên bị đánh dấu. Nước 21 đi đúng nước tốt nhất mà vẫn được lật cho +43%.",
  "The percentage on each move is what it was worth before you flipped, averaged over every piece that tile could have been. The dice is what the flip actually gave you on top of that. So a move can be the best choice available and still come with a large plus or minus beside it: the first number is your decision, the second is the draw.": "Tỉ lệ phần trăm bên cạnh mỗi nước là giá trị của nước đó trước khi bạn lật, lấy trung bình trên mọi quân mà ô đó có thể là. Con xúc xắc là phần mà cú lật thật sự cho bạn thêm vào đó. Vì vậy một nước có thể vừa là lựa chọn tốt nhất vừa kèm một dấu cộng hay dấu trừ rất lớn: số thứ nhất là quyết định của bạn, số thứ hai là phần bốc thăm.",
  "When your move is the top one, you chose well. Moves are only marked as mistakes when a better one was on the list.": "Khi nước bạn đi đứng đầu danh sách, tức là bạn đã chọn đúng. Nước chỉ bị đánh dấu là sai lầm khi trong danh sách có nước tốt hơn.",
  "Your accuracy is then built from the choices alone, so a lucky flip cannot flatter it and an unlucky one cannot spoil it.": "Chỉ số chính xác sau đó chỉ được dựng từ các lựa chọn, nên lật trúng quân tốt không làm nó đẹp lên và lật phải quân xấu cũng không làm nó xấu đi.",
  "And it runs in your browser": "Và nó chạy ngay trong trình duyệt",
  "The analysis board runs the same engine on your own machine, drawing its best moves on the board as you try a line. Nothing is queued, nothing is sent anywhere, and it needs no account. [The engine is open source](https://github.com/brianhliou/pikafish-jieqi-wasm), so if a number here looks wrong you can go and read the code that produced it.": "Bàn phân tích chạy đúng engine đó ngay trên máy bạn, vẽ sẵn các nước hay nhất lên bàn cờ khi bạn thử một biến. Không phải xếp hàng chờ, không gửi gì đi đâu, và không cần tài khoản. [Engine là mã nguồn mở](https://github.com/brianhliou/pikafish-jieqi-wasm), nên nếu bạn thấy một con số ở đây có vẻ sai, bạn đọc được đúng đoạn mã đã tạo ra nó.",
  "Running in a browser tab.": "Chạy trong một tab trình duyệt.",
  "Open the analysis board": "Mở bàn phân tích",
  "The engine": "Về engine",
  "PikaJieQi is a fork of [Pikafish](https://github.com/official-pikafish/Pikafish), the open-source xiangqi engine, on its jieqi branch. Classical alpha-beta search with a hand-written evaluation and no neural network. What makes it a jieqi engine rather than a xiangqi one is that it treats every face-down piece as a chance node, scoring a move as the average over each piece that tile could still be. It only ever sees the face-down board, and a test fails the build if a hidden identity ever leaks into what it is sent.": "PikaJieQi là bản fork của [Pikafish](https://github.com/official-pikafish/Pikafish), engine cờ tướng mã nguồn mở, trên nhánh dành cho cờ úp. Tìm kiếm alpha-beta cổ điển với hàm đánh giá viết tay, không có mạng nơ-ron. Điều làm nó thành engine cờ úp chứ không phải engine cờ tướng là nó coi mỗi quân úp như một nút may rủi, chấm điểm một nước bằng trung bình trên từng quân mà ô đó còn có thể là. Nó chỉ nhìn thấy bàn cờ đã úp, và có một bài kiểm thử làm hỏng bản dựng nếu một thân phận bị lộ ra trong dữ liệu gửi cho nó.",
  "It is beatable, and the game at the top of this page is one it lost. You can watch it play itself in [these engine games](/study/wd6c7qvG). Almost all of modern Pikafish's strength lives in its neural network and jieqi has no good one: we trained a net and it never came out stronger than the hand-written evaluation, so this is an open problem rather than a chore nobody got round to. If you train nets, or know jieqi well enough to say where its judgement goes wrong, that is the help we would most like; the terms of the open challenge, and the prebuilt engine to beat, are at [brianhliou.com/challenges](https://brianhliou.com/challenges/).": "Nó đánh được nhưng không phải bất bại, và ván ở đầu trang này là một ván nó thua. Bạn xem nó tự đánh với chính mình trong [các ván engine này](/study/wd6c7qvG). Gần như toàn bộ sức mạnh của Pikafish hiện đại nằm ở mạng nơ-ron của nó, mà cờ úp thì chưa có mạng nào tốt: chúng tôi đã huấn luyện một mạng và nó chưa bao giờ mạnh hơn hàm đánh giá viết tay, nên đây là bài toán còn mở chứ không phải việc chưa ai bắt tay vào. Nếu bạn huấn luyện được mạng nơ-ron, hoặc rành cờ úp đủ để chỉ ra engine đánh giá sai ở đâu, đó là đóng góp chúng tôi mong nhất; điều kiện của thử thách mở và engine dựng sẵn để bạn đánh bại có tại [brianhliou.com/challenges](https://brianhliou.com/challenges/).",
  "What you get": "Bạn nhận được gì",
  "Common questions": "Câu hỏi thường gặp",
  "What is jieqi?": "Cờ úp là gì?",
  "Xiangqi with every piece except the general face-down. A piece moves as whatever normally starts on its square, then turns over and keeps that identity. It is called cờ úp in Vietnamese and 揭棋 in Chinese.": "Là cờ tướng với mọi quân trừ tướng đều úp xuống. Một quân đi theo vị trí xuất phát nó đang đứng, rồi lật lên và giữ đúng thân phận đó. Tiếng Trung gọi là 揭棋.",
  "How is jieqi different from xiangqi?": "Cờ úp khác cờ tướng ở chỗ nào?",
  "Same board, same pieces, same moves, same goal. You just do not know which piece is which, so about half your moves flip one over and find out.": "Cùng bàn cờ, cùng quân cờ, cùng nước đi, cùng mục tiêu. Chỉ khác là bạn không biết quân nào là quân gì, nên khoảng một nửa số nước của bạn là lật một quân lên để biết.",
  "Is jieqi just luck?": "Cờ úp có phải chỉ ăn may không?",
  "The flips are random; what you do with them is not. Your accuracy score is built only from your choices, so a good draw cannot flatter it and a bad one cannot spoil it.": "Lật quân là may rủi, nhưng bạn làm gì với nó thì không. Chỉ số chính xác của bạn chỉ dựng từ các lựa chọn, nên lật trúng quân tốt không làm nó đẹp lên và lật phải quân xấu cũng không làm nó xấu đi.",
  "Can a computer play jieqi well?": "Máy chơi cờ úp có hay không?",
  "Reasonably, not brilliantly. Ours is beatable by a strong human, mainly because jieqi has no good neural network yet: we trained one and it never came out stronger than the hand-written evaluation.": "Khá, chưa xuất sắc. Engine của chúng tôi vẫn bị người chơi mạnh đánh bại, chủ yếu vì chưa có mạng nơ-ron nào được huấn luyện cho cờ úp.",
  "Can the engine see my hidden pieces?": "Engine có nhìn thấy quân úp của tôi không?",
  "No. It gets the same face-down board you do and is never told the deal. A test fails the build if an identity ever leaks into what it is sent.": "Không. Nó nhận đúng bàn cờ đã úp như bạn đang thấy và không bao giờ được cho biết lần xáo quân. Có một bài kiểm thử làm hỏng bản dựng nếu một thân phận lọt vào dữ liệu gửi cho nó.",
  "Is the shuffle fair?": "Xáo quân có công bằng không?",
  "The deal is random, made on the server, and told to nobody: not you, not your opponent, not the engine.": "Lần xáo là ngẫu nhiên, thực hiện trên máy chủ, và không nói cho ai: không cho bạn, không cho đối thủ, không cho engine.",
  "Where can I play jieqi online for free?": "Chơi cờ úp online miễn phí ở đâu?",
  "Here, against the engine or a friend. No account, nothing to install, and you can review the game with engine analysis afterwards.": "Ngay tại đây, với máy hoặc với bạn bè. Không cần tài khoản, không phải cài gì, và xem lại ván đấu bằng phân tích engine sau khi chơi xong.",
  "Start playing": "Bắt đầu chơi",
  "Read the rules": "Xem luật cờ úp",
  "/rules/jieqi": "/blog/luat-co-up",
};

export const coUpArticle = deriveTranslation(jieqiPlatformArticle, {
  slug: 'co-up',
  sourceLang: 'vi',
  dict: CO_UP_VI,
});
