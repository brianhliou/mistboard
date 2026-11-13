import {
  getStandardXiangqiPlayerView,
  parseJungleFen,
  parseStandardXiangqiFen,
  puzzleShortCode,
} from '@mistboard/game';
import '../live-xiangqi.css';
import './history.css';
import { loginHrefForCurrentPage } from '../auth-redirect.js';
import { t } from '../i18n/catalog.js';
import { currentLocale, LOCALE_META } from '../i18n/locale.js';
import { renderJungleBoardSvg } from '../jungle-render.js';
import type { PuzzleHistoryEntry } from '../profile-puzzles.js';
import { buildNav } from '../site-shell.js';
import { xiangqiAppearanceChangedEvent } from '../theme.js';
import { renderXiangqiBoardSvg } from '../xiangqi-board.js';
import { renderPuzzleMenuLayout } from './puzzle-menu.js';

type HistoryEntry = PuzzleHistoryEntry & {
  fen: string | null;
  sideToMove: 'red' | 'black' | null;
  /** False once the puzzle was withdrawn: its board still draws, its page is gone. */
  available?: boolean;
};
type HistoryPage = { attempts: HistoryEntry[]; nextCursor: string | null };

/** The ledger has no mode column. Adjacent attempts within an hour form a session. */
export function puzzleHistorySessions(attempts: HistoryEntry[]): HistoryEntry[][] {
  const sessions: HistoryEntry[][] = [];
  // Pages arrive newest first; walk oldest first to apply the session rule,
  // retaining the server's deterministic tie order and the order played within each row.
  for (const attempt of [...attempts].reverse()) {
    const session = sessions.at(-1);
    const previous = session?.at(-1);
    if (previous && Date.parse(attempt.createdAt) - Date.parse(previous.createdAt) <= 3_600_000) {
      session!.push(attempt);
    } else {
      sessions.push([attempt]);
    }
  }
  return sessions.reverse();
}

export function puzzleHistoryTime(createdAt: string, now = Date.now()): string {
  const minutes = Math.max(1, Math.floor((now - Date.parse(createdAt)) / 60_000));
  const unit = minutes < 60 ? 'minute' : minutes < 1440 ? 'hour' : 'day';
  const amount = unit === 'minute' ? minutes : Math.floor(minutes / (unit === 'hour' ? 60 : 1440));
  return new Intl.RelativeTimeFormat(LOCALE_META[currentLocale()].dateLocale, {
    numeric: 'always',
  }).format(-amount, unit);
}

function thumbnail(entry: HistoryEntry): HTMLElement {
  const link = document.createElement('a');
  link.className = `puzzle-history__attempt puzzle-history__attempt--${entry.solved ? 'solved' : 'incorrect'}`;
  // A withdrawn puzzle's page answers 404, so its card keeps the board and drops the link.
  if (entry.available !== false) link.href = `/puzzles/${encodeURIComponent(entry.puzzleId)}`;
  link.dataset.puzzleId = entry.puzzleId;
  const board = document.createElement('span');
  board.className = 'puzzle-history__board';
  board.setAttribute('aria-hidden', 'true');
  // Fail closed: a future hidden-information variant must supply a solver-view
  // thumbnail contract before this renderer can draw it. Never parse its FEN as xiangqi.
  if (entry.fen && entry.sideToMove) {
    const perspective = entry.sideToMove;
    if (entry.variant === 'xiangqi') {
      const parsed = parseStandardXiangqiFen(entry.fen);
      if (parsed.ok) {
        // Use the same board as the homepage puzzle and replay boards, so
        // layout, colour, pieces and the reader's other board settings agree.
        board.innerHTML = renderXiangqiBoardSvg(
          getStandardXiangqiPlayerView(parsed.state, perspective),
          perspective,
        );
      }
    } else if (entry.variant === 'jungle') {
      const parsed = parseJungleFen(entry.fen);
      if (parsed.ok)
        board.innerHTML = renderJungleBoardSvg(parsed.state.board, {
          perspective: entry.sideToMove,
          interactive: false,
        });
    }
  }
  const label = document.createElement('span');
  label.className = 'puzzle-history__result';
  // Lichess shows the puzzle's short id at the end of this line on hover.
  label.dataset.puzzleCode = `#${puzzleShortCode(entry.puzzleId)}`;
  label.textContent = entry.solved
    ? t('puzzle.dashboardSolved')
    : { en: 'Incorrect', 'zh-Hans': '错误', 'zh-Hant': '錯誤' }[currentLocale()];
  link.setAttribute('aria-label', `${t('puzzle.label')}${entry.puzzleId}: ${label.textContent}`);
  link.append(board, label);
  return link;
}

