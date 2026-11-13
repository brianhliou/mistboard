import { XIANGQI_CC0_NET_URL } from '../../engine-credits.js';
import type { Locale } from '../../i18n/locale.js';
import { textCard } from '../text-card.js';
import type { Article } from '../types.js';
import numbersJson from './xiangqi-nnue-training-numbers.json' with { type: 'json' };

// The xiangqi own-net engineering post (S2). Every number below is read from
// xiangqi-nnue-training-numbers.json, which copies the run log; the test
// recomputes each Elo from its won/drawn/lost counts and checks the prose
// quotes the record. Each match keeps its own result and interval: the scale
// section never subtracts the two Fairy-Stockfish matches (repo lesson
// de9dce1), and the heading's 55 is the direct 0.79 vs 1.70 match.
// Held back by plan: the tuner (SPSA, +0.0), ladder and title-match numbers
// (re-run after the 11-13 rule-stamp ship), any hardware-unmatched Px0 match.

export const XIANGQI_NNUE_NUMBERS = numbersJson;
const N = numbersJson;

const MINUS = '−';

/** Signed, one decimal, typographic minus: +55.0, −3.7. */
export const signed = (value: number): string =>
  value < 0 ? `${MINUS}${Math.abs(value).toFixed(1)}` : `+${value.toFixed(1)}`;

/** "+55.0 [+35.1, +75.3]" */
export const eloCell = (elo: number, lo: number, hi: number): string =>
  `${signed(elo)} [${signed(lo)}, ${signed(hi)}]`;

const count = (value: number): string => value.toLocaleString('en-US');

const bySide = <T extends { key: string }>(rows: readonly T[], key: string): T => {
  const row = rows.find((r) => r.key === key);
  if (!row) throw new Error(`xiangqi-nnue-training: no row ${key}`);
  return row;
};

const direct = bySide(N.scale.matches, 'direct');
const pxFull = bySide(N.student.arms, 'px0-full');
const screens = N.firstRound.screens;
const worstScreen = Math.round(Math.abs(Math.min(...screens)));
const bestScreen = Math.round(Math.abs(Math.max(...screens)));
const largeFull = bySide(N.recipeCheck, 'large-full');

const THUMBNAIL = (locale: Locale): string =>
  textCard(
    {
      palette: 'xiangqi',
      eyebrow: 'XIANGQI',
      lead: 'NNUE',
      tagline: 'TRAINING A NET FOR PIKAFISH',
      ariaLabel: 'A card reading NNUE, training a net for Pikafish',
    },
    locale,
  );

