// Vietnamese rules page for cờ úp (jieqi).
//
// Why this exists: "luật cờ úp" is the query a Vietnamese player types before
// they type "chơi cờ úp", and we had nothing for it. The English /rules/jieqi
// page answered it in the wrong language, so a Vietnamese reader who followed a
// rules link left the funnel. This page captures the informational query and
// hands the reader on to co-up, which is the page that asks them to play.
//
// Rules are translated from the English /rules/jieqi article rather than written
// from memory, so the two cannot disagree about how the game works. Anything that
// changes there has to change here.
//
// kind: 'article' rather than 'rules' on purpose. The /rules/<slug> surface is
// gated per variant by rulesSlugPublicSurfaceEnabled(gameSpecId ?? slug), and
// 'luat-co-up' is not a variant id, so filing it as rules would put it behind a
// gate it can never satisfy. /blog/luat-co-up has no such gate and ranks the same.
//
// CAVEAT: nobody on this side reads Vietnamese well enough to certify this copy.
// It is translated carefully and the terminology below is the standard Vietnamese
// xiangqi vocabulary (tướng, sĩ, tượng, xe, pháo, mã, tốt), but it has NOT had a
// native read. Treat a native review as a prerequisite for publishing, not a
// nice-to-have: rules copy that is subtly wrong is worse than no rules copy.

import { JIEQI_SAMPLE_GAME } from '../../jieqi-sample-game.js';
import { cjkGlyphMark, xiangqiGlyph } from '../../xiangqi-piece-sets.js';
import {
  JIEQI_CAPTURE_PRIVACY,
  JIEQI_REVEAL_PAIR,
  JIEQI_REVEALED_FREEDOMS,
  JIEQI_START_BOARD,
} from '../diagrams.js';
import { textCard } from '../text-card.js';
import type { Article, ArticleBlock } from '../types.js';

// Text card in the family TITLED_PLAYERS_THUMBNAIL started and the jieqi platform
// page carried on: same 320x200 geometry, palette and type colours. Until now this
// page had no thumbnail at all and rendered a blank grey card, which only became
// visible once the footer ring started pointing Vietnamese readers at it.
//
// The mark is Vietnamese, not English. The champions card argues for an English
// mark because its reader is a chess player who does not read hanzi; this page's
// reader arrived from a search for `luat co up`, so the one legible thing at 158px
// has to be the phrase they typed, under the game it belongs to (CỜ TƯỚNG), in the
// page's language like every text card (text-card.ts).
//
// The bottom row is the departure from co-up's card, which sits beside this one in
// the footer ring and is otherwise the same object: one piece turned over and four
// still face down, because a rules page is about the flip and nothing else on the
// card says so. Discs use the board renderer's own shrouded fills and the revealed
// piece its real base fill, ring colour and baked glyph outline, so the card cannot
// drift from the boards inside the article.
//
// The turned-over piece leads the row rather than ending it. The index card stamps
// its DRAFT badge over the bottom-right corner, which landed squarely on the one
// element that tells this card apart from co-up's.
const LUAT_CO_UP_FLIP_ROW = [
  '<circle cx="96" cy="172" r="12" fill="#f3e6c4" stroke="#b91c1c" stroke-width="2"/>',
  ...[0, 1, 2, 3].map((i) => {
    const red = i % 2 === 1;
    return [
      `<circle cx="${128 + i * 32}" cy="172" r="12" `,
      `fill="${red ? '#a95f4a' : '#2f7d62'}" `,
      `stroke="${red ? '#6f342c' : '#174536'}" stroke-width="2"/>`,
    ].join('');
  }),
  '<g transform="translate(84 160) scale(0.24)">',
  cjkGlyphMark(xiangqiGlyph('traditional', 'red', 'chariot'), '#b91c1c'),
  '</g>',
].join('');

const LUAT_CO_UP_THUMBNAIL = textCard({
  palette: 'xiangqi',
  eyebrow: 'C\u1edc T\u01af\u1edaNG',
  lead: 'C\u1edc \u00daP',
  tagline: 'LU\u1eacT CH\u01a0I',
  art: LUAT_CO_UP_FLIP_ROW,
  ariaLabel: 'Thẻ đề Cờ úp, luật chơi, trên một hàng quân úp và một quân đã lật',
});

