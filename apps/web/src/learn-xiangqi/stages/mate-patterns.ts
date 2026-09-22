// Xiangqi Learn — Stage: classic mate patterns (基本杀法). Nine scripted
// strict-mode scenarios, one canonical pattern each: 双车错 (alternating
// chariots), 马后炮 (cannon behind the horse), 卧槽马 (stable horse), 重炮
// (doubled cannons), 铁门栓 (iron bolt), 小刀剜心 (soldier heart-carve),
// 钓鱼马 (fishing horse), 二鬼拍门 (two ghosts pound the gates), and the
// 大胆穿心 chariot-sacrifice capstone. Every level scripts black's most
// natural defense between the player's moves and ends in a kernel-verified
// checkmate (success: mate('red')). Shapes on black's reply steps hint the
// player's next move. Levels 7-9 complete the blessed learn-capstone tier
// of named kills from docs-private/learn-motif-corpus.md.

import { mate } from '../learn-assert.js';
import { arrow, circle, type LearnLevelPartial } from '../learn-types.js';

const levels: LearnLevelPartial[] = [
  {
    // 双车错: check on the top rank forces the general down; the second
    // chariot cuts the next rank. Black's lone general is forced throughout.
    goal: 'learn.xiangqi.matePatterns.goal.1',
    fen: '4k4/R8/1R1P5/9/9/9/9/9/9/3K5 w',
    nbMoves: 2,
    rules: 'strict',
    detectCapture: false,
    success: mate('red'),
    shapes: [arrow('a9', 'a10')],
    scenario: [
      { from: 'a9', to: 'a10' },
      { move: { from: 'e10', to: 'e9' }, shapes: [arrow('b8', 'b9', 'green')] },
      { from: 'b8', to: 'b9' },
    ],
  },
  {
    // 马后炮: the horse posts at e8, guarding BOTH corner points d10/f10 over
    // the empty e9 leg, then the cannon lines up behind it; the horse is the
    // screen. Forced: the d9 soldier covers d10 and e9, so after the horse
    // lands the black king has zero moves and the a7 soldier push is black's
    // only legal move (own-half soldier: forward only).
    goal: 'learn.xiangqi.matePatterns.goal.2',
    fen: '4k4/3P5/9/p5N2/9/9/9/7C1/9/3K5 w',
    nbMoves: 2,
    rules: 'strict',
    detectCapture: false,
    success: mate('red'),
    shapes: [arrow('g7', 'e8'), circle('e8', 'blue')],
    scenario: [
      { from: 'g7', to: 'e8' },
      { move: { from: 'a7', to: 'a6' }, shapes: [arrow('h3', 'e3', 'green')] },
      { from: 'h3', to: 'e3' },
    ],
  },
  {
    // 卧槽马: the horse leaps to the trough point c9, the point one rank in
    // front of black's bottom elephant (底象前一线, zh.wikipedia 卧槽马; WB:
    // 2nd rank from the edge, 3rd file), checking the general on its home
    // point e10. Until 2026-09-22 this level put the horse on c8, which is the
    // 钓鱼马 post L7 teaches (the enemy's 屏风马 square), under the 卧槽 name.
    // Own advisors on f10 and e9 leave d10 as the only flight; the soldier on
    // d8 then covers d9 and the chariot lifts to a10 for the back-rank mate.
    goal: 'learn.xiangqi.matePatterns.goal.3',
    fen: '4ka3/4a4/3P5/1N7/9/9/9/9/R8/4K4 w',
    nbMoves: 2,
    rules: 'strict',
    detectCapture: false,
    success: mate('red'),
    shapes: [arrow('b7', 'c9'), circle('c9', 'blue')],
    scenario: [
      { from: 'b7', to: 'c9' },
      { move: { from: 'e10', to: 'd10' }, shapes: [arrow('a2', 'a10', 'green')] },
      { from: 'a2', to: 'a10' },
    ],
  },
  {
    // 重炮: the rear cannon stacks behind the front one WITH check, and the
    // stacked pair seals the middle file for good (e9 and e10 both die on the
    // rear cannon's line through the front screen). Forced: e9 is
    // cannon-covered, f10 is flying-general illegal (red king f1, open
    // f-file), so the king's ONLY reply is d10; then the soldier knocks him
    // out, protected by the home chariot the instant it steps off d8.
    goal: 'learn.xiangqi.matePatterns.goal.4',
    fen: '4k4/9/3P5/9/9/4C4/9/7C1/9/3R1K3 w',
    nbMoves: 2,
    rules: 'strict',
    detectCapture: false,
    success: mate('red'),
    shapes: [arrow('h3', 'e3'), circle('e5', 'blue')],
    scenario: [
      { from: 'h3', to: 'e3' },
      { move: { from: 'e10', to: 'd10' }, shapes: [arrow('d8', 'd9', 'green')] },
      { from: 'd8', to: 'd9' },
    ],
  },
  {
    // 铁门栓: the center cannon freezes the WHOLE shell: the e9 advisor and
    // e8 elephant are double screens (either one moving bares the general to
    // the cannon, so both are pinned; that pin also bars them from ever
    // blocking the back rank), and the king is walled in (e9 own advisor,
    // d10 covered by the b9 horse, f10 flying-general illegal against the
    // red king on f1). Black's only legal move is the g7 soldier push; then
    // the chariot slams the back rank. d10 must stay EMPTY: a black piece
    // there would block the mating ray from a10.
    goal: 'learn.xiangqi.matePatterns.goal.5',
    fen: '4k4/1N2a4/R3b4/6p2/9/9/7C1/9/9/5K3 w',
    nbMoves: 2,
    rules: 'strict',
    detectCapture: false,
    success: mate('red'),
    shapes: [arrow('h4', 'e4'), circle('e9', 'red'), circle('e8', 'red')],
    scenario: [
      { from: 'h4', to: 'e4' },
      { move: { from: 'g7', to: 'g6' }, shapes: [arrow('a8', 'a10', 'green')] },
      { from: 'a8', to: 'a10' },
    ],
  },
  {
    // 小刀剜心: the soldier takes the CENTER advisor on the palace heart e9.
    // The other advisor must swallow the blade (only legal reply: the king
    // cannot recapture into the c8 horse and a9 chariot, cannot reach d10
    // past its own advisor, and f10 is covered by the g8 horse), and the
    // chariot carves the heart a second time: Rxe9 is mate, with d10 and f10
    // both horse-covered and the chariot itself guarded by the c8 horse.
    goal: 'learn.xiangqi.matePatterns.goal.6',
    fen: '3ak4/R3a4/2N1P1N2/8p/9/9/9/9/9/4K4 w',
    nbMoves: 2,
    rules: 'strict',
    detectCapture: false,
    success: mate('red'),
    shapes: [arrow('e8', 'e9'), circle('e9', 'red')],
    scenario: [
      { from: 'e8', to: 'e9' },
      { move: { from: 'd10', to: 'e9' }, shapes: [arrow('a9', 'e9', 'green')] },
      { from: 'a9', to: 'e9' },
    ],
  },
  {
    // 钓鱼马: the horse takes the fishing post g8, hooking the e9 flight
    // square (over the empty f8 leg) and covering f10. The chariot lift is
    // then mate: d10 and f10 die on the extended rank-10 ray, e9 is hooked.
    goal: 'learn.xiangqi.matePatterns.goal.7',
    fen: '4k4/9/9/p7N/9/9/9/9/7R1/3K5 w',
    nbMoves: 2,
    rules: 'strict',
    detectCapture: false,
    success: mate('red'),
    shapes: [arrow('i7', 'g8'), circle('g8', 'blue')],
    scenario: [
      { from: 'i7', to: 'g8' },
      { move: { from: 'a7', to: 'a6' }, shapes: [arrow('h2', 'h10', 'green')] },
      { from: 'h2', to: 'h10' },
    ],
  },
  {
    // 二鬼拍门: two soldiers alone at the palace gates. The f10 ghost covers
    // e10; the d-file ghost steps in with check, and capturing it is illegal
    // because the generals would face on the emptied d-file. The soldiers'
    // only backup is the facing-generals rule itself.
    goal: 'learn.xiangqi.matePatterns.goal.8',
    fen: '3k1P3/9/9/3P4p/9/9/9/9/9/3K5 w',
    nbMoves: 2,
    rules: 'strict',
    detectCapture: false,
    success: mate('red'),
    shapes: [arrow('d7', 'd8'), circle('f10', 'blue')],
    scenario: [
      { from: 'd7', to: 'd8' },
      { move: { from: 'i7', to: 'i6' }, shapes: [arrow('d8', 'd9', 'green')] },
      { from: 'd8', to: 'd9' },
    ],
  },
  {
    // 大胆穿心 capstone: the chariot sacrifices itself on the palace-heart
    // advisor e9. The d10 advisor cannot recapture: it is pinned by the a10
    // chariot (taking would expose e10 along the rank). The king can only
    // slide to f10, whereupon the top chariot eats the pinned advisor with
    // mate: e10 is covered by the rank ray and f9 by the sacrificed-square
    // chariot. Kxe9 is illegal throughout, the generals would face.
    goal: 'learn.xiangqi.matePatterns.goal.9',
    fen: 'R2ak4/4a4/9/9/9/4R4/9/9/9/4K4 w',
    nbMoves: 2,
    rules: 'strict',
    detectCapture: false,
    success: mate('red'),
    shapes: [arrow('e5', 'e9'), circle('e9', 'red')],
    scenario: [
      { from: 'e5', to: 'e9' },
      { move: { from: 'e10', to: 'f10' }, shapes: [arrow('a10', 'd10', 'green')] },
      { from: 'a10', to: 'd10' },
    ],
  },
];

