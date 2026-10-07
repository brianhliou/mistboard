// The /practice catalogue: which studies appear, in which section, in what order.
//
// Hardcoded on purpose, the way lila keeps `PracticeSections.scala` as a literal
// list of 32 study ids. A practice index is an EDITORIAL LADDER, not a directory:
// the order is a teaching order, and "every public study with the practice flag"
// would produce a pile rather than a curriculum. The cost is that changing the
// catalogue is a deploy; lichess took that trade knowingly and so do we.
//
// Studies are named by SLUG (migration 132), never by generated id or by name. A
// re-seed changes ids and a rename changes names; either would silently empty a
// section, which is the failure mode a curated page can least afford.
//
// Lives in @mistboard/game so the server (resolving slugs) and the web client
// (rendering cards) read the same list, rather than two copies drifting apart.

import { XIANGQI_ENDGAME_PRACTICE_SLUG } from './xiangqi-endgame-practice.js';

export interface PracticeCard {
  /** Matches `studies.slug`. */
  slug: string;
  /** Card title, the fallback when the study has no name of its own; the card
   *  normally shows the study's name, which is what the page it opens is called. */
  title: string;
  /** The subtitle under the title, in lichess's manner ("It moves in straight
   *  lines", "Pin it to win it"): a few words, never a sentence, short enough to
   *  stay on one line beside the icon at desktop width. The study's own
   *  description is the long form and stays on the study page. Localized in the
   *  web app by slug (practice-index.ts); this is the English. */
  blurb: string;
}

export interface PracticeSection {
  id: string;
  title: string;
  cards: PracticeCard[];
}

/**
 * Section order is the teaching order.
 *
 * Endgames lead, which is a deliberate divergence from lichess. Theirs opens on
 * checkmates and tactics because that is how Western chess pedagogy is
 * sequenced; xiangqi's tradition is 残局-led, and the basic endgame verdicts are
 * the material an English-language learner has the least access to elsewhere.
 */
export const PRACTICE_SECTIONS: readonly PracticeSection[] = [
  {
    id: 'endgames',
    title: 'Basic endgames',
    cards: [
      // The 26 graded results of the 象棋残局 article in one set, wins before
      // draws (packages/game xiangqi-endgame-practice.ts). First because it is
      // the survey; the piece-family sets after it go deeper on each.
      {
        slug: XIANGQI_ENDGAME_PRACTICE_SLUG,
        title: 'Endgame wins and draws',
        blurb: 'Win them, then hold them',
      },
      {
        slug: 'endgames-soldier',
        title: 'Soldier endgames',
        blurb: 'It never moves back',
      },
      {
        slug: 'endgames-chariot',
        title: 'Chariot endgames',
        blurb: 'Wins on its own',
      },
      {
        slug: 'endgames-horse',
        title: 'Horse endgames',
        blurb: 'Mind the blocked leg',
      },
      {
        slug: 'endgames-cannon',
        title: 'Cannon endgames',
        blurb: 'Needs a screen',
      },
      {
        slug: 'endgames-insufficient',
        title: 'Not enough to win',
        blurb: 'Hold the draw',
      },
    ],
  },
];

/** Every slug the catalogue references, for a single resolving query. */
export function practiceCatalogSlugs(): string[] {
  return PRACTICE_SECTIONS.flatMap((section) => section.cards.map((card) => card.slug));
}
