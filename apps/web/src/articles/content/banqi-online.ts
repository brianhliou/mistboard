// The banqi play page (growth plan lane 0, #422): the page a "暗棋 線上" or
// "暗棋 免安裝" search should land on. Its primary reader is Taiwanese, in
// zh-Hant; the English is the dictionary key. Rules-kind so it sits in the
// rules index for good rather than aging out of the blog ring, and so it
// carries the /rules/ authority the domain already has for 暗棋 queries.
// The canonical rules page stays /rules/banqi; this page links to it and
// takes the play-shaped queries (線上玩, 免安裝, AI 對戰, 雙人).
import { BANQI_SAMPLE_GAME } from '../../banqi-sample-game.js';
import { BANQI_ONLINE_THUMBNAIL } from '../diagrams.js';
import type { Article } from '../types.js';

const PLAY_ENGINE = '/?play=computer&gameSpecId=banqi';
const PLAY_FRIEND = '/?play=friend&gameSpecId=banqi';

export const banqiOnlineArticle: Article = {
  slug: 'banqi-online',
  gameSpecId: 'banqi',
  boardFamily: 'xiangqi',
  kind: 'rules',
  playableOnMistboard: true,
  // Not on the rules index: that grid is one icon per game, and this is the
  // play page for a game that already has its icon there. Search, the sitemap
  // and the link from /rules/banqi are its paths in.
  showInIndex: false,
  title: 'Play Banqi Online',
  seoTitle: 'Play Banqi Online: No Install, vs the Engine or a Friend',
  summary:
    'Banqi (Chinese dark chess) in the browser: nothing to install, no account, an engine that will beat most people, a link to play a friend, and the competition rules used in Taiwan.',
  showSummaryOnPage: false,
  // Pulled to draft 2026-09-21 the evening it shipped (Brian: "it's not
  // ready. sorry we rushed it a bit"): the zh-Hant copy goes back through a
  // read on localhost before it publishes again. The dictionary entries stay.
  status: 'draft',
  publishedAt: '2026-09-21',
  audience:
    'Anyone who searched for somewhere to play banqi online and wants a board now, with the rules question that always comes up answered on the same page.',
  thumbnail: { kind: 'svg', svg: BANQI_ONLINE_THUMBNAIL },
  intro: [
    {
      kind: 'paragraph',
      text:
        'Banqi is the half-board xiangqi game where all thirty-two pieces start face-down. Open the board, flip a tile, and you are playing. Nothing to install, no account, no ads on the board.',
    },
    {
      kind: 'cta',
      buttons: [
        { label: 'Play the engine', href: PLAY_ENGINE, emphasis: 'primary' },
        { label: 'Play a friend', href: PLAY_FRIEND, emphasis: 'secondary' },
      ],
    },
    {
      kind: 'banqi-replay',
      spec: {
        red: BANQI_SAMPLE_GAME.red,
        black: BANQI_SAMPLE_GAME.black,
        event: BANQI_SAMPLE_GAME.event,
        outcome: 'MistyBanqi (Red) wins by resignation · 49 moves',
        resultText: BANQI_SAMPLE_GAME.result,
        deal: BANQI_SAMPLE_GAME.deal,
        moves: BANQI_SAMPLE_GAME.moves,
      },
      caption:
        'A real game against the engine, played on this site. Step through it with the arrows; plain discs are still face-down.',
    },
  ],
  sections: [
    {
      heading: 'Play in the browser',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'The board runs on the page, on a phone or a computer, so there is nothing to download and nothing to sign up for. Pick a time control and the engine takes the other seat. To play a person, send them the link the site gives you: whoever opens it sits down opposite you, on any device, with no account either.',
        },
        {
          kind: 'paragraph',
          text:
            'Finished games stay on the site with a review: every move judged by the engine, and every flip scored for how lucky it was, so you can see whether you lost to a bad decision or a bad tile. [How the review separates skill from luck](/blog/skill-vs-luck).',
        },
      ],
    },
    {
      heading: 'The engine',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'You play [MistyBanqi](/blog/mistybanqi), an engine written for this game: it searches ahead, treats every flip as a roll of the remaining tiles, and scores positions with a hand-written evaluation. It plays at one fixed strength and will beat most people. Its one known weakness is that it can let a won game drift into a draw, which is worth knowing when you are the one losing.',
        },
        {
          kind: 'paragraph',
          text:
            'The same engine sits behind the [analysis board](/analysis/banqi), where you can set up any position and ask it what it would do.',
        },
      ],
    },
    {
      heading: 'The rules on this board',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'Taiwanese rules, as played in competition. The ladder is general, advisor, elephant, chariot, horse, soldier: a piece captures its own rank or anything below it, the soldier can capture the general, and the general cannot capture a soldier. The cannon is the exception: it captures any revealed enemy piece by jumping exactly one piece along a row or column, and as a target it ranks between the horse and the soldier. Face-down tiles cannot be captured.',
        },
        {
          kind: 'paragraph',
          text:
            'Draws follow the Taiwan Computer Game Association competition rules: forty moves with no capture or flip is a draw, and so is a repeated position. Each turn is one action, a flip or a move. The full ladder with diagrams is on the [rules page](/rules/banqi).',
        },
      ],
    },
    {
      heading: 'Park rules and competition rules',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'Banqi is a park game before it is a competition game, and every park has its own rules. Three come up constantly. Chain captures, where a piece that captures may capture again in the same turn. The straight-charging chariot, which slides any distance along an empty line and captures across it regardless of rank. The flying cannon, which may also jump to an empty square as an ordinary move.',
        },
        {
          kind: 'paragraph',
          text:
            'None of these are played here. The board uses the competition rules, one action per turn, every piece moving one square, and the cannon jumping only to capture, because that is the version an engine can be tuned against and the version two strangers can agree on without a conversation first. If you learned the park version, the table on the rules page is the one every game on this site follows.',
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
              question: 'How do you play banqi?',
              answer:
                'Thirty-two xiangqi pieces are shuffled face-down on half a board. Your first flip decides your colour. Each turn you either flip a tile or move a revealed piece one square; captures follow the rank ladder, and the cannon captures by jumping one piece. You win when your opponent has no move or no pieces. The rules page has the ladder and the diagrams.',
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
            { label: 'Read the rules', href: '/rules/banqi', emphasis: 'secondary' },
          ],
        },
      ],
    },
  ],
};
