// Variant-agnostic move tree — the shared navigation spine for BOTH the review
// page and the analysis board (lila has one `ui/tree` + `AnalyseCtrl` serving
// post-game replay and the standalone board; we want the same consistency).
//
// Why generic over <Move, Truth, View> instead of lila's single chessops
// Position per node: we have no universal FEN. Xiangqi has no FEN; every variant
// has its own move/view types. So a node holds the MOVE that produced it plus the
// canonical TRUTH state (cached by applying the parent's truth), and a variant
// adapter replays/projects. This is exactly what buildXiangqiReplayFromMoves does
// today (apply move -> snapshot getPlayerView), lifted to a tree.
//
// Fog folds in here, it is NOT a separate spine: in analysis the game is over, so
// truth is known. The tree branches on TRUTH (identical to open variants); the
// white/black fog boards are `project(truth)` — pure projections of the truth
// node, not a separate tree. `project` returns 1 view (open) or N (fog: truth +
// per-POV), which map straight onto the review-stage's primary/secondary boards.
//
// A linear played game is a tree with one mainline and zero branches, so this
// subsumes the current integer-ply scrubber: "mainline ply N" == the path down
// the mainline to depth N. That is the compat bridge that lets the ~20 existing
// postgame surfaces migrate behind a shim without changing.

/** Node identity within its parent's children. Stable = the move's canonical key
 *  (see VariantTreeAdapter.moveKey); siblings never share a move, so it is unique. */
export type NodeId = string;

/** A cursor into the tree: node ids from the root's chosen child down to the
 *  target. The empty path is the root (start position). Replaces the integer ply. */
export type TreePath = readonly NodeId[];

export const ROOT_PATH: TreePath = [];

/** One rendered board for a node. Open variants project a single `truth` view;
 *  fog projects several (truth + each POV). Maps 1:1 onto the review layout's
 *  ReviewBoardEntry (key/tier), so the board-stage renders them with no changes. */
export interface ProjectedView<View> {
  /** Stable perspective id: 'truth' | 'red' | 'white' | 'black' … */
  key: string;
  /** Human label for the board host, e.g. 'Truth' | "White's view". */
  label: string;
  /** One-word form for the segmented POV control ('Truth' | 'White'); the
   *  control falls back to stripping an English possessive off `label`. */
  shortLabel?: string;
  /** Which board slot: the dominant board vs. a click-to-promote secondary. */
  tier: 'primary' | 'secondary';
  /** What the variant's board renderer consumes (a PlayerView, typically). */
  view: View;
}

/** Engine result for a node, normalised to a single fixed POV at the edge (Red /
 *  White) rather than side-to-move, so the eval bar/graph read consistently. */
export interface NodeEval {
  /** Centipawns, fixed-POV; null when `mate` is set. */
  cp: number | null;
  /** Signed moves-to-mate, fixed-POV; null otherwise. */
  mate: number | null;
  /** Best reply in engine UCI, if known. */
  bestUci: string | null;
  /** Search depth this eval was produced at. */
  depth: number;
}

/** A single text annotation on a node. Author-keyed (lila-style): the persistence
 *  layer keeps one comment per author, so `by` identifies the writer (account id;
 *  omitted for anonymous/local edits). This is USER content — distinct from the
 *  derived `eval` — and is what a study persists. */
export interface NodeComment {
  by?: string;
  text: string;
  /** Optional per-locale text, keyed by Locale code (see study-i18n.ts). The
   *  tree model stays locale-agnostic on purpose: it stores the translations,
   *  and the render layer resolves one against the reader's current locale,
   *  falling back to `text`. */
  i18n?: Record<string, string>;
}

/** A drawn board annotation. 'circle' marks a single square (`orig`); 'arrow' runs
 *  `orig`→`dest`. `brush` is a colour key ('green' | 'red' | 'blue' | 'yellow').
 *  Squares are the variant's own square strings (e.g. xiangqi 'e3'). */
export interface NodeShape {
  kind: 'arrow' | 'circle';
  brush: string;
  orig: string;
  dest?: string;
}

/** Per-node gamebook/lesson override (lila gamebook): `hint` is an on-demand tip
 *  for the move to find; `deviation` is shown when the learner leaves this line. */
export interface NodeGamebook {
  hint?: string;
  deviation?: string;
}

/** User-authored annotations carried on a tree node. All fields optional; an absent
 *  field means "none". `glyphs` are user-set NAG codes, kept DISTINCT from the
 *  engine judgment glyph the move list derives from analysis (they must not collide
 *  — the move list shows the user glyph if set, else the engine one). Persisted by
 *  a study; rebuilt verbatim on load (tree-serialize.ts). */
export interface NodeAnnotations {
  comments?: NodeComment[];
  shapes?: NodeShape[];
  glyphs?: number[];
  gamebook?: NodeGamebook;
}

