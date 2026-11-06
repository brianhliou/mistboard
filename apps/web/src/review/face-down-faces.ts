// What the still-face-down pieces were, on the review of a FINISHED flip game
// (banqi, Three Kingdoms banqi, Flip Jungle, jieqi; #824).
//
// The postgame payload of a finished game already carries the whole deal, so the
// review's truth state knows every face-down identity; nothing new is fetched.
// The masked as-played view stays exactly as it was: the identities ride beside
// it in a client-only `faceDownFaces` field, and each board draws them as a
// ghosted face over the back (`.facedown-face`), invisible until the reader
// hovers the tile (desktop) or turns them all up from the review menu. The
// view's `board` never changes, because a flip is the self-move on a tile the
// view says is face-down: a revealed board would stop the line being playable.
//
// The postgame mounts and jieqi study chapters opt in (`showFaceDown`). A study
// chapter's root already holds every identity its Reveal identities shows, so the
// hover adds no knowledge. The analysis board never gets the field.

import type { ProjectedView, VariantTreeAdapter } from './game-tree.js';
import './face-down-faces.css';

export interface FaceDownIdentity<Color extends string = string, Role extends string = string> {
  color: Color;
  role: Role;
}

export interface FaceDownFaces<
  Square extends string = string,
  Color extends string = string,
  Role extends string = string,
> {
  /** The identity under each face-down tile, by square. */
  identities: Partial<Record<Square, FaceDownIdentity<Color, Role>>>;
  /** The menu's "Reveal identities" is on: every ghost face shows. */
  revealed: boolean;
}

/** A review view with the face-down identities beside it (client-only). */
export type WithFaceDownFaces<
  View,
  Square extends string = string,
  Color extends string = string,
  Role extends string = string,
> = View & { faceDownFaces?: FaceDownFaces<Square, Color, Role> };

type TruthPiece<Color extends string, Role extends string> = {
  color: Color;
  role: Role;
  faceDown: boolean;
  /** Jieqi: an imported piece whose identity was never determined (its role is
   *  a random draw), so it has nothing true to show. */
  unknown?: boolean;
};

/** The identity of every face-down piece on a truth board, skipping any whose
 *  identity was never determined. */
export function faceDownIdentities<
  Square extends string,
  Color extends string,
  Role extends string,
>(
  board: Partial<Record<Square, TruthPiece<Color, Role>>>,
): Partial<Record<Square, FaceDownIdentity<Color, Role>>> {
  const out: Partial<Record<Square, FaceDownIdentity<Color, Role>>> = {};
  for (const [square, piece] of Object.entries(board) as [
    Square,
    TruthPiece<Color, Role> | undefined,
  ][]) {
    if (!piece?.faceDown || piece.unknown) continue;
    out[square] = { color: piece.color, role: piece.role };
  }
  return out;
}

/** Wrap a review adapter so every projected view carries the face-down
 *  identities of the truth it was projected from. Only squares the VIEW shows
 *  face-down get one (a jieqi board already revealed by the menu shows none).
 *  `revealed` is read at projection time, like jieqi's revealAll. */
export function withFaceDownFaces<
  Move,
  Truth extends { board: Partial<Record<Square, TruthPiece<Color, Role>>> },
  View extends { board: Partial<Record<Square, { faceDown: boolean } | undefined>> },
  Square extends string = string,
  Color extends string = string,
  Role extends string = string,
>(
  adapter: VariantTreeAdapter<Move, Truth, View>,
  revealed: () => boolean,
): VariantTreeAdapter<Move, Truth, WithFaceDownFaces<View, Square, Color, Role>> {
  return {
    ...adapter,
    project: (truth): ProjectedView<WithFaceDownFaces<View, Square, Color, Role>>[] => {
      const all = faceDownIdentities<Square, Color, Role>(truth.board);
      return adapter.project(truth).map((pv) => {
        const identities: Partial<Record<Square, FaceDownIdentity<Color, Role>>> = {};
        for (const [square, identity] of Object.entries(all) as [
          Square,
          FaceDownIdentity<Color, Role>,
        ][]) {
          if (pv.view.board[square]?.faceDown) identities[square] = identity;
        }
        return { ...pv, view: { ...pv.view, faceDownFaces: { identities, revealed: revealed() } } };
      });
    },
  };
}

