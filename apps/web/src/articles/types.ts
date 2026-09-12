// Article-schema types for the articles content modules. These are pure type
// declarations relocated from articles-data.ts; the public type surface is
// re-exported through the articles-data.ts barrel.

import type { BoardSpec, CompositionLayout } from '@mistboard/board-render';
import type { LiveBoardsOptions, SteppedBoardsOptions } from '@mistboard/board-render/interactive';
import type {
  BanqiDeal,
  BanqiSeat,
  GameSpecId,
  JungleColor,
  JungleFlipDeal,
  Square,
} from '@mistboard/game';
import type { ChessReplaySpec } from '../chess-replay.js';
import type { PlayerTitle } from '../player-titles.js';
import type { DuckXiangqiReplaySpec } from '../duck-xiangqi-replay.js';
import type { FortressXiangqiReplaySpec } from '../fortress-xiangqi-replay.js';
import type { JieqiReplaySpec } from '../jieqi-replay.js';
import type { XiangqiReplaySpec } from '../xiangqi-replay.js';

export type ParagraphBlock = { kind: 'paragraph'; text: string };

export type SubHeadingBlock = { kind: 'sub-heading'; text: string };

// Inline SVG composition of 1, 2, or 3 boards. Renderer wraps the composer
// output in an <svg> with the given canvas dimensions and background.
export type StaticBoardsBlock = {
  kind: 'static-boards';
  layout: CompositionLayout;
  boards: BoardSpec[];
  canvasWidth: number;
  canvasHeight: number;
  boardSize: number;
  boardY: number;
  gap?: number;
  labelY?: number;
  labelFill?: string;
  labelFontSize?: number;
  labelLetterSpacing?: number;
  background?: string;
  caption?: string;
};

// Mount-point for a registered interactive widget. The renderer creates a
// container, applies the widget's mount function, and tracks the teardown.
// Widget kinds are added as their implementations land.
export type InteractiveBlock = {
  kind: 'interactive';
  widget: 'stepper';
  spec: SteppedBoardsOptions;
  caption?: string;
};

// Static chessground figure — one or more themed boards in a fixed layout,
// no stepping UI. Picks up the user's board palette and fog style from the
// live theme, same as the stepper widget. Use for snapshot illustrations.
export type LiveBoardsBlock = {
  kind: 'live-boards';
  spec: LiveBoardsOptions;
  caption?: string;
};

// Client-side game replay: one board stepped through a move list. The move
// record ships as a compact ICCS string; positions render on demand.
export type XiangqiReplayBlock = {
  kind: 'xq-replay';
  spec: XiangqiReplaySpec;
  caption?: string;
};

// Chess analogue of XiangqiReplayBlock: the game ships as a compact UCI string
// and each position renders on demand on a chessground board.
export type ChessReplayBlock = {
  kind: 'chess-replay';
  spec: ChessReplaySpec;
  caption?: string;
};

// Jieqi analogue: a 9x10 board stepped through a move list + hidden deal, each
// position replayed through the real kernel; dark pieces flip on first move.
export type JieqiReplayBlock = {
  kind: 'jieqi-replay';
  spec: JieqiReplaySpec;
  caption?: string;
};

// Banqi analogue: an 8x4 board stepped through a move list + hidden deal, each
// position replayed through the real kernel; tiles flip on first turn-over.
// The spec lives here (not in banqi-replay.ts) because banqi-replay.ts imports
// the article diagram builders; keeping the spec out of it breaks the
// diagrams -> types -> banqi-replay import cycle.
export type BanqiReplaySpec = {
  red: string;
  black: string;
  event: string;
  // Short result line shown under the players (e.g. "Red wins by resignation · 49 moves").
  outcome?: string;
  // Shown on the final ply. The kernel reports the real result; this overrides
  // the narrative text there.
  resultText: string;
  // The 32-tile deal in ALL_BANQI_SQUARES order — reveals follow it.
  deal: BanqiDeal;
  // Space-separated from+to tokens (files a-h, ranks 1-4); a flip is from==to.
  moves: string;
  perspective?: BanqiSeat;
};

export type BanqiReplayBlock = {
  kind: 'banqi-replay';
  spec: BanqiReplaySpec;
  caption?: string;
};