export async function mountPuzzleHistory(root: HTMLElement): Promise<void> {
  const main = document.createElement('main');
  main.className = 'puzzle-history';
  const title = document.createElement('h1');
  title.textContent = t('puzzle.historyTitle');
  const content = document.createElement('div');
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const more = document.createElement('button');
  more.type = 'button';
  more.textContent = t('site.more');
  main.append(title, content, status, more);
  root.replaceChildren(buildNav(), renderPuzzleMenuLayout('history', main));

  const attempts: HistoryEntry[] = [];
  const seenPuzzleIds = new Set<string>();
  let cursor: string | null = null;
  let hasMore = true;
  let busy = false;
  const render = () => {
    content.replaceChildren();
    for (const session of puzzleHistorySessions(attempts)) {
      const section = document.createElement('section');
      section.className = 'puzzle-history__session';
      const header = document.createElement('header');
      const heading = document.createElement('h2');
      heading.textContent = t('nav.puzzles');
      const time = document.createElement('time');
      time.dateTime = session.at(-1)!.createdAt;
      time.title = new Date(time.dateTime).toLocaleString(LOCALE_META[currentLocale()].dateLocale);
      time.textContent = puzzleHistoryTime(time.dateTime);
      header.append(heading, time);
      const row = document.createElement('div');
      row.className = 'puzzle-history__row';
      row.append(...session.map(thumbnail));
      section.append(header, row);
      content.append(section);
    }
    if (!attempts.length) {
      const play = document.createElement('a');
      play.href = '/puzzles';
      play.textContent = t('puzzle.dashboardEmpty');
      content.append(play);
    }
  };
  const load = async () => {
    if (busy || !hasMore) return;
    busy = true;
    more.disabled = true;
    status.textContent = t('puzzle.loading');
    main.setAttribute('aria-busy', 'true');
    try {
      const query = new URLSearchParams({ order: 'newest', limit: '50' });
      if (cursor !== null) query.set('cursor', cursor);
      const response = await fetch(`/api/puzzles/history?${query}`, {
        credentials: 'same-origin',
      });
      if (response.status === 401) {
        attempts.length = 0;
        const signIn = document.createElement('a');
        signIn.href = loginHrefForCurrentPage();
        signIn.textContent = t('nav.signIn');
        content.replaceChildren(signIn);
        seenPuzzleIds.clear();
        hasMore = false;
        status.textContent = '';
        return;
      }
      if (!response.ok) throw new Error('History unavailable');
      const page = (await response.json()) as HistoryPage;
      if (
        !Array.isArray(page.attempts) ||
        (page.nextCursor !== null &&
          (typeof page.nextCursor !== 'string' || !page.nextCursor || page.nextCursor === cursor))
      )
        throw new Error('Invalid history page');
      for (const attempt of page.attempts) {
        if (seenPuzzleIds.has(attempt.puzzleId)) continue;
        seenPuzzleIds.add(attempt.puzzleId);
        attempts.push(attempt);
      }
      cursor = page.nextCursor;
      hasMore = cursor !== null;
      render();
      status.textContent = '';
      more.textContent = t('site.more');
    } catch {
      status.textContent = t('stats.unavailableBody');
      more.textContent = t('puzzle.statusTryAgain');
    } finally {
      busy = false;
      more.disabled = false;
      more.hidden = !hasMore;
      main.removeAttribute('aria-busy');
    }
  };
  const repaint = () => {
    if (!root.isConnected) {
      window.removeEventListener(xiangqiAppearanceChangedEvent, repaint);
      return;
    }
    if (attempts.length) render();
  };
  window.addEventListener(xiangqiAppearanceChangedEvent, repaint);
  more.addEventListener('click', () => void load());
  await load();
}