/** The ghost face drawn over a face-down tile (`inner` is the face-up piece's
 *  markup at the tile's position), or '' when the square has no identity. */
export function faceDownFaceSvg(
  faces: FaceDownFaces | undefined,
  square: string,
  inner: (identity: FaceDownIdentity) => string,
): string {
  const identity = faces?.identities[square];
  if (!identity) return '';
  return `<g class="facedown-face" aria-hidden="true" pointer-events="none">${inner(identity)}</g>`;
}

/** Extra slot class for a face-down tile while the menu reveals every face. */
export function faceDownSlotClass(faces: FaceDownFaces | undefined, square: string): string {
  return faces?.revealed && faces.identities[square] ? ' facedown-revealed' : '';
}

const PEEK_CLASS = 'facedown-peeking';

/** Desktop hover: the tile under a mouse or pen shows its ghost face. The hit
 *  layer sits over the pieces, so this reads the hit target's `[data-square]`
 *  and marks the matching `[data-piece-square]` slot; a re-render (the board's
 *  innerHTML swap) re-applies it. Touch gets the menu toggle only: a tap is a
 *  flip or a selection, never a peek. */
export function installFaceDownPeek(host: HTMLElement, signal: AbortSignal): void {
  let square: string | null = null;
  const apply = (): void => {
    for (const el of host.querySelectorAll(`.${PEEK_CLASS}`)) {
      if (el.getAttribute('data-piece-square') !== square) el.classList.remove(PEEK_CLASS);
    }
    if (square === null) return;
    host.querySelector(`[data-piece-square="${square}"]`)?.classList.add(PEEK_CLASS);
  };
  host.addEventListener(
    'pointermove',
    (event) => {
      if (event.pointerType === 'touch') return;
      const target = event.target instanceof Element ? event.target : null;
      const next = target?.closest('[data-square]')?.getAttribute('data-square') ?? null;
      if (next === square) return;
      square = next;
      apply();
    },
    { signal },
  );
  host.addEventListener(
    'pointerleave',
    () => {
      square = null;
      apply();
    },
    { signal },
  );
  const observer = new MutationObserver(() => {
    if (square !== null) apply();
  });
  observer.observe(host, { childList: true, subtree: true });
  signal.addEventListener('abort', () => observer.disconnect(), { once: true });
}

/** Opt a review mount into face-down faces when its config asks
 *  (`showFaceDown`, the postgame surfaces only): the adapter's views carry the
 *  identities, and the menu's Reveal/Hide identities turns every ghost face up.
 *  A variant that already reveals from the menu (jieqi swaps in its truth
 *  board) keeps its own setter; the ghost flag rides along with it. */
export function withFaceDownReview<
  Move,
  Truth extends { board: Partial<Record<string, TruthPiece<string, string>>> },
  View extends { board: Partial<Record<string, { faceDown: boolean } | undefined>> },
  Config extends {
    showFaceDown?: boolean;
    revealHidden?: { setRevealed(next: boolean): void };
  },
>(
  adapter: VariantTreeAdapter<Move, Truth, View>,
  config: Config,
): { adapter: VariantTreeAdapter<Move, Truth, View>; config: Config } {
  if (!config.showFaceDown) return { adapter, config };
  let revealed = false;
  const own = config.revealHidden;
  return {
    adapter: withFaceDownFaces(adapter, () => revealed),
    config: {
      ...config,
      revealHidden: {
        setRevealed: (next: boolean) => {
          revealed = next;
          own?.setRevealed(next);
        },
      },
    },
  };
}