// Jungle (Dou Shou Qi) analogue: a 7x9 board stepped through a move list, each
// position replayed through the real jungle kernel. Perfect-information, so
// there is no deal — just the moves. The spec lives here (not in jungle-replay.ts)
// to match the banqi spec placement and keep the article-block union in one file.
export type JungleReplaySpec = {
  red: string;
  black: string;
  event: string;
  // Short result line shown under the players (e.g. "Red wins by reaching the den · 69 moves").
  outcome?: string;
  // Shown on the final ply; overrides the kernel's plain result text there.
  resultText: string;
  // Space-separated from+to tokens (files a-g, ranks 1-9); replayed via applyJungleMove.
  moves: string;
  perspective?: JungleColor;
};

export type JungleReplayBlock = {
  kind: 'jungle-replay';
  spec: JungleReplaySpec;
  caption?: string;
};

// Flip Jungle (兽棋 / 翻翻棋) analogue of the banqi replay: a 4x4 board stepped
// through a move list + hidden deal, each position replayed through the real
// flip-jungle kernel; tiles flip to their dealt animal on first turn-over and
// equal ranks trade off the board.
export type JungleFlipReplaySpec = {
  red: string;
  black: string;
  event: string;
  // Short result line shown under the players (e.g. "Black wins by elimination · 36 moves").
  outcome?: string;
  // Shown on the final ply; overrides the kernel's plain result text there.
  resultText: string;
  // The 16-tile deal in board-index order — reveals follow it.
  deal: JungleFlipDeal;
  // Space-separated from+to tokens (files a-d, ranks 1-4); a flip is from==to.
  moves: string;
};

export type JungleFlipReplayBlock = {
  kind: 'jungle-flip-replay';
  spec: JungleFlipReplaySpec;
  caption?: string;
};

// Mini Xiangqi analogue of XiangqiReplayBlock: a 7x7 board stepped through a
// Drop Mini Xiangqi analogue: a 7x7 board plus both reserves, stepped through
// Fortress Xiangqi analogue: the 7x8 corner-palace board plus both reserves,
// stepped through board moves and drops against the real kernel.
export type FortressXiangqiReplayBlock = {
  kind: 'fortress-xiangqi-replay';
  spec: FortressXiangqiReplaySpec;
  caption?: string;
};

// Duck Xiangqi analogue: the 9x10 board plus the shared duck, stepped through a
// turn list against the real kernel. A token carries BOTH halves of a turn
// (`b1c3@c8`) because a turn is a piece move and a duck placement; the duck half
// is absent only on the general capture that ends the game.
export type DuckXiangqiReplayBlock = {
  kind: 'duck-xiangqi-replay';
  spec: DuckXiangqiReplaySpec;
  caption?: string;
};

export type CtaButton = {
  label: string;
  href: string;
  emphasis?: 'primary' | 'secondary';
  external?: boolean;
};

export type CtaBlock = {
  kind: 'cta';
  buttons: CtaButton[];
  layout?: 'single-row';
};

// Raw inline SVG — for hand-coded diagrams (timelines, axis plots, family
// trees, etc.) that don't fit the board renderer. Author provides the
// complete <svg>...</svg> string; the renderer wraps it in a <figure>
// with an optional caption.
export type RawSvgBlock = {
  kind: 'raw-svg';
  // A string is baked once (chess timelines, axis plots). A render thunk is
  // re-run when the xiangqi appearance picker changes (piece set) and reflects
  // the active board theme via CSS — the xiangqi-diagram equivalent of how
  // chess diagrams restyle through chessground sprites + board-theme CSS.
  svg: string | (() => string);
  caption?: string;
  // Extra class on the <figure>, for per-diagram sizing (e.g. the shogi rules
  // page caps its full board vs. its compact per-piece move diagrams).
  className?: string;
  /**
   * Click (or Enter) expands the figure to a full-screen overlay. For dense
   * figures that are legible at column width but not readable there. The
   * artwork is inline SVG, so the expanded copy is the same nodes larger, not
   * an upscaled raster.
   */
  zoomable?: boolean;
};

// Two or three raw-SVG figures on one row (stacking on narrow screens). Rules
// pages teach by contrast — leap across vs leap along, tiger vs lion from the
// same square — and a contrast only lands when both cases are on screen at
// once. Each item is a RawSvgBlock payload; the renderer builds the same
// <figure> for each, so per-item captions and sizing classes work unchanged.
export type SvgRowBlock = {
  kind: 'svg-row';
  items: Array<{ svg: string | (() => string); caption?: string; className?: string }>;
  caption?: string;
  className?: string;
};

