// Flip variants draw from both inks. Only a scored self-flip resolves an identity;
// every other face-down tile is counted from the PUBLIC inventory, never its deal.
import {
  type BanqiGameState,
  type BanqiMove,
  type BanqiPieceRole,
  type BanqiPlayerView,
  banqiHiddenPool,
  getBanqiPlayerView,
  getJungleFlipPlayerView,
  type HiddenPool,
  type JungleFlipGameState,
  type JungleFlipMove,
  type JungleFlipPieceRole,
  type JungleFlipPlayerView,
  jungleFlipHiddenPool,
} from '@mistboard/game';
import { t } from '../i18n/catalog.js';
import { jungleFlipPieceGhostSvg } from '../jungle-flip-render.js';
import { banqiPieceGhostSvg } from '../live-banqi-render.js';
import type { LuckCardDetail } from './luck-mark-card.js';

type Color = 'red' | 'black';
export type FlipRole = BanqiPieceRole | JungleFlipPieceRole;
export type FlipLuckDetail = LuckCardDetail<FlipRole>;
type PublicFlipView<Role extends FlipRole> = {
  board: Partial<Record<string, { faceDown: boolean; role?: Role; color?: Color }>>;
  firstColor: Color | null;
  status: { type: string; turn?: Color };
};

function detail<Role extends FlipRole>(
  move: { from: string; to: string },
  luck: number,
  before: PublicFlipView<Role>,
  drawn: { color: Color; role: Role } | null,
  pool: HiddenPool<Color, Role>,
  blue: boolean,
): LuckCardDetail<Role> | null {
  // These variants cannot capture face-down pieces. Even a stale score must
  // never turn a non-flip into a named or graded hidden target.
  if (move.from !== move.to || !before.board[move.to]?.faceDown || !drawn) return null;
  const mover =
    before.firstColor === null
      ? drawn.color
      : before.status.turn === 'red'
        ? before.firstColor
        : before.firstColor === 'red'
          ? 'black'
          : 'red';
  const entries = (['red', 'black'] as const)
    .flatMap((color) =>
      pool[color].entries.filter((entry) => entry.count > 0).map((entry) => ({ ...entry, color })),
    )
    .sort((a, b) => b.count - a.count);
  const count =
    entries.find((entry) => entry.color === drawn.color && entry.role === drawn.role)?.count ?? 0;
  const total = pool.red.total + pool.black.total;
  if (count <= 0 || total <= 0) return null;
  return {
    square: move.to,
    color: mover,
    luck,
    odds: { role: drawn.role, color: drawn.color, count, total, pool: entries },
    ...(blue
      ? {
          sideLabel: t(mover === 'red' ? 'setup.red' : 'setup.blue'),
          secondColorLabel: t('setup.blue'),
        }
      : {}),
  };
}

/** `drawn` is read only for the flip that actually happened, after it was exposed. */
export function publicFlipLuckDetail(
  variant: 'banqi' | 'jungle-flip',
  move: { from: string; to: string },
  luck: number,
  before: BanqiPlayerView | JungleFlipPlayerView,
  drawn: { color: Color; role: FlipRole } | null,
): FlipLuckDetail | null {
  return variant === 'banqi'
    ? detail(move, luck, before, drawn, banqiHiddenPool(before as BanqiPlayerView), false)
    : detail(move, luck, before, drawn, jungleFlipHiddenPool(before as JungleFlipPlayerView), true);
}

export function banqiLuckDetail(
  move: BanqiMove,
  info: { luck: number; before: BanqiGameState },
): LuckCardDetail<BanqiPieceRole> | null {
  return detail(
    move,
    info.luck,
    info.before,
    info.before.board[move.to] ?? null,
    banqiHiddenPool(getBanqiPlayerView(info.before, 'red')),
    false,
  );
}

export function jungleFlipLuckDetail(
  move: JungleFlipMove,
  info: { luck: number; before: JungleFlipGameState },
): LuckCardDetail<JungleFlipPieceRole> | null {
  return detail(
    move,
    info.luck,
    info.before,
    info.before.board[move.to] ?? null,
    jungleFlipHiddenPool(getJungleFlipPlayerView(info.before, 'red')),
    true,
  );
}

export const banqiLuckPieceSvg = (role: BanqiPieceRole, color: Color): string =>
  banqiPieceGhostSvg({ role, color });
export const jungleFlipLuckPieceSvg = (role: JungleFlipPieceRole, color: Color): string =>
  jungleFlipPieceGhostSvg({ role, color });

export function flipLuckPieceSvg(
  variant: 'banqi' | 'jungle-flip',
  role: FlipRole,
  color: Color,
): string {
  return variant === 'banqi'
    ? banqiLuckPieceSvg(role as BanqiPieceRole, color)
    : jungleFlipLuckPieceSvg(role as JungleFlipPieceRole, color);
}
