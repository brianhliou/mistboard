// Video theme: the class styles the board SVG relies on, inlined as a <style>
// block because frames rasterize outside the DOM (no app stylesheets). Values
// mirror live-xiangqi.css defaults; the channel look is locked here so a
// product retheme never silently changes the back catalog.

import type { XiangqiPieceSet } from '../xiangqi-piece-sets.js';

export const VIDEO_BACKGROUND = '#12161c';

/** Section titles in the gutter. Off (Brian, 2026-08-16): chapter-length
 *  sentences in an empty gutter read as a slide deck rather than a board, and
 *  YouTube chapters already give the viewer the same map. The story's `chapter`
 *  fields still drive chapter generation; this only hides them on screen. */
export const SHOW_SECTION_LABEL = false;

/** Dash pattern for the video's dashed board arrows. The product keeps its own
 *  10/8 for engine PV lines; at broadcast scale that pattern reads as dots. */
export const VIDEO_ARROW_DASH = '26 14';

/** The frozen channel piece set. Every episode renders with this, so changing it
 *  re-skins the whole back catalog on the next recompile: a branding decision,
 *  not a preference.
 *
 *  `international` (Brian, 2026-08-15), matching the product default and the
 *  channel's founding premise: the audience is people who bounced off the
 *  characters, and xiangqi.com's own beginner help recommends graphical pieces
 *  to Western learners. This reverses an earlier argument for traditional
 *  characters (that the channel's premise is that this IS Chinese chess, and
 *  that the international general reads as a cross-topped Western king). That
 *  concern is real and survives here as a note: if a piece ever reads as the
 *  wrong game, fix the glyph rather than the whole set. */
export const VIDEO_PIECE_SET: XiangqiPieceSet = 'international';

/** Board height as a fraction of the canvas. 1 = full bleed, the broadcast
 *  convention (ChessNetwork et al): make the board as large as the frame
 *  allows and let the gutters stay flat, rather than floating it in margin.
 *  A xiangqi board is 0.9:1, so even at full bleed it only reaches ~51% of a
 *  16:9 width — that gutter is geometry, not a layout mistake to fill. */
export const BOARD_HEIGHT_FILL = 1;

export const VIDEO_BOARD_STYLE = `
  .xq-live-bg { fill: #f5dca8; }
  .xq-live-line { stroke: #5a3a14; stroke-width: 1.2; }
  .xq-live-palace-band { fill: rgba(255, 255, 255, 0); }
  .xq-live-palace line { stroke: #5a3a14; stroke-width: 1.2; }
  .xq-live-river-label {
    display: block;
    fill: #5a3a14;
    font-family: 'Songti SC', 'PingFang SC', serif;
    font-size: 22px;
    font-weight: 700;
    letter-spacing: 4px;
    text-anchor: middle;
    dominant-baseline: central;
    opacity: 0.85;
  }
  .xq-live-lastmove-cell { fill: #f59e0b; opacity: 0.26; }
  .xq-live-lastmove-from { fill: #a16207; opacity: 0.34; }
  .xq-live-lastmove-ring {
    fill: none;
    stroke: #d6af4e;
    stroke-opacity: 0.8;
  }
  .xq-live-selection-cell { fill: rgba(31, 111, 91, 0.32); stroke: none; }
  .xq-live-hint-dot { fill: rgba(31, 111, 91, 0.72); opacity: 0.9; }
  .xq-live-hint-capture { fill: none; stroke: rgba(31, 111, 91, 0.48); stroke-width: 3; }
  .xqv-dim { fill: rgba(10, 8, 4, 0.42); }
  .xqv-glow-ring {
    fill: none;
    stroke: #e8b64c;
    stroke-width: 5;
  }
  .xqv-region { fill: rgba(46, 134, 222, 0.22); stroke: rgba(46, 134, 222, 0.55); stroke-width: 2; }
  .xqv-flash-ring { fill: none; stroke: #d64545; stroke-width: 5; }
  .xqv-flash-arrow { stroke: #d64545; fill: #d64545; }
  /* Dimension callout: board ink, not the move-arrow blue, so a measurement
     never reads as a move. */
  .xqv-measure-line,
  .xqv-measure-tick {
    stroke: #f5dca8;
    stroke-width: 3.5;
    stroke-linecap: round;
  }
  .xqv-measure-head { fill: #f5dca8; }
  .xqv-blocked line {
    stroke: #d64545;
    stroke-width: 6;
    stroke-linecap: round;
  }
  .xqv-blocked-disc { fill: rgba(18, 22, 28, 0.55); }
  .xqv-measure-plate { fill: rgba(18, 22, 28, 0.92); }
  .xqv-measure-label {
    fill: #f5dca8;
    font-family: Helvetica, Arial, sans-serif;
    font-size: 19px;
    font-weight: 700;
    letter-spacing: 0.5px;
  }
  .xqv-coord {
    fill: rgba(255, 255, 255, 0.34);
    font-family: Helvetica, Arial, sans-serif;
    font-size: 22px;
    font-weight: 600;
    text-anchor: end;
    dominant-baseline: central;
  }
  .xqv-label {
    fill: rgba(255, 255, 255, 0.62);
    font-family: Helvetica, Arial, sans-serif;
    font-size: 26px;
    font-weight: 600;
    letter-spacing: 3px;
  }
`;
