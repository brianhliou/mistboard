// The banqi post (growth plan lane 0, #422): what the rules page does not
// carry. Brian, 2026-09-21: "a blog post on banqi — covering stuff the banqi
// rules page doesn't." The rules page keeps the rules; this takes the park
// rules nobody on page 1 answers straight, the engine and its blind spot, the
// review that separates a bad decision from a bad tile, and playing without
// installing anything. Its primary reader is Taiwanese, in zh-Hant; the
// English is the dictionary key.
import { BANQI_ONLINE_THUMBNAIL } from '../diagrams.js';
import type { Article, ArticleBlock } from '../types.js';

const PLAY_ENGINE = '/?play=computer&gameSpecId=banqi';
const PLAY_FRIEND = '/?play=friend&gameSpecId=banqi';

export const banqiOnlineArticle: Article = {
  slug: 'banqi-online',
  kind: 'article',
  publisher: 'mistboard',
  gameSpecId: 'banqi',
  boardFamily: 'xiangqi',
  playableOnMistboard: true,
  title: 'Banqi on Mistboard',
  seoTitle: 'Play Banqi Online: No Install, vs the Engine or a Friend',
  summary:
    'Banqi in the browser: nothing to install, no account, an engine that beats most people, a friend link, and a straight answer on the park rules the competition rules leave out.',
  showSummaryOnPage: false,
  status: 'draft',
  publishedAt: '2026-09-22',
  audience:
    'Anyone who searched for somewhere to play banqi online and wants a board now, with the rules question that always comes up answered on the same page.',
  thumbnail: { kind: 'svg', svg: BANQI_ONLINE_THUMBNAIL },
  readNext: ['banqi', 'mistybanqi', 'skill-vs-luck'],
  intro: [
    {
      kind: 'paragraph',
      text: 'Banqi is the half-board xiangqi game where all thirty-two pieces start face-down. Open the board, flip a tile, and you are playing. Nothing to install, no account, no ads on the board. The [rules page](/rules/banqi) has every rule on a board; this page is the rest.',
    },
    {
      kind: 'cta',
      buttons: [
        { label: 'Play the engine', href: PLAY_ENGINE, emphasis: 'primary' },
        { label: 'Play a friend', href: PLAY_FRIEND, emphasis: 'secondary' },
      ],
    },
    {
      kind: 'embed',
      path: '/embed/study/FsA5sowX/F8fezAhm',
      title: 'Banqi: an engine game under the competition rules',
      aspect: [702, 440],
    } as ArticleBlock,
    {
      kind: 'paragraph',
      text: 'That is [MistyBanqi](/blog/mistybanqi) against itself at ten million nodes a move, one of [twenty games](/study/FsA5sowX) from the same run. Step through it with the arrows; a tile nobody has flipped is still face-down.',
    },
  ],
  sections: [
    {
      heading: 'Park rules and competition rules',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Banqi is a park game before it is a competition game, and every park has its own rules. Three come up constantly. Chain captures, where a piece that captures may capture again in the same turn. The straight-charging chariot, which slides any distance along an empty line and captures across it regardless of rank. The flying cannon, which may also jump to an empty square as an ordinary move.',
        },
        {
          kind: 'paragraph',
          text: 'None of these are played here. The board uses the Taiwanese competition rules: one action per turn, every piece moving one square, and the cannon jumping only to capture. Those are the rules the strongest programs play, they are the version an engine can be tuned against, and they are the version two strangers can agree on without a conversation first. If you learned the park version, the ladder on the rules page is the one every game on this site follows.',
        },
        {
          kind: 'paragraph',
          text: 'The draw rules come from the same source, the Taiwan Computer Game Association: forty moves with no capture or flip is a draw, and so is a repeated position. In the twenty engine games above, fifteen ended with a side unable to move and five on the forty-move clock; none by repetition.',
        },
      ],
    },
    {
      heading: 'The engine',
      blocks: [
        {
          kind: 'paragraph',
          text: 'You play MistyBanqi, an engine written for this game: it searches ahead, treats every flip as a roll of the remaining tiles, and scores positions with a hand-written evaluation. It plays at one fixed strength and will beat most people. Its one known weakness is that it can let a won game drift into a draw, which is worth knowing when you are the one losing. [How it thinks, and where it cracks.](/blog/mistybanqi)',
        },
        {
          kind: 'paragraph',
          text: 'The same engine sits behind the [analysis board](/analysis/banqi), where you can set up any position and ask it what it would do.',
        },
      ],
    },
    {
      heading: 'A bad decision or a bad tile',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Half the moves in banqi are flips, and a flip is a dice roll. A chess-style review would blame you for variance. Finished games here get a review that splits every flip into the decision and the tile: your accuracy with the luck stripped out, and a luck line on the advantage graph, so you can see whether you lost to a bad move or a bad draw. [How the review separates skill from luck](/blog/skill-vs-luck), with what fifty-two human games against the engine say about who really earned their wins.',
        },
      ],
    },
    {
      heading: 'Playing without installing anything',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The board runs on the page, on a phone or a computer, so there is nothing to download and nothing to sign up for. Pick a time control and the engine takes the other seat. To play a person, send them the link the site gives you: whoever opens it sits down opposite you, on any device, with no account either. Finished games stay on the site with their review.',
        },
      ],
    },
    {
      heading: 'Common questions',
      blocks: [
        {
          kind: 'faq',
          items: [
            {
              question: 'Can you chain captures in banqi?',
              answer:
                'Not under competition rules, and not on this board: a turn is one flip or one move, and a capture ends it. Chain captures are a park rule some tables play.',
            },
            {
              question: 'Where can I play banqi online for free?',
              answer:
                'Here. The board runs in the browser on a phone or a computer, with no download and no account. Play the engine, or send a friend the game link.',
            },
            {
              question: 'What is banqi called in English?',
              answer:
                'Banqi, or Chinese dark chess; blind chess and half-board xiangqi also appear. The Chinese name is 暗棋; 翻棋 and 半棋 are used too.',
            },
            {
              question: 'Are the Hong Kong rules different?',
              answer:
                'Yes. Hong Kong tables commonly rank the pieces general, chariot, horse, cannon, advisor, elephant, soldier, with the cannon inside the ladder, and mainland tables usually have no jumping cannon at all. This board plays the Taiwanese ladder only.',
            },
            {
              question: 'Can I play against the computer?',
              answer:
                'Yes, that is the default: the engine takes the other seat the moment you open the board. It plays at one fixed strength.',
            },
          ],
        },
      ],
    },
    {
      heading: 'Start playing',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Free, nothing to install, no account. Flip a tile and see what you get.',
        },
        {
          kind: 'cta',
          buttons: [
            { label: 'Play the engine', href: PLAY_ENGINE, emphasis: 'primary' },
            { label: 'Play a friend', href: PLAY_FRIEND, emphasis: 'secondary' },
          ],
        },
      ],
    },
  ],
};
