// Xiangqi Learn — Stage: perpetual check and chasing (长将与长捉). Four
// scripted DEMO walk-throughs, not drills: black is the aggressor, the player
// (red) plays the scripted defending moves. The one takeaway: repeating the
// same checks or the same chase forever is FORBIDDEN in xiangqi, and it is the
// AGGRESSOR who loses (the opposite of chess, where perpetual check draws).
// All levels are opponent-first scenarios (FEN gives black the move, explicit
// color: 'red'), relaxed rules, success = scenarioComplete, nextButton so the
// student reads the verdict instead of being whisked away.

import { scenarioComplete } from '../learn-assert.js';
import { arrow, circle, type LearnLevelPartial } from '../learn-types.js';

const scriptedDemos: LearnLevelPartial[] = [
  {
    // Perpetual CHECK with a chariot: check on rank 1, dodge up, check on
    // rank 2, dodge back. Two full cycles; black gets nowhere.
    goal: 'learn.xiangqi.perpetual.goal.1',
    fen: '3k5/9/9/9/9/9/9/9/r8/4K4 b',
    color: 'red',
    nbMoves: 4,
    shapes: [circle('a2', 'red')],
    scenario: [
      {
        move: { from: 'a2', to: 'a1' },
        shapes: [arrow('a1', 'e1', 'red'), arrow('e1', 'e2', 'green')],
      },
      { from: 'e1', to: 'e2' },
      {
        move: { from: 'a1', to: 'a2' },
        shapes: [arrow('a2', 'e2', 'red'), arrow('e2', 'e1', 'green')],
      },
      { from: 'e2', to: 'e1' },
      { move: { from: 'a2', to: 'a1' }, shapes: [arrow('e1', 'e2', 'green')] },
      { from: 'e1', to: 'e2' },
      { move: { from: 'a1', to: 'a2' }, shapes: [arrow('e2', 'e1', 'green')] },
      { from: 'e2', to: 'e1' },
    ],
    success: scenarioComplete,
    detectCapture: false,
    nextButton: true,
  },
  {
    // Perpetual check with a cannon: different geometry (screens on d3 and
    // e3), same verdict. The general shuffles e1/d1 while the cannon shuffles
    // e6/d6 behind the screens.
    goal: 'learn.xiangqi.perpetual.goal.2',
    fen: '4k4/9/9/9/7c1/9/9/3NB4/9/4K4 b',
    color: 'red',
    nbMoves: 4,
    shapes: [circle('e3', 'blue'), circle('d3', 'blue')],
    scenario: [
      {
        move: { from: 'h6', to: 'e6' },
        shapes: [arrow('e6', 'e1', 'red'), arrow('e1', 'd1', 'green')],
      },
      { from: 'e1', to: 'd1' },
      {
        move: { from: 'e6', to: 'd6' },
        shapes: [arrow('d6', 'd1', 'red'), arrow('d1', 'e1', 'green')],
      },
      { from: 'd1', to: 'e1' },
      { move: { from: 'd6', to: 'e6' }, shapes: [arrow('e1', 'd1', 'green')] },
      { from: 'e1', to: 'd1' },
      { move: { from: 'e6', to: 'd6' }, shapes: [arrow('d1', 'e1', 'green')] },
      { from: 'd1', to: 'e1' },
    ],
    success: scenarioComplete,
    detectCapture: false,
    nextButton: true,
  },
  {
    // Perpetual CHASE (长捉): the black chariot hounds your unprotected horse
    // from square to square. The horse hops g4/e3; the chariot follows for
    // two cycles. Endless chasing is forbidden just like endless checking.
    // The red general sits on f1, off both files the chariot uses: on e1 the
    // e8 chariot PINNED the e3 horse and the scripted hop back to g4 was a
    // self-check (relaxed rules let it through until 2026-09-22).
    goal: 'learn.xiangqi.perpetual.goal.3',
    fen: '3k5/9/1r7/9/9/9/6N2/9/9/5K3 b',
    color: 'red',
    nbMoves: 4,
    shapes: [circle('g4', 'yellow')],
    scenario: [
      {
        move: { from: 'b8', to: 'g8' },
        shapes: [arrow('g8', 'g4', 'red'), arrow('g4', 'e3', 'green')],
      },
      { from: 'g4', to: 'e3' },
      {
        move: { from: 'g8', to: 'e8' },
        shapes: [arrow('e8', 'e3', 'red'), arrow('e3', 'g4', 'green')],
      },
      { from: 'e3', to: 'g4' },
      { move: { from: 'e8', to: 'g8' }, shapes: [arrow('g4', 'e3', 'green')] },
      { from: 'g4', to: 'e3' },
      { move: { from: 'g8', to: 'e8' }, shapes: [arrow('e3', 'g4', 'green')] },
      { from: 'e3', to: 'g4' },
    ],
    success: scenarioComplete,
    detectCapture: false,
    nextButton: true,
  },
  {
    // The resolution: same shape as level 1, but your chariot has a capture
    // waiting on f8 the whole time. Black checks twice, may not repeat
    // forever, backs the chariot off, and you collect the horse. This is WHY
    // the rule exists: the defender holds firm, the aggressor must back down.
    goal: 'learn.xiangqi.perpetual.goal.4',
    fen: '3k5/9/5n2R/9/9/9/9/9/r8/4K4 b',
    color: 'red',
    nbMoves: 3,
    shapes: [arrow('i8', 'f8', 'yellow')],
    scenario: [
      {
        move: { from: 'a2', to: 'a1' },
        shapes: [arrow('a1', 'e1', 'red'), arrow('i8', 'f8', 'yellow'), arrow('e1', 'e2', 'green')],
      },
      { from: 'e1', to: 'e2' },
      {
        move: { from: 'a1', to: 'a2' },
        shapes: [arrow('a2', 'e2', 'red'), arrow('e2', 'e1', 'green')],
      },
      { from: 'e2', to: 'e1' },
      {
        move: { from: 'a2', to: 'a9' },
        shapes: [circle('a9', 'yellow'), arrow('i8', 'f8', 'green')],
      },
      { from: 'i8', to: 'f8' },
    ],
    success: scenarioComplete,
    detectCapture: false,
    nextButton: true,
  },
];

