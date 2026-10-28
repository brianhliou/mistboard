import type { Article } from '../types.js';

// Card art: the sanction itself. The champion charts use green for a title and
// red for a champion who has since been sanctioned, so the card reuses that
// vocabulary rather than inventing one. Thirteen marks, one per man who has won
// the national title in 2005 or later, ten of them red.
const MATCH_FIXING_THUMBNAIL = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" width="320" height="200" role="img" aria-label="Thirteen marks, ten of them red: the national champions since 2005 who carry a ruling">',
  '<rect x="0" y="0" width="320" height="200" fill="var(--xq-diagram-bg, #d9bd82)"/>',
  // Ordered by the year of the title that puts each man in the window, so the
  // two clean names in the middle are Zhao Guorong (2008) and Xu Yinchuan (2009)
  // and the clean one at the end is Wang Yubo (2025).
  ...['R', 'R', 'G', 'G', 'R', 'R', 'R', 'R', 'R', 'R', 'R', 'R', 'G'].map(
    (kind, i) =>
      `<rect x="${28 + i * 20}" y="88" width="13" height="26" rx="3" fill="${kind === 'R' ? '#c96f62' : '#5da271'}"/>`,
  ),
  '<text x="28" y="142" font-family="Roboto, system-ui, sans-serif" font-size="15" font-weight="600" fill="#5a4626">10 of the last 13 champions</text>',
  '<text x="28" y="166" font-family="Roboto, system-ui, sans-serif" font-size="12" letter-spacing="1.6" fill="#5a4626" opacity="0.72">CHINESE XIANGQI ASSOCIATION RULINGS</text>',
  '</svg>',
].join('');

/**
 * The 录音门 case, written for an English reader who has met the champions on
 * the two list pages and wants to know what the last column means.
 *
 * Sourcing: this is assembled from Chinese-language reporting (Xinhua, China
 * News Service, CCTV, Caixin, Jiemian, and court coverage carried by the
 * Yangtse Evening Post and Sina). There is no English account of comparable
 * detail, which is the reason to write one.
 *
 * Four things are deliberately NOT claimed here, because the sourcing does not
 * carry them and each is a plausible thing to get wrong:
 *   - that this was a gambling case. The charges are bribery of and by
 *     non-state functionaries, Articles 163 and 164. No source supports a
 *     gambling charge.
 *   - that any sentence was suspended. Unverifiable either way.
 *   - fine amounts. Fines are reported, figures are not published.
 *   - that results or titles were annulled. Only the personal technical grade
 *     was revoked; the absence of an annulment is inferred, so the page says
 *     "appears to" rather than asserting it.
 * Engine cheating is the fifth: it is alleged in every account and charged in
 * none, and the page says exactly that rather than picking a side.
 */