export const matePatternsStage = {
  key: 'mate-patterns',
  title: 'learn.xiangqi.matePatterns.title',
  subtitle: 'learn.xiangqi.matePatterns.subtitle',
  intro: 'learn.xiangqi.matePatterns.intro',
  complete: 'learn.xiangqi.matePatterns.complete',
  illustration: { glyph: '绝' },
  copy: {
    'learn.xiangqi.matePatterns.title': 'Mate patterns',
    'learn.xiangqi.matePatterns.subtitle': 'Nine classic winning shapes',
    'learn.xiangqi.matePatterns.intro':
      'Every winning attack ends in a known shape. These are nine classic mate patterns (基本杀法) that xiangqi players learn by name, drilled from printed manuals since the Ming dynasty, over four hundred years ago. Play each one out and remember the picture.',
    'learn.xiangqi.matePatterns.complete':
      'Well done! You can name nine classic mates, the same shapes players have studied for centuries. Strong players spot them several moves ahead. When you attack, aim for a picture you already know.',
    'learn.xiangqi.matePatterns.goal.1':
      '双车错 (shuāng jū cuò), the alternating chariots: check with one chariot to drive the general down, then mate with the other on the next line.',
    'learn.xiangqi.matePatterns.goal.2':
      '马后炮 (mǎ hòu pào), cannon behind the horse: the horse guards the corner points and becomes the screen. Jump in, then line the cannon up behind it.',
    'learn.xiangqi.matePatterns.goal.3':
      '卧槽马 (wòcáo mǎ), the stable horse: from the point beside the palace the horse checks and guards the escape. Leap in, then finish with the chariot.',
    'learn.xiangqi.matePatterns.goal.4':
      '重炮 (chóng pào), the doubled cannons: stack them on the middle file with check. The front one is the screen, the rear one strikes, and together they seal the file forever. The general flees aside, and your soldier knocks.',
    'learn.xiangqi.matePatterns.goal.5':
      '铁门栓 (tiěménshuān), the iron bolt: your center cannon pins the defenders shut, they cannot move or block. Slam the chariot onto the back rank.',
    'learn.xiangqi.matePatterns.goal.6':
      '小刀剜心 (xiǎodāo wān xīn), the little blade carves the heart: your soldier takes the center advisor. The other advisor must swallow the blade, and your chariot carves the heart again.',
    'learn.xiangqi.matePatterns.goal.7':
      '钓鱼马 (diàoyú mǎ), the fishing horse: from its post the horse hooks the escape square like a fisherman holding his line. Set the hook, then strike with the chariot.',
    'learn.xiangqi.matePatterns.goal.8':
      '二鬼拍门 (èr guǐ pāi mén), two ghosts pound the gates: two soldiers alone at the palace doors. The king cannot even eat one: your general glares down the open file behind it.',
    'learn.xiangqi.matePatterns.goal.9':
      '大胆穿心 (dàdǎn chuānxīn), boldly pierce the heart: sacrifice your chariot on the center advisor and the palace collapses. The other advisor is pinned and cannot take revenge.',
  },
  levels,
};
