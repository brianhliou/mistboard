// The variant lab's contract: what a variant has to provide to be measured.
//
// Every measurement command in this directory is written once, against these
// interfaces, and a new variant plugs in by writing one adapter file under
// `variants/`. The adapter binds a rules record (the decisions that are still
// open for that variant) to a kernel and to a Fairy-Stockfish stanza, so that
// flipping a decision is a different `--rules` argument, not a code change,
// and every artifact the lab writes carries the fingerprint of the rules and
// engine that produced it.

export type RuleValue = string | number | boolean;
export type RulesRecord = Readonly<Record<string, RuleValue>>;

/**
 * How far a flip of this rule reaches. Move-generation rules invalidate every
 * recorded game; terminal rules only re-score games from their event logs;
 * cosmetic rules change no number. The report uses this to say what a flip
 * costs before it is made.
 */
export type BlastRadius = 'movegen' | 'terminal' | 'cosmetic';

export type RuleSpec = {
  readonly options: readonly RuleValue[];
  readonly default: RuleValue;
  readonly blast: BlastRadius;
  readonly note: string;
};
export type RuleSchema = Readonly<Record<string, RuleSpec>>;

export type LabColor = 'red' | 'black';
export type LabStatus =
  | { type: 'playing'; turn: LabColor }
  | { type: 'finished'; winner: LabColor | null; reason: string };

/**
 * A kernel as the lab sees it: whole turns in, whole turns out. A "move" here
 * is whatever the variant calls one turn (a duck turn is a piece move plus a
 * duck placement). The kernel is the referee in every engine game: the engine
 * proposes, the kernel validates and applies, and the kernel says when the
 * game is over.
 */
export interface LabKernel<S, M> {
  initial(id: string): S;
  status(state: S): LabStatus;
  /** Every legal whole turn from `state`. */
  legalMoves(state: S): M[];
  apply(state: S, move: M): S;
  /** Canonical key for set comparison; two moves are the same iff keys match. */
  moveKey(move: M): string;
  /** The move in the engine's own notation for `position ... moves`. */
  toUci(move: M): string;
  /** Parse the engine's notation in the context of `state`; null if malformed. */
  fromUci(state: S, uci: string): M | null;
  /** A FEN the engine accepts as `position fen`. */
  fen(state: S): string;
  /** Parse an engine-acceptable FEN; null if it is not a legal position. */
  parseFen(fen: string, id: string): S | null;
  /** Plies played so far. */
  ply(state: S): number;
  /**
   * Cheap legality check; defaults to membership in `legalMoves` by key. A
   * variant whose whole-turn list is large (a duck turn is a piece move times
   * ~58 placements) should answer without materialising the list.
   */
  isLegal?(state: S, move: M): boolean;
  /**
   * Cheap uniform-ish sampler for random play; defaults to a uniform pick from
   * `legalMoves`. Same reason: random control runs millions of plies.
   */
  randomMove?(state: S, rng: () => number): M | null;
}

export type BinaryLocator = {
  /** Environment variable naming the binary; wins when set. */
  readonly env: string;
  /** Paths to try in order when the variable is unset. */
  readonly fallbacks: readonly string[];
  /** What to tell a human when nothing is found. */
  readonly label: string;
};

export type LabEngineSpec = {
  /** The UCI_Variant name the engine must acknowledge. */
  readonly variant: string;
  /** A variants.ini body to hand over as VariantPath, or undefined for a built-in. */
  readonly ini?: string;
  readonly binary: BinaryLocator;
};

export type DiscriminatingPosition = {
  readonly name: string;
  /** Why perft from the start array cannot see what this position tests. */
  readonly why: string;
  readonly fen: string;
};

export interface LabVariant<S, M> {
  readonly id: string;
  readonly title: string;
  readonly ruleSchema: RuleSchema;
  /** Bind resolved rules to a kernel and an engine description. */
  create(rules: RulesRecord): { kernel: LabKernel<S, M>; engine: LabEngineSpec };
  /**
   * Positions the perft gate checks one at a time, because perft from the
   * start array cannot reach them within computable depth. Every rule the
   * variant adds should have at least one.
   */
  readonly discriminatingPositions: readonly DiscriminatingPosition[];
  /**
   * False when the engine counts a terminal move differently from the kernel
   * (FSF enumerates a duck placement after a general capture; the kernel ends
   * the game there). Move-set comparisons still gate; raw perft counts are
   * then reported but not judged.
   */
  readonly perftCountsComparable?: boolean;
}

// A variant adapter is generic over its own state and move types; the registry
// and the commands only need the existentially-typed form.
// biome-ignore lint/suspicious/noExplicitAny: existential over adapter generics
export type AnyLabVariant = LabVariant<any, any>;

export type GameRecord = {
  /** Moves in engine notation, in order. */
  readonly moves: readonly string[];
  readonly plies: number;
  readonly winner: LabColor | null;
  readonly reason: string;
  /** Which seat(s) the engine held, for match-mode records. */
  readonly engineSeat?: LabColor | 'both' | 'none';
};

export type EngineIdentity = {
  readonly idName: string;
  readonly binaryPath: string;
  readonly binarySha256: string;
  readonly variant: string;
  readonly iniSha256: string | null;
};

/**
 * Every artifact starts with this header. `rulesHash` alone identifies
 * kernel-only results; `fingerprint` adds the engine identity and the lab
 * version, so an engine rebuild or a harness change also reads as a new row.
 */
export type ArtifactHeader = {
  readonly lab: string;
  readonly command: string;
  readonly variant: string;
  readonly rules: RulesRecord;
  readonly rulesHash: string;
  readonly engine: EngineIdentity | null;
  readonly fingerprint: string;
  readonly args: Readonly<Record<string, RuleValue>>;
  readonly seed: number | null;
  readonly startedAt: string;
  readonly durationMs: number;
};

export type Artifact<T> = ArtifactHeader & { readonly result: T };
