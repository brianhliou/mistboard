// Figures and code excerpts for the puzzle-mining explainer.
//
// Every worked position moved to an xq-replay stepper on 2026-09-02, so the
// hand-built board states and their renderers are gone: one widget the reader
// steps through beats a pair of static boards, and a stepper takes its position
// from a startFen rather than a board literal here. What is left is the two
// things a stepper cannot show, the gate as an ordered list and the source
// excerpts.

// ── Code excerpts for the article ────────────────────────────────────────────
//
// Condensed from the real source: types dropped, option names inlined, comments
// rewritten for a reader who has not seen the file. The control flow and every
// threshold are as they run. Same treatment as the fog article's kernel excerpt.

export const PM_SCAN_LOOP = `// packages/game/src/puzzles-xiangqi-mining.ts (condensed)

// scans[i] is the engine's best score at the position BEFORE move i, from the
// point of view of whoever is to move there. That one array is enough to
// judge every move in the game: the value of the move played from
// position i is -scans[i + 1], because position i + 1 is the same position
// scored by the opponent. One search per position, not two.

for (let ply = minPly; ply < moveCount; ply += 1) {
  const pre = scans[ply];       // the best that was available
  const post = scans[ply + 1];  // what they left behind, opponent's view
  if (pre === null || post === null) continue;

  if (Math.abs(pre) >= decidedCp) continue;  // already decided: no tactic
  if (post < winCp) continue;                // solver must end up winning

  const playedCp = -post;                    // the move, in their own terms
  const swing = pre - playedCp;
  if (swing < swingCp) continue;             // a mistake, but a small one

  candidates.push({ ply, swingCp: swing, preBestCp: pre, postBestCp: post });
}`;

export const PM_UNIQUENESS_GATE = `// packages/game/src/puzzles-xiangqi-mining.ts (condensed)

const winRate = (cp) => 1 / (1 + 10 ** (-cp / 400));

// Is this solver move THE answer, or merely a good one? Every branch that
// returns unique:false is a reason a real blunder failed to become a puzzle.

function classifySolverMove(best, second) {
  if (!best) return { unique: false, reason: 'missing-best' };

  // Mate saturates both centipawns and win%, so mates get their own rule:
  // unique only when no other move mates at all, however slowly. A mate in
  // one is the exception: the trainer accepts any move that mates on the spot.
  if (mates(best)) {
    if (best.mate === 1) return { unique: true, reason: 'mate-in-one' };
    if (!second || !mates(second))
      return { unique: true, reason: 'only-mate' };
    return { unique: false, reason: 'mate-not-unique' };
  }

  if (winRate(best.scoreCp) < 0.8)
    return { unique: false, reason: 'best-not-winning' };
  if (!second) return { unique: true, reason: 'only-move' };
  if (mates(second)) return { unique: false, reason: 'runner-up-mates' };

  const gapCp = best.scoreCp - second.scoreCp;
  if (gapCp < 200) return { unique: false, reason: 'near-tie' };

  // The runner-up is wrong if it gives the win away outright...
  if (winRate(second.scoreCp) <= 0.6)
    return { unique: true, reason: 'runner-up-loses-win' };
  // ...or if it still wins, but wins a whole piece less.
  if (gapCp >= 250) return { unique: true, reason: 'material-gap' };

  return { unique: false, reason: 'alternative-still-good' };
}`;