export type RawSvgStepperStep = {
  // String, or a render thunk re-run on xiangqi appearance change (see RawSvgBlock).
  svg: string | (() => string);
  narrative?: string;
};

export type RawSvgStepperBlock = {
  kind: 'raw-svg-stepper';
  steps: RawSvgStepperStep[];
  header?: { players: string; event: string };   // optional title above the frame (engine-game style)
  caption?: string;
};

// Code/data block — for inline source snippets, captured payloads, or any
// monospace content. `text` is rendered verbatim inside <pre><code>; the
// renderer escapes it. Use `language` for syntax-highlighting hints (the
// current renderer just sets a data attribute; styling does the rest).
// `maxHeight` caps the visible region so very long payloads scroll
// instead of dominating the page.
export type CodeBlock = {
  kind: 'code';
  text: string;
  language?: string;
  caption?: string;
  maxHeight?: number;
};

// One of the site's own embeds (/embed/puzzle/:id, /embed/analysis?fen=...,
// /embed/game/:id, /embed/study/...) framed at column width. The same frame a
// forum post or a third-party page gets, so a puzzle in an article is the real
// trainer: solvable, graded, and it names its pattern after the solve. Use
// this over a replay stepper whenever the reader should be able to play.
export type EmbedBlock = {
  kind: 'embed';
  /** Site-relative embed path, e.g. `/embed/puzzle/xq-mined-...`. */
  path: string;
  /** Frame title, for assistive tech and the tab the frame can open into. */
  title: string;
  caption?: string;
  /** Frame aspect as [width, height]; defaults to the embed contract's 760x700. */
  aspect?: [number, number];
};

/**
 * A data table. Added for articles whose argument IS the numbers (opening
 * statistics, engine comparisons), where prose or a code block would bury the
 * comparison the reader came for. Cells are plain strings so a column can hold
 * "79.1%" or "17 of 17" without the block needing to know about units.
 */
// A question-and-answer list. Rendered as a definition list AND lifted into
// FAQPage JSON-LD by the prerender, which is the point: an FAQ block that only
// looks like an FAQ is decoration, while one search engines can parse is a shot
// at the answer box on exactly the informational queries a new player types.
//
// Answers are plain text, not rich text. Schema.org wants an answer that stands
// alone, and a sentence whose meaning depends on a link the crawler will not
// follow is a worse answer for having had one.
export type FaqBlock = {
  kind: 'faq';
  items: { question: string; answer: string }[];
};

export type TableBlock = {
  kind: 'table';
  headers: string[];
  rows: string[][];
  caption?: string;
  /** Emphasise a row (a result worth reading twice). Zero-indexed into `rows`. */
  highlightRows?: number[];
};

// A raster figure in an article body (product screenshots, photos). `src` is a
// path under apps/web/public, same convention as ImageArticleThumbnail; the SVG
// blocks stay the default for anything drawable.
export type ImageFigureBlock = {
  kind: 'image-figure';
  src: string;
  alt: string;
  caption?: string;
  className?: string;
};

export type ArticleBlock =
  | ParagraphBlock
  | TableBlock
  | FaqBlock
  | ImageFigureBlock
  | SubHeadingBlock
  | StaticBoardsBlock
  | InteractiveBlock
  | LiveBoardsBlock
  | CtaBlock
  | RawSvgBlock
  | SvgRowBlock
  | RawSvgStepperBlock
  | XiangqiReplayBlock
  | ChessReplayBlock
  | FortressXiangqiReplayBlock
  | DuckXiangqiReplayBlock
  | JieqiReplayBlock
  | BanqiReplayBlock
  | JungleReplayBlock
  | JungleFlipReplayBlock
  | CodeBlock
  | EmbedBlock;

// `blocks` is the structured body. `paragraphs` is the legacy outline body
// that still carries `[VISUAL: ...]` markers — sections are migrated to
// `blocks` as they get their real visuals.
export type ArticleSection = {
  heading: string;
  paragraphs?: string[];
  blocks?: ArticleBlock[];
};

