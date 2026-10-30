// Shared plumbing for the DEALT FEN grammar of the hidden-deal variants (banqi,
// jieqi, jungle-flip).
//
// A hidden-deal position has two layers: what both seats can see (the engine FEN
// each *-fen.ts writer already emits: revealed pieces, face-down markers, the
// unrevealed pool as counts) and the deal itself (which identity sits under each
// face-down marker). The dealt FEN carries both: the five public fields plus a
// sixth `hidden` field, one role char per face-down piece in BOARD ORDER (top
// rank first, files left to right within a rank), UPPER = red ink, lower = black
// ink, or `-` when nothing is face-down. A five-field (public) FEN is still
// accepted: the hidden identities are then SAMPLED from the pool, once, and the
// caller pins the sample by re-spelling the position as a six-field dealt FEN.
// That is what makes an analysis URL reload-stable: the URL carries the deal,
// the FEN box on screen shows only the spoiler-free public form.
//
// Shared here is the placement/turn/pool/clock grammar of the two SYMMETRIC flip
// variants (banqi and jungle-flip, whose face-down tile hides its ink as well as
// its role), plus the small helpers jieqi's colour-known grammar also needs.
// Every message is user-facing: a bad FEN is nearly always a mistyped diagram,
// and the message is the only clue the author gets.

export type DealtFenParseOptions = {
  /** State id for the rebuilt position (default 'fen-import'). */
  gameId?: string;
  /** Source of randomness for sampling a public FEN's hidden identities (default
   *  Math.random; tests pass a seeded one). Unused when the sixth field is given. */
  rng?: () => number;
};

/** Fisher-Yates over a copy; `rng` returns a float in [0, 1). */
export function shuffleWithRng<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export function isNonNegativeInteger(field: string | undefined): field is string {
  return field !== undefined && /^\d+$/.test(field);
}

/** Parse a `<char><count>` pool field into per-char counts. `-` is the empty
 *  pool. Returns null when the field is unreadable or names a char `isKnown`
 *  rejects. Zero counts are accepted (jieqi's writer emits them). */
export function parsePoolField(
  field: string,
  isKnown: (ch: string) => boolean,
): Map<string, number> | null {
  const counts = new Map<string, number>();
  if (field === '-') return counts;
  if (!/^(?:[A-Za-z]\d+)+$/.test(field)) return null;
  const pair = /([A-Za-z])(\d+)/g;
  for (let m = pair.exec(field); m; m = pair.exec(field)) {
    const ch = m[1]!;
    if (!isKnown(ch)) return null;
    counts.set(ch, (counts.get(ch) ?? 0) + Number(m[2]));
  }
  return counts;
}

export function sameMultiset(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((value, i) => value === sortedB[i]);
}

// ── Symmetric flip grammar (banqi, jungle-flip) ──────────────────────────────

export type FlipInk = 'red' | 'black';

export type FlipFenSpec<Role extends string, Square extends string> = {
  width: number;
  height: number;
  /** UPPER-case role char per role (red ink); the lower-case form is black ink. */
  roleChar: Record<Role, string>;
  /** Pieces of each role per ink in the full set. */
  pieceCounts: Record<Role, number>;
  /** Canonical role order for the pool and the captured remainder. */
  roleOrder: readonly Role[];
  squareOf(file: number, rank: number): Square;
};

export type FlipFenPiece<Role> = { color: FlipInk; role: Role; faceDown: boolean };

export type FlipFenParse<Role extends string, Square extends string> = {
  board: Partial<Record<Square, FlipFenPiece<Role>>>;
  /** Ink of the side to move; null for the unbound opening (`-`). */
  turn: FlipInk | null;
  clock: number;
  /** The movenum slot verbatim; banqi reads a move number, jungle-flip a ply. */
  movenum: number;
  /** The pieces missing from board + pool, i.e. captured. */
  captures: { owner: FlipInk; role: Role }[];
  /** True when the hidden identities were sampled (no sixth field). */
  sampled: boolean;
};

