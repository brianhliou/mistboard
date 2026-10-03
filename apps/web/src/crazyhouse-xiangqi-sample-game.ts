// The Crazyhouse Xiangqi rules page's sample game, shared by its replay block
// and the intro diagram (its final position), so the two cannot disagree.
//
// Fairy-Stockfish against itself under the shipped rules (lab name
// `s9-hand-free-check`, flattened into apps/server/src/crazyhouse-xiangqi.ini),
// `go movetime 5000`, the first six plies sampled from moves within 30cp of
// best. Game 15 of the sixteen in
// docs-private/drop-game-lab/fullboard/games/s9-hand-free-check-strong.json.
// Red mates on move 49 with a soldier dropped on e9.
//
// Fairy-Stockfish's coordinates (ranks 1-10, Red's back rank at 1; drops as
// `B@a10`, B = elephant), which crazyhouseXiangqiMoveFromUci reads. The replay
// throws on an illegal token, and crazyhouse-xiangqi-replay.test.ts pins the
// result, so a rules change that breaks this game fails a test.
export const CRAZYHOUSE_XIANGQI_SAMPLE_GAME_MOVES = [
  'b1d2 h10g8 h1g3 b10c8 i1f1 a10d10 A@e3 b8b6 a1d1 A@e8 A@d4 b6d6',
  'g4g5 i10f10 f1f10 g8f10 R@f1 A@f7 g3f5 d6d5 h3f3 d5g5 f1g1 g7g6',
  'B@i3 g5h5 b3d3 P@d5 d4c3 d5e5 c3d4 e5d5 d1b1 f10g8 b1b8 B@a10',
  'f3f1 R@h2 b8b9 h8i8 f5e7 c8e7 d3d5 N@e9 d5e5 i8i4 B@e2 h5f5',
  'P@g7 P@d5 g7f7 e7c8 e5e6 i4i6 e6i6 d5d4 f7f8 A@d9 f8g8 e9g8',
  'C@e6 c8e7 e3d4 P@f2 f1f5 f2e2 e6e2 e7f5 A@g2 h2h9 g1f1 i7i6',
  'f1f5 B@f6 N@f8 h9f9 P@f10 g8f10 C@g10 e10e9 N@c8 C@d8 c8d10 P@d1',
  'e1d1 B@c9 b9c9 C@d3 d1e1 d3e3 d4e3 f9g9 R@e10 e9f9 e10e8 d8d10',
  'P@e9',
].join(' ');
