// Vietnamese translation of the Pikafish page, at its own slug.
//
// NOT a second article: pikafish is the single structural source and this file
// is only the dictionary that turns its strings Vietnamese (derived-translation.ts;
// co-up.ts is the same arrangement over jieqi-platform). Add a section to the
// English page and it appears here in English until a line is added below.
//
// The slug and the title are the search, not the engine's name: "chơi cờ tướng
// với máy" (play xiangqi against the computer) is the head of the Vietnamese
// vs-computer tree in the 2026-09-20 demand read, 100K-1M searches a month on
// "cờ tướng online", PlayOK and app stores on top. The Pikafish page is already
// that page (one click into the strongest engine, an eight-level ladder below
// it), so the Vietnamese copy leads with the search and keeps Pikafish as the
// subject. Vietnamese is a content language, so the slug carries no /vi/ prefix
// (language_policy_settled; the URL is permanent).
//
// Two non-prose entries point jieqi links at the Vietnamese pages, because
// sending a Vietnamese reader to English rules is the leak this exists to close.
//
// This copy has NOT had a native read. It ships on the standard set 2026-08-29:
// a translation does not wait for a read that is not coming. It inherits its
// status from pikafish, so the pair publishes together.

import { deriveTranslation } from '../derived-translation.js';
import { pikafishArticle } from './pikafish.js';