export interface GameTreeNode<Move, Truth> {
  readonly id: NodeId;
  /** The move that produced this node; null at the root. */
  readonly move: Move | null;
  /** Depth from the root (root = 0). Equals the mainline "ply" on the main line. */
  readonly ply: number;
  /** Canonical truth state here, cached by applying the parent's truth + move. */
  readonly truth: Truth;
  readonly parent: GameTreeNode<Move, Truth> | null;
  /** children[0] is the main line; the rest are variations, in promote order. */
  children: GameTreeNode<Move, Truth>[];
  /** Rendered move text for the move-list row (SAN / from-to). */
  readonly label: string;
  /** Engine/analysis eval, filled lazily by an EngineBackend pass. */
  eval?: NodeEval;
  /** User-authored annotations (comments/shapes/glyphs/gamebook). Undefined = none.
   *  Persisted by a study, not derived; mutated in place via GameTree.annotateAt. */
  annotations?: NodeAnnotations;
}

/** The per-variant mechanics the tree needs. Every function is a thin wrapper over
 *  the variant's existing free functions in `@mistboard/game` (apply/isLegal/
 *  getPlayerView) — no new rules code. See the xiangqi + dark-xiangqi examples at
 *  the bottom of this file. */
export interface VariantTreeAdapter<Move, Truth, View> {
  /** Root truth (start position), or truth reconstructed from a seed FEN/position. */
  initialTruth(): Truth;
  /** May `move` be legally applied to `truth`? Illegal user moves are rejected. */
  isLegal(truth: Truth, move: Move): boolean;
  /** Apply a legal move, returning the successor truth (pure; no mutation). */
  applyMove(truth: Truth, move: Move): Truth;
  /** Project truth to the board view(s). Length 1 = open (truth == view); length N
   *  = fog (truth + one per POV). Perspective/orientation is applied by the caller. */
  project(truth: Truth): ProjectedView<View>[];
  /** Row text for a move (the parent truth gives disambiguation context for SAN). */
  moveLabel(move: Move, parentTruth: Truth): string;
  /** Canonical stable key for a move (used as NodeId + for sibling dedup/merge).
   *  Typically the engine UCI string. */
  moveKey(move: Move): NodeId;
  /** Move in the engine's UCI dialect, for feeding an EngineBackend. */
  toEngineUci(move: Move): string;
  /** Reconstruct a move from its canonical UCI token — the inverse of moveKey /
   *  toEngineUci — given the parent truth for disambiguation context. Returns null
   *  if the token does not parse to a move. Used to rebuild a persisted tree
   *  (tree-serialize.ts); the seed/played path never needs it. Legality from the
   *  parent position is NOT checked here (addMove does that on rebuild). */
  fromUci(uci: string, parentTruth: Truth): Move | null;
  /** Documents view-count + engine-mode intent; the surface still authoritatively
   *  gates on `gameSpecForId(id).visibility`. 'fog' selects the server engine
   *  backend + the second (god) eval bar. */
  mode: 'perfect-info' | 'fog';
}

/** The tree + path-addressed navigation. The review shell drives its cursor through
 *  this; `first()`/`last()`/`stepForward`/`stepBack` give the scrubber its four
 *  buttons for free, and a branch-free tree behaves exactly like today's scrubber. */
export interface GameTree<Move, Truth, View> {
  readonly root: GameTreeNode<Move, Truth>;

  // ---- navigation (pure path arithmetic) ----
  nodeAt(path: TreePath): GameTreeNode<Move, Truth> | null;
  /** The path from the root down to `node` (root → node). Empty for the root. */
  pathTo(node: GameTreeNode<Move, Truth>): TreePath;
  /** The path from the root along children[0] to the deepest mainline node. */
  mainlinePath(): TreePath;
  /** Root path (scrubber "first"). */
  first(): TreePath;
  /** Mainline tip (scrubber "last"). */
  last(): TreePath;
  /** Step into the mainline child of `path` (next), clamped at the tip. */
  stepForward(path: TreePath): TreePath;
  /** Step to the parent of `path` (prev), clamped at the root. */
  stepBack(path: TreePath): TreePath;

  // ---- mutation ----
  /** Play `move` at `path`. Returns the child's path, or null if illegal. If a
   *  child with the same moveKey already exists, returns it (lila-style merge)
   *  rather than duplicating — this is how re-playing a known line reuses nodes. */
  addMove(path: TreePath, move: Move): TreePath | null;
  /** Remove the subtree at `path` (and thus the branch). No-op on the root. */
  deleteAt(path: TreePath): void;
  /** Make `path`'s branch the main line up to the root (promote to children[0]). */
  promoteToMainline(path: TreePath): void;
  /** Merge an annotation patch into the node at `path` (field-level replace: each
   *  provided field overwrites; pass `[]` to clear an array field). Returns false
   *  if the path does not resolve. This is the study authoring primitive — set a
   *  comment / shapes / glyphs / gamebook on any node, mainline or variation. */
  annotateAt(path: TreePath, patch: NodeAnnotations): boolean;
  /** Recompute every node's label through adapter.moveLabel. Labels are cached
   *  at node creation, so call this when the label rendering changes out from
   *  under the tree (a notation display-mode switch), then rebuild the list. */
  relabel(): void;