// The gate, drawn as the ordered list of tests it is. Green dots pass a move,
// grey ones reject it, and the label on the right is the reason string stored
// on the candidate, so this figure and the funnel table use one vocabulary.
export const PM_GATE_LADDER = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 656 354" width="656" height="354" role="img" aria-label="The uniqueness gate as an ordered list of tests, each with the verdict it produces"><text x="0" y="16" font-family="Roboto, system-ui, sans-serif" font-size="11.5" font-weight="700" fill="var(--site-muted, #79766f)" letter-spacing="1.2">THE GATE, IN EVALUATION ORDER</text><circle cx="26" cy="48" r="6" fill="var(--site-accent, #2f7d62)"/><path d="M26 54 L26 82" stroke="var(--site-border, #d8d5cf)" stroke-width="2" fill="none"/><text x="44" y="52" font-family="Roboto, system-ui, sans-serif" font-size="12.5" fill="var(--site-text, #4d4a47)">best mates in one, or no other move mates</text><text x="656" y="52" text-anchor="end" font-family="Roboto, system-ui, sans-serif" font-size="12" font-weight="700" fill="var(--site-accent, #2f7d62)">only-mate</text><text x="506" y="52" text-anchor="end" font-family="Roboto, system-ui, sans-serif" font-size="10.5" fill="var(--site-muted, #79766f)">unique</text><circle cx="26" cy="88" r="6" fill="var(--site-muted, #79766f)"/><path d="M26 94 L26 122" stroke="var(--site-border, #d8d5cf)" stroke-width="2" fill="none"/><text x="44" y="92" font-family="Roboto, system-ui, sans-serif" font-size="12.5" fill="var(--site-text, #4d4a47)">win%(best) below 0.8</text><text x="656" y="92" text-anchor="end" font-family="Roboto, system-ui, sans-serif" font-size="12" font-weight="700" fill="var(--site-muted, #79766f)">best-not-winning</text><text x="506" y="92" text-anchor="end" font-family="Roboto, system-ui, sans-serif" font-size="10.5" fill="var(--site-muted, #79766f)">rejected</text><circle cx="26" cy="128" r="6" fill="var(--site-accent, #2f7d62)"/><path d="M26 134 L26 162" stroke="var(--site-border, #d8d5cf)" stroke-width="2" fill="none"/><text x="44" y="132" font-family="Roboto, system-ui, sans-serif" font-size="12.5" fill="var(--site-text, #4d4a47)">no second move exists</text><text x="656" y="132" text-anchor="end" font-family="Roboto, system-ui, sans-serif" font-size="12" font-weight="700" fill="var(--site-accent, #2f7d62)">only-move</text><text x="506" y="132" text-anchor="end" font-family="Roboto, system-ui, sans-serif" font-size="10.5" fill="var(--site-muted, #79766f)">unique</text><circle cx="26" cy="168" r="6" fill="var(--site-muted, #79766f)"/><path d="M26 174 L26 202" stroke="var(--site-border, #d8d5cf)" stroke-width="2" fill="none"/><text x="44" y="172" font-family="Roboto, system-ui, sans-serif" font-size="12.5" fill="var(--site-text, #4d4a47)">second move mates</text><text x="656" y="172" text-anchor="end" font-family="Roboto, system-ui, sans-serif" font-size="12" font-weight="700" fill="var(--site-muted, #79766f)">runner-up-mates</text><text x="506" y="172" text-anchor="end" font-family="Roboto, system-ui, sans-serif" font-size="10.5" fill="var(--site-muted, #79766f)">rejected</text><circle cx="26" cy="208" r="6" fill="var(--site-muted, #79766f)"/><path d="M26 214 L26 242" stroke="var(--site-border, #d8d5cf)" stroke-width="2" fill="none"/><text x="44" y="212" font-family="Roboto, system-ui, sans-serif" font-size="12.5" fill="var(--site-text, #4d4a47)">gap below 200cp</text><text x="656" y="212" text-anchor="end" font-family="Roboto, system-ui, sans-serif" font-size="12" font-weight="700" fill="var(--site-muted, #79766f)">near-tie</text><text x="506" y="212" text-anchor="end" font-family="Roboto, system-ui, sans-serif" font-size="10.5" fill="var(--site-muted, #79766f)">rejected</text><circle cx="26" cy="248" r="6" fill="var(--site-accent, #2f7d62)"/><path d="M26 254 L26 282" stroke="var(--site-border, #d8d5cf)" stroke-width="2" fill="none"/><text x="44" y="252" font-family="Roboto, system-ui, sans-serif" font-size="12.5" fill="var(--site-text, #4d4a47)">win%(second) at or below 0.6</text><text x="656" y="252" text-anchor="end" font-family="Roboto, system-ui, sans-serif" font-size="12" font-weight="700" fill="var(--site-accent, #2f7d62)">runner-up-loses-win</text><text x="506" y="252" text-anchor="end" font-family="Roboto, system-ui, sans-serif" font-size="10.5" fill="var(--site-muted, #79766f)">unique</text><circle cx="26" cy="288" r="6" fill="var(--site-accent, #2f7d62)"/><path d="M26 294 L26 322" stroke="var(--site-border, #d8d5cf)" stroke-width="2" fill="none"/><text x="44" y="292" font-family="Roboto, system-ui, sans-serif" font-size="12.5" fill="var(--site-text, #4d4a47)">gap of 250cp or more</text><text x="656" y="292" text-anchor="end" font-family="Roboto, system-ui, sans-serif" font-size="12" font-weight="700" fill="var(--site-accent, #2f7d62)">material-gap</text><text x="506" y="292" text-anchor="end" font-family="Roboto, system-ui, sans-serif" font-size="10.5" fill="var(--site-muted, #79766f)">unique</text><circle cx="26" cy="328" r="6" fill="var(--site-muted, #79766f)"/><text x="44" y="332" font-family="Roboto, system-ui, sans-serif" font-size="12.5" fill="var(--site-text, #4d4a47)">anything left over</text><text x="656" y="332" text-anchor="end" font-family="Roboto, system-ui, sans-serif" font-size="12" font-weight="700" fill="var(--site-muted, #79766f)">alternative-still-good</text><text x="506" y="332" text-anchor="end" font-family="Roboto, system-ui, sans-serif" font-size="10.5" fill="var(--site-muted, #79766f)">rejected</text></svg>`;

// Why the explore draw is banded. Bands are to scale against the real corpus
// range; an unbanded draw is the whole axis.