export const CHOI_CO_TUONG_VOI_MAY_VI: Record<string, string> = {
  'Pikafish on Mistboard': 'Chơi cờ tướng với máy: Pikafish trên Mistboard',
  'Play Pikafish Online: Free Xiangqi Engine, No Download':
    'Chơi cờ tướng với máy online miễn phí: Pikafish, không cần tải về',
  'Play Pikafish, the strongest open-source xiangqi engine, in your browser. Free, no account, no download. Choose a level, play it at jieqi, and review your games with it.':
    'Chơi cờ tướng với máy ngay trên trình duyệt, đối thủ là Pikafish, engine cờ tướng mã nguồn mở mạnh nhất. Miễn phí, không cần tài khoản, không cần tải về. Chọn cấp độ, chơi cờ úp, và xem lại ván đấu bằng engine.',
  'Xiangqi players looking for somewhere to play or analyze with Pikafish.':
    'Người chơi cờ tướng muốn chơi với máy hoặc phân tích ván cờ bằng Pikafish.',
  '[Pikafish](https://github.com/official-pikafish/Pikafish) is the strongest open-source xiangqi engine, built from Stockfish for the Chinese board. Most people run it from a download and a separate interface. Here it runs in the page.':
    '[Pikafish](https://github.com/official-pikafish/Pikafish) là engine cờ tướng mã nguồn mở mạnh nhất, được phát triển từ Stockfish cho bàn cờ tướng. Phần lớn mọi người phải tải về và cài thêm một giao diện riêng để dùng. Ở đây nó chạy ngay trên trang.',
  'Play it as it comes or start lower on an eight-level ladder, play it at jieqi, or hand it a finished game to review. Free, no sign-up, nothing to install, and it works on a phone.':
    'Chơi với nó ở sức mạnh tối đa hoặc bắt đầu từ các cấp thấp hơn trong tám cấp độ, chơi cờ úp với nó, hoặc đưa cho nó một ván đã xong để phân tích. Miễn phí, không cần đăng ký, không phải cài gì, và chơi được trên điện thoại.',
  'Play Pikafish': 'Chơi với Pikafish',
  'Play Pikafish at jieqi': 'Chơi cờ úp với Pikafish',
  'Play against Pikafish': 'Chơi với Pikafish',
  'One click starts a game. You get a colour, a clock, and Pikafish on the other side, searching three million positions a move. No account needed.':
    'Một cú nhấp là bắt đầu ván. Bạn được chia một bên, một đồng hồ, và Pikafish ngồi phía bên kia, tính ba triệu thế cờ cho mỗi nước. Không cần tài khoản.',
  'Three million positions a move is a lot. Below Pikafish sits an eight-level ladder of Fairy-Stockfish bots, level 1 for someone who learned the moves this week, level 8 close to the top. Every level has a measured rating from playing the others, anchored at 1500 to an engine that picks random legal moves.':
    'Ba triệu thế cờ mỗi nước là rất mạnh. Bên dưới Pikafish có tám cấp độ máy Fairy-Stockfish: cấp 1 dành cho người mới học cách đi quân tuần này, cấp 8 gần với đỉnh. Mỗi cấp có một chỉ số sức mạnh đo được qua các ván đấu với nhau, lấy mốc 1500 là một engine chỉ đi nước hợp lệ ngẫu nhiên.',
  'Measured September 2026 from engine-versus-engine games on the site. Pikafish at three million positions a move.':
    'Đo vào tháng 9 năm 2026 qua các ván máy đấu máy trên trang. Pikafish tính ba triệu thế cờ mỗi nước.',
  'Pick one from the [play menu](/?play=computer&gameSpecId=xiangqi), win a few games there, and move up.':
    'Chọn một cấp trong [menu chơi](/?play=computer&gameSpecId=xiangqi), thắng vài ván ở đó, rồi lên cấp tiếp theo.',
  // The ladder table: its cells sit outside the readable fields the coverage
  // check walks, so they are listed by hand.
  Opponent: 'Đối thủ',
  'Rating on the ladder': 'Chỉ số sức mạnh',
  'Fairy-Stockfish level 1': 'Fairy-Stockfish cấp 1',
  'Fairy-Stockfish level 4': 'Fairy-Stockfish cấp 4',
  'Fairy-Stockfish level 8': 'Fairy-Stockfish cấp 8',
  'Pikafish at jieqi': 'Pikafish chơi cờ úp',
  '[Jieqi](/rules/jieqi) is xiangqi with every piece face-down. The engine here is PikaJieQi, [our build of Pikafish for the hidden game](https://github.com/brianhliou/pikafish-jieqi-wasm), and it gets the same face-down board you do: a test fails the build if a piece identity ever leaks into what it is sent. [Jieqi on Mistboard](/blog/jieqi-platform) covers the rest.':
    '[Cờ úp](/blog/luat-co-up) là cờ tướng với mọi quân đều úp mặt xuống. Engine ở đây là PikaJieQi, [bản Pikafish chúng tôi dựng cho cờ úp](https://github.com/brianhliou/pikafish-jieqi-wasm), và nó nhận đúng bàn cờ đã úp như bạn thấy: có một bài kiểm thử làm hỏng bản dựng nếu thân phận của một quân lọt vào dữ liệu gửi cho nó. [Cờ úp trên Mistboard](/blog/co-up) nói phần còn lại.',
  'Game review, built for xiangqi and for flip games':
    'Xem lại ván đấu, làm riêng cho cờ tướng và các loại cờ lật quân',
  'Every finished xiangqi game on the site can be sent for review. Pikafish runs over it on the server, and the move list shows where the evaluation moved, what it preferred instead, and which moves lost the game. The post-game review chess players are used to, for xiangqi.':
    'Mọi ván cờ tướng đã xong trên trang đều có thể gửi đi phân tích. Pikafish chạy qua ván đó trên máy chủ, và danh sách nước đi cho thấy đánh giá thay đổi ở đâu, engine muốn đi nước nào thay vào đó, và nước nào làm thua ván. Kiểu xem lại sau ván mà người chơi cờ vua đã quen, nay cho cờ tướng.',
  'For banqi, jieqi and flip jungle the review does something no chess review needs: it prices every flip, so you see what you chose apart from what you drew. [Separating skill from luck](/blog/skill-vs-luck) explains how.':
    'Với cờ lật, cờ úp và cờ thú lật, phần phân tích làm một việc mà cờ vua không cần: nó định giá từng lần lật quân, để bạn thấy phần mình chọn tách khỏi phần mình lật trúng. [Tách kỹ năng khỏi may rủi](/blog/skill-vs-luck) giải thích cách làm.',
  'The [analysis board](/analysis/xiangqi) is for a position you set up yourself. It runs Pikafish in your browser at full strength, on its own net, so nothing you analyze leaves your machine. The net is 51 MB and downloads once.':
    '[Bàn phân tích](/analysis/xiangqi) dành cho thế cờ bạn tự xếp. Nó chạy Pikafish ngay trong trình duyệt ở sức mạnh tối đa, với mạng nơ-ron riêng, nên không có gì bạn phân tích rời khỏi máy của bạn. Mạng nặng 51 MB và chỉ tải một lần.',
  Questions: 'Câu hỏi thường gặp',
  'Can I play Pikafish online?': 'Có thể chơi cờ tướng với máy online không?',
  'Yes, here, in the browser. One click on the Pikafish page starts a game against it; the play menu offers eight easier levels.':
    'Có, ngay tại đây, trên trình duyệt. Một cú nhấp trên trang Pikafish là bắt đầu ván với nó; menu chơi có tám cấp độ dễ hơn.',
  'Is it free?': 'Có miễn phí không?',
  'Yes. Playing, the ladder, jieqi, game review and the analysis board are all free. An account is optional.':
    'Có. Chơi cờ, tám cấp độ, cờ úp, xem lại ván đấu và bàn phân tích đều miễn phí. Tài khoản là không bắt buộc.',
  'Do I need to download anything?': 'Có cần tải về gì không?',
  'No. The game runs in the page. On a phone, open the site in the browser and play.':
    'Không. Ván cờ chạy ngay trên trang. Trên điện thoại, mở trang bằng trình duyệt và chơi.',
  'How strong is it?': 'Máy mạnh đến mức nào?',
  'The Pikafish bot searches three million positions a move, about four seconds, on the server. That is beyond any human. The ladder above it goes down to a level a beginner can beat.':
    'Pikafish tính ba triệu thế cờ mỗi nước, khoảng bốn giây, trên máy chủ. Mức đó vượt xa mọi người chơi. Các cấp độ bên dưới đi xuống tới mức người mới chơi cũng thắng được.',
  'Does the jieqi engine see my hidden pieces?': 'Engine cờ úp có nhìn thấy quân úp của tôi không?',
  'No. It receives the same face-down board you see, and the deal is known to nobody, not you, not the engine, not your opponent.':
    'Không. Nó nhận đúng bàn cờ đã úp như bạn thấy, và lần xáo quân không ai biết: không phải bạn, không phải engine, không phải đối thủ.',
};

export const choiCoTuongVoiMayArticle = deriveTranslation(pikafishArticle, {
  slug: 'choi-co-tuong-voi-may',
  sourceLang: 'vi',
  dict: CHOI_CO_TUONG_VOI_MAY_VI,
});