  // ---- rendering ----
  /** Projected board views for a node, memoised on the node. */
  project(node: GameTreeNode<Move, Truth>): ProjectedView<View>[];
}

/** Build a tree rooted at the adapter's initial truth. Seed a mainline by folding
 *  addMove over a move list (imported game / played history); an empty seed is the
 *  analysis board's empty start position. `rootTruth` overrides the adapter's
 *  start position — a FEN-seeded composition roots the tree at a hand-set state. */
export function createGameTree<Move, Truth, View>(
  adapter: VariantTreeAdapter<Move, Truth, View>,
  seed: readonly Move[] = [],
  rootTruth?: Truth,
): GameTree<Move, Truth, View> {
  const root: GameTreeNode<Move, Truth> = {
    id: '',
    move: null,
    ply: 0,
    truth: rootTruth ?? adapter.initialTruth(),
    parent: null,
    children: [],
    label: '',
  };
  // Per-node memoised projection (computed on demand for the current node only).
  const viewCache = new WeakMap<GameTreeNode<Move, Truth>, ProjectedView<View>[]>();

  function childById(node: GameTreeNode<Move, Truth>, id: NodeId) {
    return node.children.find((child) => child.id === id) ?? null;
  }

  function nodeAt(path: TreePath): GameTreeNode<Move, Truth> | null {
    let node: GameTreeNode<Move, Truth> | null = root;
    for (const id of path) {
      node = node ? childById(node, id) : null;
      if (!node) return null;
    }
    return node;
  }

  function pathTo(node: GameTreeNode<Move, Truth>): TreePath {
    const ids: NodeId[] = [];
    for (let n: GameTreeNode<Move, Truth> | null = node; n?.parent; n = n.parent) {
      ids.unshift(n.id);
    }
    return ids;
  }

  function mainlineTip(): GameTreeNode<Move, Truth> {
    let node = root;
    while (node.children[0]) node = node.children[0];
    return node;
  }

  function addMove(path: TreePath, move: Move): TreePath | null {
    const parent = nodeAt(path);
    if (!parent) return null;
    if (!adapter.isLegal(parent.truth, move)) return null;
    const id = adapter.moveKey(move);
    const existing = childById(parent, id);
    if (existing) return pathTo(existing); // merge: reuse the known line
    const child: GameTreeNode<Move, Truth> = {
      id,
      move,
      ply: parent.ply + 1,
      truth: adapter.applyMove(parent.truth, move),
      parent,
      children: [],
      label: adapter.moveLabel(move, parent.truth),
    };
    parent.children.push(child);
    return pathTo(child);
  }

  function deleteAt(path: TreePath): void {
    const node = nodeAt(path);
    if (!node?.parent) return; // never delete the root
    node.parent.children = node.parent.children.filter((child) => child !== node);
  }

  function promoteToMainline(path: TreePath): void {
    // Walk root-ward; at each parent move the child that leads to `path` to slot 0.
    for (let node = nodeAt(path); node?.parent; node = node.parent) {
      const siblings = node.parent.children;
      const index = siblings.indexOf(node);
      if (index > 0) {
        siblings.splice(index, 1);
        siblings.unshift(node);
      }
    }
  }

  function annotateAt(path: TreePath, patch: NodeAnnotations): boolean {
    const node = nodeAt(path);
    if (!node) return false;
    node.annotations = { ...node.annotations, ...patch };
    return true;
  }

  function relabel(): void {
    const stack = [...root.children];
    for (let node = stack.pop(); node; node = stack.pop()) {
      if (node.move && node.parent) {
        // `label` is readonly to consumers; the tree owns the cache.
        (node as { label: string }).label = adapter.moveLabel(node.move, node.parent.truth);
      }
      stack.push(...node.children);
    }
  }

  function project(node: GameTreeNode<Move, Truth>): ProjectedView<View>[] {
    let cached = viewCache.get(node);
    if (!cached) {
      cached = adapter.project(node.truth);
      viewCache.set(node, cached);
    }
    return cached;
  }

  // Seed a mainline by folding addMove over the move list. Illegal seed moves
  // truncate to the legal prefix (mirrors buildXiangqiReplayFromMoves), rather
  // than throwing, so a bad import degrades gracefully.
  let seedPath: TreePath = ROOT_PATH;
  for (const move of seed) {
    const next = addMove(seedPath, move);
    if (!next) break;
    seedPath = next;
  }

  return {
    root,
    nodeAt,
    pathTo,
    mainlinePath: () => pathTo(mainlineTip()),
    first: () => ROOT_PATH,
    last: () => pathTo(mainlineTip()),
    stepForward: (path) => {
      const node = nodeAt(path);
      return node?.children[0] ? pathTo(node.children[0]) : path;
    },
    stepBack: (path) => {
      const node = nodeAt(path);
      return node?.parent ? pathTo(node.parent) : ROOT_PATH;
    },
    addMove,
    deleteAt,
    promoteToMainline,
    annotateAt,
    relabel,
    project,
  };
}