// Single-board art rendered on the articles index card. No labels, no
// caption — the card itself supplies title and summary. Use a position
// that reads at a glance: a clear fog pattern, a recognisable setup, or
// a moment from the article.
export type BoardArticleThumbnail = {
  kind?: 'board';
  pieces: BoardSpec['pieces'];
  fogSquares?: BoardSpec['fogSquares'];
  splitFogSquares?: {
    left: Square[];
    right: Square[];
  };
  orientation?: BoardSpec['orientation'];
};

export type SvgArticleThumbnail = {
  kind: 'svg';
  // String is baked once; a render thunk re-runs on xiangqi appearance change so
  // the index/announcement card tracks the picked piece set (board theme is CSS).
  svg: string | (() => string);
};

export type ImageArticleThumbnail = {
  kind: 'image';
  // Path under apps/web/public (served at site root). Avoid folders that shadow
  // a client route (e.g. '/blog'): use '/article-thumbs/misty.jpg'.
  src: string;
  alt?: string;
};

export type ArticleThumbnail =
  | BoardArticleThumbnail
  | SvgArticleThumbnail
  | ImageArticleThumbnail;

type ArticleBase = {
  slug: string;
  // Public article URLs may use a reader-facing name while the game keeps a
  // stable protocol/database id (for example fog-chess -> dark-chess).
  gameSpecId?: GameSpecId;
  // Rules articles: the game is live on Mistboard today (drives the
  // playable / not-yet grouping in the variant rail). Omit when the page
  // is a reference for a game we do not host yet.
  playableOnMistboard?: boolean;
  title: string;
  /**
   * Document <title> when it should differ from the on-page h1, which `title`
   * still drives. Exists because a variant's brand name and its search name can
   * be different words: Fog Chess is what we call it, "fog of war chess" is what
   * players type, and the page ranked 8th for the former and 26th for the latter.
   * Set this to serve search without renaming the variant on the page.
   */
  seoTitle?: string;
  /**
   * Extra JSON-LD nodes emitted alongside the Article node, each in its own
   * script tag. A thunk because the payload is usually derived from the same
   * data the page renders, and a second hand-written copy would drift from it.
   *
   * Exists for pages whose subject IS a list: "every xiangqi champion" is a
   * list query, and an ItemList is the difference between ranking for the
   * question and being the answer to it.
   */
  structuredData?: () => Record<string, unknown>[];
  /**
   * BCP-47 language of the article's own prose, when it is not English. The
   * three interface locales are settled and closed (en / zh-Hans / zh-Hant),
   * but content in a language was never gated: a page can be written in a
   * language the UI does not speak. Setting this stamps <html lang>, the
   * hreflang self-reference, and JSON-LD inLanguage, without which the page
   * would declare itself English and rank for nothing in its own language.
   *
   * A page with this set has no zh variants: it is not a translation of an
   * English original, it is its own document.
   */
  sourceLang?: 'vi';
  summary: string;
  /**
   * Guest byline. Set when someone other than Mistboard wrote the piece: a
   * verified titled player sends prose, we edit it and publish it under their
   * name. Absent means the site is the author and no byline renders, which is
   * every existing article. `handle` links to the player's profile when they
   * have an account here; `title` renders their verified badge beside the name.
   */
  author?: {
    displayName: string;
    handle?: string;
    title?: PlayerTitle;
  };
  showSummaryOnPage?: boolean;
  // Non-variant guest pages only. Variant rules listings are controlled in
  // variant-public-surfaces.ts so one switch covers every public rail/widget.
  showInIndex?: boolean;
  status: 'outline' | 'draft' | 'published';
  audience: string;
  // ISO-8601 dates (YYYY-MM-DD). When present, rendered in the article meta.
  publishedAt?: string;
  updatedAt?: string;
  tldr?: string[];
  intro?: ArticleBlock[];
  thumbnail?: ArticleThumbnail;
  // Which appearance family this article's diagrams belong to. Drives the
  // Settings board/piece pickers while the article is open (xiangqi diagrams
  // react to the xiangqi pickers). Defaults to chess when unset.
  boardFamily?: 'chess' | 'xiangqi';
  sections: ArticleSection[];
};

export type Article = ArticleBase &
  (
    | { kind: 'rules' }
    | {
        kind: 'article';
        // Explicit so the official-only view stays fail-closed when community
        // authors are introduced later.
        publisher: 'mistboard' | 'community';
      }
  );