export const xiangqiMatchFixingArticle: Article = {
  slug: 'xiangqi-match-fixing',
  homeRow: 'deep-dives',
  kind: 'article',
  publisher: 'mistboard',
  game: 'xiangqi',
  boardFamily: 'xiangqi',
  // The title names the people searched for. Search Console (to 2026-10-17):
  // 232 impressions at about position 6 and 3 clicks under the old title, "The
  // Xiangqi Match-Fixing Case". Keyword Planner (docs-private/seo/
  // player-demand-2026-10.md): 王天一 and "wang tianyi" 1K-10K a month each,
  // 郑惟桐 100-1K, phrased as "<name> 禁赛" (banned) and "<name> 近况" (latest).
  // The card keeps the short title.
  title: 'The Xiangqi Match-Fixing Case',
  cardTitle: 'The Xiangqi Match-Fixing Case',
  seoTitle: 'Why Wang Tianyi 王天一 and Zheng Weitong 郑惟桐 Were Banned',
  summary:
    'Wang Tianyi, China’s top-rated xiangqi player from 2014 to 2023, was banned for life in 2024 and sentenced to 2 years 9 months for bribery. Why he, Zheng Weitong and 47 others were sanctioned, the 12 games prosecutors named, and where the banned players are now.',
  status: 'published',
  publishedAt: '2026-08-31',
  audience:
    'Readers who have seen the ruling column on the champion lists and want to know what it covers.',
  thumbnail: { kind: 'svg', svg: MATCH_FIXING_THUMBNAIL },
  tldr: [
    'Between 2024 and 2026 the Chinese Xiangqi Association sanctioned 49 people for buying and selling games: 8 life bans, 37 timed bans and 4 reprimands.',
    'Ten of the thirteen national champions since 2005 carry a ruling, including Wang Tianyi, the top-rated player from 2014 to 2023.',
    'A Hangzhou court convicted six grandmasters of bribery in September 2025. The charge was bribery, not gambling.',
    'No ruling names a game: the only games on record are 12 in the prosecution’s charges, as one newspaper reported them. Engine cheating is alleged in every account and charged in none.',
  ],
  intro: [
    {
      kind: 'paragraph',
      text: 'Ten of the thirteen men who have won the Chinese national xiangqi championship since 2005 carry a published ruling against them, including every winner from 2010 to 2023. The man who was China’s top-rated player from 2014 to 2023 was banned for life and then convicted in court. This is how that happened, and what it does and does not establish.',
    },
    {
      kind: 'paragraph',
      text: 'It is assembled from Chinese-language reporting, which carries far more of it than the English coverage does. Where something is alleged rather than found, or charged rather than decided, this page says so.',
    },
    {
      kind: 'note',
      text: 'This is our best reading of what has been published. If you know something here to be wrong or out of date, [tell us](/contact) and we will correct it.',
    },
  ],
  sections: [
    {
      heading: 'Who\u2019s who',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The names that recur below. A ban is the association\u2019s penalty and bars a player from competing; a prison term is the court\u2019s.',
        },
        {
          kind: 'table',
          compact: true,
          wrap: true,
          keyColumn: true,
          headers: ['Person', 'Part in the case', 'Ban', 'Prison'],
          nowrapColumns: [2, 3],
          rows: [
            ['Wang\u00a0Tianyi 王天一', 'Bought and sold games', 'Life', '2\u00a0years 9\u00a0months'],
            ['Wang\u00a0Yuefei 王跃飞', 'Middleman', 'Life', '1\u00a0year'],
            ['Hao\u00a0Jichao 郝继超', 'On the tapes', '4\u00a0years 3\u00a0months', 'None'],
            ['Hong\u00a0Zhi 洪智', '2005 champion', 'Life', '2\u00a0years 7\u00a0months'],
            ['Zhao\u00a0Xinxin 赵鑫鑫', '2007 champion', 'Life', '4\u00a0years 9\u00a0months'],
            ['Xie\u00a0Jing 谢靖', '2013 champion', 'Life', '2\u00a0years 6\u00a0months'],
            ['Xu\u00a0Chao 徐超', '2017 champion', 'Life', '2\u00a0years 6\u00a0months'],
            ['Liu\u00a0Dahua 柳大华', 'Accused an official', 'None', 'None'],
            ['Dang\u00a0Fei 党斐', 'Backed Liu Dahua', '3\u00a0years', 'None'],
          ],
        },
      ],
    },
    {
      heading: 'Players paid each other to lose',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The January 2025 and April 2026 rulings use the same formula: those sanctioned took part in 买棋 and 卖棋, buying and selling games, by way of 行贿 and 受贿, giving and taking bribes. The first notice, in September 2024, says only 买棋卖棋 and 操纵比赛, manipulating competition. Money moved from player to player, in cash, sometimes through intermediaries.',
        },
        {
          kind: 'paragraph',
          text: 'It was not a gambling case, though English write-ups often reach for the word. The charges are offering and accepting bribes as a non-state functionary, and no ruling or indictment describes betting.',
        },
      ],
    },
    {
      heading: 'Why buying a game paid for itself',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Rating points were not just a ranking. Under the system in force at the time they fed appearance and per-game fees, which made them the number a professional was paid on. That produced an asymmetry: a top-rated player gained almost nothing from beating a weaker one and lost a great deal from slipping, while the weaker player earned so little that a fee for losing beat the result. On CCTV, the player Cai Yi 才溢 illustrated the gap as perhaps ¥20,000 a game for a marquee name in a sponsored team event against ¥4,000 for an ordinary master. That rating is gone: the association’s 2026 points ranking took effect on 30 January 2026 and replaced it with a rolling 52-week ranking. The association gave fairer measurement of players as the reason and did not mention the case.',
        },
        {
          kind: 'paragraph',
          text: 'The sport administration\u2019s chess and card centre gave three motives in all: promotion through the grade titles, private division of prize money, and inflating the rating itself. Results were arranged to hit the norms for 特级大师, grandmaster, with players negotiating prices across a national individual championship, and in team events the same trade bought qualification as 运动健将, Master of Sport, which the coverage calls 搭便车, free-riding.',
        },
        {
          kind: 'paragraph',
          text: 'Which is why paying to win a game you would probably have won anyway is not irrational. You are not buying the point. You are buying the rating that sets next season\u2019s fee and the title that outlasts any single event, and against those, tens of thousands of yuan for one game is cheap.',
        },
      ],
    },
    {
      heading: 'A recording, and a whistleblower nobody could dismiss',
      blocks: [
        {
          kind: 'paragraph',
          text: 'In April 2023 recordings of phone calls between two grandmasters, Hao Jichao 郝继超 and Wang Yuefei 王跃飞, appeared online. On them the two discuss buying and selling games, engine cheating, and manipulating rating points. Wang Tianyi is named on the tapes but was not on the calls. The Chinese press named the affair after them: 录音门, the recording gate.',
        },
        {
          kind: 'paragraph',
          text: 'Liu Dahua 柳大华, then 73 and the holder of a one-against-nineteen blindfold record, had been saying for years that opponents’ moves were 相当的精准，和软件一模一样, uncannily precise, identical to the software. On 17 October 2023 he and Dang Fei 党斐 made a 实名举报, a real-name accusation, against Guo Liping 郭莉萍, a deputy director at the sport administration’s chess and card centre. That turned a leaked tape into a governance scandal. Liu was attacked online for it and brought two private criminal prosecutions, one for criminal insult and one for defamation, winning both. Dang Fei is on the list below, at three years.',
        },
        {
          kind: 'paragraph',
          text: 'How the recordings reached the internet is reported by one outlet and confirmed by none: that Hao Jichao made them himself, gave them to Hong Zhi 洪智 after a suspension he considered unjust, and that Hong passed them on. Hong Zhi was himself convicted in 2025 and banned for life the following April.',
        },
        {
          kind: 'table',
          wrap: true,
          keyColumn: true,
          headers: ['Date', 'What happened'],
          rows: [
            ['From about 2012', 'Liu Dahua privately alleges engine cheating'],
            ['April 2023', 'The Hao Jichao and Wang Yuefei recordings appear online'],
            ['July 2023', 'The association opens a formal investigation'],
            ['August 2023', 'Wang Tianyi withdraws from the Asian Games, citing health'],
            ['17 October 2023', 'Liu Dahua accuses a sport official by name'],
            ['24 July 2024', 'Start date of the bans announced in April 2026'],
            ['19 September 2024', 'First sanctions: Wang Tianyi and Wang Yuefei, life'],
            ['12 January 2025', 'Second batch: 41 people'],
            ['24 September 2025', 'Six grandmasters convicted in Hangzhou'],
            ['13 April 2026', 'Third batch: 6 people'],
          ],
          caption:
            'The spine of the case. Liu Dahua\u2019s earlier private complaints are his own account rather than a documented date.',
        },
      ],
    },
    {
      heading: 'Two processes, one case',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The disciplinary track and the criminal track are separate: the association can only bar a player from competing, and only the court can send one to prison. They ran on different timetables, and the six convicted are six of the forty-nine banned rather than a different group.',
        },
        {
          kind: 'paragraph',
          text: 'The Chinese Xiangqi Association has sanctioned 49 people in three batches: two in September 2024, forty-one in January 2025, and six in April 2026. That is 8 lifetime bans, 37 timed bans and 4 public reprimands. Revocation of the technical grade title accompanies 19 of the 45 bans rather than all of them. Only the three timed bans in the April 2026 notice carry published start and end dates, all running from 24 July 2024; the January notice publishes no dates at all, so when most of those bans expire is not a matter of public record.',
        },
        {
          kind: 'paragraph',
          text: 'The association published almost every name. Where a player also appears on the champion lists, his national title years are in the last column.',
        },
        {
          kind: 'table',
          compact: true,
          wrap: true,
          keyColumn: true,
          headers: ['Player', 'Ban', 'National titles'],
          rows: [
            ['Wang\u00a0Tianyi 王天一', 'Life', '2012, 2016, 2019, 2023'],
            ['Zhao\u00a0Xinxin 赵鑫鑫', 'Life', '2007'],
            ['Zheng\u00a0Weitong 郑惟桐', 'Life', '2014, 2015'],
            ['Hong\u00a0Zhi 洪智', 'Life', '2005'],
            ['Xie\u00a0Jing 谢靖', 'Life', '2013'],
            ['Xu\u00a0Chao 徐超', 'Life', '2017'],
            ['Wang\u00a0Yang 汪洋', 'Life', '2018'],
            ['Wang\u00a0Yuefei 王跃飞', 'Life', ''],
            ['Shen\u00a0Peng 申鹏', '8\u00a0years', ''],
            ['Wang\u00a0Kuo 王廓', '7\u00a0years 6\u00a0months', '2020'],
            ['Sun\u00a0Yiyang 孙逸阳', '7\u00a0years', ''],
            ['Zhao\u00a0Jincheng 赵金成', '6\u00a0years', ''],
            ['Jiang\u00a0Chuan 蒋川', '5\u00a0years', '2010'],
            ['Zhang\u00a0Shenhong 张申宏', '4\u00a0years 6\u00a0months', ''],
            ['Sun\u00a0Yongzheng 孙勇征', '4\u00a0years 3\u00a0months', '2011'],
            ['Hao\u00a0Jichao 郝继超', '4\u00a0years 3\u00a0months', ''],
            ['Liu\u00a0Junda 刘俊达', '4\u00a0years 3\u00a0months', ''],
            ['Yu\u00a0Yixiao 俞易肖', '4\u00a0years 3\u00a0months', ''],
            ['Cheng\u00a0Ming 程鸣', '4\u00a0years 3\u00a0months', ''],
            ['Zheng\u00a0Yihong 郑一泓', '4\u00a0years', ''],
            ['Dang\u00a0Fei 党斐', '3\u00a0years', ''],
            ['Li\u00a0Shaogeng 李少庚', '3\u00a0years', ''],
            ['Zhao\u00a0Dianyu 赵殿宇', '3\u00a0years', ''],
            ['Nie\u00a0Tiewen 聂铁文', '3\u00a0years', ''],
            ['Wu\u00a0Junqiang 武俊强', '3\u00a0years', ''],
            ['Miao\u00a0Liming 苗利明', '2\u00a0years', ''],
            ['Huang\u00a0Zhufeng 黄竹风', '2\u00a0years', ''],
            ['Sun\u00a0Xinhao 孙昕昊', '2\u00a0years', ''],
            ['Yang\u00a0Ming 杨铭', '2\u00a0years', ''],
            ['Xu\u00a0Chongfeng 徐崇峰', '2\u00a0years', ''],
            ['Zhao\u00a0Wei 赵玮', '1\u00a0year', ''],
            ['Lu\u00a0Weitao 陆伟韬', '1\u00a0year', ''],
            ['Yang\u00a0Hui 杨辉', '1\u00a0year', ''],
            ['Li\u00a0Xiaolong 李小龙', '1\u00a0year', ''],
            ['Zheng\u00a0Yuhang 郑宇航', '1\u00a0year', ''],
            ['Ma\u00a0Tianyue 马天越', '1\u00a0year', ''],
            ['Li\u00a0Aidong 李艾东', '1\u00a0year', ''],
            ['Wang\u00a0Yuhang 王宇航', '6\u00a0months', ''],
            ['Zhao\u00a0Yanghe 赵旸鹤', '6\u00a0months', ''],
            ['Cui\u00a0Ge 崔革', '6\u00a0months', ''],
            ['Meng\u00a0Chen 孟辰', '6\u00a0months', ''],
            ['Xie\u00a0Kui 谢岿', '6\u00a0months', ''],
            ['Zhao\u00a0Ziyu 赵子雨', '6\u00a0months', ''],
            ['Cao\u00a0Yanlei 曹岩磊', 'Reprimand', ''],
            ['Huang\u00a0Wenjun 黄文俊', 'Reprimand', ''],
            ['Cai\u00a0Youguang 蔡佑广', 'Reprimand', ''],
            ['Liang\u00a0Yunlong 梁运龙', 'Reprimand', ''],
          ],
          caption:
            'The 47 the association named. The other two were withheld because they were under 18 when the conduct occurred. Revocation of the technical grade title accompanies 19 of the 45 bans, not all of them.',
        },
        {
          kind: 'paragraph',
          text: 'Hao Jichao, whose recordings started the case, is in the four-year-three-month tier, and was never criminally charged: the sporting penalty is the only one he carries. The end dates that are public all come from the April 2026 batch: Xu Chongfeng’s two-year ban ran out on 23 July 2026, and Jiang Chuan’s five years, announced in that batch and not in January, run to 23 July 2029.',
        },
        {
          kind: 'paragraph',
          text: 'Separately, the Shangcheng District People’s Court in Hangzhou convicted six grandmasters on 24 September 2025 of offering and accepting bribes as non-state functionaries, under Articles 163 and 164 of the criminal law. The Chinese press calls it the sport’s first criminal corruption case.',
        },
        {
          kind: 'table',
          compact: true,
          wrap: true,
          keyColumn: true,
          headers: ['Convicted', 'Prison term'],
          rows: [
            ['Zhao\u00a0Xinxin 赵鑫鑫', '4\u00a0years 9\u00a0months'],
            ['Wang\u00a0Tianyi 王天一', '2\u00a0years 9\u00a0months'],
            ['Hong\u00a0Zhi 洪智', '2\u00a0years 7\u00a0months'],
            ['Xie\u00a0Jing 谢靖', '2\u00a0years 6\u00a0months'],
            ['Xu\u00a0Chao 徐超', '2\u00a0years 6\u00a0months'],
            ['Wang\u00a0Yuefei 王跃飞', '1\u00a0year'],
          ],
          caption:
            'Reported from the 24 September 2025 verdict. The terms are 有期徒刑, fixed-term imprisonment; whether any was suspended has not been reported. No judgment text was released: these figures trace to the prosecution\u2019s case, and only Hong Zhi\u2019s was separately reported as a court outcome. Fines were imposed on Wang Tianyi and Zhao Xinxin; no amounts have ever been published.',
        },
        {
          kind: 'paragraph',
          text: 'A third track went nowhere in public. Three officials left the chess and card centre while the case ran: its director Zhu Guoping 朱国平 and its discipline secretary Guo Yujun 郭玉军 in November 2024, and Guo Liping in December. No removal notice mentions this case, and no official has been reported as charged or sanctioned in connection with it.',
        },
      ],
    },
    {
      heading: 'Why Wang Tianyi was banned for life',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The association banned Wang Tianyi for life on 19 September 2024, in its first notice, together with Wang Yuefei, for buying and selling games, and revoked his titles. The notice describes the conduct as long-running and frequent and names no game. A year later the Hangzhou court convicted him of bribery and sentenced him to 2 years 9 months. He pleaded guilty.',
        },
        {
          kind: 'paragraph',
          text: 'He had been China\u2019s top-rated player from 2014 to 2023, known simply as 象棋第一人, the number one. The prosecution charged 22 separate acts of giving bribes totalling ¥942,000, against 2 acts of taking them totalling ¥116,000. Nineteen of the 22 payments ran through Wang Yuefei.',
        },
        {
          kind: 'paragraph',
          text: 'Eight yuan paid for every one received. He was not a weak player selling games he would have lost: he was the best player in the world, buying them.',
        },
        {
          kind: 'paragraph',
          text: 'Hong Zhi was the only one of the six who contested the charge. His appeal was rejected on 10 February 2026, and because he was taken into custody on sentencing day, roughly a year after Wang Tianyi, he will be released considerably later despite the shorter term.',
        },
      ],
    },
    {
      heading: 'The 12 games prosecutors say were bought or sold',
      blocks: [
        {
          kind: 'paragraph',
          text: 'No ruling names a single game. The association\u2019s notices give events and years at most, the court released no judgment text, and the verdict was reported only as counts and totals. The only games named anywhere in the record are in the prosecution\u2019s charges against Wang Tianyi, as the Economic Observer reported them on 13 June 2025 from the 9 May hearing in Hangzhou. Every line below is a charge as that newspaper reported it, not a finding.',
        },
        {
          kind: 'paragraph',
          text: 'They are one man\u2019s charges, not the whole case. At least 37 of the 49 people the association sanctioned appear nowhere in them, and no other player\u2019s charges were reported game by game. In ten of the games he was the buyer, paying an opponent to lose to him; in two he was the seller, paid to lose.',
        },
        {
          kind: 'table',
          compact: true,
          wrap: true,
          keyColumn: true,
          headers: ['Year', 'Event', 'Opponent he paid to lose', 'Yuan'],
          nowrapColumns: [1, 3],
          rows: [
            ['2012', 'National Championship', 'Sun Yiyang', '20,000'],
            ['2015', 'Gaogang Cup', 'Shen Peng', '50,000'],
            ['2016', 'Yang Guanlin Cup', 'Xie Jing*', '16,000'],
            ['2017', 'Country Garden Cup', 'Zhao Xinxin', '153,000'],
            ['2018', 'Country Garden Cup', 'Xie Jing, Hong Zhi, Zhao Xinxin*', '160,000'],
            ['2018', 'Han Xin Cup', 'Cheng Ming; Xie Jing*', '18,000 + 16,000'],
            ['2019', 'National Championship', 'Xu Chongfeng', '15,000'],
            ['2019', 'Men\u2019s Team League', 'Nie Tiewen, Liu Junda*', '18,000'],
            ['2020', 'Men\u2019s Team League', 'Nie Tiewen; Liu Junda*', '28,000 + 16,000'],
            ['2021', 'Huamu Cup', 'Shen Peng', '15,000'],
          ],
          caption: 'Bought: he paid the opponent. Ten games, \u00a5525,000 in all. * Paid through Wang Yuefei.',
        },
        {
          kind: 'table',
          compact: true,
          wrap: true,
          keyColumn: true,
          headers: ['Year', 'Event', 'Opponent who paid him to lose', 'Yuan'],
          nowrapColumns: [1, 3],
          rows: [
            ['2017', 'National Championship', 'Xu Chao', '100,000'],
            ['2018', 'Wenling Cup, semi-final', 'Zhao Xinxin', '16,000'],
          ],
          caption:
            'Sold: the opponent paid him, and won. Two games, \u00a5116,000. Both tables are the prosecution\u2019s charges as reported by the Economic Observer, 13 June 2025; no ruling or published judgment confirms any line.',
        },
        {
          kind: 'paragraph',
          text: 'Ten of the lines have Wang Tianyi paying, and they add up to ¥525,000 of the ¥942,000 he was charged with giving; the reporting does not itemise the rest. The two lines where he was paid, ¥100,000 from Xu Chao and ¥16,000 from Zhao Xinxin, add up to exactly the ¥116,000 he was charged with taking. Xu Chao won that 2017 championship. Every player named in the list is also on the association\u2019s sanctions list above.',
        },
        {
          kind: 'paragraph',
          text: 'The same report describes the first game. Sun Yiyang, then 17, had Red and was ahead for a time, then made a run of errors and resigned at move 88; Wang Tianyi went on to win that 2012 championship. The move-by-move account is an unnamed observer\u2019s, quoted by the paper.',
        },
        {
          kind: 'paragraph',
          text: 'All of it rests on one newspaper. We read the report in two reprints, on Sina Finance and Tencent News, which agree on most lines; the two league seasons appear only in the Sina reprint. We have not seen the list in any other outlet\u2019s account of the hearing. Wang Tianyi pleaded guilty to the charge, but the verdict as reported does not say which of these games the court accepted.',
        },
      ],
    },
    {
      heading: 'The cheating nobody charged',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Engine cheating runs through every account of this affair and appears in no ruling. It is the substance of the recordings, of Liu Dahua\u2019s accusation, and of the press investigations, while the findings cite only bribery and the buying and selling of games. Nothing published resolves it either way.',
        },
        {
          kind: 'paragraph',
          text: 'What exists is testimony. Liu Dahua says that at a league match in Ordos in October 2018 he was standing beside Hao Jichao’s game against a teammate of his own when he twice heard a voice call a move, 卒5平4, pawn five to the fourth file, and that Hao then played it. He suspected smartwatches as the capture device, and says that at an earlier fixture where watches were collected before play, Hao lost two games. This is his account, and no finding confirms any of it.',
        },
        {
          kind: 'paragraph',
          text: 'Xu Yinchuan, who won six national titles and three world titles and is named in none of the three notices, is quoted as saying 有了软件以后，就感觉自己的棋跟软件比就根本没法下, that once the software existed his own play felt unplayable measured against it. He is describing what engines did to a professional’s confidence in preparation rather than accusing anyone, which is worth keeping distinct.',
        },
        {
          kind: 'paragraph',
          text: 'Tao Hanming, the 1994 champion, spoke out against software cheating in January 2016 and retracted the next day, saying he had spoken out of turn after drinking. A friend later told Jiemian the drink was cover for pressure. Which version to believe is the kind of thing a disciplinary finding settles, and none did.',
        },
      ],
    },
    {
      heading: 'No result has been struck from the record',
      blocks: [
        {
          kind: 'paragraph',
          text: 'No ruling says which individual games were bought. What was revoked is the personal technical grade, the 特级大师 or 大师 rank, which is a title conferred on a player rather than a tournament result. No championship or team title appears to have been annulled, and the champion lists on this site are unchanged. Ratings are a special case: none were struck, but the rating itself was replaced when the 2026 points ranking took effect on 30 January 2026.',
        },
        {
          kind: 'paragraph',
          text: 'So the names stay on those pages with the finding beside them. Dropping them would assert something the rulings do not: that the games themselves were not real.',
        },
      ],
    },
    {
      heading: 'Where the banned players are now',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The notices give the same reason for every name, buying and selling games, and none says which games. The players searched for most stand like this. Wang Tianyi is the only one who has spoken: on 21 October 2025 he published an apology on his personal account, his first public statement since the sentence, saying he could finally let go of the obsession with being first under heaven, that he had once told himself buying games was something everyone in the profession tacitly accepted, and that people would see a better version of him.',
        },
        {
          kind: 'table',
          compact: true,
          wrap: true,
          keyColumn: true,
          headers: ['Player', 'Ban', 'Prison'],
          rows: [
            ['Wang\u00a0Tianyi 王天一', 'Life', '2\u00a0years 9\u00a0months'],
            ['Zheng\u00a0Weitong 郑惟桐', 'Life', 'None reported'],
            ['Zhao\u00a0Xinxin 赵鑫鑫', 'Life', '4\u00a0years 9\u00a0months'],
            ['Wang\u00a0Kuo 王廓', '7\u00a0years 6\u00a0months', 'None reported'],
            ['Jiang\u00a0Chuan 蒋川', '5\u00a0years, to July 2029', 'None reported'],
            ['Sun\u00a0Yongzheng 孙勇征', '4\u00a0years 3\u00a0months', 'None reported'],
            ['Meng\u00a0Chen 孟辰', '6\u00a0months', 'None reported'],
          ],
          caption:
            'All but Meng Chen also had their technical grade title revoked; Wang Kuo\u2019s 2020 national title stands. Apart from Wang Tianyi\u2019s apology, Chinese-language searches in October 2026 for each name (latest news, response, livestream, Douyin, comeback) found no public statement after the ruling. That is a statement about those searches, not proof of silence.',
        },
      ],
    },
    {
      heading: 'Where the sport is now',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The league came back. The 2025 national men’s league ran its preliminary from 30 July 2025 and opened the main stage in Harbin on 3 August, with revised eligibility rules and a reformed format: 25 teams, ten advancing to a double round-robin, four boards played in two waves of two, and a blitz tiebreak deciding drawn matches. Whether the format was designed against collusion is not stated anywhere official, but a match that cannot end level is harder to arrange.',
        },
        {
          kind: 'paragraph',
          text: 'Thirty-seven of the bans expire. Eight do not. The 2025 national championship was won by Wang Yubo 王禹博, the first title since Xu Yinchuan’s in 2009 that comes with no asterisk on it, and the 2025 world title left China for the first time.',
        },
        {
          kind: 'cta',
          buttons: [
            {
              label: 'Every national champion since 1956',
              href: '/blog/xiangqi-champions',
              emphasis: 'secondary',
            },
            {
              label: 'Every world champion since 1990',
              href: '/blog/xiangqi-world-championship',
              emphasis: 'secondary',
            },
          ],
        },
      ],
    },
    {
      heading: 'Sources',
      blocks: [
        {
          kind: 'paragraph',
          text: 'All of it is Chinese-language reporting, listed so a reader who reads Chinese can check it rather than take our word for it.',
        },
        {
          kind: 'table',
          compact: true,
          wrap: true,
          headers: ['What it covers', 'Source'],
          nowrapColumns: [0, 1],
          rows: [
            ['The April 2026 rulings', '[Xinhua](https://www.news.cn/sports/20260413/5a609df239414cb1b7118b2aa88518d0/c.html), [Caixin](https://china.caixin.com/2026-04-13/102433594.html)'],
            ['The January 2025 batch of 41', '[China News Service](https://www.chinanews.com.cn/ty/2025/01-13/10352255.shtml), [China Daily](https://cn.chinadaily.com.cn/a/202501/12/WS6783355ea310b59111dad5af.html)'],
            ['Wang Tianyi\u2019s life ban, September 2024', '[National Business Daily](https://www.nbd.com.cn/articles/2024-09-19/3562788.html)'],
            ['The verdict and the six sentences', '[Yangtse Evening Post](https://www.yzwb.net/news/ty/202509/t20250924_268789.html), [Sina Sports](https://sports.sina.cn/others/qipai/2025-09-25/detail-infrsnht5787840.d.html)'],
            ['Hong Zhi\u2019s refusal to plead guilty', '[Tencent News](https://news.qq.com/rain/a/20250924A04LFX00)'],
            ['Appearance fees and the motives', '[CCTV](https://news.cctv.cn/2025/01/13/ARTIeFfY6eKYaRLubq3G5ZQp250113.shtml)'],
            ['Liu Dahua\u2019s account; how the tapes spread', '[Jiemian](https://m.jiemian.com/article/12366112.html)'],
            ['The fullest timeline of the affair', '[Guancha](https://www.guancha.cn/sports/2025_01_12_761863.shtml)'],
            ['The 12 charged games, 13 June 2025', 'Economic Observer, via [Sina](https://cj.sina.com.cn/articles/view/1641561812/61d83ed402701a2aa) and [Tencent](https://news.qq.com/rain/a/20250613A02A2500)'],
            ['Wang Tianyi\u2019s apology, 21 October 2025', '[Jiemian](https://www.jiemian.com/article/13494543.html)'],
            ['Both notices, with Jiang Chuan\u2019s dates', '[Xinhua](https://www.news.cn/sports/20250112/cdc48783bc344002b69e179d7ae2fde1/c.html), [Yangtse Evening Post](https://www.yzwb.net/news/txs/202604/t20260413_341537.html)'],
            ['The 2026 points ranking and its reason', '[Beijing Daily](https://news.bjd.com.cn/2026/02/02/11561527.shtml)'],
          ],
        },
        {
          kind: 'paragraph',
          text: 'Several claims here rest on thinner ground than the rest, and the text says so where they appear: five of the six sentences trace to the prosecution rather than a released judgment, the 12 games are one newspaper\u2019s report of the charges, all of Liu Dahua’s testimony and the Xu Yinchuan quotation are single-sourced accounts, the route the recordings took to the internet is one outlet’s investigation, the officials’ departures are not officially tied to this case, and the absence of any annulled result is inferred from silence rather than stated in a ruling.',
        },
      ],
    },
  ],
};
