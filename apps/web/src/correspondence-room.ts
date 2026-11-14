import { readAccountPreferences } from './account-preferences.js';
import type { CorrespondenceGame, CorrespondenceGamesResponse } from './correspondence-model.js';
import { t } from './i18n/catalog.js';

type Move = {
  type: 'move';
  from?: string | number;
  to: string | number;
  promotion?: string;
  duckTo?: string;
  drop?: string;
};
type View = {
  id?: string;
  board?: Record<string, unknown> | unknown[];
  status?: { type: string; turn?: unknown };
  legalMoves?: unknown[];
  ply?: number;
  moveNumber?: number;
  visibleSquares?: unknown[];
};
type Frame = {
  mode?: string;
  seat?: unknown;
  paused?: boolean;
  gameSpecId?: string;
  timeControl?: { daysPerMove?: number } | null;
  state?: View;
};

const rooms = new Map<string, ReturnType<typeof createCorrespondenceRoom>>();

/** Rendering only: never mutate the server view or put a preview into replay. */
export function correspondencePreview<V>(room: string, view: V): V {
  return rooms.get(room)?.preview(view) ?? view;
}

export function renderCorrespondenceRoom(room: string, isLive = true): void {
  rooms.get(room)?.render(isLive);
}

export function nextCorrespondenceGame(games: readonly CorrespondenceGame[], room: string) {
  const waiting = games.filter((game) => game.isYourMove && game.roomId !== room);
  waiting.sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.roomId.localeCompare(b.roomId));
  return { next: waiting[0] ?? null, count: waiting.length };
}