export const luatCoUpArticle: Article = {
  slug: 'luat-co-up',
  kind: 'article',
  publisher: 'mistboard',
  boardFamily: 'xiangqi',
  sourceLang: 'vi',
  title: 'Luật cờ úp',
  thumbnail: { kind: 'svg', svg: LUAT_CO_UP_THUMBNAIL },
  seoTitle: 'Luật cờ úp: cách chơi cờ úp đầy đủ',
  summary:
    'Luật cờ úp đầy đủ: cách bày quân, cách đi quân úp trước và sau khi lật, ăn quân úp, chiếu bí và các trường hợp hòa.',
  showSummaryOnPage: false,
  status: 'published',
  publishedAt: '2026-09-03',
  audience: 'Người mới chơi cờ úp, và người chơi cờ tướng muốn biết cờ úp khác ở chỗ nào.',
  intro: [
    {
      kind: 'paragraph',
      text: 'Cờ úp giữ nguyên bàn cờ, quân cờ và mục tiêu chiếu bí của [cờ tướng](/rules/xiangqi), chỉ khác một điều: mọi quân trừ tướng đều được úp xuống. Một quân úp đi, chiếu và ăn theo vị trí xuất phát mà nó đang đứng. Sau nước đi đó nó lật lên và từ đó đi theo đúng thân phận của mình.',
    },
    {
      kind: 'paragraph',
      text: 'Trang này chỉ nói phần khác biệt. Phần còn lại giống hệt cờ tướng.',
    },
  ],
  sections: [
    {
      heading: 'Bày quân',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Đặt tướng ngửa lên ở vị trí bình thường trong cung. Mười lăm quân còn lại của mỗi bên được xáo trộn rồi úp xuống các vị trí xuất phát còn lại. Không ai biết thân phận của quân nào, kể cả quân của chính mình.',
        },
        {
          kind: 'raw-svg',
          svg: () => JIEQI_START_BOARD({ start: 'THẾ BAN ĐẦU ĐÃ XÁO' }),
          caption: 'Chỉ hai tướng ngửa mặt. Mười lăm quân còn lại của mỗi bên đều úp.',
        } as ArticleBlock,
      ],
    },
    {
      heading: 'Nước đi đầu tiên đi theo vị trí xuất phát',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Khi chưa lật, quân úp đi theo vai trò của vị trí nó đang đứng, không phải theo thân phận đang giấu. Quân úp ở góc bàn đi như xe; quân úp ở vị trí mã, sĩ, tượng, pháo hay tốt thì đi đúng như những quân đó.',
        },
        {
          kind: 'paragraph',
          text: 'Mọi hạn chế thông thường vẫn được áp dụng cho nước đi đó: cản mã, cản tượng (mắt tượng), pháo phải có ngòi, sĩ không ra khỏi cung, tượng không qua sông. Nước đi vừa xong là quân lật ngửa cho cả hai bên cùng thấy.',
        },
        {
          kind: 'raw-svg',
          svg: () => JIEQI_REVEAL_PAIR({ before: 'TRƯỚC: VỊ TRÍ MÃ', after: 'SAU: LẬT RA PHÁO' }),
          caption:
            'Quân úp đứng ở vị trí mã nên đi như mã. Đi xong nó lật lên, và hoá ra là pháo: ô cờ chỉ quyết định nước đi đầu tiên, không quyết định thân phận.',
        } as ArticleBlock,
      ],
    },
    {
      heading: 'Quân đã lật đi theo thân phận',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Sau khi lật, quân đi theo thân phận thật của nó, tính từ vị trí hiện tại. Sĩ được phép ra khỏi cung và tượng được phép qua sông. Cách đi của chúng không đổi: sĩ đi chéo một điểm, tượng đi chéo hai điểm và vẫn bị cản mắt tượng.',
        },
        {
          kind: 'paragraph',
          text: 'Mã, xe và pháo đi bình thường. Tốt theo luật sông bình thường tính từ chỗ nó lật lên: chưa qua sông thì chỉ đi thẳng, qua sông rồi thì đi thẳng hoặc ngang, không bao giờ đi lùi.',
        },
        {
          kind: 'raw-svg',
          svg: () =>
            JIEQI_REVEALED_FREEDOMS({ advisor: 'SĨ SAU KHI LẬT', elephant: 'TƯỢNG SAU KHI LẬT' }),
          caption: 'Sau khi lật, sĩ được ra khỏi cung và tượng được qua sông.',
        } as ArticleBlock,
      ],
    },
    {
      heading: 'Ăn quân úp',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Nếu một quân úp bị ăn khi chưa lật, chỉ bên ăn được biết đó là quân gì. Bên mất quân chỉ thấy một quân úp rời bàn cờ mà không biết thân phận. Nhờ vậy bên ăn có thêm thông tin để loại trừ khả năng ở những quân úp còn lại.',
        },
        {
          kind: 'raw-svg',
          svg: () =>
            JIEQI_CAPTURE_PRIVACY({
              capture: 'ĂN QUÂN',
              title: 'AI BIẾT QUÂN VỪA BỊ ĂN',
              redKnows: 'ĐỎ BIẾT',
              blackKnows: 'ĐEN BIẾT',
            }),
          caption: 'Bên ăn biết mình vừa ăn quân gì. Bên mất quân thì không.',
        } as ArticleBlock,
      ],
    },
    {
      heading: 'Chiếu, thắng và hòa',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Mọi điểm có quân đều nhìn thấy được, nên hai bên luôn biết khi nào tướng bị chiếu. Một quân úp chưa đi thì chiếu theo vai trò vị trí xuất phát của nó. Khi nó đã đi thì nó lật ngay, và đòn tấn công từ ô đến được tính theo thân phận vừa lật.',
        },
        {
          kind: 'paragraph',
          text: 'Luật chiếu bình thường vẫn giữ nguyên: không được đi nước để tướng bên mình bị chiếu, và đang bị chiếu thì phải gỡ. Bạn thắng khi chiếu bí hoặc khi đối phương hết nước đi hợp lệ. Luật lộ mặt tướng vẫn áp dụng, và quân úp chắn cột dọc như mọi quân khác.',
        },
        {
          kind: 'paragraph',
          text: 'Trên Mistboard, ván cờ tự động hòa sau 120 lượt đi, tức 60 nước mỗi bên, mà không có nước ăn quân nào. Lặp lại thế cờ không tạo ra một luật hòa tự động riêng.',
        },
      ],
    },
    {
      heading: 'Một ván mẫu',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Đi thử từng nước một ván engine tự đánh với chính mình. Quân úp hiện ra như những đĩa màu và lật lên đúng lần đầu chúng di chuyển.',
        },
        {
          kind: 'jieqi-replay',
          spec: {
            red: JIEQI_SAMPLE_GAME.red,
            black: JIEQI_SAMPLE_GAME.black,
            event: JIEQI_SAMPLE_GAME.event,
            outcome: 'Đỏ thắng bằng chiếu bí · 36 nước',
            resultText: JIEQI_SAMPLE_GAME.result,
            deal: JIEQI_SAMPLE_GAME.deal,
            moves: JIEQI_SAMPLE_GAME.moves,
          },
        } as ArticleBlock,
      ],
    },
    {
      heading: 'Chơi thử',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Cách nhanh nhất để hiểu cờ úp là chơi một ván. Trên Mistboard bạn chơi được ngay với máy hoặc với bạn bè, miễn phí và không cần tài khoản. [Trang cờ úp](/blog/co-up) nói rõ hơn về phần chơi và phần phân tích ván đấu.',
        },
        {
          kind: 'cta',
          buttons: [
            {
              label: 'Chơi với máy',
              href: '/?play=computer&gameSpecId=jieqi',
              emphasis: 'primary',
            },
            { label: 'Mời bạn bè', href: '/?play=friend&gameSpecId=jieqi', emphasis: 'secondary' },
          ],
        },
      ],
    },
  ],
};