export type FlipFenResult<Role extends string, Square extends string> =
  | { ok: true; parse: FlipFenParse<Role, Square> }
  | { ok: false; error: string };

/** Squares in FEN board order: top rank first, files left to right. */
export function flipBoardOrder<Role extends string, Square extends string>(
  spec: FlipFenSpec<Role, Square>,
): Square[] {
  const out: Square[] = [];
  for (let rank = spec.height; rank >= 1; rank -= 1) {
    for (let file = 0; file < spec.width; file += 1) out.push(spec.squareOf(file, rank));
  }
  return out;
}

/** The sixth field: one role char per face-down piece in board order, `-` if none. */
export function flipHiddenField<Role extends string, Square extends string>(
  board: Partial<Record<Square, FlipFenPiece<Role>>>,
  spec: FlipFenSpec<Role, Square>,
): string {
  let out = '';
  for (const square of flipBoardOrder(spec)) {
    const piece = board[square];
    if (!piece?.faceDown) continue;
    const ch = spec.roleChar[piece.role];
    out += piece.color === 'red' ? ch : ch.toLowerCase();
  }
  return out === '' ? '-' : out;
}

function inkOf(ch: string): FlipInk {
  return ch === ch.toUpperCase() ? 'red' : 'black';
}

export function parseFlipFen<Role extends string, Square extends string>(
  fen: string,
  spec: FlipFenSpec<Role, Square>,
  rng: () => number,
): FlipFenResult<Role, Square> {
  const fields = fen.trim().split(/\s+/).filter(Boolean);
  if (fields.length === 0) return { ok: false, error: 'Empty FEN.' };
  if (fields.length !== 5 && fields.length !== 6) {
    return { ok: false, error: `Expected 5 or 6 FEN fields, got ${fields.length}.` };
  }
  const [placement, turnField, poolField, clockField, movenumField, hiddenField] = fields;

  const roleForChar = new Map<string, Role>();
  for (const role of spec.roleOrder) roleForChar.set(spec.roleChar[role], role);

  // Placement.
  const rows = placement!.split('/');
  if (rows.length !== spec.height) {
    return {
      ok: false,
      error: `Expected ${spec.height} ranks in the placement, got ${rows.length}.`,
    };
  }
  const board: Partial<Record<Square, FlipFenPiece<Role>>> = {};
  const faceDownSquares: Square[] = [];
  const revealed = new Map<string, number>();
  for (let i = 0; i < spec.height; i += 1) {
    const rank = spec.height - i;
    let file = 0;
    for (const ch of rows[i]!) {
      if (ch >= '1' && ch <= '9') {
        file += Number(ch);
        continue;
      }
      if (file >= spec.width) {
        return { ok: false, error: `Rank ${rank} runs past ${spec.width} files.` };
      }
      const square = spec.squareOf(file, rank);
      file += 1;
      if (ch === 'X' || ch === 'x') {
        faceDownSquares.push(square);
        continue;
      }
      const role = roleForChar.get(ch.toUpperCase());
      if (!role) return { ok: false, error: `Unknown piece "${ch}" on rank ${rank}.` };
      const color = inkOf(ch);
      board[square] = { color, role, faceDown: false };
      revealed.set(`${color}:${role}`, (revealed.get(`${color}:${role}`) ?? 0) + 1);
    }
    if (file !== spec.width) {
      return { ok: false, error: `Rank ${rank} covers ${file} files, expected ${spec.width}.` };
    }
  }

  // Turn.
  let turn: FlipInk | null;
  if (turnField === '-') turn = null;
  else if (turnField === 'r') turn = 'red';
  else if (turnField === 'b') turn = 'black';
  else {
    return {
      ok: false,
      error: `Unknown side-to-move "${turnField}" (expected r, b, or -).`,
    };
  }

  // Pool.
  const poolChars = parsePoolField(poolField!, (ch) => roleForChar.has(ch.toUpperCase()));
  if (!poolChars) return { ok: false, error: `Unreadable pool field "${poolField}".` };
  const pool = new Map<string, number>();
  let poolTotal = 0;
  for (const [ch, n] of poolChars) {
    const key = `${inkOf(ch)}:${roleForChar.get(ch.toUpperCase())}`;
    pool.set(key, (pool.get(key) ?? 0) + n);
    poolTotal += n;
  }
  if (poolTotal !== faceDownSquares.length) {
    return {
      ok: false,
      error: `The pool lists ${poolTotal} hidden pieces but the board has ${faceDownSquares.length} face-down tiles.`,
    };
  }

  // Clocks.
  if (!isNonNegativeInteger(clockField)) {
    return { ok: false, error: 'The clock field must be a non-negative integer.' };
  }
  if (!isNonNegativeInteger(movenumField)) {
    return { ok: false, error: 'The move-number field must be a non-negative integer.' };
  }

  // Conservation: board + pool never exceeds the set; the remainder was captured.
  const captures: { owner: FlipInk; role: Role }[] = [];
  const poolList: { color: FlipInk; role: Role }[] = [];
  for (const color of ['red', 'black'] as const) {
    for (const role of spec.roleOrder) {
      const key = `${color}:${role}`;
      const inPool = pool.get(key) ?? 0;
      const shown = (revealed.get(key) ?? 0) + inPool;
      const max = spec.pieceCounts[role];
      if (shown > max) {
        return {
          ok: false,
          error: `Too many ${color} ${role}s: the set has ${max}, the board and pool show ${shown}.`,
        };
      }
      for (let k = 0; k < inPool; k += 1) poolList.push({ color, role });
      for (let k = shown; k < max; k += 1) captures.push({ owner: color, role });
    }
  }

  // The unbound turn is the opening and only the opening: the first action is a
  // flip, and a flipped tile stays revealed (captures need a revealed attacker),
  // so a board with every tile face-down has seen no action, and any other board
  // has an ink bound to the mover. "Every tile" is the whole set, not the whole
  // board: Three Kingdoms banqi deals its 32 tiles onto 45 points.
  const setSize = 2 * spec.roleOrder.reduce((sum, role) => sum + spec.pieceCounts[role], 0);
  const allFaceDown = faceDownSquares.length === setSize;
  if (allFaceDown && turn !== null) {
    return {
      ok: false,
      error:
        'Side-to-move must be "-" while every tile is still face-down (nothing has bound an ink yet).',
    };
  }
  if (!allFaceDown && turn === null) {
    return {
      ok: false,
      error: 'Side-to-move "-" is only legal before the first flip; give r or b.',
    };
  }

  // Hidden identities: given (sixth field) or sampled from the pool.
  let identities: { color: FlipInk; role: Role }[];
  let sampled: boolean;
  if (hiddenField === undefined) {
    identities = shuffleWithRng(poolList, rng);
    sampled = true;
  } else {
    const chars = hiddenField === '-' ? [] : [...hiddenField];
    if (chars.length !== faceDownSquares.length) {
      return {
        ok: false,
        error: `The hidden field lists ${chars.length} identities but the board has ${faceDownSquares.length} face-down tiles.`,
      };
    }
    identities = [];
    for (const ch of chars) {
      const role = roleForChar.get(ch.toUpperCase());
      if (!role) return { ok: false, error: `Unknown hidden piece "${ch}".` };
      identities.push({ color: inkOf(ch), role });
    }
    const key = (p: { color: FlipInk; role: Role }): string => `${p.color}:${p.role}`;
    if (!sameMultiset(identities.map(key), poolList.map(key))) {
      return {
        ok: false,
        error: 'The hidden field does not match the pool: the same pieces must appear in both.',
      };
    }
    sampled = false;
  }
  faceDownSquares.forEach((square, i) => {
    board[square] = { ...identities[i]!, faceDown: true };
  });

  return {
    ok: true,
    parse: {
      board,
      turn,
      clock: Number(clockField),
      movenum: Number(movenumField),
      captures,
      sampled,
    },
  };
}