export function createCorrespondenceRoom(
  room: string,
  send: (move: unknown) => boolean,
  repaint: () => void,
) {
  let frame: Frame = {};
  let position = '';
  let pending: Move | null = null;
  let submitted = false;
  let active = true;
  let request = 0;
  let next: ReturnType<typeof nextCorrespondenceGame> | null = null;
  let host: HTMLElement | null = null;

  function eligible() {
    return frame.mode === 'correspondence' || frame.timeControl?.daysPerMove !== undefined;
  }

  function participant() {
    return typeof frame.seat === 'string' && !['spectator', 'observer'].includes(frame.seat);
  }

  function confirm(attempt: Move) {
    if (pending !== attempt) return;
    const move = pending;
    pending = null;
    submitted = send(move);
    repaint();
    render();
  }

  async function loadNext() {
    const version = ++request;
    next = null;
    try {
      const response = await fetch('/api/correspondence/games');
      if (!response.ok) return;
      const data = (await response.json()) as CorrespondenceGamesResponse;
      if (!active || version !== request) return;
      next = nextCorrespondenceGame(data.games, room);
      render();
    } catch {
      // The inbox link remains usable when the list cannot be refreshed.
    }
  }

  function render(isLive = true) {
    const board = document.querySelector<HTMLElement>('[data-board]');
    if (!board) return;
    if (!isLive) pending = null;
    board.inert = pending !== null || submitted;
    if (!active || !eligible() || !participant()) {
      host?.remove();
      host = null;
      return;
    }
    if (!host?.isConnected) {
      host = document.createElement('div');
      host.className = 'correspondence-room';
      (board.closest('.board-shell') ?? board).after(host);
    }
    host.replaceChildren();
    if (pending) {
      const label = document.createElement('p');
      label.setAttribute('role', 'status');
      label.textContent = t('correspondence.pendingMove');
      const actions = document.createElement('div');
      actions.className = 'correspondence-room__actions';
      const confirmButton = document.createElement('button');
      confirmButton.type = 'button';
      confirmButton.dataset.correspondenceConfirm = '';
      confirmButton.textContent = t('correspondence.confirmMove');
      const attempt = pending;
      confirmButton.addEventListener('click', () => confirm(attempt));
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.dataset.correspondenceCancel = '';
      cancel.textContent = t('correspondence.cancelMove');
      cancel.addEventListener('click', () => {
        if (pending !== attempt) return;
        pending = null;
        repaint();
        render();
      });
      actions.append(confirmButton, cancel);
      host.append(label, actions);
    } else if (next?.next) {
      const link = document.createElement('a');
      link.href = next.next.url;
      link.textContent = t('correspondence.nextGame', { count: next.count });
      host.append(link);
    }
    const back = document.createElement('a');
    back.href = '/correspondence';
    back.textContent = t('correspondence.backToGames');
    host.append(back);
  }

  const controller = {
    update(update: Frame) {
      frame = { ...frame, ...update };
      const view = frame.state;
      const key = JSON.stringify([
        view?.id,
        view?.board,
        view?.status,
        view?.ply,
        view?.moveNumber,
        frame.seat,
        frame.paused,
      ]);
      if (key !== position) {
        pending = null;
        if (view?.status?.turn === frame.seat) {
          next = null;
          request++;
        }
        if (
          submitted &&
          eligible() &&
          participant() &&
          (view?.status?.type === 'finished' || view?.status?.turn !== frame.seat)
        )
          void loadNext();
        submitted = false;
        position = key;
      }
    },
    intercept(payload: unknown): boolean | undefined {
      const move = payload as Move | null;
      if (move?.type !== 'move' || !eligible()) return undefined;
      if (pending || submitted) return false;
      next = null;
      request++;
      if (!readAccountPreferences().confirmCorrespondenceMoves) {
        submitted = send(move);
        return submitted;
      }
      if (
        frame.state?.status?.type !== 'playing' ||
        frame.state.status.turn !== frame.seat ||
        frame.paused
      )
        return false;
      pending = { ...move };
      render();
      // Some board handlers repaint once more after send returns.
      queueMicrotask(() => {
        if (active) repaint();
      });
      return false;
    },
    preview<V>(view: V): V {
      if (!pending || view !== frame.state) return view;
      const source = frame.state;
      if (!source?.board) return view;
      const move = pending;
      let board: Record<string, unknown> | unknown[];
      if (Array.isArray(source.board)) {
        board = [...source.board];
        if (typeof move.to === 'string') {
          // Gomoku uses a flat 15x15 array; placement has no hidden information.
          const index = (Number(move.to.slice(1)) - 1) * 15 + move.to.charCodeAt(0) - 97;
          board[index] = source.status?.turn;
        } else if (typeof move.from === 'number' && move.from !== move.to) {
          board[move.to] = board[move.from];
          board[move.from] = null;
        }
      } else {
        board = { ...source.board };
        if (move.drop) board[move.to] = { role: move.drop, color: source.status?.turn };
        if (move.from !== undefined && move.from !== move.to) {
          const piece = board[move.from] as { role?: string; color?: string } | undefined;
          const target = board[move.to] as { role?: string; color?: string } | undefined;
          delete board[move.from];
          if (
            piece?.role === 'king' &&
            target?.role === 'rook' &&
            piece.color === target.color &&
            typeof move.from === 'string' &&
            typeof move.to === 'string'
          ) {
            const kingSide = move.to > move.from;
            delete board[move.to];
            board[`${kingSide ? 'g' : 'c'}${move.from.slice(1)}`] = piece;
            board[`${kingSide ? 'f' : 'd'}${move.from.slice(1)}`] = target;
          } else {
            board[move.to] = move.promotion && piece ? { ...piece, role: move.promotion } : piece;
            if (
              piece?.role === 'pawn' &&
              !target &&
              typeof move.from === 'string' &&
              typeof move.to === 'string' &&
              move.from[0] !== move.to[0]
            )
              delete board[`${move.to[0]}${move.from.slice(1)}`];
          }
        }
      }
      // A flip stays covered. Never run a kernel or infer a hidden identity.
      return {
        ...source,
        board,
        legalMoves: [],
        lastMove: { from: move.from, to: move.to },
        ...(source.visibleSquares
          ? { visibleSquares: [...new Set([...source.visibleSquares, move.to])] }
          : {}),
        ...(move.duckTo ? { duck: move.duckTo } : {}),
      } as V;
    },
    render,
    reset() {
      pending = null;
      submitted = false;
    },
    close() {
      active = false;
      request++;
      pending = null;
      host?.remove();
      const board = document.querySelector<HTMLElement>('[data-board]');
      if (board) board.inert = false;
      if (rooms.get(room) === controller) rooms.delete(room);
    },
  };
  rooms.set(room, controller);
  return controller;
}
