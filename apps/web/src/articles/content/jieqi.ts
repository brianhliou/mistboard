import {
  JIEQI_CAPTURE_PRIVACY,
  JIEQI_REVEAL_PAIR,
  JIEQI_REVEALED_FREEDOMS,
  JIEQI_RULES_THUMBNAIL,
  JIEQI_START_BOARD,
  playClosing,
} from '../diagrams.js';
import { JIEQI_SAMPLE_GAME } from '../../jieqi-sample-game.js';
import type { Article } from '../types.js';

export const jieqiArticle: Article = {
    slug: 'jieqi',
    gameSpecId: 'jieqi',
    boardFamily: 'xiangqi',
    kind: 'rules',
    playableOnMistboard: true,
    title: 'Jieqi Rules (Reveal Xiangqi)',
    summary:
      'Jieqi, the hidden-piece Chinese chess variant, explained in English. Every piece but the general starts face-down, moves first as the point it stands on, then reveals. Play it free in your browser.',
    showSummaryOnPage: false,
    status: 'published',
    publishedAt: '2026-06-15',
    updatedAt: '2026-09-17',
    audience:
      'Xiangqi players and hidden-information fans who want a clean English rules reference for Jieqi.',
    thumbnail: { kind: 'svg', svg: JIEQI_RULES_THUMBNAIL },
    intro: [
      {
        kind: 'paragraph',
        text:
          "Jieqi, also called Reveal Xiangqi, keeps xiangqi's board and checkmate goal, but hides every non-general piece. A dark piece first moves, attacks, and captures by the starting point it occupies. After that move, it reveals and plays by identity.",
      },
      {
        kind: 'paragraph',
        text:
          'Use [Xiangqi Rules](/rules/xiangqi) for the base game. This page covers what changes.',
      },
    ],
    sections: [
      {
        heading: 'Setup',
        blocks: [
          {
            kind: 'paragraph',
            text:
              "Set each general face-up on its normal palace point. Shuffle each side's other fifteen pieces and deal them face-down onto the remaining starting points. Neither player knows any hidden identities, including their own.",
          },
          {
            kind: 'raw-svg',
            svg: JIEQI_START_BOARD,
          },
        ],
      },
      {
        heading: 'First moves use starting points',
        blocks: [
          {
            kind: 'paragraph',
            text:
              'Before reveal, a dark piece uses the role of the starting point it occupies, not its hidden identity. A dark piece on a corner point plays like a chariot; dark pieces on horse, advisor, elephant, cannon, and soldier points use those matching moves.',
          },
          {
            kind: 'paragraph',
            text:
              'The normal restrictions still apply to that first move: horse legs, elephant eyes, cannon screens, palace limits for advisor points, and the river limit for elephant points. Once the move resolves, the piece flips face-up for both players.',
          },
          {
            kind: 'raw-svg',
            svg: JIEQI_REVEAL_PAIR,
          },
        ],
      },
      {
        heading: 'Revealed pieces use identity',
        blocks: [
          {
            kind: 'paragraph',
            text:
              "After reveal, use the piece's identity from its current point. Advisors may leave the palace, and elephants may cross the river. Their movement shapes do not change: advisors step one point diagonally; elephants move two points diagonally and are still eye-blocked.",
          },
          {
            kind: 'paragraph',
            text:
              'Horses, chariots, and cannons move normally. Soldiers use the normal river rule from wherever they reveal: forward only before crossing, forward or sideways after crossing, never backward.',
          },
          {
            kind: 'raw-svg',
            svg: JIEQI_REVEALED_FREEDOMS,
          },
        ],
      },
      {
        heading: 'Captured dark pieces',
        blocks: [
          {
            kind: 'paragraph',
            text:
              'If a dark piece is captured before revealing, only the capturer learns what it was. The owner sees one dark piece leave the board, but not its identity. Later, the capturer can rule out that hidden identity elsewhere.',
          },
          {
            kind: 'raw-svg',
            svg: JIEQI_CAPTURE_PRIVACY,
          },
          {
            kind: 'paragraph',
            text:
              'Mistboard uses capturer-only reveal: the player who takes a dark piece learns its identity, while the former owner does not.',
          },
        ],
      },
      {
        heading: 'Checks, wins, and draws',
        blocks: [
          {
            kind: 'paragraph',
            text:
              "Every occupied point is visible, so players can see when a general is attacked. An unmoved dark piece attacks using its starting point's role. Once it moves, it reveals immediately, and any attack from the destination uses its revealed identity.",
          },
          {
            kind: 'paragraph',
            text:
              'Normal check rules apply: a move may not leave your own general attacked, and a player in check must answer the threat. You win by checkmate or by leaving the opponent with no legal move. The facing-generals rule still applies, and dark pieces block the file like any other piece.',
          },
          {
            kind: 'paragraph',
            text:
              'Mistboard automatically draws after 120 plies, or 60 moves by each player, without a capture. Repeated positions do not trigger a separate automatic draw.',
          },
        ],
      },
      {
        heading: 'A sample game',
        blocks: [
          {
            kind: 'paragraph',
            text:
              'Step through a self-play game. Dark pieces appear as colored backs and reveal their identity the first time they move. Red wins by checkmate.',
          },
          {
            kind: 'jieqi-replay',
            spec: {
              red: JIEQI_SAMPLE_GAME.red,
              black: JIEQI_SAMPLE_GAME.black,
              event: JIEQI_SAMPLE_GAME.event,
              outcome: 'Red wins by checkmate · 36 moves',
              resultText: JIEQI_SAMPLE_GAME.result,
              deal: JIEQI_SAMPLE_GAME.deal,
              moves: JIEQI_SAMPLE_GAME.moves,
            },
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
                question: 'Where can I play jieqi online?',
                answer:
                  'Here. Play vs computer starts a game against the engine at the level you choose; Challenge a friend makes an invite link. No account is needed, and finished games get a move-by-move review.',
              },
              {
                question: 'Is there a jieqi app?',
                answer:
                  'There is nothing to install. Mistboard runs in the browser on a phone, tablet, or desktop.',
              },
              {
                question: 'Can I play jieqi against an AI?',
                answer:
                  'Yes, at eight levels. The engine is a Pikafish build patched for jieqi rules. It is strong but beatable by a strong human, mainly because jieqi has no good neural network yet (we trained one and it never beat the hand-written evaluation), and it cannot see your hidden pieces: it gets the same face-down board you do and is never told the deal.',
              },
              {
                question: 'How is jieqi different from xiangqi?',
                answer:
                  'Same board, same pieces, same checkmate goal. Every piece except the general starts face-down and shuffled, moves once as the piece that normally starts on its point, then flips and plays as itself. Revealed advisors may leave the palace and revealed elephants may cross the river.',
              },
              {
                question: 'Can a revealed advisor leave the palace, and can an elephant cross the river?',
                answer:
                  'Both, yes. After revealing, a piece plays by its identity from wherever it stands, so an advisor that revealed on a chariot point is an advisor anywhere on the board. The movement shapes do not change: advisors still step one point diagonally and elephants still move two, still blocked at the eye.',
              },
              {
                question: 'What happens when a dark piece is captured?',
                answer:
                  'On Mistboard only the capturer learns what it was. The owner sees a dark piece leave the board and nothing else, so the capturer can rule that identity out elsewhere and the owner cannot.',
              },
              {
                question: 'Any tips for jieqi?',
                answer:
                  'A dark piece is a one-shot option: on a chariot point it is a chariot for exactly one move, then whatever it really is. Do not spend that move on a cheap job. Strong players push a soldier before flipping the cannon, race to reveal a real chariot, and stop flipping once three major pieces are out. None of it has been measured; the openings article on this site lays out the argument with sources.',
              },
            ],
          },
        ],
      },
      playClosing({
        heading: 'Play on Mistboard',
        lead: 'Jieqi is playable on Mistboard. Play against an engine or challenge a friend. No account required.',
        playLabel: 'Play vs computer',
        playHref: '/?play=computer&gameSpecId=jieqi',
        secondary: [
          { label: 'Challenge a friend', href: '/?play=friend&gameSpecId=jieqi', emphasis: 'secondary' },
        ],
      }),
    ],
};
