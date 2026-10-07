// Recover the hidden deal of a FINISHED flip variant (banqi, Flip Jungle) from
// what a finished room already serves every client: the truth board (every tile
// on it face up, the never-flipped ones included) and the captured pool (every
// capture with its owner and role), plus the public move log.
//
// Each tile is named by the square it was dealt to. Follow it through the moves
// to where it ended up, on a square or as the n-th capture, and read its
// identity there. The only ambiguity is Flip Jungle's 同归于尽 trade (equal
// ranks take each other off the board, the attacker staying put), which the log
// does not mark: when the next two captures are the same role in opposite
// colours a capture could be either a trade or two separate captures, so both
// readings are produced and the caller's kernel replay keeps the one that
// reaches the served board. Banqi has no trades and never branches.
//
// HIDDEN-INFO NOTE: the inputs are a finished room's truth view and its move
// log. Callers check the finished status first; a live room's board carries
// face-down tiles with no identity, and this returns nothing for them anyway
// (a face-down entry on the final board is a mismatch).

export type FlipMove<S extends string> = { from: S; to: S };

export type FlipBoardEntry<C extends string, R extends string> =
  | { color: C; role: R; faceDown: false }
  | { faceDown: true };

export type FlipIdentity<C extends string, R extends string> = { color: C; role: R };

export type FlipFinish<S extends string, C extends string, R extends string> = {
  board: Partial<Record<S, FlipBoardEntry<C, R>>>;
  captured: readonly { owner: C; role: R }[];
};

/**
 * Every deal (in `squares` order, the kernel's deal index) consistent with the
 * finish and the move log, most likely first. Usually exactly one; more only
 * where an unmarked trade is ambiguous. The caller replays each through its
 * kernel and keeps the first that reaches the served board.
 */
export function* recoverFlipDeals<S extends string, C extends string, R extends string>(
  squares: readonly S[],
  moves: readonly FlipMove<S>[],
  finish: FlipFinish<S, C, R>,
  options: { trades: boolean },
): Generator<FlipIdentity<C, R>[]> {
  const start = new Map<S, number>(squares.map((square, index) => [square, index]));
  yield* walk(0, start, []);

  function* walk(
    from: number,
    originAt: Map<S, number>,
    capturedOrigins: number[],
  ): Generator<FlipIdentity<C, R>[]> {
    for (let index = from; index < moves.length; index += 1) {
      const move = moves[index]!;
      const origin = originAt.get(move.from);
      if (origin === undefined) return;
      if (move.from === move.to) continue; // a flip: the tile stays where it is
      const victim = originAt.get(move.to);
      if (victim === undefined) {
        originAt.delete(move.from);
        originAt.set(move.to, origin);
        continue;
      }
      const k = capturedOrigins.length;
      const taken = finish.captured[k];
      const next = finish.captured[k + 1];
      if (
        options.trades &&
        taken &&
        next &&
        next.role === taken.role &&
        next.owner !== taken.owner
      ) {
        // The trade reading: both tiles leave the board, victim first.
        const traded = new Map(originAt);
        traded.delete(move.from);
        traded.delete(move.to);
        yield* walk(index + 1, traded, [...capturedOrigins, victim, origin]);
      }
      capturedOrigins.push(victim);
      originAt.delete(move.from);
      originAt.set(move.to, origin);
    }
    const deal = assign(originAt, capturedOrigins);
    if (deal) yield deal;
  }

  function assign(
    originAt: Map<S, number>,
    capturedOrigins: readonly number[],
  ): FlipIdentity<C, R>[] | null {
    if (capturedOrigins.length !== finish.captured.length) return null;
    if (Object.keys(finish.board).length !== originAt.size) return null;
    const deal: (FlipIdentity<C, R> | undefined)[] = Array.from(
      { length: squares.length },
      () => undefined,
    );
    for (const [square, origin] of originAt) {
      const entry = finish.board[square];
      if (!entry || entry.faceDown) return null;
      deal[origin] = { color: entry.color, role: entry.role };
    }
    capturedOrigins.forEach((origin, index) => {
      const captured = finish.captured[index]!;
      deal[origin] = { color: captured.owner, role: captured.role };
    });
    if (deal.some((identity) => identity === undefined)) return null;
    return deal as FlipIdentity<C, R>[];
  }
}

/** Same pieces on the same squares, by colour and role. */
export function sameFlipBoard<S extends string, C extends string, R extends string>(
  truth: Partial<Record<S, FlipIdentity<C, R>>>,
  served: Partial<Record<S, FlipBoardEntry<C, R>>>,
): boolean {
  const squares = Object.keys(truth) as S[];
  if (squares.length !== Object.keys(served).length) return false;
  return squares.every((square) => {
    const left = truth[square];
    const right = served[square];
    if (!left || !right || right.faceDown) return false;
    return left.color === right.color && left.role === right.role;
  });
}

/** Same captured pool, in capture order. */
export function sameCaptures<C extends string, R extends string>(
  a: readonly { owner: C; role: R }[],
  b: readonly { owner: C; role: R }[],
): boolean {
  return (
    a.length === b.length && a.every((x, i) => x.owner === b[i]?.owner && x.role === b[i]?.role)
  );
}