export const xiangqiNnueTrainingArticle: Article = {
  slug: 'xiangqi-nnue-training',
  kind: 'article',
  publisher: 'mistboard',
  topic: 'engineering',
  title: 'Training our own xiangqi net for Pikafish',
  cardTitle: 'Training our own xiangqi net',
  seoTitle: 'Fine-tuning a public-domain xiangqi NNUE net for Pikafish',
  summary:
    'We fitted Pikafish to a public-domain xiangqi net, then tried to train a stronger one with scores from Px0.',
  showSummaryOnPage: false,
  status: 'published',
  publishedAt: '2026-11-24',
  thumbnail: { kind: 'svg', svg: THUMBNAIL },
  boardFamily: 'xiangqi',
  audience: 'People who build or train xiangqi engines, and players who want to know what runs the xiangqi bot.',
  readNext: ['pikafish', 'pikafish-reveal-bug'],
  tldr: [
    `Pikafish multiplies a net's output by a scale before searching with it. Fitted to the public-domain net we run, the scale gained ${Math.round(direct.elo)} Elo.`,
    `Fine-tuning that net with settings meant for training from scratch cost ${bestScreen} to ${worstScreen} Elo. A small learning rate and a frozen first layer kept its strength.`,
    `Scores from Px0, another open engine, predicted game results better, and a net trained on them beat the original by ${pxFull.elo.toFixed(1)} Elo at ${count(100000)} nodes a move.`,
    `At one second a move the gain was ${N.gate.elo.toFixed(1)} Elo, within noise, so the site still runs the public-domain net.`,
  ],
  method: [
    'Every match plays each opening twice with colours swapped, from a fixed opening book, and reports Elo with a 95% interval.',
    `Training screens run at ${count(100000)} nodes a move; the final test ran at one second a move.`,
    `Predictions are scored by log loss on ${count(N.teacher.positions)} positions from ${N.teacher.games} games.`,
  ],
  intro: [
    {
      kind: 'paragraph',
      text: "Pikafish plays the site's xiangqi bots and analyses finished games. Like Stockfish in chess, it judges the positions it searches with a small neural network, an NNUE net.",
    },
    {
      kind: 'paragraph',
      text: `Pikafish's own nets are not licensed for commercial use, so since November 10 the site runs Pikafish with the public-domain xiangqi net from [Fairy-Stockfish](${XIANGQI_CC0_NET_URL}). We call it the CC0 net, after its licence. It was trained for a different engine, so we first fitted Pikafish to it, then tried to train a stronger net from it.`,
    },
  ],
  sections: [
    {
      heading: `The right scale was worth ${Math.round(direct.elo)} Elo`,
      blocks: [
        {
          kind: 'paragraph',
          text: `Pikafish multiplies the net's score by a scale before the search uses it. Its search margins assume the units of its own nets, so a net from another engine needs a scale of its own. Our first port used ${N.scale.provisional.toFixed(2)}. Fitted to the results of ${count(N.scale.fitGames)} Pikafish self-play games, it came out at ${N.scale.fitted.toFixed(2)}.`,
        },
        {
          kind: 'table',
          headers: ['Match', 'Per move', 'Won', 'Drawn', 'Lost', 'Elo (95%)'],
          rows: N.scale.matches.map((m) => [
            m.label,
            m.key === 'direct' ? `${count(100000)} nodes` : '1 second',
            count(m.wins),
            count(m.draws),
            count(m.losses),
            eloCell(m.elo, m.lo, m.hi),
          ]),
          keyColumn: true,
          compact: true,
          wrap: true,
          nowrapColumns: [5],
        },
        {
          kind: 'paragraph',
          text: 'In both Fairy-Stockfish matches each side ran the CC0 net, so they compare the two searches. Every Pikafish on the site now runs at the fitted scale.',
        },
        {
          kind: 'note',
          label: 'Checking the match rig',
          text: `Before trusting any result, we played the CC0 net against itself over ${count(N.rig.sameNet.pairs)} pairs of games and got ${N.rig.sameNet.elo.toFixed(1)} Elo. A copy we weakened on purpose lost ${count(N.rig.planted.losses)} of ${count(N.rig.planted.wins + N.rig.planted.draws + N.rig.planted.losses)} games.`,
        },
      ],
    },
    {
      heading: 'Fine-tuning needs gentler settings than training from scratch',
      blocks: [
        {
          kind: 'paragraph',
          text: `Fine-tuning starts from the CC0 net and trains it on positions scored by a deeper search. The first round used ${count(N.firstRound.positions / 1_000_000)} million positions, each scored by Fairy-Stockfish with the CC0 net at ${count(N.firstRound.cc0Nodes)} nodes. All five nets it produced lost ${bestScreen} to ${worstScreen} Elo against the net they started from. The trainer's defaults were set for a net that starts from random weights:`,
        },
        {
          kind: 'list',
          items: [
            `The learning rate, ${N.firstRound.learningRates.join(' and ')}, was sized for random weights.`,
            "The trainer assumed an output scale of 361. The CC0 net's own scores measure about 490, so training shrank every score it learned.",
            'Every weight was trainable, including the first layer, which holds most of the net.',
          ],
        },
        {
          kind: 'paragraph',
          text: 'To test the settings alone, we retrained the CC0 net on its own scores at the measured scale. Those scores hold nothing the net does not already know, so the best a recipe can do is keep its strength.',
        },
        {
          kind: 'table',
          headers: ['Learning rate, layers trained', 'Elo vs CC0 (95%)'],
          rows: N.recipeCheck.map((r) => [r.label, eloCell(r.elo, r.lo, r.hi)]),
          keyColumn: true,
          compact: true,
          wrap: true,
          nowrapColumns: [1],
          highlightRows: [0],
        },
        {
          kind: 'paragraph',
          text: `The small rate with the first layer frozen stayed level. The large rate on every layer lost ${Math.round(Math.abs(largeFull.elo))}.`,
        },
      ],
    },
    {
      heading: "Px0 predicted game results better than the CC0 net's search",
      blocks: [
        {
          kind: 'paragraph',
          text: `A net only gains from scores that know more than it does. [Px0](https://px0.org/) is an open-source xiangqi engine trained by self-play, which its site describes as "Xiangqi learned from scratch". Its networks are public domain ([CC0](https://github.com/official-pikafish/pxzero-networks)) and separate from Pikafish's own. Px0 runs a much larger network on a graphics card, so it is slow: about ${N.teacher.px0OneNodePerSecond} positions a second at one node on ours.`,
        },
        {
          kind: 'paragraph',
          text: `We took ${count(N.teacher.positions)} positions from ${N.teacher.games} games between Px0 and Pikafish with the CC0 net, so each source had played one side of every game. Each source's scores were turned into a win chance with its own best-fitting curve, and log loss measures how far those chances were from the results. Lower is better.`,
        },
        {
          kind: 'table',
          headers: ['Scores from', 'Nodes', 'Log loss'],
          rows: [
            ['No information (50%)', '', N.teacher.constant.toFixed(4)],
            ['Fairy-Stockfish, CC0 net', count(N.teacher.cc0Nodes), N.teacher.cc0.toFixed(4)],
            ['Px0', count(N.teacher.px0Nodes), N.teacher.px0.toFixed(4)],
            ['Px0', '1', N.teacher.px0OneNode.toFixed(4)],
          ],
          keyColumn: true,
          compact: true,
        },
        {
          kind: 'paragraph',
          text: `Even at one node, Px0 predicted the results better than a ${count(N.teacher.cc0Nodes)}-node search. Its edge came from the decisive games. In drawn games, ${Math.round(N.teacher.drawnShare * 100)}% of the positions, the two were level.`,
        },
      ],
    },
    {
      heading: "Px0's scores made a stronger net at 100,000 nodes",
      blocks: [
        {
          kind: 'paragraph',
          text: `We scored the same ${count(N.student.positions / 1_000_000)} million positions twice, once with Px0 at one node and once with the CC0 net's search, and fine-tuned four nets from CC0 with the gentler settings. Each Px0 net has a twin that differs only in its scores.`,
        },
        {
          kind: 'table',
          headers: ['Net', 'Opponent', 'Won', 'Drawn', 'Lost', 'Elo (95%)'],
          rows: [
            ...N.student.arms.map((a) => [
              a.label,
              'CC0',
              count(a.wins),
              count(a.draws),
              count(a.losses),
              eloCell(a.elo, a.lo, a.hi),
            ]),
            [
              'Px0 scores, first layer frozen',
              'Its CC0-scored twin',
              count(N.student.headToHead.wins),
              count(N.student.headToHead.draws),
              count(N.student.headToHead.losses),
              eloCell(N.student.headToHead.elo, N.student.headToHead.lo, N.student.headToHead.hi),
            ],
          ],
          keyColumn: true,
          compact: true,
          wrap: true,
          nowrapColumns: [5],
          highlightRows: [2],
        },
        {
          kind: 'paragraph',
          text: 'The Px0 net with every layer trained is the first of ours whose interval against CC0 sits above zero. The two frozen twins also played each other, and the Px0 one won.',
        },
      ],
    },
    {
      heading: `At one second a move the gain was ${N.gate.elo.toFixed(1)} Elo`,
      blocks: [
        {
          kind: 'paragraph',
          text: `The last test played that net against CC0 at one second a move, under a rule set before it began: stop once the games show a gain of ${N.gate.sprtElo1} Elo or rule it out. It stopped after ${count(N.gate.games)} games, ${count(N.gate.draws)} of them drawn, and ruled it out. The interval runs from ${signed(N.gate.lo)} to ${signed(N.gate.hi)}.`,
        },
        {
          kind: 'paragraph',
          text: `Px0's scores carry more than the CC0 net's, but ${count(N.student.positions / 1_000_000)} million of them did not turn that into strength at a real time per move. The site's Pikafish keeps the CC0 net at the fitted scale.`,
        },
        {
          kind: 'cta',
          layout: 'single-row',
          buttons: [
            { label: 'Play the xiangqi bot', href: '/?play=computer&gameSpecId=xiangqi', emphasis: 'primary' },
            { label: 'Pikafish on Mistboard', href: '/blog/pikafish', emphasis: 'secondary' },
          ],
        },
      ],
    },
  ],
};