// forcedReplies off stage-wide: these are rules DEMOS of black CHOOSING to
// repeat checks and chases (the whole point is that black could stop but
// does not); no forced-sequence claim is made.
const levels: LearnLevelPartial[] = scriptedDemos.map((level) => ({
  forcedReplies: false,
  ...level,
}));

export const perpetualStage = {
  key: 'perpetual',
  title: 'learn.xiangqi.perpetual.title',
  subtitle: 'learn.xiangqi.perpetual.subtitle',
  intro: 'learn.xiangqi.perpetual.intro',
  complete: 'learn.xiangqi.perpetual.complete',
  illustration: { glyph: '禁' },
  copy: {
    'learn.xiangqi.perpetual.title': 'Perpetual check and chasing',
    'learn.xiangqi.perpetual.subtitle': 'Repetition loses the game',
    'learn.xiangqi.perpetual.intro':
      'In chess, checking forever is a draw. Xiangqi says no. Repeating the same checks, or endlessly chasing the same piece, is illegal: the attacker must vary or the attacker loses. Watch black try it, and hold your ground.',
    'learn.xiangqi.perpetual.complete':
      'Remember this well: in xiangqi, perpetual check and perpetual chase LOSE for the attacker. When someone checks you forever, hold firm. The rules are on your side.',
    'learn.xiangqi.perpetual.goal.1':
      'Black checks, you step aside. Black checks again, you step back. Stay calm and follow the green arrows: repeating the same check forever is illegal in xiangqi. Black must vary or black loses the game.',
    'learn.xiangqi.perpetual.goal.2':
      'A cannon can nag too, jumping your own screens to check you. Shuffle between e1 and d1 while black repeats the same two checks. Same verdict: black must break the loop or lose.',
    'learn.xiangqi.perpetual.goal.3':
      'Now black chases your unprotected horse instead. Hop between g4 and e3 while the chariot follows. Chasing a piece forever is forbidden just like checking forever: the chaser must stop or lose.',
    'learn.xiangqi.perpetual.goal.4':
      'The payoff. Your chariot has wanted that horse all along, but the checks kept you busy. Black may not repeat forever, so black must back down. Dodge twice, then take the horse!',
  },
  levels,
};