// ---------------------------------------------------------------------------
// Engine backend — one interface, two implementations. This is the seam that
// lets fog slot in later without touching the tree, the shell, or the board.
//
//   - Client wasm ceval (open variants, NOW): wraps the existing CevalHandle
//     (`review/engine/ceval.ts`). No server round-trip — the roomless property.
//   - Server engine-protocol (fog, LATER): wraps a call to mistboard-engine over
//     EngineTurnRequest/EngineTurnResponse, per-POV redacted. Needs a server
//     round-trip — this is the ONE place fog breaks "no server" (documented).
//
// The surface picks a backend by adapter.mode / spec.visibility. Fog additionally
// mounts a SECOND EngineBackend for the "god eval" (perfect-info on truth), shown
// as a second, clearly-labeled bar.
// ---------------------------------------------------------------------------

/** One ranked line from an engine (a PV). Scores are side-to-move POV; the caller
 *  normalises to a fixed POV before display (see NodeEval). */
export interface EvalLine {
  /** 1-based MultiPV rank (1 = best). */
  multipv: number;
  depth: number;
  cp: number | null;
  mate: number | null;
  /** Principal variation, engine UCI. */
  pvUci: string[];
}

export interface EvalRequest {
  /** Move history from the start position, in engine UCI (adapter.toEngineUci). */
  movesUci: string[];
  /** Ranked lines to return. Open ceval uses 1–3; the fog engine can rank ALL
   *  legal moves (its output is richer than PV-1-3 — the Mode-B move ranking). */
  multiPv?: number;
  maxDepth?: number;
  /** Progressive callback as depth increases. */
  onUpdate?: (lines: EvalLine[]) => void;
}

export interface EngineBackend {
  /** Evaluate the position reached by movesUci; resolves at the deepest update. */
  evaluate(req: EvalRequest): Promise<EvalLine[]>;
  /** Halt the current search. */
  stop(): void;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Reference adapters (illustrative — NOT compiled here; they live with each
// variant when wired). They show that every hook is a one-liner over existing
// `@mistboard/game` functions, and that open vs. fog differ ONLY in `project`.
// ---------------------------------------------------------------------------
//
// OPEN — standard xiangqi (Truth = XiangqiGameState, View = StandardXiangqiPlayerView):
//
//   const xiangqiTreeAdapter: VariantTreeAdapter<XiangqiMove, XiangqiGameState, StandardXiangqiPlayerView> = {
//     mode: 'perfect-info',
//     initialTruth: () => createInitialXiangqiState('analysis'),
//     isLegal:  (t, m) => t.status.type === 'playing' && isStandardXiangqiLegalMove(t, m),
//     applyMove: (t, m) => applyStandardXiangqiMove(t, m),
//     project:  (t) => [{ key: 'truth', label: 'Board', tier: 'primary',
//                         view: getStandardXiangqiPlayerView(t, 'red') }],   // <- length 1
//     moveLabel: (m) => `${m.from}-${m.to}`,
//     moveKey:   (m) => xiangqiMoveToFsfUci(m),
//     toEngineUci: (m) => xiangqiMoveToFsfUci(m),
//   };
//
// FOG — dark xiangqi (same Truth kernel; project returns THREE views). The tree,
// nav, keyboard, scrubber are byte-identical to open; only projection differs:
//
//   const darkXiangqiTreeAdapter: VariantTreeAdapter<XiangqiMove, XiangqiGameState, XiangqiPlayerView> = {
//     mode: 'fog',
//     initialTruth, isLegal, applyMove, moveLabel, moveKey, toEngineUci  // <- same as open
//     project: (t) => [
//       { key: 'truth', label: 'Truth',        tier: 'primary',   view: getPlayerView(t, /*god*/ undefined) },
//       { key: 'red',   label: "Red's view",   tier: 'secondary', view: getPlayerView(t, 'red') },
//       { key: 'black', label: "Black's view", tier: 'secondary', view: getPlayerView(t, 'black') },
//     ],  // <- length 3: the triptych, straight onto primary + two secondaries
//   };
//
// Fog additionally selects the server EngineBackend (fog engine) as the primary
// bar and mounts the client-ceval backend on `truth` as the second (god) bar.
